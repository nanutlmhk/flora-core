# Flora Gateway

Low-level hardware integration for one bedside/OR network. Devices speak their
own protocols to the gateway; Leaf pulls clean, normalized observations from the
gateway's `data-api`.

```
                 INGRESS (Rust)                PROCESS (Python)                EGRESS (Rust)
RS-232 COMx ─▶ serial-controller  ─┐                                    ┌─▶ collector ─▶ Postgres ─▶ server ─▶ Kong data-api ─▶ Leaf (pull)
HTTP poll   ◀─ feeder-controller  ─┤   gw.raw.<pod>   device-medical-    │
HTTP POST   ─▶ webhook-controller ─┼─▶ Kafka ───────▶ service, one   ──▶ Kafka gw.obs ─┼─▶ publisher ─▶ pod:uri (push)
HL7/TCP     ─▶ socket-controller  ─┘   ◀── gw.cmd.<pod> container per        │
                                         (poll, ACK,   device instance       └─▶ gw.logs ─▶ collector ─▶ Logs
                                          settings)
        gateway-service (Python web): manage devices, restart containers, license from Haber at Canopy
```

## Layout

| Path | What |
| --- | --- |
| `rust/crates/gateway-core` | Config (`gateway.toml`), Kafka envelopes, Kafka helpers, admin `/status` endpoint |
| `rust/crates/serial-controller` | RS-232 ports; reads frames on line silence, writes commands back |
| `rust/crates/feeder-controller` | Polls device/vendor HTTP endpoints |
| `rust/crates/webhook-controller` | One listening port per pod for device/vendor pushes |
| `rust/crates/socket-controller` | TCP listeners; MLLP / line / idle framing; automatic HL7 ACK |
| `rust/crates/collector` | `gw.obs` + `gw.logs` → Postgres in batches (commit after store) |
| `rust/crates/server` | Vector-compatible read API (`/api/observations`, `/api/devices/status`) |
| `rust/crates/publisher` | Pushes observations to HTTP receivers |
| `python/device-medical-service` | Parser runtime + parsers (`hl7v2`, `json_fields`, `ascii_kv`) |
| `python/gateway-service` | Control plane web app (port 7400) |
| `python/device-simulator` | Synthetic devices for the demo |
| `config/gateway.toml` | Every pod of every controller |
| `config/instances.json` | Device instances seeded on first start |
| `kong/kong.yaml` | `data-api` routes, one per Leaf |
| `db/0001-gateway.sql` | Gateway store |

## Kafka topics

| Topic | Producer → consumer | Payload |
| --- | --- | --- |
| `gw.raw.<pod>` | controller → parser | `RawFrame`: pod, seq, ts, `utf8`/`base64` payload, meta |
| `gw.cmd.<pod>` | parser or gateway-service → controller | `Command`: bytes to write to the device |
| `gw.obs` | parser → collector, publisher | `Observation` (Vector row shape; `ivy_param` = Flora parameter key) |
| `gw.logs` | any component → collector | `LogEvent` |

A pod is `<controller>.<id>`, for example `serial.COM1`, `socket.or-monitor`.

## How Leaf connects

Leaf already reads a Vector-compatible endpoint, so no Leaf change is needed:

```
VECTOR_READ_URL=http://<gateway-host>:7410/data-api/<leaf-id>/api/observations
```

Kong adds `leaf_id` for that route, so a Leaf only sees devices assigned to it.

## Add a device

1. The device type must exist in Haber's catalog (`flora-canopy/haber/app/catalog.json`)
   and be licensed by Root.
2. Add a pod for it in `config/gateway.toml` (or `PUT /api/config/<section>`), which restarts that controller.
3. Create the instance:

```bash
curl -X POST localhost:7400/api/instances -H 'content-type: application/json' -d '{"device_id":"or2-monitor-01","device_type":"hl7-patient-monitor","pod":"socket.or2-monitor","leaf_id":"leaf-or-02"}'
```

Add a Kong route for a new Leaf in `kong/kong.yaml`.

## Add a parser

Subclass `Parser` in `python/device-medical-service/device_medical_service/parsers/`,
register it in `parsers/__init__.py`, add a test, and reference it from a device type.

```bash
cd python/device-medical-service && python -m pytest
cd rust && cargo test
```

## Production notes

- **Serial on Windows workstations.** Docker Desktop cannot pass COM ports into
  containers. Run `serial-controller` natively (`cargo build --release`), with
  `FLORA_KAFKA_BROKERS=localhost:7414` and `path = "COM1"` in `gateway.toml`.
  On Linux, map the device into the container (`devices:` in compose).
- **Kafka footprint.** Single-node Kafka needs about 0.5–1 GB RAM. If that's too much on a
  workstation, Redpanda is wire-compatible and smaller.
- **Retention.** Kafka keeps 72 h. `gateway_observation` has no pruning yet; add a
  daily delete older than the Leaf sync window.
- **License.** Device limits come from Haber; the gateway keeps the last license
  if Canopy is unreachable and stops parsers when it is revoked or expired.
