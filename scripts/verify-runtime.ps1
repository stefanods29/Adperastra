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
$latestSource = Get-ChildItem -LiteralPath (Join-Path $repo 'src'),(Join-Path $repo 'src-tauri\src'),(Join-Path $repo 'crates') -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if (-not $NoBuild -and (-not (Test-Path -LiteralPath $Exe) -or (Get-Item -LiteralPath $Exe).LastWriteTimeUtc -lt $latestSource.LastWriteTimeUtc)) {
    npx -y @tauri-apps/cli@2 build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Runtime app build failed' }
}
$OutputDirectory = [IO.Path]::GetFullPath((Join-Path $repo $OutputDirectory))
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
    $savedData = $env:ADPERASTRA_DATA_DIR
    $savedBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
    $process = $null
    try {
        $env:ADPERASTRA_DATA_DIR = $dataDir
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port --disable-background-timer-throttling --disable-renderer-backgrounding"
        $process = Start-Process -FilePath $Exe -PassThru -WindowStyle Hidden
        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        $ready = $false
        while (-not $ready -and [DateTime]::UtcNow -lt $deadline) {
            try { $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/list" -TimeoutSec 1; $ready = @($targets | Where-Object type -eq 'page').Count -gt 0 } catch { Start-Sleep -Milliseconds 150 }
        }
        if (-not $ready) { throw 'The isolated WebView2 test app did not start' }
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
