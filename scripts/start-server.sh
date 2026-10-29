#!/bin/bash
# ============================================
# Emberlan - Start Server Script
# ============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "  ======================================"
echo "   Emberlan Server"
echo "  ======================================"
echo ""

# Get the project root directory (parent of scripts folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"
echo "[INFO] Project root: $PWD"
echo ""

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo -e "${RED}[ERROR] Node.js is not installed or not in PATH!${NC}"
    echo "Please install Node.js or run setup-debian.sh first."
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "${RED}[ERROR] Dependencies not installed!${NC}"
    echo ""
    echo "The 'node_modules' folder is missing."
    echo ""
    echo "Please run setup-debian.sh first:"
    echo "  ./scripts/setup-debian.sh"
    echo ""
    echo "Or manually install dependencies:"
    echo "  npm install"
    echo ""
    exit 1
fi

# Check if express is installed (sanity check)
if [ ! -d "node_modules/express" ]; then
    echo -e "${RED}[ERROR] Dependencies appear to be corrupted!${NC}"
    echo ""
    echo "The express module is missing from node_modules."
    echo "Try running: npm install"
    echo ""
    exit 1
fi

# Check for .env file
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}[WARNING] No .env file found!${NC}"
    echo ""
    if [ -f ".env.example" ]; then
        echo "Creating from template..."
        cp ".env.example" ".env"
    else
        echo "Creating default .env file..."
        cat > .env << 'EOF'
PORT=3001
NODE_ENV=development
JWT_SECRET=change-this-secret-in-production
MONGODB_URI=mongodb://localhost:27017/f7lans
SERVER_URL=http://localhost:3001
CLIENT_URL=http://localhost:3000
FEDERATION_ENABLED=true
FEDERATION_SERVER_NAME=Emberlan Server
EOF
    fi
    echo -e "${YELLOW}[IMPORTANT] Please edit .env with your configuration!${NC}"
    echo "Especially set your MongoDB connection string."
    echo ""
fi

# Check if server/index.js exists
if [ ! -f "server/index.js" ]; then
    echo -e "${RED}[ERROR] Server files not found!${NC}"
    echo ""
    echo "The file 'server/index.js' is missing."
    echo "Make sure you have the complete Emberlan source code."
    echo ""
    exit 1
fi

echo -e "${GREEN}[OK] All checks passed${NC}"
echo ""
echo "Starting Emberlan server..."
echo "Press Ctrl+C to stop the server."
echo ""
echo "----------------------------------------"

# Start the server
node server/index.js

EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
    echo ""
    echo -e "${RED}[ERROR] Server exited with an error!${NC}"
    echo ""
    echo "Common issues:"
    echo "  - MongoDB is not running"
    echo "  - Port 3001 is already in use"
    echo "  - Invalid configuration in .env"
    echo ""
fi
