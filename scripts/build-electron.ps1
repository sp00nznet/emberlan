# ============================================
# Emberlan - One-Click Electron Build for Windows
# ============================================
# This script installs all required dependencies
# and builds the Electron client for Windows
# ============================================
# Run with: powershell -ExecutionPolicy Bypass -File scripts\build-electron.ps1
# ============================================

$ErrorActionPreference = "Stop"

# Colors
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Success($message) { Write-Host "  [OK] $message" -ForegroundColor Green }
function Write-Error($message) { Write-Host "  [ERROR] $message" -ForegroundColor Red }
function Write-Warning($message) { Write-Host "  [WARNING] $message" -ForegroundColor Yellow }
function Write-Info($message) { Write-Host "  [INFO] $message" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host "   Emberlan Electron Client Builder" -ForegroundColor Cyan
Write-Host "   One-Click Build for Windows" -ForegroundColor Cyan
Write-Host "  ======================================" -ForegroundColor Cyan
Write-Host ""

# Get project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ElectronDir = Join-Path $ProjectRoot "electron-client"

Write-Info "Project root: $ProjectRoot"
Write-Host ""

# ============================================
# Step 1: Check/Install Node.js
# ============================================
Write-Host "[1/5] Checking for Node.js..." -ForegroundColor White

$nodeInstalled = $false
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        $nodeInstalled = $true
        Write-Success "Found Node.js $nodeVersion"

        # Check version is >= 18
        $majorVersion = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
        if ($majorVersion -lt 18) {
            Write-Warning "Node.js version is too old (need >= 18)"
            $nodeInstalled = $false
        }
    }
} catch {
    $nodeInstalled = $false
}

if (-not $nodeInstalled) {
    Write-Info "Node.js not found or outdated. Attempting to install..."

    # Try winget first
    $wingetAvailable = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetAvailable) {
        Write-Info "Installing Node.js via winget..."
        try {
            winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Success "Node.js installed via winget"
        } catch {
            Write-Warning "winget install failed, trying chocolatey..."
        }
    }

    # Check again
    try {
        $nodeVersion = node --version 2>$null
        if ($nodeVersion) {
            $nodeInstalled = $true
        }
    } catch {}

    # Try chocolatey if winget failed
    if (-not $nodeInstalled) {
        $chocoAvailable = Get-Command choco -ErrorAction SilentlyContinue
        if ($chocoAvailable) {
            Write-Info "Installing Node.js via Chocolatey..."
            try {
                choco install nodejs-lts -y
                # Refresh PATH
                $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
                Write-Success "Node.js installed via Chocolatey"
                $nodeInstalled = $true
            } catch {
                Write-Warning "Chocolatey install failed"
            }
        }
    }

    # Final check
    if (-not $nodeInstalled) {
        Write-Host ""
        Write-Error "Could not install Node.js automatically!"
        Write-Host ""
        Write-Host "  Please install Node.js manually:" -ForegroundColor Yellow
        Write-Host "  1. Download from https://nodejs.org/" -ForegroundColor Yellow
        Write-Host "  2. Install Node.js 20.x LTS" -ForegroundColor Yellow
        Write-Host "  3. Restart this script" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  Or install via winget:" -ForegroundColor Yellow
        Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ============================================
# Step 2: Check npm
# ============================================
Write-Host "[2/5] Checking for npm..." -ForegroundColor White

try {
    $npmVersion = npm --version 2>$null
    Write-Success "Found npm $npmVersion"
} catch {
    Write-Error "npm not found! It should come with Node.js."
    Write-Host "  Please reinstall Node.js from https://nodejs.org/"
    Read-Host "Press Enter to exit"
    exit 1
}

# ============================================
# Step 3: Install dependencies
# ============================================
Write-Host "[3/5] Installing dependencies..." -ForegroundColor White

# Install electron-client dependencies
Set-Location $ElectronDir
Write-Info "Installing Electron client dependencies..."

if (-not (Test-Path "node_modules")) {
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Failed to install Electron client dependencies!"
        Read-Host "Press Enter to exit"
        exit 1
    }
}
Write-Success "Electron client dependencies ready"

# ============================================
# Step 4: Prepare assets
# ============================================
Write-Host "[4/5] Preparing build assets..." -ForegroundColor White

# Create assets directory
if (-not (Test-Path "assets")) {
    New-Item -ItemType Directory -Path "assets" | Out-Null
}

# Check for icon
if (-not (Test-Path "assets\icon.ico")) {
    Write-Warning "No icon.ico found in assets folder"
    Write-Host "       Build will use default Electron icon" -ForegroundColor Gray
    Write-Host "       To use custom icon, place icon.ico in electron-client\assets\" -ForegroundColor Gray
} else {
    Write-Success "Found icon.ico"
}

# ============================================
# Step 5: Build
# ============================================
Write-Host "[5/5] Building Electron client..." -ForegroundColor White
Write-Host ""
Write-Info "This may take several minutes..."
Write-Host ""

npm run build:win

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Error "Build failed!"
    Read-Host "Press Enter to exit"
    exit 1
}

# ============================================
# Done!
# ============================================
Write-Host ""
Write-Host "  ======================================" -ForegroundColor Green
Write-Host "   Build Complete!" -ForegroundColor Green
Write-Host "  ======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Output files are in: electron-client\dist\" -ForegroundColor White
Write-Host ""
Write-Host "  Files created:" -ForegroundColor Cyan

$distPath = Join-Path $ElectronDir "dist"
if (Test-Path $distPath) {
    Get-ChildItem -Path $distPath -Filter "*.exe" | ForEach-Object {
        $size = "{0:N2} MB" -f ($_.Length / 1MB)
        Write-Host "    $($_.Name) ($size)" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "  Opening output folder..." -ForegroundColor Cyan
Start-Process explorer.exe -ArgumentList $distPath

Write-Host ""
Read-Host "Press Enter to exit"
