require('dotenv').config();

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const { Server } = require('socket.io');

const connectDB = require('./config/database');
const apiRoutes = require('./routes/api');
const { initializeSocket } = require('./socket/socketHandler');
const User = require('./models/User');
const Channel = require('./models/Channel');

const app = express();

// Trust upstream proxy (nginx in webclient container, Cloudflare tunnel) so req.protocol
// reflects X-Forwarded-Proto. Without this, Google OAuth's redirect_uri exchange fails
// behind any HTTPS-terminating proxy (we'd send https:// to Google but rebuild http:// here).
app.set('trust proxy', true);

// Configuration
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const ENABLE_HTTPS = process.env.ENABLE_HTTPS === 'true';
const FEDERATION_ENABLED = process.env.FEDERATION_ENABLED === 'true';

// Middleware
// CSP for the bundled web client (client/public). Scripts only from this origin
// (vendor libs are bundled, not CDN). Media, images and API/socket traffic may go
// to other hosts: bots stream from Plex/Jellyfin/IPTV, and desktop users join any server.
// ponytail: script-src-attr allows inline handlers because app.js renders ~190
// onclick="..." attributes; moving them to addEventListener lets this go back to 'none'.
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      workerSrc: ["'self'", 'blob:'], // hls.js and mpegts.js decode in a blob: worker
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:', 'http:'],
      mediaSrc: ["'self'", 'blob:', 'https:', 'http:'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https:', 'http:'],
      frameSrc: ["'self'", 'https://www.youtube.com', 'https://player.twitch.tv'],
    },
  },
}));

// Any origin: the desktop app (file://, Origin "null") and Android
// (https://emberlan.local) connect to whatever server the user types in.
// Safe because auth is a Bearer token, never a cookie.
app.use(cors({ origin: '*' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve web client static files (for development - in production, use nginx)
app.use(express.static(path.join(__dirname, '..', 'client', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// API routes
app.use('/api', apiRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    name: 'Emberlan Server',
    version: '1.0.0',
    federationEnabled: FEDERATION_ENABLED,
    timestamp: new Date().toISOString()
  });
});

// Create HTTP(S) server
let server;
if (ENABLE_HTTPS && fs.existsSync('./ssl/key.pem') && fs.existsSync('./ssl/cert.pem')) {
  const sslOptions = {
    key: fs.readFileSync('./ssl/key.pem'),
    cert: fs.readFileSync('./ssl/cert.pem')
  };
  server = https.createServer(sslOptions, app);
  console.log('HTTPS enabled');
} else {
  server = http.createServer(app);
}

// Initialize Socket.IO
const io = new Server(server, {
  cors: { origin: '*' }, // same reason as the REST cors() above
  transports: ['websocket', 'polling']
});

// Store io in app for controllers
app.set('io', io);

// Initialize socket handlers
initializeSocket(io);

// Federation service (optional)
let federationService = null;

// YouTube bot service
let youtubeBotService = null;


// Database and server startup
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Nobody is in voice when the server starts: sockets don't survive a restart, so any
    // voice members left in the database are ghosts that new callers would try to call.
    await Channel.updateMany({ 'currentUsers.0': { $exists: true } }, { $set: { currentUsers: [] } });

    // Create default admin if not exists
    const adminExists = await User.findOne({ role: 'superadmin' });
    if (!adminExists) {
      const defaultAdmin = new User({
        username: 'admin',
        displayName: 'Admin',
        email: 'admin@emberlan.local',
        password: 'admin123', // Change this in production!
        role: 'superadmin'
      });
      await defaultAdmin.save();
      console.log('Default admin created: admin / admin123');
    }

    // Create default channels if none exist
    const channelCount = await Channel.countDocuments();
    if (channelCount === 0) {
      const adminUser = await User.findOne({ role: 'superadmin' });

      const defaultChannels = [
        { name: 'general', type: 'text', category: 'Text Channels', description: 'General discussion' },
        { name: 'announcements', type: 'announcement', category: 'Text Channels', description: 'Important announcements' },
        { name: 'gaming', type: 'text', category: 'Text Channels', description: 'Gaming discussion' },
        { name: 'general-voice', type: 'voice', category: 'Voice Channels', description: 'General voice chat' },
        { name: 'gaming-voice', type: 'voice', category: 'Voice Channels', description: 'Voice chat for gaming' },
        { name: 'stream-room', type: 'video', category: 'Voice Channels', description: 'Screen sharing and streaming' }
      ];

      for (let i = 0; i < defaultChannels.length; i++) {
        await Channel.create({
          ...defaultChannels[i],
          position: i,
          createdBy: adminUser._id
        });
      }
      console.log('Default channels created');
    }

    // Initialize federation if enabled
    let federationStatus = 'Disabled';
    if (FEDERATION_ENABLED) {
      try {
        const { FederationService } = require('./services/federationService');
        federationService = new FederationService(io);
        await federationService.initialize();
        federationStatus = 'Enabled';
      } catch (err) {
        console.error('Federation failed to initialize:', err.message);
        federationStatus = 'Failed';
      }
    }

    // Bot registry for tracking active sessions
    const botRegistry = require('./services/botRegistry');

    // Initialize YouTube bot service
    try {
      const { YouTubeBotService } = require('./services/youtubeBotService');
      const youtubeBotController = require('./controllers/youtubeBotController');
      youtubeBotService = new YouTubeBotService(io);
      youtubeBotController.initialize(youtubeBotService);
      botRegistry.register('youtube', youtubeBotService);
      console.log('YouTube bot service initialized');
    } catch (err) {
      console.error('YouTube bot service failed to initialize:', err.message);
    }

    // Plex, Jellyfin and Emby: one service, three adapters (services/mediaServerBot.js)
    const { MediaServerBot } = require('./services/mediaServerBot');
    for (const type of ['plex', 'jellyfin', 'emby']) botRegistry.register(type, new MediaServerBot(io, type));

    // Initialize Chrome bot service
    try {
      const { ChromeBotService } = require('./services/chromeBotService');
      const chromeBotController = require('./controllers/chromeBotController');
      const chromeBotService = new ChromeBotService(io);
      chromeBotController.initialize(chromeBotService);
      botRegistry.register('chrome', chromeBotService);
      console.log('Chrome bot service initialized');
    } catch (err) {
      console.error('Chrome bot service failed to initialize:', err.message);
    }

    // Initialize IPTV bot service
    try {
      const { IPTVBotService } = require('./services/iptvBotService');
      const iptvBotController = require('./controllers/iptvBotController');
      const iptvBotService = new IPTVBotService(io);
      iptvBotController.initialize(iptvBotService);
      botRegistry.register('iptv', iptvBotService);
      console.log('IPTV bot service initialized');
    } catch (err) {
      console.error('IPTV bot service failed to initialize:', err.message);
    }

    // Initialize Twitch bot service
    try {
      const TwitchBotService = require('./services/twitchBotService');
      const twitchBotController = require('./controllers/twitchBotController');
      const twitchBotService = new TwitchBotService(io);
      twitchBotController.initialize(twitchBotService);
      botRegistry.register('twitch', twitchBotService);
      console.log('Twitch bot service initialized');
    } catch (err) {
      console.error('Twitch bot service failed to initialize:', err.message);
    }

    // Initialize Group service
    let groupService = null;
    try {
      const { GroupService } = require('./services/groupService');
      const groupController = require('./controllers/groupController');
      const accessControl = require('./middleware/accessControl');
      groupService = new GroupService();
      groupController.initialize(groupService);
      accessControl.initialize(groupService);
      console.log('Group service initialized');
    } catch (err) {
      console.error('Group service failed to initialize:', err.message);
    }

    // Initialize File Share service
    try {
      const { FileShareService } = require('./services/fileShareService');
      const fileShareController = require('./controllers/fileShareController');
      const fileShareService = new FileShareService(io);
      fileShareController.initialize(fileShareService, groupService);
      console.log('File share service initialized');
    } catch (err) {
      console.error('File share service failed to initialize:', err.message);
    }

    // Initialize Game Together service (Virtual controller emulation)
    try {
      const GameTogetherService = require('./services/gameTogetherService');
      const gameTogetherController = require('./controllers/gameTogetherController');
      const gameTogetherService = new GameTogetherService(io);
      gameTogetherController.initialize(gameTogetherService);
      console.log('Game Together service initialized (virtual controller emulation)');
    } catch (err) {
      console.error('Game Together service failed to initialize:', err.message);
    }

    // Start server
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎮  Emberlan Server v1.0.0                               ║
║                                                           ║
║   Server running on port ${PORT}                            ║
║   ${ENABLE_HTTPS ? 'HTTPS' : 'HTTP'}: ${ENABLE_HTTPS ? 'https' : 'http'}://localhost:${PORT}                       ║
║                                                           ║
║   Federation: ${federationStatus.padEnd(8)}                               ║
║                                                           ║
║   Default Admin: admin / admin123                         ║
║   (Change password after first login!)                    ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown. io.close() also closes the HTTP server and drops socket clients, which
// would otherwise keep server.close() waiting forever; the timer is the backstop.
const shutdown = async (sig) => {
  console.log(`${sig} received, shutting down...`);
  setTimeout(() => process.exit(0), 5000).unref();
  if (federationService) await federationService.shutdown().catch(() => {});
  io.close(() => process.exit(0));
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, io, federationService };
