param(
  [string]$ServiceName = "IvyCaptureService",
  [string]$DisplayName = "AIDAS Ivy Capture Service",
  [string]$ServiceExe = "",
  [string]$NodeExe = "",
  [string]$ScriptPath = "",
  [string]$WorkDir = "",
  [string]$LogPath = "",
  [switch]$BuildHostIfMissing = $true
)

$ErrorActionPreference = "Stop"

$ivyRoot = Split-Path -Parent $PSScriptRoot
$hostProject = Join-Path $PSScriptRoot "HidroServiceHost\HidroServiceHost.csproj"
$hostPublishDir = Join-Path $PSScriptRoot "HidroServiceHost\publish"
$defaultServiceExe = Join-Path $hostPublishDir "HidroServiceHost.exe"
$runtimeNodeExe = Join-Path $PSScriptRoot "runtime\node.exe"
$logDir = Join-Path $PSScriptRoot "logs"

if ([string]::IsNullOrWhiteSpace($ServiceExe)) {
  $ServiceExe = $defaultServiceExe
}

if ($BuildHostIfMissing -and -not (Test-Path $ServiceExe)) {
  if (-not (Test-Path $hostProject)) {
    throw "HidroServiceHost project not found: $hostProject"
  }

  Write-Host "Building HidroServiceHost..."
  New-Item -ItemType Directory -Path $hostPublishDir -Force | Out-Null
  dotnet publish $hostProject `
    -c Release `
    --self-contained false `
    /p:PublishSingleFile=true `
    /p:IncludeNativeLibrariesForSelfExtract=true `
    /p:NuGetAudit=false `
    -o $hostPublishDir

  if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
  }
}

if (-not (Test-Path $ServiceExe)) {
  throw "Service executable not found: $ServiceExe"
}

if ([string]::IsNullOrWhiteSpace($ScriptPath)) {
  $ScriptPath = Join-Path $ivyRoot "server.js"
}
if (-not (Test-Path $ScriptPath)) {
  throw "Ivy server.js not found at: $ScriptPath"
}

if ([string]::IsNullOrWhiteSpace($WorkDir)) {
  $WorkDir = Split-Path -Parent $ScriptPath
}
if (-not (Test-Path $WorkDir)) {
  throw "Ivy working directory not found: $WorkDir"
}

if ([string]::IsNullOrWhiteSpace($NodeExe)) {
  if (Test-Path $runtimeNodeExe) {
    $NodeExe = $runtimeNodeExe
  } else {
    $NodeExe = (Get-Command node -ErrorAction Stop).Source
  }
}
if (-not (Test-Path $NodeExe)) {
  throw "Node runtime not found: $NodeExe"
}

if ([string]::IsNullOrWhiteSpace($LogPath)) {
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $LogPath = Join-Path $logDir "hidro-service.log"
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
$binPath = "`"$ServiceExe`" --service-name `"$ServiceName`" --node `"$NodeExe`" --script `"$ScriptPath`" --workdir `"$WorkDir`" --log `"$LogPath`""
if ($existing) {
  Write-Host "Service '$ServiceName' already exists. Updating config..."
} else {
  Write-Host "Creating service '$ServiceName'..."
  sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "$DisplayName" | Out-Null
}

sc.exe config $ServiceName binPath= $binPath start= delayed-auto DisplayName= "$DisplayName" | Out-Null
sc.exe description $ServiceName "AIDAS Hidro capture engine (GE RS-232 + HL7 listener)" | Out-Null
sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null
sc.exe failureflag $ServiceName 1 | Out-Null

Write-Host "Starting service '$ServiceName'..."
sc.exe start $ServiceName | Out-Null

Write-Host "Done. Service installed and started:"
Write-Host "  Service EXE: $ServiceExe"
Write-Host "  Node EXE:    $NodeExe"
Write-Host "  Script:      $ScriptPath"
Write-Host "  WorkDir:     $WorkDir"
Write-Host "  LogPath:     $LogPath"
sc.exe query $ServiceName
