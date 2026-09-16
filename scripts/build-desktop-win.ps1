param(
  [ValidateSet("full", "eforl", "rcat")]
  [string]$Edition = "full",
  [int]$MaxRetries = 4,
  [int]$DelaySec = 8
)

$ErrorActionPreference = "Stop"

$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

$version = (Get-Content "package.json" | ConvertFrom-Json).version
$editionCode = $Edition.ToLowerInvariant()

switch ($editionCode) {
  "eforl" {
    $productName = "Flora EforL"
    $appId = "com.flora.eforl.desktop"
    $artifactName = "Flora-EforL-Setup-${version}.$" + "{ext}"
  }
  "rcat" {
    $productName = "Flora RCAT"
    $appId = "com.flora.rcat.desktop"
    $artifactName = "Flora-RCAT-Setup-${version}.$" + "{ext}"
  }
  default {
    $productName = "Flora"
    $appId = "com.flora.desktop"
    $artifactName = "Flora-Setup-${version}.$" + "{ext}"
  }
}

function Stop-InstallerLocks {
  $processNames = @("Flora", "Flora EforL", "Flora RCAT", "Flora-Setup-$version", "Flora-EforL-Setup-$version", "Flora-RCAT-Setup-$version", "Flora-Setup", "Flora-EforL-Setup", "Flora-RCAT-Setup")
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
    Stop-InstallerLocks

    if (Test-Path "dist-electron") {
      Remove-Item "dist-electron" -Recurse -Force -ErrorAction SilentlyContinue
    }

    Invoke-Step "flora icon build" "npm run flora:icon:build"
    Invoke-Step "frontend build" "npm run desktop:build:web"
    $env:FLORA_EDITION = $editionCode
    Invoke-Step "electron package" "npx electron-builder --win nsis --x64 --config.extraMetadata.floraEdition=$editionCode --config.productName=""$productName"" --config.appId=$appId --config.win.artifactName=""$artifactName"""

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
