# Puts the newest Windows installer and Android APK on the server, for the download page
# (https://<server>/download) and for the Windows app's automatic updates.
#
#   powershell -ExecutionPolicy Bypass -File scripts\publish-downloads.ps1                 # the version in package.json
#   powershell -ExecutionPolicy Bypass -File scripts\publish-downloads.ps1 -Version 1.5.6
#
# release.ps1 runs this by itself. Keeps the last 3 versions of each on the server (older ones are removed).
param(
  [string]$Version,
  [string]$Server = 'ubuntu@80.225.252.210'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $Version) { $Version = (Get-Content -Raw "$repo\apps\desktop\package.json" | ConvertFrom-Json).version }
$dist = "$repo\apps\desktop\dist"
$apk = Join-Path ([Environment]::GetFolderPath('Desktop')) "CellMate-$Version.apk"
$remote = 'meetme/infra/updates'

function Upload($files, $to) {
  # Large files over a slow link sometimes drop: try three times.
  for ($i = 1; $i -le 3; $i++) {
    scp -q -o ServerAliveInterval=15 @files "${Server}:$to/"
    if ($LASTEXITCODE -eq 0) { return }
    Write-Host "  upload interrupted, trying again ($i)"
    Start-Sleep 5
  }
  throw "Upload to the server failed: $($files -join ', ')"
}

ssh $Server "mkdir -p $remote/android"
if ($LASTEXITCODE -ne 0) { throw 'Could not reach the server (SSH)' }

# ---- Windows: installer + blockmap first, latest.yml last (installed apps update as soon as it names the new one)
$exe = "$dist\CellMate-$Version-win-x64.exe"
if (Test-Path $exe) {
  Write-Host "Windows $Version"
  Upload @($exe, "$exe.blockmap") $remote
  Upload @("$dist\latest.yml") $remote
  ssh $Server "cd $remote && ls -1t CellMate-*-win-x64.exe 2>/dev/null | tail -n +4 | while read f; do rm -f `"`$f`" `"`$f.blockmap`"; done"
} else {
  Write-Host "Windows installer for $Version not found in $dist (skipped)"
}

# ---- Android: the APK + android/latest.json for the download page
if (Test-Path $apk) {
  Write-Host "Android $Version"
  $name = "CellMate-$Version.apk"
  Upload @($apk) "$remote/android"
  $info = [ordered]@{ version = $Version; file = $name; size = (Get-Item $apk).Length; date = (Get-Date).ToUniversalTime().ToString('o') }
  $json = Join-Path $env:TEMP 'cellmate-android-latest.json'
  [IO.File]::WriteAllText($json, ($info | ConvertTo-Json -Compress))
  Upload @($json) "$remote/android"
  ssh $Server "cd $remote/android && mv -f cellmate-android-latest.json latest.json && ls -1t CellMate-*.apk | tail -n +4 | xargs -r rm -f"
} else {
  Write-Host "APK for $Version not found at $apk (skipped)"
}

Write-Host ''
Write-Host 'Download page: https://chat.gosite.lol/download'
