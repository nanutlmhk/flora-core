# Flora Leaf access control

Flora separates login accounts, clinical staff identities and authorization.

- `auth_user` is the login identity and personal preferences.
- `staff_directory` is the clinician identity used in clinical records.
- `auth_user.staff_directory_id` links the two without treating a clinical job title as authority.
- `auth_role`, `auth_permission`, `auth_role_permission` and `auth_user_role` implement role-based access control (RBAC).

## Built-in roles

| Role | Intended use |
| --- | --- |
| System administrator | User access, configuration, clinical workflow, reports and audit |
| Clinical administrator | Clinical workflow and clinical/operational master data |
| Clinician | Admit, chart and discharge cases |
| Viewer / auditor | Read cases and generate reports without clinical mutation |
| Integration service | Non-interactive device and system integration |

Roles are independent of staff roles such as anesthetist or nurse. A staff role describes clinical participation; an authorization role controls application access.

## Permission catalog

| Permission | Protects |
| --- | --- |
| `account.manage` | User creation, activation, staff linking, password reset and role assignment |
| `config.manage` | Workstation, language, date/time and scheme configuration |
| `clinical_master.manage` | Terminology, medication, fluid, blood product and output masters |
| `staff.manage` | Staff profile fields and staff directory |
| `case.read` | Patient and case clinical data |
| `case.create` | Admission, HIS preparation and case start |
| `case.chart` | Patient updates, events, diagnosis, procedure, forms, staff, medication and I/O charting |
| `case.discharge` | Discharge, end-time amendment and archive |
| `report.generate` | Report generation and export |
| `audit.read` | Clinical and security audit review |
| `integration.ingest` | Device and integration ingestion |

FastAPI enforces permissions. Frontend visibility is only a usability layer and is not the security boundary.

The Leaf-to-Canopy worker authenticates to the Leaf API with the server-side `FLORA_LEAF_SERVICE_SECRET`. It is not stored in browser code and receives only `case.read` and `integration.ingest`.

## User lifecycle

1. A system administrator creates an account in **Config → User**.
2. The administrator assigns one or more roles and may link one staff profile.
3. The user signs in with the temporary password.
4. Flora routes the user to Account Settings and blocks protected APIs until the password is changed.
5. Deactivation revokes active sessions. Accounts are retained for authorship and audit history.

Flora prevents a system administrator from removing their own administrator role or deactivating their own account.

## Scope readiness

`auth_user_role` stores `scope_type` and `scope_id`. The initial Leaf release assigns global scope (`global`, `*`). The schema can later support hospital, care-unit and Leaf-specific assignments without replacing the RBAC model.

## API endpoints

- `GET /api/auth/roles`
- `POST /api/auth/users`
- `PUT /api/auth/users/{user_id}/access`
- Existing activation, password-reset and staff-link endpoints require `account.manage`.

Migration: `infrastructure/postgres/0017-rbac.sql`.
