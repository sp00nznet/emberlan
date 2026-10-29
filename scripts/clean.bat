@echo off
REM ============================================
REM Emberlan - Clean Build Script for Windows
REM ============================================
REM Removes all node_modules and build artifacts
REM ============================================

title Emberlan Clean

echo.
echo  ======================================
echo   Emberlan Clean
echo  ======================================
echo.
echo  This will remove:
echo    - node_modules folders
echo    - Electron build output (dist)
echo    - Temporary files
echo.

set /p confirm="Are you sure? (y/n): "
if /i not "%confirm%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

cd /d "%~dp0.."

echo.
echo Cleaning...

REM Remove server node_modules
if exist "node_modules" (
    echo Removing server node_modules...
    rmdir /s /q "node_modules"
)

REM Remove Electron node_modules and dist
if exist "electron-client\node_modules" (
    echo Removing Electron client node_modules...
    rmdir /s /q "electron-client\node_modules"
)

if exist "electron-client\dist" (
    echo Removing Electron build output...
    rmdir /s /q "electron-client\dist"
)

REM Remove package-lock files
if exist "package-lock.json" del /q "package-lock.json"
if exist "electron-client\package-lock.json" del /q "electron-client\package-lock.json"

echo.
echo  ======================================
echo   Clean Complete!
echo  ======================================
echo.
echo  Run setup.bat to reinstall dependencies.
echo.

pause
