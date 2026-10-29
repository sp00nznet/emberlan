@echo off
REM ============================================
REM Emberlan - Complete Setup Script for Windows
REM ============================================
REM This script sets up the entire Emberlan project
REM including server, web client, and Electron client
REM ============================================

title Emberlan Setup
setlocal enabledelayedexpansion

echo.
echo  ======================================
echo   Emberlan Gaming Community Platform
echo   Windows Setup Script
echo  ======================================
echo.

REM Get the project root directory (parent of scripts folder)
set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"
echo [INFO] Project root: %CD%
echo.

REM Check for Node.js
echo [1/6] Checking for Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js from https://nodejs.org/
    echo Recommended version: 20.x LTS
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node --version') do echo        Found Node.js %%i

REM Check for npm
echo [2/6] Checking for npm...
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed!
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm --version') do echo        Found npm %%i

REM Install server dependencies
echo [3/6] Installing server dependencies...
echo        Running npm install in %CD%...
call npm install
if errorlevel 1 (
    echo [ERROR] Failed to install server dependencies!
    pause
    exit /b 1
)

REM Verify node_modules was created
if not exist "node_modules" (
    echo [ERROR] node_modules folder was not created!
    echo        npm install may have failed silently.
    pause
    exit /b 1
)
echo        Server dependencies installed successfully

REM Install Electron client dependencies
echo [4/6] Installing Electron client dependencies...
if exist "electron-client" (
    cd /d "%PROJECT_ROOT%\electron-client"
    echo        Running npm install in %CD%...
    call npm install
    if errorlevel 1 (
        echo [WARNING] Failed to install Electron client dependencies!
        echo           You can still run the server, but Electron build won't work.
    ) else (
        echo        Electron client dependencies installed successfully
    )
    cd /d "%PROJECT_ROOT%"
) else (
    echo        [SKIP] electron-client folder not found
)

REM Create .env file if it doesn't exist
echo [5/6] Setting up environment configuration...
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo        Created .env file from template
        echo        [IMPORTANT] Please edit .env with your configuration!
    ) else (
        echo        Creating default .env file...
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
        echo        Created default .env file
        echo        [IMPORTANT] Please edit .env with your configuration!
    )
) else (
    echo        .env file already exists
)

REM Create uploads directory
echo [6/6] Creating required directories...
if not exist "server\uploads\avatars" mkdir "server\uploads\avatars"
echo        Created uploads directory

echo.
echo  ======================================
echo   Setup Complete!
echo  ======================================
echo.
echo  Verification:
if exist "node_modules" (
    echo    [OK] node_modules exists
) else (
    echo    [FAIL] node_modules missing!
)
if exist ".env" (
    echo    [OK] .env file exists
) else (
    echo    [FAIL] .env missing!
)
echo.
echo  Next steps:
echo  1. Edit .env file with your MongoDB connection string
echo  2. Make sure MongoDB is running
echo  3. Run 'scripts\start-server.bat' to start the server
echo  4. Run 'scripts\build-electron.bat' to build the desktop client
echo.
pause
