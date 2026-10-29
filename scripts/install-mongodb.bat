@echo off
REM ============================================
REM Emberlan - MongoDB Installation Helper
REM ============================================
REM Helps install MongoDB on Windows
REM ============================================

title Emberlan MongoDB Setup

echo.
echo  ======================================
echo   Emberlan MongoDB Installation Helper
echo  ======================================
echo.

REM Check if MongoDB is already installed
mongod --version >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%i in ('mongod --version ^| findstr /i "version"') do echo MongoDB is already installed: %%i
    echo.
    goto :check_service
)

echo MongoDB is not installed.
echo.
echo You have two options:
echo.
echo   1. Use Docker (Recommended)
echo      - Run: scripts\docker-start.bat
echo      - MongoDB will be automatically set up in a container
echo.
echo   2. Install MongoDB locally
echo      - Download from: https://www.mongodb.com/try/download/community
echo      - Choose "MongoDB Community Server"
echo      - Select Windows x64 MSI package
echo      - Run the installer with default options
echo      - Make sure to check "Install MongoDB as a Service"
echo.
echo   3. Use MongoDB Atlas (Cloud)
echo      - Create free account at: https://www.mongodb.com/atlas
echo      - Create a free cluster
echo      - Get connection string and add to .env file
echo.

set /p choice="Open MongoDB download page? (y/n): "
if /i "%choice%"=="y" (
    start https://www.mongodb.com/try/download/community
)

goto :end

:check_service
echo Checking MongoDB service status...
sc query MongoDB >nul 2>&1
if errorlevel 1 (
    echo MongoDB service is not running.
    echo.
    set /p start_service="Start MongoDB service? (y/n): "
    if /i "%start_service%"=="y" (
        echo Starting MongoDB service...
        net start MongoDB
    )
) else (
    echo MongoDB service is running.
)

:end
echo.
pause
