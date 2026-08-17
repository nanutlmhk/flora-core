$ErrorActionPreference = "Stop"

$repoDir = Split-Path -Parent $PSScriptRoot
Set-Location $repoDir

$env:FLORA_DB_PATH = "C:\porjai\data\flora.db"
$env:ELECTRON_RUN_AS_NODE = ""
$env:AIDAS_USER_DATA_DIR = Join-Path $repoDir ".aidas-profile"
$env:AIDAS_SESSION_DATA_DIR = Join-Path $env:AIDAS_USER_DATA_DIR "Session"
$env:AIDAS_CACHE_DIR = Join-Path $env:AIDAS_USER_DATA_DIR "Cache"
$env:AIDAS_RUNTIME_DIR = Join-Path $repoDir ".aidas-runtime"
$env:AIDAS_BACKEND_PID_FILE = Join-Path $env:AIDAS_RUNTIME_DIR "aidas-backend.pid"

New-Item -ItemType Directory -Force -Path `
  $env:AIDAS_USER_DATA_DIR, `
  $env:AIDAS_SESSION_DATA_DIR, `
  $env:AIDAS_CACHE_DIR, `
  $env:AIDAS_RUNTIME_DIR | Out-Null

& powershell -ExecutionPolicy Bypass -File ".\scripts\start-aidas-recover.ps1"

& ".\node_modules\.bin\electron.cmd" "electron\main.cjs"
exit $LASTEXITCODE
