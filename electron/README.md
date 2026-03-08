# AIDAS Desktop Shell

This Electron shell runs:
- `frontend-v2` (UI)
- `backend` (API + SQLite)

It does **not** run `ivy` (kept as a separate app).

## Run

1. Install root dependency:
```powershell
npm install
```

2. Build frontend for file-based load:
```powershell
npm run desktop:build:web
```

3. Start desktop app:
```powershell
npm run desktop:start:no-build
```

Or one command (build + start):
```powershell
npm run desktop:start
```

## Build Installer (Windows)

From repo root:
```powershell
npm install
npm run desktop:package:win
```

Artifacts:
- `dist-electron\Aidas-Setup-<version>.exe`
- unpacked build under `dist-electron\win-unpacked\`

## Packaging Error: `Cannot create symbolic link ... winCodeSign`

If packaging fails with Windows symlink privilege error:

1. Enable Windows Developer Mode:
   - Settings -> Privacy & security -> For developers -> Developer Mode
2. Close all terminals, open PowerShell as Administrator
3. Clear electron-builder cache:
```powershell
Remove-Item "$env:LOCALAPPDATA\\electron-builder\\Cache\\winCodeSign" -Recurse -Force -ErrorAction SilentlyContinue
```
4. Run package again:
```powershell
npm run desktop:package:win
```

If you hit `EBUSY ... __uninstaller.exe` during signing:
- the packaging script already disables auto code-sign discovery (`CSC_IDENTITY_AUTO_DISCOVERY=false`)
- it also clears `dist-electron` before build to avoid stale locked files

## Notes

- Backend port defaults to `3001`.
- You can override backend port:
  - `AIDAS_BACKEND_PORT=3002`
- In packaged app, backend runs on bundled Electron runtime in Node mode (no system Node required).
- Optional runtime override:
  - `AIDAS_NODE_BIN=C:\\Program Files\\nodejs\\node.exe`
- You can force DB path:
  - `FLORA_DB_PATH=C:\\path\\to\\flora.db`
- For packaged mode, default DB path is Electron `userData/flora.db`.
- `ivy` is intentionally not bundled in Electron package.

## If You See `better-sqlite3` ABI Error

Example:
- `NODE_MODULE_VERSION ... compiled against a different Node.js version`

Fix:
1. Reinstall/rebuild backend native deps with your system Node:
```powershell
cd backend
npm rebuild better-sqlite3
```
2. Start Electron again.
