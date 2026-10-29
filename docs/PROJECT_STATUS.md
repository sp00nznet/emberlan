# Emberlan Project Status

```
███████╗███████╗██╗      █████╗ ███╗   ██╗███████╗
██╔════╝╚════██║██║     ██╔══██╗████╗  ██║██╔════╝
█████╗      ██╔╝██║     ███████║██╔██╗ ██║███████╗
██╔══╝     ██╔╝ ██║     ██╔══██║██║╚██╗██║╚════██║
██║        ██║  ███████╗██║  ██║██║ ╚████║███████║
╚═╝        ╚═╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝
```

**Last Updated:** January 2026
**Version:** 1.0.0

---

## Overview

Emberlan is a self-hosted gaming community platform with multiple client options and a comprehensive server backend. This document provides a complete overview of the project state, features, and client capabilities.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Emberlan Architecture                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   CLIENTS                          SERVER                                │
│   ┌──────────────────┐            ┌──────────────────────────────────┐  │
│   │  Desktop Client  │            │  Node.js / Express / Socket.IO   │  │
│   │  (Electron)      │──────┐     ├──────────────────────────────────┤  │
│   │  Full Features   │      │     │  • Authentication (JWT)          │  │
│   └──────────────────┘      │     │  • Real-time messaging           │  │
│                             │     │  • WebRTC signaling              │  │
│   ┌──────────────────┐      │     │  • 11 Bot services               │  │
│   │   Web Client     │──────┼────▶│  • Game Together (controllers)   │  │
│   │  (Containerized) │      │     │  • File sharing                  │  │
│   │  Full Features   │      │     │  • Federation                    │  │
│   └──────────────────┘      │     │  • Groups & permissions          │  │
│                             │     └──────────────────────────────────┘  │
│   ┌──────────────────┐      │                    │                      │
│   │   Mobile App     │──────┘                    │                      │
│   │  (Capacitor)     │                           ▼                      │
│   │  Framework Ready │            ┌──────────────────────────────────┐  │
│   └──────────────────┘            │          MongoDB 7               │  │
│                                   │  • Users, channels, messages     │  │
│                                   │  • Federation data               │  │
│                                   │  • Activity tracking             │  │
│                                   └──────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Clients

### 1. Desktop Client (Electron)

**Location:** `electron-client/`
**Status:** Production Ready
**Build Output:** Windows (.exe installer + portable), Linux (AppImage + .deb), macOS (DMG)

The desktop client is the most feature-complete client with native OS integration.

**Unique Desktop Features:**
- System tray integration (minimize while gaming)
- Native push-to-talk with global hotkeys
- Native file picker for folder sharing
- Multi-server connections
- Low resource usage for gaming

### 2. Web Client (Containerized)

**Location:** `client/`
**Status:** Production Ready
**Deployment:** Docker container with Nginx

The containerized web client runs in browsers and is served via Docker/Nginx.

**Deployment:**
```bash
docker-compose --profile with-webclient up -d
```

### 3. Standalone HTML Client (DEPRECATED)

**Location:** `harmony-discord-clone.html`
**Status:** Demo Only - To Be Upgraded

Single-file HTML client originally for quick testing. Being upgraded to full-featured web client.

### 4. Mobile App (Capacitor)

**Location:** `mobile/`
**Status:** Framework Ready (Not Implemented)

iOS/Android support via Capacitor. Framework is in place but full implementation pending.

---

## Feature Matrix

### Communication Features

| Feature | Desktop | Web | Notes |
|:--------|:-------:|:---:|:------|
| Text Chat | ✅ | ✅ | Real-time, markdown, reactions |
| Voice Chat | ✅ | ✅ | WebRTC, echo/noise cancellation |
| Video Chat | ✅ | ✅ | HD 720p/1080p |
| Screen Share | ✅ | ✅ | Up to 8K@60fps |
| Direct Messages | ✅ | ✅ | Private 1-to-1 |
| Typing Indicators | ✅ | ✅ | Real-time |
| Message Reactions | ✅ | ✅ | Emoji reactions |
| Message Pinning | ✅ | ✅ | Pin important messages |
| Chat Fullscreen | ✅ | ✅ | Focus mode, Escape to exit |

### Screen Share Quality Options

| Quality | Resolution | FPS | Desktop | Web |
|:--------|:-----------|:---:|:-------:|:---:|
| 720p | 1280x720 | 30 | ✅ | ✅ |
| 1080p | 1920x1080 | 30 | ✅ | ✅ |
| 1080p60 | 1920x1080 | 60 | ✅ | ✅ |
| 1440p | 2560x1440 | 30 | ✅ | ✅ |
| 1440p60 | 2560x1440 | 60 | ✅ | ✅ |
| 4K | 3840x2160 | 30 | ✅ | ✅ |
| 4K60 | 3840x2160 | 60 | ✅ | ✅ |
| 8K | 7680x4320 | 30 | ✅ | ✅ |

### Bot Features

| Bot | Desktop | Web | Description |
|:----|:-------:|:---:|:------------|
| YouTube | ✅ | ✅ | Stream YouTube videos to voice |
| Plex | ✅ | ✅ | Stream from Plex Media Server |
| Emby | ✅ | ✅ | Stream from Emby server |
| Jellyfin | ✅ | ✅ | Stream from Jellyfin — replaces the old Discord/Kodi "projectionist" movie-night VM (see BOTS.md) |
| IPTV | ✅ | ✅ | Live TV with EPG guide |
| Twitch | ✅ | ✅ | Watch Twitch streams together |
| Chrome | ✅ | ✅ | Shared browser sessions |
| Game Together | ✅ | ✅ | Virtual controllers for local co-op |

### Gaming Features

| Feature | Desktop | Web | Notes |
|:--------|:-------:|:---:|:------|
| Game Together | ✅ | ✅ | Virtual controller emulation |
| Gamepad Support | ✅ | ✅ | Web Gamepad API works in browsers |
| Steam Integration | ✅ | ✅ | OAuth profile linking |
| Activity Tracking | ✅ | ✅ | "Now playing" status |
| Game Matching | ✅ | ✅ | Find common games with friends |

### Administration Features

| Feature | Desktop | Web | Notes |
|:--------|:-------:|:---:|:------|
| User Management | ✅ | ✅ | Roles, bans, permissions |
| Channel Management | ✅ | ✅ | Create/edit/delete channels |
| Bot Configuration | ✅ | ✅ | Enable/disable per channel |
| Groups & Permissions | ✅ | ✅ | Role-based access control |
| Server Branding | ✅ | ✅ | Custom icon and name |
| Invite System | ✅ | ✅ | Email invites with limits |
| Federation | ✅ | ✅ | Multi-server networking |

### Security Features

| Feature | Desktop | Web | Notes |
|:--------|:-------:|:---:|:------|
| Two-Factor Auth | ✅ | ✅ | TOTP with backup codes |
| Social Linking | ✅ | ✅ | Steam, Xbox, PSN, etc. |
| JWT Authentication | ✅ | ✅ | Token-based sessions |

### Desktop-Only Features

| Feature | Notes |
|:--------|:------|
| System Tray | Minimize while gaming |
| Global Push-to-Talk | Works even when minimized |
| Native File Picker | OS dialog for folder sharing |
| Multi-Server | Connect to multiple Emberlan servers |
| Reduced Resource Usage | Optimized for gaming |

---

## Server Components

### Core Services

| Service | Status | Description |
|:--------|:------:|:------------|
| Express HTTP | ✅ | REST API server |
| Socket.IO | ✅ | Real-time WebSocket |
| MongoDB | ✅ | Document database |
| JWT Auth | ✅ | Token authentication |
| File Uploads | ✅ | Avatars, attachments |

### Bot Services (8 Total)

| Service | Status | File |
|:--------|:------:|:-----|
| YouTube Bot | ✅ | `server/services/youtubeBotService.js` |
| Plex Bot | ✅ | `server/services/plexBotService.js` |
| Emby Bot | ✅ | `server/services/embyBotService.js` |
| Jellyfin Bot | ✅ | `server/services/jellyfinBotService.js` |
| IPTV Bot | ✅ | `server/services/iptvBotService.js` |
| Twitch Bot | ✅ | `server/services/twitchBotService.js` |
| Chrome Bot | ✅ | `server/services/chromeBotService.js` |
| Game Together | ✅ | `server/services/gameTogetherService.js` |

### Server-Side Features

| Feature | Status | Description |
|:--------|:------:|:------------|
| Federation | ✅ | Multi-server networking |
| Game Together | ✅ | Virtual controller backend |
| File Sharing | ✅ | P2P folder sharing coordination |
| Groups | ✅ | Role-based access control |
| 2FA | ✅ | TOTP authentication |

---

## Federation

Federation is a **server-side feature** that allows multiple Emberlan servers to connect and share channels/messages.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Federation Flow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   CLIENT                         SERVER A         SERVER B       │
│   ┌──────────┐                 ┌──────────┐     ┌──────────┐    │
│   │ Admin    │──"Connect to"──▶│Federation│────▶│Federation│    │
│   │ clicks   │   Server B      │ API      │◀────│ API      │    │
│   │ button   │                 └──────────┘     └──────────┘    │
│   └──────────┘                      │                │          │
│                                     ▼                ▼          │
│                              Channel sync, message relay,       │
│                              presence sharing - all automatic   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Federation Architecture

- **Server A** sends federation request to **Server B**
- Admins on Server B approve/reject the request
- Once connected, channels sync automatically
- Messages relay in real-time between federated servers
- HMAC-SHA256 authentication secures server-to-server communication

### Client Role in Federation

Clients provide UI for admins to:
1. View federation status
2. Initiate federation requests
3. Approve/reject incoming requests
4. Monitor connected servers
5. Disconnect from federated servers

**The actual federation logic runs entirely on the server.**

---

## Game Together

Universal controller emulation for playing ANY local multiplayer game remotely.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     Game Together Flow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  HOST (Player 1)              REMOTE PLAYERS (P2-P4)            │
│  ┌──────────────┐            ┌──────────────┐                   │
│  │ Physical     │            │ Physical     │                   │
│  │ Controller   │            │ Controller   │                   │
│  └──────┬───────┘            └──────┬───────┘                   │
│         │                           │                            │
│         ▼                           ▼                            │
│  ┌──────────────┐            ┌──────────────┐                   │
│  │ Any Game     │            │ Web Gamepad  │                   │
│  │ (local PC)   │            │ API (browser)│                   │
│  └──────────────┘            └──────┬───────┘                   │
│                                     │ 60Hz input                 │
│                                     ▼                            │
│                              ┌──────────────┐                   │
│                              │  Emberlan      │                   │
│                              │  Server      │                   │
│                              └──────┬───────┘                   │
│                                     │ WebSocket                  │
│                                     ▼                            │
│                              ┌──────────────┐                   │
│                              │ HOST PC:     │                   │
│                              │ ViGEmBus     │                   │
│                              │ (virtual     │                   │
│                              │ controller)  │                   │
│                              └──────────────┘                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Platform Requirements

| Platform | Driver | Notes |
|:---------|:-------|:------|
| Windows | ViGEmBus | Creates virtual Xbox 360 controllers |
| Linux | uinput | Kernel module, requires permissions |
| macOS | Not supported | Use Parsec as alternative |

### Controller Mapping

Standard Xbox 360 layout:
- Buttons: A, B, X, Y, LB, RB, Start, Back, Guide
- Sticks: Left/Right with click (L3/R3)
- Triggers: LT, RT (analog)
- D-Pad: Up, Down, Left, Right

### Web Gamepad API

The Web Gamepad API (`navigator.getGamepads()`) is a standard browser API that works in:
- Chrome
- Firefox
- Edge
- Safari (partial)

**Yes, Xbox controllers work through the web client!**

---

## Docker Configuration

### Available Services

```yaml
services:
  mongodb:     # Document database
  server:      # Emberlan backend (port 3001)
  webclient:   # Web client via Nginx (port 3000) - optional
  nginx:       # Reverse proxy with SSL (ports 80, 443) - optional
```

### Quick Start

```bash
# Server + MongoDB only
docker-compose up -d

# With web client
docker-compose --profile with-webclient up -d

# With HTTPS reverse proxy
docker-compose --profile with-nginx up -d

# Everything
docker-compose --profile with-webclient --profile with-nginx up -d
```

### Environment Variables

| Variable | Default | Description |
|:---------|:--------|:------------|
| `PORT` | 3001 | Server port |
| `MONGODB_URI` | mongodb://... | Database connection |
| `JWT_SECRET` | (random) | Token signing key |
| `CORS_ORIGINS` | * | Allowed origins |
| `STEAM_API_KEY` | (optional) | For Steam integration |

---

## File Structure

```
emberlan/
├── server/                    # Node.js backend
│   ├── index.js               # Entry point
│   ├── config/                # Database, federation config
│   ├── controllers/           # API controllers (20+)
│   ├── models/                # MongoDB schemas (9)
│   ├── services/              # Bot services (11)
│   ├── socket/                # WebSocket handlers
│   ├── routes/                # Express routes
│   ├── middleware/            # Auth middleware
│   └── uploads/               # File storage
│
├── client/                    # Containerized web client
│   └── public/                # Static files (app.js, styles)
│
├── electron-client/           # Desktop client
│   ├── main.js                # Electron main process
│   ├── preload.js             # Preload script
│   ├── renderer/              # UI (app.js, styles.css)
│   └── dist/                  # Build output
│
├── mobile/                    # Mobile app (Capacitor)
├── docker/                    # Dockerfiles, nginx config
├── docs/                      # Documentation
└── scripts/                   # Build & deployment scripts
```

---

## API Summary

### REST Endpoints (Main Categories)

| Category | Base Path | Description |
|:---------|:----------|:------------|
| Auth | `/api/auth/` | Login, register, profile |
| Users | `/api/users/` | User management |
| Channels | `/api/channels/` | Channel CRUD, messages |
| Admin | `/api/admin/` | Server administration |
| Federation | `/api/federation/` | Multi-server networking |
| Groups | `/api/groups/` | Permissions management |
| Bots | `/api/*-bot/` | Bot-specific endpoints |

### WebSocket Events (Main Categories)

| Category | Events | Description |
|:---------|:-------|:------------|
| Connection | `connect`, `disconnect` | Session management |
| Voice | `voice:join`, `voice:leave`, `voice:mute` | Voice channel |
| Messages | `message:send`, `message:edit` | Real-time chat |
| Game Together | `gameTogether:*` | Controller sessions |
| Federation | `federation:*` | Server-to-server |

---

## Known Issues / TODO

### Server Cleanup Needed

| Item | Status | Notes |
|:-----|:------:|:------|
| File Sharing | Full | P2P file sharing is active |

### Future Improvements

- [x] Add federation UI to web client
- [x] End-to-end encrypted direct messages
- [x] Channel management (create, rename, set topic)
- [ ] Mobile app full implementation
- [ ] OAuth providers (Discord, Google)
- [ ] Custom emojis
- [ ] Audit logs
- [ ] Webhooks/integrations

---

## Version History

### v1.0.0 (Current)

**Features Added:**
- 4K and 8K screen sharing (up to 8K@30fps, 4K@60fps)
- Game Together universal controller emulation
- Chat fullscreen mode
- Comprehensive bot management UI
- New Emberlan logo and branding
- End-to-end encrypted direct messages (admins cannot read)
- Channel management (create, rename, set topics)
- DM users visible in sidebar

**Streamlined Bot Selection:**
- Removed Spotify, Image Search, Activity Stats, RPG bots
- Focus on 8 core bots: YouTube, Plex, Emby, Jellyfin, IPTV, Twitch, Chrome, Game Together

---

## Quick Reference

### Default Credentials
```
Username: admin
Password: admin123
```
**Change immediately after first login!**

### Ports
| Service | Port |
|:--------|:-----|
| Server | 3001 |
| Web Client | 3000 |
| HTTPS Proxy | 443 |

### Build Commands
```bash
# Docker
docker-compose up -d

# Desktop client (Windows)
powershell -ExecutionPolicy Bypass -File scripts\build-electron.ps1

# Desktop client (Linux)
./scripts/build-electron.sh
```
