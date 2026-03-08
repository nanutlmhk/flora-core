param(
  [string]$NodeExe = "",
  [switch]$Clean = $true
)

$ErrorActionPreference = "Stop"

$ivyRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $PSScriptRoot "runtime"
$runtimeIvy = Join-Path $runtimeRoot "ivy"
$runtimeNode = Join-Path $runtimeRoot "node.exe"

if ([string]::IsNullOrWhiteSpace($NodeExe)) {
  $NodeExe = (Get-Command node -ErrorAction Stop).Source
}
if (-not (Test-Path $NodeExe)) {
  throw "Node executable not found: $NodeExe"
}

if ($Clean -and (Test-Path $runtimeIvy)) {
  Write-Host "Cleaning existing runtime ivy folder..."
  Remove-Item $runtimeIvy -Recurse -Force
}

New-Item -ItemType Directory -Path $runtimeIvy -Force | Out-Null
Copy-Item $NodeExe $runtimeNode -Force

Write-Host "Copying ivy runtime files..."
robocopy $ivyRoot $runtimeIvy /E /NFL /NDL /NJH /NJS /NP `
  /XD "$ivyRoot\reference" "$ivyRoot\service" "$ivyRoot\node_modules\.cache" `
  /XF "*.md" "ivy.db-shm" "ivy.db-wal" | Out-Null

Write-Host "Runtime prepared:"
Write-Host "  Node: $runtimeNode"
Write-Host "  Ivy:  $runtimeIvy"
Write-Host "Use this script path when installing service:"
Write-Host "  -ScriptPath `"$runtimeIvy\server.js`""
