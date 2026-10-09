$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$sourceDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $sourceDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$distDir = Join-Path $sourceDir 'dist'
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
$outputPath = Join-Path $distDir "tmux-easy-$($package.version).vsix"
$manifest = @'
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="tmux-easy" Version="VERSION" Publisher="local-tools" />
    <DisplayName>Tmux Easy</DisplayName>
    <Description xml:space="preserve">Lightweight tmux manager with working directory selection.</Description>
    <Tags>tmux,ssh,terminal</Tags>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.93.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="zh-cn" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" /></Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true" />
  </Assets>
</PackageManifest>
'@
$manifest = $manifest.Replace('VERSION', $package.version)
$types = @'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
  <Override PartName="/extension/LICENSE" ContentType="text/plain" />
</Types>
'@
$files = @('package.json', 'extension.js', 'core.js', 'media/tmux.svg', 'README.md', 'LICENSE')
$stream = [System.IO.File]::Open($outputPath, [System.IO.FileMode]::CreateNew)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $entries = @{ 'extension.vsixmanifest' = $manifest; '[Content_Types].xml' = $types }
    foreach ($name in $files) { $entries["extension/$name"] = [System.IO.File]::ReadAllText((Join-Path $sourceDir $name)) }
    foreach ($entryName in $entries.Keys) {
        $writer = [System.IO.StreamWriter]::new($zip.CreateEntry($entryName).Open(), [System.Text.UTF8Encoding]::new($false))
        try { $writer.Write($entries[$entryName]) } finally { $writer.Dispose() }
    }
} finally { $zip.Dispose(); $stream.Dispose() }
# Validate the actual archive, including the remote-host declaration and every file's bytes.
$stream = [System.IO.File]::OpenRead($outputPath)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read)
try {
    foreach ($name in $files) {
        $entry = $zip.GetEntry("extension/$name")
        if ($null -eq $entry) { throw "Missing package entry: $name" }
        $reader = [System.IO.StreamReader]::new($entry.Open())
        try { $actual = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if ($actual -cne [System.IO.File]::ReadAllText((Join-Path $sourceDir $name))) { throw "Package content mismatch: $name" }
    }
    [xml]$manifestXml = $manifest
    [xml]$contentTypesXml = $types
    if ($package.extensionKind[0] -ne 'workspace') { throw 'Must run on the workspace host' }
} finally { $zip.Dispose(); $stream.Dispose() }
Get-Item -LiteralPath $outputPath | Select-Object FullName,Length
