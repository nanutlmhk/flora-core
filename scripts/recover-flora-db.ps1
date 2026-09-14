param(
  [string]$DbPath,
  [string]$PidFile,
  [int]$Port = 3001
)

function Stop-IfRunning {
  param([int]$TargetPid)

  if ($TargetPid -le 0) {
    return
  }

  try {
    $proc = Get-Process -Id $TargetPid -ErrorAction Stop
    Stop-Process -Id $proc.Id -Force -ErrorAction Stop
  } catch {
    return
  }
}

function Get-ListeningPids {
  param([int]$TargetPort)

  try {
    $pids = Get-NetTCPConnection -State Listen -LocalPort $TargetPort -ErrorAction Stop |
      Select-Object -ExpandProperty OwningProcess -Unique
    if ($pids) {
      return @($pids | Where-Object { $_ -gt 0 } | Select-Object -Unique)
    }
  } catch {
    # Fallback below.
  }

  $results = @()
  try {
    $lines = netstat -ano -p tcp | Select-String -Pattern "LISTENING"
    foreach ($line in $lines) {
      $text = ($line.ToString() -replace "\s+", " ").Trim()
      if ($text -match "TCP ([^ ]+):$TargetPort [^ ]+ LISTENING (\d+)$") {
        $results += [int]$matches[2]
      }
    }
  } catch {
    return @()
  }

  return @($results | Where-Object { $_ -gt 0 } | Select-Object -Unique)
}

if ($PidFile -and (Test-Path $PidFile)) {
  try {
    $recordedPid = [int](Get-Content -Path $PidFile -Raw).Trim()
    Stop-IfRunning -TargetPid $recordedPid
  } catch {
    # ignore malformed pid files
  }

  Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
}

$listeningPids = Get-ListeningPids -TargetPort $Port
foreach ($owningPid in $listeningPids) {
  Stop-IfRunning -TargetPid $owningPid
}

Start-Sleep -Milliseconds 400

if ($DbPath) {
  $walPath = "$DbPath-wal"
  $shmPath = "$DbPath-shm"

  Remove-Item -Path $walPath -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $shmPath -Force -ErrorAction SilentlyContinue
}
