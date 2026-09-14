$ErrorActionPreference = "SilentlyContinue"

$pidFile = $env:FLORA_BACKEND_PID_FILE

if ($pidFile -and (Test-Path $pidFile)) {
  try {
    $recordedPid = [int](Get-Content -Path $pidFile -Raw).Trim()
    $proc = Get-Process -Id $recordedPid -ErrorAction Stop
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  } catch {
  }

  Remove-Item -Path $pidFile -Force -ErrorAction SilentlyContinue
}

try {
  $owningProcessIds = Get-NetTCPConnection -State Listen -LocalPort 3001 -ErrorAction Stop |
    Select-Object -ExpandProperty OwningProcess -Unique
} catch {
  $owningProcessIds = @()
}

foreach ($owningProcessId in @($owningProcessIds)) {
  if ($owningProcessId -gt 0) {
    try {
      Stop-Process -Id $owningProcessId -Force -ErrorAction SilentlyContinue
    } catch {
    }
  }
}

Start-Sleep -Milliseconds 400

exit 0
