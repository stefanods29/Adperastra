# Step 11a benchmark fixtures. Creates only a new run folder under %TEMP%;
# it never deletes or overwrites a user file. The coordinator runs it and
# records the actual measurements separately.

[CmdletBinding()]
param(
  [string]$Root = (Join-Path $env:TEMP "adperastra-search-fixtures"),
  [int]$Files = 100000,
  [int]$Folders = 100,
  [int]$SyntheticRows = 1000000
)

$ErrorActionPreference = "Stop"
if ($Files -lt 1 -or $Folders -lt 1 -or $SyntheticRows -lt 1) {
  throw "Files, Folders and SyntheticRows must be positive."
}

$run = Join-Path $Root ("run-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $run -Force | Out-Null

$tree = Join-Path $run "100k"
for ($folder = 0; $folder -lt $Folders; $folder++) {
  $dir = Join-Path $tree ("folder-{0:D3}" -f $folder)
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$perFolder = [math]::Ceiling($Files / $Folders)
$created = 0
for ($folder = 0; $folder -lt $Folders -and $created -lt $Files; $folder++) {
  $dir = Join-Path $tree ("folder-{0:D3}" -f $folder)
  for ($index = 0; $index -lt $perFolder -and $created -lt $Files; $index++) {
    $name = if ($index % 97 -eq 0) {
      "report-port-{0:D6}.txt" -f $created
    } elseif ($index % 89 -eq 0) {
      "alpha cafe-{0:D6}.txt" -f $created
    } else {
      "file-{0:D6}.txt" -f $created
    }
    $path = Join-Path $dir $name
    if (-not (Test-Path -LiteralPath $path)) {
      New-Item -ItemType File -Path $path -Force | Out-Null
    }
    $created++
  }
}

$alpha = Join-Path $run "alpha-cafe.txt"
if (-not (Test-Path -LiteralPath $alpha)) {
  Set-Content -LiteralPath $alpha -Value "alpha café" -Encoding UTF8
}
$ocr = Join-Path $run "cached-ocr-beta.txt"
if (-not (Test-Path -LiteralPath $ocr)) {
  Set-Content -LiteralPath $ocr -Value "beta" -Encoding UTF8
}

$cases = Join-Path $run "cases"
New-Item -ItemType Directory -Path $cases -Force | Out-Null
Set-Content -LiteralPath (Join-Path $cases "offline-readme.txt") -Value "Replace with a real online-only placeholder on a OneDrive folder when available." -Encoding UTF8
Set-Content -LiteralPath (Join-Path $cases "permission-readme.txt") -Value "Create a folder with a denied ACL only on a throwaway temp path; never on user data." -Encoding UTF8
Set-Content -LiteralPath (Join-Path $cases "loop-readme.txt") -Value "Use the junction below only for the loop test; do not traverse it manually." -Encoding UTF8

$loopLink = Join-Path $cases "loop"
if (-not (Test-Path -LiteralPath $loopLink)) {
  try {
    # The junction points at its own ancestor: the scanner must skip the
    # reparse folder instead of following it forever.
    New-Item -ItemType Junction -Path $loopLink -Target $cases | Out-Null
  } catch {
    Set-Content -LiteralPath (Join-Path $cases "loop-unavailable.txt") -Value $_.Exception.Message -Encoding UTF8
  }
}

$mock = Join-Path $run "mock-usn.json"
@"
{
  "valid": "report.txt",
  "bad_length": 12,
  "bad_offset": 200,
  "bad_version": 3
}
"@ | Set-Content -LiteralPath $mock -Encoding UTF8

$csv = Join-Path $run "synthetic-1m.csv"
$writer = [System.IO.StreamWriter]::new($csv, $false, [System.Text.UTF8Encoding]::new($false))
try {
  $writer.WriteLine("path_key,path,name,normalized_name,size,modified_unix")
  for ($index = 0; $index -lt $SyntheticRows; $index++) {
    $name = "synthetic-{0:D7}.txt" -f $index
    $path = "C:\synthetic\$name"
    $writer.WriteLine(("c:\synthetic\{0},{1},{2},{3},10,1700000000" -f $name, $path, $name, $name))
  }
} finally {
  $writer.Dispose()
}

[pscustomobject]@{
  run = $run
  tree = $tree
  files_created = $created
  synthetic_rows = $SyntheticRows
  alpha = $alpha
  cached_ocr = $ocr
  cases = $cases
  mock_usn = $mock
  synthetic_csv = $csv
} | ConvertTo-Json -Depth 3
