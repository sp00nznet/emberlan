#!/bin/bash
# ============================================
# Emberlan - Docker Start Script
# ============================================
# Starts all Docker containers
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "  ======================================"
echo "   Emberlan Docker Start"
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

# Check if containers need to be built
if ! $COMPOSE_CMD images 2>/dev/null | grep -qi "emberlan"; then
    echo "Containers not built yet. Building now..."
    $COMPOSE_CMD build
fi

echo "Starting Emberlan containers..."
echo ""

# Start containers in detached mode
$COMPOSE_CMD up -d

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}[ERROR] Failed to start containers!${NC}"
    exit 1
fi

echo ""
echo "  ======================================"
echo -e "   ${GREEN}Containers Started Successfully!${NC}"
echo "  ======================================"
echo ""
echo "  Services:"
echo "    - Server:   http://localhost:3001"
echo "    - MongoDB:  localhost:27017"
echo ""
echo "  Default admin credentials:"
echo "    Username: admin"
echo "    Password: admin123"
echo ""
echo "  View logs: $COMPOSE_CMD logs -f"
echo "  Stop:      ./scripts/docker-stop.sh"
echo ""
