const { socketAuth } = require('../middleware/auth');
const User = require('../models/User');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const DirectMessage = require('../models/DirectMessage');
const { FederationServer, FederatedChannel } = require('../models/Federation');
const { verifyAuthHeader } = require('../config/federation');

// Connected users map
const connectedUsers = new Map();
const userSockets = new Map();

// Federated server connections
const federatedServerSockets = new Map();

// Federation service reference (set after initialization)
let federationService = null;

const setFederationService = (service) => {
  federationService = service;
};

const initializeSocket = (io) => {
  // Combined authentication middleware (users and federated servers)
  io.use(async (socket, next) => {
    // Check if this is a federation connection
    if (socket.handshake.auth.type === 'federation') {
      try {
        const { serverId, token } = socket.handshake.auth;

        // Find the federated server
        const server = await FederationServer.findOne({ serverId, status: 'active' });
        if (!server) {
          return next(new Error('Unknown federated server'));
        }

        // Verify the token
        const verification = verifyAuthHeader(`Federation ${token}`, serverId, server.sharedSecret);
        if (!verification.valid) {
          return next(new Error(`Federation auth failed: ${verification.error}`));
        }

        socket.isFederated = true;
        socket.federatedServer = server;
        return next();
      } catch (error) {
        return next(new Error('Federation authentication failed'));
      }
    }

    // Regular user authentication
    return socketAuth(socket, next);
  });

  io.on('connection', async (socket) => {
    // Handle federated server connections
    if (socket.isFederated) {
      return handleFederatedServerConnection(io, socket);
    }

    // Handle regular user connections
    return handleUserConnection(io, socket);
  });

  return io;
};

// Handle connections from federated servers
const handleFederatedServerConnection = async (io, socket) => {
  const server = socket.federatedServer;
  console.log(`Federated server connected: ${server.name} (${server.serverId})`);

  // Store connection
  federatedServerSockets.set(server.serverId, socket);

  // Update server status
  server.status = 'active';
  server.lastHeartbeat = new Date();
  await server.save();

  // ===== Federation Heartbeat =====
  socket.on('federation:heartbeat', async (data) => {
    server.lastHeartbeat = new Date();
    server.stats.lastSeen = new Date();
    await server.save();

    socket.emit('federation:heartbeat:ack', {
      timestamp: Date.now()
    });
  });

  // ===== Federation Channel Sync =====
  socket.on('federation:channels:sync', async (data) => {
    try {
      if (federationService) {
        await federationService.handleChannelSync(data.serverId, data.channels);
      }

      socket.emit('federation:channels:sync:ack', {
        synced: data.channels.length
      });
    } catch (error) {
      console.error('Channel sync error:', error);
      socket.emit('federation:error', { message: 'Channel sync failed' });
    }
  });

  // ===== Federation Messages =====
  socket.on('federation:message', async (data) => {
    try {
      const { federatedMessage, targetChannelId } = data;

      // Find local channel
      const localChannel = await Channel.findById(targetChannelId);
      if (!localChannel) {
        return socket.emit('federation:error', { message: 'Channel not found' });
      }

      // Create local message representation
      const localMessage = new Message({
        channel: localChannel._id,
        author: null,
        content: federatedMessage.content,
        type: 'federated',
        attachments: federatedMessage.attachments || [],
        federatedData: {
          federatedId: federatedMessage.federatedId,
          originServer: federatedMessage.originServer,
          author: federatedMessage.author
        }
      });

      await localMessage.save();

      // Broadcast to local clients
      io.to(`channel:${localChannel._id}`).emit('message:new', {
        ...localMessage.toObject(),
        author: {
          _id: 'federated',
          username: federatedMessage.author.username,
          displayName: `${federatedMessage.author.displayName} @ ${federatedMessage.author.serverName}`,
          avatar: federatedMessage.author.avatar,
          isFederated: true,
          originServer: federatedMessage.author.serverName
        }
      });

      socket.emit('federation:message:ack', {
        federatedId: federatedMessage.federatedId,
        localMessageId: localMessage._id
      });
    } catch (error) {
      console.error('Federated message error:', error);
      socket.emit('federation:error', { message: 'Failed to process message' });
    }
  });

  // ===== Federation User Status =====
  socket.on('federation:user:status', async (data) => {
    // Broadcast to local clients interested in federated users
    io.emit('federation:user:status', {
      serverId: data.serverId,
      user: data.user
    });
  });

  // ===== Federation Channel Updates =====
  socket.on('federation:channel:update', async (data) => {
    try {
      const { federatedChannelId, update } = data;

      // Update the federated channel record
      await FederatedChannel.findOneAndUpdate(
        { federatedId: federatedChannelId },
        { $set: update }
      );

      // Notify local clients
      io.emit('federation:channel:updated', {
        federatedChannelId,
        update
      });
    } catch (error) {
      console.error('Federation channel update error:', error);
    }
  });

  // ===== Federation Voice State =====
  socket.on('federation:voice:state', async (data) => {
    // Forward voice state to local clients
    io.emit('federation:voice:state', data);
  });

  // ===== Federation Disconnect =====
  socket.on('federation:disconnect', async (data) => {
    console.log(`Federated server disconnecting: ${server.name} - ${data.reason}`);
  });

  socket.on('disconnect', async () => {
    console.log(`Federated server disconnected: ${server.name}`);
    federatedServerSockets.delete(server.serverId);

    server.status = 'disconnected';
    await server.save();
  });
};

// Handle regular user connections
const handleUserConnection = async (io, socket) => {
  const user = socket.user;
  console.log(`User connected: ${user.username} (${socket.id})`);

  // Store socket reference
  connectedUsers.set(user._id.toString(), socket.id);
  userSockets.set(socket.id, user._id.toString());

  // Update user status. Not awaited: the handlers below must be registered in the
  // same tick as 'connection', or events the client sends right after connecting
  // (channel:join, voice:join) are dropped. Caught by conformance live/chat.
  User.findByIdAndUpdate(user._id, { status: 'online' }).catch((e) => console.error('status update failed:', e.message));

  // Broadcast online status
  socket.broadcast.emit('user:status', {
    userId: user._id,
    status: 'online'
  });

  // Broadcast to federated servers
  broadcastToFederation('federation:user:status', {
    user: {
      id: user._id.toString(),
      username: user.username,
      displayName: user.displayName || user.username,
      avatar: user.avatar,
      status: 'online'
    }
  });

  // Join user's personal room
  socket.join(`user:${user._id}`);

  // ===== Channel Messages =====
  socket.on('channel:join', async (channelId) => {
    socket.join(`channel:${channelId}`);
    console.log(`${user.username} joined channel ${channelId}`);
  });

  socket.on('channel:leave', async (channelId) => {
    socket.leave(`channel:${channelId}`);
  });

  socket.on('message:send', async (data) => {
    try {
      const { channelId, content, replyTo, attachments } = data;

      if (!content && (!attachments || attachments.length === 0)) {
        return socket.emit('error', { message: 'Message content required' });
      }

      // Check for YouTube bot command
      let messageType = 'text';
      let youtubeData = null;

      if (content.startsWith('!play ') || content.startsWith('!youtube ')) {
        const query = content.replace(/^!(play|youtube)\s+/, '');
        messageType = 'youtube';
        youtubeData = {
          videoId: 'placeholder',
          title: query,
          thumbnail: '',
          duration: ''
        };
      }

      const message = new Message({
        channel: channelId,
        author: user._id,
        content,
        type: messageType,
        replyTo,
        attachments: attachments || [],
        youtubeData
      });

      await message.save();
      await message.populate('author', 'username displayName avatar role');

      if (replyTo) {
        await message.populate('replyTo', 'content author');
      }

      // Broadcast to local clients
      io.to(`channel:${channelId}`).emit('message:new', message);

      // Relay to federated servers if this is a federated channel
      const channel = await Channel.findById(channelId);
      if (federationService && channel) {
        await federationService.relayMessageToFederation(message, channel);
      }
    } catch (error) {
      console.error('Message send error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  socket.on('message:edit', async (data) => {
    try {
      const { messageId, content } = data;

      const message = await Message.findById(messageId);
      if (!message) {
        return socket.emit('error', { message: 'Message not found' });
      }

      if (message.author.toString() !== user._id.toString()) {
        return socket.emit('error', { message: 'Not authorized' });
      }

      message.content = content;
      message.edited = true;
      message.editedAt = new Date();
      await message.save();

      io.to(`channel:${message.channel}`).emit('message:updated', message);
    } catch (error) {
      console.error('Message edit error:', error);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  });

  socket.on('message:delete', async (data) => {
    try {
      const { messageId } = data;

      const message = await Message.findById(messageId);
      if (!message) {
        return socket.emit('error', { message: 'Message not found' });
      }

      const isOwner = message.author.toString() === user._id.toString();
      const isAdmin = user.role === 'admin' || user.role === 'superadmin';

      if (!isOwner && !isAdmin) {
        return socket.emit('error', { message: 'Not authorized' });
      }

      message.deleted = true;
      await message.save();

      io.to(`channel:${message.channel}`).emit('message:deleted', { messageId });
    } catch (error) {
      console.error('Message delete error:', error);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });

  socket.on('message:reaction', async (data) => {
    try {
      const { messageId, emoji, action } = data;

      const message = await Message.findById(messageId);
      if (!message) return;

      const reactionIndex = message.reactions.findIndex(r => r.emoji === emoji);

      if (action === 'add') {
        if (reactionIndex === -1) {
          message.reactions.push({ emoji, users: [user._id] });
        } else if (!message.reactions[reactionIndex].users.includes(user._id)) {
          message.reactions[reactionIndex].users.push(user._id);
        }
      } else if (action === 'remove' && reactionIndex !== -1) {
        const userIndex = message.reactions[reactionIndex].users.indexOf(user._id);
        if (userIndex !== -1) {
          message.reactions[reactionIndex].users.splice(userIndex, 1);
          if (message.reactions[reactionIndex].users.length === 0) {
            message.reactions.splice(reactionIndex, 1);
          }
        }
      }

      await message.save();
      io.to(`channel:${message.channel}`).emit('message:reacted', {
        messageId,
        reactions: message.reactions
      });
    } catch (error) {
      console.error('Reaction error:', error);
    }
  });

  // ===== Direct Messages (End-to-End Encrypted) =====
  socket.on('dm:send', async (data) => {
    try {
      const { recipientId, encryptedContent, iv, encryptedKey } = data;

      if (!encryptedContent || !iv || !encryptedKey) {
        return socket.emit('error', { message: 'Encrypted message data required' });
      }

      // Check if blocked
      const recipient = await User.findById(recipientId);
      if (!recipient) {
        return socket.emit('error', { message: 'User not found' });
      }

      if (recipient.blockedUsers?.includes(user._id)) {
        return socket.emit('error', { message: 'Cannot message this user' });
      }

      const dm = new DirectMessage({
        participants: [user._id, recipientId].sort(),
        sender: user._id,
        recipient: recipientId,
        encryptedContent,
        iv,
        encryptedKey
      });

      await dm.save();
      await dm.populate('sender', 'username displayName avatar');

      // Send to both users - they will decrypt on their end
      socket.emit('dm:new', dm);
      io.to(`user:${recipientId}`).emit('dm:new', dm);
    } catch (error) {
      console.error('DM send error:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Update user's public key for E2E encryption
  socket.on('dm:setPublicKey', async (data) => {
    try {
      const { publicKey } = data;
      if (!publicKey) {
        return socket.emit('error', { message: 'Public key required' });
      }

      await User.findByIdAndUpdate(user._id, { publicKey });
      socket.emit('dm:publicKeySet', { success: true });
    } catch (error) {
      console.error('Set public key error:', error);
      socket.emit('error', { message: 'Failed to set public key' });
    }
  });

  // Get a user's public key (for encrypting messages to them)
  socket.on('dm:getPublicKey', async (data) => {
    try {
      const { userId } = data;
      const targetUser = await User.findById(userId).select('publicKey username displayName');
      if (!targetUser) {
        return socket.emit('error', { message: 'User not found' });
      }
      socket.emit('dm:publicKey', {
        userId,
        username: targetUser.username,
        displayName: targetUser.displayName,
        publicKey: targetUser.publicKey
      });
    } catch (error) {
      console.error('Get public key error:', error);
      socket.emit('error', { message: 'Failed to get public key' });
    }
  });

  socket.on('dm:read', async (data) => {
    try {
      const { senderId } = data;

      await DirectMessage.updateMany(
        {
          participants: { $all: [user._id, senderId] },
          sender: senderId,
          read: false
        },
        { read: true, readAt: new Date() }
      );

      io.to(`user:${senderId}`).emit('dm:read', { readBy: user._id });
    } catch (error) {
      console.error('DM read error:', error);
    }
  });

  // ===== Voice/Video Channels =====
  socket.on('voice:join', async (channelId) => {
    try {
      const channel = await Channel.findById(channelId);
      if (!channel || !['voice', 'video'].includes(channel.type)) {
        return socket.emit('error', { message: 'Invalid voice channel' });
      }

      // Leave current voice channel if in one
      const currentVoice = await Channel.findOne({
        'currentUsers.user': user._id,
        type: { $in: ['voice', 'video'] }
      });

      if (currentVoice) {
        await Channel.findByIdAndUpdate(currentVoice._id, {
          $pull: { currentUsers: { user: user._id } }
        });
        socket.leave(`voice:${currentVoice._id}`);
        io.to(`voice:${currentVoice._id}`).emit('voice:userLeft', {
          userId: user._id,
          channelId: currentVoice._id
        });
      }

      // Join new channel
      await Channel.findByIdAndUpdate(channelId, {
        $push: {
          currentUsers: {
            user: user._id,
            joinedAt: new Date(),
            isMuted: false,
            isDeafened: false
          }
        }
      });

      socket.join(`voice:${channelId}`);
      socket.voiceChannel = channelId;
      console.log(`[Voice] User ${user.username} joined voice room voice:${channelId}`);

      // Notify others
      io.to(`voice:${channelId}`).emit('voice:userJoined', {
        userId: user._id,
        user: user.toPublicProfile(),
        channelId
      });

      // Send current users to the joining user
      const updatedChannel = await Channel.findById(channelId)
        .populate('currentUsers.user', 'username displayName avatar status');

      socket.emit('voice:currentUsers', {
        channelId,
        users: updatedChannel.currentUsers
      });

      // Send active bot sessions to the joining user
      try {
        const botRegistry = require('../services/botRegistry');
        const activeSessions = botRegistry.getActiveSessionsForChannel(channelId);
        if (activeSessions.length > 0) {
          console.log(`[Voice] Sending ${activeSessions.length} active bot session(s) to user ${user.username}`);
          activeSessions.forEach(session => {
            console.log(`[Voice] Emitting ${session.event} to joining user`);
            socket.emit(session.event, session.data);
          });
        }
      } catch (err) {
        console.error('[Voice] Error sending bot sessions:', err.message);
      }

      // Broadcast to federation
      broadcastToFederation('federation:voice:state', {
        channelId,
        userId: user._id.toString(),
        action: 'join',
        user: user.toPublicProfile()
      });
    } catch (error) {
      console.error('Voice join error:', error);
      socket.emit('error', { message: 'Failed to join voice channel' });
    }
  });

  socket.on('voice:leave', async () => {
    try {
      if (socket.voiceChannel) {
        await Channel.findByIdAndUpdate(socket.voiceChannel, {
          $pull: { currentUsers: { user: user._id } }
        });

        io.to(`voice:${socket.voiceChannel}`).emit('voice:userLeft', {
          userId: user._id,
          channelId: socket.voiceChannel
        });

        // Broadcast to federation
        broadcastToFederation('federation:voice:state', {
          channelId: socket.voiceChannel,
          userId: user._id.toString(),
          action: 'leave'
        });

        socket.leave(`voice:${socket.voiceChannel}`);
        socket.voiceChannel = null;
      }
    } catch (error) {
      console.error('Voice leave error:', error);
    }
  });

  socket.on('voice:mute', async (isMuted) => {
    if (socket.voiceChannel) {
      await Channel.updateOne(
        { _id: socket.voiceChannel, 'currentUsers.user': user._id },
        { $set: { 'currentUsers.$.isMuted': isMuted } }
      );

      io.to(`voice:${socket.voiceChannel}`).emit('voice:userMuted', {
        userId: user._id,
        isMuted
      });
    }
  });

  socket.on('voice:deafen', async (isDeafened) => {
    if (socket.voiceChannel) {
      await Channel.updateOne(
        { _id: socket.voiceChannel, 'currentUsers.user': user._id },
        { $set: { 'currentUsers.$.isDeafened': isDeafened } }
      );

      io.to(`voice:${socket.voiceChannel}`).emit('voice:userDeafened', {
        userId: user._id,
        isDeafened
      });
    }
  });

  // ===== WebRTC Signaling =====
  socket.on('webrtc:offer', (data) => {
    const { targetUserId, offer } = data;
    const targetSocketId = connectedUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc:offer', {
        fromUserId: user._id,
        offer
      });
    }
  });

  socket.on('webrtc:answer', (data) => {
    const { targetUserId, answer } = data;
    const targetSocketId = connectedUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc:answer', {
        fromUserId: user._id,
        answer
      });
    }
  });

  socket.on('webrtc:ice-candidate', (data) => {
    const { targetUserId, candidate } = data;
    const targetSocketId = connectedUsers.get(targetUserId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('webrtc:ice-candidate', {
        fromUserId: user._id,
        candidate
      });
    }
  });

  // Screen share signals
  socket.on('screen:start', () => {
    if (socket.voiceChannel) {
      Channel.updateOne(
        { _id: socket.voiceChannel, 'currentUsers.user': user._id },
        { $set: { 'currentUsers.$.isStreaming': true } }
      );

      io.to(`voice:${socket.voiceChannel}`).emit('screen:started', {
        userId: user._id
      });
    }
  });

  socket.on('screen:stop', () => {
    if (socket.voiceChannel) {
      Channel.updateOne(
        { _id: socket.voiceChannel, 'currentUsers.user': user._id },
        { $set: { 'currentUsers.$.isStreaming': false } }
      );

      io.to(`voice:${socket.voiceChannel}`).emit('screen:stopped', {
        userId: user._id
      });
    }
  });

  // Camera toggle
  socket.on('camera:toggle', (isOn) => {
    if (socket.voiceChannel) {
      Channel.updateOne(
        { _id: socket.voiceChannel, 'currentUsers.user': user._id },
        { $set: { 'currentUsers.$.isCameraOn': isOn } }
      );

      io.to(`voice:${socket.voiceChannel}`).emit('camera:toggled', {
        userId: user._id,
        isOn
      });
    }
  });

  // ===== Game Together Events =====
  // Real-time controller input for game together sessions
  socket.on('gameTogether:input', (data) => {
    const { channelId, inputData } = data;
    // Input is handled directly by the service
    // This event is just for real-time acknowledgment
    socket.emit('gameTogether:input-received', {
      channelId,
      userId: user._id,
      timestamp: Date.now()
    });
  });

  // ===== Typing Indicators =====
  socket.on('typing:start', (channelId) => {
    socket.to(`channel:${channelId}`).emit('typing:started', {
      userId: user._id,
      username: user.displayName || user.username
    });
  });

  socket.on('typing:stop', (channelId) => {
    socket.to(`channel:${channelId}`).emit('typing:stopped', {
      userId: user._id
    });
  });

  // ===== User Status =====
  socket.on('status:update', async (status) => {
    if (['online', 'idle', 'dnd', 'offline'].includes(status)) {
      await User.findByIdAndUpdate(user._id, { status });
      io.emit('user:status', { userId: user._id, status });

      // Broadcast to federation
      broadcastToFederation('federation:user:status', {
        user: {
          id: user._id.toString(),
          username: user.username,
          displayName: user.displayName || user.username,
          status
        }
      });
    }
  });

  socket.on('status:custom', async (customStatus) => {
    await User.findByIdAndUpdate(user._id, { customStatus: customStatus.substring(0, 128) });
    io.emit('user:customStatus', { userId: user._id, customStatus });
  });

  // ===== Disconnect =====
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${user.username}`);

    // Clean up voice channel
    if (socket.voiceChannel) {
      await Channel.findByIdAndUpdate(socket.voiceChannel, {
        $pull: { currentUsers: { user: user._id } }
      });

      io.to(`voice:${socket.voiceChannel}`).emit('voice:userLeft', {
        userId: user._id,
        channelId: socket.voiceChannel
      });
    }

    // Update status
    await User.findByIdAndUpdate(user._id, {
      status: 'offline',
      lastSeen: new Date()
    });

    // Remove from connected users
    connectedUsers.delete(user._id.toString());
    userSockets.delete(socket.id);

    // Broadcast offline status
    socket.broadcast.emit('user:status', {
      userId: user._id,
      status: 'offline'
    });

    // Broadcast to federation
    broadcastToFederation('federation:user:status', {
      user: {
        id: user._id.toString(),
        username: user.username,
        displayName: user.displayName || user.username,
        status: 'offline'
      }
    });
  });
};

// Helper function to broadcast to all federated servers
const broadcastToFederation = (event, data) => {
  for (const [serverId, socket] of federatedServerSockets) {
    if (socket && socket.connected) {
      socket.emit(event, data);
    }
  }
};

module.exports = {
  initializeSocket,
  connectedUsers,
  userSockets,
  federatedServerSockets,
  setFederationService,
  broadcastToFederation
};
