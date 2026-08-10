param(
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId = 'lmkejmofkdcjnfcnmjgekbfippdklaco'
)

$repoRoot = Split-Path -Parent $PSScriptRoot
$parserPath = Join-Path $repoRoot 'parser-service.mjs'
$kordocPath = Join-Path $repoRoot 'node_modules\kordoc'

if (-not (Test-Path -LiteralPath $kordocPath)) {
  throw '문서 파서가 설치되지 않았습니다. 저장소 폴더에서 npm.cmd install --omit=optional --ignore-scripts 를 먼저 실행하세요.'
}

$env:EDOC_EXTENSION_ID = $ExtensionId
$env:EDOC_PARSER_PORT = '11435'

Write-Host '지출 첨부 파서를 시작합니다: http://127.0.0.1:11435'
Write-Host "허용 확장 ID: $ExtensionId"
Write-Host '종료하려면 Ctrl+C를 누르세요.'

& node $parserPath
exit $LASTEXITCODE
