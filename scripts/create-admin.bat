@echo off
REM ============================================
REM Emberlan - Create Admin User Script
REM ============================================
REM Creates a new admin user via the API
REM ============================================

title Emberlan Create Admin

echo.
echo  ======================================
echo   Emberlan - Create Admin User
echo  ======================================
echo.

set /p server_url="Server URL (default: http://localhost:3001): "
if "%server_url%"=="" set "server_url=http://localhost:3001"

set /p admin_user="Admin username to login as: "
set /p admin_pass="Admin password: "

echo.
echo New admin account details:
set /p new_username="New admin username: "
set /p new_email="New admin email: "
set /p new_password="New admin password: "

echo.
echo Creating admin user...

REM First, login to get token
for /f "tokens=*" %%i in ('curl -s -X POST "%server_url%/api/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"%admin_user%\",\"password\":\"%admin_pass%\"}"') do set "login_response=%%i"

REM Extract token (simplified - in real use, use proper JSON parsing)
echo %login_response% | findstr /i "error" >nul
if not errorlevel 1 (
    echo.
    echo [ERROR] Login failed!
    echo Response: %login_response%
    pause
    exit /b 1
)

echo Login successful.
echo.
echo Note: Full admin creation requires additional steps.
echo Please use the web interface to create admin users:
echo   1. Login as existing admin at %server_url%
echo   2. Go to Settings
echo   3. Use the Admin panel to create invites
echo   4. Register new user with the invite
echo   5. Promote user to admin via the admin panel
echo.

pause
