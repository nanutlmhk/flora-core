//! Ingress: devices or vendor systems `POST` to a per-pod port; each body is
//! published to `gw.raw.webhook.<id>`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use anyhow::Result;
use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::{Json, Router};
use gateway_core::admin::{self, StatusMap};
use gateway_core::config::{GatewayConfig, WebhookPod};
use gateway_core::envelope::{pod_key, raw_topic, RawFrame};
use gateway_core::{kafka, telemetry};
use rdkafka::producer::FutureProducer;
use serde_json::{json, Map};

const COMPONENT: &str = "webhook-controller";

struct PodContext {
    key: String,
    topic: String,
    gateway_id: String,
    producer: FutureProducer,
    status: StatusMap,
    seq: AtomicU64,
}

#[tokio::main]
async fn main() -> Result<()> {
    telemetry::init();
    let config = GatewayConfig::load()?;
    let producer = kafka::producer(&config.kafka.brokers)?;
    let status = admin::status_map();
    for pod in config.webhook.pods.clone() {
        let key = pod_key("webhook", &pod.id);
        admin::register(&status, &key, json!({ "port": pod.port }));
        let context = Arc::new(PodContext {
            topic: raw_topic(&key),
            key,
            gateway_id: config.gateway_id.clone(),
            producer: producer.clone(),
            status: status.clone(),
            seq: AtomicU64::new(0),
        });
        tokio::spawn(async move {
            if let Err(error) = serve_pod(pod, context).await {
                tracing::error!(%error, "webhook pod stopped");
            }
        });
    }
    tracing::info!(pods = config.webhook.pods.len(), "webhook controller started");
    admin::serve(COMPONENT, config.webhook.admin_port, status).await
}

async fn serve_pod(pod: WebhookPod, context: Arc<PodContext>) -> Result<()> {
    let app = Router::new()
        .fallback(receive)
        .layer(DefaultBodyLimit::max(pod.max_body_bytes))
        .with_state(context.clone());
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", pod.port)).await?;
    admin::set_connected(&context.status, &context.key, true, None);
    tracing::info!(pod = context.key, port = pod.port, "webhook pod listening");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn receive(State(context): State<Arc<PodContext>>, method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> impl IntoResponse {
    if method != Method::POST && method != Method::PUT {
        return (StatusCode::METHOD_NOT_ALLOWED, Json(json!({ "error": "use POST or PUT" })));
    }
    let seq = context.seq.fetch_add(1, Ordering::Relaxed);
    let mut meta = Map::new();
    meta.insert("path".into(), json!(uri.path()));
    meta.insert("query".into(), json!(uri.query().unwrap_or("")));
    meta.insert(
        "content_type".into(),
        json!(headers.get("content-type").and_then(|value| value.to_str().ok()).unwrap_or("")),
    );
    let frame = RawFrame::from_bytes(&context.key, "webhook", &context.gateway_id, seq, &body, meta);
    match kafka::enqueue_json(&context.producer, &context.topic, &context.key, &frame) {
        Ok(()) => {
            admin::record_frame(&context.status, &context.key, body.len());
            (StatusCode::ACCEPTED, Json(json!({ "accepted": true, "pod": context.key, "seq": seq })))
        }
        Err(error) => {
            telemetry::emit(&context.producer, COMPONENT, "error", Some(&context.key), "could not enqueue webhook frame", json!({ "error": error.to_string() }));
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({ "accepted": false, "error": error.to_string() })))
        }
    }
}
