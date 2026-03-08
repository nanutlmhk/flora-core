param(
  [string]$Runtime = "",
  [switch]$SelfContained = $false
)

$ErrorActionPreference = "Stop"

$project = Join-Path $PSScriptRoot "HidroServiceHost\HidroServiceHost.csproj"
$outDir = Join-Path $PSScriptRoot "HidroServiceHost\publish"

if (-not (Test-Path $project)) {
  throw "Project not found: $project"
}

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$selfContainedFlag = if ($SelfContained) { "true" } else { "false" }
$publishArgs = @(
  "publish",
  $project,
  "-c", "Release",
  "--self-contained", $selfContainedFlag,
  "/p:PublishSingleFile=true",
  "/p:IncludeNativeLibrariesForSelfExtract=true",
  "/p:NuGetAudit=false",
  "-o", $outDir
)
if (-not [string]::IsNullOrWhiteSpace($Runtime)) {
  $publishArgs += @("-r", $Runtime)
}

dotnet @publishArgs

if ($LASTEXITCODE -ne 0) {
  throw "dotnet publish failed with exit code $LASTEXITCODE"
}

Write-Host "HidroServiceHost build completed."
Write-Host "Output: $outDir"
