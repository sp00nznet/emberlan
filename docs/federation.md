# Federation Guide

Connect multiple Emberlan servers together to create a distributed gaming network.

---

## Table of Contents

- [What is Federation?](#what-is-federation)
- [How It Works](#how-it-works)
- [Setting Up Federation](#setting-up-federation)
- [Channel Conflict Resolution](#channel-conflict-resolution)
- [Managing Federated Servers](#managing-federated-servers)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## What is Federation?

Federation allows multiple independent Emberlan servers to connect and share:

- **Channels** — Messages posted in federated channels appear on all connected servers
- **User Presence** — See when users on other servers are online
- **Real-time Updates** — Instant message delivery across the network

### Why Federate?

| Benefit | Description |
|---------|-------------|
| **Scale** | Grow beyond a single server's capacity |
| **Resilience** | No single point of failure |
| **Communities** | Connect different gaming groups |
| **Control** | Each server maintains its own admin |

### Federation Architecture

```
                    ┌──────────────────────────────────────┐
                    │         Federated Network            │
                    └──────────────────────────────────────┘
                                      │
           ┌──────────────────────────┼──────────────────────────┐
           │                          │                          │
           ▼                          ▼                          ▼
    ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
    │  Server A   │◄─────────►│  Server B   │◄─────────►│  Server C   │
    │             │           │             │           │             │
    │ - Users     │           │ - Users     │           │ - Users     │
    │ - Channels  │           │ - Channels  │           │ - Channels  │
    │ - Messages  │           │ - Messages  │           │ - Messages  │
    │ - Database  │           │ - Database  │           │ - Database  │
    └─────────────┘           └─────────────┘           └─────────────┘
           │                          │                          │
           │    WebSocket + REST      │    WebSocket + REST      │
           └──────────────────────────┴──────────────────────────┘
```

---

## How It Works

### 1. Server Discovery

When Server A wants to federate with Server B:

```
Server A                                    Server B
    │                                           │
    │  GET /api/federation/info                 │
    │ ─────────────────────────────────────────►│
    │                                           │
    │  { serverId, name, channels, stats }      │
    │ ◄─────────────────────────────────────────│
    │                                           │
```

### 2. Federation Request

```
Server A                                    Server B
    │                                           │
    │  POST /api/federation/request             │
    │  { serverId, name, url, sharedSecret }    │
    │ ─────────────────────────────────────────►│
    │                                           │
    │  { status: 'pending', conflicts: [...] }  │
    │ ◄─────────────────────────────────────────│
    │                                           │
```

### 3. Approval & Connection

```
Server B Admin approves the request
    │
    │  POST /api/federation/approved
    │  { requestId, serverId, sharedSecret }
    │ ─────────────────────────────────────────►│
    │                                           │
    │         WebSocket Connection              │
    │ ◄────────────────────────────────────────►│
    │                                           │
    │         Channel Sync                      │
    │ ◄────────────────────────────────────────►│
```

### 4. Message Relay

When a user sends a message in a federated channel:

```
User posts message in #general (federated)
           │
           ▼
    ┌─────────────┐
    │  Server A   │ ── Stores message locally
    │             │ ── Broadcasts to local users
    └─────────────┘
           │
           │ federation:message event
           ▼
    ┌─────────────┐
    │  Server B   │ ── Receives federated message
    │             │ ── Stores with federation metadata
    │             │ ── Broadcasts to local users
    └─────────────┘
```

---

## Setting Up Federation

### Prerequisites

- Both servers must be running Emberlan 1.0+
- Federation must be enabled on both servers
- Network connectivity between servers (WebSocket capable)
- Admin access on both servers

### Step 1: Enable Federation

In your `.env` file:

```env
FEDERATION_ENABLED=true
FEDERATION_SERVER_NAME=My Awesome Server
FEDERATION_MAX_SERVERS=10
```

Restart the server after changing these settings.

### Step 2: Get Your Server ID

Each Emberlan server has a unique Server ID. Find yours at:

```
GET /api/federation/info
```

Or in the admin panel under Federation > Status.

### Step 3: Initiate Federation

**Via Admin Panel:**
1. Go to Admin > Federation
2. Click "Add Server"
3. Enter the target server URL (e.g., `https://other-server.com`)
4. Click "Analyze" to check for conflicts
5. Resolve any channel conflicts
6. Click "Send Request"

**Via API:**
```bash
curl -X POST https://your-server.com/api/federation/initiate \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetUrl": "https://other-server.com"}'
```

### Step 4: Approve the Request (Target Server)

The target server admin must approve the request:

**Via Admin Panel:**
1. Go to Admin > Federation > Pending Requests
2. Review the request details and conflicts
3. Click "Approve" or "Reject"

**Via API:**
```bash
curl -X POST https://other-server.com/api/federation/requests/REQUEST_ID/approve \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conflictResolutions": {}}'
```

### Step 5: Verify Connection

Once approved, servers will automatically:
1. Establish a WebSocket connection
2. Sync channel information
3. Begin relaying messages

Check status:
```bash
curl https://your-server.com/api/federation/status \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Channel Conflict Resolution

When two servers have channels with the same name, Emberlan uses intelligent conflict resolution.

### How Conflicts Are Detected

```
Server A Channels:        Server B Channels:
├── general              ├── general        ← CONFLICT
├── gaming               ├── announcements
├── voice-chat           ├── gaming         ← CONFLICT
└── announcements        └── support
```

### Resolution Strategy

Emberlan resolves conflicts based on **server size** (user count):

| Scenario | Resolution |
|----------|------------|
| Server A (100 users) has `#general` | Keeps `#general` |
| Server B (50 users) has `#general` | Renamed to `#general-federated` |

### Custom Resolution

Admins can override automatic resolution:

```json
{
  "conflictResolutions": {
    "general": "general-serverb",
    "gaming": "gaming-community"
  }
}
```

### Viewing Conflicts Before Federation

```bash
curl -X POST https://your-server.com/api/federation/analyze \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"targetUrl": "https://other-server.com"}'
```

Response:
```json
{
  "hasConflicts": true,
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

---

## Managing Federated Servers

### View Connected Servers

```bash
GET /api/federation/servers
```

Response:
```json
{
  "servers": [
    {
      "serverId": "abc123...",
      "name": "Partner Server",
      "url": "https://partner.com",
      "status": "active",
      "connectedAt": "2024-01-15T10:30:00Z",
      "stats": {
        "userCount": 150,
        "channelCount": 12
      }
    }
  ]
}
```

### View Federated Channels

```bash
GET /api/federation/channels
```

### Update Server Settings

```bash
PUT /api/federation/servers/:serverId/settings
{
  "syncMessages": true,
  "syncUsers": true,
  "maxMessageAge": 86400
}
```

### Disconnect a Server

Temporarily disconnect (can reconnect later):
```bash
POST /api/federation/servers/:serverId/disconnect
```

### Remove Federation

Permanently remove federation:
```bash
DELETE /api/federation/servers/:serverId
```

This will:
- Close the WebSocket connection
- Remove the server from the federation list
- Keep existing federated messages (but stop syncing new ones)

---

## Security

### Authentication

Server-to-server communication uses HMAC-SHA256 signed tokens:

```
Authorization: Federation <serverId>:<timestamp>:<signature>
```

The signature is computed as:
```javascript
signature = HMAC-SHA256(sharedSecret, `${serverId}:${timestamp}`)
```

### Token Validation

- Timestamps must be within 5 minutes of server time
- Shared secrets are exchanged during federation setup
- Each server pair has a unique shared secret

### Best Practices

1. **Use HTTPS** — Always use encrypted connections between servers
2. **Firewall Rules** — Only allow connections from known federated servers
3. **Monitor Activity** — Watch for unusual federation traffic
4. **Regular Audits** — Review federated server list periodically
5. **Rotate Secrets** — There is no built-in secret rotation

### Revoking Access

If a federated server is compromised:

1. Immediately disconnect: `POST /api/federation/servers/:id/disconnect`
2. Remove federation: `DELETE /api/federation/servers/:id`
3. The compromised server can no longer connect

---

## Troubleshooting

### Connection Issues

**Servers won't connect:**
```bash
# Check if target server is reachable
curl https://other-server.com/api/federation/info

# Check firewall rules
# WebSocket requires ports 80/443 to be open

# Verify SSL certificates are valid
```

**Connection keeps dropping:**
- Check network stability between servers
- Verify heartbeat settings aren't too aggressive
- Check server logs for error messages

### Sync Issues

**Messages not appearing on other servers:**
1. Verify the channel is marked as federated
2. Check that sync is enabled for both servers
3. Look for errors in server logs

**Channels not syncing:**
There is no endpoint to force a sync. Channel lists are exchanged over the `federation:channels:sync`
socket event; check both servers' logs for errors from `handleChannelSync`.

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Federation disabled` | Federation not enabled | Set `FEDERATION_ENABLED=true` |
| `Max servers reached` | Hit federation limit | Increase `FEDERATION_MAX_SERVERS` |
| `Invalid token` | Auth failure | Check shared secret, server time |
| `Server not found` | Wrong server ID | Verify server ID is correct |

### Getting Help

- Check server logs: `docker-compose logs emberlan-server`
- Enable debug mode: `DEBUG=federation:* npm start`
- Open an issue on GitHub

---

## API Reference

See [api.md](api.md#federation-endpoints) for complete federation API documentation.
