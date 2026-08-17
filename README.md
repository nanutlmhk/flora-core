# Aidas

Aidas is a desktop anesthesia information and documentation system used for real operating-room case recording, device-assisted vital sign capture, fluid and medication charting, clinical forms, and anesthesia report generation.

The current desktop app is built as an Electron package with a React frontend, Node backend, SQLite database, and shared parameter mapping used by Aidas and Hidro integration paths.

## Current Version

- Current package version: `1.2.2`
- Release and milestone history: [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md)

Major clinical milestones:

- `1.0.0`: first real clinical release in intervention OR with `GE B1x5` and `GE Carestation 750`
- `1.1.0`: packaged Aidas and Hidro installer workflow
- `1.2.0`: Neuro OR expansion with `GE B650/850` and `GE Aisys / Avance`
- `1.2.1`: stabilization patch after Neuro OR beta and packaged client rollout
- `1.2.2`: line-form refinement, report/event fixes, manual drug fallback, and first edition architecture support

## Repository Layout

- `frontend/`: React/Vite frontend for the Aidas desktop UI
- `backend/`: Node backend, SQLite schema, case APIs, minute writer, and master-data import tools
- `electron/`: Electron shell and desktop PDF/report generation entry points
- `shared/`: shared parameter maps and integration constants
- `scripts/`: desktop build, launch, repair, client DB, and verification scripts
- `docs/`: release notes, integration documents, IP/license drafts, and working documentation

## Development

Install dependencies in the root, frontend, and backend folders as needed:

```powershell
npm install
Set-Location frontend
npm install
Set-Location ..\backend
npm install
Set-Location ..
```

Build the frontend:

```powershell
npm run desktop:build:web
```

Run the desktop app after building:

```powershell
npm run desktop:start:no-build
```

Build and run in one command:

```powershell
npm run desktop:start
```

## Packaging

Build the Windows installer:

```powershell
npm run desktop:package:win
```

Generated installer artifacts are written to `dist-electron/`.

Runtime release bundles and client database files are local deployment artifacts and are ignored by git under `deploy-artifacts/`.

## Database

In packaged mode, Aidas uses:

```text
C:\porjai\data\flora.db
```

The installer does not bundle a production database. A valid client database must be prepared and placed at the runtime path.

Build a sanitized client database from the deployment source DB:

```powershell
node scripts/build-client-db.js
```

Check required master data in a client database:

```powershell
npm run db:check:master -- C:\porjai\data\flora.db
```

Expected master tables include:

- `icd10_master`
- `icd9cm_master`
- `io_item_master`
- `staff_role`

Migrate master data from a source DB into the local app DB:

```powershell
npm run db:migrate:master
```

## Operational Scripts

- `scripts/start-aidas.ps1`: launch Aidas using the packaged runtime database path
- `scripts/launch-aidas.ps1`: launch helper for local runtime
- `scripts/repair-aidas-db.js`: inspect or repair active-case state
- `scripts/check-master-data.js`: verify ICD and other master tables
- `scripts/build-client-db.js`: prepare a clean client DB with master data and default admin
- `scripts/build-desktop-win.ps1`: Windows packaging wrapper

## Release Notes

Every release or client-facing patch should be recorded in [docs/RELEASE_NOTES.md](docs/RELEASE_NOTES.md).

Use the release notes for:

- real clinical milestones
- device integration milestones
- patch summaries
- validation and rollout notes
- known operational meaning of each version

## Git Notes

Generated and local runtime outputs are intentionally ignored:

- `frontend/dist/`
- `dist-electron/`
- `deploy-artifacts/`
- `tmp_docx_extract/`
- local runtime profiles and database files

Keep source changes, release notes, scripts, and reusable documentation in git. Keep installers, runtime DB files, and temporary document extraction folders outside git unless there is a deliberate reason to version them.
