# Flora backend architecture

Flora Leaf runs a Python 3 / FastAPI service and PostgreSQL. PostgreSQL is the
only clinical system of record. The browser UI and Electron shell use the same
HTTP API; Electron does not launch a second application server or own a database.

## Service boundary

`services/flora-api/app/main.py` selects one mode with `FLORA_API_MODE`:

| Mode | Duty | Database role |
| --- | --- | --- |
| `leaf` | Read/write clinical workstation API and Vector minute ingestion | `flora_app` |
| `canopy` | Read-only fleet and case viewer | `flora_view` |
| `sync` | Authenticated, idempotent Leaf snapshot ingestion | `flora_sync` |

Leaf clinical write routes are enabled with `FLORA_LEAF_WRITE_API=true`. Every
write resolves a server-side session actor, validates case state, executes in a
database transaction, and writes the appropriate audit record.

## Leaf API duties

### Authentication and authorization

`routes/auth_leaf.py` verifies scrypt password hashes, issues opaque session
tokens, stores only their SHA-256 hashes, expires/revokes sessions, persists user
theme preferences, supports password changes, and exposes administrator account
activation and reset operations. Clients send `X-FLORA-Session` or a bearer token.

### Case lifecycle

`routes/cases_lifecycle.py` checks time overlap, starts cases, creates default
output rows, discharges a case, calculates/stops active drips transactionally,
archives discharged cases, adjusts start/end time, and suggests a corrected case
end from actual clinical activity. PostgreSQL row locks protect concurrent starts.

### Clinical charting

`routes/clinical_write.py` owns patient/demographic edits, form drafts,
diagnoses, procedures, allergies, clinical events, and manual timeline overrides.
It enforces active/discharged/archive rules and records clinical or timeline audit
rows in the same transaction as the change.

### Medication and I/O

`routes/catalog_write.py` owns ICD lookup, staff directory/assignment, and the
medication/fluid/output master catalog. `routes/io_write.py` owns bolus events,
drip runs and segments, blood-product volume entries, edits, deletion, and
discontinuation. Balance flags and all changes are auditable.

### Read model

`routes/cases_read.py` provides case status/history, vitals, effective timeline,
events, patient and clinical context, staff, medication/I/O rows and calculated
balance summaries. Leaf and Canopy reuse these projections with different roles.

### Device ingestion

`device_writer.py` discovers active cases from PostgreSQL, reads completed minute
windows from Vector, normalizes device parameter aliases and gas units, and
upserts minute payloads into `vital_minutes`. Every successful, empty, or failed
read is recorded in `case_device_ingest_audit`. Writer status and manual refetch
are exposed by `routes/device_writer.py`.

### EPHIS import

`routes/ephis.py` validates the daily TSV format, parses dates, performs a
transactional replace or upsert, and provides import status, daily summary and
case list endpoints.

### Leaf-to-Canopy sync

`services/flora-sync-worker` reads Leaf PostgreSQL and sends stable, idempotent
messages to `FLORA_CANOPY_SYNC_URL`. `routes/sync_ingest.py` authenticates the
shared sync credential and stores central snapshots. Canopy never calls a Leaf
database and never exposes clinical mutation routes.

## Transaction and audit rules

- No clinical write is split across multiple independent commits.
- Archived cases reject clinical mutation.
- Case lifecycle, I/O, manual timeline, and clinical context changes retain actor
  and before/after evidence.
- Blank device values remain blank; they are not converted to zero.
- IDs are PostgreSQL sequences and all foreign keys remain enforced.
- The Canopy database account has read-only access to viewer data.

## Runtime ports

| Endpoint | Port |
| --- | ---: |
| Leaf UI | 6890 |
| PostgreSQL (loopback development binding) | 6892 |
| Leaf FastAPI | 6893 |
| Canopy UI | 6894 |
| Canopy API | 6895 |
| Sync API | 6896 |
| Vector observation API | 6789 by default; configurable |

## Important environment variables

| Variable | Meaning |
| --- | --- |
| `FLORA_DATABASE_URL` | PostgreSQL connection for the selected API mode |
| `FLORA_API_MODE` | `leaf`, `canopy`, or `sync` |
| `FLORA_LEAF_WRITE_API` | Enables Leaf mutation contracts |
| `VECTOR_READ_URL` | Vector observation endpoint used by the minute writer |
| `FLORA_DEVICE_INGEST_ENABLED` | Enables/disables device ingestion |
| `HIS_GATEWAY_BASE_URL` | Hospital integration gateway root |
| `FLORA_CANOPY_SYNC_URL` | Central sync endpoint used by the Leaf worker |
| `FLORA_SYNC_SECRET` | Leaf/Canopy transport credential |

## Deployment

Docker Compose starts each concern as an independent service. The Leaf web
container proxies `/api` and `/health` only to `flora-leaf-api`. The API is healthy
only when PostgreSQL accepts a query. Persistent clinical state lives solely in
the PostgreSQL volume and must be backed up with `pg_dump` or the hospital's
managed PostgreSQL backup policy.
