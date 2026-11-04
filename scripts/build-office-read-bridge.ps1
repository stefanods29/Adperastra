# Builds the replaceable Office bridge from the pinned 26.8.2 SDK.
# Only writes to a new output directory. Does not activate an engine pack.
param(
  [Parameter(Mandatory=$true)][string]$SdkRoot,
  [Parameter(Mandatory=$true)][string]$OfficeProgram,
  [Parameter(Mandatory=$true)][string]$VsInstallPath,
  [string]$OutputDir = (Join-Path $env:TEMP ('adperastra-office-bridge-' + [guid]::NewGuid().ToString('N')))
)
$ErrorActionPreference = 'Stop'
$taskRepo = Split-Path -Parent $PSScriptRoot
$taskOutput = [IO.Path]::GetFullPath($OutputDir)
if (Test-Path -LiteralPath $taskOutput) { throw 'Use a new output directory; existing files are preserved.' }
foreach ($taskRequired in @(
  (Join-Path $SdkRoot 'bin\cppumaker.exe'),
  (Join-Path $OfficeProgram 'types.rdb'),
  (Join-Path $OfficeProgram 'types\offapi.rdb'),
  (Join-Path $VsInstallPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
)) {
  if (!(Test-Path -LiteralPath $taskRequired -PathType Leaf)) { throw ('Required build tool missing: ' + $taskRequired) }
}
New-Item -ItemType Directory -Path $taskOutput | Out-Null
$taskOldPath = $env:PATH
try {
  $env:PATH = $OfficeProgram + ';' + $env:PATH
  $taskHeaders = Join-Path $taskOutput 'generated'
  & (Join-Path $SdkRoot 'bin\cppumaker.exe') -Gc ('-O' + $taskHeaders) (Join-Path $OfficeProgram 'types.rdb') (Join-Path $OfficeProgram 'types\offapi.rdb')
  if ($LASTEXITCODE -ne 0) { throw 'UNO header generation failed.' }
  Import-Module (Join-Path $VsInstallPath 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
  Enter-VsDevShell -VsInstallPath $VsInstallPath -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null
  $taskSources = Get-ChildItem -LiteralPath (Join-Path $taskRepo 'tools\office-bridge\src') -Filter '*.cxx' | ForEach-Object FullName
  & cl.exe /nologo /std:c++17 /EHsc /MD /DWIN32 /DWNT /DCPPU_ENV=mscx ('/I' + (Join-Path $SdkRoot 'include')) ('/I' + $taskHeaders) ('/Fo' + $taskOutput + '\') ('/Fe' + (Join-Path $taskOutput 'office-read-bridge.exe')) $taskSources /link ('/LIBPATH:' + (Join-Path $SdkRoot 'lib')) isal.lib icppu.lib icppuhelper.lib
  if ($LASTEXITCODE -ne 0) { throw 'Office bridge compilation failed.' }
  Get-FileHash -LiteralPath (Join-Path $taskOutput 'office-read-bridge.exe') -Algorithm SHA256
} finally {
  $env:PATH = $taskOldPath
}
