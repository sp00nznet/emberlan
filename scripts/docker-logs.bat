@echo off
REM ============================================
REM Emberlan - Docker Logs Viewer for Windows
REM ============================================

title Emberlan Docker Logs

echo.
echo  ======================================
echo   Emberlan Docker Logs
echo  ======================================
echo.
echo  Press Ctrl+C to exit log viewer
echo.

cd /d "%~dp0.."

docker-compose logs -f --tail=100

pause
