@echo off
REM ================================================================
REM Emberlan Standalone Client Build Script (Windows)
REM Builds the Electron client WITHOUT the embedded server
REM Users connect to remote Emberlan servers
REM ================================================================

echo.
echo  ███████╗███████╗██╗      █████╗ ███╗   ██╗███████╗
echo  ██╔════╝╚════██║██║     ██╔══██╗████╗  ██║██╔════╝
echo  █████╗      ██╔╝██║     ███████║██╔██╗ ██║███████╗
echo  ██╔══╝     ██╔╝ ██║     ██╔══██║██║╚██╗██║╚════██║
echo  ██║        ██║  ███████╗██║  ██║██║ ╚████║███████║
echo  ╚═╝        ╚═╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝
echo.
echo  Standalone Client Build (No Embedded Server)
echo  =============================================
echo.

cd /d "%~dp0.."

REM Check for Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Navigate to electron-client
cd electron-client

echo [1/4] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)

echo.
echo [2/4] Configuring standalone mode...
REM Create a flag file to indicate standalone mode
echo standalone > .standalone

echo.
echo [3/4] Building Windows application...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)

echo.
echo [4/4] Build complete!
echo.
echo ================================================================
echo  Standalone client built successfully!
echo.
echo  Find your installer in: electron-client\dist\
echo.
echo  This client connects to REMOTE servers only.
echo  Use the + button in the app to add servers.
echo ================================================================
echo.

REM Clean up flag file
del .standalone 2>nul

pause
