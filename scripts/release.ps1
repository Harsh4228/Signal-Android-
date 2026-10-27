# One command for a full release: test, raise the version, save to GitHub, put the server live,
# build the APK and the Windows installer.
#
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1                  # 1.1.1 -> 1.1.2
#   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Version 1.2.0   # pick the number yourself
#   ... -SkipServer -SkipApk -SkipDesktop                                          # leave a step out
#
# The server is only redeployed when apps/server, packages/core or infra changed since the last release.
# Commit your code changes first: this script refuses to run with unsaved changes.
param(
  [string]$Version,
  [switch]$SkipServer,
  [switch]$SkipApk,
  [switch]$SkipDesktop
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Run($what, [scriptblock]$cmd) {
  Write-Host ''
  Write-Host "== $what" -ForegroundColor Cyan
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$what failed: read the error above" }
}

# ---- 0. checks
if ((git branch --show-current) -ne 'main') { throw 'Switch to the main branch first (git checkout main)' }
if (git status --porcelain) { throw 'You have unsaved changes. Commit them first (git add -A; git commit -m "...")' }
Run 'Get the latest from GitHub' { git pull -q --ff-only origin main }

$gradle = Join-Path $repo 'apps\mobile\android\app\build.gradle'
$desktopPkg = Join-Path $repo 'apps\desktop\package.json'
$gradleText = Get-Content $gradle -Raw
$oldName = [regex]::Match($gradleText, 'versionName\s+"([^"]+)"').Groups[1].Value
$oldCode = [int][regex]::Match($gradleText, 'versionCode\s+(\d+)').Groups[1].Value
if (-not $Version) {
  $p = $oldName.Split('.')
  $Version = "$($p[0]).$($p[1]).$([int]$p[2] + 1)"
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3, not '$Version'" }
$tag = "v$Version"
if (git tag --list $tag) { throw "$tag already exists: pick a higher -Version" }
$lastTag = git tag --list 'v*' --sort=-v:refname | Select-Object -First 1
Write-Host "Release $oldName (code $oldCode) -> $Version (code $($oldCode + 1))"

# ---- 1. test
Run 'Typecheck' { npm run typecheck }
Run 'Tests' { npm test }

# ---- 2. version number (phones only install an update with a higher versionCode)
$gradleText = $gradleText -replace 'versionCode\s+\d+', "versionCode $($oldCode + 1)" -replace 'versionName\s+"[^"]+"', "versionName `"$Version`""
[IO.File]::WriteAllText($gradle, $gradleText)
$pkgText = (Get-Content $desktopPkg -Raw) -replace '"version":\s*"[^"]+"', "`"version`": `"$Version`""
[IO.File]::WriteAllText($desktopPkg, $pkgText)

# ---- 3. save to GitHub (every remote, so both repos stay the same). The tag also starts the GitHub builds.
Run 'Commit the version' { git commit -q -am "Release $tag" }
Run 'Tag' { git tag $tag }
foreach ($remote in git remote) {
  Run "Push to $remote" { git push -q $remote main $tag }
}

# ---- 4. server
$serverChanged = -not $lastTag
if ($lastTag) {
  git diff --quiet $lastTag HEAD -- apps/server packages/core infra
  $serverChanged = $LASTEXITCODE -ne 0
}
if ($SkipServer) { Write-Host "`n== Server: skipped (-SkipServer)" }
elseif (-not $serverChanged) { Write-Host "`n== Server: no changes since $lastTag, not redeployed" }
else { Run 'Deploy the server' { powershell -ExecutionPolicy Bypass -File "$repo\scripts\deploy-server.ps1" } }

# ---- 5. apps
if ($SkipApk) { Write-Host "`n== APK: skipped (-SkipApk)" }
else { Run 'Build the APK' { powershell -ExecutionPolicy Bypass -File "$repo\scripts\build-apk.ps1" } }

if ($SkipDesktop) { Write-Host "`n== Windows installer: skipped (-SkipDesktop)" }
else { Run 'Build the Windows installer' { npm run dist:win -w @meetme/desktop } }

Write-Host ''
Write-Host "Release $tag done." -ForegroundColor Green
if (-not $SkipApk) { Write-Host "  APK:       $([Environment]::GetFolderPath('Desktop'))\CellMate-$Version.apk" }
if (-not $SkipDesktop) { Write-Host "  Installer: $repo\apps\desktop\dist\" }
Write-Host '  GitHub Actions is also building it: GitHub -> Actions -> Artifacts'
