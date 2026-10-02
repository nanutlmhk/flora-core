//! Egress: pushes `gw.obs` to external HTTP receivers (`pod:uri`) in batches.
//! Pull consumers (Leaf) use the data server instead.

use std::collections::HashSet;
use std::time::Duration;

use anyhow::Result;
use gateway_core::admin::{self, StatusMap};
use gateway_core::config::{GatewayConfig, PublishTarget};
use gateway_core::envelope::{Observation, OBS_TOPIC};
use gateway_core::{kafka, telemetry};
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::Message;
use serde_json::{json, Value};
use tokio::sync::mpsc;

const COMPONENT: &str = "publisher";

#[tokio::main]
async fn main() -> Result<()> {
    telemetry::init();
    let config = GatewayConfig::load()?;
    let status = admin::status_map();
    let client = reqwest::Client::new();
    let mut routes: Vec<(HashSet<String>, mpsc::Sender<Value>)> = Vec::new();
    for target in config.publisher.targets.clone() {
        let key = format!("publish.{}", target.id);
        admin::register(&status, &key, json!({ "url": target.url }));
        let (sender, receiver) = mpsc::channel::<Value>(10_000);
        routes.push((target.device_ids.iter().cloned().collect(), sender));
        tokio::spawn(deliver(target, key, client.clone(), status.clone(), receiver));
    }
    tokio::spawn(admin::serve(COMPONENT, config.publisher.admin_port, status));
    tracing::info!(targets = routes.len(), "publisher started");
    if routes.is_empty() {
        std::future::pending::<()>().await;
    }

    let consumer: StreamConsumer = kafka::consumer(&config.kafka.brokers, "gw-publisher", true, "latest")?;
    consumer.subscribe(&[OBS_TOPIC])?;
    loop {
        match consumer.recv().await {
            Ok(message) => {
                let Some(payload) = message.payload() else { continue };
                let Ok(observation) = serde_json::from_slice::<Observation>(payload) else { continue };
                let value = serde_json::to_value(&observation)?;
                for (devices, sender) in &routes {
                    if devices.is_empty() || devices.contains(&observation.device_id) {
                        // A slow receiver must not stall the others; drop when its queue is full.
                        let _ = sender.try_send(value.clone());
                    }
                }
            }
            Err(error) => {
                tracing::warn!(%error, "kafka receive error");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}

async fn deliver(target: PublishTarget, key: String, client: reqwest::Client, status: StatusMap, mut receiver: mpsc::Receiver<Value>) {
    let flush = Duration::from_millis(target.flush_ms.max(100));
    let mut batch: Vec<Value> = Vec::with_capacity(target.batch_size);
    loop {
        let deadline = tokio::time::Instant::now() + flush;
        while batch.len() < target.batch_size {
            match tokio::time::timeout_at(deadline, receiver.recv()).await {
                Ok(Some(value)) => batch.push(value),
                Ok(None) => return,
                Err(_) => break,
            }
        }
        if batch.is_empty() {
            continue;
        }
        let mut delivered = false;
        for attempt in 0..3u32 {
            let mut request = client.post(&target.url).timeout(Duration::from_millis(target.timeout_ms)).json(&batch);
            for (name, value) in &target.headers {
                request = request.header(name, value);
            }
            match request.send().await.and_then(|response| response.error_for_status()) {
                Ok(_) => {
                    delivered = true;
                    break;
                }
                Err(error) => {
                    admin::set_connected(&status, &key, false, Some(error.to_string()));
                    tokio::time::sleep(Duration::from_millis(500 * 2u64.pow(attempt))).await;
                }
            }
        }
        if delivered {
            admin::set_connected(&status, &key, true, None);
            admin::record_frame(&status, &key, batch.len());
        } else {
            tracing::warn!(target = target.id, dropped = batch.len(), "publish target unreachable, batch dropped");
        }
        batch.clear();
    }
}
