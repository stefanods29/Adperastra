# Builds a clean portable archive from a compiled release and the pinned
# signed Office pack. Never copies an application profile or reads a key.
param(
    [Parameter(Mandatory=$true)][string]$AppBinary,
    [Parameter(Mandatory=$true)][string]$OfficePackRoot,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$version = '0.1.0-preview.1'
$docs = Join-Path $repo "docs/releases/$version"
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw 'Choose a new output directory.' }
$pack = (Resolve-Path -LiteralPath $OfficePackRoot).Path
$app = (Resolve-Path -LiteralPath $AppBinary).Path
$catalogPath = Join-Path $docs 'pack-catalog.json'
$catalog = Get-Content -LiteralPath $catalogPath -Raw | ConvertFrom-Json
$descriptor = @($catalog.packs | Where-Object { $_.id -eq 'office' })
if ($descriptor.Count -ne 1 -or $descriptor[0].version -ne '0.1.3') { throw 'Unexpected Office descriptor.' }
$descriptor = $descriptor[0]
New-Item -ItemType Directory -Path $output | Out-Null
$stage = Join-Path $output 'portable'
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath $app -Destination (Join-Path $stage 'Adperastra.exe')
foreach ($name in @('help','templates','LICENSE','README.md','THIRD_PARTY_LICENSES.md')) {
    Copy-Item -LiteralPath (Join-Path $repo $name) -Destination $stage -Recurse
}
$noticeRoot = Join-Path $stage 'Office-notices'
New-Item -ItemType Directory -Path $noticeRoot | Out-Null
foreach ($name in @('FONT-LICENSES.txt','Apache-2.0.txt','OFL-1.1.txt','SOURCE-NOTICES.txt')) {
    Copy-Item -LiteralPath (Join-Path $docs $name) -Destination $noticeRoot
}
$packRoot = Join-Path $stage 'AdperastraData/packs'
$versionRoot = Join-Path $packRoot 'versions/office/0.1.3'
New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null
foreach ($entry in $descriptor.files) {
    $relative = [string]$entry.path
    if ($relative -match '(^/|\\|:|(^|/)\.\.?(/|$))') { throw 'Unsafe inventory path.' }
    $source = [IO.Path]::GetFullPath((Join-Path $pack $relative))
    if (-not $source.StartsWith($pack + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Inventory path escaped the pack.' }
    $item = Get-Item -LiteralPath $source
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Inventory file is a link.' }
    $target = Join-Path $versionRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
    if ((Get-Item -LiteralPath $target).Length -ne $entry.size -or
        (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
        throw "Office inventory mismatch: $relative"
    }
}
$catalogDir = Join-Path $packRoot 'catalog'
$activeDir = Join-Path $packRoot 'active'
New-Item -ItemType Directory -Path $catalogDir,$activeDir -Force | Out-Null
Copy-Item -LiteralPath $catalogPath -Destination $catalogDir
Copy-Item -LiteralPath (Join-Path $docs 'pack-catalog.sig') -Destination (Join-Path $catalogDir 'pack-catalog.minisig')
# The pointer contains only signed descriptor identity, never a local profile path.
$active = @{
    schema_version=1; pack_id='office'; version='0.1.3'; directory='versions/office/0.1.3'
    descriptor_sha256='073279589316622a89064e8254fd33f62c2f47d64e22d5377fb634d09fcb6c5d'
    previous_version=$null; activated_unix=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
}
[IO.File]::WriteAllText((Join-Path $activeDir 'office.json'),($active | ConvertTo-Json -Compress))
[IO.File]::WriteAllText((Join-Path $stage 'portable-mode.marker'),'{"enabled":true,"version":1}')
$commit = (git -C $repo rev-parse HEAD).Trim()
@{version=$version; source_commit=$commit; app_sha256=(Get-FileHash -LiteralPath $app -Algorithm SHA256).Hash.ToLowerInvariant(); office_version='0.1.3'; office_files=$descriptor.files.Count} |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'BUILD-INFO.json') -Encoding utf8
# Before first launch, data may contain only the three fixed pack locations.
$expected = @('active','catalog','versions')
foreach ($item in Get-ChildItem -LiteralPath $packRoot) {
    if ($item.Name -notin $expected) { throw 'Unexpected data in release staging.' }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = Join-Path $output "Adperastra-$version-windows-x64-portable.zip"
[IO.Compression.ZipFile]::CreateFromDirectory($stage,$archive,[IO.Compression.CompressionLevel]::Optimal,$false)
$digest = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS.txt'),"$digest  $([IO.Path]::GetFileName($archive))`n")
Write-Output $archive
