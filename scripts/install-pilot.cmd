@echo off
chcp 65001 >nul
title TTA Expense Attachment Checker - Pilot Install
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-pilot.ps1" -OpenExtensionsPage
if errorlevel 1 (
  echo.
  echo Installation failed. Review the message above.
  pause
) else (
  echo.
  echo Installation completed.
  pause
)

