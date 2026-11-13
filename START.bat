@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1" -Mode browser
if errorlevel 1 (
  echo.
  echo Setup failed. See data\setup.log. Press any key to close.
  pause >nul
  exit /b 1
)
