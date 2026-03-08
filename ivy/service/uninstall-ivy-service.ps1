param(
  [string]$ServiceName = "IvyCaptureService"
)

$ErrorActionPreference = "Stop"

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
  Write-Host "Service '$ServiceName' not found."
  exit 0
}

if ($svc.Status -ne "Stopped") {
  Write-Host "Stopping service '$ServiceName'..."
  sc.exe stop $ServiceName | Out-Null
  Start-Sleep -Seconds 2
}

Write-Host "Deleting service '$ServiceName'..."
sc.exe delete $ServiceName | Out-Null

Write-Host "Done."

