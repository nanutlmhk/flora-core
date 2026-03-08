param(
  [string]$PngPath = "ivy-tray/assets/hidro-app.png",
  [string]$IcoPath = "ivy-tray/assets/hidro-app.ico"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$png = Join-Path $root $PngPath
$ico = Join-Path $root $IcoPath

if (!(Test-Path $png)) {
  throw "PNG not found: $png"
}

Add-Type -AssemblyName System.Drawing

$bitmap = New-Object System.Drawing.Bitmap($png)
try {
  $size = 256
  $resized = New-Object System.Drawing.Bitmap($bitmap, (New-Object System.Drawing.Size($size, $size)))
  try {
    $icon = [System.Drawing.Icon]::FromHandle($resized.GetHicon())
    try {
      $dir = Split-Path -Parent $ico
      if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
      }
      $fs = [System.IO.File]::Open($ico, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
      try {
        $icon.Save($fs)
      } finally {
        $fs.Dispose()
      }
    } finally {
      $icon.Dispose()
    }
  } finally {
    $resized.Dispose()
  }
} finally {
  $bitmap.Dispose()
}

Write-Host "Created ICO:" $ico
