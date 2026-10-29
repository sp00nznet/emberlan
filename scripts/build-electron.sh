#!/bin/bash
# ============================================
# Emberlan - Build Electron Client for Linux
# ============================================
# Builds the desktop client as:
#   - AppImage (portable)
#   - .deb package (Debian/Ubuntu)
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo "  ======================================"
echo "   Emberlan Electron Client Builder"
echo "   Building for Linux..."
echo "  ======================================"
echo ""

# Get the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ELECTRON_DIR="$PROJECT_ROOT/electron-client"

cd "$ELECTRON_DIR"
echo "[INFO] Electron client directory: $PWD"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] Node.js is not installed!${NC}"
    echo "Please run setup-debian.sh first or install Node.js manually."
    exit 1
fi
echo "Found: Node.js $(node --version)"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}[ERROR] npm is not installed!${NC}"
    exit 1
fi
echo "Found: npm $(npm --version)"
echo ""

# Install build dependencies for Electron on Debian
echo "Checking system dependencies..."
MISSING_DEPS=""

# Check for required packages
for pkg in libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libasound2 libsecret-1-0; do
    if ! dpkg -s "$pkg" &> /dev/null; then
        MISSING_DEPS="$MISSING_DEPS $pkg"
    fi
done

if [ -n "$MISSING_DEPS" ]; then
    echo -e "${YELLOW}[INFO] Installing missing dependencies:${NC}$MISSING_DEPS"
    sudo apt-get update
    sudo apt-get install -y $MISSING_DEPS
fi

# Install additional build tools for electron-builder
if ! dpkg -s "rpm" &> /dev/null 2>&1; then
    echo -e "${YELLOW}[INFO] Installing rpm (needed for some electron-builder targets)${NC}"
    sudo apt-get install -y rpm 2>/dev/null || true
fi

echo -e "${GREEN}[OK]${NC} System dependencies ready"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[INFO] Electron client dependencies not installed!"
    echo "Installing now..."
    npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Failed to install dependencies!${NC}"
        exit 1
    fi
fi
echo -e "${GREEN}[OK]${NC} Node modules ready"
echo ""

# Create assets directory if it doesn't exist
mkdir -p assets

# Check for icon file
if [ ! -f "assets/icon.png" ]; then
    echo -e "${YELLOW}[WARNING] No icon.png found in assets folder${NC}"
    echo "Build will use default Electron icon"
    echo "To use custom icon, place icon.png (256x256 or larger) in electron-client/assets/"
    echo ""
fi

echo "Building Electron client..."
echo "This may take several minutes..."
echo ""

# Build for Linux
npm run build:linux

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}[ERROR] Build failed!${NC}"
    exit 1
fi

echo ""
echo "  ======================================"
echo -e "   ${GREEN}Build Complete!${NC}"
echo "  ======================================"
echo ""
echo "  Output files are in: electron-client/dist/"
echo ""
echo -e "  ${CYAN}Files created:${NC}"

# List output files
if [ -d "dist" ]; then
    ls -lh dist/*.AppImage 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'
    ls -lh dist/*.deb 2>/dev/null | awk '{print "    " $NF " (" $5 ")"}'
fi

echo ""
echo -e "  ${CYAN}Install .deb package:${NC}"
echo "    sudo dpkg -i dist/emberlan*.deb"
echo ""
echo -e "  ${CYAN}Run AppImage:${NC}"
echo "    chmod +x dist/*.AppImage && ./dist/*.AppImage"
echo ""
