# Regression check: only the isolated test process and its child are stopped.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'test-process-job.ps1')
$tempRoot = Join-Path $env:TEMP ('adperastra-process-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot | Out-Null
$parentScript = Join-Path $tempRoot 'parent.ps1'
$childScript = Join-Path $tempRoot 'child.ps1'
$marker = Join-Path $tempRoot 'child-id.txt'
Set-Content -LiteralPath $childScript -Value 'Start-Sleep -Seconds 60'
Set-Content -LiteralPath $parentScript -Value @'
param($childScript, $marker)
$shell = (Get-Process -Id $PID).Path
$child = Start-Process -FilePath $shell -ArgumentList @('-NoProfile', '-File', ('"' + $childScript + '"')) -PassThru -WindowStyle Hidden
[IO.File]::WriteAllText($marker, [string]$child.Id)
Start-Sleep -Seconds 60
'@
$shell = (Get-Process -Id $PID).Path
function Test-Alive([int]$processId) {
    return [bool](Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue)
}
$unrelated = $null
$job = $null
try {
    $unrelated = Start-Process -FilePath $shell -ArgumentList @('-NoProfile', '-File', ('"' + $childScript + '"')) -PassThru -WindowStyle Hidden
    $arguments = '-NoProfile -File "{0}" "{1}" "{2}"' -f $parentScript, $childScript, $marker
    $job = [AdperastraTestProcessJob]::Start($shell, $arguments, $true)
    $parentId = $job.Process.Id
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    while (-not (Test-Path -LiteralPath $marker) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 50 }
    if (-not (Test-Path -LiteralPath $marker)) { throw 'The test child did not start.' }
    $childId = [int](Get-Content -LiteralPath $marker -Raw)
    $job.Dispose(); $job = $null
    if (Test-Alive $parentId) { throw 'The test parent survived cleanup.' }
    if (Test-Alive $childId) { throw 'The test child survived cleanup.' }
    if (-not (Test-Alive $unrelated.Id)) { throw 'An unrelated process was stopped.' }
    Write-Output 'Test job cleanup passed.'
} finally {
    if ($job) { $job.Dispose() }
    if ($unrelated) { Stop-Process -Id $unrelated.Id -Force -ErrorAction SilentlyContinue }
    $tempPath = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    $resolved = [IO.Path]::GetFullPath($tempRoot)
    if (-not $resolved.StartsWith($tempPath, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'adperastra-process-test-*') { throw 'Refusing cleanup outside the generated test folder.' }
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
