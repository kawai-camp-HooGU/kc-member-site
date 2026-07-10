@echo off
cd /d "%~dp0"
title KAWAI CAMP - Local Dev Server

echo ============================================================
echo   KAWAI CAMP  Local Development Server
echo ============================================================
echo.
echo Working folder: %CD%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo   Install the LTS version from https://nodejs.org/ then run again.
  echo.
  pause
  exit /b
)

if not exist "package.json" (
  echo [ERROR] package.json not found in this folder.
  echo   Make sure start.bat is inside the "develop" folder.
  echo.
  pause
  exit /b
)

if not exist "node_modules\next\package.json" (
  echo [SETUP] Installing dependencies... this may take a few minutes.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    echo   Delete the node_modules folder, then run this file again.
    echo.
    pause
    exit /b
  )
  echo.
  echo [DONE] Dependencies installed.
  echo.
)

if not exist ".env.local" (
  echo [WARNING] .env.local not found.
  echo   Copy .env.example to .env.local and set your Supabase values.
  echo.
  pause
  exit /b
)

echo Starting dev server...
echo   Open http://localhost:3000 in your browser.
echo   Press Ctrl + C here to stop.
echo.
call npm run dev

pause
