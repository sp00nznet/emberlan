@echo off
REM ============================================
REM Emberlan - SSL Certificate Generator
REM ============================================
REM Generates self-signed SSL certificates for HTTPS
REM For production, use proper certificates from Let's Encrypt
REM ============================================

title Emberlan SSL Generator

echo.
echo  ======================================
echo   Emberlan SSL Certificate Generator
echo  ======================================
echo.

cd /d "%~dp0.."

REM Check for OpenSSL
openssl version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] OpenSSL is not installed!
    echo.
    echo To install OpenSSL on Windows:
    echo   1. Download from: https://slproweb.com/products/Win32OpenSSL.html
    echo   2. Install the "Light" version
    echo   3. Add OpenSSL\bin to your PATH
    echo.
    echo Alternatively, if you have Git installed:
    echo   OpenSSL is included in Git Bash
    echo   Run this script from Git Bash instead
    echo.
    pause
    exit /b 1
)

REM Create ssl directory
if not exist "docker\ssl" mkdir "docker\ssl"

echo Generating self-signed SSL certificate...
echo.
echo [NOTE] This creates a self-signed certificate for development.
echo        For production, use Let's Encrypt or another CA.
echo.

REM Generate private key and certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 ^
    -keyout docker\ssl\key.pem ^
    -out docker\ssl\cert.pem ^
    -subj "/C=US/ST=State/L=City/O=Emberlan/OU=Development/CN=localhost"

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to generate certificates!
    pause
    exit /b 1
)

echo.
echo  ======================================
echo   SSL Certificates Generated!
echo  ======================================
echo.
echo  Files created:
echo    - docker\ssl\key.pem  (Private key)
echo    - docker\ssl\cert.pem (Certificate)
echo.
echo  To enable HTTPS:
echo    1. Set ENABLE_HTTPS=true in .env
echo    2. Restart the server
echo.
echo  [WARNING] Self-signed certificates will show
echo            browser warnings. This is normal for development.
echo.

pause
