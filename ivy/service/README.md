# Ivy Windows Service (Service EXE)

Run Ivy as an always-on Windows Service so capture continues even when Aidas/Hidro UI is closed.

This uses a dedicated service executable:
- `HidroServiceHost.exe` (service-native process)
- launches `node.exe ivy/server.js`

## 1) Build service host EXE

Run from repo root:

```powershell
powershell -ExecutionPolicy Bypass -File .\ivy\service\build-hidro-service-host.ps1
```

Default build is framework-dependent (lighter, easier offline build if .NET runtime already installed).
If you want self-contained:

```powershell
powershell -ExecutionPolicy Bypass -File .\ivy\service\build-hidro-service-host.ps1 -SelfContained -Runtime win-x64
```

Output:
- `ivy\service\HidroServiceHost\publish\HidroServiceHost.exe`

## 2) Optional: bundle runtime for no-system-Node deployment

This copies current `node.exe` + Ivy files to `ivy\service\runtime\...`

```powershell
powershell -ExecutionPolicy Bypass -File .\ivy\service\prepare-ivy-runtime.ps1
```

Runtime paths:
- `ivy\service\runtime\node.exe`
- `ivy\service\runtime\ivy\server.js`

## 3) Install service (Run PowerShell as Administrator)

Default install (auto-build host if missing):

```powershell
powershell -ExecutionPolicy Bypass -File .\ivy\service\install-ivy-service.ps1
```

Install using bundled runtime (recommended for client PC without Node):

```powershell
powershell -ExecutionPolicy Bypass -File .\ivy\service\install-ivy-service.ps1 `
  -NodeExe ".\ivy\service\runtime\node.exe" `
  -ScriptPath ".\ivy\service\runtime\ivy\server.js" `
  -WorkDir ".\ivy\service\runtime\ivy"
```

## 4) Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\ivy\service\uninstall-ivy-service.ps1
```

## Useful commands

```powershell
sc.exe query IvyCaptureService
sc.exe stop IvyCaptureService
sc.exe start IvyCaptureService
```

Service log file:
- `ivy\service\logs\hidro-service.log`

## Recommended Ivy environment variables

- `GE750_PORT` (optional fixed COM hint, e.g. `COM6`)
- `GE750_USB_VID` / `GE750_USB_PID`
- `GE750_USB_SERIAL`
- `GE750_USB_MANUFACTURER`
- `GE750_RECONNECT_MS` (default `3000`)
- `IVY_HL7_PORT` (default `6000`)

Ivy can recover serial capture when COM number changes by matching USB fingerprint.
