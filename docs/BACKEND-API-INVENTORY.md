# Flora FastAPI inventory

The live, machine-readable contract is `GET /openapi.json`; Swagger UI is
available at `/docs`. On the development Leaf these are
<http://localhost:6893/openapi.json> and <http://localhost:6893/docs>.

## Leaf route groups

| Prefix | Responsibility |
| --- | --- |
| `/health` | API and PostgreSQL readiness |
| `/api/auth/*` | Login, session, preferences and account administration |
| `/api/case/status`, `/api/case/list` | Current/recent case selection |
| `/api/case/start*`, `/discharge`, `/archive` | Case lifecycle |
| `/api/case/{id}/patient` | Patient and demographic snapshot |
| `/api/case/{id}/detail-draft` | Clinical form draft |
| `/api/case/{id}/diagnosis*` | Diagnosis charting |
| `/api/case/{id}/procedures*` | Procedure charting |
| `/api/case/{id}/allergies*` | Allergy charting |
| `/api/case/{id}/staff` | Case staff assignment |
| `/api/case/staff/*` | Staff roles and directory |
| `/api/case/{id}/events*` | Clinical event timeline |
| `/api/case/{id}/vitals`, `/timeline*`, `/timeaxis` | Device and manual timeline |
| `/api/case/io/master*` | Medication/fluid/output catalog |
| `/api/case/{id}/io/*` | Bolus, drip, fluid, blood, output, summary and audit |
| `/api/case/his/*` | HIS lookup and pre-admission buffer |
| `/api/case/{id}/his/*` | HIS-to-case synchronization and blood verification |
| `/api/case/{id}/writer-*` | Vector minute-writer status/refetch |
| `/api/ephis/*` | EPHIS daily import and queries |

## Canopy and sync groups

| Prefix | Responsibility |
| --- | --- |
| `/api/fleet/*` | Leaves, active cases and read-only snapshots |
| `/api/sync/v1/*` | Authenticated idempotent snapshot ingestion/fingerprint |

## Authentication

Leaf login returns an opaque `session_token`. Clients send it as
`X-FLORA-Session` or `Authorization: Bearer`. Mutating clinical routes require a
valid active session. Canopy user tokens and Leaf-to-Canopy sync credentials are
separate security domains.

## Response rules

- Times are epoch milliseconds unless a named external import uses an ISO date.
- List responses normally use `rows`.
- Application errors use `{"error":"message"}`.
- Missing values remain `null`; they are not converted to zero.
- OpenAPI validation failures use FastAPI's standard HTTP 422 body.
