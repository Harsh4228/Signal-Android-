# Builds the signed Android APK on this PC and puts it on the Desktop as CellMate-<version>.apk.
#
#   powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1            # arm64 phones (almost all)
#   powershell -ExecutionPolicy Bypass -File scripts\build-apk.ps1 -AllPhones # also old 32-bit phones + emulators
#
# The build runs in a copy at C:\dev\meetme: inside OneDrive the paths are too long and OneDrive syncing
# breaks the C++ build. The signing passwords are read from the key folder's README.txt (never from git).
param(
  [switch]$AllPhones,
  [string]$Keys = "$env:USERPROFILE\meetme-release-keys",
  [string]$Work = 'C:\dev\meetme'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

$readme = Join-Path $Keys 'README.txt'
$jks = Join-Path $Keys 'upload.jks'
if (-not (Test-Path $jks)) { throw "Signing key not found: $jks" }
function KeyValue($name) {
  $line = Select-String -Path $readme -Pattern "^\s*$name\s*=" | Select-Object -First 1
  if (-not $line) { throw "$name is missing in $readme" }
  return ($line.Line -replace '^[^=]*=\s*', '').Trim()
}

Write-Host '1/3 Copying the project to' $Work
# Only changed files are copied. Build outputs and caches stay out of the copy.
$skip = @('.git', '.cxx', '.gradle', '.kotlin', (Join-Path $repo 'apps\mobile\android\app\build'),
  (Join-Path $repo 'apps\mobile\android\build'), (Join-Path $repo 'apps\desktop\dist'), (Join-Path $repo 'apps\desktop\out'))
robocopy $repo $Work /E /XD $skip /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy code $LASTEXITCODE)" }
if (-not (Test-Path "$Work\apps\mobile\node_modules")) {
  Write-Host '    apps\mobile\node_modules is missing: installing packages'
  Push-Location "$Work\apps\mobile"; npm ci; Pop-Location
}

Write-Host '2/3 Building (10-20 minutes; close Chrome and other big programs)'
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "C:\Program Files\nodejs;$env:JAVA_HOME\bin;$env:Path"
$env:MEETME_UPLOAD_STORE_FILE = $jks
$env:MEETME_UPLOAD_STORE_PASSWORD = KeyValue 'ANDROID_KEYSTORE_PASSWORD'
$env:MEETME_UPLOAD_KEY_ALIAS = KeyValue 'ANDROID_KEY_ALIAS'
$env:MEETME_UPLOAD_KEY_PASSWORD = KeyValue 'ANDROID_KEY_PASSWORD'
$arch = if ($AllPhones) { 'armeabi-v7a,arm64-v8a,x86,x86_64' } else { 'arm64-v8a' }

Push-Location "$Work\apps\mobile\android"
try {
  # 2 workers: a full-speed build can use more memory than the PC has.
  .\gradlew.bat --no-daemon --max-workers=2 "-PreactNativeArchitectures=$arch" assembleRelease -x lint
  if ($LASTEXITCODE -ne 0) { throw 'Build failed: read the error above' }
} finally {
  Pop-Location
  Remove-Item Env:MEETME_UPLOAD_STORE_PASSWORD, Env:MEETME_UPLOAD_KEY_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host '3/3 Copying the APK to the Desktop'
$version = (Select-String -Path "$Work\apps\mobile\android\app\build.gradle" -Pattern 'versionName\s+"([^"]+)"').Matches[0].Groups[1].Value
$desktop = [Environment]::GetFolderPath('Desktop')
$out = Join-Path $desktop "CellMate-$version.apk"
Copy-Item "$Work\apps\mobile\android\app\build\outputs\apk\release\app-release.apk" $out -Force
Write-Host ''
Write-Host "Done: $out"
