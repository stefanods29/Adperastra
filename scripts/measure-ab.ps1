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
Copy-Item -LiteralPath $releaseExe -Destination $currentExe -Force -ErrorAction Stop

# The baseline build is cached per commit; its own measure-ui script drives
# it, because older scripts match older screens.
$baselineCommit = (git -C $repo rev-parse "$Baseline^{commit}")
if ($LASTEXITCODE -ne 0) { throw "Unknown baseline $Baseline" }
$baselineCommit = $baselineCommit.Trim()
$baselineExe = Join-Path $work "$baselineCommit.exe"
$tree = Join-Path $work "tree-$baselineCommit"
if (-not (Test-Path -LiteralPath $baselineExe) -or -not (Test-Path -LiteralPath $tree)) {
  if (Test-Path -LiteralPath $tree) { git -C $repo worktree remove --force $tree }
  git -C $repo worktree prune
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

# Run the baseline's own measurements from a temporary copy, with only its
# process-cleanup code replaced. Never edit the historical checkout, and fail
# closed if its driver no longer matches the expected cleanup statements.
$driverDir = Join-Path $work ("baseline-driver-" + [guid]::NewGuid().ToString('N'))
$driverScripts = Join-Path $driverDir 'scripts'
New-Item -ItemType Directory -Path $driverScripts | Out-Null
try {
$baselineDriver = Get-Content -LiteralPath (Join-Path $tree 'scripts\measure-ui.ps1') -Raw
$baselineJs = Get-Content -LiteralPath (Join-Path $tree 'scripts\measure-ui.mjs') -Raw
$oldStart = '$proc = Start-Process -FilePath $Exe -PassThru'
$newStart = @'
. (Join-Path $PSScriptRoot 'test-process-job.ps1')
$job = [AdperastraTestProcessJob]::Start([IO.Path]::GetFullPath($Exe), '', $true)
$proc = $job.Process
$env:ADPERASTRA_TEST_APP_PID = [string]$proc.Id
'@
$oldStop = 'Get-Process Adperastra -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue'
$newStop = 'if ($job) { $job.Dispose() }; Remove-Item Env:\ADPERASTRA_TEST_APP_PID -ErrorAction SilentlyContinue'
$oldClassic = 'Get-CimInstance Win32_Process -Filter \"Name = ''Adperastra.exe''\" | Where-Object { $_.CommandLine -like ''*--classic-menu*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
$newClassic = '$testId = 0; if (-not [int]::TryParse($env:ADPERASTRA_TEST_APP_PID, [ref]$testId) -or $testId -le 0) { throw ''Missing test app process id'' }; Get-CimInstance Win32_Process -Filter \"ParentProcessId=$testId\" | Where-Object { $_.CommandLine -like ''*--classic-menu*'' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
if (-not $baselineDriver.Contains($oldStart) -or -not $baselineDriver.Contains($oldStop) -or -not $baselineJs.Contains($oldClassic) -or
    ([regex]::Matches($baselineDriver, 'Stop-Process')).Count -ne 1 -or
    ([regex]::Matches($baselineJs, 'Stop-Process')).Count -ne 1 -or
    $baselineDriver -match '(?i)taskkill|\.Kill\(' -or $baselineJs -match '(?i)taskkill|\.kill\(') {
  throw 'Baseline driver cleanup is not recognized; refusing to run it.'
}
$baselineDriver = $baselineDriver.Replace($oldStart, $newStart).Replace($oldStop, $newStop)
$baselineJs = $baselineJs.Replace($oldClassic, $newClassic)
[IO.File]::WriteAllText((Join-Path $driverScripts 'measure-ui.ps1'), $baselineDriver, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $driverScripts 'measure-ui.mjs'), $baselineJs, [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'test-process-job.ps1') -Destination $driverScripts

$runs = @{ current = @(); baseline = @() }
foreach ($round in 1..$Rounds) {
  foreach ($which in 'baseline', 'current') {
    $json = Join-Path $work "$which-$round-$([guid]::NewGuid().ToString('N')).json"
    # A run can time out while the PC is busy; try up to three times.
    for ($try = 1; $try -le 3 -and -not (Test-Path -LiteralPath $json); $try++) {
      try {
        if ($which -eq 'current') { & (Join-Path $PSScriptRoot 'measure-ui.ps1') -Exe $currentExe -Out $json -Step $Step }
        else { & (Join-Path $driverScripts 'measure-ui.ps1') -Exe $baselineExe -Out $json }
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
} finally {
  $resolvedWork = [IO.Path]::GetFullPath($work).TrimEnd('\') + '\'
  $resolvedDriver = [IO.Path]::GetFullPath($driverDir)
  if (-not $resolvedDriver.StartsWith($resolvedWork, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedDriver) -notlike 'baseline-driver-*') { throw 'Refusing cleanup outside the generated baseline driver folder' }
  Remove-Item -LiteralPath $resolvedDriver -Recurse -Force -ErrorAction SilentlyContinue
}
