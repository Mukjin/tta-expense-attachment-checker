param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\TTAExpenseChecker\app",
  [switch]$OpenExtensionsPage
)

$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $sourceRoot 'manifest.json') | ConvertFrom-Json
$extensionId = (Get-Content -Raw -Encoding ASCII -LiteralPath (Join-Path $sourceRoot 'distribution\extension-id.txt')).Trim()

if ($extensionId -notmatch '^[a-p]{32}$') { throw 'Invalid bundled extension ID.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 20 or later must be installed first.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'node_modules\kordoc'))) { throw 'Parser dependencies are missing from the source package.' }

$installParent = Split-Path -Parent $InstallRoot
if (-not $installParent.StartsWith((Join-Path $env:LOCALAPPDATA 'TTAExpenseChecker'), [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'InstallRoot must stay under LocalAppData\TTAExpenseChecker.'
}

New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$items = Get-ChildItem -LiteralPath $sourceRoot -Force | Where-Object { $_.Name -notin @('.git', 'dist', 'tests') }
foreach ($item in $items) {
  Copy-Item -LiteralPath $item.FullName -Destination $InstallRoot -Recurse -Force
}

$serviceScript = Join-Path $InstallRoot 'scripts\service-start.ps1'
$taskName = 'TTA Expense Attachment Checker'
$argument = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$serviceScript`" -ExtensionId $extensionId -AppRoot `"$InstallRoot`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'Starts the TTA expense attachment parser and local AI bridge.' -Force | Out-Null

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $serviceScript -ExtensionId $extensionId -AppRoot $InstallRoot

$state = [ordered]@{
  installed_at = (Get-Date).ToString('o')
  version = [string]$manifest.version
  extension_id = $extensionId
  app_root = $InstallRoot
  scheduled_task = $taskName
}
$state | ConvertTo-Json | Set-Content -LiteralPath (Join-Path (Split-Path -Parent $InstallRoot) 'install-state.json') -Encoding UTF8

Write-Host "Pilot installed: $InstallRoot" -ForegroundColor Green
Write-Host "Fixed extension ID: $extensionId" -ForegroundColor Green
Write-Host 'Load the install folder once from chrome://extensions. Future logons start services automatically.'

if ($OpenExtensionsPage) {
  $chrome = Get-Item 'C:\Program Files\Google\Chrome\Application\chrome.exe' -ErrorAction SilentlyContinue
  if ($chrome) { Start-Process -FilePath $chrome.FullName -ArgumentList 'chrome://extensions' }
}

