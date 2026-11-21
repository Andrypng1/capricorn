$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$source = Join-Path $PSScriptRoot 'Credentials.cs'
$destination = Join-Path $PSScriptRoot '../desktop/credentials.exe'
& $compiler /nologo /target:exe /platform:x64 /optimize+ "/out:$destination" $source
if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el acceso al Administrador de credenciales.' }
