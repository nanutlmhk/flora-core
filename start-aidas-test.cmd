@echo off
setlocal
cd /d "%~dp0"

echo [AIDAS-TEST] repo=%CD%
set "FLORA_DB_PATH=C:\porjai\data\flora.db"
set "ELECTRON_RUN_AS_NODE="
set "AIDAS_USER_DATA_DIR=%~dp0.aidas-profile-test"
set "AIDAS_SESSION_DATA_DIR=%~dp0.aidas-profile-test\Session"
set "AIDAS_CACHE_DIR=%~dp0.aidas-profile-test\Cache"
set "AIDAS_BACKEND_PID_FILE=%AIDAS_USER_DATA_DIR%\aidas-backend.pid"

if not exist "%AIDAS_USER_DATA_DIR%" mkdir "%AIDAS_USER_DATA_DIR%" >nul 2>nul
if not exist "%AIDAS_SESSION_DATA_DIR%" mkdir "%AIDAS_SESSION_DATA_DIR%" >nul 2>nul
if not exist "%AIDAS_CACHE_DIR%" mkdir "%AIDAS_CACHE_DIR%" >nul 2>nul

echo [AIDAS-TEST] recovering backend/db state...
powershell -ExecutionPolicy Bypass -Command "$dbPath='%FLORA_DB_PATH%'; $pidFile='%AIDAS_BACKEND_PID_FILE%'; if(Test-Path $pidFile){ try { $recordedPid=[int](Get-Content -Path $pidFile -Raw).Trim(); $proc=Get-Process -Id $recordedPid -ErrorAction Stop; Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {} ; Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue }; try { $pids=Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique } catch { $pids=@() }; foreach($owningProcessId in @($pids)){ if($owningProcessId -gt 0){ try { Stop-Process -Id $owningProcessId -Force -ErrorAction SilentlyContinue } catch {} } }; Start-Sleep -Milliseconds 400; Remove-Item -Path ($dbPath + '-wal'), ($dbPath + '-shm') -Force -ErrorAction SilentlyContinue"
if errorlevel 1 (
  echo [AIDAS-TEST] recovery step failed
  exit /b 1
)

echo [AIDAS-TEST] rebuilding frontend-v2...
pushd frontend-v2
call npm run build
if errorlevel 1 (
  popd
  echo [AIDAS-TEST] frontend build failed
  exit /b 1
)
popd

echo [AIDAS-TEST] launching electron...
call ".\node_modules\.bin\electron.cmd" electron\main.cjs

