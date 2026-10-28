# Generates the Step 02 speed corpus (plan/speed.md): a folder with
# 100,000 small files plus 100 subfolders, in %TEMP% (never committed).
# Run from the repo root:  .\scripts\generate-corpus.ps1 [-Count 100000]
param([int]$Count = 100000, [string]$Target = (Join-Path $env:TEMP "adperastra-corpus\folder-100k"))
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = Join-Path $env:TEMP "adperastra-target" }
$prevPref = $ErrorActionPreference; $ErrorActionPreference = "Continue"; cargo build --release -p fs-service --bin fs-bench 2>$null | Out-Null; $ErrorActionPreference = $prevPref
if ($LASTEXITCODE -ne 0) { throw "fs-bench build failed" }
$bench = Join-Path $env:CARGO_TARGET_DIR "release\fs-bench.exe"
& $bench generate $Target $Count
if ($LASTEXITCODE -ne 0) { throw "corpus generation failed" }
& $bench bench $Target 5
Write-Host "Corpus ready: $Target"