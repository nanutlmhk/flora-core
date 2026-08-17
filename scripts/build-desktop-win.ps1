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
    $productName = "Aidas EforL"
    $appId = "com.aidas.eforl.desktop"
    $artifactName = "Aidas-EforL-Setup-${version}.$" + "{ext}"
  }
  "rcat" {
    $productName = "Aidas RCAT"
    $appId = "com.aidas.rcat.desktop"
    $artifactName = "Aidas-RCAT-Setup-${version}.$" + "{ext}"
  }
  default {
    $productName = "Aidas"
    $appId = "com.aidas.desktop"
    $artifactName = "Aidas-Setup-${version}.$" + "{ext}"
  }
}

function Stop-InstallerLocks {
  $processNames = @("Aidas", "Aidas EforL", "Aidas RCAT", "Aidas-Setup-$version", "Aidas-EforL-Setup-$version", "Aidas-RCAT-Setup-$version", "Aidas-Setup", "Aidas-EforL-Setup", "Aidas-RCAT-Setup")
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

    Invoke-Step "aidas icon build" "npm run aidas:icon:build"
    Invoke-Step "frontend build" "npm run desktop:build:web"
    Invoke-Step "backend native rebuild" "npm run backend:rebuild:native"
    $env:AIDAS_EDITION = $editionCode
    Invoke-Step "electron package" "npx electron-builder --win nsis --x64 --config.extraMetadata.aidasEdition=$editionCode --config.productName=""$productName"" --config.appId=$appId --config.win.artifactName=""$artifactName"""

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
