# Uses fresh temporary profiles and synthetic files, never the user's app data.
param(
    [ValidateSet('quick','full')][string]$Mode = 'quick',
    [string]$OutputDirectory = 'build\verification\runtime',
    [string]$Exe = '',
    [switch]$NoBuild
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
if (-not $env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'adperastra-target' }
if (-not $Exe) { $Exe = Join-Path $env:CARGO_TARGET_DIR 'release\Adperastra.exe' }
# Hosted runners' WebView2 ignores WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS and its
# policy (no port on its command line), but honors the window's own arguments.
# So there the test build gets a fixed port through a build-time config; the
# workflow rebuilds without it before packaging anything.
$hostedPort = 0
if ($env:GITHUB_ACTIONS -eq 'true') {
    $hostedPort = 9444
    if (-not $NoBuild) {
        $window = (Get-Content -LiteralPath (Join-Path $repo 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).app.windows[0]
        $window | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=$hostedPort --disable-background-timer-throttling --disable-renderer-backgrounding" -Force
        $overlay = Join-Path $env:RUNNER_TEMP 'adperastra-runtime-test.conf.json'
        @{ app = @{ windows = @($window) } } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $overlay -Encoding utf8NoBOM
        npx -y @tauri-apps/cli@2 build --no-bundle --config $overlay
        if ($LASTEXITCODE -ne 0) { throw 'Runtime app build failed' }
        $NoBuild = $true
    }
}
$latestSource = Get-ChildItem -LiteralPath (Join-Path $repo 'src'),(Join-Path $repo 'src-tauri\src'),(Join-Path $repo 'crates') -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $NoBuild -and (-not (Test-Path -LiteralPath $Exe) -or (Get-Item -LiteralPath $Exe).LastWriteTimeUtc -lt $latestSource.LastWriteTimeUtc)) {
    npx -y @tauri-apps/cli@2 build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Runtime app build failed' }
}
if (-not [IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory = Join-Path $repo $OutputDirectory }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$variants = @(@{ language='en'; theme='light'; scale=1 })
if ($Mode -eq 'full') {
    $variants = @()
    foreach ($scale in @(1,1.5)) {
        $variants += @{ language='en'; theme='light'; scale=$scale }
        $variants += @{ language='es'; theme='dark'; scale=$scale }
        $variants += @{ language='pseudo'; theme='light'; scale=$scale }
    }
}
foreach ($variant in $variants) {
    $runtimeRoot = Join-Path $env:TEMP ('adperastra-runtime-' + [guid]::NewGuid().ToString('N'))
    $dataDir = Join-Path $runtimeRoot 'data'
    $fixture = Join-Path $runtimeRoot 'files'
    New-Item -ItemType Directory -Force -Path $dataDir,$fixture,(Join-Path $fixture 'Destination') | Out-Null
    [IO.File]::WriteAllText((Join-Path $fixture 'notes.txt'), "runtime notes`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $fixture 'other.txt'), "other synthetic text`n", [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText((Join-Path $fixture 'table.csv'), "name,value`nexample,1`n", [Text.UTF8Encoding]::new($false))
    $settings = @{ schema_version=4; language=$variant.language; files=@{paste_image_format='png'}; theme=@{mode=$variant.theme;accent_source='design';accent_custom='#0067C0'}; explorer=@{show_hidden=$false;show_extensions=$true;item_checkboxes=$false;details_pane=$true;group_by='none'} }
    [IO.File]::WriteAllText((Join-Path $dataDir 'settings.json'), ($settings | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
    # Ask Windows for an unused local port; each app gets its own profile.
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $listener.Start(); $port = $listener.LocalEndpoint.Port; $listener.Stop()
    if ($hostedPort) { $port = $hostedPort }
    $savedData = $env:ADPERASTRA_DATA_DIR
    $savedBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $process = $null
    try {
        $env:ADPERASTRA_DATA_DIR = $dataDir
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --disable-background-timer-throttling --disable-renderer-backgrounding"
        $process = Start-Process -FilePath $Exe -PassThru -WindowStyle Hidden
        # A fresh WebView2 profile on a cold machine (hosted runners) can take
        # far longer than on the development PC; stop early if the app exits.
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        $ready = $false
        while (-not $ready -and -not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
            try { $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1; $ready = @($targets | Where-Object type -eq 'page').Count -gt 0 } catch { $lastError = $_.Exception.Message; Start-Sleep -Milliseconds 150 }
        }
        if (-not $ready) {
            $state = if ($process.HasExited) { "exited with code $($process.ExitCode)" } else { 'still running, no page on the debugging port after 90 s' }
            Write-Output "App $state. Files in the test data folder:"
            Write-Output "Last request error: $lastError"
            Get-ChildItem -LiteralPath $dataDir -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notlike '*\EBWebView\*' -or $_.Name -eq 'DevToolsActivePort' } | ForEach-Object {
                Write-Output "  $($_.FullName.Substring($dataDir.Length)) ($($_.Length) bytes)"
                if ($_.Extension -in '.log', '.txt' -and $_.Length -lt 65536) { Get-Content -LiteralPath $_.FullName -TotalCount 25 | ForEach-Object { Write-Output "    $_" } }
            }
            $webview = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue).Count
            Write-Output "WebView2 processes running: $webview"
            Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -notmatch '--type=' } | ForEach-Object { Write-Output "WebView2 browser process: $($_.CommandLine)" }
            Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '127.0.0.1','::1' } | ForEach-Object { Write-Output "Listening: $($_.LocalAddress):$($_.LocalPort) pid $($_.OwningProcess)" }
            Write-Output "Asked for port $port. Session: $([Diagnostics.Process]::GetCurrentProcess().SessionId). Interactive: $([Environment]::UserInteractive)"
            throw "The isolated WebView2 test app did not start ($state)"
        }
        node (Join-Path $PSScriptRoot 'verify-runtime.mjs') $port $fixture $OutputDirectory $variant.language $variant.theme $Mode ([string]$variant.scale)
        if ($LASTEXITCODE -ne 0) { throw "Runtime verification failed ($($variant.language)/$($variant.theme)/$($variant.scale))" }
    } finally {
        if ($process) {
            $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($process.Id)" -ErrorAction SilentlyContinue)
            $children | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
        $env:ADPERASTRA_DATA_DIR = $savedData
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $savedBrowserArgs
        $resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
        $resolvedRuntime = [IO.Path]::GetFullPath($runtimeRoot)
        if (-not $resolvedRuntime.StartsWith($resolvedTemp,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedRuntime) -notlike 'adperastra-runtime-*') { throw 'Refusing cleanup outside the generated test folder' }
        Remove-Item -LiteralPath $resolvedRuntime -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Output "Runtime $Mode verification passed. Reports: $OutputDirectory"
