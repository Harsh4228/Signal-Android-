# Run on the NEW PC with the folder made by move-pc-export.ps1. Puts every file in its place,
# lets this PC's own SSH key into the server and tests the login.
#
#   powershell -ExecutionPolicy Bypass -File scripts\move-pc-import.ps1 -Src F:\CellMate-move
param(
  [Parameter(Mandatory = $true)][string]$Src,
  [string]$Server = 'ubuntu@80.225.252.210'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$ssh = "$env:USERPROFILE\.ssh"
New-Item -ItemType Directory -Force $ssh | Out-Null

# ---- SSH: copy the key the server trusts. Never overwrite a different key that already lives here.
foreach ($f in 'id_ed25519', 'id_ed25519.pub', 'id_rsa', 'id_rsa.pub', 'config') {
  if (-not (Test-Path "$Src\ssh\$f")) { continue }
  if (Test-Path "$ssh\$f") {
    if ((Get-FileHash "$ssh\$f").Hash -ne (Get-FileHash "$Src\ssh\$f").Hash) { Write-Host "  kept this PC's own $f (old one is still in $Src)"; continue }
  } else { Copy-Item "$Src\ssh\$f" "$ssh\$f"; Write-Host "  ssh\$f" }
}
# known_hosts: merge, so this PC's entries stay.
if (Test-Path "$Src\ssh\known_hosts") {
  $have = if (Test-Path "$ssh\known_hosts") { Get-Content "$ssh\known_hosts" } else { @() }
  Get-Content "$Src\ssh\known_hosts" | Where-Object { $have -notcontains $_ } | Add-Content "$ssh\known_hosts"
}
# OpenSSH refuses private keys other users can read.
foreach ($k in 'id_ed25519', 'id_rsa') {
  if (Test-Path "$ssh\$k") { icacls "$ssh\$k" /inheritance:r /grant:r "${env:USERNAME}:F" | Out-Null }
}

# ---- release keys, Firebase, Oracle API
if (Test-Path "$Src\meetme-release-keys") { Copy-Item "$Src\meetme-release-keys" "$env:USERPROFILE\" -Recurse -Force; Write-Host '  meetme-release-keys' }
if (Test-Path "$Src\google-services.json") { Copy-Item "$Src\google-services.json" "$repo\apps\mobile\android\app\" -Force; Write-Host '  google-services.json' }
if (Test-Path "$Src\GoogleService-Info.plist") { Copy-Item "$Src\GoogleService-Info.plist" "$repo\apps\mobile\ios\MeetMe\" -Force; Write-Host '  GoogleService-Info.plist' }
if (Test-Path "$Src\oci") {
  New-Item -ItemType Directory -Force "$env:USERPROFILE\.oci" | Out-Null
  Copy-Item "$Src\oci\*" "$env:USERPROFILE\.oci\" -Force
  $cfg = "$env:USERPROFILE\.oci\config"
  if (Test-Path $cfg) {
    $home2 = $env:USERPROFILE -replace '\\', '/'
    (Get-Content $cfg) -replace 'C:/Users/[^/]+/\.oci/', "$home2/.oci/" | Set-Content -Encoding ascii $cfg
  }
  Write-Host '  .oci (config path fixed)'
}

# ---- server: also trust this PC's own key, so it keeps working without the old one
Write-Host ''
Write-Host 'Testing the server login'
$own = Get-ChildItem "$ssh\id_*.pub" | Where-Object { -not (Test-Path "$Src\ssh\$($_.Name)") -or (Get-FileHash $_.FullName).Hash -ne (Get-FileHash "$Src\ssh\$($_.Name)").Hash }
foreach ($pub in $own) {
  $line = (Get-Content $pub.FullName -Raw).Trim()
  ssh -o ConnectTimeout=15 $Server "grep -qxF '$line' ~/.ssh/authorized_keys || echo '$line' >> ~/.ssh/authorized_keys"
  if ($LASTEXITCODE -eq 0) { Write-Host "  this PC's $($pub.Name) is now allowed on the server" }
}
$name = ssh -o ConnectTimeout=15 $Server hostname
if ($LASTEXITCODE -ne 0) { throw 'Server login failed: read the error above' }
Write-Host ''
Write-Host "Server login works ($name)." -ForegroundColor Green
Write-Host "Keep $Src\server\infra.env with the release keys (it is a backup, it is not copied anywhere)."
