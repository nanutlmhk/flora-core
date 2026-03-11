# Flora

Flora is a Windows desktop anesthesia workflow project with three main runtime parts:

- `AIDAS`: Electron desktop shell for the clinical UI
- `backend`: local API + SQLite case database writer
- `Ivy / Hidro`: device-ingestion services that collect monitor / machine data and expose it to AIDAS

The system is designed to run on a client PC for long sessions and repeated case open/close cycles.

## Repository Layout

- [`frontend-v2`](c:\Users\onlys\flora-aplha\frontend-v2): React UI
- [`backend`](c:\Users\onlys\flora-aplha\backend): Express API + `flora.db`
- [`electron`](c:\Users\onlys\flora-aplha\electron): AIDAS Electron main process
- [`ivy`](c:\Users\onlys\flora-aplha\ivy): ingestion server + `ivy.db`
- [`ivy-tray`](c:\Users\onlys\flora-aplha\ivy-tray): Hidro tray shell
- [`scripts`](c:\Users\onlys\flora-aplha\scripts): packaging / helper scripts

## Data Model

There are two different SQLite databases:

- `flora.db`
  - AIDAS case database
  - stores cases, minute snapshots, manual edits, events, staff, diagnosis, drugs, etc.
  - normal runtime path: `C:\porjai\data\flora.db`

- `ivy.db`
  - Ivy raw observation database
  - stores incoming GE750 / HL7 / device observations before AIDAS consumes them
  - lives under the Ivy app/runtime folder

Important:

- AIDAS does not read `ivy.db` directly
- AIDAS backend reads Ivy over HTTP:
  - default: `http://127.0.0.1:3000/api/observations`

## Runtime Flow

1. Ivy receives data from devices and writes raw observations into `ivy.db`
2. Ivy exposes those observations over HTTP on port `3000`
3. AIDAS backend minute-writer reads Ivy HTTP data
4. AIDAS backend writes case-minute snapshots into `flora.db`
5. AIDAS frontend reads from backend on port `3001`

## Standard Launchers

Use these as the normal run path.

### AIDAS

- visible: [start-aidas.cmd](c:\Users\onlys\flora-aplha\start-aidas.cmd)
- hidden: [start-aidas-hidden.vbs](c:\Users\onlys\flora-aplha\start-aidas-hidden.vbs)

Behavior:

- uses `C:\porjai\data\flora.db`
- clears stale AIDAS backend state
- clears `flora.db-wal` / `flora.db-shm` during recovery
- uses dedicated Electron profile/cache folders

### Hidro

- visible: [start-hidro.cmd](c:\Users\onlys\flora-aplha\start-hidro.cmd)
- visible via VBS: [start-hidro.vbs](c:\Users\onlys\flora-aplha\start-hidro.vbs)
- hidden: [start-hidro-hidden.vbs](c:\Users\onlys\flora-aplha\start-hidro-hidden.vbs)

## Test Launchers

Use these when validating behavior in a visible terminal.

- [start-aidas-test.cmd](c:\Users\onlys\flora-aplha\start-aidas-test.cmd)
  - rebuilds `frontend-v2` on every launch
  - uses separate `.aidas-profile-test`

- [start-hidro-test.cmd](c:\Users\onlys\flora-aplha\start-hidro-test.cmd)
  - validates tray source before launch
  - uses separate `.hidro-profile-test`

## Ports

- Ivy HTTP: `3000`
- AIDAS backend: `3001`
- HL7 listener: `6000`

Useful health/debug endpoints:

- Ivy health: `http://127.0.0.1:3000/health`
- Ivy service status: `http://127.0.0.1:3000/api/admin/services`
- AIDAS backend health: `http://127.0.0.1:3001/health`
- AIDAS minute writer debug: `http://127.0.0.1:3001/debug/minute-writer`

## Setup

From repo root:

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

Build frontend:

```powershell
cd c:\Users\onlys\flora-aplha
npm run desktop:build:web
```

## Production Conventions

- repo path on client: `C:\porjai\flora-aplha`
- AIDAS DB path on client: `C:\porjai\data\flora.db`
- use launcher files instead of starting Electron manually
- use hidden VBS files for end users
- use visible CMD files for troubleshooting

## Stability Hardening Already Added

- AIDAS launcher recovery for stale backend / WAL state
- dedicated Electron cache/profile paths for AIDAS and Hidro
- single-instance protection in AIDAS Electron shell
- backend active-case writer reconciliation
- graceful shutdown for AIDAS backend and Ivy server
- SQLite WAL / busy-timeout / checkpoint tuning

## Files Commonly Deployed

For AIDAS:

- [start-aidas.cmd](c:\Users\onlys\flora-aplha\start-aidas.cmd)
- [start-aidas-hidden.vbs](c:\Users\onlys\flora-aplha\start-aidas-hidden.vbs)
- [electron/main.cjs](c:\Users\onlys\flora-aplha\electron\main.cjs)

For Hidro:

- [start-hidro.cmd](c:\Users\onlys\flora-aplha\start-hidro.cmd)
- [start-hidro.vbs](c:\Users\onlys\flora-aplha\start-hidro.vbs)
- [start-hidro-hidden.vbs](c:\Users\onlys\flora-aplha\start-hidro-hidden.vbs)

## Notes

- runtime profile folders are ignored by git:
  - `.aidas-profile/`
  - `.hidro-profile/`
  - `.aidas-profile-test/`
  - `.hidro-profile-test/`
- test launchers and `toprod/` are also ignored
- line endings are controlled by [`.gitattributes`](c:\Users\onlys\flora-aplha\.gitattributes)
