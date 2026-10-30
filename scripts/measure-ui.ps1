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
  [switch]$ScreenshotsOnly
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
# The step names the results: from -Step, else the branch (step-<id>-...).
if (-not $Step) { $Step = if ((git -C $root branch --show-current) -match '^step-([0-9a-zA-Z]+)-') { $Matches[1] } else { "unknown" } }
if (-not (Test-Path $Exe)) { throw "Build the app first: $Exe not found" }
if (-not (Test-Path $BigFolder)) { throw "Run scripts\generate-corpus.ps1 first: $BigFolder not found" }

# A small folder that looks like the Figma example (zero-filled files).
$demo = Join-Path $env:TEMP "adperastra-demo"
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

$dataDir = Join-Path $env:TEMP ("adperastra-ui-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $dataDir | Out-Null
$settings = @{
  schema_version = 4; language = $Language
  files = @{ paste_image_format = "png" }
  theme = @{ mode = $Theme; accent_source = "design"; accent_custom = "#0067C0" }
  explorer = @{ show_hidden = $false; show_extensions = $true; item_checkboxes = $false; details_pane = $true; group_by = "none" }
}
[IO.File]::WriteAllText((Join-Path $dataDir "settings.json"), ($settings | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))

$env:ADPERASTRA_DATA_DIR = $dataDir
# Keep wry's own WebView2 switches and add the debugging port.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
$proc = Start-Process -FilePath $Exe -PassThru
try {
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
  $shotPath = if ($Shots) { Join-Path $root $Shots } else { "-" }
  node (Join-Path $PSScriptRoot "measure-ui.mjs") $Port $demo $BigFolder $mode $outPath $shotPath $Language $Theme $Step
  if ($LASTEXITCODE -ne 0) { throw "measure-ui.mjs failed" }
} finally {
  Remove-Item Env:\WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
  Remove-Item Env:\ADPERASTRA_DATA_DIR -ErrorAction SilentlyContinue
  Get-Process Adperastra -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  # A renamed copy (measure-ab.ps1) has another name; stop it too.
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $dataDir -ErrorAction SilentlyContinue
}
