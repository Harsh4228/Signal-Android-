# Nightly copy of the server's backups to this PC (the off-site copy: a lost server doesn't take them along).
# Run by the Windows task "CellMate nightly backup" (install with  -Install ), or by hand:
#
#   powershell -ExecutionPolicy Bypass -File scripts\pull-backups.ps1            # copy now
#   powershell -ExecutionPolicy Bypass -File scripts\pull-backups.ps1 -Install   # schedule every day 02:30
#
# Saves to <Dest>:
#   cellmate-<date>.tgz  CellMate: database, photos/files, .env, push keys, server front-door files (no desktop
#                        installers: they come back with the next release). Restore with restore-server.ps1.
# Keeps 30 days. The files hold passwords and keys: keep the folder private. Log: <Dest>\pull.log
param(
  [string]$Server = 'root@189.72.153.171',
  [string]$Dest = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'backups\daily'),
  [int]$KeepDays = 30,
  [switch]$Install
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if ($Install) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`""
  $trigger = New-ScheduledTaskTrigger -Daily -At '02:30'
  # PC off at 02:30: runs as soon as it is on again. Retries 3 times if the internet is down.
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'CellMate nightly backup' -Action $action -Trigger $trigger -Settings $settings `
    -Description 'Copies the CellMate backup from the VPS to this PC (scripts\pull-backups.ps1)' -Force | Out-Null
  Write-Host "Scheduled: 'CellMate nightly backup' every day at 02:30 (or as soon as the PC is on)."
  exit 0
}

New-Item -ItemType Directory -Force $Dest | Out-Null
$log = Join-Path $Dest 'pull.log'
function Log($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; Write-Host $line; Add-Content -Path $log -Value $line }
$day = Get-Date -Format 'yyyy-MM-dd'
$ok = $true

try {
  # CellMate: the server makes a light backup with the same script as backup-server.ps1 (Linux line endings)
  $sh = Join-Path $env:TEMP 'cellmate-backup-now.sh'
  [IO.File]::WriteAllText($sh, ((Get-Content -Raw "$repo\infra\backup-now.sh") -replace "`r", ''))
  scp -q -o BatchMode=yes -o ConnectTimeout=20 $sh "${Server}:cellmate-backup-now.sh"
  if ($LASTEXITCODE -ne 0) { throw 'cannot reach the server (SSH)' }
  ssh -o BatchMode=yes $Server 'bash ~/cellmate-backup-now.sh --light ~/cellmate-nightly.tgz >/dev/null; rc=$?; rm -f ~/cellmate-backup-now.sh; exit $rc'
  if ($LASTEXITCODE -ne 0) { throw 'CellMate backup failed on the server' }
  $f = Join-Path $Dest "cellmate-$day.tgz"
  scp -q -o BatchMode=yes "${Server}:cellmate-nightly.tgz" $f
  if ($LASTEXITCODE -ne 0) { throw 'CellMate download failed' }
  ssh -o BatchMode=yes $Server 'rm -f ~/cellmate-nightly.tgz'
  Log ("cellmate ok  {0} ({1:N1} MB)" -f (Split-Path -Leaf $f), ((Get-Item $f).Length / 1MB))
} catch { $ok = $false; Log "cellmate FAILED: $_" }

# Old copies go only after a good night, so a broken server never empties the folder
if ($ok) {
  Get-ChildItem $Dest -File | Where-Object { $_.Name -match '^cellmate-\d{4}-\d{2}-\d{2}\.tgz$' -and $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    ForEach-Object { Remove-Item $_.FullName; Log "removed old $($_.Name)" }
  exit 0
}
exit 1
