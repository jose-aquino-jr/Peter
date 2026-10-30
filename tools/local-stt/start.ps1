$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "Execute tools/local-stt/setup.ps1 primeiro." }
Push-Location $root
try { & $python (Join-Path $PSScriptRoot "server.py") }
finally { Pop-Location }
