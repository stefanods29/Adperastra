# Developer verification only. Reports/logs never ship with the app.
# .\scripts\test-all.ps1 -Mode quick   (also -Quick or --quick)
# .\scripts\test-all.ps1 -Mode full    (also -Full or --full)
[CmdletBinding(PositionalBinding = $false)]
param(
    [ValidateSet('quick', 'full')][string]$Mode = 'quick',
    [switch]$Quick,
    [switch]$Full,
    [string]$OutputDirectory,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$LegacyArguments
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
foreach ($argument in $LegacyArguments) {
    switch ($argument) {
        '--quick' { $Quick = $true }
        '--full' { $Full = $true }
        default { throw "Unknown verification argument: $argument" }
    }
}
if ($Quick -and $Full) { throw 'Choose quick or full, not both.' }
if ($Quick) {
    if ($PSBoundParameters.ContainsKey('Mode') -and $Mode -ne 'quick') { throw 'Conflicting verification modes.' }
    $Mode = 'quick'
}
if ($Full) {
    if ($PSBoundParameters.ContainsKey('Mode') -and $Mode -ne 'full') { throw 'Conflicting verification modes.' }
    $Mode = 'full'
}
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'adperastra-target' }
if (-not $OutputDirectory) {
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
    $OutputDirectory = Join-Path $repo "build\verification\$stamp-$Mode"
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$started = [DateTime]::UtcNow
$checks = [Collections.Generic.List[object]]::new()
$processShell = (Get-Process -Id $PID).Path
$toolBin = Join-Path $env:LOCALAPPDATA 'AdperastraDevTools\bin'
if (Test-Path -LiteralPath $toolBin) { $env:PATH = "$toolBin;$env:PATH" }

function Invoke-Verification {
    param([string]$Name, [scriptblock]$Command)
    $number = $checks.Count + 1
    $logName = '{0:D2}-{1}.log' -f $number, ($Name.ToLowerInvariant() -replace '[^a-z0-9]+', '-')
    $logPath = Join-Path $OutputDirectory $logName
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $code = 1
    Write-Host "`n==> $Name" -ForegroundColor Cyan
    try {
        $global:LASTEXITCODE = 0
        & $Command *>&1 | Tee-Object -FilePath $logPath | ForEach-Object { Write-Host $_ }
        $code = $LASTEXITCODE
    } catch {
        $_ | Out-String | Tee-Object -FilePath $logPath -Append | ForEach-Object { Write-Host $_ }
    }
    $checks.Add([pscustomobject]@{
        name = $Name; passed = ($code -eq 0); exit_code = $code
        seconds = [Math]::Round($clock.Elapsed.TotalSeconds, 3); log = $logName
    })
}

function Assert-PinnedTool {
    param([string]$Name, [string]$Version)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Missing $Name $Version. Install once: cargo install $Name --version $Version --locked --root `"$($env:LOCALAPPDATA)\AdperastraDevTools`""
    }
    $actual = & $command.Source --version
    if ($LASTEXITCODE -ne 0 -or $actual -ne "$Name $Version") { throw "Expected $Name $Version; found $actual" }
    Write-Host $actual
}

Invoke-Verification 'Verification helper regression tests' { node --test scripts/verification-checks.test.mjs }
Invoke-Verification 'Tracked file sizes and secrets' { node scripts/verification-checks.mjs repo }
Invoke-Verification 'Rust formatting' { cargo fmt --all -- --check }
Invoke-Verification 'Rust lints' { cargo clippy --workspace --all-targets --locked -- -D warnings }
Invoke-Verification 'Rust unit integration and file safety tests' { cargo test --workspace --locked }
Invoke-Verification 'Translations and hardcoded text' { npm run lint:i18n }
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'check-ipc.mjs')) {
    Invoke-Verification 'Tauri command registration permissions and arguments' { node scripts/check-ipc.mjs }
}
Invoke-Verification 'UI logic and component tests' { npm test }
Invoke-Verification 'Help language parity and links' { node scripts/verification-checks.mjs help }
Invoke-Verification 'TypeScript and UI build' { npm run build }
Invoke-Verification 'JavaScript dependency licenses' { node scripts/verification-checks.mjs licenses }
Invoke-Verification 'Rust dependency licenses' {
    Assert-PinnedTool 'cargo-deny' '0.20.2'
    $config = Join-Path $OutputDirectory 'licenses.toml'
    node scripts/verification-checks.mjs cargo-config $config
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate the license configuration.' }
    cargo deny --target x86_64-pc-windows-msvc --locked --config $config check licenses
}
Invoke-Verification 'Rust vulnerability audit' {
    Assert-PinnedTool 'cargo-audit' '0.22.2'
    $auditLines = & cargo audit --json --file Cargo.lock 2>&1
    $auditExit = $LASTEXITCODE
    $auditLines | ForEach-Object { Write-Output $_ }
    # cargo-audit can return zero even when registry checks time out.
    # Incomplete network verification is a failure, not a clean audit.
    if ($auditExit -ne 0 -or @($auditLines | Where-Object { $_.ToString() -match '^error:' }).Count -gt 0) {
        $global:LASTEXITCODE = 1
    }
}
Invoke-Verification 'JavaScript vulnerability audit' { npm audit --json --audit-level=low }
Invoke-Verification "Packaged runtime $Mode checks" {
    $runtime = Join-Path $PSScriptRoot 'verify-runtime.ps1'
    if (-not (Test-Path -LiteralPath $runtime)) { throw 'Missing scripts/verify-runtime.ps1; runtime checks did not run.' }
    & $processShell -NoProfile -ExecutionPolicy Bypass -File $runtime -Mode $Mode -OutputDirectory (Join-Path $OutputDirectory 'runtime')
}

$failures = @($checks | Where-Object { -not $_.passed })
$report = [ordered]@{
    schema = 1; mode = $Mode; passed = ($failures.Count -eq 0)
    started_utc = $started.ToString('o'); completed_utc = [DateTime]::UtcNow.ToString('o')
    commit = (git rev-parse HEAD); branch = (git branch --show-current)
    working_tree_dirty = [bool](git status --porcelain --untracked-files=no)
    checks = @($checks.ToArray())
    scope = 'Implemented features through Step 03b. Fuzz/parser suites begin in 04a; Office/AI/installer suites begin at their planned steps.'
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'report.json') -Encoding utf8
$rows = foreach ($check in $checks) {
    $name = [Net.WebUtility]::HtmlEncode($check.name)
    $status = if ($check.passed) { 'PASS' } else { 'FAIL' }
    "<tr><td>$status</td><td>$name</td><td>$($check.seconds)</td><td><a href=`"$($check.log)`">Log</a></td></tr>"
}
$title = if ($report.passed) { 'Verification passed' } else { 'Verification failed' }
$html = @"
<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Adperastra $title</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #ccc}a{color:#0754b8}</style>
<h1>$title</h1><p>Mode: $Mode. Commit: $($report.commit). Started: $($report.started_utc).</p>
<p>$($report.scope)</p><table><thead><tr><th>Result</th><th>Check</th><th>Seconds</th><th>Details</th></tr></thead><tbody>$($rows -join "`n")</tbody></table>
<p><a href="report.json">Machine-readable report</a></p></html>
"@
Set-Content -LiteralPath (Join-Path $OutputDirectory 'report.html') -Value $html -Encoding utf8
Write-Host "`n$($checks.Count - $failures.Count)/$($checks.Count) checks passed. Report: $(Join-Path $OutputDirectory 'report.html')"
if ($failures.Count) { exit 1 }
Write-Host "VERIFICATION PASSED ($Mode)" -ForegroundColor Green
exit 0



