use rdkafka::producer::FutureProducer;
use serde_json::Value;
use tracing_subscriber::EnvFilter;

use crate::envelope::{LogEvent, LOG_TOPIC};

/// Structured stdout logs. `RUST_LOG` overrides the default `info` level.
pub fn init() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .with_target(false)
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout()))
        .compact()
        .init();
}

/// Publishes an operational event to `gw.logs`, which the collector stores in the
/// gateway `Logs` table for the Gateway Service UI.
pub fn emit(producer: &FutureProducer, component: &str, level: &str, pod: Option<&str>, message: &str, detail: Value) {
    let event = LogEvent {
        ts: crate::now_ms(),
        component: component.to_string(),
        level: level.to_string(),
        pod: pod.map(str::to_string),
        message: message.to_string(),
        detail,
    };
    if let Err(error) = crate::kafka::enqueue_json(producer, LOG_TOPIC, component, &event) {
        tracing::warn!(%error, "could not enqueue log event");
    }
}
