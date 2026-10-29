# Installation Guide

Complete guide to setting up Emberlan on your server or local machine.

---

## Table of Contents

- [Requirements](#requirements)
- [Quick Install (Docker)](#quick-install-docker)
- [Manual Installation](#manual-installation)
- [Configuration](#configuration)
- [SSL/HTTPS Setup](#sslhttps-setup)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

---

## Requirements

### Minimum System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4+ cores |
| RAM | 2 GB | 4+ GB |
| Storage | 10 GB | 50+ GB |
| Network | 10 Mbps | 100+ Mbps |

### Software Requirements

**For Docker Installation:**
- Docker 20.10+
- Docker Compose 2.0+

**For Manual Installation:**
- Node.js 18+ (LTS recommended)
- npm 9+ or yarn
- MongoDB 6.0+
- Git

---

## Quick Install (Docker)

The fastest way to get Emberlan running.

### Step 1: Clone the Repository

```bash
git clone https://github.com/yourusername/emberlan.git
cd emberlan
```

### Step 2: Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit with your settings
nano .env  # or use your preferred editor
```

Key settings to change:
```env
# Generate a secure JWT secret (required!)
JWT_SECRET=your-super-secret-key-change-this

# Server URL (change for production)
SERVER_URL=http://localhost:3001
CLIENT_URL=http://localhost:3001

# MongoDB (Docker uses internal networking)
MONGODB_URI=mongodb://mongodb:27017/f7lans
```

### Step 3: Start the Containers

**Windows:**
```batch
scripts\quickstart.bat
```

**Linux/Mac:**
```bash
docker-compose up -d
```

### Step 4: Verify Installation

```bash
# Check container status
docker-compose ps

# View logs
docker-compose logs -f

# Test the API
curl http://localhost:3001/health
```

### Step 5: Access Emberlan

Open your browser to `http://localhost:3001`

**Default Admin Credentials:**
- Username: `admin`
- Password: `admin123`

> **Security Warning:** Change the admin password immediately after first login!

---

## Manual Installation

For development or when Docker isn't available.

### Step 1: Install Node.js

**Windows:**
Download from [nodejs.org](https://nodejs.org/) or use:
```batch
scripts\setup.bat
```

**Linux (Ubuntu/Debian):**
```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Mac:**
```bash
brew install node
```

### Step 2: Install MongoDB

**Windows:**
```batch
scripts\install-mongodb.bat
```
Or download from [mongodb.com](https://www.mongodb.com/try/download/community)

**Linux (Ubuntu/Debian):**
```bash
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org
sudo systemctl start mongod
```

**Mac:**
```bash
brew tap mongodb/brew
brew install mongodb-community@6.0
brew services start mongodb-community@6.0
```

### Step 3: Clone and Install Dependencies

```bash
git clone https://github.com/yourusername/emberlan.git
cd emberlan

# Install server dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# Install electron client dependencies (optional)
cd electron-client && npm install && cd ..
```

### Step 4: Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=3001
NODE_ENV=development
JWT_SECRET=your-secret-key-here
MONGODB_URI=mongodb://localhost:27017/f7lans
SERVER_URL=http://localhost:3001
CLIENT_URL=http://localhost:3000
```

### Step 5: Start the Server

**Development (with hot reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

### Step 6: Start the Web Client (Development)

In a separate terminal:
```bash
cd client
npm start
```

---

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment mode | `development` |
| `JWT_SECRET` | Secret for JWT tokens | (required) |
| `JWT_EXPIRES_IN` | Token expiration | `7d` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/f7lans` |
| `SERVER_URL` | Public server URL | `http://localhost:3001` |
| `CLIENT_URL` | Public client URL | `http://localhost:3000` |
| `ENABLE_HTTPS` | Enable HTTPS | `false` |
| `SMTP_HOST` | Email server host | (optional) |
| `SMTP_PORT` | Email server port | `587` |
| `SMTP_USER` | Email username | (optional) |
| `SMTP_PASS` | Email password | (optional) |

### Federation Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `FEDERATION_ENABLED` | Enable server federation | `true` |
| `FEDERATION_SERVER_NAME` | Display name for this server | `Emberlan Server` |
| `FEDERATION_MAX_SERVERS` | Maximum federated servers | `10` |
| `FEDERATION_AUTO_ACCEPT` | Auto-accept known servers | `false` |

---

## SSL/HTTPS Setup

### Option 1: Self-Signed Certificate (Development)

**Windows:**
```batch
scripts\generate-ssl.bat
```

**Linux/Mac:**
```bash
mkdir -p ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout ssl/key.pem \
  -out ssl/cert.pem \
  -subj "/CN=localhost"
```

Then set in `.env`:
```env
ENABLE_HTTPS=true
```

### Option 2: Let's Encrypt (Production)

Using certbot:
```bash
sudo apt install certbot
sudo certbot certonly --standalone -d your-domain.com
```

Copy certificates:
```bash
cp /etc/letsencrypt/live/your-domain.com/privkey.pem ssl/key.pem
cp /etc/letsencrypt/live/your-domain.com/fullchain.pem ssl/cert.pem
```

### Option 3: Reverse Proxy (Recommended for Production)

Use nginx or Caddy as a reverse proxy. Example nginx config:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Production Deployment

### Using Docker (Recommended)

1. **Configure for production:**
```env
NODE_ENV=production
SERVER_URL=https://your-domain.com
CLIENT_URL=https://your-domain.com
```

2. **Build and start:**
```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

3. **Set up automatic restarts:**
```bash
docker update --restart=always emberlan-server emberlan-mongodb
```

### Using PM2 (Manual Installation)

1. **Install PM2:**
```bash
npm install -g pm2
```

2. **Create ecosystem file:**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'emberlan',
    script: 'server/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
```

3. **Start with PM2:**
```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup
```

### Database Backups

**Create backup:**
```bash
# Docker
docker exec emberlan-mongodb mongodump --db f7lans --out /backup

# Local
mongodump --db f7lans --out ./backups/$(date +%Y%m%d)
```

**Windows (automated):**
```batch
scripts\backup-database.bat
```

---

## Troubleshooting

### Common Issues

**Port already in use:**
```bash
# Find process using port
lsof -i :3001  # Linux/Mac
netstat -ano | findstr :3001  # Windows

# Kill process or change PORT in .env
```

**MongoDB connection failed:**
```bash
# Check if MongoDB is running
systemctl status mongod  # Linux
brew services list  # Mac

# Check connection string in .env
```

**Docker containers won't start:**
```bash
# Check logs
docker-compose logs

# Reset and rebuild
docker-compose down -v
docker-compose up -d --build
```

**WebSocket connection issues:**
- Ensure your firewall allows WebSocket connections
- Check that reverse proxy is configured for WebSocket upgrade
- Verify `SERVER_URL` matches your actual server address

### Getting Help

- Check the [GitHub Issues](https://github.com/yourusername/emberlan/issues)
- Join our community discussions
- Read the [API Documentation](API.md)

---

## Next Steps

- [Configure Federation](FEDERATION.md) to connect multiple servers
- [Read the API docs](API.md) for integrations
- [Development Guide](DEVELOPMENT.md) for contributing
