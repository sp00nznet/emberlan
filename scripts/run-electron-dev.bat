@echo off
REM ============================================
REM Emberlan - Run Electron Client (Development)
REM ============================================
REM Runs the Electron client without building
REM Useful for testing and development
REM ============================================

title Emberlan Electron Dev

echo.
echo  ======================================
echo   Emberlan Electron Client (Dev Mode)
echo  ======================================
echo.

cd /d "%~dp0..\electron-client"

REM Check if node_modules exists
if not exist "node_modules" (
    echo [ERROR] Electron client dependencies not installed!
    echo Installing now...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
)

echo Starting Electron client in development mode...
echo.

REM Set development environment
set NODE_ENV=development

REM Start Electron
call npm start

pause
