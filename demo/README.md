# Flora platform demo (one machine)

Four separate Docker Compose apps that work together the way they would across a
real deployment. Every patient and device value is synthetic.

```
Flora Root      (cloud)      flora-root/     tenants · signed licenses · global config
 └─ Canopy      (hospital)   flora-canopy/   central DB · sync API · Haber device registry
     ├─ Leaf    (OR-1)       flora-leaf/     Electron/web workstation · local Postgres · sync worker
     ├─ Leaf    (ICU bed 1)  flora-leaf/     second instance of the same app
     └─ Gateway (devices)    flora-gateway/  Rust controllers · Kafka · Python parsers · Kong data-api
```

The apps only talk to each other through published host ports, exactly like
separate machines would. To split them across machines, change the URLs in the
env files (`FLORA_ROOT_URL`, `HABER_URL`, `CANOPY_SYNC_URL`, `LEAF_DEVICE_READ_URL`).

## Run it

```bash
./demo/up.sh        # build + start everything, open a demo case on each Leaf
./demo/status.sh    # health of every tier + device data path
./demo/down.sh      # stop (keeps data);  ./demo/down.sh --reset  wipes demo volumes
```

The first build takes a few minutes (the Rust image compiles inside Docker).
Vitals show up on each Leaf chart within about a minute of the case opening.

## Where to look

| What | URL | Sign in |
| --- | --- | --- |
| Root admin (cloud) | http://localhost:7100 | — (admin API open in demo) |
| Canopy viewer | http://localhost:7200 | `admin` / `admin`, change on first sign-in |
| Canopy Haber | http://localhost:7204 | — |
| Gateway admin | http://localhost:7400 | — (localhost only) |
| Device simulator | http://localhost:7420 | — |
| Leaf OR-1 | http://localhost:7300 | `admin` / `FloraDemo-2026` (set by `seed-cases.py`) |
| Leaf ICU bed 1 | http://localhost:7310 | `admin` / `FloraDemo-2026` |

## What the demo shows

1. **Root → Canopy licensing.** Root signs the hospital's license bundle with
   Ed25519. Haber verifies the signature, caches the bundle and reports usage
   (Leaves, gateways, devices) back to Root. Root's page shows the usage bars.
2. **Canopy → Gateway.** The gateway checks in to Haber, receives the device
   catalog (Device Type, Image) and its share of the device license, then starts
   one parser container per device instance.
3. **Five device paths through the gateway.**

   | Device | Path | Leaf |
   | --- | --- | --- |
   | OR patient monitor | HL7 v2 ORU over MLLP → socket-controller pod `9001` → `hl7v2` parser | OR-1 |
   | OR anesthesia machine | JSON POST → webhook-controller pod `9003` → `json_fields` | OR-1 |
   | OR temp/CVP module | RS-232 (virtual COM port), **polled**: parser sends `?` via `gw.cmd.serial.COM1`, device answers | OR-1 |
   | ICU patient monitor | HL7 v2 over MLLP → socket pod `9002` → `hl7v2` | ICU-1 |
   | ICU ventilator | feeder-controller polls an HTTP endpoint every 5 s → `json_fields` | ICU-1 |

4. **Leaf pulls.** Each Leaf's device writer reads its own Kong route
   (`/data-api/leaf-or-01`, `/data-api/leaf-icu-01`), so each workstation only
   sees its own bedside devices. No Leaf code changed: the gateway's data-api is
   Vector-compatible.
5. **Leaf → Canopy sync.** Each Leaf's sync worker pushes case snapshots to the
   Canopy sync API; both Leaves appear in Canopy and in Haber.
6. **Egress push.** The publisher forwards every observation to the simulator's
   `/receiver` (the `pod:uri` box in the gateway diagram).

### Try the license controls

On the Root page, **Revoke** the hospital's license. Within about 30 s Haber picks
up the revoked bundle, the gateway marks its license invalid and stops every
parser container; Leaf charts stop receiving new vitals. **Edit license** issues
a new bundle and the parsers come back. Lowering *Max gateway devices* below the
running count blocks adding new devices on the gateway.

To speed it up instead of waiting for the sync loops:

```bash
curl -X POST localhost:7204/api/haber/v1/root/sync
curl -X POST localhost:7400/api/haber/sync
curl -X POST localhost:7400/api/instances/reconcile
```

## Port map

Each app owns one block, so everything fits on one machine next to the original
`flora-core` dev stack (68xx/69xx).

| Block | App | Port | Service | Bound to |
| --- | --- | ---: | --- | --- |
| 71xx | flora-root | 7100 | Root API + admin page | all interfaces (Canopy calls it) |
| | | 7102 | root-db (Postgres) | 127.0.0.1 |
| 72xx | flora-canopy | 7200 | Canopy web (Vite) | all |
| | | 7201 | canopy-api | 127.0.0.1 |
| | | 7202 | canopy-db | 127.0.0.1 |
| | | 7203 | sync-api (Leaves push here) | all |
| | | 7204 | Haber (gateways check in here) | all |
| 73xx | flora-leaf `leaf-or-01` | 7300 / 7301 / 7302 | web / API (Electron) / db | web all, rest 127.0.0.1 |
| | flora-leaf `leaf-icu-01` | 7310 / 7311 / 7312 | web / API / db | same |
| | next Leaf | 7320 / 7321 / 7322 | copy an env file | |
| 74xx | flora-gateway | 7400 | gateway-service admin | 127.0.0.1 |
| | | 7401–7406 | serial, feeder, webhook, socket, collector, publisher admin | 127.0.0.1 |
| | | 7410 | Kong `data-api` (Leaf pulls here) | all |
| | | 7412 | gateway-db | 127.0.0.1 |
| | | 7414 | Kafka (host listener) | 127.0.0.1 |
| | | 7420 | device simulator | 127.0.0.1 |
| | | 7421 / 7422 | HL7 MLLP pods (OR / ICU monitor) | all (devices connect) |
| | | 7423 | webhook pod (anesthesia machine) | all |
| | | 7430 | virtual RS-232 bridge (demo only) | 127.0.0.1 |

## Demo-only shortcuts

These keep the demo self-contained; none of them is acceptable at a site.

- Secrets and passwords are fixed demo values in the compose files and
  `flora-leaf/env/*.env`. Replace every `*-demo-*` / `*-local-only` value.
- Root's admin API is open (`ROOT_ADMIN_KEY` empty), and Haber trusts the first
  Root public key it sees (`FLORA_ROOT_PUBLIC_KEY` empty). Set both.
- The gateway service mounts the Docker socket to start parser containers.
- Every app speaks plain HTTP. Put TLS in front of Root, the Canopy sync API,
  Haber and the gateway data-api.
