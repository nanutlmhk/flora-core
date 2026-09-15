# Flora Replatform Plan

## Target services

| Service | Responsibility | Data access |
| --- | --- | --- |
| `flora-leaf` | Standalone perioperative documentation and orchestration | Local read/write |
| `flora-canopy` | Central-server clinical review from remote areas | Server read-only |
| `flora-api` | Python API, authentication, audit, reports and workflows | PostgreSQL |
| `vector` | Device connectivity, normalization and authenticated delivery | Outbound ingest API |
| `postgres` | Durable clinical system of record | Private network only |

Electron remains an optional host client for `flora-leaf`; both surfaces share the
same UI packages but are deployed independently in Docker.

## Leaf and Canopy boundary

- `flora-leaf` runs at the clinical workstation, owns local device ingestion and
  perioperative writes, and remains usable when the central network is unavailable.
- `flora-canopy` runs centrally for remote review. Its API uses the `flora_view`
  PostgreSQL role, which has `SELECT` only, and rejects clinical mutation methods.
- Canopy authentication uses signed, expiring sessions and does not need database
  writes. Production deployments must provide a unique `FLORA_CANOPY_SESSION_SECRET`.
- Leaf publishes signed, idempotent case snapshots through `flora-leaf-sync` and
  the dedicated `flora-sync-api`; Canopy never connects directly to a workstation
  database across the hospital network.

Development ports are `6890` for Leaf, `6891` for the compatibility Node API,
`6892` for PostgreSQL, `6893` for the Leaf Python API, `6894` for Canopy, and
`6895` for the Canopy Python API, and `6896` for the private synchronization API.

## Leaf-to-Canopy synchronization

- Every Leaf has stable `FLORA_LEAF_ID` and `FLORA_HOSPITAL_ID` identities.
- The sync API is authenticated with `FLORA_SYNC_SHARED_SECRET` and writes using
  the restricted `flora_sync` database role.
- Delivery is idempotent by `(leaf_id, message_id)`, so network retries do not
  duplicate clinical snapshots.
- Canopy's `/api/fleet/leaves` reports online, delayed, and offline Leaf state.
- `/api/fleet/active-cases` lists active cases across all synchronized Leaves.
- `/api/fleet/cases/{global_case_id}/snapshot` returns a synchronized case using
  its globally stable UUID rather than a workstation-local numeric ID.

The initial clinical snapshot contains patient context, allergy, diagnosis,
procedure, staff, vitals, events, effective timeline values, and I/O for the
latest 24-hour viewer window. Forms and a durable row-level outbox are the next
synchronization increment.

## Migration order

1. Create the PostgreSQL baseline and migrate all 33 SQLite tables with row-count and relationship verification.
2. Implement the Python API against PostgreSQL while preserving the current HTTP contract.
3. Cut `flora-leaf` over endpoint-by-endpoint, then expose the shared viewer packages through read-only `flora-canopy`.
4. Replace Hidro with Vector using authenticated outbound delivery, idempotent observation batches and device/source audit.
5. Maintain one Compose file per service and an integration Compose entrypoint for local, test and deployment profiles.

## Safety gates

- SQLite remains read-only fallback until PostgreSQL parity checks pass.
- The frontend API contract is frozen during the backend rewrite.
- Every clinical write carries installation, user, patient/case, source and audit context.
- `flora-canopy` receives no clinical mutation endpoints or write-capable credentials.
- Vector retries use stable observation identifiers so reconnects cannot duplicate chart data.

## Layer 1 migration tools

The legacy backend remains on SQLite during the compatibility period. A consistent
SQLite snapshot named `flora-postgres-migration.db` is stored in `flora_dev_data`.

Run the containerized import, PostgreSQL repair, and parity check in order:

```powershell
docker compose -f compose.dev.yaml --profile migration run --rm sqlite-pgloader
docker compose -f compose.dev.yaml --profile migration run --rm postgres-post-import
docker compose -f compose.dev.yaml --profile migration run --rm migration-validator
```

The validator requires all 33 tables and their row counts to match, all primary and
foreign keys plus 24 clinical `CHECK` constraints to validate, every generated-ID
sequence to be ahead of imported data, and `flora_app` to have the required table
and sequence privileges. Never point the importer at the
live PostgreSQL database twice; use a fresh target database for a rehearsal or a
new snapshot for the controlled final cutover.

During the live-write transition, `flora-db-bridge` performs a transaction-safe,
non-destructive SQLite-to-PostgreSQL upsert every 10 seconds. It reads SQLite in
query-only mode, applies parent tables before dependants, advances PostgreSQL
sequences, and commits only when all 33 clinical table row counts match. This is a
temporary cutover safety mechanism; it is removed after every Leaf write endpoint
has moved to the Python/PostgreSQL API.

During the Python rewrite, verify each migrated read contract against the legacy
Node API using stable discharged/archived cases:

```powershell
docker compose -f compose.dev.yaml --profile validation run --rm api-contract-validator
```
