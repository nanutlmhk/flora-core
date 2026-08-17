# Hidro Handoff

## Purpose

Hidro is the device-integration middleware. It collects bedside device data, normalizes it, stores recent observations, and exposes a local HTTP API for AIDAS or another downstream application.

Hidro is not the anesthesia record and is not the HIS. Keeping that boundary clear is important for diagnosis and future replacement.

## Architecture

- `service/`: Node.js service, device drivers, database, normalization, and API.
- `electron/`: Windows tray application and diagnostics UI.
- `shared/`: parameter mapping and diagnostics helpers.
- `scripts/`: reset, packaging, and support utilities.

Default local API:

```text
http://127.0.0.1:3000
```

## Device Families In The Repository

The repository contains integration paths for GE monitors and anesthesia machines, Draeger devices, Philips/HL7 paths, and B. Braun infusion equipment. Production readiness differs by driver, protocol, wiring, adapter, and room environment.

Do not infer production support from a driver merely existing in the repository. Confirm it with a protocol test and real-device observation.

## Runtime Flow

1. A device sends serial, TCP, HL7, or vendor-protocol data.
2. A Hidro driver receives and parses it.
3. The driver maps raw values to normalized parameter keys.
4. Hidro stores observations and exposes local APIs.
5. AIDAS reads the observation stream and writes case-level data.

## Important APIs

- `GET /health`
- `GET /api/devices/status`
- `GET /api/observations`
- `GET /api/observations/bulk`
- local admin reconnect/service endpoints

## Operational Diagnosis

Always distinguish these states:

- service process is running
- serial/TCP transport is connected
- device protocol is responding
- observations are being received
- downstream AIDAS can read observations

The user-facing status should not collapse all of these into one online/offline label.

## Known High-Risk Area: USB/Serial

Observed deployment problems include random disconnects, false offline status, data continuing while transport status is wrong, and eventual data stoppage after long-running use. Attempts have included adapter replacement, USB hub testing, power-management changes, clean Windows installation, reconnect/reset logic, and additional diagnostics logging.

The incident history is documented in:

- `docs/HIDRO-USB-Serial-Stability-Incident-Report.md`
- `docs/HIDRO-USB-Serial-Stability-Incident-Report-TH.md`

## Build And Test

From the Hidro repository:

```powershell
npm install
npm run service:install
npm start
```

Service-only testing:

```powershell
Set-Location service
npm run server
npm run preflight
```

Before changing a driver, capture raw input, parser output, normalized observations, transport status, and timestamps.

## Handoff Checklist

- inventory each room's device model, adapter, COM/IP configuration, and cable path
- preserve raw protocol samples and test fixtures
- record which service and tray build are installed per room
- document how to restart the service without losing observations
- keep hospital-specific configuration and credentials outside the public repository
