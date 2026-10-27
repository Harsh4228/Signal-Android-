# Run on the OLD PC. Collects everything CellMate needs that is not in git into one folder
# (put it on a USB stick), then run scripts\move-pc-import.ps1 on the new PC.
#
#   powershell -ExecutionPolicy Bypass -File move-pc-export.ps1 -Dest E:\CellMate-move
#
# The folder holds SECRET KEYS: USB stick only. Never WhatsApp / email / git.
param(
  [Parameter(Mandatory = $true)][string]$Dest,
  [string]$Project = "$env:USERPROFILE\OneDrive\Desktop\Signal\meetme",
  [string]$Server = 'ubuntu@80.225.252.210'
)
$ErrorActionPreference = 'Stop'
$report = [System.Collections.Generic.List[string]]::new()
function Ok($m) { Write-Host "  OK      $m" -ForegroundColor Green; $report.Add("OK      $m") }
function Miss($m) { Write-Host "  MISSING $m" -ForegroundColor Yellow; $report.Add("MISSING $m") }

function Grab($from, $to, $what) {
  if (Test-Path $from) {
    New-Item -ItemType Directory -Force (Split-Path -Parent $to) | Out-Null
    Copy-Item $from $to -Recurse -Force
    Ok $what
  } else { Miss "$what ($from)" }
}

New-Item -ItemType Directory -Force $Dest | Out-Null
Write-Host "Collecting into $Dest"

# ---- keys and settings on this PC
$ssh = "$env:USERPROFILE\.ssh"
foreach ($f in 'id_ed25519', 'id_ed25519.pub', 'id_rsa', 'id_rsa.pub', 'known_hosts', 'config') {
  if (Test-Path "$ssh\$f") { Grab "$ssh\$f" "$Dest\ssh\$f" "ssh\$f" }
}
if (-not (Test-Path "$ssh\id_ed25519") -and -not (Test-Path "$ssh\id_rsa")) { Miss 'SSH private key (the server login!)' }
Grab "$env:USERPROFILE\meetme-release-keys" "$Dest\meetme-release-keys" 'meetme-release-keys (Android signing key + passwords)'
Grab "$env:USERPROFILE\.oci" "$Dest\oci" '.oci (Oracle API key for scripts)'
Grab "$env:USERPROFILE\.gradle\gradle.properties" "$Dest\gradle\gradle.properties" 'gradle.properties (may hold signing settings)'

# ---- files git ignores inside the project
Grab "$Project\apps\mobile\android\app\google-services.json" "$Dest\google-services.json" 'google-services.json (Android push)'
if (Test-Path "$Project\apps\mobile\ios\MeetMe\GoogleService-Info.plist") {
  Grab "$Project\apps\mobile\ios\MeetMe\GoogleService-Info.plist" "$Dest\GoogleService-Info.plist" 'GoogleService-Info.plist (iPhone push)'
}
if (Test-Path "$Project\infra\.env") { Grab "$Project\infra\.env" "$Dest\project-infra.env" 'project infra\.env' }
if (Test-Path "$Project\infra\secrets") { Grab "$Project\infra\secrets" "$Dest\project-infra-secrets" 'project infra\secrets' }

# ---- released apps (record of what people installed)
$desktop = [Environment]::GetFolderPath('Desktop')
$apks = Get-ChildItem $desktop -Filter 'CellMate-*.apk' -ErrorAction SilentlyContinue
if ($apks) { New-Item -ItemType Directory -Force "$Dest\released" | Out-Null; $apks | Copy-Item -Destination "$Dest\released"; Ok "released APKs: $($apks.Name -join ', ')" }

# ---- backups of the server's secret settings (read only, nothing is changed on the server)
Write-Host 'Reading the server settings over SSH'
New-Item -ItemType Directory -Force "$Dest\server" | Out-Null
ssh -o ConnectTimeout=15 $Server 'cat ~/meetme/infra/.env' | Set-Content -Encoding ascii "$Dest\server\infra.env"
if ($LASTEXITCODE -eq 0) { Ok 'server ~/meetme/infra/.env' } else { Miss 'server infra/.env (SSH failed)' }
scp -q -o ConnectTimeout=15 "${Server}:~/meetme/infra/secrets/fcm-service-account.json" "$Dest\server\fcm-service-account.json"
if ($LASTEXITCODE -eq 0) { Ok 'server fcm-service-account.json (push key)' } else { Miss 'server fcm-service-account.json' }

# ---- is any code only on this PC?
if (Test-Path "$Project\.git") {
  Push-Location $Project
  git fetch -q --all
  $dirty = git status --porcelain
  $unpushed = foreach ($r in git remote) { git log "$r/main..main" --oneline }
  Pop-Location
  if ($dirty) { Miss "UNSAVED code changes in $Project - commit and push them: $($dirty.Count) files" } else { Ok 'no unsaved code changes' }
  if ($unpushed) { Miss "commits not pushed to every remote - run git push for each remote" } else { Ok 'every commit is pushed' }
} else { Miss "project folder not found: $Project (pass -Project <path>)" }

$report | Set-Content -Encoding utf8 "$Dest\REPORT.txt"
Write-Host ''
Write-Host "Done. Check $Dest\REPORT.txt for MISSING lines, then run move-pc-import.ps1 on the new PC." -ForegroundColor Cyan
