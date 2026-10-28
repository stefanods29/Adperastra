# Adperastra Step 01b packaging: builds the Tauri app and places it next to
# the setup launcher in build\Adperastra, so AdperastraSetup.exe starts it.
# Run from the repo root:  .\scripts\package-app.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $env:TEMP "adperastra-target"
}
Write-Host "Building frontend..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }
Write-Host "Building Adperastra app (Tauri, release, no bundle)..."
npx -y @tauri-apps/cli@2 build --no-bundle
if ($LASTEXITCODE -ne 0) { throw "tauri build failed" }

# Make sure the setup launcher package is current, then add the app exe.
& (Join-Path $PSScriptRoot "package-setup.ps1")
$out = Join-Path $root "build\Adperastra"
Copy-Item (Join-Path $env:CARGO_TARGET_DIR "release\Adperastra.exe") $out -Force
Copy-Item (Join-Path $root "help") (Join-Path $out "help") -Recurse -Force
Add-Content (Join-Path $out "RUN.txt") ""
Add-Content (Join-Path $out "RUN.txt") "4. The app itself: run Adperastra.exe, or just run AdperastraSetup.exe -"
Add-Content (Join-Path $out "RUN.txt") "   after a good check it now starts Adperastra.exe for you (Step 01b)."
Add-Content (Join-Path $out "RUN.txt") "   In the app: the + button opens Help, Settings and the component"
Add-Content (Join-Path $out "RUN.txt") "   gallery. F1 opens help. The Explorer tab can never be closed."
Write-Host "Done: $out"
