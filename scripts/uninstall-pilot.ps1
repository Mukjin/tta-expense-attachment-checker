param(
  [string]$InstallBase = "$env:LOCALAPPDATA\TTAExpenseChecker"
)

$ErrorActionPreference = 'Stop'
$expected = Join-Path $env:LOCALAPPDATA 'TTAExpenseChecker'
$resolvedExpected = [System.IO.Path]::GetFullPath($expected).TrimEnd('\')
$resolvedTarget = [System.IO.Path]::GetFullPath($InstallBase).TrimEnd('\')
if ($resolvedTarget -ne $resolvedExpected) { throw 'Refusing to remove an unexpected install path.' }

$taskName = 'TTA Expense Attachment Checker'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

$listener = Get-NetTCPConnection -LocalPort 11435 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction SilentlyContinue
  if ([string]$process.CommandLine -like "*$resolvedTarget*") {
    Stop-Process -Id $listener.OwningProcess -Force
    Start-Sleep -Milliseconds 400
  }
}

if (Test-Path -LiteralPath $resolvedTarget) {
  Set-Location -LiteralPath $env:TEMP
  Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}

Write-Host 'Pilot companion app and startup task removed.' -ForegroundColor Green
Write-Host 'Remove the browser extension separately from chrome://extensions.'

