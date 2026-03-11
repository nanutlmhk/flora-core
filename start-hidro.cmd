@echo off
setlocal
cd /d "%~dp0"
set "FLORA_DB_PATH=C:\porjai\data\flora.db"
set "HIDRO_TEST_MODE=0"
set "ELECTRON_RUN_AS_NODE="
set "HIDRO_USER_DATA_DIR=%~dp0.hidro-profile"
set "HIDRO_SESSION_DATA_DIR=%~dp0.hidro-profile\Session"
set "HIDRO_CACHE_DIR=%~dp0.hidro-profile\Cache"
call ".\node_modules\.bin\electron.cmd" ivy-tray\main.cjs
