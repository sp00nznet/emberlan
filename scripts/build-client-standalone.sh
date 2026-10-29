#!/bin/bash
# ================================================================
# Emberlan Standalone Client Build Script (Linux)
# Builds the Electron client WITHOUT the embedded server
# Users connect to remote Emberlan servers
# ================================================================

echo ""
echo "  ███████╗███████╗██╗      █████╗ ███╗   ██╗███████╗"
echo "  ██╔════╝╚════██║██║     ██╔══██╗████╗  ██║██╔════╝"
echo "  █████╗      ██╔╝██║     ███████║██╔██╗ ██║███████╗"
echo "  ██╔══╝     ██╔╝ ██║     ██╔══██║██║╚██╗██║╚════██║"
echo "  ██║        ██║  ███████╗██║  ██║██║ ╚████║███████║"
echo "  ╚═╝        ╚═╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝"
echo ""
echo "  Standalone Client Build (No Embedded Server)"
echo "  ============================================="
echo ""

# Get script directory and navigate to project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed!"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi

# Navigate to electron-client
cd electron-client

echo "[1/4] Installing dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install dependencies"
    exit 1
fi

echo ""
echo "[2/4] Configuring standalone mode..."
# Create a flag file to indicate standalone mode
echo "standalone" > .standalone

echo ""
echo "[3/4] Building Linux application..."
npm run build:linux
if [ $? -ne 0 ]; then
    echo "[ERROR] Build failed"
    rm -f .standalone
    exit 1
fi

echo ""
echo "[4/4] Build complete!"
echo ""
echo "================================================================"
echo "  Standalone client built successfully!"
echo ""
echo "  Find your installer in: electron-client/dist/"
echo ""
echo "  This client connects to REMOTE servers only."
echo "  Use the + button in the app to add servers."
echo "================================================================"
echo ""

# Clean up flag file
rm -f .standalone
