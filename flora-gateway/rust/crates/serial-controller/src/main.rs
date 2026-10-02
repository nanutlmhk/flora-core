//! Ingress: RS-232 ports → `gw.raw.serial.<id>`, and `gw.cmd.serial.<id>` → port.
//!
//! One task per port owns both directions. Frames are cut on line silence
//! (`idle_ms`); protocol framing is left to the parser.

use std::collections::HashMap;
use std::time::Duration;

use anyhow::{bail, Result};
use gateway_core::admin::{self, StatusMap};
use gateway_core::config::{FlowControlMode, GatewayConfig, SerialPod};
use gateway_core::envelope::{pod_key, raw_topic, Command, RawFrame};
use gateway_core::{commands, kafka, telemetry};
use rdkafka::producer::FutureProducer;
use serde_json::{json, Map};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio_serial::{DataBits, FlowControl, Parity, SerialPort, SerialPortBuilderExt, SerialStream, StopBits};

const COMPONENT: &str = "serial-controller";

#[tokio::main]
async fn main() -> Result<()> {
    telemetry::init();
    let config = GatewayConfig::load()?;
    let producer = kafka::producer(&config.kafka.brokers)?;
    let status = admin::status_map();
    let mut senders = HashMap::new();
    for pod in config.serial.pods.clone() {
        if !pod.enabled { continue; }
        let key = pod_key("serial", &pod.id);
        admin::register(&status, &key, json!({ "path": pod.path, "baud": pod.baud }));
        let (sender, receiver) = mpsc::channel::<Command>(64);
        senders.insert(key.clone(), sender);
        tokio::spawn(run_pod(pod, key, config.gateway_id.clone(), producer.clone(), status.clone(), receiver));
    }
    tracing::info!(pods = senders.len(), "serial controller started");
    tokio::spawn(commands::route(config.kafka.brokers.clone(), "gw-serial-controller".into(), senders));
    admin::serve(COMPONENT, config.serial.admin_port, status).await
}

async fn run_pod(pod: SerialPod, key: String, gateway_id: String, producer: FutureProducer, status: StatusMap, mut commands: mpsc::Receiver<Command>) {
    let mut seq = 0u64;
    loop {
        match open(&pod) {
            Ok(stream) => {
                tracing::info!(pod = key, path = pod.path, "serial port open");
                admin::set_connected(&status, &key, true, None);
                telemetry::emit(&producer, COMPONENT, "info", Some(&key), "serial port open", json!({ "path": pod.path }));
                let event = RawFrame::from_bytes(&key, "serial", &gateway_id, seq, &[],
                    serde_json::from_value(json!({"event": "connected"})).unwrap());
                if let Err(error) = kafka::enqueue_json(&producer, &raw_topic(&key), &key, &event) {
                    tracing::warn!(%error, "serial connection event could not be queued");
                }
                seq += 1;
                let error = session(&pod, &key, &gateway_id, &producer, &status, stream, &mut commands, &mut seq).await;
                if let Err(error) = error {
                    tracing::warn!(pod = key, %error, "serial session ended");
                    admin::set_connected(&status, &key, false, Some(error.to_string()));
                    telemetry::emit(&producer, COMPONENT, "warn", Some(&key), "serial session ended", json!({ "error": error.to_string() }));
                }
            }
            Err(error) => {
                admin::set_connected(&status, &key, false, Some(error.to_string()));
                tracing::debug!(pod = key, %error, "serial port unavailable");
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn open(pod: &SerialPod) -> Result<SerialStream> {
    let parity = match pod.parity.to_ascii_lowercase().as_str() {
        "even" => Parity::Even,
        "odd" => Parity::Odd,
        "none" => Parity::None,
        _ => bail!("parity must be none, even, or odd"),
    };
    let data_bits = match pod.data_bits { 7 => DataBits::Seven, 8 => DataBits::Eight, _ => bail!("data_bits must be 7 or 8") };
    let stop_bits = match pod.stop_bits { 1 => StopBits::One, 2 => StopBits::Two, _ => bail!("stop_bits must be 1 or 2") };
    anyhow::ensure!(pod.baud > 0 && pod.idle_ms > 0 && pod.max_frame_bytes > 0, "serial baud, idle_ms and max_frame_bytes must be positive");
    let flow_control = match pod.flow_control {
        FlowControlMode::None => FlowControl::None,
        FlowControlMode::Hardware => FlowControl::Hardware,
        FlowControlMode::Software => FlowControl::Software,
    };
    let mut stream = tokio_serial::new(&pod.path, pod.baud)
        .parity(parity)
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .flow_control(flow_control)
        .open_native_async()?;
    if let Some(value) = pod.rts { stream.write_request_to_send(value)?; }
    if let Some(value) = pod.dtr { stream.write_data_terminal_ready(value)?; }
    Ok(stream)
}

#[allow(clippy::too_many_arguments)]
async fn session(
    pod: &SerialPod,
    key: &str,
    gateway_id: &str,
    producer: &FutureProducer,
    status: &StatusMap,
    mut stream: SerialStream,
    commands: &mut mpsc::Receiver<Command>,
    seq: &mut u64,
) -> Result<()> {
    let topic = raw_topic(key);
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    loop {
        tokio::select! {
            read = stream.read(&mut chunk) => {
                let count = read?;
                if count == 0 {
                    bail!("serial port closed");
                }
                buffer.extend_from_slice(&chunk[..count]);
                if buffer.len() >= pod.max_frame_bytes {
                    flush(key, gateway_id, &topic, producer, status, &mut buffer, seq)?;
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(pod.idle_ms)), if !buffer.is_empty() => {
                flush(key, gateway_id, &topic, producer, status, &mut buffer, seq)?;
            }
            command = commands.recv() => {
                let Some(command) = command else { bail!("command channel closed") };
                stream.write_all(&command.bytes()?).await?;
                stream.flush().await?;
            }
        }
    }
}

fn flush(key: &str, gateway_id: &str, topic: &str, producer: &FutureProducer, status: &StatusMap, buffer: &mut Vec<u8>, seq: &mut u64) -> Result<()> {
    let frame = RawFrame::from_bytes(key, "serial", gateway_id, *seq, buffer, Map::new());
    kafka::enqueue_json(producer, topic, key, &frame)?;
    admin::record_frame(status, key, buffer.len());
    *seq += 1;
    buffer.clear();
    Ok(())
}
