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
  schema_version = 56; language = $Language
  files = @{ paste_image_format = "png" }
  open = @{ protected_view = $true; open_with = @{} }
  theme = @{ mode = $Theme; accent_source = "design"; accent_custom = "#0067C0"; light_theme = "light"; dark_theme = "dark" }
  appearance = @{ ui_scale = 100; density = "comfortable"; corner_radius = "standard"; animations = "full" }
  explorer = @{ show_hidden = $false; show_extensions = $true; item_checkboxes = $false; details_pane = $true; group_by = "none"; view_mode = "details"; remember_view_per_folder = $true; view_mode_order = @("extraLargeIcons", "largeIcons", "mediumIcons", "smallIcons", "list", "details", "tiles", "content", "columns"); hidden_view_modes = @(); column_width = 240; column_preview = $true; folder_backgrounds = $false; column_sets_enabled = $false }
  layout = @{ toolbar_position = "top"; toolbar_mode = "full"; tab_bar_position = "top"; tab_bar_collapsed = $false; nav_pane_position = "left"; details_pane_position = "right"; saved_presets = @() }
  versions = @{ enabled = $true; keep_days = 30; max_mb = 1024 }
  templates = @{ my_folder = "" }
  background = @{ enabled = $true; only_idle = $false; only_ac = $false; paused = $false; tasks = @{ thumbnails = $true; metadata = $true; ocr = $true; version_cleanup = $true; filename_index = $false; content_index = $false; folder_sizes = $false; storage_scan = $false; pack_download = $false; media_proxy = $false }; pause_fullscreen = $true; quiet_hours = @{ enabled = $false; start_minute = 1320; end_minute = 420 }; cpu_percent = 25 }
  cache = @{ max_mb = 512 }
  gallery = @{ sources = @(); date_source = "taken" }
  ocr = @{ language = "auto"; enabled = true }
  reading = @{ font_px = 18; theme = "app" }
  conversion = @{ default_destination = "source"; default_quality = 90; preserve_metadata = $true; concurrent_jobs = 2; last_preset = $null; prompt_for_losses = $true }
  privacy = @{ mode = "keep"; image_mode = "keep"; pdf_mode = "keep"; image_categories = @(); pdf_categories = @(); location_warning = $false; sharing_prompt = $false }
  updates = @{ enabled = $false; last_seen_version = ""; last_check_unix = 0 }
  startup = @{ mode = "home"; folder = ""; stay_in_background = $false; start_with_windows = $false }
  tabs = @{ drag_hover_ms = 600 }
  palette = @{ recent_ids = @(); show_disabled = $true }
  transfers = @{ verify_copies = $false; queue_per_volume = $true; max_parallel = 2 }
  shelf = @{ visible = $false; side = "bottom"; size = 180 }
  recovery = @{ enabled = $true; interval_seconds = 10; max_mib = 1024; diagnostics_include_dumps = $false }
  clipboard_history = @{ enabled = $true; capture_windows = $false; persist = $false; max_items = 100; max_mib = 64 }
  locked = @{ auto_lock_minutes = 5; lock_on_workstation = $true }
  theme_custom = @{ day = @{ kind = "builtin"; id = "light" }; night = @{ kind = "builtin"; id = "dark" }; mode = "windows"; manual_scheme = "light"; day_start_minute = 420; night_start_minute = 1140; follow_wallpaper = $false; type_accents = @{} }
  toolbar_custom = @{ classic_menu = $false; bars = @(); quick_access = @("explorer.undo", "explorer.redo", "explorer.copyPath") }
  keyboard_custom = @{ active_map = "builtin:windows"; custom_maps = @(); allow_bare_navigation = $false }
  tab_options = @{
    width_mode = "fixed"; fixed_width_px = 180; close_button = "always"
    new_position = "end"; close_activation = "mru"; hover_preview = $false
    hover_delay_ms = 500; type_icons = $true; type_underline = $true
    title_limit = 40; overflow = "scroll"; double_click_new = $true
  }
  format_options = @{
    locale = "system"; date_style = "short"; custom_date = "YYYY-MM-DD HH:mm"
    time_cycle = "system"; week_start = "system"; size_base = "binary"
    decimals = 1; name_truncation = "end"; extension_overrides = @{}
  }
  behavior = @{
    open_click = "double"; confirm_changes = $false
    confirmations = @{ recycle = $false; move = $false; rename = $false
      convert = $false; clean = $false; save = $false }
  }
  shell_custom = @{}
  accessibility = @{
    large_targets = $false; focus_px = 2; cursor = "normal"; color_mode = "none"
    dyslexic_font = $false; letter_spacing_em = 0; word_spacing_em = 0; line_height = 1.4
    simple_mode = $false; persistent_toasts = $false; reduced_motion = "system"; no_autoplay = $false
    hover_ms = 600; drag_threshold_px = 4; completion_sound = $false; sound_volume = 0.2
    subtitle = @{ font_percent = 100; text_color = "#FFFFFF"; background_color = "#000000"; background_opacity = 0.75; position = "bottom" }
    read_rate = 1; read_volume = 1; auto_captions = $false
  }
  search = @{ roots = @(); default_mode = "name"; index_limit_mb = 2048; content_max_chars = 100000; usn_enabled = $false; excluded_paths = @() }
  views = @{ enabled_views = @{ timeline = $true; calendar = $true; by_kind = $true; recent_activity = $true; map = $false }; date_source = "modified"; activity_enabled = $true; map_online_enabled = $false; write_embedded_tags = $false }
  folder_sizes = @{ enabled = $false; network = $false; details = $false }
  pack_catalog = @{ last_checked_unix = $null }
  office_view = @{ prefer_accurate = $true; show_comments = $false; keep_engine_warm = $true; idle_seconds = 60 }
  pdf_tools = @{ author = "" }
  image_editor = @{ default_mode = "edit"; background_rgba = @(255,255,255,255); history_limit_mb = 256; advanced = $false; selection_tolerance = 15; show_history = $false }
  local_ai = @{ enabled = $false; device = "auto"; tier = "auto"; idle_unload_seconds = 120; memory_limit_mb = 4096;
    tasks = @{ structured_text = $false; vision_answer = $false; embed_text = $false; embed_image = $false; transcribe = $false; upscale = $false; foreground_mask = $false; inpaint = $false } }
  media_editor = @{ preview_quality = "960"; waveform = $true; keep_pitch = $true }
  assistant = @{ enabled = $false; backend = "local"; provider_id = "meta"; custom_endpoint_id = $null; api_model_id = "muse-spark-1.3"; local_source = "bundled"; local_server_port = 11434; local_server_address = "127.0.0.1"; name = ""; answer_length = "normal"; tone = "neutral"; language = "app"; show_steps = $false; allow_read_contents = $false; automatic_tools = @{ open_tab = $true; switch_tab = $true; search_files = $true; read_file = $false; group_tabs = $true }; denied_folders = @(); keep_history = $false }
  ai_actions = @{ enabled = @{ remove_background = $false; blur_background = $false; erase_object = $false; describe_image = $false; ask_image = $false; upscale = $false; summarize = $false; create_faq = $false; translate = $false; key_points = $false; ask_file = $false; transcribe = $false; summarize_media = $false; find_moments = $false; compare_documents = $false; summarize_folder = $false }; transcription_language = "auto"; caption_language = "auto"; caption_window_seconds = 30; dictation_language = "en" }
  ai_search = @{ semantic_text = $false; photo_index = $false; natural_query = $false; rename = $false; sort = $false; roots = @(); destinations = @(); disabled_sort_extensions = @() }
  ai = @{ writing = @{ inline_enabled = $false; enabled_types = @{ text = $false; markdown = $false; code = $false } }; documents = @{ enabled = $false; experimental_actions = @() }; sheets = @{ enabled = $false; experimental_actions = @() }; decks = @{ enabled = $false; experimental_actions = @() } }
  timeline = @{ preview_quality = "960"; snap_enabled = $true; proxy_enabled = $false }
  office_edit = @{ enabled = $false; autosave_default = $false; idle_minutes = 5 }
  document_editor = @{ autosave_default = $false; show_ruler = $true; show_navigation = $false; spelling = $true }
  sheet_editor = @{ show_formula_bar = $true; show_gridlines = $true; show_headings = $true; default_zoom = 100 }
  deck_editor = @{ show_notes = $true; snap_to_grid = $false; default_aspect = "wide"; presenter_view = $true }
}
[IO.File]::WriteAllText((Join-Path $dataDir "settings.json"), ($settings | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))

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
