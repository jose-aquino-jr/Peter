$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$stt = Join-Path $root "tools\local-stt"
$python = Join-Path $stt ".venv\Scripts\python.exe"
$env:TEMP = Join-Path $root ".codex-vitest-tmp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null

if (-not (Test-Path $python)) {
    python -m venv (Join-Path $stt ".venv")
}
& $python -m pip install --no-cache-dir -r (Join-Path $stt "requirements.txt")

$modelDir = Join-Path $stt "model"
$modelFile = Join-Path $stt "vosk-model-small-pt-0.3.zip"
if (-not (Test-Path (Join-Path $modelDir "am\final.mdl")) -and -not (Test-Path (Join-Path $modelDir "final.mdl"))) {
    Invoke-WebRequest "https://alphacephei.com/vosk/models/vosk-model-small-pt-0.3.zip" -OutFile $modelFile
    Expand-Archive -LiteralPath $modelFile -DestinationPath $stt -Force
    Move-Item -LiteralPath (Join-Path $stt "vosk-model-small-pt-0.3") -Destination $modelDir -Force
    Remove-Item -LiteralPath $modelFile -Force
}
Write-Host "Transcrição offline pronta. Inicie-a com: tools\local-stt\start.ps1"
