# Speed gate (plan/speed.md): measure this build and the previous step's
# tagged build alternately on the same PC, so background load on the PC
# affects both the same way. Writes one JSON whose rows are the median of
# the runs, with the previous step's numbers under ab_baseline;
# compare-benchmarks.mjs then checks tiers and the 20% rule against them.
#   .\scripts\measure-ab.ps1 -Step 03b -Baseline v0.0.5-step03a -Out <json>
# Run after the release build (it measures the current Adperastra.exe).
param(
  [Parameter(Mandatory = $true)][string]$Step,
  [Parameter(Mandatory = $true)][string]$Baseline,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Rounds = 3
)
# Native tools (git, npm) write progress to stderr, which Windows PowerShell
# 5.1 turns into errors; every native call checks $LASTEXITCODE instead.
$ErrorActionPreference = 'Continue'
$repo = Split-Path -Parent $PSScriptRoot
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'adperastra-target' }
$work = Join-Path $env:TEMP 'adperastra-ab'
New-Item -ItemType Directory -Force $work | Out-Null
$releaseExe = Join-Path $env:CARGO_TARGET_DIR 'release\Adperastra.exe'
$currentExe = Join-Path $work "current-$Step.exe"
Copy-Item -LiteralPath $releaseExe -Destination $currentExe -Force

# The baseline build is cached per commit; its own measure-ui script drives
# it, because older scripts match older screens.
$baselineCommit = (git -C $repo rev-parse "$Baseline^{commit}")
if ($LASTEXITCODE -ne 0) { throw "Unknown baseline $Baseline" }
$baselineCommit = $baselineCommit.Trim()
$baselineExe = Join-Path $work "$baselineCommit.exe"
$tree = Join-Path $work "tree-$baselineCommit"
if (-not (Test-Path -LiteralPath $baselineExe) -or -not (Test-Path -LiteralPath $tree)) {
  if (Test-Path -LiteralPath $tree) { git -C $repo worktree remove --force $tree }
  git -C $repo worktree add --detach $tree $baselineCommit
  if ($LASTEXITCODE -ne 0) { throw 'Could not check out the baseline' }
  # A separate build folder: building another checkout of the same
  # workspace crates into the shared one leaves stale artifacts behind.
  $savedTarget = $env:CARGO_TARGET_DIR
  $env:CARGO_TARGET_DIR = Join-Path $work 'target'
  Push-Location $tree
  try {
    npm ci --silent
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed for the baseline' }
    npx -y @tauri-apps/cli@2 build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Baseline build failed' }
    Copy-Item -LiteralPath (Join-Path $env:CARGO_TARGET_DIR 'release\Adperastra.exe') -Destination $baselineExe -Force
  } finally {
    Pop-Location
    $env:CARGO_TARGET_DIR = $savedTarget
  }
}

$runs = @{ current = @(); baseline = @() }
foreach ($round in 1..$Rounds) {
  foreach ($which in 'baseline', 'current') {
    $json = Join-Path $work "$which-$round-$([guid]::NewGuid().ToString('N')).json"
    # A run can time out while the PC is busy; try up to three times.
    for ($try = 1; $try -le 3 -and -not (Test-Path -LiteralPath $json); $try++) {
      try {
        if ($which -eq 'current') { & (Join-Path $PSScriptRoot 'measure-ui.ps1') -Exe $currentExe -Out $json -Step $Step }
        else { & (Join-Path $tree 'scripts\measure-ui.ps1') -Exe $baselineExe -Out $json }
      } catch { Write-Host "run failed ($which, round $round, try $try): $_" }
    }
    if (-not (Test-Path -LiteralPath $json)) { throw "No $which measurement in round $round" }
    $runs[$which] += , (Get-Content -LiteralPath $json -Raw)
  }
}
$combine = Join-Path $work 'runs.json'
@{ current = $runs.current; baseline = $runs.baseline } | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $combine -Encoding utf8
node (Join-Path $PSScriptRoot 'compare-benchmarks.mjs') --combine $combine $Step $Baseline $Out
if ($LASTEXITCODE -ne 0) { throw 'Could not combine the measurements' }
