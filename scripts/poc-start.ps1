param(
  [string]$ExtensionId = 'lmkejmofkdcjnfcnmjgekbfippdklaco'
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Step([string]$Message) {
  Write-Host "`n== $Message ==" -ForegroundColor Cyan
}

function Read-ExtensionId {
  Write-Host 'Chrome: chrome://extensions' -ForegroundColor Yellow
  Write-Host 'Edge:   edge://extensions' -ForegroundColor Yellow
  Write-Host 'Enable Developer mode and copy the 32-character extension ID.'
  return (Read-Host 'Extension ID').Trim()
}

function Get-AllowedOrigin([string]$Origin) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:11435/health' -Headers @{ Origin = $Origin } -TimeoutSec 2
    return [string]$response.Headers['Access-Control-Allow-Origin']
  } catch {
    return ''
  }
}

function Get-CorsOrigin([string]$Url, [string]$Origin) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers @{ Origin = $Origin } -TimeoutSec 2
    return [string]$response.Headers['Access-Control-Allow-Origin']
  } catch {
    return ''
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$parserPath = Join-Path $repoRoot 'parser-service.mjs'
$kordocPath = Join-Path $repoRoot 'node_modules\kordoc'

Step '1/5 Checking prerequisites'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 20 or later is required.'
}
$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 20) {
  throw "Node.js 20 or later is required. Current version: $nodeVersion"
}
if (-not (Test-Path -LiteralPath $parserPath)) {
  throw "Parser service not found: $parserPath"
}
if (-not (Test-Path -LiteralPath $kordocPath)) {
  throw "Parser dependencies are missing. Run 'npm.cmd install --omit=optional --ignore-scripts' in: $repoRoot"
}
Write-Host "Node.js $nodeVersion - parser dependencies found" -ForegroundColor Green

Step '2/5 Checking the Chrome/Edge extension ID'
if ($ExtensionId -notmatch '^[a-p]{32}$') {
  throw 'Invalid extension ID. It must contain 32 characters in the a-p range.'
}
$origin = "chrome-extension://$ExtensionId"
Write-Host "Extension: $ExtensionId" -ForegroundColor Green

Step '3/5 Checking the local parser'
$allowedOrigin = Get-AllowedOrigin $origin
$parserAlreadyReady = $allowedOrigin -eq $origin
if ($parserAlreadyReady) {
  Write-Host 'The parser is already running for this extension ID.' -ForegroundColor Green
}

if (-not $parserAlreadyReady) {
  $listener = Get-NetTCPConnection -LocalPort 11435 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Write-Host "Another parser is listening on port 11435 (PID $($listener.OwningProcess))." -ForegroundColor Yellow
    Write-Host 'It was probably started for a different extension ID.'
    $restart = (Read-Host 'Stop it and restart for the current extension ID? (Y/N)').Trim()
    if ($restart -notmatch '^(y|yes)$') {
      throw 'The existing parser was kept. Run this launcher again and choose Y to reconnect it.'
    }
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Milliseconds 400
  }
}

Step '4/5 Checking Ollama'
$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
$ollamaPath = if ($ollamaCommand) { $ollamaCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' }
if (-not (Test-Path -LiteralPath $ollamaPath)) {
  Write-Host 'Ollama is not installed. L1/L2 checks will still work without AI.' -ForegroundColor Yellow
} else {
  $ollamaOrigin = Get-CorsOrigin 'http://127.0.0.1:11434/v1/models' $origin
  if ($ollamaOrigin -ne $origin) {
    $ollamaListener = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ollamaListener) {
      Write-Host "Ollama is running without access for this extension (PID $($ollamaListener.OwningProcess))." -ForegroundColor Yellow
      $restartOllama = (Read-Host 'Restart Ollama with this extension ID only? (Y/N)').Trim()
      if ($restartOllama -match '^(y|yes)$') {
        Stop-Process -Id $ollamaListener.OwningProcess -Force
        Start-Sleep -Milliseconds 500
      } else {
        Write-Host 'Ollama was kept. AI review will be unavailable; L1/L2 checks will still work.' -ForegroundColor Yellow
        $ollamaPath = ''
      }
    }
    if ($ollamaPath) {
      $env:OLLAMA_ORIGINS = $origin
      Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WindowStyle Hidden
      for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        Start-Sleep -Milliseconds 500
        $ollamaOrigin = Get-CorsOrigin 'http://127.0.0.1:11434/v1/models' $origin
        if ($ollamaOrigin -eq $origin) { break }
      }
    }
  }
  if ($ollamaOrigin -eq $origin) {
    Write-Host 'Ollama is ready for this extension.' -ForegroundColor Green
  } elseif ($ollamaPath) {
    Write-Host 'Ollama did not become ready. L1/L2 checks will still work without AI.' -ForegroundColor Yellow
  }
}

Step '5/5 Starting the expense attachment parser'
if ($parserAlreadyReady) {
  Write-Host 'The parser and Ollama checks are complete. You can run the checker from the expense page.' -ForegroundColor Green
  Read-Host 'Press Enter to close' | Out-Null
  exit 0
}
$env:EDOC_EXTENSION_ID = $ExtensionId
$env:EDOC_PARSER_PORT = '11435'
Write-Host 'Ready. Keep this window open while testing the browser extension.' -ForegroundColor Green
Write-Host 'Address: http://127.0.0.1:11435 - Stop: Ctrl+C'
Write-Host 'L1/L2 rule checks work even when a local AI model is not connected.'

& node $parserPath
exit $LASTEXITCODE
