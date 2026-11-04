# Standalone debug preview: includes the frontend, with no development server.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
if (-not $env:CARGO_TARGET_DIR) {
    $env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'adperastra-target'
}

npm run build
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }

# Without custom-protocol, generate_context! selects build.devUrl even when
# dist exists. A copied cargo-debug binary then needs localhost:5173.
cargo build -p adperastra-app --bin Adperastra --features tauri/custom-protocol
if ($LASTEXITCODE -ne 0) { throw 'Standalone preview build failed' }

$folder = Join-Path $repo 'build\Adperastra'
$target = Join-Path $folder 'Adperastra-Preview.exe'
if (Get-Process -Name 'Adperastra-Preview' -ErrorAction SilentlyContinue) {
    throw 'Close Adperastra-Preview before replacing the preview executable'
}
New-Item -ItemType Directory -Path $folder -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'debug\Adperastra.exe') -Destination $target -Force
Get-FileHash -LiteralPath $target -Algorithm SHA256
