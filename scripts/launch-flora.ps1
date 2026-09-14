$ErrorActionPreference = "Stop"

$repoDir = Split-Path -Parent $PSScriptRoot
Set-Location $repoDir

$env:FLORA_DB_PATH = Join-Path $repoDir "data\flora.db"
$env:ELECTRON_RUN_AS_NODE = ""
$env:FLORA_USER_DATA_DIR = Join-Path $repoDir ".flora-profile"
$env:FLORA_SESSION_DATA_DIR = Join-Path $env:FLORA_USER_DATA_DIR "Session"
$env:FLORA_CACHE_DIR = Join-Path $env:FLORA_USER_DATA_DIR "Cache"
$env:FLORA_RUNTIME_DIR = Join-Path $repoDir ".flora-runtime"
$env:FLORA_BACKEND_PID_FILE = Join-Path $env:FLORA_RUNTIME_DIR "flora-backend.pid"

New-Item -ItemType Directory -Force -Path `
  $env:FLORA_USER_DATA_DIR, `
  $env:FLORA_SESSION_DATA_DIR, `
  $env:FLORA_CACHE_DIR, `
  $env:FLORA_RUNTIME_DIR | Out-Null

& powershell -ExecutionPolicy Bypass -File ".\scripts\start-flora-recover.ps1"

& ".\node_modules\.bin\electron.cmd" "electron\main.cjs"
exit $LASTEXITCODE
