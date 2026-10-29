@echo off
REM ============================================
REM Emberlan - Start Server Script for Windows
REM ============================================

title Emberlan Server
setlocal enabledelayedexpansion

echo.
echo  ======================================
echo   Emberlan Server
echo  ======================================
echo.

REM Get the project root directory (parent of scripts folder)
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"
echo [INFO] Project root: %CD%
echo.

REM Check if Node.js is available
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if node_modules exists
if not exist "node_modules" (
    echo [ERROR] Dependencies not installed!
    echo.
    echo The 'node_modules' folder is missing.
    echo.
    echo Please run setup.bat first:
    echo   scripts\setup.bat
    echo.
    echo Or manually install dependencies:
    echo   npm install
    echo.
    pause
    exit /b 1
)

REM Check if express is installed (sanity check)
if not exist "node_modules\express" (
    echo [ERROR] Dependencies appear to be corrupted!
    echo.
    echo The express module is missing from node_modules.
    echo Try running: npm install
    echo.
    pause
    exit /b 1
)

REM Check for .env file
if not exist ".env" (
    echo [WARNING] No .env file found!
    echo.
    if exist ".env.example" (
        echo Creating from template...
        copy ".env.example" ".env" >nul
    ) else (
        echo Creating default .env file...
        (
            echo PORT=3001
            echo NODE_ENV=development
            echo JWT_SECRET=change-this-secret-in-production
            echo MONGODB_URI=mongodb://localhost:27017/f7lans
            echo SERVER_URL=http://localhost:3001
            echo CLIENT_URL=http://localhost:3000
            echo FEDERATION_ENABLED=true
            echo FEDERATION_SERVER_NAME=Emberlan Server
        ) > .env
    )
    echo [IMPORTANT] Please edit .env with your configuration!
    echo Especially set your MongoDB connection string.
    echo.
)

REM Check if server/index.js exists
if not exist "server\index.js" (
    echo [ERROR] Server files not found!
    echo.
    echo The file 'server\index.js' is missing.
    echo Make sure you have the complete Emberlan source code.
    echo.
    pause
    exit /b 1
)

echo [OK] All checks passed
echo.
echo Starting Emberlan server...
echo Press Ctrl+C to stop the server.
echo.
echo ----------------------------------------

REM Start the server
node server\index.js

if errorlevel 1 (
    echo.
    echo [ERROR] Server exited with an error!
    echo.
    echo Common issues:
    echo   - MongoDB is not running
    echo   - Port 3001 is already in use
    echo   - Invalid configuration in .env
    echo.
)

pause
