const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Federation configuration
const federationConfig = {
  // This server's unique ID (generated once, stored in file)
  serverId: null,

  // This server's name in the federation
  serverName: process.env.FEDERATION_SERVER_NAME || 'Emberlan Server',

  // This server's public URL
  serverUrl: process.env.SERVER_URL || process.env.CLIENT_URL || 'http://localhost:3001',

  // WebSocket URL
  wsUrl: process.env.WS_URL || null, // Will be derived from serverUrl if not set

  // Federation enabled
  enabled: process.env.FEDERATION_ENABLED !== 'false',

  // Auto-accept federation requests from known servers
  autoAcceptKnown: process.env.FEDERATION_AUTO_ACCEPT === 'true',

  // Maximum number of federated servers
  maxFederatedServers: parseInt(process.env.FEDERATION_MAX_SERVERS) || 50,

  // Heartbeat interval (ms)
  heartbeatInterval: parseInt(process.env.FEDERATION_HEARTBEAT_INTERVAL) || 30000,

  // Connection timeout (ms)
  connectionTimeout: parseInt(process.env.FEDERATION_CONNECTION_TIMEOUT) || 10000,

  // Message relay batch size
  relayBatchSize: parseInt(process.env.FEDERATION_RELAY_BATCH_SIZE) || 100,

  // Sync settings
  sync: {
    channels: process.env.FEDERATION_SYNC_CHANNELS !== 'false',
    users: process.env.FEDERATION_SYNC_USERS !== 'false',
    messages: process.env.FEDERATION_SYNC_MESSAGES !== 'false'
  },

  // Security settings
  security: {
    requireHttps: process.env.NODE_ENV === 'production',
    tokenExpiry: 5 * 60 * 1000, // 5 minutes
    maxRequestAge: 60 * 1000 // 1 minute
  }
};

// Server ID file path
const serverIdPath = path.join(__dirname, '..', '.server-id');

// Generate or load server ID
function getServerId() {
  if (federationConfig.serverId) {
    return federationConfig.serverId;
  }

  // Try to load from file
  if (fs.existsSync(serverIdPath)) {
    federationConfig.serverId = fs.readFileSync(serverIdPath, 'utf8').trim();
    return federationConfig.serverId;
  }

  // Generate new server ID
  federationConfig.serverId = `f7-${crypto.randomBytes(16).toString('hex')}`;

  // Save to file
  fs.writeFileSync(serverIdPath, federationConfig.serverId);
  console.log(`Generated new server ID: ${federationConfig.serverId}`);

  return federationConfig.serverId;
}

// Get WebSocket URL
function getWsUrl() {
  if (federationConfig.wsUrl) {
    return federationConfig.wsUrl;
  }

  // Derive from server URL
  const url = federationConfig.serverUrl;
  if (url.startsWith('https://')) {
    return url.replace('https://', 'wss://');
  }
  return url.replace('http://', 'ws://');
}

// Generate a shared secret for federation
function generateSharedSecret() {
  return crypto.randomBytes(32).toString('hex');
}

// Create federation auth header
function createAuthHeader(serverId, sharedSecret) {
  const timestamp = Date.now();
  const payload = `${serverId}:${timestamp}`;
  const signature = crypto
    .createHmac('sha256', sharedSecret)
    .update(payload)
    .digest('hex');
  return `Federation ${payload}:${signature}`;
}

// Verify federation auth header
function verifyAuthHeader(authHeader, expectedServerId, sharedSecret) {
  try {
    if (!authHeader || !authHeader.startsWith('Federation ')) {
      return { valid: false, error: 'Invalid auth header format' };
    }

    const token = authHeader.substring(11); // Remove 'Federation '
    const [serverId, timestamp, signature] = token.split(':');

    // Verify server ID
    if (serverId !== expectedServerId) {
      return { valid: false, error: 'Server ID mismatch' };
    }

    // Check timestamp
    const tokenAge = Date.now() - parseInt(timestamp);
    if (tokenAge > federationConfig.security.tokenExpiry) {
      return { valid: false, error: 'Token expired' };
    }

    if (tokenAge < -federationConfig.security.maxRequestAge) {
      return { valid: false, error: 'Token from future' };
    }

    // Verify signature
    const payload = `${serverId}:${timestamp}`;
    const expectedSignature = crypto
      .createHmac('sha256', sharedSecret)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSignature) {
      return { valid: false, error: 'Invalid signature' };
    }

    return { valid: true, serverId, timestamp: parseInt(timestamp) };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Generate federated channel ID
function generateFederatedChannelId(originServerId, channelName) {
  const hash = crypto
    .createHash('sha256')
    .update(`${originServerId}:${channelName}:${Date.now()}`)
    .digest('hex')
    .substring(0, 16);
  return `fc-${hash}`;
}

// Generate federated message ID
function generateFederatedMessageId(originServerId, originalMessageId) {
  const hash = crypto
    .createHash('sha256')
    .update(`${originServerId}:${originalMessageId}`)
    .digest('hex')
    .substring(0, 16);
  return `fm-${hash}`;
}

// Check for channel name conflicts
function analyzeChannelConflicts(localChannels, remoteChannels) {
  const conflicts = [];
  const localNames = new Set(localChannels.map(c => c.name.toLowerCase()));

  for (const remote of remoteChannels) {
    if (localNames.has(remote.name.toLowerCase())) {
      // Find the local channel with this name
      const localChannel = localChannels.find(
        c => c.name.toLowerCase() === remote.name.toLowerCase()
      );

      conflicts.push({
        localChannel: localChannel.name,
        localChannelId: localChannel._id,
        remoteChannel: remote.name,
        remoteChannelId: remote._id,
        suggestedResolution: null,
        resolvedName: null
      });
    }
  }

  return conflicts;
}

// Suggest resolution for channel conflicts
function suggestConflictResolution(conflict, localServerStats, remoteServerStats) {
  // Server with more users keeps original name
  const localIsLarger = localServerStats.userCount >= remoteServerStats.userCount;

  if (localIsLarger) {
    return {
      ...conflict,
      suggestedResolution: 'rename_remote',
      resolvedName: `${conflict.remoteChannel}-federated`
    };
  } else {
    return {
      ...conflict,
      suggestedResolution: 'rename_local',
      resolvedName: `${conflict.localChannel}-local`
    };
  }
}

module.exports = {
  federationConfig,
  getServerId,
  getWsUrl,
  generateSharedSecret,
  createAuthHeader,
  verifyAuthHeader,
  generateFederatedChannelId,
  generateFederatedMessageId,
  analyzeChannelConflicts,
  suggestConflictResolution
};
