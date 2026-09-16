$ErrorActionPreference = "Stop"
$repoDir = Split-Path -Parent $PSScriptRoot
Set-Location $repoDir
$env:ELECTRON_RUN_AS_NODE = ""
$env:FLORA_API_BASE_URL = "http://127.0.0.1:6893"
docker compose -f compose.dev.yaml up -d postgres flora-leaf-api
if ($LASTEXITCODE -ne 0) { throw "Flora services failed to start" }
Push-Location frontend
try { npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" } } finally { Pop-Location }
& ".\node_modules\.bin\electron.cmd" "electron\main.cjs"
exit $LASTEXITCODE
