@echo off
REM ============================================
REM Emberlan - Build All Electron Variants
REM ============================================
REM Builds:
REM   - Windows x64 installer
REM   - Windows x64 portable
REM   - Windows x86 (32-bit) installer
REM ============================================

title Emberlan Electron Build (All)

echo.
echo  ======================================
echo   Emberlan Electron Client Builder
echo   Building all Windows variants...
echo  ======================================
echo.

cd /d "%~dp0..\electron-client"

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies!
        pause
        exit /b 1
    )
)

REM Create assets directory
if not exist "assets" mkdir assets

echo.
echo Building all variants...
echo This will take several minutes...
echo.

REM Clean previous builds
if exist "dist" rmdir /s /q "dist"

REM Build for Windows (both architectures)
call npx electron-builder --win --x64 --ia32

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
echo  Output files:
echo.
dir /b dist\*.exe 2>nul
echo.
echo  Location: electron-client\dist\
echo.

explorer dist

pause
