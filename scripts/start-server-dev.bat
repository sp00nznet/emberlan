@echo off
REM ============================================
REM Emberlan - Start Development Server (with auto-reload)
REM ============================================

title Emberlan Dev Server

echo.
echo  ======================================
echo   Emberlan Development Server
echo   (Auto-reload enabled)
echo  ======================================
echo.

cd /d "%~dp0.."

REM Check if node_modules exists
if not exist "node_modules" (
    echo [ERROR] Dependencies not installed!
    echo Please run setup.bat first.
    pause
    exit /b 1
)

REM Check for nodemon
call npx nodemon --version >nul 2>&1
if errorlevel 1 (
    echo Installing nodemon...
    call npm install -g nodemon
)

echo Starting Emberlan development server...
echo Server will auto-reload on file changes.
echo Press Ctrl+C to stop the server.
echo.

REM Start with nodemon
call npx nodemon server\index.js

pause
