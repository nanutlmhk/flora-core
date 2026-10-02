//! Ingress: TCP listeners (typically HL7 v2 over MLLP from patient monitors).
//! Each listening port is a pod; every accepted connection is framed, published to
//! `gw.raw.socket.<id>`, and can be written to through `gw.cmd.socket.<id>`.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use gateway_core::admin::{self, StatusMap};
use gateway_core::config::{Framing, GatewayConfig, SocketPod};
use gateway_core::envelope::{pod_key, raw_topic, Command, RawFrame};
use gateway_core::{commands, kafka, telemetry};
use rdkafka::producer::FutureProducer;
use serde_json::{json, Map};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, Mutex};

const COMPONENT: &str = "socket-controller";
const VT: u8 = 0x0b;
const FS: u8 = 0x1c;
const CR: u8 = 0x0d;

type Connections = Arc<Mutex<HashMap<u64, mpsc::Sender<Vec<u8>>>>>;

struct PodContext {
    pod: SocketPod,
    key: String,
    topic: String,
    gateway_id: String,
    producer: FutureProducer,
    status: StatusMap,
    connections: Connections,
    seq: AtomicU64,
    next_connection: AtomicU64,
}

#[tokio::main]
async fn main() -> Result<()> {
    telemetry::init();
    let config = GatewayConfig::load()?;
    let producer = kafka::producer(&config.kafka.brokers)?;
    let status = admin::status_map();
    let mut senders = HashMap::new();
    for pod in config.socket.pods.clone() {
        let key = pod_key("socket", &pod.id);
        admin::register(&status, &key, json!({ "port": pod.port, "framing": pod.framing, "connections": 0 }));
        let context = Arc::new(PodContext {
            topic: raw_topic(&key),
            key: key.clone(),
            gateway_id: config.gateway_id.clone(),
            producer: producer.clone(),
            status: status.clone(),
            connections: Arc::new(Mutex::new(HashMap::new())),
            seq: AtomicU64::new(0),
            next_connection: AtomicU64::new(1),
            pod,
        });
        let (sender, receiver) = mpsc::channel::<Command>(64);
        senders.insert(key, sender);
        tokio::spawn(dispatch_commands(context.clone(), receiver));
        tokio::spawn(async move {
            if let Err(error) = listen(context).await {
                tracing::error!(%error, "socket pod stopped");
            }
        });
    }
    tracing::info!(pods = senders.len(), "socket controller started");
    tokio::spawn(commands::route(config.kafka.brokers.clone(), "gw-socket-controller".into(), senders));
    admin::serve(COMPONENT, config.socket.admin_port, status).await
}

async fn listen(context: Arc<PodContext>) -> Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", context.pod.port)).await?;
    tracing::info!(pod = context.key, port = context.pod.port, "socket pod listening");
    loop {
        let (stream, peer) = listener.accept().await?;
        let id = context.next_connection.fetch_add(1, Ordering::Relaxed);
        let context = context.clone();
        tokio::spawn(async move {
            if let Err(error) = connection(context.clone(), stream, peer, id).await {
                tracing::info!(pod = context.key, %peer, %error, "connection ended");
            }
            context.connections.lock().await.remove(&id);
            refresh_connection_status(&context).await;
            telemetry::emit(&context.producer, COMPONENT, "info", Some(&context.key), "device disconnected", json!({ "peer": peer.to_string(), "connection": id }));
        });
    }
}

async fn refresh_connection_status(context: &PodContext) {
    let count = context.connections.lock().await.len();
    admin::register(&context.status, &context.key, json!({ "port": context.pod.port, "framing": context.pod.framing, "connections": count }));
    admin::set_connected(&context.status, &context.key, count > 0, None);
}

async fn connection(context: Arc<PodContext>, stream: TcpStream, peer: SocketAddr, id: u64) -> Result<()> {
    let (mut reader, mut writer) = stream.into_split();
    let (sender, mut outgoing) = mpsc::channel::<Vec<u8>>(64);
    context.connections.lock().await.insert(id, sender.clone());
    refresh_connection_status(&context).await;
    telemetry::emit(&context.producer, COMPONENT, "info", Some(&context.key), "device connected", json!({ "peer": peer.to_string(), "connection": id }));
    tokio::spawn(async move {
        while let Some(bytes) = outgoing.recv().await {
            if writer.write_all(&bytes).await.is_err() {
                break;
            }
        }
    });

    let pod = &context.pod;
    let idle = Duration::from_millis(pod.idle_ms);
    let mut buffer: Vec<u8> = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];
    loop {
        let read = if pod.framing == Framing::Idle && !buffer.is_empty() {
            match tokio::time::timeout(idle, reader.read(&mut chunk)).await {
                Ok(result) => Some(result?),
                Err(_) => None,
            }
        } else {
            Some(reader.read(&mut chunk).await?)
        };
        match read {
            None => {
                let frame = std::mem::take(&mut buffer);
                publish(&context, &frame, peer, id, &sender).await?;
            }
            Some(0) => return Ok(()),
            Some(count) => {
                buffer.extend_from_slice(&chunk[..count]);
                for frame in extract_frames(pod.framing, &mut buffer, pod.max_frame_bytes) {
                    publish(&context, &frame, peer, id, &sender).await?;
                }
            }
        }
    }
}

async fn publish(context: &PodContext, frame: &[u8], peer: SocketAddr, id: u64, reply: &mpsc::Sender<Vec<u8>>) -> Result<()> {
    if frame.is_empty() {
        return Ok(());
    }
    let mut meta = Map::new();
    meta.insert("peer".into(), json!(peer.to_string()));
    meta.insert("connection".into(), json!(id));
    meta.insert("framing".into(), json!(context.pod.framing));
    let seq = context.seq.fetch_add(1, Ordering::Relaxed);
    let raw = RawFrame::from_bytes(&context.key, "socket", &context.gateway_id, seq, frame, meta);
    kafka::enqueue_json(&context.producer, &context.topic, &context.key, &raw)?;
    admin::record_frame(&context.status, &context.key, frame.len());
    if context.pod.framing == Framing::Mllp && context.pod.auto_ack {
        if let Some(ack) = hl7_ack(frame) {
            let _ = reply.send(ack).await;
        }
    }
    Ok(())
}

/// Delivers a command to one connection (`meta.connection`) or to every open one.
async fn dispatch_commands(context: Arc<PodContext>, mut receiver: mpsc::Receiver<Command>) {
    while let Some(command) = receiver.recv().await {
        let bytes = match command.bytes() {
            Ok(bytes) if context.pod.framing == Framing::Mllp && bytes.first() != Some(&VT) => mllp_wrap(&bytes),
            Ok(bytes) => bytes,
            Err(error) => {
                tracing::warn!(pod = context.key, %error, "invalid command");
                continue;
            }
        };
        let target = command.meta.get("connection").and_then(|value| value.as_u64());
        let connections = context.connections.lock().await;
        for (id, sender) in connections.iter() {
            if target.is_none_or(|wanted| wanted == *id) {
                let _ = sender.send(bytes.clone()).await;
            }
        }
    }
}

fn extract_frames(framing: Framing, buffer: &mut Vec<u8>, max: usize) -> Vec<Vec<u8>> {
    let mut frames = Vec::new();
    match framing {
        Framing::Mllp => loop {
            let Some(start) = buffer.iter().position(|&byte| byte == VT) else {
                buffer.clear();
                break;
            };
            let Some(end) = buffer[start..].windows(2).position(|pair| pair == [FS, CR]).map(|offset| offset + start) else {
                if start > 0 {
                    buffer.drain(..start);
                }
                if buffer.len() > max {
                    buffer.clear();
                }
                break;
            };
            frames.push(buffer[start + 1..end].to_vec());
            buffer.drain(..end + 2);
        },
        Framing::Line => {
            while let Some(position) = buffer.iter().position(|&byte| byte == b'\n') {
                let mut line: Vec<u8> = buffer.drain(..=position).collect();
                while matches!(line.last(), Some(b'\n' | b'\r')) {
                    line.pop();
                }
                frames.push(line);
            }
            if buffer.len() > max {
                frames.push(std::mem::take(buffer));
            }
        }
        Framing::Idle => {
            if buffer.len() >= max {
                frames.push(std::mem::take(buffer));
            }
        }
    }
    frames
}

fn mllp_wrap(message: &[u8]) -> Vec<u8> {
    let mut framed = Vec::with_capacity(message.len() + 3);
    framed.push(VT);
    framed.extend_from_slice(message);
    framed.extend_from_slice(&[FS, CR]);
    framed
}

/// Builds an HL7 v2 `ACK` (MSA|AA) for the message's MSH-10 control id.
fn hl7_ack(message: &[u8]) -> Option<Vec<u8>> {
    let text = String::from_utf8_lossy(message);
    let msh = text.split(['\r', '\n']).find(|segment| segment.starts_with("MSH"))?;
    let separator = msh.chars().nth(3)?;
    let fields: Vec<&str> = msh.split(separator).collect();
    let field = |index: usize| fields.get(index).copied().unwrap_or("");
    let component = field(1).chars().next().unwrap_or('^');
    let trigger = field(8).split(component).nth(1).unwrap_or("");
    let control_id = field(9);
    let timestamp = chrono::Local::now().format("%Y%m%d%H%M%S");
    let s = separator;
    let ack = format!(
        "MSH{s}{enc}{s}{recv_app}{s}{recv_fac}{s}{send_app}{s}{send_fac}{s}{timestamp}{s}{s}ACK{component}{trigger}{s}{control_id}-ACK{s}{processing}{s}{version}\rMSA{s}AA{s}{control_id}\r",
        enc = field(1),
        recv_app = field(4),
        recv_fac = field(5),
        send_app = field(2),
        send_fac = field(3),
        processing = field(10),
        version = field(11),
    );
    Some(mllp_wrap(ack.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mllp_frames_are_split_and_partial_kept() {
        let mut buffer = b"junk\x0bMSH|one\x1c\x0d\x0bMSH|two\x1c\x0d\x0bMSH|par".to_vec();
        let frames = extract_frames(Framing::Mllp, &mut buffer, 1024);
        assert_eq!(frames, vec![b"MSH|one".to_vec(), b"MSH|two".to_vec()]);
        assert_eq!(buffer, b"\x0bMSH|par".to_vec());
    }

    #[test]
    fn ack_swaps_sender_and_receiver() {
        let message = b"MSH|^~\\&|MON|OR1|FLORA|GW|20260101000000||ORU^R01|MSG42|P|2.5\rPID|1\r";
        let ack = String::from_utf8(hl7_ack(message).unwrap()).unwrap();
        assert!(ack.contains("|FLORA|GW|MON|OR1|"));
        assert!(ack.contains("ACK^R01|MSG42-ACK|P|2.5"));
        assert!(ack.contains("MSA|AA|MSG42"));
    }

    #[test]
    fn lines_strip_crlf() {
        let mut buffer = b"HR=72\r\nSPO2=98\npart".to_vec();
        let frames = extract_frames(Framing::Line, &mut buffer, 1024);
        assert_eq!(frames, vec![b"HR=72".to_vec(), b"SPO2=98".to_vec()]);
        assert_eq!(buffer, b"part".to_vec());
    }
}
