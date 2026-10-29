@echo off
REM ============================================
REM Emberlan - Docker Start Script for Windows
REM ============================================
REM Starts all Docker containers
REM ============================================

title Emberlan Docker Start

echo.
echo  ======================================
echo   Emberlan Docker Start
echo  ======================================
echo.

cd /d "%~dp0.."

REM Check for Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not running!
    echo Please install Docker Desktop from https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

REM Check if containers need to be built
docker-compose images | findstr /i "emberlan" >nul 2>&1
if errorlevel 1 (
    echo Containers not built yet. Building now...
    call docker-compose build
)

echo Starting Emberlan containers...
echo.

REM Start containers in detached mode
docker-compose up -d

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start containers!
    pause
    exit /b 1
)

echo.
echo  ======================================
echo   Containers Started Successfully!
echo  ======================================
echo.
echo  Services:
echo    - Server:   http://localhost:3001
echo    - MongoDB:  localhost:27017
echo.
echo  Default admin credentials:
echo    Username: admin
echo    Password: admin123
echo.
echo  View logs: docker-compose logs -f
echo  Stop:      scripts\docker-stop.bat
echo.

pause
