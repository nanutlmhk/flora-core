# AIDAS + HIDRO Beta Deployment (Repo Run)

This runbook is for the current beta workflow on client PC.

Do not use the installers for daily beta use.  
Current stable path is:
- `Hidro` runs from repo at Windows startup
- `Aidas` runs from repo by desktop shortcut to direct Electron launcher

## 1) Target behavior
1. Windows starts.
2. `Hidro` starts automatically in background.
3. `Hidro` brings up Ivy on `127.0.0.1:3000`.
4. User opens `Aidas` from desktop icon when needed.
5. `Aidas` starts its backend on `127.0.0.1:3001` and opens UI.

## 2) Required paths
- Repo on client PC:
  - `C:\porjai\flora-aplha`
- Persistent DB:
  - `C:\porjai\data\flora.db`

You can change repo path, but all launcher files must match it exactly.

## 3) One-time client setup
1. Copy repo to client PC:
   - `C:\porjai\flora-aplha`
2. Create DB folder:

```powershell
New-Item -ItemType Directory -Force C:\porjai\data | Out-Null
```

3. Put production DB in place:
   - `C:\porjai\data\flora.db`
4. Install dependencies once:

```cmd
cd /d C:\porjai\flora-aplha
npm.cmd install
cd /d C:\porjai\flora-aplha\backend
npm.cmd install
cd /d C:\porjai\flora-aplha\frontend-v2
npm.cmd install
```

5. Build frontend once:

```cmd
cd /d C:\porjai\flora-aplha
npm.cmd run desktop:build:web
```

If PowerShell policy blocks `npm.ps1`, always use `cmd /c npm.cmd ...` or Command Prompt.

## 4) Hidro startup launcher
Create file:
- `C:\porjai\flora-aplha\start-hidro-hidden.vbs`

Content:

```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d C:\porjai\flora-aplha && set FLORA_DB_PATH=C:\porjai\data\flora.db && .\node_modules\.bin\electron.cmd ivy-tray\main.cjs", 0, False
```

Then place a shortcut to this file in:
- `shell:startup`

Result:
- `Hidro` starts after Windows login
- no `cmd` or PowerShell window is shown

## 5) Aidas desktop launcher
Use the repo launcher file:
- `C:\porjai\flora-aplha\start-aidas.cmd`

Content already expected:

```cmd
@echo off
setlocal
cd /d "C:\porjai\flora-aplha"
set "FLORA_DB_PATH=C:\porjai\data\flora.db"
call ".\node_modules\.bin\electron.cmd" electron\main.cjs
```

Create desktop shortcut:
- target = `C:\porjai\flora-aplha\start-aidas.cmd`
- start in = `C:\porjai\flora-aplha`
- name = `Aidas`

Set shortcut icon:
- right click shortcut -> `Properties` -> `Change Icon`
- use:
  - `C:\porjai\flora-aplha\electron\assets\aidas-app.ico`

Result:
- user opens `Aidas` from desktop
- Windows shows the correct Aidas desktop icon
- this is more stable than launching through `npm run desktop:start`

## 6) Daily use
1. Login to Windows.
2. Wait for `Hidro` tray icon.
3. Open `Aidas` from desktop shortcut.

No manual PowerShell or `cmd` is needed in normal beta use.

## 7) Verify runtime
Check Ivy:

```powershell
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/admin/services
```

Check Aidas backend after opening Aidas:

```powershell
curl http://127.0.0.1:3001/health
```

Expected:
- `3000` = Ivy / Hidro side
- `3001` = Aidas backend side

## 8) Update process
When repo changes:
1. Copy updated source to:
   - `C:\porjai\flora-aplha`
2. Reinstall dependencies only if `package.json` changed:

```cmd
cd /d C:\porjai\flora-aplha
npm.cmd install
cd /d C:\porjai\flora-aplha\backend
npm.cmd install
cd /d C:\porjai\flora-aplha\frontend-v2
npm.cmd install
```

3. Rebuild frontend:

```cmd
cd /d C:\porjai\flora-aplha
npm.cmd run desktop:build:web
```

4. Restart `Hidro`
5. Reopen `Aidas`

Do not replace:
- `C:\porjai\data\flora.db`

unless you intentionally want a fresh database.

## 9) Troubleshooting
### Hidro tray opens but Ivy keeps stopping
Check:

```powershell
Get-Content "$env:LOCALAPPDATA\Hidro\logs\ivy-node.err.log" -Tail 120
```

Common causes:
- port `3000` already in use
- `node` not installed or not in PATH
- runtime module load failure

### Aidas shows backend error
Usually one of these:
- `FLORA_DB_PATH` not pointing to `C:\porjai\data\flora.db`
- frontend not rebuilt
- backend dependencies missing
- port `3001` already in use

Manual check:

```cmd
cd /d C:\porjai\flora-aplha
set FLORA_DB_PATH=C:\porjai\data\flora.db
start-aidas.cmd
```

If this works, the issue is launcher/path, not app logic.

### PowerShell blocks npm
Use:

```cmd
npm.cmd run desktop:build:web
```

or:

```powershell
cmd /c npm.cmd run desktop:build:web
```

## 10) Current beta rule
- Use repo-run launchers for client beta
- Use `start-aidas.cmd` desktop shortcut for Aidas
- Do not rely on Aidas/Hidro installers for normal operation yet
- Keep DB persistent at `C:\porjai\data\flora.db`
