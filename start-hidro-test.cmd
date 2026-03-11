@echo off
setlocal
cd /d "%~dp0"

echo [HIDRO-TEST] repo=%CD%
set "FLORA_DB_PATH=C:\porjai\data\flora.db"
set "HIDRO_TEST_MODE=0"
set "ELECTRON_RUN_AS_NODE="
set "HIDRO_USER_DATA_DIR=%~dp0.hidro-profile-test"
set "HIDRO_SESSION_DATA_DIR=%~dp0.hidro-profile-test\Session"
set "HIDRO_CACHE_DIR=%~dp0.hidro-profile-test\Cache"

if not exist "%HIDRO_USER_DATA_DIR%" mkdir "%HIDRO_USER_DATA_DIR%" >nul 2>nul
if not exist "%HIDRO_SESSION_DATA_DIR%" mkdir "%HIDRO_SESSION_DATA_DIR%" >nul 2>nul
if not exist "%HIDRO_CACHE_DIR%" mkdir "%HIDRO_CACHE_DIR%" >nul 2>nul

echo [HIDRO-TEST] validating tray source...
node --check "%~dp0ivy-tray\main.cjs"
if errorlevel 1 (
  echo [HIDRO-TEST] source validation failed
  exit /b 1
)

echo [HIDRO-TEST] launching electron...
call ".\node_modules\.bin\electron.cmd" ivy-tray\main.cjs

