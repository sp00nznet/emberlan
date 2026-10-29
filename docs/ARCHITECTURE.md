# Architecture Overview

Deep dive into Emberlan system design, components, and data flow.

---

## Table of Contents

- [System Overview](#system-overview)
- [Component Architecture](#component-architecture)
- [Data Models](#data-models)
- [Real-Time Communication](#real-time-communication)
- [Authentication Flow](#authentication-flow)
- [WebRTC Implementation](#webrtc-implementation)
- [Federation Architecture](#federation-architecture)
- [Deployment Architecture](#deployment-architecture)

---

## System Overview

Emberlan is a full-stack real-time communication platform with the following high-level architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │
│  │  Web Client  │    │   Electron   │    │    Mobile    │              │
│  │   (React)    │    │   (Win32)    │    │   (Future)   │              │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │
│         │                   │                   │                       │
│         └───────────────────┼───────────────────┘                       │
│                             │                                           │
│                    HTTP/WebSocket/WebRTC                                │
│                             │                                           │
└─────────────────────────────┼───────────────────────────────────────────┘
                              │
┌─────────────────────────────┼───────────────────────────────────────────┐
│                             ▼                        SERVER              │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      Express.js Server                            │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │  REST API   │  │  Socket.IO  │  │  WebRTC     │              │  │
│  │  │  Handlers   │  │  Server     │  │  Signaling  │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                              │                                          │
│  ┌───────────────────────────┼────────────────────────────────────┐    │
│  │                    Service Layer                                │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │    │
│  │  │    Auth     │  │   Channel   │  │ Federation  │            │    │
│  │  │   Service   │  │   Service   │  │   Service   │            │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘            │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                              │                                          │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────────┐
│                              ▼                      DATA LAYER          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        MongoDB                                    │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │  │
│  │  │  Users  │ │Channels │ │Messages │ │   DMs   │ │Federation│   │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### Backend Components

```
server/
├── index.js              # Application entry point
├── config/
│   ├── database.js       # MongoDB connection
│   └── federation.js     # Federation configuration
├── middleware/
│   ├── auth.js           # JWT authentication middleware
│   └── accessControl.js  # Group-based permission middleware
├── models/
│   ├── User.js           # User schema
│   ├── Channel.js        # Channel schema
│   ├── Message.js        # Message schema
│   ├── DirectMessage.js  # DM schema
│   ├── Invite.js         # Invite schema
│   └── Federation.js     # Federation schemas
├── controllers/
│   ├── authController.js         # Auth endpoints
│   ├── userController.js         # User management
│   ├── channelController.js      # Channel operations
│   ├── adminController.js        # Admin functions
│   ├── federationController.js   # Federation API
│   ├── groupController.js        # Group management
│   ├── fileShareController.js    # File sharing API
│   ├── youtubeBotController.js   # YouTube bot API
│   ├── plexBotController.js      # Plex bot API
│   ├── embyBotController.js      # Emby bot API
│   ├── jellyfinBotController.js  # Jellyfin bot API
│   ├── chromeBotController.js    # Chrome bot API
│   ├── iptvBotController.js      # IPTV bot API
│   └── twitchBotController.js    # Twitch bot API
├── services/
│   ├── federationService.js      # Federation logic
│   ├── groupService.js           # Group & permissions
│   ├── fileShareService.js       # P2P file sharing
│   ├── youtubeBotService.js      # YouTube streaming
│   ├── plexBotService.js         # Plex integration
│   ├── embyBotService.js         # Emby integration
│   ├── jellyfinBotService.js     # Jellyfin integration
│   ├── chromeBotService.js       # Shared browser sessions
│   ├── iptvBotService.js         # IPTV with EPG
│   ├── twitchBotService.js       # Twitch streaming
│   └── gameTogetherService.js    # Virtual controller emulation
├── socket/
│   └── socketHandler.js          # Real-time event handling
├── data/
│   └── groups.json               # Group & permission storage
└── routes/
    └── api.js                    # Route definitions
```

### Frontend Components (Web Client)

```
client/src/
├── App.js                # Main application component
├── index.js              # React entry point
├── components/
│   ├── Auth/
│   │   ├── Login.js
│   │   └── Register.js
│   ├── Chat/
│   │   ├── ChatArea.js
│   │   ├── MessageList.js
│   │   └── MessageInput.js
│   ├── Channels/
│   │   ├── ChannelList.js
│   │   └── ChannelItem.js
│   ├── Voice/
│   │   ├── VoiceChannel.js
│   │   └── VoiceControls.js
│   ├── Video/
│   │   ├── VideoGrid.js
│   │   └── ScreenShare.js
│   ├── Users/
│   │   ├── UserList.js
│   │   ├── UserProfile.js
│   │   └── FriendsList.js
│   └── Admin/
│       ├── AdminPanel.js
│       ├── UserManagement.js
│       └── FederationPanel.js
├── contexts/
│   ├── AuthContext.js
│   ├── SocketContext.js
│   └── ThemeContext.js
├── hooks/
│   ├── useAuth.js
│   ├── useSocket.js
│   └── useWebRTC.js
└── services/
    ├── api.js
    └── socket.js
```

### Desktop Client (Electron)

```
electron-client/
├── main.js               # Electron main process
├── preload.js            # Preload scripts
├── renderer/
│   ├── index.html        # Main window
│   ├── app.js            # Renderer process
│   ├── styles.css        # Styling
│   └── components/       # UI components
├── services/
│   ├── tray.js           # System tray
│   ├── notifications.js  # Desktop notifications
│   ├── hotkeys.js        # Global hotkeys
│   └── audio.js          # Audio device management
└── assets/
    └── icons/            # Application icons
```

---

## Data Models

### User Model

```javascript
{
  _id: ObjectId,
  username: String,        // Unique login name
  displayName: String,     // Customizable display name
  email: String,           // Unique email
  password: String,        // Hashed with bcrypt
  avatar: String,          // Avatar URL
  role: Enum['user', 'moderator', 'admin', 'superadmin'],
  status: Enum['online', 'away', 'busy', 'offline'],
  steamId: String,         // Steam profile ID
  settings: {
    theme: String,
    notifications: Boolean,
    pushToTalk: Boolean,
    pushToTalkKey: String,
    inputDevice: String,
    outputDevice: String,
    inputVolume: Number,
    outputVolume: Number
  },
  friends: [ObjectId],     // User references
  blocked: [ObjectId],     // Blocked users
  pendingFriends: [ObjectId],
  lastSeen: Date,
  createdAt: Date,
  updatedAt: Date
}
```

### Channel Model

```javascript
{
  _id: ObjectId,
  name: String,
  type: Enum['text', 'voice', 'video', 'announcement'],
  category: String,
  description: String,
  position: Number,
  isPrivate: Boolean,
  allowedRoles: [String],
  createdBy: ObjectId,     // User reference
  pinnedMessages: [ObjectId],

  // Federation fields
  isFederated: Boolean,
  federatedId: String,

  createdAt: Date,
  updatedAt: Date
}
```

### Message Model

```javascript
{
  _id: ObjectId,
  channel: ObjectId,       // Channel reference
  author: ObjectId,        // User reference (null for federated)
  content: String,
  type: Enum['text', 'system', 'federated'],
  attachments: [{
    type: String,
    url: String,
    name: String,
    size: Number
  }],
  mentions: [ObjectId],
  reactions: [{
    emoji: String,
    users: [ObjectId]
  }],
  isPinned: Boolean,
  isEdited: Boolean,
  editedAt: Date,

  // Federation data (for federated messages)
  federatedData: {
    federatedId: String,
    originServer: String,
    author: {
      username: String,
      displayName: String,
      avatar: String,
      serverName: String
    }
  },

  createdAt: Date,
  updatedAt: Date
}
```

### Federation Models

```javascript
// Federated Server
{
  _id: ObjectId,
  serverId: String,        // Unique server identifier
  name: String,
  url: String,             // HTTP endpoint
  wsUrl: String,           // WebSocket endpoint
  sharedSecret: String,    // HMAC secret
  status: Enum['pending', 'active', 'suspended', 'disconnected'],
  isInitiator: Boolean,
  stats: {
    userCount: Number,
    channelCount: Number,
    messageCount: Number
  },
  settings: {
    syncMessages: Boolean,
    syncUsers: Boolean,
    maxMessageAge: Number
  },
  lastHeartbeat: Date,
  connectedAt: Date
}

// Federation Request
{
  _id: ObjectId,
  requestId: String,
  fromServer: {
    serverId: String,
    name: String,
    url: String,
    wsUrl: String
  },
  toServerId: String,
  proposedSecret: String,
  conflictAnalysis: {
    hasConflicts: Boolean,
    conflicts: [...]
  },
  status: Enum['pending', 'approved', 'rejected'],
  reviewedBy: ObjectId,
  reviewedAt: Date
}
```

---

## Real-Time Communication

### Socket.IO Events

```
┌─────────────────────────────────────────────────────────────────┐
│                    Socket.IO Event Flow                          │
└─────────────────────────────────────────────────────────────────┘

CLIENT EVENTS (client → server):
├── connection              # Initial connection with JWT
├── channel:join            # Join a channel room
├── channel:leave           # Leave a channel room
├── message:send            # Send a message
├── message:edit            # Edit a message
├── message:delete          # Delete a message
├── message:reaction        # Add/remove reaction
├── typing:start            # User started typing
├── typing:stop             # User stopped typing
├── voice:join              # Join voice channel
├── voice:leave             # Leave voice channel
├── voice:mute              # Toggle mute
├── voice:deafen            # Toggle deafen
├── webrtc:offer            # WebRTC offer
├── webrtc:answer           # WebRTC answer
├── webrtc:ice-candidate    # ICE candidate
├── screen:start            # Start screen share
├── screen:stop             # Stop screen share
├── dm:send                 # Send direct message
└── status:update           # Update user status

SERVER EVENTS (server → client):
├── message:new             # New message in channel
├── message:updated         # Message was edited
├── message:deleted         # Message was deleted
├── message:reaction        # Reaction added/removed
├── typing:update           # Typing indicator
├── user:online             # User came online
├── user:offline            # User went offline
├── user:status             # User status changed
├── channel:updated         # Channel was modified
├── voice:user-joined       # User joined voice
├── voice:user-left         # User left voice
├── voice:speaking          # User is speaking
├── webrtc:offer            # Incoming WebRTC offer
├── webrtc:answer           # Incoming WebRTC answer
├── webrtc:ice-candidate    # Incoming ICE candidate
├── screen:started          # Someone started sharing
├── screen:stopped          # Someone stopped sharing
├── dm:new                  # New direct message
├── notification            # System notification
└── error                   # Error occurred

FEDERATION EVENTS (server ↔ server):
├── federation:message      # Relayed message
├── federation:user:status  # User status from other server
├── federation:channel:update # Channel sync
├── federation:heartbeat    # Keep-alive ping
└── federation:disconnect   # Disconnection notice
```

### Room Structure

```javascript
// Channel rooms
`channel:${channelId}`     // All users in a text/voice channel

// Voice rooms
`voice:${channelId}`       // Users in voice chat

// Direct message rooms
`dm:${sortedUserIds}`      // Private conversation

// User-specific rooms
`user:${userId}`           // For direct notifications

// Federation rooms
`federation:${serverId}`   // Connected federated server
```

---

## Authentication Flow

### Login Flow

```
┌────────┐                  ┌────────┐                  ┌────────┐
│ Client │                  │ Server │                  │MongoDB │
└───┬────┘                  └───┬────┘                  └───┬────┘
    │                           │                           │
    │  POST /api/auth/login     │                           │
    │  {username, password}     │                           │
    │ ─────────────────────────►│                           │
    │                           │                           │
    │                           │  Find user by username    │
    │                           │ ─────────────────────────►│
    │                           │                           │
    │                           │  User document            │
    │                           │ ◄─────────────────────────│
    │                           │                           │
    │                           │  bcrypt.compare(password) │
    │                           │                           │
    │                           │  Generate JWT token       │
    │                           │                           │
    │  {token, user}            │                           │
    │ ◄─────────────────────────│                           │
    │                           │                           │
    │  Store token in           │                           │
    │  localStorage             │                           │
    │                           │                           │
```

### WebSocket Authentication

```
┌────────┐                  ┌────────┐
│ Client │                  │ Server │
└───┬────┘                  └───┬────┘
    │                           │
    │  Socket.IO connect        │
    │  auth: { token: JWT }     │
    │ ─────────────────────────►│
    │                           │
    │                           │  Verify JWT
    │                           │  Extract userId
    │                           │  Load user from DB
    │                           │
    │  connection established   │
    │ ◄─────────────────────────│
    │                           │
    │  Join user room           │
    │  user:${userId}           │
    │ ◄────────────────────────►│
    │                           │
```

### JWT Token Structure

```javascript
{
  header: {
    alg: "HS256",
    typ: "JWT"
  },
  payload: {
    userId: "ObjectId string",
    username: "string",
    role: "user|moderator|admin|superadmin",
    iat: timestamp,
    exp: timestamp
  },
  signature: "HMAC-SHA256(header.payload, JWT_SECRET)"
}
```

---

## WebRTC Implementation

### Connection Flow

```
┌────────┐     ┌────────┐     ┌────────┐
│ User A │     │ Server │     │ User B │
└───┬────┘     └───┬────┘     └───┬────┘
    │              │              │
    │ Join voice   │              │
    │ ────────────►│              │
    │              │              │
    │              │ Join voice   │
    │              │◄──────────── │
    │              │              │
    │              │ Notify A of  │
    │ user:joined  │ new peer     │
    │◄─────────────│              │
    │              │              │
    │ Create Offer │              │
    │ (SDP)        │              │
    │              │              │
    │ webrtc:offer │              │
    │ ────────────►│ webrtc:offer │
    │              │ ────────────►│
    │              │              │
    │              │              │ Create Answer
    │              │              │ (SDP)
    │              │              │
    │              │webrtc:answer │
    │ webrtc:answer│◄──────────── │
    │◄─────────────│              │
    │              │              │
    │ ICE Candidates exchanged    │
    │◄────────────────────────────►
    │              │              │
    │ P2P Connection Established  │
    │◄════════════════════════════►
    │              │              │
```

### Media Stream Configuration

```javascript
// Audio configuration
const audioConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    sampleRate: 48000,
    channelCount: 1
  }
};

// Video configuration
const videoConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 }
  }
};

// Screen share configuration
const screenConstraints = {
  video: {
    cursor: 'always',
    displaySurface: 'monitor'  // or 'window', 'browser'
  },
  audio: true  // System audio (if supported)
};
```

### ICE Configuration

```javascript
const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Add TURN servers for NAT traversal
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'user',
      credential: 'pass'
    }
  ]
};
```

---

## Federation Architecture

### Server-to-Server Communication

```
┌─────────────────────────────────────────────────────────────────┐
│                    Federation Network                            │
└─────────────────────────────────────────────────────────────────┘

┌──────────────┐                              ┌──────────────┐
│   Server A   │                              │   Server B   │
│              │                              │              │
│ ┌──────────┐ │    REST API (Federation)     │ ┌──────────┐ │
│ │ Express  │◄├─────────────────────────────►┤►│ Express  │ │
│ └──────────┘ │                              │ └──────────┘ │
│              │                              │              │
│ ┌──────────┐ │    WebSocket (Real-time)     │ ┌──────────┐ │
│ │Socket.IO │◄├═════════════════════════════►┤►│Socket.IO │ │
│ │  Client  │ │                              │ │  Server  │ │
│ └──────────┘ │                              │ └──────────┘ │
│              │                              │              │
│ ┌──────────┐ │                              │ ┌──────────┐ │
│ │ MongoDB  │ │                              │ │ MongoDB  │ │
│ └──────────┘ │                              │ └──────────┘ │
└──────────────┘                              └──────────────┘
```

### Authentication Between Servers

```javascript
// Creating auth header
const timestamp = Date.now();
const signature = crypto
  .createHmac('sha256', sharedSecret)
  .update(`${serverId}:${timestamp}`)
  .digest('hex');

const authHeader = `Federation ${serverId}:${timestamp}:${signature}`;

// Verifying auth header
function verifyAuth(header, expectedServerId, sharedSecret) {
  const [type, data] = header.split(' ');
  const [serverId, timestamp, signature] = data.split(':');

  // Check timestamp (within 5 minutes)
  if (Math.abs(Date.now() - parseInt(timestamp)) > 300000) {
    return false;
  }

  // Verify signature
  const expectedSig = crypto
    .createHmac('sha256', sharedSecret)
    .update(`${serverId}:${timestamp}`)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSig)
  );
}
```

---

## Deployment Architecture

### Docker Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                      Docker Host                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  Docker Network: emberlan                  │   │
│  │                                                          │   │
│  │  ┌──────────────┐         ┌──────────────┐             │   │
│  │  │   emberlan     │         │   mongodb    │             │   │
│  │  │   server     │────────►│   container  │             │   │
│  │  │              │         │              │             │   │
│  │  │  Port: 3001  │         │  Port: 27017 │             │   │
│  │  └──────────────┘         └──────────────┘             │   │
│  │         │                        │                      │   │
│  │         │                        │                      │   │
│  │         ▼                        ▼                      │   │
│  │  ┌──────────────┐         ┌──────────────┐             │   │
│  │  │   Volume:    │         │   Volume:    │             │   │
│  │  │   uploads    │         │   mongodb    │             │   │
│  │  └──────────────┘         └──────────────┘             │   │
│  │                                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
          │
          │ Port 3001 exposed
          ▼
    ┌─────────────┐
    │   Clients   │
    └─────────────┘
```

### Production with Reverse Proxy

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  Internet                                                        │
│     │                                                            │
│     ▼                                                            │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Nginx / Caddy                         │   │
│  │                                                          │   │
│  │  - SSL Termination                                       │   │
│  │  - Load Balancing                                        │   │
│  │  - WebSocket Upgrade                                     │   │
│  │  - Static File Caching                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                     │
│              ┌─────────────┼─────────────┐                      │
│              │             │             │                      │
│              ▼             ▼             ▼                      │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  Emberlan #1   │ │  Emberlan #2   │ │  Emberlan #3   │            │
│  │  (Primary)   │ │  (Replica)   │ │  (Replica)   │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│              │             │             │                      │
│              └─────────────┼─────────────┘                      │
│                            │                                     │
│                            ▼                                     │
│              ┌──────────────────────────┐                       │
│              │    MongoDB Replica Set    │                       │
│              │                           │                       │
│              │  Primary ◄──► Secondary   │                       │
│              │            ◄──► Arbiter   │                       │
│              └──────────────────────────┘                       │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance Considerations

### Database Indexes

```javascript
// User indexes
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ status: 1 });

// Message indexes
db.messages.createIndex({ channel: 1, createdAt: -1 });
db.messages.createIndex({ author: 1 });
db.messages.createIndex({ 'federatedData.federatedId': 1 });

// Channel indexes
db.channels.createIndex({ name: 1 });
db.channels.createIndex({ type: 1 });
db.channels.createIndex({ federatedId: 1 });
```

### Caching Strategy

```
┌─────────────────────────────────────────────────┐
│                 Caching Layers                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  Browser Cache                                   │
│  └── Static assets (JS, CSS, images)            │
│                                                  │
│  In-Memory Cache (Node.js)                       │
│  ├── User sessions                               │
│  ├── Channel member lists                        │
│  └── Federation server connections               │
│                                                  │
│  Database                                        │
│  └── Persistent data                             │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## Security Architecture

### Defense Layers

```
┌─────────────────────────────────────────────────┐
│              Security Architecture               │
├─────────────────────────────────────────────────┤
│                                                  │
│  Layer 1: Network                                │
│  ├── HTTPS/TLS encryption                        │
│  ├── Firewall rules                              │
│  └── Rate limiting                               │
│                                                  │
│  Layer 2: Authentication                         │
│  ├── JWT tokens                                  │
│  ├── Password hashing (bcrypt)                   │
│  └── Session management                          │
│                                                  │
│  Layer 3: Authorization                          │
│  ├── Role-based access control                   │
│  ├── Channel permissions                         │
│  └── Federation authentication                   │
│                                                  │
│  Layer 4: Data Validation                        │
│  ├── Input sanitization                          │
│  ├── File upload validation                      │
│  └── Message content filtering                   │
│                                                  │
│  Layer 5: Monitoring                             │
│  ├── Audit logging                               │
│  ├── Error tracking                              │
│  └── Anomaly detection                           │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

For more details, see:
- [API Reference](API.md)
- [Development Guide](DEVELOPMENT.md)
- [Federation Guide](FEDERATION.md)
