<div align="center">
  <img src="electron/assets/aidas-app.png" alt="Flora / AIDAS" width="112" />

  # Flora

  **Desktop anesthesia workflow platform for case capture, minute writing, and device integration**

  <p>
    <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows-2563eb">
    <img alt="Desktop" src="https://img.shields.io/badge/Desktop-Electron-0f172a">
    <img alt="Frontend" src="https://img.shields.io/badge/Frontend-React-0ea5e9">
    <img alt="Backend" src="https://img.shields.io/badge/Backend-Express-16a34a">
    <img alt="Database" src="https://img.shields.io/badge/Database-SQLite-7c3aed">
    <img alt="Runtime" src="https://img.shields.io/badge/Runtime-Clinical%20Workstation-475569">
  </p>
</div>

---

## Overview

Flora is a Windows desktop anesthesia workflow project with three runtime layers:

- `AIDAS`: Electron shell and clinical UI for the workstation experience
- `backend`: local API and case database writer
- `Ivy / Hidro`: ingestion services that collect monitor and machine data and expose it to AIDAS

The system is designed for long-running client-PC sessions, repeated case open/close cycles, and resilient local operation.

## Architecture

```text
Patient Monitor / Machine / HL7
            |
            v
     Ivy / Hidro ingest
     - collects observations
     - stores raw device data
            |
            v
      HTTP observation API
            |
            v
       AIDAS backend
     - minute writer
     - case/event APIs
     - SQLite persistence
            |
            v
     AIDAS desktop frontend
     - case workflow
     - drug / fluid capture
     - report / print layout
```

## Highlights

- Desktop-first workflow built for anesthesia documentation
- Local-first runtime with SQLite-backed persistence
- Separate ingestion runtime for device and observation streams
- Timeline, drugs, fluids, blood products, events, and printable report views
- Launcher-based startup model for client deployment and troubleshooting

## Repository Layout

- [`frontend-v2`](frontend-v2): React UI
- [`backend`](backend): Express API and Flora database access
- [`electron`](electron): AIDAS Electron main process
- [`ivy`](ivy): ingestion server and `ivy.db` runtime
- [`ivy-tray`](ivy-tray): Hidro tray shell
- [`scripts`](scripts): packaging, recovery, and startup helper scripts
- [`shared`](shared): shared runtime mappings and helpers

## Runtime Model

### Data stores

- `flora.db`
  - AIDAS case database
  - stores cases, minute snapshots, manual edits, events, staff, diagnosis, drugs, and related case state

- `ivy.db`
  - Ivy raw observation database
  - stores incoming GE750, HL7, and device observations before AIDAS consumes them

Important behavior:

- AIDAS does **not** read `ivy.db` directly
- AIDAS backend reads observations from Ivy over HTTP

### Default ports

- Ivy HTTP: `3000`
- AIDAS backend: `3001`
- HL7 listener: `6000`

### Service flow

1. Ivy receives device data and writes raw observations into `ivy.db`
2. Ivy exposes observations over HTTP
3. AIDAS backend minute writer reads Ivy observation data
4. AIDAS backend writes case-minute snapshots into `flora.db`
5. AIDAS frontend reads case state from the backend

## Quick Start

Install root dependencies:

```powershell
npm install
```

Install subproject dependencies as needed:

```powershell
cd backend
npm install

cd ..\ivy
npm install

cd ..\frontend-v2
npm install
```

Build the frontend bundle:

```powershell
cd c:\Users\onlys\flora-aplha
npm run desktop:build:web
```

## Launchers

Use launcher files as the normal run path instead of starting the Electron app manually.

### AIDAS

- Visible: [`start-aidas.cmd`](start-aidas.cmd)
- Hidden: [`start-aidas-hidden.vbs`](start-aidas-hidden.vbs)
- Test: [`start-aidas-test.cmd`](start-aidas-test.cmd)

Behavior:

- uses the client runtime database path
- clears stale backend state on startup
- uses dedicated Electron profile and cache folders
- preserves SQLite WAL and SHM files during normal startup

### Hidro

- Hidden: [`start-hidro-hidden.vbs`](start-hidro-hidden.vbs)
- Test: [`start-hidro-test.cmd`](start-hidro-test.cmd)

## Health And Debug Endpoints

- Ivy health: `http://127.0.0.1:3000/health`
- Ivy services: `http://127.0.0.1:3000/api/admin/services`
- AIDAS backend health: `http://127.0.0.1:3001/health`
- AIDAS minute writer debug: `http://127.0.0.1:3001/debug/minute-writer`

## Deployment Notes

- client deployments are launcher-driven
- hidden VBS launchers are intended for end users
- visible CMD launchers are intended for troubleshooting and validation
- recovery and repair paths are separate from standard startup

Useful scripts:

- [`repair-aidas-db.cmd`](repair-aidas-db.cmd)
- [`build-client-package.cmd`](build-client-package.cmd)
- [`scripts/start-aidas.ps1`](scripts/start-aidas.ps1)
- [`scripts/start-aidas-recover.ps1`](scripts/start-aidas-recover.ps1)

## Stability Hardening

- dedicated Electron profile and cache folders
- single-instance protection in the AIDAS Electron shell
- backend active-case writer reconciliation
- graceful shutdown for AIDAS backend and Ivy services
- SQLite WAL, busy-timeout, and checkpoint tuning
- launcher recovery for stale backend state

## Development Notes

- runtime profile folders are ignored by git
- local build artifacts and deploy staging directories are ignored
- line ending behavior is controlled by [`.gitattributes`](.gitattributes)
- repository-specific ignore rules live in [`.gitignore`](.gitignore)

## License

Internal project repository. Add the intended license here if this repository is going to be shared outside the current team.
