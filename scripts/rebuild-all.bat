@echo off
REM ============================================
REM Emberlan - Full Rebuild Script for Windows
REM ============================================
REM Cleans and rebuilds everything from scratch
REM ============================================

title Emberlan Full Rebuild

echo.
echo  ======================================
echo   Emberlan Full Rebuild
echo  ======================================
echo.
echo  This will:
echo    1. Clean all build artifacts
echo    2. Reinstall all dependencies
echo    3. Build Electron client
echo.

set /p confirm="Continue? (y/n): "
if /i not "%confirm%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

cd /d "%~dp0"

echo.
echo [1/3] Cleaning...
call clean.bat <nul

echo.
echo [2/3] Running setup...
call setup.bat <nul

echo.
echo [3/3] Building Electron client...
call build-electron.bat <nul

echo.
echo  ======================================
echo   Full Rebuild Complete!
echo  ======================================
echo.

pause
