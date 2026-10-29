@echo off
REM ============================================
REM Emberlan - Docker Build Script for Windows
REM ============================================
REM Builds all Docker containers
REM Requires Docker Desktop for Windows
REM ============================================

title Emberlan Docker Build

echo.
echo  ======================================
echo   Emberlan Docker Build
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
for /f "tokens=*" %%i in ('docker --version') do echo Found: %%i

REM Check for docker-compose
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] docker-compose is not available!
    pause
    exit /b 1
)

echo.
echo Building Docker containers...
echo This may take several minutes on first run...
echo.

REM Build containers
docker-compose build

if errorlevel 1 (
    echo.
    echo [ERROR] Docker build failed!
    pause
    exit /b 1
)

echo.
echo  ======================================
echo   Docker Build Complete!
echo  ======================================
echo.
echo  Run 'docker-start.bat' to start the containers
echo.

pause
