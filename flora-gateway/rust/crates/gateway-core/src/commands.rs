//! Routes `gw.cmd.<pod>` messages to the task that owns that pod's connection.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::Result;
use rdkafka::consumer::{Consumer, StreamConsumer};
use rdkafka::Message;
use tokio::sync::mpsc;

use crate::envelope::{cmd_topic, Command};

pub async fn route(brokers: String, group: String, senders: HashMap<String, mpsc::Sender<Command>>) -> Result<()> {
    if senders.is_empty() {
        return Ok(());
    }
    let consumer: StreamConsumer = crate::kafka::consumer(&brokers, &group, true, "latest")?;
    let by_topic: HashMap<String, String> = senders.keys().map(|pod| (cmd_topic(pod), pod.clone())).collect();
    let topics: Vec<&str> = by_topic.keys().map(String::as_str).collect();
    consumer.subscribe(&topics)?;
    tracing::info!(?topics, "listening for device commands");
    loop {
        match consumer.recv().await {
            Ok(message) => {
                let Some(pod) = by_topic.get(message.topic()) else { continue };
                let Some(payload) = message.payload() else { continue };
                match serde_json::from_slice::<Command>(payload) {
                    Ok(command) => {
                        if let Some(sender) = senders.get(pod) {
                            if sender.send(command).await.is_err() {
                                tracing::warn!(pod, "pod task is gone, command dropped");
                            }
                        }
                    }
                    Err(error) => tracing::warn!(pod, %error, "invalid command payload"),
                }
            }
            Err(error) => {
                tracing::warn!(%error, "command consumer error");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    }
}
