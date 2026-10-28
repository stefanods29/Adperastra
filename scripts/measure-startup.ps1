# Measures Adperastra cold start on this PC and writes a JSON result to
# docs\benchmarks\. Run it right after a reboot for the true cold numbers:
#   .\scripts\measure-startup.ps1
#   .\scripts\measure-startup.ps1 -Exe <path to Adperastra.exe> -Step 03a -Runs 5
# It stops only Adperastra's own WebView2 child processes (cold WebView2),
# then times: window handle, first paint (PrintWindow pixel), session save
# (content ready). Your other apps are not touched. -Step names the output
# file, so measuring a new step never overwrites an earlier baseline.
param([string]$Exe = "", [string]$Step = "01b", [int]$Runs = 2)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = if ($Exe) { $Exe } else { Join-Path $root "build\Adperastra\Adperastra.exe" }
if (-not (Test-Path $exe)) { throw "Build first: .\scripts\package-app.ps1" }
Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public class PM {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
  public static int[] Pixel(IntPtr h, int x, int y) {
    RECT r; GetWindowRect(h, out r);
    using (var bmp = new Bitmap(r.Right - r.Left, r.Bottom - r.Top))
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc);
      System.Drawing.Color c = bmp.GetPixel(x, y);
      return new int[]{ c.R, c.G, c.B };
    }
  }
}
"@ -ReferencedAssemblies System.Drawing

$data = Join-Path $env:TEMP "adp-cold-measure"
$runs = @()
foreach ($run in 1..$Runs) {
  Get-Process Adperastra -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
    Where-Object { $_.CommandLine -match 'webview-exe-name=Adperastra' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Remove-Item "$data\session.json" -ErrorAction SilentlyContinue
  $env:ADPERASTRA_DATA_DIR = $data
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process $exe -PassThru
  $handle = $null; $paint = $null; $session = $null
  while ($sw.ElapsedMilliseconds -lt 9000 -and ($null -eq $session)) {
    $p.Refresh()
    if ($null -eq $handle -and $p.MainWindowHandle -ne 0) { $handle = $sw.ElapsedMilliseconds }
    if ($null -eq $paint -and $p.MainWindowHandle -ne 0) {
      try { $px = [PM]::Pixel($p.MainWindowHandle, 120, 20); if ($px[0] -gt 200 -and $px[1] -gt 200) { $paint = $sw.ElapsedMilliseconds } } catch {}
    }
    if (Test-Path "$data\session.json") { $session = $sw.ElapsedMilliseconds }
    Start-Sleep -Milliseconds 40
  }
  $sw.Stop()
  $runs += @{ run = $run; window_handle_ms = $handle; first_paint_ms = $paint; content_ready_ms = $session }
  Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}
Remove-Item Env:\ADPERASTRA_DATA_DIR -ErrorAction SilentlyContinue
$result = @{
  date = (Get-Date).ToString("yyyy-MM-dd")
  machine = "docs/benchmarks/MACHINE.md"
  step = $Step
  method = "WebView2 children of Adperastra stopped before each run; first paint = PrintWindow pixel; content ready = session.json written"
  note = "Run right after a reboot for true cold-cache numbers. First-ever run (creates the WebView2 profile) is a one-time cost and is measured separately."
  runs = $runs
}
$out = Join-Path $root ("docs\benchmarks\{0}-startup-step{1}.json" -f (Get-Date -Format "yyyy-MM-dd"), $Step)
$result | ConvertTo-Json -Depth 4 | Set-Content $out -Encoding utf8
Write-Output "Wrote $out"
$runs | ForEach-Object { Write-Output "run $($_.run): handle=$($_.window_handle_ms)ms paint=$($_.first_paint_ms)ms content=$($_.content_ready_ms)ms" }
