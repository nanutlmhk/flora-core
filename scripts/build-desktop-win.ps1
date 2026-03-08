param(
  [int]$MaxRetries = 4,
  [int]$DelaySec = 8
)

$ErrorActionPreference = "Stop"

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

function Release-InstallerLocks {
  $processNames = @("Aidas", "Aidas-Setup-0.1.0", "Aidas-Setup")
  foreach ($name in $processNames) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Step([string]$Label, [string]$Cmd) {
  Write-Host "[BUILD] $Label"
  $output = cmd /c "$Cmd 2>&1" | Out-String
  if ($output) {
    Write-Host $output
  }
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed (exit $LASTEXITCODE)`n$output"
  }
}

for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
  try {
    Write-Host "[BUILD] Attempt $attempt/$MaxRetries"
    Release-InstallerLocks

    if (Test-Path "dist-electron") {
      Remove-Item "dist-electron" -Recurse -Force -ErrorAction SilentlyContinue
    }

    Invoke-Step "aidas icon build" "npm run aidas:icon:build"
    Invoke-Step "frontend build" "npm run desktop:build:web"
    Invoke-Step "backend native rebuild" "npm run backend:rebuild:native"
    Invoke-Step "electron package" "npx electron-builder --win nsis --x64"

    Write-Host "[BUILD] Success"
    exit 0
  } catch {
    $msg = "$($_.Exception.Message)"
    $isBusy = $msg -match "EBUSY|resource busy or locked|__uninstaller\.exe"
    Write-Warning "[BUILD] Failed: $msg"

    if (-not $isBusy -or $attempt -ge $MaxRetries) {
      throw
    }

    Write-Host "[BUILD] Detected transient uninstaller lock. Retrying in $DelaySec seconds..."
    Start-Sleep -Seconds $DelaySec
  }
}

throw "Packaging failed after $MaxRetries attempts."
