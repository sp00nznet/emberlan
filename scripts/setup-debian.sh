#!/bin/bash
# ============================================
# Emberlan - Complete Setup Script for Debian 12
# ============================================
# This script sets up the entire Emberlan project
# including server, web client, and Electron client
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "  ======================================"
echo "   Emberlan Gaming Community Platform"
echo "   Debian 12 Setup Script"
echo "  ======================================"
echo ""

# Get the project root directory (parent of scripts folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"
echo "[INFO] Project root: $PWD"
echo ""

# Function to check if running as root
check_root() {
    if [ "$EUID" -eq 0 ]; then
        echo -e "${YELLOW}[WARNING] Running as root. Consider running as a regular user.${NC}"
    fi
}

# Function to install system dependencies
install_system_deps() {
    echo "[1/7] Installing system dependencies..."

    # Update package lists
    sudo apt-get update

    # Install essential build tools and dependencies
    sudo apt-get install -y \
        curl \
        wget \
        git \
        build-essential \
        python3 \
        ca-certificates \
        gnupg

    echo -e "       ${GREEN}System dependencies installed${NC}"
}

# Function to install Node.js
install_nodejs() {
    echo "[2/7] Checking for Node.js..."

    if command -v node &> /dev/null; then
        NODE_VERSION=$(node --version)
        echo "       Found Node.js $NODE_VERSION"

        # Check if version is >= 18
        MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'.' -f1 | tr -d 'v')
        if [ "$MAJOR_VERSION" -lt 18 ]; then
            echo -e "${YELLOW}       Node.js version is too old. Installing Node.js 20.x...${NC}"
            install_nodejs_20
        fi
    else
        echo "       Node.js not found. Installing Node.js 20.x..."
        install_nodejs_20
    fi
}

install_nodejs_20() {
    # Install Node.js 20.x from NodeSource
    sudo mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg

    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list

    sudo apt-get update
    sudo apt-get install -y nodejs

    echo -e "       ${GREEN}Node.js $(node --version) installed${NC}"
}

# Function to check for npm
check_npm() {
    echo "[3/7] Checking for npm..."

    if command -v npm &> /dev/null; then
        NPM_VERSION=$(npm --version)
        echo "       Found npm $NPM_VERSION"
    else
        echo -e "${RED}[ERROR] npm is not installed!${NC}"
        exit 1
    fi
}

# Function to install server dependencies
install_server_deps() {
    echo "[4/7] Installing server dependencies..."
    echo "       Running npm install in $PWD..."

    npm install

    if [ ! -d "node_modules" ]; then
        echo -e "${RED}[ERROR] node_modules folder was not created!${NC}"
        echo "       npm install may have failed."
        exit 1
    fi

    echo -e "       ${GREEN}Server dependencies installed successfully${NC}"
}

# Function to install Electron client dependencies
install_electron_deps() {
    echo "[5/7] Installing Electron client dependencies..."

    if [ -d "electron-client" ]; then
        cd "$PROJECT_ROOT/electron-client"
        echo "       Running npm install in $PWD..."

        # Install additional dependencies for Electron on Linux
        sudo apt-get install -y \
            libgtk-3-0 \
            libnotify4 \
            libnss3 \
            libxss1 \
            libxtst6 \
            xdg-utils \
            libatspi2.0-0 \
            libuuid1 \
            libsecret-1-0 \
            libasound2 2>/dev/null || true

        npm install

        if [ $? -eq 0 ]; then
            echo -e "       ${GREEN}Electron client dependencies installed successfully${NC}"
        else
            echo -e "${YELLOW}[WARNING] Failed to install Electron client dependencies!${NC}"
            echo "          You can still run the server, but Electron build won't work."
        fi

        cd "$PROJECT_ROOT"
    else
        echo "       [SKIP] electron-client folder not found"
    fi
}

# Function to setup environment configuration
setup_env() {
    echo "[6/7] Setting up environment configuration..."

    if [ ! -f ".env" ]; then
        if [ -f ".env.example" ]; then
            cp ".env.example" ".env"
            echo "       Created .env file from template"
            echo -e "       ${YELLOW}[IMPORTANT] Please edit .env with your configuration!${NC}"
        else
            echo "       Creating default .env file..."
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
            echo "       Created default .env file"
            echo -e "       ${YELLOW}[IMPORTANT] Please edit .env with your configuration!${NC}"
        fi
    else
        echo "       .env file already exists"
    fi
}

# Function to create required directories
create_directories() {
    echo "[7/7] Creating required directories..."

    mkdir -p "server/uploads/avatars"
    mkdir -p "server/data"

    echo -e "       ${GREEN}Created required directories${NC}"
}

# Function to print verification and next steps
print_summary() {
    echo ""
    echo "  ======================================"
    echo "   Setup Complete!"
    echo "  ======================================"
    echo ""
    echo "  Verification:"

    if [ -d "node_modules" ]; then
        echo -e "    ${GREEN}[OK]${NC} node_modules exists"
    else
        echo -e "    ${RED}[FAIL]${NC} node_modules missing!"
    fi

    if [ -f ".env" ]; then
        echo -e "    ${GREEN}[OK]${NC} .env file exists"
    else
        echo -e "    ${RED}[FAIL]${NC} .env missing!"
    fi

    echo ""
    echo "  Next steps:"
    echo "  1. Edit .env file with your MongoDB connection string"
    echo "  2. Make sure MongoDB is running (or use Docker)"
    echo "  3. Run './scripts/start-server.sh' to start the server"
    echo "  4. Or use './scripts/docker-start.sh' to run with Docker"
    echo ""
}

# Main execution
check_root
install_system_deps
install_nodejs
check_npm
install_server_deps
install_electron_deps
setup_env
create_directories
print_summary
