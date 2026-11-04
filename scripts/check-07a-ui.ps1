# Scoped Step 07a release verification. All generated files are retained.
param(
    [string]$Exe = (Join-Path $(if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $env:TEMP 'adperastra-target' }) 'release\Adperastra.exe'),
    [ValidateSet('en', 'es', 'pseudo')][string]$Language = 'en',
    [ValidateSet('light', 'dark')][string]$Theme = 'light',
    [int]$Port = 9347,
    [string]$Out = '',
    [string]$Shots = '',
    [ValidateSet('release', 'debug')][string]$BuildProfile = 'release'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'test-process-job.ps1')
if (-not (Test-Path -LiteralPath $Exe)) { throw "Build the release app first: $Exe" }
# Refuse an occupied port instead of attaching to somebody else's app.
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } finally { $listener.Stop() }
$review = Join-Path $env:TEMP ('adperastra-review-07a-' + [guid]::NewGuid().ToString('N'))
$demo = Join-Path $review 'step07a'
$data = Join-Path $review 'data'
New-Item -ItemType Directory -Path $demo, $data, (Join-Path $demo 'many') | Out-Null
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap(400, 200)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
    $graphics.Clear([Drawing.Color]::Blue)
    $graphics.FillRectangle([Drawing.Brushes]::Green, 200, 0, 200, 200)
    $bitmap.Save((Join-Path $demo 'landscape.png'), [Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
$portrait = New-Object Drawing.Bitmap(200, 400)
$graphics = [Drawing.Graphics]::FromImage($portrait)
$memory = New-Object IO.MemoryStream
try {
    $graphics.Clear([Drawing.Color]::Blue)
    $graphics.FillRectangle([Drawing.Brushes]::Green, 0, 200, 200, 200)
    $portrait.Save($memory, [Drawing.Imaging.ImageFormat]::Jpeg)
    $jpeg = $memory.ToArray()
    # APP1 Exif, little-endian TIFF, one SHORT orientation tag with value 6.
    [byte[]]$exif = @(255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0)
    [IO.File]::WriteAllBytes((Join-Path $demo 'portrait.jpg'), [byte[]](@($jpeg[0..1]) + $exif + @($jpeg[2..($jpeg.Length - 1)])))
} finally { $memory.Dispose(); $graphics.Dispose(); $portrait.Dispose() }
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $demo 'broken.png'), 'not a picture', $utf8)
[IO.File]::WriteAllText((Join-Path $demo 'notes.txt'), 'Thumbnail fallback', $utf8)
for ($index = 1; $index -le 1000; $index++) {
    [IO.File]::Copy((Join-Path $demo 'landscape.png'), (Join-Path $demo ('many\picture-{0:D4}.png' -f $index)), $false)
}
$settings = @{
    schema_version = 12; language = $Language
    theme = @{ mode = $Theme; accent_source = 'design'; accent_custom = '#0067C0'; light_theme = 'light'; dark_theme = 'dark' }
    explorer = @{ show_hidden = $false; show_extensions = $true; item_checkboxes = $false; details_pane = $true; group_by = 'none'; view_mode = 'largeIcons'; remember_view_per_folder = $false; view_mode_order = @('extraLargeIcons', 'largeIcons', 'mediumIcons', 'smallIcons', 'list', 'details', 'tiles', 'content', 'columns'); hidden_view_modes = @(); column_width = 240; column_preview = $true }
    background = @{ enabled = $true; only_idle = $false; only_ac = $false; paused = $false; tasks = @{ thumbnails = $true; metadata = $true; ocr = $true; version_cleanup = $true; filename_index = $false; content_index = $false; folder_sizes = $false; storage_scan = $false; pack_download = $false } }
    cache = @{ max_mb = 128 }
}
[IO.File]::WriteAllText((Join-Path $data 'settings.json'), ($settings | ConvertTo-Json -Depth 6), $utf8)
if (-not $Out) { $Out = Join-Path $review 'result.json' }
if (-not $Shots) { $Shots = Join-Path $review 'screenshots' }
$savedData = $env:ADPERASTRA_DATA_DIR
$savedBrowser = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$savedPid = $env:ADPERASTRA_TEST_APP_PID
$job = $null
try {
    $env:ADPERASTRA_DATA_DIR = $data
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
    $started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $job = [AdperastraTestProcessJob]::Start([IO.Path]::GetFullPath($Exe), '', $true)
    $env:ADPERASTRA_TEST_APP_PID = [string]$job.Process.Id
    $ready = $false
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while (-not $ready -and [DateTime]::UtcNow -lt $deadline) {
        Start-Sleep -Milliseconds 100
        try { Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 1 | Out-Null; $ready = $true } catch { }
    }
    if (-not $ready) { throw 'The owned test app did not expose its debugging port.' }
    node (Join-Path $PSScriptRoot 'check-07a-ui.mjs') $Port $demo $data $Out $Shots $Language $Theme $started $BuildProfile
    if ($LASTEXITCODE -ne 0) { throw "Step 07a UI verification failed; evidence: $Out" }
} finally {
    try { if ($job) { $job.Dispose() } } finally {
        $env:ADPERASTRA_DATA_DIR = $savedData
        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $savedBrowser
        $env:ADPERASTRA_TEST_APP_PID = $savedPid
        Write-Host "Retained Step 07a fixtures and data: $review"
        Write-Host "Verification output: $Out"
    }
}
