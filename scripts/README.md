# Emberlan Windows Build Scripts

This directory contains Windows batch scripts for building, running, and managing Emberlan.

## Quick Start

**Fastest way to get started (requires Docker):**
```batch
quickstart.bat
```

## Script Reference

### Setup & Installation

| Script | Description |
|--------|-------------|
| `setup.bat` | Install all dependencies (Node.js required) |
| `install-mongodb.bat` | Help with MongoDB installation |
| `generate-ssl.bat` | Generate self-signed SSL certificates |

### Server

| Script | Description |
|--------|-------------|
| `start-server.bat` | Start the server (production mode) |
| `start-server-dev.bat` | Start server with auto-reload (development) |

### Electron Desktop Client

| Script | Description |
|--------|-------------|
| `run-electron-dev.bat` | Run Electron client without building |
| `build-electron.bat` | Build Windows installer and portable exe |
| `build-electron-all.bat` | Build for both x64 and x86 architectures |

### Docker

| Script | Description |
|--------|-------------|
| `quickstart.bat` | One-click Docker setup and start |
| `docker-build.bat` | Build Docker containers |
| `docker-start.bat` | Start Docker containers |
| `docker-stop.bat` | Stop Docker containers |
| `docker-logs.bat` | View Docker container logs |

### Maintenance

| Script | Description |
|--------|-------------|
| `clean.bat` | Remove all build artifacts and node_modules |
| `rebuild-all.bat` | Clean and rebuild everything |
| `backup-database.bat` | Create MongoDB backup |
| `restore-database.bat` | Restore MongoDB from backup |

### Administration

| Script | Description |
|--------|-------------|
| `create-admin.bat` | Help with creating admin users |

## Prerequisites

### For Local Development
- Node.js 18+ (https://nodejs.org/)
- MongoDB 6+ (https://www.mongodb.com/try/download/community)
  - Or use MongoDB Atlas cloud

### For Docker Deployment
- Docker Desktop (https://www.docker.com/products/docker-desktop)

### For Electron Builds
- Node.js 18+
- Windows Build Tools (automatically installed by npm)

## Typical Workflows

### Development (Local)
```batch
setup.bat
start-server-dev.bat
```

### Development (Docker)
```batch
quickstart.bat
```

### Build Desktop Client
```batch
setup.bat
build-electron.bat
```

### Production Deployment
```batch
docker-build.bat
docker-start.bat
```

## Environment Configuration

Copy `.env.example` to `.env` and configure:

```env
# Server
PORT=3001
NODE_ENV=production

# Database
MONGODB_URI=mongodb://localhost:27017/f7lans

# Security
JWT_SECRET=change-this-secret-key

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Steam API (optional)
STEAM_API_KEY=your-steam-api-key
```

## Troubleshooting

### "Node.js not found"
Install Node.js from https://nodejs.org/

### "Docker not running"
Start Docker Desktop and wait for it to fully load

### "MongoDB connection failed"
- If using Docker: `docker-start.bat`
- If local: `install-mongodb.bat`

### "Build failed"
1. Run `clean.bat`
2. Run `setup.bat`
3. Try build again

### Port 3001 already in use
Change the PORT in `.env` file or stop the existing process
