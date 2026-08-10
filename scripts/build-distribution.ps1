param(
  [switch]$PackCrx,
  [string]$SigningKey = 'C:\Users\mm704\AppData\Local\TTAExpenseChecker\signing\extension-key.pem'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $repoRoot 'dist'
$extensionRoot = Join-Path $distRoot 'extension'
$zipPath = Join-Path $distRoot 'tta-expense-checker-extension-0.5.0.zip'

$resolvedRepo = (Resolve-Path -LiteralPath $repoRoot).Path
if (Test-Path -LiteralPath $distRoot) {
  $resolvedDist = [System.IO.Path]::GetFullPath($distRoot)
  if (-not $resolvedDist.StartsWith($resolvedRepo + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Distribution path escaped the repository.'
  }
  Remove-Item -LiteralPath $distRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $extensionRoot -Force | Out-Null

$extensionFiles = @(
  'manifest.json', 'background.js', 'config.js', 'extractor.js', 'pick.js',
  'llm.js', 'prompts.js', 'md.js', 'overlay.js', 'widget.js',
  'popup.html', 'popup.js', 'options.html', 'options.js',
  'attachment-extractor.js', 'attachment-reader.js',
  'expense-checker.js', 'expense-content-checker.js',
  'expense-context.js', 'expense-context-extractor.js',
  'expense-rules.json', 'expense-rules.schema.json'
)
foreach ($file in $extensionFiles) {
  $source = Join-Path $repoRoot $file
  if (-not (Test-Path -LiteralPath $source)) { throw "Missing extension file: $file" }
  Copy-Item -LiteralPath $source -Destination (Join-Path $extensionRoot $file)
}
Compress-Archive -Path (Join-Path $extensionRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal

if ($PackCrx) {
  if (-not (Test-Path -LiteralPath $SigningKey)) { throw 'Signing key not found.' }
  $chromePath = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
  if (-not (Test-Path -LiteralPath $chromePath)) { throw 'Chrome not found.' }
  & $chromePath "--pack-extension=$extensionRoot" "--pack-extension-key=$SigningKey"
  Start-Sleep -Seconds 2
  $crx = "$extensionRoot.crx"
  if (-not (Test-Path -LiteralPath $crx)) { throw 'Chrome did not create the CRX package.' }
  Move-Item -LiteralPath $crx -Destination (Join-Path $distRoot 'tta-expense-checker-0.5.0.crx')
}

Write-Host "Extension ZIP: $zipPath" -ForegroundColor Green
Write-Host 'Signing key was read from a local non-OneDrive path and was not copied into dist.'

