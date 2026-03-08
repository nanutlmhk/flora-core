param(
  [switch]$SkipInstall = $false,
  [switch]$UseIvyService = $false,
  [switch]$StartHidroTray = $false
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Require-Command {
  param([string]$Name)
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "Required command not found: $Name"
  }
}

function Run-NpmStep {
  param(
    [string]$WorkingDir,
    [string[]]$Args
  )

  Push-Location $WorkingDir
  try {
    & npm @Args
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Args -join ' ') failed in $WorkingDir (exit $LASTEXITCODE)"
    }
  } finally {
    Pop-Location
  }
}

function Wait-IvyHealth {
  param(
    [int]$TimeoutSec = 20
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:3000/health" -TimeoutSec 2
      if ($resp.status -eq "OK") {
        return $true
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

Require-Command -Name "node"
Require-Command -Name "npm"

if (-not $SkipInstall) {
  Write-Host "Installing dependencies..."
  Run-NpmStep -WorkingDir $repoRoot -Args @("install")
  Run-NpmStep -WorkingDir (Join-Path $repoRoot "backend") -Args @("install")
  Run-NpmStep -WorkingDir (Join-Path $repoRoot "frontend-v2") -Args @("install")
  Run-NpmStep -WorkingDir (Join-Path $repoRoot "ivy") -Args @("install")
}

Write-Host "Building frontend bundle for Electron..."
Run-NpmStep -WorkingDir $repoRoot -Args @("run", "desktop:build:web")

if ($UseIvyService) {
  Write-Host "Starting Ivy Windows service..."
  & sc.exe start IvyCaptureService | Out-Null
} else {
  Write-Host "Starting Ivy server process..."
  Start-Process powershell `
    -ArgumentList @(
      "-NoExit",
      "-ExecutionPolicy", "Bypass",
      "-Command", "Set-Location '$repoRoot\ivy'; npm run server"
    ) `
    -WorkingDirectory (Join-Path $repoRoot "ivy")

  if (-not (Wait-IvyHealth -TimeoutSec 20)) {
    Write-Warning "Ivy health check did not return OK within timeout."
  }
}

if ($StartHidroTray) {
  Write-Host "Starting Hidro tray..."
  Start-Process powershell `
    -ArgumentList @(
      "-NoExit",
      "-ExecutionPolicy", "Bypass",
      "-Command", "Set-Location '$repoRoot'; npm run hidro:tray:start"
    ) `
    -WorkingDirectory $repoRoot
}

Write-Host "Starting Aidas Electron..."
Push-Location $repoRoot
try {
  & npm run desktop:start:no-build
} finally {
  Pop-Location
}
