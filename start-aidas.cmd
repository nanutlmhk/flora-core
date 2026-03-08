@echo off
setlocal
cd /d "%~dp0"
set "FLORA_DB_PATH=C:\porjai\data\flora.db"
call ".\node_modules\.bin\electron.cmd" electron\main.cjs

