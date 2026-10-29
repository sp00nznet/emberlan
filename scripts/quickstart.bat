@echo off
REM ============================================
REM Emberlan - Quick Start Script
REM ============================================
REM One-click setup and start using Docker
REM ============================================

title Emberlan Quick Start

echo.
echo  ======================================
echo   Emberlan Quick Start
echo  ======================================
echo.
echo  This will:
echo    1. Check prerequisites
echo    2. Build Docker containers
echo    3. Start the server
echo.

cd /d "%~dp0.."

REM Check for Docker
echo Checking for Docker...
docker --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Docker is not installed or not running!
    echo.
    echo Please install Docker Desktop from:
    echo https://www.docker.com/products/docker-desktop
    echo.
    echo After installation, make sure Docker Desktop is running.
    echo.
    pause
    exit /b 1
)
echo Docker is available.

REM Check if Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Docker is installed but not running!
    echo Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)
echo Docker is running.

echo.
echo Starting Emberlan with Docker...
echo This may take a few minutes on first run...
echo.

REM Build and start containers
docker-compose up -d --build

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to start containers!
    echo.
    echo Try running these commands manually:
    echo   docker-compose build
    echo   docker-compose up -d
    echo.
    pause
    exit /b 1
)

echo.
echo Waiting for services to start...
timeout /t 10 /nobreak >nul

REM Check if server is responding
curl -s http://localhost:3001/health >nul 2>&1
if errorlevel 1 (
    echo.
    echo [WARNING] Server may still be starting...
    echo Wait a moment and check http://localhost:3001
)

echo.
echo  ======================================
echo   Emberlan is now running!
echo  ======================================
echo.
echo  Web Interface: http://localhost:3001
echo.
echo  Default Admin Login:
echo    Username: admin
echo    Password: admin123
echo.
echo  [IMPORTANT] Change the admin password after first login!
echo.
echo  Useful commands:
echo    View logs:  docker-compose logs -f
echo    Stop:       docker-compose down
echo    Restart:    docker-compose restart
echo.

set /p open_browser="Open in browser? (y/n): "
if /i "%open_browser%"=="y" (
    start http://localhost:3001
)

pause
