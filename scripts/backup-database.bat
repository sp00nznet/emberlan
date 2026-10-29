@echo off
REM ============================================
REM Emberlan - Database Backup Script
REM ============================================
REM Creates a backup of the MongoDB database
REM ============================================

title Emberlan Database Backup

echo.
echo  ======================================
echo   Emberlan Database Backup
echo  ======================================
echo.

cd /d "%~dp0.."

REM Create backups directory
if not exist "backups" mkdir "backups"

REM Generate timestamp
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "timestamp=%dt:~0,8%-%dt:~8,6%"

set "backup_dir=backups\emberlan-%timestamp%"

echo Creating backup: %backup_dir%
echo.

REM Check if running in Docker
docker ps | findstr /i "emberlan-mongodb" >nul 2>&1
if not errorlevel 1 (
    echo Backing up from Docker container...
    docker exec emberlan-mongodb mongodump --db f7lans --out /tmp/backup
    docker cp emberlan-mongodb:/tmp/backup/f7lans "%backup_dir%"
    docker exec emberlan-mongodb rm -rf /tmp/backup
) else (
    REM Local MongoDB
    mongodump --version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] mongodump not found!
        echo Please install MongoDB Database Tools
        echo https://www.mongodb.com/try/download/database-tools
        pause
        exit /b 1
    )

    echo Backing up from local MongoDB...
    mongodump --db f7lans --out "%backup_dir%"
)

if errorlevel 1 (
    echo.
    echo [ERROR] Backup failed!
    pause
    exit /b 1
)

echo.
echo  ======================================
echo   Backup Complete!
echo  ======================================
echo.
echo  Backup location: %backup_dir%
echo.

pause
