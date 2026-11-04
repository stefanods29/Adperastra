# Build the unsigned Windows release artifacts (Step 08d T1/T4).
# Run from the repository root:
#   .\scripts\package-release.ps1 -Version 0.1.0 -Commit <40-hex-sha> -OutDir release
#
# This script never calls package-setup.ps1 and never reads a signing key.
# It produces only the public names listed in installer/artifacts.json and
# leaves them unpublished: release notes and docs/releases/0.1.0/artifacts.md
# stay in draft form until the owner authorizes publication.

param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Commit,
    [string]$OutDir = "release"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Tauri reads signing variables from the environment. Clear inherited values
# so a developer shell cannot turn the public build into a signed one.
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue

# Pin the CLI instead of resolving the newest 2.x at build time.
$TauriCli = "2.12.4"

function Assert-Inputs {
    if ($Version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw "Version must look like X.Y.Z without leading zeros."
    }
    if ($Commit -notmatch '^[0-9a-f]{40}$') {
        throw "Commit must be a full lowercase SHA."
    }
    $head = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $head -ne $Commit) {
        throw "Build the release from the requested commit: HEAD is '$head', expected '$Commit'."
    }
    if ((git status --porcelain).Trim().Length -gt 0) {
        throw "The working tree has uncommitted changes. Commit them before building a release."
    }
    $docs = Join-Path $root "docs/releases/$Version"
    foreach ($name in @("release-notes-en.md", "release-notes-es.md", "SOURCE-NOTICES.txt")) {
        if (-not (Test-Path -LiteralPath (Join-Path $docs $name))) {
            throw "Missing release document: docs/releases/$Version/$name"
        }
    }
    if ([string]::IsNullOrEmpty($env:CARGO_TARGET_DIR)) {
        $env:CARGO_TARGET_DIR = Join-Path $env:TEMP "adperastra-target"
    }
}

function New-EmptyDirectory([string]$Path) {
    if (Test-Path -LiteralPath $Path) {
        if ((Get-ChildItem -LiteralPath $Path -Force | Measure-Object).Count -gt 0) {
            throw "Output folder must be new or empty: $Path"
        }
    } else {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

Assert-Inputs
$out = Join-Path $root $OutDir
$docs = Join-Path $root "docs/releases/$Version"
New-EmptyDirectory $out

# The configuration already has Windows NSIS currentUser, the bilingual hook
# and no certificate. The before-build step runs npm run build.
npx -y "@tauri-apps/cli@$TauriCli" build
if ($LASTEXITCODE -ne 0) { throw "Tauri release build failed" }

$appExe = Join-Path $env:CARGO_TARGET_DIR "release\Adperastra.exe"
if (-not (Test-Path -LiteralPath $appExe)) { throw "Release app binary was not built" }

# D1: every version source must agree with the requested version.
& $appExe --release-tool versions $root $Version
if ($LASTEXITCODE -ne 0) { throw "Version sources do not match $Version" }

# T1: the build is release, has no debug port, no signing key and no model.
& $appExe --release-tool build $Version $Commit release none false 0
if ($LASTEXITCODE -ne 0) { throw "Build metadata is not release-safe" }

$setup = Get-ChildItem -LiteralPath (Join-Path $env:CARGO_TARGET_DIR "release\bundle\nsis") -Filter "*-setup.exe" -File |
    Select-Object -First 1
if (-not $setup) { throw "NSIS setup executable was not produced" }
$signature = Get-AuthenticodeSignature -LiteralPath $setup.FullName
if ($signature.Status -ne "NotSigned") {
    throw "The public installer must stay unsigned; signature status is '$($signature.Status)'."
}
Copy-Item -LiteralPath $setup.FullName -Destination (Join-Path $out "Adperastra-$Version-windows-x64-setup.exe")

# Portable folder: app, resources, notices and the marker.
$stage = Join-Path $env:TEMP ("adperastra-portable-" + [guid]::NewGuid().ToString("N"))
try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -LiteralPath $appExe -Destination $stage
    Copy-Item -LiteralPath (Join-Path $root "help") -Destination $stage -Recurse
    Copy-Item -LiteralPath (Join-Path $root "templates") -Destination $stage -Recurse
    Copy-Item -LiteralPath (Join-Path $root "LICENSE") -Destination $stage
    $webviewLoader = Join-Path $env:CARGO_TARGET_DIR "release\WebView2Loader.dll"
    if (Test-Path -LiteralPath $webviewLoader) {
        Copy-Item -LiteralPath $webviewLoader -Destination $stage
    }
    $thirdParty = Get-Content -LiteralPath (Join-Path $root "THIRD_PARTY_LICENSES.md") -Raw
    [IO.File]::WriteAllText((Join-Path $stage "THIRD_PARTY_LICENSES.txt"), $thirdParty, (New-Object Text.UTF8Encoding($false)))
    Copy-Item -LiteralPath (Join-Path $docs "SOURCE-NOTICES.txt") -Destination $stage
    Copy-Item -LiteralPath (Join-Path $root "installer/portable-readme.txt") -Destination (Join-Path $stage "README.txt")
    & (Join-Path $stage "Adperastra.exe") --write-portable-marker $stage
    if ($LASTEXITCODE -ne 0) { throw "Portable marker generation failed" }
    & (Join-Path $stage "Adperastra.exe") --release-tool tree $stage
    if ($LASTEXITCODE -ne 0) { throw "Portable content allowlist failed" }
    Compress-Archive -Path (Join-Path $stage "*") -DestinationPath (Join-Path $out "Adperastra-$Version-windows-x64-portable.zip")
} finally {
    # This is the generated staging folder, never a user data folder.
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}

# Public text artifacts.
Copy-Item -LiteralPath (Join-Path $docs "release-notes-en.md") -Destination $out
Copy-Item -LiteralPath (Join-Path $docs "release-notes-es.md") -Destination $out
$thirdParty = Get-Content -LiteralPath (Join-Path $root "THIRD_PARTY_LICENSES.md") -Raw
[IO.File]::WriteAllText((Join-Path $out "THIRD_PARTY_LICENSES.txt"), $thirdParty, (New-Object Text.UTF8Encoding($false)))
Copy-Item -LiteralPath (Join-Path $docs "SOURCE-NOTICES.txt") -Destination $out

# Manifest and checksums; then verify with the same rules as the release
# content checker. No hash or signature is written by hand.
& $appExe --release-tool write $out $Version $Commit
if ($LASTEXITCODE -ne 0) { throw "Release manifest generation failed" }
& $appExe --release-tool verify $out
if ($LASTEXITCODE -ne 0) { throw "Release manifest verification failed" }
node installer/check-release-artifacts.mjs $out $Version $Commit
if ($LASTEXITCODE -ne 0) { throw "Release content check failed" }

Write-Host "Done: $out (unsigned, unpublished)"
