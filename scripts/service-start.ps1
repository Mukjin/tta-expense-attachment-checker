param(
  [string]$ExtensionId = 'lmkejmofkdcjnfcnmjgekbfippdklaco',
  [string]$AppRoot = ''
)

$ErrorActionPreference = 'Stop'
if (-not $AppRoot) { $AppRoot = Split-Path -Parent $PSScriptRoot }
$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
$parserPath = Join-Path $AppRoot 'parser-service.mjs'
$logRoot = Join-Path $env:LOCALAPPDATA 'TTAExpenseChecker\logs'
$serviceLog = Join-Path $logRoot 'service.log'
$parserOut = Join-Path $logRoot 'parser.out.log'
$parserErr = Join-Path $logRoot 'parser.err.log'
$origin = "chrome-extension://$ExtensionId"

New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Log([string]$Message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Message"
  Add-Content -LiteralPath $serviceLog -Value $line -Encoding UTF8
}

function Cors-Origin([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -Headers @{ Origin = $origin } -TimeoutSec 2
    return [string]$response.Headers['Access-Control-Allow-Origin']
  } catch {
    return ''
  }
}

function Listener([int]$Port) {
  return Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
}

function Wait-Cors([string]$Url) {
  for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
    if ((Cors-Origin $Url) -eq $origin) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Invalid extension ID.' }
if (-not (Test-Path -LiteralPath $parserPath)) { throw "Parser not found: $parserPath" }

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) { throw 'Node.js 20 or later is required.' }
$nodePath = $nodeCommand.Source

Log "Startup requested for $origin from $AppRoot"

# Ollama is optional. If installed, keep one loopback server restricted to this extension origin.
$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
$ollamaPath = if ($ollamaCommand) { $ollamaCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe' }
if (Test-Path -LiteralPath $ollamaPath) {
  if ((Cors-Origin 'http://127.0.0.1:11434/v1/models') -ne $origin) {
    $existing = Listener 11434
    if ($existing) {
      $process = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
      if ($process.ProcessName -like 'ollama*') {
        Stop-Process -Id $existing.OwningProcess -Force
        Start-Sleep -Milliseconds 500
      } else {
        Log "Port 11434 is owned by non-Ollama process $($existing.OwningProcess); AI startup skipped."
        $ollamaPath = ''
      }
    }
    if ($ollamaPath) {
      $env:OLLAMA_ORIGINS = $origin
      Start-Process -FilePath $ollamaPath -ArgumentList 'serve' -WindowStyle Hidden
    }
  }
  if ($ollamaPath -and (Wait-Cors 'http://127.0.0.1:11434/v1/models')) {
    Log 'Ollama ready.'
  } elseif ($ollamaPath) {
    Log 'Ollama did not become ready; deterministic checks remain available.'
  }
} else {
  Log 'Ollama not installed; deterministic checks remain available.'
}

# Restart only a Node listener when it is not authorized for the fixed extension.
if ((Cors-Origin 'http://127.0.0.1:11435/health') -ne $origin) {
  $existing = Listener 11435
  if ($existing) {
    $process = Get-Process -Id $existing.OwningProcess -ErrorAction SilentlyContinue
    if ($process.ProcessName -notlike 'node*') {
      throw "Port 11435 is occupied by non-Node process $($existing.OwningProcess)."
    }
    Stop-Process -Id $existing.OwningProcess -Force
    Start-Sleep -Milliseconds 400
  }
  $env:EDOC_EXTENSION_ID = $ExtensionId
  $env:EDOC_PARSER_PORT = '11435'
  Start-Process -FilePath $nodePath -ArgumentList @("`"$parserPath`"") -WorkingDirectory $AppRoot -WindowStyle Hidden -RedirectStandardOutput $parserOut -RedirectStandardError $parserErr
}

if (-not (Wait-Cors 'http://127.0.0.1:11435/health')) {
  throw "Parser did not become ready. See $parserErr"
}
Log 'Parser ready.'
