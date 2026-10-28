# End-to-end folder-open measurement (Step 02, owner addition 2):
# from pressing Enter in the address bar to the first rows of the target
# folder appearing in the UI (found in the accessibility tree, which the
# virtualized list populates only for painted rows). The Rust-only
# listing number comes from fs-bench; this is the number the user feels.
#
# Run after scripts\package-app.ps1 and scripts\generate-corpus.ps1:
#   .\scripts\measure-folder-open.ps1 [-Folder <path>] [-FirstItem folder-000]
param(
  [string]$Exe = (Join-Path (Split-Path -Parent $PSScriptRoot) "build\Adperastra\Adperastra.exe"),
  [string]$Folder = (Join-Path $env:TEMP "adperastra-corpus\folder-100k"),
  [string]$FirstItem = "folder-000",
  [int]$TimeoutSeconds = 15
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BenchWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
"@

$dataDir = Join-Path $env:TEMP ("adperastra-bench-" + [guid]::NewGuid().ToString("N"))
$oldData = $env:ADPERASTRA_DATA_DIR
$env:ADPERASTRA_DATA_DIR = $dataDir
$proc = Start-Process -FilePath $Exe -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  while ($proc.MainWindowHandle -eq 0 -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $proc.Refresh()
  }
  if ($proc.MainWindowHandle -eq 0) { throw "app window did not appear" }
  [BenchWin]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Start-Sleep -Seconds 4

  $root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
  # Open the first drive from the nav pane so the address bar is editable.
  $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
  $driveButton = $null
  foreach ($el in $all) {
    if ($el.Current.Name -match '^[A-Z]:\\$') { $driveButton = $el; break }
  }
  if (-not $driveButton) { throw "drive button not found in nav pane" }
  ($driveButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()
  Start-Sleep -Seconds 2

  # Type the target path in the address bar and press Enter. Keyboard
  # focus in a fresh window can race, so retry Ctrl+L until the address
  # input actually exists.
  # Give the webview document keyboard focus via a breadcrumb button,
  # otherwise Ctrl+L can land on the window frame instead of the page.
  $segments = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
  foreach ($candidate in $segments) {
    if ($candidate.Current.Name -match '^[A-Z]:') { try { $candidate.SetFocus() } catch { }; break }
  }
  Start-Sleep -Milliseconds 300
  $edit = $null
  for ($attempt = 0; $attempt -lt 6 -and -not $edit; $attempt++) {
    try { $root.SetFocus() } catch { }
    [System.Windows.Forms.SendKeys]::SendWait("^l")
    Start-Sleep -Milliseconds 400
    $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
    foreach ($candidate in $edits) {
      if ($candidate.Current.Name -eq "Address") { $edit = $candidate; break }
    }
  }
  if (-not $edit) { throw "address input did not appear after Ctrl+L" }
  [System.Windows.Forms.SendKeys]::SendWait($Folder)
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")

  $found = $false
  $limit = [TimeSpan]::FromSeconds($TimeoutSeconds)
  while ($watch.Elapsed -lt $limit) {
    $buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)))
    foreach ($el in $buttons) {
      if ($el.Current.Name -like "*$FirstItem*") { $found = $true; break }
    }
    if ($found) { break }
    Start-Sleep -Milliseconds 25
  }
  $watch.Stop()
  if (-not $found) { throw "first rows did not appear within $TimeoutSeconds s" }
  $result = [ordered]@{
    folder = $Folder
    first_item = $FirstItem
    elapsed_ms = [math]::Round($watch.Elapsed.TotalMilliseconds, 1)
    tier = "Fast (<= 1000 ms from Enter to first rows visible, UIA poll granularity 25 ms)"
    app = $Exe
    date = (Get-Date).ToString("s")
  }
  $result | ConvertTo-Json
} finally {
  if ($proc -and -not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
  $env:ADPERASTRA_DATA_DIR = $oldData
  Remove-Item $dataDir -Recurse -Force -ErrorAction SilentlyContinue
}