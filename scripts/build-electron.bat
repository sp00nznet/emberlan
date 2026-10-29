@echo off
REM ============================================
REM Emberlan - Build Electron Client for Windows
REM ============================================
REM Builds the desktop client as:
REM   - NSIS installer (.exe)
REM   - Portable executable (.exe)
REM ============================================

title Emberlan Electron Build

echo.
echo  ======================================
echo   Emberlan Electron Client Builder
echo   Building for Windows...
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

REM Create assets directory if it doesn't exist
if not exist "assets" mkdir assets

REM Check for icon file, create placeholder if missing
if not exist "assets\icon.ico" (
    echo [WARNING] No icon.ico found in assets folder
    echo Build will use default Electron icon
    echo To use custom icon, place icon.ico in electron-client\assets\
    echo.
)

echo Building Electron client...
echo This may take several minutes...
echo.

REM Build for Windows
call npm run build:win

if errorlevel 1 (
    echo.
    echo [ERROR] Build failed!
    pause
    exit /b 1
)

echo.
echo  ======================================
echo   Build Complete!
echo  ======================================
echo.
echo  Output files are in: electron-client\dist\
echo.
echo  Files created:
dir /b dist\*.exe 2>nul
echo.

REM Open output folder
explorer dist

pause
