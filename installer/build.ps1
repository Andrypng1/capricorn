param(
    [string] $AppDirectory = (Join-Path $PSScriptRoot '../release/win-unpacked'),
    [string] $Output = (Join-Path $PSScriptRoot '../release/Capricorn-Setup-Windows-x64.exe')
)

$ErrorActionPreference = 'Stop'
$framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$compiler = Join-Path $framework 'csc.exe'
$source = Join-Path $PSScriptRoot 'Setup.cs'
$icon = Join-Path $PSScriptRoot '../desktop/icon.ico'
$payload = Join-Path (Split-Path -Parent $Output) 'capricorn-installer-payload.zip'
$app = (Resolve-Path -LiteralPath $AppDirectory).Path
if (!(Test-Path -LiteralPath (Join-Path $app 'Capricorn.exe'))) { throw 'Primero empaqueta Capricorn para Windows x64.' }
if (Test-Path -LiteralPath $payload) { throw "Ya existe un archivo temporal: $payload" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
    [IO.Compression.ZipFile]::CreateFromDirectory($app, $payload, [IO.Compression.CompressionLevel]::Optimal, $false)
    & $compiler /nologo /target:winexe /platform:x64 /optimize+ "/out:$Output" "/win32icon:$icon" "/resource:$payload,Capricorn.Package" /r:System.Windows.Forms.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:Microsoft.CSharp.dll $source
    if ($LASTEXITCODE -ne 0) { throw "No se pudo generar el instalador. Código $LASTEXITCODE" }
} finally {
    if (Test-Path -LiteralPath $payload) { Remove-Item -LiteralPath $payload }
}
