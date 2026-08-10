@echo off
chcp 65001 >nul
title TTA Expense Attachment Checker PoC
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0poc-start.ps1"
if errorlevel 1 (
  echo.
  echo The launcher failed. Review the message above.
  pause
)