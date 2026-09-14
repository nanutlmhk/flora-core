# FLORA and Hidro Successor Handbook

## Document purpose

This is the engineering, deployment, and operational handoff for the team that will inherit FLORA and Hidro.

It is intended to answer the questions that normally remain in the outgoing developer's head:

- what each product does and does not own
- how the two products communicate
- where source code, runtime data, configuration, logs, and installers live
- how to build, run, package, deploy, back up, restore, and diagnose the systems
- which device integrations are present and which ones are actually proven
- which parts of the system are clinically or operationally sensitive
- what is verified from code and what still requires site-specific evidence
- what a successor must validate before making a release or supporting a live operating room

This handbook contains no production passwords, tokens, private keys, or patient data. Those must be transferred through an approved secure channel.

## Document control and code snapshot

This handbook was prepared on `2026-07-29` from the local repositories:

| Product | Repository | Branch / commit inspected | Package version |
| --- | --- | --- | --- |
| FLORA | `https://github.com/nanutlmhk/Flora.git` | `main` at `149319c` plus uncommitted worktree changes | `1.2.2` |
| Hidro original | `https://github.com/nanutlmhk/Hidro.git` | local `master` | `1.2.2` |
| Hidro successor copy | `https://github.com/nanutlmhk/Hidro-Porjai.git` | `master` at `a71f6fe` | `1.2.2` |

Important: the FLORA worktree contained substantial uncommitted changes when this document was written. A successor must not treat package version `1.2.2`, the latest Git commit, and the current local worktree as automatically identical. Before the final ownership transfer, create a clean release commit and tag, record the installer hash, and identify the exact database and configuration used for acceptance.

Use these confidence labels throughout future documentation:

- `Verified`: confirmed by current source code, a repeatable test, a log, or an accepted operational record.
- `Observed`: seen in a real deployment, but the root cause or reproducibility is incomplete.
- `Planned`: intended direction, not a delivered and accepted capability.
- `TBD`: information that must be supplied by a hospital, vendor, product owner, or infrastructure owner.

## 1. The shortest correct explanation

FLORA is a local-first anesthesia information and documentation application. It owns the clinical case, user workflow, manually entered information, automatic minute-level observations associated with that case, medication/fluid/event charting, forms, and the final anesthesia report.

Hidro is local medical-device middleware. It owns physical/protocol connectivity to supported bedside devices, raw-message parsing, parameter normalization, short- to medium-term observation storage, device diagnostics, and a localhost REST API.

The normal data path is:

```text
Patient monitor / anesthesia machine / pump
        |
        | serial, TCP, HL7, or vendor-specific protocol
        v
Hidro driver and parser
        |
        | normalized observations
        v
Hidro SQLite database: ivy.db
        |
        | HTTP on 127.0.0.1:3000
        v
FLORA minute writer
        |
        | one case-associated payload per minute
        v
FLORA SQLite database: flora.db
        |
        +--> bedside timeline and chart
        +--> forms, events, medication/fluid records
        +--> PDF/print report
```

The most important ownership boundary is:

- Hidro answers, "Did the device produce a usable observation?"
- FLORA answers, "Which clinical case does that observation belong to, and how is it documented?"

Do not move device-specific serial handling into FLORA. Do not move clinical case semantics into Hidro.

## 2. Product boundaries

### 2.1 FLORA owns

- local user authentication and preferences
- case start, discharge, archive, and history
- patient snapshot and case-specific clinical details
- diagnosis and procedure records
- allergy and laboratory display/caching
- staff assignment
- clinical forms
- manually edited timeline values
- automatic minute-level vital/device values copied from Hidro
- events and notes
- medications, fluids, drips, outputs, blood products, and their audit trails
- report preparation, PDF generation, preview, and printing
- edition-specific UI/report restrictions
- local database recovery and backend lifecycle

### 2.2 Hidro owns

- serial-port, TCP, and protocol connection state
- device-specific framing, checksums, polling, parsing, and reconnection
- translation from raw device codes to normalized `ivy_param` keys
- unknown-parameter auditing
- recent observation storage
- service, transport, and data-status reporting
- local reconnect, shutdown, and diagnostics endpoints
- Electron tray controls and device configuration

### 2.3 Hospital or external owners must own

- workstation, Windows image, antivirus, USB policy, and device drivers
- network addressing, VLAN, routing, firewall, DNS, VPN, and certificates
- HIS, LIS, blood-bank, EPHIS, and other upstream service contracts
- medical-device communication settings and biomedical approval
- printer queues, shared folders, and document-retention policy
- production identities, secrets, service accounts, and access revocation
- clinical acceptance and change approval

## 3. Repository map and source-of-truth rules

### 3.1 FLORA repository

| Path | Responsibility |
| --- | --- |
| `frontend/src/` | React/TypeScript bedside UI |
| `frontend/src/views/CaseView.tsx` | active-case charting and timeline workflow |
| `frontend/src/views/PatientView.tsx` | patient and HIS-facing workflow |
| `frontend/src/views/FormView.tsx` | clinical form workflow |
| `frontend/src/views/DrugView.tsx` | medications, fluids, drips, and related charting |
| `frontend/src/views/ReportView.tsx` | report preparation, timeline pagination, preview, and print actions |
| `frontend/src/views/report/` | report models and rendering components |
| `frontend/src/edition/config.ts` | full, RCAT, and EforL feature restrictions |
| `frontend/src/api/` | typed frontend calls to the local backend |
| `backend/server.js` | Express entry point, health/debug endpoints, minute-writer bootstrap |
| `backend/caseRoutes.js` | case, HIS, patient, staff, IO, event, and timeline APIs |
| `backend/authRoutes.js` | login, session, user, preference, and password APIs |
| `backend/ephisRoutes.js` | EPHIS import/status/daily-case APIs |
| `backend/floradb.js` | authoritative SQLite schema, migrations, seed data, auth helpers |
| `backend/minuteWriter.js` | Hidro polling, normalization, minute aggregation, audit, and catch-up |
| `electron/main.cjs` | desktop bootstrap, backend process lifecycle, recovery, PDF IPC, packaging runtime paths |
| `electron/preload.cjs` | safe renderer-to-Electron bridge |
| `electron/reportPdf.cjs` | direct PDF generation using `pdf-lib` |
| `shared/floraParamMap.js` | normalized Hidro-to-FLORA parameter keys |
| `scripts/` | packaging, startup, recovery, database creation/check/sync tools |
| `docs/RELEASE_NOTES.md` | product release history |

### 3.2 Hidro repository

| Path | Responsibility |
| --- | --- |
| `service/server.js` | REST API, logical device status, service startup/shutdown |
| `service/db.js` | `ivy.db` schema, aliases, unknown parameters, retention, WAL handling |
| `service/settings.js` | `config.local.json` loading and service enablement |
| `service/ge750/` | GE Carestation 750 protocol and GE750-family path |
| `service/geaisyscs2/` | GE Aisys/CARESCAPE-family serial framing and service path |
| `service/gebx50/` | GE Bx50/B650-family serial path |
| `service/ges5/` | GE S/5 protocol work and samples; disabled in the current service profile |
| `service/gehl7/` | HL7 listener path; disabled in the current server profile |
| `service/bbraunbcc/` | B. Braun BCC TCP/LAN path |
| `service/hl7Parser.js` | HL7 parsing |
| `service/obxMapper.js` | HL7 OBX mapping behavior |
| `service/aliasLookup.js` | raw-code alias resolution |
| `service/unknownAudit.js` | unmapped parameter tracking |
| `service/serialPortClaims.js` | coordination of COM-port ownership |
| `service/serialHardReset.js` | Windows/PnP-assisted serial reset path |
| `electron/main.cjs` | tray lifecycle, service child process, config UI, status polling, reconnect/reset |
| `electron/frontend/` | tray dashboard, diagnostics, and settings UI |
| `shared/floraParamMap.js` | parameter-map copy shared with FLORA |
| `shared/diagnostics.js` | structured diagnostics logger |
| `scripts/Reset-HidroPorts.ps1` | elevated Windows COM-device restart helper |

### 3.3 Source-of-truth order

When documentation and behavior disagree, use this order:

1. accepted production evidence for the exact installed version
2. source code at the exact release commit
3. automated or repeatable test results
4. current README and handoff documents
5. meeting notes, plans, or memory

Never declare a device supported only because a driver folder exists.

## 4. FLORA architecture in detail

### 4.1 Technology stack

- Electron `40.x` desktop shell
- React `19.x`
- TypeScript `5.9.x`
- Vite `7.x`
- Node.js/CommonJS backend
- Express `4.x`
- `better-sqlite3`
- `pdf-lib` and `fontkit` for generated reports
- Windows-first packaging with `electron-builder` and NSIS

### 4.2 Desktop bootstrap

The Electron process is the normal application entry point.

At startup it:

1. obtains a single-instance lock
2. resolves the edition (`full`, `rcat`, or `eforl`)
3. creates edition-specific user-data, session, and cache paths
4. detects a prior unclean shutdown
5. clears stale session/cache state when recovery is needed
6. finds or starts the local backend
7. injects the database and Hidro endpoint into the backend environment
8. waits for backend health on port `3001`
9. loads the built frontend
10. exposes PDF, recovery, shutdown, version, and edition operations through preload IPC

The backend child process is hidden on Windows and is normally owned by the Electron parent. A PID file is used to identify the backend process. The app also attempts to reuse an already healthy backend on the configured port.

Do not blindly kill every process on port `3001` during support. Confirm whether it is the FLORA backend and preserve database integrity.

### 4.3 Runtime ports and URLs

| Component | Default |
| --- | --- |
| FLORA backend | `http://127.0.0.1:3001` |
| Backend health | `GET /health` |
| Minute-writer debug | `GET /debug/minute-writer` |
| End-to-end flow debug | `GET /debug/flow` |
| Hidro observation API used by FLORA | `http://127.0.0.1:3000/api/observations` |
| Hidro bulk API used by FLORA | `http://127.0.0.1:3000/api/observations/bulk` |

The minute writer also tries `localhost` candidates, reducing IPv4/IPv6 localhost-resolution problems.

### 4.4 Database path resolution

The effective FLORA database path depends on how the app starts:

1. `FLORA_DB_PATH`, if explicitly set
2. `FLORA_DB_PATH`, if explicitly set
3. development Electron: `<FLORA repo>\data\flora.db`
4. packaged Electron: `<PORJAI_ROOT>\data\flora.db`
5. packaged default: `C:\porjai\data\flora.db`

The backend module alone also falls back to `<repo>\data\flora.db` when no explicit path or `PORJAI_ROOT` is supplied.

Operational rule: always confirm the path printed as `[BOOT] FLORA_DB_PATH=...` before editing, repairing, migrating, or backing up a database.

### 4.5 Database behavior

`flora.db` uses:

- WAL journal mode
- foreign keys
- `synchronous=NORMAL`
- 15-second busy timeout
- automatic WAL checkpointing
- a 32 MB negative SQLite cache-size setting

The schema is created and lightly migrated at backend startup. This convenience is useful, but it is not a substitute for a versioned migration framework. Existing client databases must be backed up and tested before a new build opens them.

### 4.6 Main table groups

| Group | Tables | Meaning |
| --- | --- | --- |
| Case core | `cases` | case identity, HN, start, device-capture start, discharge, archive, status |
| Authentication | `auth_user`, `auth_session`, `auth_audit` | local identities, session tokens, audit trail |
| Automatic observations | `vital_minutes`, `case_device_ingest_audit` | one normalized payload per case/minute and fetch evidence |
| Manual timeline | `case_timeline_value`, `case_timeline_audit` | user edits and their audit trail |
| Events | `case_event_note`, `case_event_note_audit` | clinical events/notes and lifecycle audit |
| Patient/clinical | `patient_snapshot`, `case_detail`, `case_diagnosis`, `case_procedure`, `case_allergy` | case-frozen clinical data |
| HIS snapshots/cache | `case_his_patient`, `case_his_allergy`, `case_his_lab`, `his_patient_buffer`, `his_allergy_buffer`, `his_lab_buffer` | upstream data associated with a case or pre-admission buffer |
| EPHIS | `ephis_daily_case` | imported daily-case information |
| Staff | `case_staff`, `staff_directory`, `staff_role` | reusable staff master and case assignments |
| IO/medication/fluid | `io_item_master`, `case_io_run`, `case_io_segment`, `case_io_event`, `case_io_audit` | bolus, drip, fluid, output, rate segments, and audit |
| Master data | `icd10_master`, `icd9cm_master`, `legacy_med_drip_preset_analysis` | diagnosis/procedure search and medication preset analysis |

`cases` is the central entity. Most clinical data is associated using `case_id`.

### 4.7 Case lifecycle

Supported case statuses are:

```text
active -> discharged -> archived
```

Key operations:

- `POST /api/case/start-overlap-check`
- `POST /api/case/start`
- `POST /api/case/discharge`
- `POST /api/case/archive`
- `PUT /api/case/:id/start-time`
- `PUT /api/case/:id/discharge-time`
- `GET /api/case/status`
- `GET /api/case/list`

Case start times are aligned to quarter-hour logic in the current backend. The start flow checks overlap with prior automatic capture. The overlap policy is clinically important because automatic device observations may exist across the boundary between two cases.

Do not simplify or remove overlap handling without testing:

- previous case still active
- new case starts before the previous capture window ends
- delayed case entry
- discharge followed immediately by a new case
- report end-time adjustment

### 4.8 Minute writer: the FLORA/Hidro bridge

For every active case, FLORA starts a minute-writer state machine.

Normal behavior:

1. determine the next complete minute required by the case
2. call Hidro with `from` and `to` timestamps in milliseconds
3. normalize each `ivy_param` using `shared/floraParamMap.js`
4. select one effective value for each FLORA key
5. write a JSON payload into `vital_minutes`
6. write an ingest-audit row with status `ok`, `empty`, or `failed`
7. continue polling while the case remains active

When the writer falls sufficiently behind, it uses the bulk endpoint to catch up. The default bulk threshold is five minutes.

Current defaults:

| Setting | Default |
| --- | --- |
| poll interval | `1000 ms` |
| fetch timeout | `5000 ms` |
| maximum backfill per tick | `60` |
| bulk threshold | `5 minutes` |
| stalled-writer restart threshold | `45 seconds`, minimum `30 seconds` |

The backend reconciles active cases and minute writers. It stops stale writers for non-active cases and restarts writers that appear stalled.

### 4.9 CO2 normalization

CO2 requires special care because different devices provide different units.

For `et_co2` and `fi_co2`, the minute writer currently assigns priority:

1. `mmHg`: use directly
2. `kPa`: multiply by `7.50062`
3. `%`: convert using a fixed atmospheric pressure of `760 mmHg`

The higher-priority observation wins when multiple unit forms exist in the same selection set.

Any change to CO2 conversion must be clinically reviewed and tested against raw device output, Hidro rows, FLORA minute payloads, and the printed report.

### 4.10 Manual timeline versus automatic timeline

Automatic values live in `vital_minutes`.

Manual overrides/entries live in `case_timeline_value`, with audit records in `case_timeline_audit`.

The UI and report use effective timeline APIs to combine the two. A successor must preserve:

- the distinction between original automatic data and user-entered changes
- actor identity and change reason where required
- deterministic effective-value selection
- report consistency with what the user reviewed

### 4.11 Authentication and local users

FLORA implements local password authentication with:

- salted password hashes
- hashed session tokens
- session expiry and revocation
- active/inactive users
- admin-only user management
- self-service password and preference changes
- authentication audit records

Default session TTL is 30 days unless `FLORA_AUTH_SESSION_TTL_MS` is set.

The current bootstrap/sync code has a fallback staff password of `flora` unless `FLORA_DEFAULT_STAFF_PASSWORD` is set. Treat this as a deployment security risk:

- set a non-default deployment policy
- require password change
- do not publish real credentials
- record who owns account lifecycle
- disable departing users

Authentication is local application security. It does not replace Windows login, hospital identity governance, or network access control.

### 4.12 HIS and hospital integration

The current backend default gateway is:

```text
http://10.35.202.6:8590
```

It can be replaced by `HIS_GATEWAY_BASE_URL`. The default request timeout is 45 seconds.

Current backend paths include:

- patient/HIS lookup and preload
- pre-admission buffer
- case patient snapshot sync
- allergy retrieval/sync
- laboratory retrieval/sync
- blood-product list
- blood-product verification

Blood-product endpoints support real and mock/local modes controlled by environment flags. Do not assume a UI demo or mock result proves a live blood-bank integration.

The gateway IP and paths are KCMH-specific evidence, not a universal FLORA contract. Every hospital requires an interface sheet containing:

- service owner
- base URL
- endpoint paths
- authentication method
- HN/AN formatting
- payload examples
- timeout/retry behavior
- expected errors
- maintenance window
- escalation contacts

### 4.13 EPHIS

Current worktree code contains EPHIS routes and UI work:

- import status
- daily summary
- daily cases
- daily-case import

Because these files were uncommitted at handbook preparation time, treat EPHIS as work-in-progress until it is committed, packaged, tested, and accepted.

### 4.14 Reports

There are two report-related paths:

- browser/Electron print workflow
- direct PDF construction using `electron/reportPdf.cjs`

The direct PDF path receives a report model from the renderer, embeds fonts and branding assets, builds A4 pages, and returns PDF bytes through Electron IPC. The preview path writes a temporary PDF and opens it.

Report validation must cover:

- patient identifiers
- case times and timezone
- staff
- diagnosis/procedure
- forms and line summaries
- events
- manual and automatic timeline values
- medication bolus and drip segments
- fluids, outputs, and blood products
- edition branding
- Thai and English font rendering
- page count and timeline bucket size
- printer output, not only screen preview

A successful frontend build does not prove report correctness.

### 4.15 Editions

The code recognizes:

- `full`
- `rcat`
- `eforl`

Edition selection comes from `FLORA_EDITION` or package metadata.

Edition behavior includes:

- product name and Windows application identity
- allowed timeline scales
- allowed report modes
- theme restrictions
- allowed timeline parameters
- EforL-specific branding

Build commands:

```powershell
npm run desktop:package:win
npm run desktop:package:win:eforl
```

The packaging script also accepts `-Edition full`, `-Edition rcat`, or `-Edition eforl`.

Do not distribute an edition by changing only the visible logo. Verify package metadata, application identity, feature restrictions, report output, and installer filename.

## 5. Hidro architecture in detail

### 5.1 Technology stack

- Node.js/CommonJS service
- Express REST API
- `sqlite3`
- `serialport`
- Electron `40.x` tray shell
- React `18.x` tray UI
- Windows-first packaging with NSIS

### 5.2 Runtime model

In the packaged application, the Hidro Electron process can start and supervise a Node service process.

The tray resolves:

- API URL
- service script and work directory
- Node executable
- runtime directory
- data directory
- log directory
- PID file
- configured service port

It checks whether port `3000` is occupied, probes health, avoids automatically killing an unknown process, writes service stdout/stderr logs, and exposes reconnect or hard-reset controls.

The default Windows application install location used by the startup VBS is:

```text
%LOCALAPPDATA%\Programs\Hidro\Hidro.exe
```

### 5.3 Default runtime paths

Packaged defaults are derived from `PORJAI_ROOT`, normally `C:\porjai`.

The operationally important paths are:

| Item | Typical/default location |
| --- | --- |
| Hidro data directory | `C:\porjai\data` |
| Hidro configuration | `C:\porjai\data\config.local.json` |
| Hidro database | `<HIDRO_DATA_DIR>\ivy.db` |
| Runtime directory | `C:\porjai\hidro-runtime` |
| Service log directory | `C:\porjai\hidro-runtime\logs` |
| Service logs | `ivy-node.out.log` and `ivy-node.err.log` in the service log directory |
| Service PID file | `C:\porjai\hidro-runtime\ivy-node.pid` |
| Tray user data | `%LOCALAPPDATA%\Hidro` unless overridden |

Always use the tray's runtime information or startup logs to confirm the exact deployed paths.

### 5.4 Configuration precedence

`service/settings.js` reads:

```text
<HIDRO_DATA_DIR>\config.local.json
```

For settings managed there, JSON values take precedence over environment variables.

Current known room configuration keys include:

```json
{
  "GEBx50_PORT": "COM7",
  "GEAISYS_PORT": "COM8",
  "GE750_PORT": "OFF",
  "GE750_AUTO_PICK_FIRST": false
}
```

This is an example shape only. Do not copy COM values from one room to another.

Recognized off values include `OFF`, `NONE`, `DISABLED`, `0`, and `FALSE`.

### 5.5 Current service-profile truth

The repository contains more device code than the current `service/server.js` profile actively starts.

Current profile behavior from code:

| Service | Current enablement |
| --- | --- |
| GE Bx50/B650 path | enabled unless explicitly off; blank may mean auto |
| GE Aisys path | enabled unless explicitly off; blank may mean auto |
| GE750-family backend | used for the Aisys profile when configured |
| B. Braun BCC | enabled only when a non-off host is configured |
| HL7 listener | present in repository but disabled in the current server profile |
| GE S/5 path | present but explicitly disabled by current settings profile |
| VSCapture JSON fallback | optional module load; verify whether the source exists in the release |

This table is more authoritative for the current build than the broad supported-device list in the README.

### 5.6 Driver defaults

| Driver | Default transport configuration |
| --- | --- |
| GE Carestation 750 | `COM6`, `19200`, 7 data bits, odd parity, 1 stop bit, 1-second poll |
| GE Bx50 | `COM7`, `19200`, 8 data bits, even parity, 1 stop bit |
| GE Aisys/CARESCAPE path | `COM8`, `115200`, 8 data bits, even parity, 1 stop bit |
| GE S/5 | `COM8`, `19200`, 8 data bits, even parity, 1 stop bit, RTS/CTS |
| B. Braun BCC | host `OFF`, port `4001`, bed `1/1/1`, 5-second poll |
| HL7 listener | port `6000` when separately run/enabled |

Defaults are development conveniences, not a hospital room configuration.

### 5.7 Hidro database

The database filename is `ivy.db`.

SQLite behavior:

- WAL journal mode
- `synchronous=NORMAL`
- 3-second busy timeout
- automatic WAL checkpointing
- 16 MB negative cache-size setting
- checkpoint/recovery on open
- checkpoint/truncate on controlled close

Main tables:

| Table | Purpose |
| --- | --- |
| `ivy_observations` | normalized observation history with source, protocol, raw code, value, unit, timestamps, and device ID |
| `parameter_aliases` | `(protocol, raw_code)` to normalized `ivy_param` and unit |
| `unknown_params` | first seen, last seen, and count for unmapped codes |

Important timestamps:

- `system_ts`: time Hidro received/processed the observation; used by FLORA queries
- `device_ts`: timestamp provided by the source device when available
- `created_at`: insertion time

### 5.8 Retention discrepancy

Current `service/db.js` uses:

```text
HIDRO_RETENTION_DAYS, default 180
```

Some README/comments refer to `IVY_RETENTION_DAYS` and a 90-day default. That documentation is stale. The executable code is currently authoritative.

Set `HIDRO_RETENTION_DAYS=0` to disable observation pruning, but do so only with an explicit storage and clinical-record policy.

### 5.9 Parameter normalization

Device drivers emit a raw code and protocol identity. Hidro resolves those through `parameter_aliases`.

If a mapping exists:

- store the normalized `ivy_param`
- use the configured/driver unit

If no mapping exists:

- store or expose an `unknown::<raw-code>` form where applicable
- update `unknown_params`
- investigate using `/debug/unknown`

Parameter-map changes must be synchronized between:

- Hidro `shared/floraParamMap.js`
- FLORA `shared/floraParamMap.js`
- FLORA timeline metadata
- report metadata
- edition allowlists

### 5.10 REST API

#### Health

```http
GET /health
```

#### Observations

```http
GET /api/observations?from=<epoch-ms>&to=<epoch-ms>
GET /api/observations/bulk?from=<epoch-ms>&to=<epoch-ms>&limit_minutes=60
```

The normal endpoint returns rows ordered by `system_ts`.

The bulk endpoint groups by minute and parameter and returns the last value for each parameter in each minute. It does not average values because averaging would corrupt string-like values such as ventilation mode or I:E ratio.

#### Status

```http
GET /api/devices/status
GET /api/devices/status?online_window_sec=30
```

The online window is constrained to 5-300 seconds. The service queries recent history using a longer status lookback, default 15 minutes.

#### Local administration

```http
GET  /api/admin/services
POST /api/admin/reconnect
POST /api/admin/shutdown
```

Admin endpoints are localhost-only unless `HIDRO_ALLOW_REMOTE_ADMIN=1`.

#### Debug and test

```http
GET  /debug/ge750
GET  /debug/unknown
GET  /debug/observations
POST /mock/device
```

Never leave a remotely reachable mock-ingest or admin surface exposed without an approved security design.

### 5.11 Status semantics

Do not collapse these into one "online/offline" label:

1. Hidro HTTP service reachable
2. driver enabled
3. COM/TCP transport connected or connecting
4. protocol exchange functioning
5. observations received recently
6. FLORA successfully fetched observations
7. FLORA wrote a case minute

The tray intentionally separates port/transport status from data status. A transport may report an unexpected state while recent data still exists, and the opposite may also occur.

### 5.12 USB/serial recovery

Known recovery paths include:

- driver reconnect through the local admin endpoint
- service restart
- selected COM-port hard reset
- elevated PnP device restart using `pnputil`
- disable/enable PnP fallback
- physical USB hub power cycle
- unplug/replug
- workstation restart

Use the least disruptive action that matches the failed layer. Do not restart the whole workstation first unless local clinical policy or the observed failure requires it.

## 6. Exact FLORA-Hidro data contract

### 6.1 Observation shape

FLORA expects Hidro observation rows containing at least:

```json
{
  "ivy_param": "hr",
  "value": 72,
  "unit": "bpm",
  "system_ts": 1780000000000
}
```

`device_ts` may also be present.

### 6.2 Time windows

FLORA queries complete minute windows:

```text
from = minute floor
to   = from + 60000
```

The database uniqueness rule is:

```text
(case_id, ivy_source, ts_minute)
```

### 6.3 Supported-key behavior

Rows not recognized by `toFloraParamKey` are ignored for FLORA minute payloads. They may still exist in Hidro.

This means:

- Hidro receiving data does not guarantee FLORA displays it
- an unknown parameter can be a mapping problem rather than a transport problem
- adding a parameter requires end-to-end changes, not only a driver edit

### 6.4 End-to-end proof

For one test parameter, collect all of:

1. raw device frame/message
2. driver parser output
3. `ivy_observations` row
4. response from `/api/observations`
5. FLORA `case_device_ingest_audit` row
6. FLORA `vital_minutes.payload`
7. visible timeline value
8. generated PDF value

Only then is the integration proven.

## 7. Build and development

### 7.1 Supported workstation assumptions

- Windows 10/11, preferably a standardized hospital-approved image
- Node.js 18+; record the exact validated Node version for releases
- npm
- PowerShell
- Visual C++ build/runtime prerequisites required by native modules
- access to real or simulated device data for integration work

Lock files are committed and should be used.

### 7.2 FLORA install and build

```powershell
Set-Location C:\Users\onlys\Flora
npm install

Set-Location frontend
npm install

Set-Location ..\backend
npm install

Set-Location ..
npm run desktop:build:web
```

Run:

```powershell
npm run desktop:start
```

Run without rebuilding:

```powershell
npm run desktop:start:no-build
```

Package:

```powershell
npm run desktop:package:win
```

Output:

```text
dist-electron\Flora-Setup-<version>.exe
```

Packaging rebuilds the native `better-sqlite3` module for Electron and retries transient installer-lock failures.

### 7.3 Hidro install and build

```powershell
Set-Location C:\Users\onlys\Hidro
npm install
npm run service:install
npm run build:frontend
```

Run tray:

```powershell
npm start
```

Run service only:

```powershell
Set-Location service
npm run server
```

Package:

```powershell
Set-Location ..
npm run package:win
```

Output:

```text
dist-hidro\Hidro-Setup-<version>.exe
```

### 7.4 Existing test commands

FLORA:

- frontend build: `npm run desktop:build:web`
- frontend lint: run `npm run lint` from `frontend`
- IO API test script: `backend/scripts/test_io_api.js`
- master-data check: `npm run db:check:master -- <db-path>`
- there is no comprehensive automated clinical regression suite

Hidro:

```powershell
Set-Location service
npm run preflight
npm run ge750:regression
npm run live:test
```

Hidro has no single top-level automated `npm test`.

## 8. Deployment runbook

### 8.1 Before arriving onsite

Prepare:

- exact FLORA and Hidro installer versions
- SHA-256 hashes
- release notes
- known-good database backup
- prepared database for a new site, if applicable
- site-specific `config.local.json`
- room/device/COM/IP inventory
- protocol and cable requirements
- rollback installers
- test case and expected report
- secure access instructions
- hospital IT and biomedical contacts

### 8.2 New workstation deployment

1. Confirm the Windows asset, room, owner, date/time/timezone, and admin-access process.
2. Confirm medical-device communication modules are enabled by biomedical staff.
3. Install required USB/serial drivers from an approved source.
4. Record adapter manufacturer, chipset, hardware ID, and assigned COM port.
5. Disable inappropriate USB selective-suspend/power-saving only under approved workstation policy.
6. Install Hidro.
7. Place the room configuration in `C:\porjai\data\config.local.json`.
8. Start Hidro and verify `/health`.
9. Verify transport and data status separately.
10. Verify raw and normalized observations.
11. Install FLORA.
12. Place the approved `flora.db` in `C:\porjai\data\flora.db`.
13. Start FLORA and confirm the bootstrap screen reports the expected DB path.
14. Verify login and force replacement of any default password.
15. Verify master data.
16. Start a controlled test case.
17. Confirm Hidro-to-FLORA minute flow.
18. Enter a manual event, medication, fluid, and required form data.
19. Discharge the test case.
20. Generate and print a report.
21. Record acceptance evidence and rollback material.

### 8.3 Existing workstation upgrade

1. Identify currently installed versions and room configuration.
2. Stop active clinical use; never upgrade during an active case.
3. Record the effective FLORA DB path and Hidro data/config paths.
4. Copy `flora.db`, `flora.db-wal`, and `flora.db-shm` only after controlled shutdown/checkpoint.
5. Back up `ivy.db` and its WAL/SHM after Hidro shutdown.
6. Back up `config.local.json`.
7. Hash and timestamp backups.
8. Install the new Hidro version.
9. Verify device connectivity and observations.
10. Install the new FLORA version.
11. Allow schema bootstrap only against a disposable restored copy first when the change is significant.
12. Verify login, active-case state, timeline, IO, forms, HIS, report, and printer.
13. Keep rollback installer and pre-upgrade database copies until acceptance.

### 8.4 Startup automation

`StartHidro.vbs` waits 20 seconds and launches:

```text
%LOCALAPPDATA%\Programs\Hidro\Hidro.exe
```

`StartHidroWithPortReset.vbs` uses the packaged `Reset-HidroPorts.ps1` and is intended for a Scheduled Task with highest privileges when Windows-side USB reset is required.

Document whether each room uses:

- normal user Startup folder
- Task Scheduler
- service-style startup
- manual launch

Do not deploy both competing startup mechanisms without testing duplicate-instance behavior.

## 9. Backup, restore, retention, and recovery

### 9.1 What must be backed up

Minimum:

- `C:\porjai\data\flora.db`
- its WAL/SHM when the app was not shut down cleanly
- Hidro `ivy.db`
- Hidro `config.local.json`
- installer packages and hashes
- site/room configuration record
- protocol samples and acceptance evidence
- report samples
- release notes

### 9.2 Safe SQLite backup principle

Preferred order:

1. stop clinical writes
2. close FLORA/Hidro normally
3. verify processes stopped
4. copy the main DB
5. retain WAL/SHM if shutdown status is uncertain
6. test the backup by opening a copy

Never delete WAL/SHM from a live or uncertain database simply to make a lock error disappear. The FLORA recovery script removes WAL/SHM only as part of its specific startup-recovery workflow; use it with full awareness of the risk and a prior backup.

### 9.3 FLORA retention

Current code prunes `vital_minutes` older than `FLORA_RETENTION_DAYS`, default 360 days. Set `0` to disable.

This concerns automatic minute rows, not a complete hospital clinical-record retention policy. Confirm legal and hospital retention requirements before changing it.

### 9.4 Hidro retention

Current code prunes observations using `HIDRO_RETENTION_DAYS`, default 180 days. Set `0` to disable.

### 9.5 Active-case repair

Inspect:

```powershell
$env:FLORA_DB_PATH = "C:\porjai\data\flora.db"
node scripts\repair-flora-db.js status
```

Force all active cases to archived:

```powershell
node scripts\repair-flora-db.js force-idle
```

`force-idle` is clinically meaningful and destructive to current workflow state. Use only after confirming there is no legitimate active case, making a backup, and recording approval.

## 10. Operational health checks

### 10.1 Five-minute workstation check

```powershell
Invoke-RestMethod http://127.0.0.1:3000/health
Invoke-RestMethod http://127.0.0.1:3000/api/admin/services
Invoke-RestMethod http://127.0.0.1:3000/api/devices/status
Invoke-RestMethod http://127.0.0.1:3001/health
Invoke-RestMethod http://127.0.0.1:3001/debug/minute-writer
Invoke-RestMethod http://127.0.0.1:3001/debug/flow
```

Then:

- confirm the correct FLORA database path
- confirm an active case only when clinically expected
- confirm recent observations have plausible timestamps
- confirm FLORA recently wrote minute rows
- inspect the UI timeline
- generate a report when validating a deployment

### 10.2 Layered diagnosis

Use this order:

```text
Physical device output
  -> cable / adapter / network
  -> Windows COM/TCP availability
  -> Hidro driver transport
  -> Hidro parser
  -> ivy.db observation
  -> Hidro REST response
  -> FLORA minute writer
  -> flora.db minute row
  -> FLORA UI
  -> PDF / printer
```

Stop at the first failed layer. Avoid changing multiple layers at once.

## 11. Troubleshooting playbooks

### 11.1 Hidro health fails

Check:

- whether port `3000` is listening
- which process owns the port
- tray service status
- `ivy-node.out.log`
- `ivy-node.err.log`
- service script path and working directory
- Node/native dependency errors
- permissions on runtime and data directories
- corrupt or locked `ivy.db`

Do not let Hidro kill an unknown process merely because it owns port `3000`.

### 11.2 Hidro is healthy but one device is missing

Check:

- driver enabled in `config.local.json`
- correct COM/IP/bed identifier
- Device Manager and port hardware ID
- cable and adapter
- baud/parity/stop bits
- port claim conflicts
- driver transport status and last error
- raw debug logging
- known-good device output

If the other device continues to send data, focus on the missing device path rather than restarting everything.

### 11.3 Port looks connected but data is stale

Check:

- protocol request/response, not only open COM handle
- `last_seen_ts`
- samples in the online window
- raw frames
- parser errors
- unmapped parameters
- device-side export mode
- long-running adapter/driver failure

### 11.4 Data exists in Hidro but not FLORA

Check:

1. `/api/observations` for the exact minute
2. `ivy_param` is recognized by `shared/floraParamMap.js`
3. FLORA active case and start time
4. `/debug/minute-writer`
5. `/debug/flow`
6. `case_device_ingest_audit`
7. `vital_minutes`
8. manual/effective timeline selection

### 11.5 FLORA backend fails

Check:

- port `3001` owner
- bootstrap log
- backend child exit details
- database path and file existence
- write permission
- `better-sqlite3` native-module compatibility
- schema/bootstrap error
- stale PID file
- unclean-shutdown marker and recovery state

### 11.6 FLORA UI opens but data is wrong or missing

Check:

- current case ID and status
- correct database path
- API response in the relevant frontend call
- effective timeline versus raw automatic rows
- case time range
- edition parameter restrictions
- browser local-storage report/timeline preferences

### 11.7 Report differs from the case screen

Compare:

- report model built by `ReportView.tsx`
- report bucket size and page windows
- selected timeline parameters
- effective timeline values
- IO run/segment semantics
- event filtering
- report PDF renderer
- edition restrictions

Save the case ID, database copy, generated PDF, screenshots, and exact build commit.

### 11.8 USB/serial instability

Known observations:

- status may show offline while data still arrives
- a port may remain open while protocol data stops
- unplug/replug may recover some failures
- some failures require PnP reset or Windows restart
- behavior differs by workstation and room
- application-level retry logic has already been expanded

Capture for every incident:

- hospital and room
- workstation name/IP and Windows build
- adapter make, chipset, hardware ID, and serial number
- USB hub and cable path
- medical-device model/firmware
- COM port and serial settings
- Hidro version/commit
- time started and time failed
- port status, data status, and last observation
- relevant logs
- recovery action and result

See [HIDRO-USB-Serial-Stability-Incident-Report.md](HIDRO-USB-Serial-Stability-Incident-Report.md).

## 12. Adding or changing a device integration

### 12.1 New device checklist

1. Obtain the official protocol specification and permission to use it.
2. Record model, firmware, communication module, connector, cable pinout, and electrical interface.
3. Decide serial, TCP, HL7, file, or vendor gateway.
4. Capture known-good raw messages.
5. Implement framing/checksum/ACK behavior.
6. Separate transport from parser.
7. Add deterministic parser fixtures.
8. map raw codes to normalized parameters and units.
9. audit unknown codes.
10. expose transport and data status separately.
11. test reconnect and long-running behavior.
12. test Hidro API.
13. update both shared parameter maps.
14. update FLORA timeline/report metadata and edition allowlists.
15. verify end-to-end with a test case and PDF.
16. document device configuration and acceptance evidence.

### 12.2 Changing COM/IP configuration

1. Record old value and rollback.
2. Stop the affected driver or service.
3. change only one variable.
4. verify the physical/network target.
5. restart or reconnect.
6. verify raw data.
7. verify normalized rows.
8. verify FLORA minutes.
9. verify report output.
10. update the room inventory.

## 13. Release management

### 13.1 Release gate

A release is not complete until all are recorded:

- clean Git commit
- product version
- branch/tag
- installer filename
- SHA-256
- database migration impact
- configuration impact
- supported edition
- tests performed
- device/site scope
- known issues
- rollback package
- clinical/IT acceptance owner

### 13.2 Minimum regression set

FLORA:

- login/logout and password change
- new case, overlap handling, discharge, archive
- patient and staff
- HIS mock/real mode as applicable
- automatic minute capture
- manual timeline override
- event add/edit/delete
- medication bolus
- drip start/rate change/stop
- fluid and output
- blood product authorization path
- forms save/load
- report preview/PDF/print
- unclean shutdown recovery

Hidro:

- health and status endpoints
- each enabled driver
- parser regression
- unknown parameter audit
- observation API and bulk API
- reconnect
- service shutdown/start
- port conflict behavior
- COM hard reset where supported
- 8-24 hour soak test for production device profiles

### 13.3 Version discrepancies

Root package versions, service package versions, installer metadata, and release notes are not currently managed by one release tool. The successor should add a release script/check that fails when these disagree.

## 14. Security, privacy, and clinical safety

- Never commit patient data, production DBs, passwords, tokens, certificates, or private network records to a public repository.
- Keep hospital-specific configuration in a private, access-controlled location.
- Change default local passwords.
- Keep Hidro admin endpoints localhost-only unless a reviewed security requirement says otherwise.
- Treat mock blood/product and mock device modes as non-production.
- Record actor identity for clinically meaningful edits.
- Preserve audit tables.
- Do not silently rewrite historical clinical records.
- Back up before schema changes or repair operations.
- Do not infer medical-device approval from successful parsing.
- Clinical staff must accept report layout and data semantics.
- Hospital IT/biomedical staff must accept network and device connection changes.

### 14.1 Current local-API exposure risk

Both Express servers call `listen(port)` without an explicit loopback host. The
applications are designed and documented as local services, but the operating
system may bind them on all interfaces. Windows Firewall may block remote access,
but that must not be assumed.

Additional current facts:

- FLORA enables open CORS.
- FLORA authentication routes protect user-management operations, but the
  `/api/case` router does not have blanket session-authentication middleware.
- Several case audit paths accept actor identity from the request body.
- Hidro restricts `/api/admin/*` to localhost by default.
- Hidro observation, debug, and mock-ingest endpoints do not have equivalent
  authentication in the current code.

Required deployment control:

1. block ports `3000` and `3001` from untrusted networks
2. verify listening addresses with `Get-NetTCPConnection`
3. prefer changing both services to bind explicitly to `127.0.0.1`
4. add real authentication/authorization before any remote or client-server use
5. disable or compile out mock/debug surfaces in production

Do not expose the current local profile directly to a hospital VLAN or the
internet as though it were a secured server product.

## 15. Known risks and technical debt

### Highest risk

1. USB/serial stability varies by workstation, adapter, and room.
2. Device transport status can disagree with actual data flow.
3. FLORA lacks a comprehensive automated clinical regression suite.
4. Hidro driver maturity differs widely.
5. FLORA startup performs lightweight schema migrations without a formal migration ledger.
6. Existing databases may contain duplicate/inconsistent staff identities.
7. Report correctness depends on many frontend and backend data paths.
8. Hospital integrations are site-specific and can fail outside Porjai code.
9. Current FLORA worktree includes uncommitted features and fixes.
10. Documentation and code disagree on Hidro retention settings.

### Medium risk

- default local staff password behavior
- no single centralized release/version verification
- no enterprise monitoring or alerting by default
- no standard queue/DLQ system
- room configuration inventory is not consolidated in source control
- public/private repository boundary requires active management
- optional modules may be referenced but absent from a packaged source set

### Planned, not guaranteed delivered

- broader Draeger support
- broader infusion-pump support
- central/client-server synchronization
- remote viewer and document management
- multi-room centralized operation
- appliance/Hidro Box transport isolation

## 16. Site-specific information that must accompany this handbook

Code cannot answer the following. The outgoing owner, hospital IT, biomedical team, and product owner must complete this table for every live site.

| Field | Required value |
| --- | --- |
| Hospital/site | |
| Room/unit | |
| Clinical owner | |
| Hospital IT owner | |
| Biomedical owner | |
| Porjai support owner | |
| Workstation asset/name/IP | |
| Windows version/image date | |
| FLORA version/commit/hash | |
| Hidro version/commit/hash | |
| FLORA DB path | |
| Hidro data/config/log paths | |
| Patient monitor model/firmware | |
| Anesthesia machine model/firmware | |
| Pump/gateway model/version | |
| COM ports/IPs/TCP ports | |
| Adapter/hub/cable details | |
| HIS gateway owner and contract | |
| Printer queue/path | |
| Startup method | |
| Backup location and retention | |
| Last accepted end-to-end test | |
| Known incidents | |
| Escalation contacts | |
| Status | planned/testing/active/blocked/retired |

Keep sensitive values in the hospital-approved system of record and reference that record here.

## 17. Ownership and escalation model

| Failure | First owner | Evidence to collect |
| --- | --- | --- |
| Device not outputting | Biomedical/device vendor | device settings, protocol mode, cable |
| COM/USB missing | Hospital IT/biomedical | Device Manager, hardware ID, adapter path |
| Hidro driver/parsing | Hidro engineering | raw frame, driver log, config, version |
| Hidro API/database | Hidro engineering | health, logs, `ivy.db`, endpoint response |
| FLORA minute capture | FLORA engineering | Hidro response, writer status, ingest audit |
| Case workflow | FLORA engineering + clinical owner | case ID, steps, DB copy, screenshots |
| HIS data | Hospital interface owner + FLORA engineering | request/response, endpoint, upstream logs |
| Report clinical content | FLORA engineering + clinical owner | case data, PDF, expected result |
| Printer/network | Hospital IT | queue, driver, connectivity, Windows logs |
| Security/access | Hospital security/IT | account, policy, audit, access record |

## 18. Successor onboarding

### First day

- obtain repository and issue-tracker access
- verify access to installers, private deployment records, and secure secrets
- build both products
- run Hidro mock data
- run FLORA against a disposable test DB
- trace one mock observation end-to-end

### First week

- review database schemas
- reproduce a full case workflow
- generate and print a report
- inspect every enabled Hidro driver
- review one real room configuration
- perform a controlled backup/restore
- map current hospital owners

### First month

- create a clean tagged release baseline
- consolidate room inventory
- add release/version consistency checks
- add automated end-to-end smoke tests
- run a long soak test on production device paths
- close or assign every `TBD` in this handbook
- hold a joint clinical/IT/biomedical handoff review

## 19. Final transfer package

The successor should receive:

- FLORA repository and full history
- Hidro repository and full history
- exact release tags
- latest known-good installers and hashes
- release notes
- this handbook and satellite handoff documents
- test database without patient data
- secure production backup-transfer procedure
- room/device inventory
- protocol specifications and raw samples
- hospital interface contracts
- report acceptance samples
- issue/incident history
- ownership and escalation contacts
- account/secret transfer through a secure channel
- written confirmation that departing access was revoked after acceptance

## 20. Configuration reference

### 20.1 FLORA environment variables

| Variable | Current default / behavior | Purpose |
| --- | --- | --- |
| `PORJAI_ROOT` | `C:\porjai` in packaged Electron | base for packaged runtime data |
| `FLORA_DB_PATH` | explicit override | primary database-path override |
| `FLORA_DB_PATH` | secondary override | alternate database-path override |
| `FLORA_BACKEND_PORT` | `3001` | Electron health and backend port |
| `PORT` | `3001` when backend starts alone | Express listen port |
| `FLORA_EDITION` | package metadata or `full` | `full`, `rcat`, or `eforl` |
| `FLORA_FRONTEND_URL` | none | load a development frontend URL |
| `VITE_DEV_SERVER_URL` | none | alternate development frontend URL |
| `FLORA_NODE_BIN` | runtime-resolved | override Node executable for backend |
| `FLORA_USER_DATA_DIR` | edition-specific `%LOCALAPPDATA%` directory | Electron profile and PID fallback |
| `FLORA_SESSION_DATA_DIR` | `<user-data>\Session` | Electron session data |
| `FLORA_CACHE_DIR` | `<user-data>\Cache` | Chromium disk cache |
| `FLORA_BACKEND_PID_FILE` | `<user-data>\flora-backend.pid` | child-backend ownership record |
| `IVY_READ_URL` | `http://127.0.0.1:3000/api/observations` | Hidro minute endpoint |
| `IVY_BULK_READ_URL` | localhost bulk endpoint | Hidro catch-up endpoint |
| `MINUTE_WRITER_POLL_MS` | `1000` | writer polling interval |
| `MINUTE_WRITER_FETCH_TIMEOUT_MS` | `5000` | one Hidro fetch timeout |
| `MINUTE_WRITER_MAX_BACKFILL` | `60` | maximum backfill work per tick |
| `MINUTE_WRITER_BULK_THRESHOLD_MS` | `300000` | switch to bulk after five minutes |
| `MINUTE_WRITER_STALL_RESTART_MS` | `45000`, minimum `30000` | writer reconciliation threshold |
| `FLORA_RETENTION_DAYS` | `360` | automatic minute retention; `0` disables |
| `FLORA_AUTH_SESSION_TTL_MS` | 30 days | local session lifetime |
| `FLORA_DEFAULT_STAFF_PASSWORD` | `flora` | bootstrap/sync fallback; replace in production |
| `HIS_GATEWAY_BASE_URL` | `http://10.35.202.6:8590` | hospital gateway |
| `HIS_GATEWAY_TIMEOUT_MS` | `45000` | hospital request timeout |
| `HIS_BLOOD_PRODUCT_LIST_PATH` | `/api/blood-product-list` | blood-product list path |
| `HIS_BLOOD_PRODUCT_VERIFY_PATH` | `/api/blood-product-verify` | blood verification path |
| `HIS_BLOOD_PRODUCT_LIST_REAL` | flag-controlled | use real list service |
| `HIS_BLOOD_PRODUCT_LIST_MOCK` | flag-controlled | force mock/local list |
| `HIS_BLOOD_PRODUCT_VERIFY_REAL` | flag-controlled | use real verification |
| `HIS_BLOOD_PRODUCT_VERIFY_MOCK` | flag-controlled | force mock/local verification |

Edition-specific default user-data directories:

| Edition | Directory |
| --- | --- |
| full | `%LOCALAPPDATA%\FloraDesktop` |
| RCAT | `%LOCALAPPDATA%\FloraDesktopRCAT` |
| EforL | `%LOCALAPPDATA%\FloraDesktopEforL` |

### 20.2 Hidro tray/service environment variables

| Variable | Current default / behavior | Purpose |
| --- | --- | --- |
| `PORJAI_ROOT` | `C:\porjai` | packaged runtime base |
| `HIDRO_API_URL` | `http://127.0.0.1:3000` | tray-to-service URL |
| `HIDRO_SERVICE_PORT` | `3000` | port passed by tray to child service |
| `PORT` | `3000` | service Express port |
| `HIDRO_SERVICE_NAME` | `IvyCaptureService` | legacy/service-control name |
| `HIDRO_POLL_MS` | `5000` | tray status polling |
| `HIDRO_AUTO_LOGIN` | packaged app enables login startup handling | startup behavior |
| `HIDRO_AUTOSTART_SERVICE` | `1` | tray starts child Node service |
| `HIDRO_AUTOSTART_DELAY_MS` | `3000` | delayed service startup |
| `HIDRO_TEST_MODE` | `0` packaged, `1` development | live-agent test behavior |
| `HIDRO_NODE_EXE` | `node` | child service executable |
| `HIDRO_SERVICE_SCRIPT` | bundled `resources\service\server.js` when packaged | service entry point |
| `HIDRO_SERVICE_WORKDIR` | service-script directory | child working directory |
| `HIDRO_DATA_DIR` | `C:\porjai\data` packaged | `ivy.db` and local config |
| `HIDRO_RUNTIME_DIR` | `C:\porjai\hidro-runtime` packaged | PID and logs |
| `HIDRO_SERVICE_LOG_DIR` | `<runtime>\logs` | service/tray diagnostics |
| `HIDRO_SERVICE_PID_FILE` | `<runtime>\ivy-node.pid` | child ownership record |
| `HIDRO_USER_DATA_DIR` | `%LOCALAPPDATA%\Hidro` | tray profile |
| `HIDRO_SESSION_DATA_DIR` | `<user-data>\Session` | tray session |
| `HIDRO_CACHE_DIR` | `<user-data>\Cache` | tray cache |
| `HIDRO_ALLOW_REMOTE_ADMIN` | `0` | remote `/api/admin/*`; keep disabled |
| `HIDRO_STATUS_LOOKBACK_MS` | 15 minutes, minimum 5 minutes | status query history |
| `HIDRO_RETENTION_DAYS` | `180` | observation retention; `0` disables |

### 20.3 Hidro device variables

| Device path | Variables |
| --- | --- |
| GE Carestation 750 | `GE750_PORT`, `GE750_COM_PORT`, `GE750_BAUD`, `GE750_DATA_BITS`, `GE750_STOP_BITS`, `GE750_PARITY`, `GE750_POLL_MS`, `GE750_EMIT_MS` |
| GE750 diagnostics | `GE750_DEBUG_FGF_RAW`, `GE750_DEBUG_FIO2_RAW`, `GE750_DEBUG_MODE_TRACE`, `GE750_DEBUG_VTQ_RAW` |
| GE Bx50/B650 | `GEBx50_PORT`, `GEBx50_COM_PORT`, `GEBx50_BAUD`, `GEBx50_RTSCTS`, `GEBx50_DEBUG_RAW`, `GEBx50_RESET_LOW_MS`, `GEBx50_RESET_HIGH_MS` |
| GE Aisys/CARESCAPE | `GEAISYS_PORT`, `GEAISYS_COM_PORT`, `GEAISYS_BAUD`, `GEAISYS_RTSCTS`, `GEAISYS_DEBUG_RAW` |
| GE S/5 | `GES5_PORT`, `GES5_RTSCTS`, `GES5_DEBUG_RAW` |
| B. Braun BCC | `BBRAUNBCC_HOST`, `BBRAUNBCC_PORT`, `BBRAUNBCC_BED_ID`, `BBRAUNBCC_POLL_SEC` |
| HL7 | `IVY_HL7_HOST`, `IVY_HL7_PORT`, `IVY_HL7_DEVICE_ID`, `IVY_HL7_LOG_RAW`, `IVY_HL7_LOG_MAX_CHARS`, `IVY_HL7_SKIP_ZERO` |
| HL7 monitor reachability | `IVY_MONITOR_IP`, `IVY_MONITOR_PING_MS`, `HL7_MONITOR_IP`, `GE_B105_IP`, `HL7_HOST`, `HL7_PORT` |
| Mock/live agent | `IVY_MOCK_URL`, `LIVEAGENT_MONITOR_DEVICE_ID`, `LIVEAGENT_MACHINE_DEVICE_ID`, `LIVEAGENT_VERBOSE`, `LIVEAGENT_MAX_INFLIGHT`, `LIVEAGENT_FETCH_TIMEOUT_MS`, `LIVEAGENT_MAX_RETRIES`, `LIVEAGENT_RETRY_DELAY_MS` |

Use the exact mixed-case spelling `GEBx50_*` used by the current code. Store
room settings in `config.local.json` where supported and reserve environment
variables for controlled deployment overrides.

## 21. Related documents

- [HANDOFF.md](HANDOFF.md)
- [HANDOFF-FLORA.md](HANDOFF-FLORA.md)
- [HANDOFF-HIDRO.md](HANDOFF-HIDRO.md)
- [HANDOFF-HOSPITAL-CONTEXT.md](HANDOFF-HOSPITAL-CONTEXT.md)
- [HANDOFF-SHARED-ASSETS-AND-OPERATIONS.md](HANDOFF-SHARED-ASSETS-AND-OPERATIONS.md)
- [HANDOFF-RISKS-AND-OPEN-QUESTIONS.md](HANDOFF-RISKS-AND-OPEN-QUESTIONS.md)
- [Medical-Device-Integration-Handover-Checklist-Response.md](Medical-Device-Integration-Handover-Checklist-Response.md)
- [FLORA-Next-Developer-Brief.md](FLORA-Next-Developer-Brief.md)
- [FLORA-Architecture-Flow-Diagram-Guide.md](FLORA-Architecture-Flow-Diagram-Guide.md)
- [FLORA-Database-Diagram-Guide.md](FLORA-Database-Diagram-Guide.md)
- [HIDRO-USB-Serial-Stability-Incident-Report.md](HIDRO-USB-Serial-Stability-Incident-Report.md)
- [RELEASE_NOTES.md](RELEASE_NOTES.md)

## 22. Final warning

The repositories are sufficient for a competent engineer to understand and extend the software.

They are not, by themselves, sufficient to operate safely at every hospital. A complete takeover also requires the live room inventory, accepted installer/database baseline, hospital interface contracts, secure credentials, support ownership, and clinical acceptance evidence.

The successor should not have to ask the outgoing developer how the code works after reading and validating this handbook. Questions about hospital policy, device approval, credentials, and infrastructure must be directed to the owners of those systems rather than answered by guesswork.
