# Adperastra Step 01a packaging: builds the setup launcher and assembles a
# runnable folder in build\Adperastra (RUN.txt inside explains how to test).
# Run from the repo root:  .\scripts\package-setup.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:CARGO_TARGET_DIR) {
    # This PC's Windows security blocks cargo.exe from creating folders
    # under Documents, so build outputs go to Temp (see docs/benchmarks/MACHINE.md).
    $env:CARGO_TARGET_DIR = Join-Path $env:TEMP "adperastra-target"
}
Write-Host "Building AdperastraSetup (release)..."
cargo build --release -p setup
if ($LASTEXITCODE -ne 0) { throw "cargo build failed" }

$out = Join-Path $root "build\Adperastra"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item (Join-Path $env:CARGO_TARGET_DIR "release\AdperastraSetup.exe") $out -Force
Copy-Item (Join-Path $root "dependencies.json") $out -Force

# Bundled Inter font: a real required file component of the setup window.
$fontCache = Join-Path $root "build\payload-source\fonts"
New-Item -ItemType Directory -Force $fontCache | Out-Null
$fontFile = Join-Path $fontCache "Inter.ttf"
if (-not (Test-Path $fontFile)) {
    Write-Host "Downloading Inter font (SIL OFL)..."
    $css = Invoke-WebRequest "https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" -UserAgent "Mozilla/5.0" -UseBasicParsing
    $url = ([regex]::Match($css.Content, "https://[^\)]+\.ttf")).Value
    if (-not $url) { throw "Could not find Inter TTF URL" }
    Invoke-WebRequest $url -OutFile $fontFile -UseBasicParsing
}
$payloadFonts = Join-Path $out "payload\fonts"
New-Item -ItemType Directory -Force $payloadFonts | Out-Null
Copy-Item $fontFile $payloadFonts -Force
New-Item -ItemType Directory -Force (Join-Path $out "payload-source\fonts") | Out-Null
Copy-Item $fontFile (Join-Path $out "payload-source\fonts\Inter.ttf") -Force

# Build-folder manifest = repo manifest + the font file component.
$manifest = Get-Content (Join-Path $root "dependencies.json") -Raw | ConvertFrom-Json
$fontInfo = Get-Item $fontFile
$hash = (Get-FileHash $fontFile -Algorithm SHA256).Hash.ToLower()
$fontComponent = [ordered]@{
    id = "fonts"; name_key = "comp.fonts"; version = "4.0"
    kind = @{ type = "file"; path = "payload/fonts/Inter.ttf" }
    required = $true; size = $fontInfo.Length; sha256 = $hash
    source = @{ type = "local"; path = "payload-source/fonts/Inter.ttf" }
}
$manifest.components += [pscustomobject]$fontComponent
$json = $manifest | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $out "dependencies.json"), $json, (New-Object Text.UTF8Encoding($false)))
# Sign the build-folder manifest with the development key (outside the repo).
# The signer runs on a Temp copy: native Rust binaries cannot write under
# this PC's Documents folder (Windows security), PowerShell copies it back.
$keyFile = if ($env:ADPERASTRA_SIGNING_KEY) { $env:ADPERASTRA_SIGNING_KEY } else { Join-Path $env:USERPROFILE ".adperastra\dev-signing.key" }
if (-not (Test-Path $keyFile)) { throw "Signing key not found: $keyFile - run: manifest-tool keygen <keyfile>" }
$signTmp = Join-Path $env:TEMP "adperastra-build-manifest.json"
Copy-Item (Join-Path $out "dependencies.json") $signTmp -Force
& (Join-Path $env:CARGO_TARGET_DIR "release\manifest-tool.exe") sign $signTmp $keyFile
if ($LASTEXITCODE -ne 0) { throw "manifest signing failed" }
Copy-Item $signTmp (Join-Path $out "dependencies.json") -Force

$run = @(
"Adperastra - Step 01a test build"
"================================"
""
"1. Double-click AdperastraSetup.exe."
"   First time: the first-run window asks language, theme and optional packs."
"   After that: it starts silently (no window) because everything is present."
""
"2. Test repair: delete payload\fonts\Inter.ttf, then run AdperastraSetup.exe"
"   again. The Preparing window restores it and says it is ready."
""
"3. Command-line options:"
"   AdperastraSetup.exe --repair        re-check and repair now"
"   AdperastraSetup.exe --first-run     show the first-run window again"
"   AdperastraSetup.exe --reset-profile forget first-run choices"
"   AdperastraSetup.exe --headless --repair   repair without a window"
""
"Settings and the log are in data\ (next to this file when run with"
"--data-dir data) or in %LOCALAPPDATA%\Adperastra by default."
"The Explorer app itself arrives in Step 01b; until then a good check"
"just logs 'verify ok' and exits."
)
$run | Set-Content (Join-Path $out "RUN.txt") -Encoding utf8
Write-Host "Done: $out"
