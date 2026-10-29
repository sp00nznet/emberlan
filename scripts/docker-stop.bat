@echo off
REM ============================================
REM Emberlan - Docker Stop Script for Windows
REM ============================================

title Emberlan Docker Stop

echo.
echo  ======================================
echo   Emberlan Docker Stop
echo  ======================================
echo.

cd /d "%~dp0.."

echo Stopping Emberlan containers...

docker-compose down

echo.
echo  Containers stopped.
echo.

pause
