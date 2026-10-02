//! Ingress: polls device/vendor HTTP endpoints and publishes each response body to
//! `gw.raw.feeder.<id>`.

use std::time::Duration;

use anyhow::Result;
use gateway_core::admin::{self, StatusMap};
use gateway_core::config::{FeederPod, GatewayConfig};
use gateway_core::envelope::{pod_key, raw_topic, RawFrame};
use gateway_core::{kafka, telemetry};
use rdkafka::producer::FutureProducer;
use serde_json::{json, Map};
use tokio::time::MissedTickBehavior;

const COMPONENT: &str = "feeder-controller";

#[tokio::main]
async fn main() -> Result<()> {
    telemetry::init();
    let config = GatewayConfig::load()?;
    let producer = kafka::producer(&config.kafka.brokers)?;
    let status = admin::status_map();
    let client = reqwest::Client::builder().build()?;
    for pod in config.feeder.pods.clone() {
        let key = pod_key("feeder", &pod.id);
        admin::register(&status, &key, json!({ "url": pod.url, "interval_ms": pod.interval_ms }));
        tokio::spawn(run_pod(pod, key, config.gateway_id.clone(), client.clone(), producer.clone(), status.clone()));
    }
    tracing::info!(pods = config.feeder.pods.len(), "feeder controller started");
    admin::serve(COMPONENT, config.feeder.admin_port, status).await
}

async fn run_pod(pod: FeederPod, key: String, gateway_id: String, client: reqwest::Client, producer: FutureProducer, status: StatusMap) {
    let topic = raw_topic(&key);
    let mut ticker = tokio::time::interval(Duration::from_millis(pod.interval_ms.max(100)));
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut seq = 0u64;
    let mut was_connected = false;
    loop {
        ticker.tick().await;
        match poll(&client, &pod).await {
            Ok((http_status, content_type, body)) => {
                if !was_connected {
                    telemetry::emit(&producer, COMPONENT, "info", Some(&key), "feeder source reachable", json!({ "url": pod.url }));
                }
                was_connected = true;
                admin::set_connected(&status, &key, true, None);
                let mut meta = Map::new();
                meta.insert("url".into(), json!(pod.url));
                meta.insert("http_status".into(), json!(http_status));
                meta.insert("content_type".into(), json!(content_type));
                let frame = RawFrame::from_bytes(&key, "feeder", &gateway_id, seq, &body, meta);
                if let Err(error) = kafka::enqueue_json(&producer, &topic, &key, &frame) {
                    tracing::warn!(pod = key, %error, "could not enqueue frame");
                    continue;
                }
                admin::record_frame(&status, &key, body.len());
                seq += 1;
            }
            Err(error) => {
                if was_connected {
                    telemetry::emit(&producer, COMPONENT, "warn", Some(&key), "feeder source unreachable", json!({ "error": error.to_string() }));
                }
                was_connected = false;
                admin::set_connected(&status, &key, false, Some(error.to_string()));
            }
        }
    }
}

async fn poll(client: &reqwest::Client, pod: &FeederPod) -> Result<(u16, String, Vec<u8>)> {
    let mut request = client.get(&pod.url).timeout(Duration::from_millis(pod.timeout_ms));
    for (name, value) in &pod.headers {
        request = request.header(name, value);
    }
    let response = request.send().await?.error_for_status()?;
    let http_status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    Ok((http_status, content_type, response.bytes().await?.to_vec()))
}
