# gate.ps1 - the one check to run after every task and before every commit.
#
#   .\scripts\gate.ps1            run every check (about 1-4 minutes)
#   .\scripts\gate.ps1 -Package   also build the packaged app (scripts\package-app.ps1)
#
# It stops at the first failing check, prints FAILED with the check's name,
# and exits with code 1. It never changes files. When it prints
# "GATE PASSED", the task may be committed.
# Works in Windows PowerShell 5.1 and PowerShell 7.
param(
    [switch]$Package
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not $env:CARGO_TARGET_DIR) {
    # Windows security on the development PC blocks cargo from writing
    # build output under Documents (docs/benchmarks/MACHINE.md).
    $env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'adperastra-target'
}

$script:results = @()

function Invoke-Check {
    param([string]$Name, [scriptblock]$Command)
    Write-Host ''
    Write-Host "==> $Name" -ForegroundColor Cyan
    $started = Get-Date
    & $Command
    $code = $LASTEXITCODE
    $seconds = [int]((Get-Date) - $started).TotalSeconds
    if ($code -ne 0) {
        Write-Host ''
        Write-Host "FAILED: $Name (exit code $code, $seconds s)" -ForegroundColor Red
        Write-Host 'Fix the first error printed above, then run .\scripts\gate.ps1 again.' -ForegroundColor Red
        exit 1
    }
    $script:results += "  ok  $Name ($seconds s)"
}

Invoke-Check 'No tracked file over 50 MB' {
    $big = @()
    foreach ($path in (git ls-files)) {
        $file = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
        if ($file -and -not $file.PSIsContainer -and $file.Length -gt 50MB) { $big += $path }
    }
    foreach ($path in $big) { Write-Host "too big (over 50 MB): $path" -ForegroundColor Red }
    if ($big.Count -gt 0) { $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
}
Invoke-Check 'Rust formatting (cargo fmt --check)' { cargo fmt --all -- --check }
Invoke-Check 'Rust lints (cargo clippy, warnings are errors)' { cargo clippy --workspace --all-targets -- -D warnings }
Invoke-Check 'Rust tests (cargo test)' { cargo test --workspace }
Invoke-Check 'Translations (npm run lint:i18n)' { npm run --silent lint:i18n }
Invoke-Check 'Tauri commands (npm run lint:ipc)' { npm run --silent lint:ipc }
Invoke-Check 'UI tests (npm test)' { npm test --silent }
Invoke-Check 'UI type check and build (npm run build)' { npm run --silent build }
if ($Package) {
    Invoke-Check 'Packaged app (scripts\package-app.ps1)' { & (Join-Path $PSScriptRoot 'package-app.ps1') }
}

Write-Host ''
$script:results | ForEach-Object { Write-Host $_ -ForegroundColor Green }
Write-Host 'GATE PASSED' -ForegroundColor Green
exit 0
