# API Reference

Complete reference for Emberlan REST API and WebSocket events.

---

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [REST API Endpoints](#rest-api-endpoints)
  - [Auth](#auth-endpoints)
  - [Users](#user-endpoints)
  - [Channels](#channel-endpoints)
  - [Messages](#message-endpoints)
  - [Direct Messages](#direct-message-endpoints)
  - [Admin](#admin-endpoints)
  - [Groups](#group-endpoints)
  - [File Sharing](#file-sharing-endpoints)
  - [Media Bots](#media-bot-endpoints)
  - [Federation](#federation-endpoints)
- [WebSocket Events](#websocket-events)
- [Error Handling](#error-handling)

---

## Overview

### Base URL

```
http://localhost:3001/api
```

### Request Format

All requests should include:
```
Content-Type: application/json
```

For authenticated endpoints:
```
Authorization: Bearer <JWT_TOKEN>
```

### Response Format

Success response:
```json
{
  "success": true,
  "data": { ... }
}
```

Error response:
```json
{
  "success": false,
  "message": "Error description",
  "error": "ERROR_CODE"
}
```

---

## Authentication

### Getting a Token

```http
POST /api/auth/login
```

Request:
```json
{
  "username": "john",
  "password": "secret123"
}
```

Response:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "_id": "...",
    "username": "john",
    "displayName": "John Doe",
    "role": "user"
  }
}
```

### Using the Token

Include in all authenticated requests:
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

---

## REST API Endpoints

### Auth Endpoints

#### Register New User

```http
POST /api/auth/register
```

Request:
```json
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "securepassword",
  "displayName": "New User",
  "inviteCode": "optional-invite-code"
}
```

Response:
```json
{
  "token": "...",
  "user": {
    "_id": "...",
    "username": "newuser",
    "displayName": "New User",
    "email": "user@example.com",
    "role": "user"
  }
}
```

#### Login

```http
POST /api/auth/login
```

Request:
```json
{
  "username": "user",
  "password": "password"
}
```

#### Get Current User

```http
GET /api/auth/me
Authorization: Bearer <token>
```

Response:
```json
{
  "_id": "...",
  "username": "user",
  "displayName": "Display Name",
  "email": "user@example.com",
  "avatar": "/uploads/avatars/...",
  "role": "user",
  "status": "online",
  "steamId": "76561198...",
  "settings": {
    "theme": "dark",
    "notifications": true,
    "pushToTalk": true,
    "pushToTalkKey": "KeyV"
  },
  "friends": [...],
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

#### Update Profile

```http
PUT /api/auth/profile
Authorization: Bearer <token>
```

Request:
```json
{
  "displayName": "New Display Name",
  "steamId": "76561198..."
}
```

#### Change Password

```http
PUT /api/auth/password
Authorization: Bearer <token>
```

Request:
```json
{
  "currentPassword": "oldpassword",
  "newPassword": "newpassword"
}
```

#### Logout

```http
POST /api/auth/logout
Authorization: Bearer <token>
```

---

### User Endpoints

#### Get User Profile

```http
GET /api/users/:userId
Authorization: Bearer <token>
```

Response:
```json
{
  "_id": "...",
  "username": "user",
  "displayName": "Display Name",
  "avatar": "/uploads/avatars/...",
  "status": "online",
  "steamId": "76561198...",
  "createdAt": "2024-01-01T00:00:00.000Z"
}
```

#### Upload Avatar

```http
POST /api/users/avatar
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

Form data:
- `avatar`: Image file (JPEG, PNG, GIF, WebP, max 5MB)

#### Get Common Games

```http
GET /api/users/:userId/common-games
Authorization: Bearer <token>
```

Response:
```json
{
  "commonGames": [
    {
      "appId": 730,
      "name": "Counter-Strike 2",
      "yourPlaytime": 1500,
      "theirPlaytime": 2000,
      "totalPlaytime": 3500
    }
  ]
}
```

#### Send Friend Request

```http
POST /api/users/:userId/friend-request
Authorization: Bearer <token>
```

#### Accept Friend Request

```http
POST /api/users/:userId/friend-accept
Authorization: Bearer <token>
```

#### Decline Friend Request

```http
POST /api/users/:userId/friend-decline
Authorization: Bearer <token>
```

#### Remove Friend

```http
DELETE /api/users/:userId/friend
Authorization: Bearer <token>
```

#### Block User

```http
POST /api/users/:userId/block
Authorization: Bearer <token>
```

#### Unblock User

```http
DELETE /api/users/:userId/block
Authorization: Bearer <token>
```

---

### Channel Endpoints

#### List All Channels

```http
GET /api/channels
Authorization: Bearer <token>
```

Response:
```json
{
  "channels": [
    {
      "_id": "...",
      "name": "general",
      "type": "text",
      "category": "Text Channels",
      "description": "General discussion",
      "position": 0
    }
  ]
}
```

#### Get Channel Details

```http
GET /api/channels/:channelId
Authorization: Bearer <token>
```

#### Create Channel (Admin)

```http
POST /api/channels
Authorization: Bearer <token>
```

Request:
```json
{
  "name": "new-channel",
  "type": "text",
  "category": "Text Channels",
  "description": "A new channel"
}
```

#### Update Channel (Admin)

```http
PUT /api/channels/:channelId
Authorization: Bearer <token>
```

Request:
```json
{
  "name": "updated-name",
  "description": "Updated description"
}
```

#### Delete Channel (Admin)

```http
DELETE /api/channels/:channelId
Authorization: Bearer <token>
```

#### Get Channel Messages

```http
GET /api/channels/:channelId/messages
Authorization: Bearer <token>
```

Query parameters:
- `limit`: Number of messages (default: 50, max: 100)
- `before`: Message ID for pagination
- `after`: Message ID for pagination

Response:
```json
{
  "messages": [
    {
      "_id": "...",
      "channel": "...",
      "author": {
        "_id": "...",
        "username": "user",
        "displayName": "User",
        "avatar": "..."
      },
      "content": "Hello world!",
      "attachments": [],
      "reactions": [],
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ],
  "hasMore": true
}
```

#### Get Pinned Messages

```http
GET /api/channels/:channelId/pinned
Authorization: Bearer <token>
```

---

### Direct Message Endpoints

#### Get Conversations

```http
GET /api/dm/conversations
Authorization: Bearer <token>
```

Response:
```json
{
  "conversations": [
    {
      "user": {
        "_id": "...",
        "username": "friend",
        "displayName": "Friend",
        "avatar": "...",
        "status": "online"
      },
      "lastMessage": {
        "content": "Hey!",
        "createdAt": "..."
      },
      "unreadCount": 2
    }
  ]
}
```

#### Get Direct Messages

```http
GET /api/dm/:userId
Authorization: Bearer <token>
```

Query parameters:
- `limit`: Number of messages (default: 50)
- `before`: Message ID for pagination

---

### Admin Endpoints

#### Get All Users

```http
GET /api/admin/users
Authorization: Bearer <token>
```

Response:
```json
{
  "users": [
    {
      "_id": "...",
      "username": "user",
      "displayName": "User",
      "email": "user@example.com",
      "role": "user",
      "status": "online",
      "isBanned": false,
      "createdAt": "..."
    }
  ]
}
```

#### Update User Role

```http
PUT /api/admin/users/:userId/role
Authorization: Bearer <token>
```

Request:
```json
{
  "role": "moderator"
}
```

Valid roles: `user`, `moderator`, `admin`

#### Ban/Unban User

```http
PUT /api/admin/users/:userId/ban
Authorization: Bearer <token>
```

Request:
```json
{
  "banned": true,
  "reason": "Violation of rules"
}
```

#### Get Invites

```http
GET /api/admin/invites
Authorization: Bearer <token>
```

#### Create Invite

```http
POST /api/admin/invites
Authorization: Bearer <token>
```

Request:
```json
{
  "email": "invite@example.com",
  "maxUses": 1,
  "expiresIn": 7
}
```

#### Delete Invite

```http
DELETE /api/admin/invites/:inviteId
Authorization: Bearer <token>
```

#### Get Server Stats

```http
GET /api/admin/stats
Authorization: Bearer <token>
```

Response:
```json
{
  "users": {
    "total": 150,
    "online": 45,
    "newToday": 5
  },
  "messages": {
    "total": 50000,
    "today": 500
  },
  "channels": {
    "total": 15,
    "text": 10,
    "voice": 5
  }
}
```

---

### Group Endpoints

#### Get All Groups

```http
GET /api/admin/groups
Authorization: Bearer <token>
```

Response:
```json
{
  "groups": [
    {
      "id": "everyone",
      "name": "Everyone",
      "description": "Default group for all users",
      "isDefault": true,
      "createdAt": "..."
    }
  ]
}
```

#### Create Group

```http
POST /api/admin/groups
Authorization: Bearer <token>
```

Request:
```json
{
  "name": "Trusted Members",
  "description": "Users with extra privileges"
}
```

#### Get Group Details

```http
GET /api/admin/groups/:groupId
Authorization: Bearer <token>
```

#### Update Group

```http
PUT /api/admin/groups/:groupId
Authorization: Bearer <token>
```

Request:
```json
{
  "name": "Updated Name",
  "description": "Updated description"
}
```

#### Delete Group

```http
DELETE /api/admin/groups/:groupId
Authorization: Bearer <token>
```

#### Get Group Permissions

```http
GET /api/admin/groups/:groupId/permissions
Authorization: Bearer <token>
```

Response:
```json
{
  "groupId": "trusted-members",
  "permissions": {
    "voice-channels": true,
    "text-channels": true,
    "youtube-bot": true,
    "file-share": true
  }
}
```

#### Set Group Permissions

```http
PUT /api/admin/groups/:groupId/permissions
Authorization: Bearer <token>
```

Request:
```json
{
  "permissions": {
    "youtube-bot": true,
    "file-share": true
  }
}
```

#### Get Group Members

```http
GET /api/admin/groups/:groupId/members
Authorization: Bearer <token>
```

#### Add User to Group

```http
POST /api/admin/groups/:groupId/users/:userId
Authorization: Bearer <token>
```

#### Remove User from Group

```http
DELETE /api/admin/groups/:groupId/users/:userId
Authorization: Bearer <token>
```

#### Get User's Groups

```http
GET /api/admin/users/:userId/groups
Authorization: Bearer <token>
```

#### Set User's Groups

```http
PUT /api/admin/users/:userId/groups
Authorization: Bearer <token>
```

Request:
```json
{
  "groupIds": ["everyone", "trusted-members", "music-lovers"]
}
```

#### Get My Permissions (Non-Admin)

```http
GET /api/permissions/me
Authorization: Bearer <token>
```

Response:
```json
{
  "userId": "...",
  "groups": ["everyone", "trusted-members"],
  "permissions": {
    "voice-channels": true,
    "text-channels": true,
    "youtube-bot": true,
    "file-share": false
  }
}
```

#### Check Permission (Non-Admin)

```http
GET /api/permissions/check/:feature
Authorization: Bearer <token>
```

Response:
```json
{
  "feature": "youtube-bot",
  "hasPermission": true
}
```

---

### File Sharing Endpoints

#### Get File Share Status (Admin)

```http
GET /api/admin/file-share/status
Authorization: Bearer <token>
```

Response:
```json
{
  "enabled": true,
  "totalSharedFolders": 15,
  "usersSharing": 5,
  "onlineUsers": 12
}
```

#### Enable/Disable File Sharing (Admin)

```http
POST /api/admin/file-share/enable
Authorization: Bearer <token>
```

Request:
```json
{
  "enabled": true
}
```

#### Get All Shared Folders

```http
GET /api/file-share/folders
Authorization: Bearer <token>
```

Response:
```json
{
  "folders": [
    {
      "folderId": "user123-1234567890",
      "folderName": "Music",
      "sharedAt": "2024-01-15T10:30:00Z",
      "userId": "user123",
      "username": "john"
    }
  ]
}
```

#### Get My Shared Folders

```http
GET /api/file-share/my-folders
Authorization: Bearer <token>
```

#### Share a Folder

```http
POST /api/file-share/folders
Authorization: Bearer <token>
```

Request:
```json
{
  "folderPath": "/home/user/shared",
  "folderName": "My Shared Folder"
}
```

#### Unshare a Folder

```http
DELETE /api/file-share/folders/:folderId
Authorization: Bearer <token>
```

#### Get User's Shared Folders

```http
GET /api/file-share/users/:userId/folders
Authorization: Bearer <token>
```

#### Get Folder Contents

```http
GET /api/file-share/users/:userId/folders/:folderId/contents?subPath=subfolder
Authorization: Bearer <token>
```

Response:
```json
{
  "contents": [
    {
      "name": "document.pdf",
      "isDirectory": false,
      "size": 1024000
    },
    {
      "name": "images",
      "isDirectory": true
    }
  ]
}
```

#### Request File Download

```http
POST /api/file-share/users/:userId/folders/:folderId/download
Authorization: Bearer <token>
```

Request:
```json
{
  "filePath": "subfolder/document.pdf"
}
```

---

### Media Bot Endpoints

#### YouTube Bot

```http
GET /api/admin/youtube-bot/status
POST /api/admin/youtube-bot/enable
POST /api/admin/youtube-bot/play
POST /api/admin/youtube-bot/stop
Authorization: Bearer <token>
```

#### Plex Bot

```http
GET /api/admin/plex-bot/status
POST /api/admin/plex-bot/enable
POST /api/admin/plex-bot/connect
POST /api/admin/plex-bot/disconnect
GET /api/admin/plex-bot/search?query=...
POST /api/admin/plex-bot/play
POST /api/admin/plex-bot/stop
Authorization: Bearer <token>
```

#### Emby Bot

```http
GET /api/admin/emby-bot/status
POST /api/admin/emby-bot/enable
POST /api/admin/emby-bot/connect
POST /api/admin/emby-bot/disconnect
GET /api/admin/emby-bot/search?query=...
POST /api/admin/emby-bot/play
POST /api/admin/emby-bot/stop
Authorization: Bearer <token>
```

#### Jellyfin Bot

```http
GET /api/admin/jellyfin-bot/status
POST /api/admin/jellyfin-bot/enable
POST /api/admin/jellyfin-bot/connect
POST /api/admin/jellyfin-bot/disconnect
GET /api/admin/jellyfin-bot/search?query=...
POST /api/admin/jellyfin-bot/play
POST /api/admin/jellyfin-bot/stop
Authorization: Bearer <token>
```

#### Chrome Bot

```http
GET /api/admin/chrome-bot/status
POST /api/admin/chrome-bot/enable
POST /api/admin/chrome-bot/start
GET /api/admin/chrome-bot/session/:channelId
POST /api/admin/chrome-bot/navigate
POST /api/admin/chrome-bot/back
POST /api/admin/chrome-bot/forward
POST /api/admin/chrome-bot/refresh
POST /api/admin/chrome-bot/stop
POST /api/admin/chrome-bot/join
POST /api/admin/chrome-bot/transfer
Authorization: Bearer <token>
```

#### IPTV Bot

```http
GET /api/admin/iptv-bot/status
POST /api/admin/iptv-bot/enable
POST /api/admin/iptv-bot/configure
GET /api/admin/iptv-bot/channels?group=...
GET /api/admin/iptv-bot/groups
GET /api/admin/iptv-bot/epg/:channelId
POST /api/admin/iptv-bot/play
POST /api/admin/iptv-bot/change-channel
POST /api/admin/iptv-bot/stop
POST /api/admin/iptv-bot/recordings
GET /api/admin/iptv-bot/recordings
DELETE /api/admin/iptv-bot/recordings/:recordingId
POST /api/admin/iptv-bot/recordings/:recordingId/tag
Authorization: Bearer <token>
```

---

### Federation Endpoints

#### Get Server Info (Public)

```http
GET /api/federation/info
```

Response:
```json
{
  "serverId": "abc123...",
  "name": "Emberlan Server",
  "url": "https://server.example.com",
  "wsUrl": "wss://server.example.com",
  "stats": {
    "userCount": 150,
    "channelCount": 15,
    "messageCount": 50000
  },
  "version": "1.0.0",
  "federationEnabled": true,
  "channels": [...]
}
```

#### Get Federation Status

```http
GET /api/federation/status
Authorization: Bearer <token>
```

Response:
```json
{
  "enabled": true,
  "serverId": "abc123...",
  "serverName": "Emberlan Server",
  "connectedServers": 2,
  "totalServers": 3,
  "servers": [...],
  "pendingRequests": [...]
}
```

#### Get Federated Servers

```http
GET /api/federation/servers
Authorization: Bearer <token>
```

#### Get Pending Requests

```http
GET /api/federation/requests
Authorization: Bearer <token>
```

#### Initiate Federation

```http
POST /api/federation/initiate
Authorization: Bearer <token>
```

Request:
```json
{
  "targetUrl": "https://other-server.com"
}
```

Response:
```json
{
  "requestId": "...",
  "status": "pending",
  "conflicts": [
    {
      "localChannel": "general",
      "remoteChannel": "general",
      "suggestedResolution": "rename_remote",
      "suggestedName": "general-federated"
    }
  ]
}
```

#### Analyze Conflicts

```http
POST /api/federation/analyze
Authorization: Bearer <token>
```

Request:
```json
{
  "targetUrl": "https://other-server.com"
}
```

#### Approve Federation Request

```http
POST /api/federation/requests/:requestId/approve
Authorization: Bearer <token>
```

Request:
```json
{
  "conflictResolutions": {
    "general": "general-partner"
  }
}
```

#### Reject Federation Request

```http
POST /api/federation/requests/:requestId/reject
Authorization: Bearer <token>
```

Request:
```json
{
  "reason": "Not accepting new federations"
}
```

#### Update Server Settings

```http
PUT /api/federation/servers/:serverId/settings
Authorization: Bearer <token>
```

Request:
```json
{
  "syncMessages": true,
  "syncUsers": true
}
```

#### Toggle Channel Sync

```http
PUT /api/federation/channels/:channelId/sync
Authorization: Bearer <token>
```

Request:
```json
{
  "enabled": true
}
```

#### Disconnect Server

```http
POST /api/federation/servers/:serverId/disconnect
Authorization: Bearer <token>
```

#### Remove Federation

```http
DELETE /api/federation/servers/:serverId
Authorization: Bearer <token>
```

---

## WebSocket Events

### Connection

```javascript
const socket = io('http://localhost:3001', {
  auth: {
    token: 'JWT_TOKEN'
  }
});

socket.on('connect', () => {
  console.log('Connected!');
});
```

### Channel Events

#### Join Channel

```javascript
socket.emit('channel:join', { channelId: '...' });
```

#### Leave Channel

```javascript
socket.emit('channel:leave', { channelId: '...' });
```

#### New Message

```javascript
// Send
socket.emit('message:send', {
  channelId: '...',
  content: 'Hello!',
  attachments: []
});

// Receive
socket.on('message:new', (message) => {
  console.log('New message:', message);
});
```

#### Typing Indicator

```javascript
// Start typing
socket.emit('typing:start', { channelId: '...' });

// Stop typing
socket.emit('typing:stop', { channelId: '...' });

// Receive
socket.on('typing:update', ({ channelId, users }) => {
  console.log('Users typing:', users);
});
```

### Voice Events

#### Join Voice Channel

```javascript
socket.emit('voice:join', { channelId: '...' });

socket.on('voice:user-joined', ({ userId, username }) => {
  // Setup WebRTC connection
});
```

#### Leave Voice Channel

```javascript
socket.emit('voice:leave', { channelId: '...' });
```

#### Mute/Unmute

```javascript
socket.emit('voice:mute', { muted: true });
```

### WebRTC Signaling

#### Send Offer

```javascript
socket.emit('webrtc:offer', {
  targetUserId: '...',
  offer: rtcPeerConnection.localDescription
});
```

#### Receive Offer

```javascript
socket.on('webrtc:offer', async ({ fromUserId, offer }) => {
  await rtcPeerConnection.setRemoteDescription(offer);
  const answer = await rtcPeerConnection.createAnswer();
  await rtcPeerConnection.setLocalDescription(answer);

  socket.emit('webrtc:answer', {
    targetUserId: fromUserId,
    answer
  });
});
```

#### ICE Candidates

```javascript
// Send
rtcPeerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    socket.emit('webrtc:ice-candidate', {
      targetUserId: '...',
      candidate: event.candidate
    });
  }
};

// Receive
socket.on('webrtc:ice-candidate', async ({ candidate }) => {
  await rtcPeerConnection.addIceCandidate(candidate);
});
```

### Direct Messages

```javascript
// Send
socket.emit('dm:send', {
  recipientId: '...',
  content: 'Private message'
});

// Receive
socket.on('dm:new', (message) => {
  console.log('New DM:', message);
});
```

### User Status

```javascript
// Update own status
socket.emit('status:update', { status: 'away' });

// Receive status updates
socket.on('user:status', ({ userId, status }) => {
  console.log(`${userId} is now ${status}`);
});
```

### Federation Events

```javascript
// Federated message from another server
socket.on('federation:message', (message) => {
  // message.author.isFederated = true
  // message.author.serverName = 'Other Server'
});

// Federated user status
socket.on('federation:user:status', ({ serverId, user }) => {
  console.log(`User from ${serverId}:`, user);
});
```

---

## Error Handling

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 409 | Conflict |
| 422 | Validation Error |
| 429 | Rate Limited |
| 500 | Server Error |

### Error Codes

| Code | Description |
|------|-------------|
| `AUTH_REQUIRED` | Authentication required |
| `INVALID_TOKEN` | Invalid or expired token |
| `PERMISSION_DENIED` | Insufficient permissions |
| `USER_NOT_FOUND` | User does not exist |
| `CHANNEL_NOT_FOUND` | Channel does not exist |
| `ALREADY_EXISTS` | Resource already exists |
| `VALIDATION_ERROR` | Input validation failed |
| `RATE_LIMITED` | Too many requests |
| `FEDERATION_DISABLED` | Federation not enabled |
| `SERVER_ERROR` | Internal server error |

### Error Response Format

```json
{
  "success": false,
  "message": "Human-readable error message",
  "error": "ERROR_CODE",
  "details": {
    "field": "Specific field error"
  }
}
```

---

## Rate Limiting

| Endpoint | Limit |
|----------|-------|
| Auth endpoints | 5 req/min |
| API endpoints | 100 req/min |
| File uploads | 10 req/min |
| Federation | 30 req/min |

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704067200
```
