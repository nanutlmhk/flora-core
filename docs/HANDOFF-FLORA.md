# FLORA Handoff

## Purpose

FLORA is the newer local-first anesthesia information and documentation system. It supports case management, patient data, timeline charting, forms, staff, diagnosis/procedure, medication and fluid documentation, blood products, and report generation.

## Architecture

- `Electron`: Windows desktop shell and packaging.
- `React + TypeScript + Vite`: user interface.
- `Node.js + Express`: local backend APIs and workflow logic.
- `SQLite + better-sqlite3`: local case database.
- `Hidro`: separate device-integration middleware.

The local OR workstation is the foundation. Network services, HIS integration, central synchronization, remote view, and network printing are extension layers.

## Repository Entry Points

- `frontend/src/views/CaseView.tsx`
- `frontend/src/views/PatientView.tsx`
- `frontend/src/views/FormView.tsx`
- `frontend/src/views/DrugView.tsx`
- `frontend/src/views/ReportView.tsx`
- `backend/server.js`
- `backend/caseRoutes.js`
- `backend/floradb.js`
- `backend/minuteWriter.js`
- `electron/main.cjs`
- `electron/reportPdf.cjs`
- `docs/RELEASE_NOTES.md`

## Data Model

The central organizing unit is the anesthesia case. Important domains include:

- cases and patient snapshots
- timeline minutes, events, and notes
- staff directory, authentication, and case staff
- forms, diagnosis, procedure, and allergy
- medication, fluid, output, and blood product records
- HIS cache and master data

The database diagram is [FLORA-Database-Diagram.mmd](./FLORA-Database-Diagram.mmd).

## Deployment

Typical packaged database path:

```text
C:\porjai\data\flora.db
```

New-client deployment and existing-client upgrade are different operations. Existing client databases require backup, schema compatibility checks, migration validation, and staff/auth/master-data verification.

## Clinical and Technical Boundaries

- FLORA owns case workflow and clinical documentation.
- Hidro owns device connectivity and normalized observations.
- Hospital gateways own hospital-specific API access and credentials.
- Hospital IT owns network, VM, firewall, printer, and access policy unless separately agreed.

## Known Sensitive Areas

- minute writer and previous/new-case time overlap
- drip and medication rate-change workflow
- report event and chart output
- staff/auth synchronization and duplicate identities
- HIS gateway behavior
- room-specific USB/serial deployment behavior
- packaged startup and local backend recovery

## First Tasks For A New Developer

1. Read `README.md`, this document, and `docs/RELEASE_NOTES.md`.
2. Run FLORA against a known test database.
3. Trace one case from patient entry through report generation.
4. Trace one Hidro observation into the FLORA timeline.
5. Read the SQLite schema before changing workflow or migrations.
6. Reproduce any client issue with logs and environment details before refactoring.
