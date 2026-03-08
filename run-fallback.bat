@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-fallback.ps1" %*
endlocal
