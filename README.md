# Flora Core

Flora Core is a hybrid perioperative platform for live operating-room
documentation, device observations, medication and I/O charting, clinical forms,
case review, and reporting. The same React UI runs in a browser or in the optional
Electron workstation shell.

## Products

- **Flora Leaf** is the write-capable perioperative workstation. Its Python API
  owns case workflow and stores all clinical state in its local PostgreSQL service.
- **Flora Canopy** is the central read-only viewer. Authenticated Leaf workers send
  idempotent case snapshots to the central PostgreSQL service.

Leaves do not expose database credentials to Canopy or other Leaves. Cross-site
review goes through the Canopy API.

## Runtime architecture

| Service | Responsibility | Development port |
| --- | --- | ---: |
| `flora-leaf` | React/Vite Leaf UI | 6890 |
| `postgres` | PostgreSQL clinical system of record | 6892 |
| `flora-leaf-api` | Python 3 / FastAPI clinical and integration API | 6893 |
| `flora-canopy` | React/Vite central viewer | 6894 |
| `flora-canopy-api` | Python/FastAPI read-only viewer API | 6895 |
| `flora-sync-api` | Authenticated central ingestion API | 6896 |
| `flora-liveagent` | Synthetic Vector-compatible device feed for demos | 6897 |
| `flora-leaf-sync` | Incremental Leaf-to-Canopy publisher | internal |

The Leaf UI, Electron shell, device writer, and sync worker all use the FastAPI
contract. PostgreSQL is the only clinical database used by the running product.

See [backend responsibilities](docs/BACKEND-ARCHITECTURE.md),
[API inventory](docs/BACKEND-API-INVENTORY.md), and
[PostgreSQL structure](docs/POSTGRESQL-STRUCTURE.md). User roles and API
permissions are documented in [access control](docs/ACCESS-CONTROL.md).

## Run Flora Leaf

```powershell
Copy-Item .env.example .env
docker compose -f compose.dev.yaml up -d --build
```

Open <http://localhost:6890>. The native API documentation is available at
<http://localhost:6893/docs>. The development stack also starts the synthetic
LiveAgent feed on <http://localhost:6897>; its `/health` response identifies it
as `synthetic-demo-only`. Replace `VECTOR_READ_URL` with the real Vector endpoint
for a device-connected deployment.

Load the redistributable clinical terminology baseline once for a new database:

```powershell
python scripts/import-terminology.py public-baseline --database-url postgresql://flora_app:flora-app-local-only@127.0.0.1:6892/flora
python scripts/map-existing-clinical-standards.py --database-url postgresql://flora_app:flora-app-local-only@127.0.0.1:6892/flora
```

This installs the versioned WHO ICD-10 2019 diagnosis catalog, CMS ICD-9-CM
Volume 3 procedure catalog and UCUM 2.2 units, materializes every ICD entry as
an editable Flora Diagnosis or Procedure master using the ICD display as its
initial local name, then maps existing local masters
to verified LOINC, RxNorm, ATC, SNOMED CT and UCUM concepts. See [clinical terminology](docs/CLINICAL-TERMINOLOGY.md)
for licensed SNOMED CT and hospital-supplied ICD-10-TM imports.

Canopy can be started separately when required:

```powershell
docker compose -f compose.dev.yaml --profile canopy up -d --build
```

## Data flow

```text
Vector or demo LiveAgent observations ─┐
Clinical entry ───────┼→ Leaf FastAPI → Leaf PostgreSQL → sync worker
HIS integration ──────┘                                  ↓
                              Canopy sync API → Canopy PostgreSQL → viewer
```

## Validation

```powershell
# Python syntax
docker exec flora-core-flora-leaf-api-1 python -m compileall -q /app/app

# Frontend type-check and production bundle
docker exec flora-core-flora-leaf-1 npm run build

# Service health
Invoke-RestMethod http://localhost:6893/health
```

Destructive write tests are isolated to a dedicated database whose name ends in
`_test`; they never run against the Leaf clinical database.

## Repository layout

- `frontend/` — shared Leaf and Canopy React/Vite UI
- `services/flora-api/` — Python/FastAPI Leaf, Canopy, and sync APIs
- `services/flora-liveagent/` — synthetic Vector-compatible demo observation service
- `services/flora-sync-worker/` — Leaf-to-Canopy publisher
- `infrastructure/postgres/` — PostgreSQL roles, schema hardening, and indexes
- `compose/` — service-specific Docker Compose definitions
- `electron/` — optional desktop shell and PDF integration
- `docs/` — architecture, database, release, and integration documentation

## Electron

Electron is a display shell, not a clinical backend. It connects to the same
FastAPI endpoint as the browser UI. Set `FLORA_API_BASE_URL` when the API does not
run at `http://127.0.0.1:6893`.

```powershell
npm run desktop:build:web
npm run desktop:package:win
```
