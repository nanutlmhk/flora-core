# Flora FastAPI inventory

Authorization is enforced by the FastAPI permission dependencies documented in [ACCESS-CONTROL.md](ACCESS-CONTROL.md). Clinical reads require `case.read`; mutations require their corresponding permission rather than relying on frontend menu visibility.

The live, machine-readable contract is `GET /openapi.json`; Swagger UI is
available at `/docs`. On the development Leaf these are
<http://localhost:6893/openapi.json> and <http://localhost:6893/docs>.

## Leaf route groups

| Prefix | Responsibility |
| --- | --- |
| `/health` | API and PostgreSQL readiness |
| `/api/auth/*` | Login, session, preferences and account administration |
| `/api/auth/preferences/options` | Public active language and six-slot theme master data for sign-in |
| `/api/auth/self/preferences` | Persist the signed-in user's display name, language, scheme, chart parameters and report preferences |
| `/api/auth/self/change-password` | Change the signed-in user's password |
| `/api/auth/users/{id}/staff-link` | Admin link between a login account and a clinical staff-directory profile |
| `/api/auth/preferences/master`, `/languages/{code}`, `/themes/{code}` | Admin configuration of language and six-color scheme masters |
| `/api/auth/preferences/translations/{code}` | Public runtime vocabulary read and admin i18n vocabulary update |
| `/api/case/status`, `/api/case/list` | Current/recent case selection |
| `/api/case/start*`, `/discharge`, `/archive` | Case lifecycle, including prepared, HIS, manual and emergency admission sources |
| `/api/case/{id}/patient` | Patient and demographic snapshot |
| `/api/case/{id}/detail-draft` | Clinical form draft |
| `/api/case/{id}/diagnosis*` | Diagnosis charting |
| `/api/case/{id}/procedures*` | Procedure charting |
| `/api/case/{id}/allergies*` | Allergy charting |
| `/api/case/{id}/staff` | Case staff assignment |
| `/api/case/staff/directory`, `/staff/roles` | Staff roles and reusable directory |
| `/api/case/staff/fields*` | Admin-configurable international staff profile fields, including language and name-part metadata |
| `/api/case/{id}/events*` | Clinical event timeline |
| `/api/case/{id}/vitals`, `/timeline*`, `/timeaxis` | Device and manual timeline, including immutable source-reading provenance and correction audit history |
| `/api/case/io/master*` | Medication/fluid/output catalog |
| `/api/case/io/groups*` | Configurable medication, fluid and output groups used by the catalog and live charting workflow |
| `/api/case/{id}/io/*` | Bolus, drip, fluid, blood, output, summary and audit |
| `/api/case/his/*` | HIS lookup and pre-admission buffer |
| `/api/case/{id}/his/*` | HIS-to-case synchronization and blood verification |
| `/api/case/{id}/writer-*` | Vector minute-writer status/refetch |
| `/api/ephis/*` | EPHIS daily import and queries |
| `/api/workstation/context` | Leaf location, timezone, date format and 12/24-hour display settings |
| `/api/config/terminology*` | Local clinical concepts, versioned terminology releases, catalog search/linking, and SNOMED CT, ICD, LOINC, RxNorm, ATC and UCUM mappings |
| `/api/config/terminology/parameters` | Observation parameter master used by the live chart/table; read requires `case.read`, updates require `clinical_master.manage` |

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
