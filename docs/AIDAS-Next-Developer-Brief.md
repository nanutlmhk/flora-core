# AIDAS Next Developer Brief

This brief is intended for the next developer or software team who will continue AIDAS after handoff.

Unlike the RCAT brief, this document is not presentation material.
It is a practical engineering overview of what AIDAS is, how it is structured, where the risks are, and what should be understood before modifying the system.

## 1. What AIDAS is

AIDAS is a local-first anesthesia information and documentation system used in operating-room workflow.

Its responsibilities include:

- case creation and lifecycle
- patient information workflow
- clinical form documentation
- diagnosis / procedure documentation
- fluid and medication charting
- blood product workflow
- timeline / event / note recording
- staff assignment
- report generation

AIDAS is not the device-capture middleware.
That responsibility belongs to `Hidro`.

## 2. Relationship Between AIDAS and Hidro

Current architecture boundary:

- `Hidro` captures and normalizes device observations
- `AIDAS` consumes those observations and documents them inside a case workflow

Practical flow:

1. bedside devices send data to Hidro
2. Hidro exposes observations through a local API
3. AIDAS reads those observations
4. AIDAS stores case-level documentation in `flora.db`
5. AIDAS generates reports from case data

This boundary should be preserved unless there is a strong architectural reason to change it.

## 3. Core Technical Stack

### Frontend

- `React`
- `TypeScript`
- `Vite`

Important UI areas:

- `CaseView`
- `PatientView`
- `FormView`
- `DiagnosisView`
- `DrugView`
- `ReportView`

### Desktop Shell

- `Electron`

Responsibilities:

- boot local desktop app
- launch backend
- bridge frontend to local runtime
- package Windows installer
- support PDF report generation

### Backend

- `Node.js`
- `Express`
- `better-sqlite3`

Responsibilities:

- case routes
- auth/session
- patient/HIS routes
- fluid/med/blood workflows
- timeline and events
- report data preparation
- SQLite schema and migrations

### Database

- `SQLite`
- main file: `flora.db`

Packaged runtime path typically used:

- `C:\porjai\data\flora.db`

## 4. Local-First Architecture Principle

The most important architecture decision in AIDAS is:

> The local OR client must still be able to function as the foundation of the workflow.

This means:

- active case workflow must not depend entirely on central network services
- network/HIS/central database are extension layers
- standalone local operation is not a fallback mode, it is the base model

This principle should guide future design decisions.

## 5. Main Data Domains

AIDAS is centered around the `case`.

Major data groups:

### Case core

- case identifier
- HN
- start/discharge/archive state

### Patient and clinical documentation

- patient snapshot
- case detail
- diagnosis
- procedure
- allergy

### Timeline and charting

- raw minute-level device data
- manual/override timeline values
- events / notes

### Staff and authentication

- auth users
- sessions
- staff directory
- case staff

### Fluid / medication / output

- item master
- continuous runs
- run segments for rate changes
- point events / bolus / output entries

### HIS integration cache

- case HIS patient
- case HIS allergy
- case HIS lab
- no-case buffers for patient/allergy/lab

See also:

- [HANDOFF.md](c:/Users/onlys/Aidas/docs/HANDOFF.md)
- [AIDAS-Database-Diagram.mmd](c:/Users/onlys/Aidas/docs/AIDAS-Database-Diagram.mmd)

## 6. Important Entry Points

New developer should read these first:

- [README.md](c:/Users/onlys/Aidas/README.md)
- [backend/floradb.js](c:/Users/onlys/Aidas/backend/floradb.js)
- [backend/caseRoutes.js](c:/Users/onlys/Aidas/backend/caseRoutes.js)
- [backend/server.js](c:/Users/onlys/Aidas/backend/server.js)
- [electron/main.cjs](c:/Users/onlys/Aidas/electron/main.cjs)
- [electron/reportPdf.cjs](c:/Users/onlys/Aidas/electron/reportPdf.cjs)
- [frontend/src/views/CaseView.tsx](c:/Users/onlys/Aidas/frontend/src/views/CaseView.tsx)
- [frontend/src/views/PatientView.tsx](c:/Users/onlys/Aidas/frontend/src/views/PatientView.tsx)
- [frontend/src/views/FormView.tsx](c:/Users/onlys/Aidas/frontend/src/views/FormView.tsx)
- [frontend/src/views/ReportView.tsx](c:/Users/onlys/Aidas/frontend/src/views/ReportView.tsx)

## 7. Clinical Workflow Reality

This system was not built for idealized software-only workflow.

Important reality:

- users are clinicians in the OR
- workflow must tolerate imperfect timing and imperfect recall
- not everything can be automated
- manual entry and device-assisted capture must coexist
- report correctness matters as much as visible UI behavior

A technically correct change can still be a bad change if it fights real clinical workflow.

## 8. Known Sensitive Areas

### 1. Timeline / minute handling

- minute data comes from both device capture and manual workflow
- overlap behavior between previous and new case can create subtle errors
- anything touching minute writer logic should be tested carefully

### 2. Fluid / medication charting

- drip vs bolus behavior is operationally sensitive
- timeline rendering and report rendering must stay aligned
- rate-change workflow is easy to break if model changes are careless

### 3. Report generation

- report is a key user-facing output
- users lose confidence very quickly if report layout or values are wrong
- any change in chart/timegrid/form output should be checked in report path too

### 4. Patient / HIS workflow

- hospital integration behavior is environment-specific
- gateway/server behavior may be outside app control
- avoid hardcoding hospital-specific transformation logic deeper than necessary

### 5. Staff / auth / master data sync

- real client DBs may contain dirty or duplicate rows
- scripts can fail if assumptions about uniqueness are too optimistic
- migration logic should always be backed by explicit checks and backup

### 6. Packaged deployment behavior

- packaged runtime path and local DB handling are operationally important
- installer assumptions must match real client environment

## 9. Current Known Weaknesses

At handoff time, likely weak areas include:

- frontend README still needs real project-specific documentation
- deployment rules are partly documented but still spread across files
- some hospital-specific integration knowledge lives in working notes rather than single runbooks
- room-by-room Hidro behavior is not fully deterministic
- some business rules are encoded in workflow expectations rather than formal docs

## 10. Current Roadmap Direction

Main next-step directions discussed so far:

1. expand integration library
   - Dräger
   - Hamilton
   - B. Braun / Fresenius pumps
2. improve Hidro stability and diagnostics
3. standardize Windows client deployment
4. extend toward full client-server support
5. central database sync
6. remote viewer / document management support
7. support multi-room concurrent use

## 11. Design Rules Worth Preserving

### Preserve local-first behavior

Do not redesign AIDAS into a network-dependent-only workflow unless the hospital explicitly accepts that operational risk.

### Preserve clear AIDAS/Hidro boundary

Avoid mixing device transport instability with case workflow logic.

### Preserve case-centered model

The case is the main organizing unit, not the device stream.

### Preserve explainability

Clinicians and hospital IT should be able to understand:

- where data comes from
- where it is stored
- how it is printed
- what depends on network and what does not

### Preserve deployment realism

A feature that only works in development but not in a real OR workstation is not complete.

## 12. Recommended First Tasks for a New Developer

Before making big changes:

1. read the root README
2. read the handoff docs
3. understand `flora.db` schema
4. run local AIDAS with a known test DB
5. trace one full case path:
   - patient
   - case
   - event
   - fluid/med
   - report
6. trace one Hidro observation path into AIDAS

Only after that should large refactors begin.

## 13. Recommended Documentation to Create Next

If the new team has time, create:

1. `frontend/README.md` project-specific rewrite
2. `docs/DEPLOYMENT-RUNBOOK.md`
3. `docs/KCMH-INTEGRATION-RUNBOOK.md`
4. `docs/KNOWN-ISSUES.md`
5. `docs/REPORT-PIPELINE.md`

## 14. Bottom-Line Message

AIDAS is not just a desktop app.
It is a local-first clinical workflow system with a real operating-room deployment context.

The next developer should not only read the code.
They should understand:

- the case-centered model
- the AIDAS/Hidro boundary
- the local-first principle
- the real clinical workflow pressures
- the deployment environment reality

That understanding matters as much as the code itself.
