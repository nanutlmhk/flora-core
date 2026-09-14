# FLORA / HIDRO Handoff Guide

> For the complete successor-facing engineering, deployment, configuration,
> recovery, troubleshooting, security, and ownership guide, start with
> [FLORA and Hidro Successor Handbook](./FLORA-HIDRO-SUCCESSOR-HANDBOOK.md).
> This file remains the concise overview.

This document is intended as a practical handoff guide for a new software team taking over support, debugging, enhancement, or deployment of `FLORA` and `Hidro`.

It is not a legal or product brochure document.
It is an engineering and operations starting point.

## 1. System Overview

The current system has two main software parts:

### FLORA

- desktop anesthesia information and documentation system
- used for case recording, patient details, staff, diagnosis/procedure, forms, fluids/medications, blood product workflow, and report generation
- built as:
  - `Electron` desktop shell
  - `React + Vite + TypeScript` frontend
  - `Node.js + Express` backend
  - `SQLite` local database

### Hidro

- device integration middleware
- captures data from patient monitors / anesthesia machines
- normalizes and stores device observations
- exposes local HTTP API for downstream consumers such as FLORA
- built as:
  - `Node.js` service
  - `Electron` tray UI
  - local `SQLite` storage

## 2. High-Level Runtime Relationship

Typical current local deployment:

1. medical devices send data to `Hidro`
2. `Hidro` stores normalized observations and exposes them by local API
3. `FLORA` reads those observations and writes case-level documentation into `flora.db`
4. FLORA generates local reports from `flora.db`

Important principle:

- `FLORA local standalone workflow` is the foundation
- network integration is an extension layer, not the replacement of local workflow

## 3. Repository Map

### FLORA repo

Main folders:

- `frontend/`
  - React UI
  - key views include:
    - `frontend/src/views/CaseView.tsx`
    - `frontend/src/views/FormView.tsx`
    - `frontend/src/views/PatientView.tsx`
    - `frontend/src/views/ReportView.tsx`
- `backend/`
  - Express APIs
  - SQLite schema
  - minute writer
  - HIS and case routes
  - important files:
    - `backend/server.js`
    - `backend/caseRoutes.js`
    - `backend/floradb.js`
- `electron/`
  - desktop shell
  - important files:
    - `electron/main.cjs`
    - `electron/preload.cjs`
    - `electron/reportPdf.cjs`
- `shared/`
  - shared parameter map / integration constants
- `scripts/`
  - build / packaging / DB helper scripts
- `docs/`
  - architecture, release notes, meeting drafts, technical notes

### Hidro repo

Expected main folders:

- `electron/`
  - tray app
- `service/`
  - Node service
  - device drivers and APIs
- `shared/`
  - normalized parameter map shared with FLORA
- `scripts/`
  - build helpers

## 4. FLORA Runtime Flow

### Local app flow

1. user opens FLORA desktop app
2. Electron shell starts frontend and backend
3. backend opens local SQLite DB
4. user works in case-based workflow
5. case data is saved into `flora.db`
6. reports are generated from DB data through Electron/PDF path

### Key backend responsibilities

- auth/session handling
- case lifecycle
- patient/HIS routes
- event routes
- fluid / med / blood routes
- form routes
- report preparation
- timeline/minute handling

### Key frontend responsibilities

- bedside workflow UI
- time chart / timegrid
- patient and HIS workflow
- clinical forms
- report review / generation

## 5. Hidro Runtime Flow

### Local service flow

1. Hidro service starts
2. configured device adapters attempt connection
3. data is received over serial / TCP / HL7 depending on device
4. raw protocol values are normalized to internal parameter keys
5. observations are stored locally and exposed via local HTTP API
6. FLORA consumes Hidro data through local integration path

### Current practical boundary

- Hidro owns device connectivity and normalized observation output
- FLORA owns case workflow and clinical documentation

## 6. Database

### Main FLORA database

- file name: `flora.db`
- packaged runtime path:
  - `C:\porjai\data\flora.db`

Schema source:

- [backend/floradb.js](c:/Users/onlys/Flora/backend/floradb.js)

Main table groups:

- case core
  - `cases`
- patient / case clinical
  - `patient_snapshot`
  - `case_detail`
  - `case_diagnosis`
  - `case_procedure`
  - `case_allergy`
- timeline / event
  - `vital_minutes`
  - `case_timeline_value`
  - `case_event_note`
- staff / auth
  - `auth_user`
  - `auth_session`
  - `staff_directory`
  - `staff_role`
  - `case_staff`
- fluid / medication / output
  - `io_item_master`
  - `case_io_run`
  - `case_io_segment`
  - `case_io_event`
- HIS cache
  - `case_his_patient`
  - `case_his_allergy`
  - `case_his_lab`
  - `his_patient_buffer`
  - `his_allergy_buffer`
  - `his_lab_buffer`
- master data
  - `icd10_master`
  - `icd9cm_master`

Database diagram files:

- [FLORA-Database-Diagram.mmd](c:/Users/onlys/Flora/docs/FLORA-Database-Diagram.mmd)
- [FLORA-Database-Diagram-Guide.md](c:/Users/onlys/Flora/docs/FLORA-Database-Diagram-Guide.md)

## 7. New Client vs Existing Client Deployment

### New client

Normal expectation:

1. install FLORA package
2. place prepared `flora.db` at:
   - `C:\porjai\data\flora.db`

Usually no merge/sync script is required if the copied DB is already the correct prepared DB.

### Existing client

Existing live DB may need:

- package update
- staff/auth sync
- master-data sync
- backup before migration

Important:

- update scripts for existing clients must be treated carefully because real client DBs may contain duplicate/dirty staff data
- do not assume migration scripts are always safe on unknown client DBs without backup and validation

## 8. Prepared DB Rules

The repo contains multiple deployment artifacts and this can confuse a new team.

Important operational rule:

- for a new client, use the intentionally prepared deployment DB
- do not assume any `flora.db` copy inside the repo is automatically the right production seed

Related files:

- [scripts/build-client-db.js](c:/Users/onlys/Flora/scripts/build-client-db.js)
- `deploy-artifacts/`

Known documentation problem:

- `scripts/build-client-db.js` still writes to a legacy `client-release-1.2.1` path
- this should be cleaned up if a new team is taking over

## 9. Build and Packaging

### FLORA

Root package file:

- [package.json](c:/Users/onlys/Flora/package.json)

Main commands:

```powershell
npm install
cd frontend
npm install
cd ..\backend
npm install
cd ..
npm run desktop:build:web
npm run desktop:start
```

Windows installer:

```powershell
npm run desktop:package:win
```

### Hidro

Check the Hidro repo README first.

Typical expectations:

- `npm install`
- run local dev mode
- package Windows installer

The Hidro README is currently better than the FLORA frontend README for onboarding.

## 10. HIS / Gateway Dependencies

Current practical dependency:

- FLORA clients may need to call a hospital-side gateway/service hosted at:
  - `10.35.202.6`

This is used as a hospital integration point for HIS-related retrieval.

Do not assume direct hospital API access from every client.

Important lessons learned:

- keep raw HN storage in FLORA local DB simple
- hospital-specific identifier transformation is safer in gateway/service layer than inside core FLORA DB
- gateway/service behavior, access control, and token management are external dependencies and must be documented per hospital

Related files:

- [docs/server.py](c:/Users/onlys/Flora/docs/server.py)
- `deploy-artifacts/kcmh-gethis-service/`

## 11. Known Unstable / High-Risk Areas

These are the areas a new team should treat carefully.

### 1. USB / Serial / COM connectivity

- room-to-room behavior may differ even with the same software version
- unstable `USB-to-serial` environment is one of the biggest real operational risks
- issues may be caused by:
  - adapter quality
  - old drivers
  - workstation history
  - old Innovian / Capsule / DataCaptor environment
  - port remapping

### 2. Hidro status vs actual data flow

- there were cases where status looked offline but data still flowed
- there were also cases where data stopped after long-running use
- diagnosis/logging is critical here

### 3. Existing client DB migration

- real DBs may contain duplicate or inconsistent staff data
- scripts may require adjustment when moving between different client environments

### 4. HIS integration assumptions

- patient/HIS flow is hospital-specific
- request format and gateway behavior should not be assumed universal

### 5. Report output

- report correctness is operationally important
- user trust drops very quickly if report output is wrong or printer path is unclear

## 12. Current Clinical / Deployment Context

Known practical context from recent rollout period:

- real OR testing happened in rooms such as:
  - `508`
  - `701`
- some rooms behaved acceptably
- some rooms showed Hidro instability despite similar software versions

This means:

- workstation environment standardization matters
- deployment is not only an app problem
- infrastructure and device connection layer are part of the product reality

## 13. Current Roadmap Direction

Main roadmap themes:

1. expand device integration library
   - Dräger devices
   - infusion pumps such as B. Braun / Fresenius
2. grow from local foundation to full client-server architecture
3. support central database sync
4. support outside-OR viewer / document management
5. aim toward multi-room concurrent operation with stable sync

## 14. What Another Company Will Understand Quickly

They should be able to understand:

- technology stack
- repo structure
- DB-centered architecture
- main clinical workflow areas
- packaging path
- current roadmap direction

## 15. What Another Company Will Still Struggle With

Without more guidance, they will likely still struggle with:

- real deployment rules per hospital
- which DB copy is the correct prepared one
- room-specific Hidro instability causes
- expected integration boundary between FLORA and Hidro
- exact ownership of hospital-side service/gateway
- undocumented workflow assumptions that currently live in developer memory

## 16. Recommended Next Documentation Work

If the handoff is serious, create these next:

1. `docs/HIDRO-HANDOFF.md`
2. `docs/DEPLOYMENT-RUNBOOK.md`
3. `docs/KCMH-INTEGRATION-RUNBOOK.md`
4. `docs/KNOWN-ISSUES.md`
5. replace the default [frontend/README.md](c:/Users/onlys/Flora/frontend/README.md) with a real project README

## 17. Minimum Safe Handoff Set

If time is limited, the minimum set another company should receive is:

1. this file
2. root [README.md](c:/Users/onlys/Flora/README.md)
3. [backend/floradb.js](c:/Users/onlys/Flora/backend/floradb.js)
4. [backend/caseRoutes.js](c:/Users/onlys/Flora/backend/caseRoutes.js)
5. [electron/main.cjs](c:/Users/onlys/Flora/electron/main.cjs)
6. [electron/reportPdf.cjs](c:/Users/onlys/Flora/electron/reportPdf.cjs)
7. [docs/RELEASE_NOTES.md](c:/Users/onlys/Flora/docs/RELEASE_NOTES.md)
8. the prepared deployment DB and explanation of where it should be used
9. Hidro repo with its own README

## 18. Bottom-Line Assessment

Current documentation is enough for a new team to start reading and modifying code.

Current documentation is **not yet enough** for a smooth, low-risk takeover without additional onboarding.

This file is intended to reduce that gap.
