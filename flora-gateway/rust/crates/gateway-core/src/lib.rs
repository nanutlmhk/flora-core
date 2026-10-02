//! Shared building blocks for every Flora Gateway Rust component: configuration,
//! Kafka wire envelopes, Kafka helpers, the admin/status HTTP endpoint and logging.

pub mod admin;
pub mod commands;
pub mod config;
pub mod envelope;
pub mod kafka;
pub mod telemetry;

use std::time::{SystemTime, UNIX_EPOCH};

/// Wall-clock milliseconds since the Unix epoch, the timestamp unit used across Flora.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0)
}
