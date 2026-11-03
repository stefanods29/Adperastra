# Step 03a UI speed and screenshots in the packaged app (plan/speed.md).
# Starts Adperastra with a fresh data folder and the WebView2 debugging
# port, then scripts\measure-ui.mjs drives the page: every number is the
# time from an action to the next painted frame (median of several runs).
#
# Run after the release build (npx -y @tauri-apps/cli@2 build --no-bundle)
# and scripts\generate-corpus.ps1:
#   .\scripts\measure-ui.ps1                       # English, light: speed + screenshots
#   .\scripts\measure-ui.ps1 -Language es -Theme dark -ScreenshotsOnly
param(
  [string]$Exe = (Join-Path $(if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $env:TEMP "adperastra-target" }) "release\Adperastra.exe"),
  [string]$BigFolder = (Join-Path $env:TEMP "adperastra-corpus\folder-100k"),
  [string]$Out = "",
  [string]$Shots = "",
  [ValidateSet("en", "es", "pseudo")][string]$Language = "en",
  [ValidateSet("light", "dark")][string]$Theme = "light",
  [int]$Port = 9333,
  [string]$Step = "",
  [switch]$ScreenshotsOnly,
  [switch]$Review06bc,
  [switch]$Review06e
)
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot 'test-process-job.ps1')
$root = Split-Path -Parent $PSScriptRoot
# The step names the results: from -Step, else the branch (step-<id>-...).
if (-not $Step) { $Step = if ((git -C $root branch --show-current) -match '^step-([0-9a-zA-Z]+)-') { $Matches[1] } else { "unknown" } }
if ($Review06e) { $Step = "06e" }
$scopedReview = $Review06bc -or $Review06e
if (-not (Test-Path $Exe)) { throw "Build the app first: $Exe not found" }
if (-not $scopedReview -and -not (Test-Path $BigFolder)) { throw "Run scripts\generate-corpus.ps1 first: $BigFolder not found" }

# A small folder that looks like the Figma example (zero-filled files). A
# scoped review always gets its own fresh folder.
$demo = if ($scopedReview) { Join-Path $env:TEMP ("adperastra-review-" + $(if ($Review06e) { "06e" } else { "06bc" }) + "-" + [guid]::NewGuid().ToString("N")) } else { Join-Path $env:TEMP "adperastra-demo" }
if (-not (Test-Path $demo)) {
  New-Item -ItemType Directory -Force $demo | Out-Null
  $files = @(
    @("Q4 Budget 2026.xlsx", 253952, 0), @("Project Overview.pptx", 4935680, 0), @("Meeting Notes.docx", 36864, 1),
    @("Website Homepage.png", 1277952, 1), @("Product Demo.mp4", 5242880, 2), @("Sales Report - October.xlsx", 190464, 3),
    @("Brand Guidelines.pdf", 8630272, 3), @("Logo - Final.png", 350208, 4), @("Team Presentation.mp4", 3145728, 5),
    @("Annual Forecast.xlsx", 319488, 12), @("Client Workshop.pptx", 6328320, 40), @("notes.txt", 2048, 400)
  )
  foreach ($f in $files) {
    $path = Join-Path $demo $f[0]
    $stream = [IO.File]::Create($path); $stream.SetLength($f[1]); $stream.Close()
    (Get-Item $path).LastWriteTime = (Get-Date).AddDays(-$f[2]).AddHours(-2)
  }
  foreach ($folder in @("Invoices", "Archive 2025")) { New-Item -ItemType Directory -Force (Join-Path $demo $folder) | Out-Null }
  $hidden = Join-Path $demo ".private-notes.txt"
  Set-Content -Path $hidden -Value "hidden"
  (Get-Item $hidden -Force).Attributes = "Hidden"
}

# Step 06d: archives for the archive tab (a small one for screenshots, a
# 10,000-entry one for the speed runs), made with .NET's zip writer.
$archives = Join-Path $env:TEMP "adperastra-corpus\archives"
if (-not $scopedReview -and -not (Test-Path $archives)) {
  New-Item -ItemType Directory -Force $archives | Out-Null
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $utf8 = New-Object Text.UTF8Encoding($false)
  $projectZip = Join-Path $archives "Project files.zip"
  $zip = [System.IO.Compression.ZipFile]::Open($projectZip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $entries = [ordered]@{
      "README.txt" = "This archive holds the project files."
      "docs/plan.md" = "# Plan"
      "docs/notes.txt" = "Notes"
      "docs/meeting notes.txt" = "Meeting"
      "data/table.csv" = "a,b`r`n1,2"
    }
    foreach ($name in $entries.Keys) {
      $writer = New-Object IO.StreamWriter($zip.CreateEntry($name).Open(), $utf8)
      $writer.Write($entries[$name])
      $writer.Dispose()
    }
    $zip.CreateEntry("images/") | Out-Null
  } finally { $zip.Dispose() }
  $bigZip = Join-Path $archives "Big archive.zip"
  $zip = [System.IO.Compression.ZipFile]::Open($bigZip, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    for ($folder = 1; $folder -le 10; $folder += 1) {
      for ($file = 1; $file -le 1000; $file += 1) {
        $name = "folder {0:D2}/file {1:D4}.txt" -f $folder, $file
        $writer = New-Object IO.StreamWriter($zip.CreateEntry($name).Open(), $utf8)
        $writer.Write("file $file")
        $writer.Dispose()
      }
    }
  } finally { $zip.Dispose() }
}

$dataDir = Join-Path $env:TEMP ("adperastra-ui-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $dataDir | Out-Null
$settings = @{
  schema_version = 16; language = $Language
  files = @{ paste_image_format = "png" }
  open = @{ protected_view = $true; open_with = @{} }
  theme = @{ mode = $Theme; accent_source = "design"; accent_custom = "#0067C0"; light_theme = "light"; dark_theme = "dark" }
  appearance = @{ ui_scale = 100; density = "comfortable"; corner_radius = "standard"; animations = "full" }
  explorer = @{ show_hidden = $false; show_extensions = $true; item_checkboxes = $false; details_pane = $true; group_by = "none"; view_mode = "details"; remember_view_per_folder = $true; view_mode_order = @("extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "tiles", "content", "columns"); hidden_view_modes = @(); column_width = 240; column_preview = $true }
  layout = @{ toolbar_position = "top"; toolbar_mode = "full"; tab_bar_position = "top"; tab_bar_collapsed = $false; nav_pane_position = "left"; details_pane_position = "right"; saved_presets = @() }
  versions = @{ enabled = $true; keep_days = 30; max_mb = 1024 }
  templates = @{ my_folder = "" }
  background = @{ enabled = $true; only_idle = $false; only_ac = $false; paused = $false; tasks = @{ thumbnails = $true; metadata = $true; ocr = $true; version_cleanup = $true; filename_index = $false; content_index = $false; folder_sizes = $false; storage_scan = $false; pack_download = $false } }
  cache = @{ max_mb = 512 }
  gallery = @{ sources = @(); date_source = "taken" }
  ocr = @{ language = "auto"; enabled = true }
  reading = @{ font_px = 18; theme = "app" }
}
[IO.File]::WriteAllText((Join-Path $dataDir "settings.json"), ($settings | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

$savedData = $env:ADPERASTRA_DATA_DIR
$savedBrowserArgs = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$savedTestPid = $env:ADPERASTRA_TEST_APP_PID
$env:ADPERASTRA_DATA_DIR = $dataDir
# Keep wry's own WebView2 switches and add the debugging port.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
$job = $null
try {
  $job = [AdperastraTestProcessJob]::Start([IO.Path]::GetFullPath($Exe), '', $true)
  $proc = $job.Process
  $env:ADPERASTRA_TEST_APP_PID = [string]$proc.Id
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $ready = $false
  while (-not $ready -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 300
    try { Invoke-RestMethod "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 | Out-Null; $ready = $true } catch { }
  }
  if (-not $ready) { throw "the WebView2 debugging port did not open" }
  $mode = if ($ScreenshotsOnly) { "screenshots" } else { "full" }
  # PowerShell drops empty arguments, so "-" stands for "none".
  $outPath = if ($Out) { $Out } else { "-" }
  $shotPath = if (-not $Shots) { "-" } elseif ([IO.Path]::IsPathRooted($Shots)) { $Shots } else { Join-Path $root $Shots }
  if ($Review06e) {
    # Fresh fixtures, no legacy file-operation checks, and no folder cleanup.
    node (Join-Path $PSScriptRoot "check-06e-ui.mjs") $Port $demo $outPath $shotPath $Language $Theme
  } elseif ($Review06bc) {
    node (Join-Path $PSScriptRoot "check-06bc-ui.mjs") $Port $demo $outPath $shotPath $Language $Theme
  } else {
    node (Join-Path $PSScriptRoot "measure-ui.mjs") $Port $demo $BigFolder $mode $outPath $shotPath $Language $Theme $Step
  }
  if ($LASTEXITCODE -ne 0) { throw "UI verification failed" }
} finally {
  try { if ($job) { $job.Dispose() } } finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $savedBrowserArgs
    $env:ADPERASTRA_DATA_DIR = $savedData
    $env:ADPERASTRA_TEST_APP_PID = $savedTestPid
    $resolvedTemp = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    $resolvedData = [IO.Path]::GetFullPath($dataDir)
    if (-not $resolvedData.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedData) -notlike 'adperastra-ui-*') { throw 'Refusing cleanup outside the generated test folder' }
    if ($scopedReview) {
      Write-Host "Retained review data: $resolvedData"
      Write-Host "Retained review files: $demo"
    } else {
      Remove-Item -LiteralPath $resolvedData -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
