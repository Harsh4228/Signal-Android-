# Puts a backup made by backup-server.ps1 onto a server: database, photos/files, .env, push keys, installers.
#
#   Same server (roll back):  powershell -ExecutionPolicy Bypass -File scripts\restore-server.ps1 -Backup E:\cellmet\backups\cellmate-backup-....tgz
#   New server (move):        1. run infra/setup-oracle.sh on the new server (see the top of that file)
#                             2. powershell -ExecutionPolicy Bypass -File scripts\restore-server.ps1 -Backup <file> -Server ubuntu@<NEW_IP>
#                             3. point chat.gosite.lol at the new server (move the reserved IP, or change DNS)
#
# What is on the server now is saved first (infra/backups/before-restore-*.dump), so nothing is lost.
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [string]$Server = 'ubuntu@80.225.252.210'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path $Backup)) { throw "Backup file not found: $Backup" }

Write-Host "This REPLACES all CellMate data on $Server with:"
Write-Host "  $Backup"
if ((Read-Host 'Type RESTORE to continue') -cne 'RESTORE') { Write-Host 'Cancelled.'; exit 1 }

$sh = Join-Path $env:TEMP 'cellmate-restore.sh'
[IO.File]::WriteAllText($sh, ((Get-Content -Raw "$repo\infra\restore-backup.sh") -replace "`r", ''))
Write-Host '==> Uploading'
scp -q $sh "${Server}:cellmate-restore.sh"
if ($LASTEXITCODE -ne 0) { throw 'Could not reach the server (SSH)' }
scp $Backup "${Server}:cellmate-restore.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed' }

ssh $Server "bash ~/cellmate-restore.sh ~/cellmate-restore.tgz; rc=`$?; rm -f ~/cellmate-restore.sh ~/cellmate-restore.tgz; exit `$rc"
if ($LASTEXITCODE -ne 0) { throw 'Restore failed: read the error above. The data from before is in infra/backups/before-restore-*.dump' }

$domain = (ssh $Server "sed -n 's/^DOMAIN=//p' ~/meetme/infra/.env").Trim()
Write-Host ''
Write-Host "==> Checking https://$domain/health"
for ($i = 0; $i -lt 24; $i++) {
  try { Invoke-WebRequest -UseBasicParsing "https://$domain/health" -TimeoutSec 5 | Out-Null; Write-Host "CellMate is live at https://$domain"; exit 0 } catch { Start-Sleep 5 }
}
Write-Host "https://$domain does not answer yet. If this is a NEW server, point the domain / reserved IP at it first."
