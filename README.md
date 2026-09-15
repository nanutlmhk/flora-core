# Flora Core

Flora Core is a hybrid perioperative platform for operating-room documentation,
device observations, medications and I/O, clinical forms, case review, and
reporting. It supports browser access and an optional Electron workstation shell.

## Products

- **Flora Leaf** is the local perioperative workstation. It owns clinical entry,
  local device connectivity, and offline operation.
- **Flora Canopy** is the central read-only viewer. It receives authenticated,
  idempotent updates from multiple Leaves and presents hospital-wide active cases.

Leaves never expose their databases directly to Canopy or to another Leaf.
Cross-workstation review goes through the central Canopy API.

## Architecture

| Service | Responsibility | Development port |
| --- | --- | ---: |
| `flora-leaf` | Write-capable React/Vite workstation UI | 6890 |
| `backend` | Temporary Node compatibility API during cutover | 6891 |
| `postgres` | PostgreSQL clinical database | 6892 |
| `flora-leaf-api` | Python/FastAPI clinical API | 6893 |
| `flora-canopy` | Read-only React/Vite central viewer | 6894 |
| `flora-canopy-api` | Python/FastAPI viewer API using `flora_view` | 6895 |
| `flora-sync-api` | Private authenticated Leaf ingestion API | 6896 |
| `flora-leaf-sync` | Incremental Leaf-to-Canopy publisher | internal |

PostgreSQL is the target clinical system of record. The repository is currently in
a controlled cutover: the legacy Node/SQLite runtime still handles remaining write
contracts, while `flora-db-bridge` mirrors its live state transactionally into
PostgreSQL. Node/SQLite is compatibility infrastructure, not the target backend.

See [the replatform plan](docs/FLORA-REPLATFORM-PLAN.md) for migration boundaries,
safety gates, and the remaining cutover sequence.

## Run with Docker

Create a local environment file and replace every placeholder secret:

```powershell
Copy-Item .env.example .env
```

Run Flora Leaf and its supporting services:

```powershell
docker compose -f compose.dev.yaml up -d --build
```

Open <http://localhost:6890>.

Start the Canopy viewer as well:

```powershell
docker compose -f compose.dev.yaml --profile canopy up -d --build
```

Open <http://localhost:6894>. Canopy automatically refreshes its Leaf fleet and
active-case overview. The development stack is intended for a trusted local
network; production deployment requires unique credentials, TLS, and hospital
network controls.

Stop the stack without deleting its volumes:

```powershell
docker compose -f compose.dev.yaml --profile canopy down
```

## Data flow

```text
Clinical workstation
  Flora Leaf → local PostgreSQL → signed sync worker
                                      ↓
Central server
  sync API → central PostgreSQL → read-only Canopy API → Flora Canopy
```

During the current transition, the temporary local path is:

```text
Leaf UI → Node/SQLite writes → transaction-safe DB bridge → PostgreSQL/Python API
```

Synchronization uses stable Leaf, hospital, message, and global case identifiers.
Repeated delivery is safe. Canopy has no clinical mutation endpoints and its
database role has SELECT-only access.

## Validation

Validate the SQLite-to-PostgreSQL migration, constraints, sequences, and database
roles:

```powershell
docker compose -f compose.dev.yaml --profile migration run --rm migration-validator
```

Compare migrated Python read contracts with the compatibility API:

```powershell
docker compose -f compose.dev.yaml --profile validation run --rm api-contract-validator
```

Build-check the frontend:

```powershell
docker exec flora-core-flora-leaf-1 npm run build
```

## Repository layout

- `frontend/` — shared Leaf and Canopy React/Vite UI
- `services/flora-api/` — Python/FastAPI Leaf, Canopy, and sync API code
- `services/flora-sync-worker/` — Leaf-to-Canopy publisher
- `services/flora-db-bridge/` — temporary SQLite-to-PostgreSQL cutover bridge
- `infrastructure/postgres/` — roles, constraints, indexes, and sync schema
- `compose/` — service-specific Docker Compose definitions
- `backend/` — temporary Node/SQLite compatibility runtime
- `electron/` — optional desktop host and packaging integration
- `shared/` — shared parameter mapping and integration constants
- `docs/` — architecture, migration, release, and integration documentation

## Electron packaging

Electron remains an optional deployment shell for Flora Leaf. Browser development
does not require rebuilding it.

```powershell
npm run desktop:build:web
npm run desktop:package:win
```

Generated installers, runtime databases, hospital exports, and local environment
files are intentionally excluded from Git.
