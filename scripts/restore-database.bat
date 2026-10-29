@echo off
REM ============================================
REM Emberlan - Database Restore Script
REM ============================================
REM Restores a MongoDB database from backup
REM ============================================

title Emberlan Database Restore

echo.
echo  ======================================
echo   Emberlan Database Restore
echo  ======================================
echo.

cd /d "%~dp0.."

REM Check for backups
if not exist "backups" (
    echo [ERROR] No backups directory found!
    pause
    exit /b 1
)

echo Available backups:
echo.
dir /b /ad backups 2>nul
echo.

set /p backup_name="Enter backup folder name to restore: "

if not exist "backups\%backup_name%" (
    echo [ERROR] Backup not found: backups\%backup_name%
    pause
    exit /b 1
)

echo.
echo [WARNING] This will overwrite the current database!
set /p confirm="Are you sure you want to restore? (y/n): "
if /i not "%confirm%"=="y" (
    echo Cancelled.
    pause
    exit /b 0
)

echo.
echo Restoring database...

REM Check if running in Docker
docker ps | findstr /i "emberlan-mongodb" >nul 2>&1
if not errorlevel 1 (
    echo Restoring to Docker container...
    docker cp "backups\%backup_name%" emberlan-mongodb:/tmp/restore
    docker exec emberlan-mongodb mongorestore --db f7lans --drop /tmp/restore
    docker exec emberlan-mongodb rm -rf /tmp/restore
) else (
    REM Local MongoDB
    mongorestore --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] mongorestore not found!
        echo Please install MongoDB Database Tools
        pause
        exit /b 1
    )

    echo Restoring to local MongoDB...
    mongorestore --db f7lans --drop "backups\%backup_name%"
)

if errorlevel 1 (
    echo.
    echo [ERROR] Restore failed!
    pause
    exit /b 1
)

echo.
echo  ======================================
echo   Restore Complete!
echo  ======================================
echo.

pause
