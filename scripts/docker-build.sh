#!/bin/bash
# ============================================
# Emberlan - Docker Build Script
# ============================================
# Builds all Docker containers
# Requires Docker and Docker Compose
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "  ======================================"
echo "   Emberlan Docker Build"
echo "  ======================================"
echo ""

# Get the project root directory (parent of scripts folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERROR] Docker is not installed or not running!${NC}"
    echo "Please install Docker: https://docs.docker.com/engine/install/debian/"
    exit 1
fi

echo "Found: $(docker --version)"

# Check for docker-compose (try both docker-compose and docker compose)
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    echo -e "${RED}[ERROR] docker-compose is not available!${NC}"
    echo "Please install Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "Found: $($COMPOSE_CMD version)"

echo ""
echo "Building Docker containers..."
echo "This may take several minutes on first run..."
echo ""

# Build containers
$COMPOSE_CMD build

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}[ERROR] Docker build failed!${NC}"
    exit 1
fi

echo ""
echo "  ======================================"
echo -e "   ${GREEN}Docker Build Complete!${NC}"
echo "  ======================================"
echo ""
echo "  Run './scripts/docker-start.sh' to start the containers"
echo ""
