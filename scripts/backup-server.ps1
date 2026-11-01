# Downloads a full CellMate backup from the server to this PC: database, photos/files, .env, push keys,
# desktop installers - one .tgz file. Put it back on any server with restore-server.ps1.
#
#   powershell -ExecutionPolicy Bypass -File scripts\backup-server.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\backup-server.ps1 -StopServer    # right before a server move
#
# -StopServer stops the app first and leaves it stopped, so nothing new arrives on the old server.
# The file holds passwords and push keys: keep it private (never commit, never share).
param(
  [string]$Server = 'ubuntu@80.225.252.210',
  [string]$Dest = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'backups'),
  [switch]$StopServer
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force $Dest | Out-Null

$name = "cellmate-backup-$(Get-Date -Format yyyy-MM-dd_HHmm).tgz"
# Upload the server half with Linux line endings.
$sh = Join-Path $env:TEMP 'cellmate-backup-now.sh'
[IO.File]::WriteAllText($sh, ((Get-Content -Raw "$repo\infra\backup-now.sh") -replace "`r", ''))
scp -q $sh "${Server}:cellmate-backup-now.sh"
if ($LASTEXITCODE -ne 0) { throw 'Could not reach the server (SSH)' }

$stop = if ($StopServer) { '--stop' } else { '' }
ssh $Server "bash ~/cellmate-backup-now.sh $stop ~/$name; rc=`$?; rm -f ~/cellmate-backup-now.sh; exit `$rc"
if ($LASTEXITCODE -ne 0) { throw 'Backup failed on the server: read the error above' }

Write-Host ''
Write-Host '==> Downloading to this PC'
scp "${Server}:$name" "$Dest\$name"
if ($LASTEXITCODE -ne 0) { throw "Download failed. The backup is still on the server at ~/$name" }
ssh $Server "rm -f ~/$name"

$size = [math]::Round((Get-Item "$Dest\$name").Length / 1MB, 1)
Write-Host ''
Write-Host "Backup saved: $Dest\$name ($size MB)"
Write-Host 'Keep a second copy off this PC (USB / cloud drive). It holds passwords and push keys.'
if ($StopServer) { Write-Host 'The app on the server is STOPPED. Restore it on the new server with restore-server.ps1.' }
