use std::time::Duration;

use anyhow::{anyhow, Result};
use rdkafka::consumer::StreamConsumer;
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::ClientConfig;
use serde::Serialize;

pub fn producer(brokers: &str) -> Result<FutureProducer> {
    Ok(ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .set("message.timeout.ms", "30000")
        .set("linger.ms", "5")
        .set("allow.auto.create.topics", "true")
        .create()?)
}

/// `offset_reset` is `earliest` for storage consumers that must not miss data and
/// `latest` for live consumers.
pub fn consumer(brokers: &str, group: &str, auto_commit: bool, offset_reset: &str) -> Result<StreamConsumer> {
    Ok(ClientConfig::new()
        .set("bootstrap.servers", brokers)
        .set("group.id", group)
        .set("enable.auto.commit", if auto_commit { "true" } else { "false" })
        .set("auto.offset.reset", offset_reset)
        .set("allow.auto.create.topics", "true")
        .set("topic.metadata.refresh.interval.ms", "5000")
        // A restarted container rejoins quickly instead of waiting out the old member.
        .set("session.timeout.ms", "10000")
        .set("heartbeat.interval.ms", "3000")
        .create()?)
}

/// Sends and waits for the broker acknowledgement.
pub async fn send_json<T: Serialize>(producer: &FutureProducer, topic: &str, key: &str, value: &T) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    producer
        .send(FutureRecord::to(topic).key(key).payload(&payload), Duration::from_secs(10))
        .await
        .map_err(|(error, _)| anyhow!(error))?;
    Ok(())
}

/// Enqueues without blocking the device read loop. librdkafka buffers and retries;
/// a final delivery failure is logged.
pub fn enqueue_json<T: Serialize>(producer: &FutureProducer, topic: &str, key: &str, value: &T) -> Result<()> {
    let payload = serde_json::to_vec(value)?;
    let delivery = producer
        .send_result(FutureRecord::to(topic).key(key).payload(&payload))
        .map_err(|(error, _)| anyhow!(error))?;
    let topic = topic.to_string();
    tokio::spawn(async move {
        match delivery.await {
            Ok(Err((error, _))) => tracing::warn!(topic, %error, "kafka delivery failed"),
            Err(_) => tracing::warn!(topic, "kafka delivery cancelled"),
            Ok(Ok(_)) => {}
        }
    });
    Ok(())
}
