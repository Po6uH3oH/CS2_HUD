@echo off
cd /d "%~dp0"
set "HUD_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
    set "HUD_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  ) else (
    echo Install Node.js 24 LTS from https://nodejs.org then run this file again.
    pause
    exit /b 1
  )
)
if not exist node_modules (
  where pnpm >nul 2>nul
  if errorlevel 1 (call npm install) else (call pnpm install)
  if errorlevel 1 (pause & exit /b 1)
)
if not exist dist\web\index.html (
  "%HUD_NODE%" node_modules\typescript\bin\tsc --noEmit
  if errorlevel 1 (pause & exit /b 1)
  "%HUD_NODE%" node_modules\vite\bin\vite.js build
  if errorlevel 1 (pause & exit /b 1)
)
echo Operator panel: http://127.0.0.1:3190/admin
"%HUD_NODE%" --import tsx apps/backend/index.ts
pause
