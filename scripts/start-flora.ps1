$ErrorActionPreference = "Stop"

$repoDir = Split-Path -Parent $PSScriptRoot
Set-Location $repoDir

Write-Host "[FLORA] repo=$repoDir"

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

Write-Host "[FLORA] recovering backend/db state..."
& powershell -ExecutionPolicy Bypass -File ".\scripts\start-flora-recover.ps1"
if ($LASTEXITCODE -ne 0) {
  Write-Host "[FLORA] recovery step failed"
  exit 1
}

Write-Host "[FLORA] rebuilding frontend..."
Push-Location ".\frontend"
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[FLORA] frontend build failed"
    exit 1
  }
} finally {
  Pop-Location
}

Write-Host "[FLORA] launching electron..."
& ".\node_modules\.bin\electron.cmd" "electron\main.cjs"
exit $LASTEXITCODE
