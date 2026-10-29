#!/bin/bash
# ============================================
# Emberlan - Docker Stop Script
# ============================================
# Stops all Docker containers
# ============================================

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo ""
echo "  ======================================"
echo "   Emberlan Docker Stop"
echo "  ======================================"
echo ""

# Get the project root directory (parent of scripts folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# Check for docker-compose (try both docker-compose and docker compose)
if command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
elif docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    echo -e "${RED}[ERROR] docker-compose is not available!${NC}"
    exit 1
fi

echo "Stopping Emberlan containers..."

$COMPOSE_CMD down

echo ""
echo -e "  ${GREEN}Containers stopped.${NC}"
echo ""
