# Hidro Tray Monitor (Electron)

Lightweight tray UI for Hidro/Ivy service status and basic service control.

## Start

From repo root:

```powershell
npm run ivy:tray:start
```

Or alias:

```powershell
npm run hidro:tray:start
```

## Build installer

From repo root:

```powershell
npm run hidro:package:win
```

Output:
- `dist-hidro/Hidro-Setup-0.1.0.exe`

Environment variables:

- `IVY_BASE_URL` (default `http://127.0.0.1:3000`)
- `IVY_SERVICE_NAME` (default `IvyCaptureService`)
- `IVY_TRAY_POLL_MS` (default `5000`)
- `IVY_TRAY_AUTO_LOGIN` (`1` to force start-at-login in dev; packaged app enables automatically)
- `HIDRO_TEST_MODE` (`1` = treat liveagent online feed as production-like connectivity in test env)

## Behavior

- Polls `/health` and `/api/devices/status`
- Shows tray color:
  - Green: Hidro reachable and at least one expected device online
  - Amber: Hidro reachable but no expected device online
  - Red: Hidro unreachable
- Menu actions:
  - Open monitor window
  - Open JSON status
  - Reconnect devices (`POST /api/admin/reconnect`)
  - Start/Stop/Restart Windows service (`sc.exe`)

Service control may require running tray as Administrator.
