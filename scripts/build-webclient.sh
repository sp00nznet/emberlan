#!/bin/bash
# ============================================
# Emberlan - Web Client Docker Build Script
# ============================================
# One-click build for the containerized web client
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

IMAGE_NAME="emberlan-webclient"
IMAGE_TAG="${1:-latest}"

echo ""
echo "  ======================================"
echo "   Emberlan Web Client Docker Build"
echo "  ======================================"
echo ""

# Get the project root directory (parent of scripts folder)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo "[INFO] Project root: $PWD"
echo "[INFO] Building image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}[ERROR] Docker is not installed or not running!${NC}"
    echo "Please install Docker: https://docs.docker.com/engine/install/"
    exit 1
fi

echo "Found: $(docker --version)"
echo ""

# Verify required files exist
echo "Checking required files..."

if [ ! -f "docker/Dockerfile.webclient" ]; then
    echo -e "${RED}[ERROR] docker/Dockerfile.webclient not found!${NC}"
    exit 1
fi
echo -e "  ${GREEN}[OK]${NC} Dockerfile.webclient"

if [ ! -f "docker/nginx-webclient.conf.template" ]; then
    echo -e "${RED}[ERROR] docker/nginx-webclient.conf.template not found!${NC}"
    exit 1
fi
echo -e "  ${GREEN}[OK]${NC} nginx-webclient.conf.template"

if [ ! -f "docker/webclient-entrypoint.sh" ]; then
    echo -e "${RED}[ERROR] docker/webclient-entrypoint.sh not found!${NC}"
    exit 1
fi
echo -e "  ${GREEN}[OK]${NC} webclient-entrypoint.sh"

if [ ! -f "client/public/index.html" ]; then
    echo -e "${RED}[ERROR] client/public/index.html not found!${NC}"
    exit 1
fi
echo -e "  ${GREEN}[OK]${NC} client/public/index.html"

echo ""
echo "Building Docker image..."
echo ""

# Build the image
docker build \
    -t "${IMAGE_NAME}:${IMAGE_TAG}" \
    -f docker/Dockerfile.webclient \
    .

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}[ERROR] Docker build failed!${NC}"
    exit 1
fi

# Get image size
IMAGE_SIZE=$(docker images "${IMAGE_NAME}:${IMAGE_TAG}" --format "{{.Size}}")

echo ""
echo "  ======================================"
echo -e "   ${GREEN}Build Complete!${NC}"
echo "  ======================================"
echo ""
echo "  Image: ${IMAGE_NAME}:${IMAGE_TAG}"
echo "  Size:  ${IMAGE_SIZE}"
echo ""
echo -e "  ${CYAN}Run standalone:${NC}"
echo "    docker run -d -p 3000:80 \\"
echo "      -e API_HOST=host.docker.internal \\"
echo "      -e API_PORT=3001 \\"
echo "      --name emberlan-webclient \\"
echo "      ${IMAGE_NAME}:${IMAGE_TAG}"
echo ""
echo -e "  ${CYAN}Run with docker-compose (recommended):${NC}"
echo "    docker-compose --profile with-webclient up -d"
echo ""
