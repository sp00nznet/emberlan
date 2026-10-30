const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, adminOnly } = require('../middleware/auth');
const { requirePermission } = require('../middleware/accessControl');
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const channelController = require('../controllers/channelController');
const userController = require('../controllers/userController');
const federationController = require('../controllers/federationController');
const youtubeBotController = require('../controllers/youtubeBotController');
const { createMediaServerBotController } = require('../controllers/mediaServerBotController');
const botRegistry = require('../services/botRegistry');
const chromeBotController = require('../controllers/chromeBotController');
const iptvBotController = require('../controllers/iptvBotController');
const groupController = require('../controllers/groupController');
const fileShareController = require('../controllers/fileShareController');
const socialAccountsController = require('../controllers/socialAccountsController');
const steamAuthController = require('../controllers/steamAuthController');
const serverSettingsController = require('../controllers/serverSettingsController');
const twoFactorController = require('../controllers/twoFactorController');
const attachmentController = require('../controllers/attachmentController');
const googleAuthController = require('../controllers/googleAuthController');
const twitchBotController = require('../controllers/twitchBotController');
const gameTogetherController = require('../controllers/gameTogetherController');

const router = express.Router();

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/avatars'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user._id}-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;
    if (allowed.test(ext) && allowed.test(mime)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Server icon upload config
const serverIconStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../uploads/server'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `icon-${Date.now()}${ext}`);
  }
});

const serverIconUpload = multer({
  storage: serverIconStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype;
    if (allowed.test(ext) && (allowed.test(mime) || mime === 'image/svg+xml')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// IPTV playlist upload: parsed in memory, the channels are saved (nothing kept on disk).
const iptvPlaylistUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for large playlists
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.m3u' || ext === '.m3u8') {
      cb(null, true);
    } else {
      cb(new Error('Only M3U/M3U8 files are allowed'));
    }
  }
});

// ===== Auth Routes =====
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.get('/auth/me', authenticate, authController.getMe);
router.put('/auth/profile', authenticate, authController.updateProfile);
router.put('/auth/password', authenticate, authController.changePassword);
router.post('/auth/logout', authenticate, authController.logout);

// Google OAuth
router.get('/auth/google/status', googleAuthController.getGoogleAuthStatus);
router.get('/auth/google', googleAuthController.getGoogleAuthUrl);
router.get('/auth/google/callback', googleAuthController.handleGoogleCallback);
router.post('/auth/google/link', authenticate, googleAuthController.linkGoogleAccount);
router.delete('/auth/google/unlink', authenticate, googleAuthController.unlinkGoogleAccount);

// ===== User Routes =====
router.get('/users/:userId', authenticate, userController.getProfile);
router.post('/users/avatar', authenticate, upload.single('avatar'), userController.uploadAvatar);
router.get('/users/:userId/common-games', authenticate, userController.getCommonGames);

// Friends
router.post('/users/:userId/friend-request', authenticate, userController.sendFriendRequest);
router.post('/users/:userId/friend-accept', authenticate, userController.acceptFriendRequest);
router.post('/users/:userId/friend-decline', authenticate, userController.declineFriendRequest);
router.delete('/users/:userId/friend', authenticate, userController.removeFriend);
router.post('/users/:userId/block', authenticate, userController.blockUser);
router.delete('/users/:userId/block', authenticate, userController.unblockUser);

// Direct Messages (End-to-End Encrypted)
router.get('/dm/conversations', authenticate, userController.getConversations);
router.get('/dm/:userId', authenticate, userController.getDirectMessages);
router.get('/dm/:userId/public-key', authenticate, userController.getPublicKey);
router.post('/dm/public-key', authenticate, userController.setPublicKey);

// ===== Channel Routes =====
router.get('/channels', authenticate, channelController.getChannels);
router.get('/channels/:channelId', authenticate, channelController.getChannel);
router.post('/channels', authenticate, adminOnly, channelController.createChannel);
router.put('/channels/:channelId', authenticate, adminOnly, channelController.updateChannel);
router.delete('/channels/:channelId', authenticate, adminOnly, channelController.deleteChannel);
router.get('/channels/:channelId/messages', authenticate, channelController.getMessages);
router.get('/channels/:channelId/pinned', authenticate, channelController.getPinnedMessages);

// ===== Admin Routes =====
router.get('/admin/users', authenticate, adminOnly, adminController.getAllUsers);
router.post('/admin/users', authenticate, adminOnly, adminController.createUser);
router.put('/admin/users/:userId/role', authenticate, adminOnly, adminController.updateUserRole);
router.put('/admin/users/:userId/admin-access', authenticate, adminOnly, adminController.setAdminPanelAccess);
router.put('/admin/users/:userId/ban', authenticate, adminOnly, adminController.toggleUserBan);
router.get('/admin/invites', authenticate, adminOnly, adminController.getInvites);
router.post('/admin/invites', authenticate, adminOnly, adminController.createInvite);
router.delete('/admin/invites/:inviteId', authenticate, adminOnly, adminController.deleteInvite);
router.get('/admin/stats', authenticate, adminOnly, adminController.getStats);

// ===== Federation Routes =====
// Public endpoints (for server-to-server communication)
router.get('/federation/info', federationController.getServerInfo);
router.post('/federation/request', federationController.handleFederationRequest);
router.post('/federation/approved', federationController.handleApprovalNotification);
router.post('/federation/rejected', federationController.handleRejectionNotification);

// Admin endpoints (for managing federation)
router.get('/federation/status', authenticate, adminOnly, federationController.getFederationStatus);
router.get('/federation/servers', authenticate, adminOnly, federationController.getFederatedServers);
router.get('/federation/requests', authenticate, adminOnly, federationController.getPendingRequests);
router.get('/federation/channels', authenticate, adminOnly, federationController.getFederatedChannels);

router.post('/federation/initiate', authenticate, adminOnly, federationController.initiateFederation);
router.post('/federation/analyze', authenticate, adminOnly, federationController.analyzeConflicts);
router.post('/federation/requests/:requestId/approve', authenticate, adminOnly, federationController.approveFederationRequest);
router.post('/federation/requests/:requestId/reject', authenticate, adminOnly, federationController.rejectFederationRequest);

router.put('/federation/servers/:serverId/settings', authenticate, adminOnly, federationController.updateServerSettings);
router.put('/federation/channels/:channelId/sync', authenticate, adminOnly, federationController.toggleChannelSync);

router.post('/federation/servers/:serverId/disconnect', authenticate, adminOnly, federationController.disconnectServer);
router.delete('/federation/servers/:serverId', authenticate, adminOnly, federationController.removeFederation);

// ===== YouTube Bot Routes =====
router.get('/admin/youtube-bot/status', authenticate, youtubeBotController.getStatus);
router.post('/admin/youtube-bot/enable', authenticate, adminOnly, youtubeBotController.setEnabled);
router.get('/admin/youtube-bot/video-info', authenticate, youtubeBotController.getVideoInfo);
router.post('/admin/youtube-bot/play', authenticate, youtubeBotController.play);
router.post('/admin/youtube-bot/stop', authenticate, youtubeBotController.stop);

// ===== Plex / Jellyfin / Emby (services/mediaServerBot.js) =====
// Admins set them up; any logged-in user can see the status (no secrets in it) and search;
// playing and stopping need you in that voice channel (or admin).
const mediaBot = createMediaServerBotController((req) => botRegistry.get(req.params.bot));
const MB = '/admin/:bot(plex|jellyfin|emby)-bot';
router.get(`${MB}/status`, authenticate, mediaBot.getStatus);
router.post(`${MB}/enable`, authenticate, adminOnly, mediaBot.setEnabled);
router.post(`${MB}/connect`, authenticate, adminOnly, mediaBot.connect);
router.post(`${MB}/disconnect`, authenticate, adminOnly, mediaBot.disconnect);
router.get(`${MB}/search`, authenticate, mediaBot.search);
router.post(`${MB}/play`, authenticate, mediaBot.play);
router.post(`${MB}/stop`, authenticate, mediaBot.stop);

// ===== Chrome Bot Routes =====
router.get('/admin/chrome-bot/status', authenticate, adminOnly, chromeBotController.getStatus);
router.post('/admin/chrome-bot/enable', authenticate, adminOnly, chromeBotController.setEnabled);
router.post('/admin/chrome-bot/safe-search', authenticate, adminOnly, chromeBotController.setSafeSearch);
router.post('/admin/chrome-bot/configure', authenticate, adminOnly, chromeBotController.configure);
router.post('/admin/chrome-bot/start', authenticate, adminOnly, chromeBotController.startSession);
router.get('/admin/chrome-bot/session/:channelId', authenticate, chromeBotController.getSession);
router.post('/admin/chrome-bot/navigate', authenticate, chromeBotController.navigate);
router.post('/admin/chrome-bot/back', authenticate, chromeBotController.goBack);
router.post('/admin/chrome-bot/forward', authenticate, chromeBotController.goForward);
router.post('/admin/chrome-bot/refresh', authenticate, chromeBotController.refresh);
router.post('/admin/chrome-bot/stop', authenticate, adminOnly, chromeBotController.stopSession);
router.post('/admin/chrome-bot/join', authenticate, chromeBotController.joinSession);
router.post('/admin/chrome-bot/transfer', authenticate, chromeBotController.transferControl);

// ===== IPTV Bot Routes =====
// Admins set it up; anyone logged in can browse; play/stop need you in that voice channel (or admin).
router.get('/admin/iptv-bot/status', authenticate, iptvBotController.getStatus);
router.post('/admin/iptv-bot/enable', authenticate, adminOnly, iptvBotController.setEnabled);
router.post('/admin/iptv-bot/configure', authenticate, adminOnly, iptvPlaylistUpload.single('playlist'), iptvBotController.configure);
router.get('/admin/iptv-bot/channels', authenticate, iptvBotController.getChannels);
router.get('/admin/iptv-bot/groups', authenticate, iptvBotController.getGroups);
router.get('/admin/iptv-bot/epg/:channelId', authenticate, iptvBotController.getEPG);
router.post('/admin/iptv-bot/play', authenticate, iptvBotController.play);
router.post('/admin/iptv-bot/change-channel', authenticate, iptvBotController.play);
router.post('/admin/iptv-bot/stop', authenticate, iptvBotController.stop);

// Media bot stream proxy (CORS-free playback). Only links the server issued: see services/streamProxy.js.
const streamProxy = require('../services/streamProxy');
router.get('/stream/proxy', async (req, res) => {
  const url = streamProxy.open(req.query.u);
  if (!url) return res.status(403).json({ error: 'Invalid or expired stream link' });
  try {
    const fetch = (await import('node-fetch')).default;
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Emberlan/1.0', ...(req.headers.range && { Range: req.headers.range }) },
      signal: controller.signal,
    });
    if (!upstream.ok) return res.status(upstream.status).json({ error: `Upstream returned ${upstream.status}` });

    const type = upstream.headers.get('content-type') || '';
    if (/mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(new URL(url).pathname + new URL(url).search)) {
      res.type('application/vnd.apple.mpegurl').send(streamProxy.rewriteManifest(await upstream.text(), upstream.url || url));
      return;
    }
    // Pass through what seeking needs (206, ranges, length).
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    upstream.body.on('error', () => res.destroy());
    upstream.body.pipe(res);
  } catch (error) {
    if (error.name === 'AbortError') return;
    if (!res.headersSent) res.status(502).json({ error: 'Stream proxy error: ' + error.message });
  }
});

// ===== Twitch Bot Routes =====
router.get('/admin/twitch-bot/status', authenticate, adminOnly, twitchBotController.getStatus);
router.post('/admin/twitch-bot/enable', authenticate, adminOnly, twitchBotController.setEnabled);
router.post('/admin/twitch-bot/configure', authenticate, adminOnly, twitchBotController.configure);
router.get('/admin/twitch-bot/search', authenticate, twitchBotController.searchStreams);
router.get('/admin/twitch-bot/stream/:username', authenticate, twitchBotController.getStreamInfo);
router.post('/admin/twitch-bot/play', authenticate, twitchBotController.play);
router.post('/admin/twitch-bot/stop', authenticate, twitchBotController.stop);
router.get('/admin/twitch-bot/embed/:username', authenticate, twitchBotController.getEmbedUrl);
router.get('/admin/twitch-bot/channel/:channelId', authenticate, twitchBotController.getActiveStream);

// ===== Game Together Routes (Virtual Controller Emulation) =====
router.get('/admin/game-together/status', authenticate, adminOnly, gameTogetherController.getStatus);
router.post('/admin/game-together/enable', authenticate, adminOnly, gameTogetherController.setEnabled);
router.post('/admin/game-together/start', authenticate, gameTogetherController.startSession);
router.post('/admin/game-together/stop', authenticate, gameTogetherController.stopSession);
router.get('/admin/game-together/sessions', authenticate, gameTogetherController.getSessions);
router.get('/admin/game-together/session/:channelId', authenticate, gameTogetherController.getSession);
router.post('/admin/game-together/join', authenticate, gameTogetherController.joinAsPlayer);
router.post('/admin/game-together/leave', authenticate, gameTogetherController.leaveAsPlayer);

// ===== Channel Moderation Routes =====
router.post('/channels/:channelId/kick/:userId', authenticate, adminOnly, channelController.kickUser);

// ===== Channel Bot Settings Routes =====
router.get('/channels/:channelId/bots', authenticate, channelController.getChannelBotSettings);
router.put('/channels/:channelId/bots', authenticate, adminOnly, channelController.updateChannelBotSettings);
router.put('/channels/:channelId/bots/:botName', authenticate, adminOnly, channelController.toggleChannelBot);
router.get('/channels/:channelId/bots/:botName/enabled', authenticate, channelController.checkBotEnabled);

// ===== Group Management Routes =====
router.get('/admin/groups', authenticate, adminOnly, groupController.getAllGroups);
router.post('/admin/groups', authenticate, adminOnly, groupController.createGroup);
router.get('/admin/groups/features', authenticate, adminOnly, groupController.getAvailableFeatures);
router.get('/admin/groups/:groupId', authenticate, adminOnly, groupController.getGroup);
router.put('/admin/groups/:groupId', authenticate, adminOnly, groupController.updateGroup);
router.delete('/admin/groups/:groupId', authenticate, adminOnly, groupController.deleteGroup);
router.get('/admin/groups/:groupId/members', authenticate, adminOnly, groupController.getGroupMembers);
router.get('/admin/groups/:groupId/permissions', authenticate, adminOnly, groupController.getGroupPermissions);
router.put('/admin/groups/:groupId/permissions', authenticate, adminOnly, groupController.setGroupPermissions);
router.post('/admin/groups/:groupId/users/:userId', authenticate, adminOnly, groupController.addUserToGroup);
router.delete('/admin/groups/:groupId/users/:userId', authenticate, adminOnly, groupController.removeUserFromGroup);
router.get('/admin/users/:userId/groups', authenticate, adminOnly, groupController.getUserGroups);
router.put('/admin/users/:userId/groups', authenticate, adminOnly, groupController.setUserGroups);

// User permission endpoints (non-admin)
router.get('/permissions/me', authenticate, groupController.getMyPermissions);
router.get('/permissions/check/:feature', authenticate, groupController.checkPermission);

// ===== File Share Routes =====
router.get('/admin/file-share/status', authenticate, adminOnly, fileShareController.getStatus);
router.post('/admin/file-share/enable', authenticate, adminOnly, fileShareController.setEnabled);

// User file share endpoints
router.get('/file-share/folders', authenticate, requirePermission('file-share'), fileShareController.getAllSharedFolders);
router.get('/file-share/my-folders', authenticate, requirePermission('file-share'), fileShareController.getMySharedFolders);
router.post('/file-share/folders', authenticate, requirePermission('file-share'), fileShareController.shareFolder);
router.delete('/file-share/folders/:folderId', authenticate, requirePermission('file-share'), fileShareController.unshareFolder);
router.get('/file-share/users/:userId/folders', authenticate, requirePermission('file-share'), fileShareController.getUserSharedFolders);
router.get('/file-share/users/:userId/folders/:folderId/contents', authenticate, requirePermission('file-share'), fileShareController.getFolderContents);
router.post('/file-share/users/:userId/folders/:folderId/download', authenticate, requirePermission('file-share'), fileShareController.requestDownload);


// ===== Social Accounts Routes =====
router.get('/social/accounts', authenticate, socialAccountsController.getLinkedAccounts);
router.post('/social/reddit/link', authenticate, socialAccountsController.linkReddit);
router.post('/social/reddit/verify', authenticate, socialAccountsController.verifyReddit);
router.post('/social/twitter/link', authenticate, socialAccountsController.linkTwitter);
router.post('/social/twitter/verify', authenticate, socialAccountsController.verifyTwitter);
router.post('/social/xbox/link', authenticate, socialAccountsController.linkXbox);
router.post('/social/xbox/verify', authenticate, socialAccountsController.verifyXbox);
router.post('/social/playstation/link', authenticate, socialAccountsController.linkPlayStation);
router.post('/social/playstation/verify', authenticate, socialAccountsController.verifyPlayStation);
router.post('/social/blizzard/link', authenticate, socialAccountsController.linkBlizzard);
router.post('/social/blizzard/verify', authenticate, socialAccountsController.verifyBlizzard);
router.delete('/social/:platform', authenticate, socialAccountsController.unlinkAccount);

// ===== Steam Auth Routes =====
router.post('/steam/auth-url', authenticate, steamAuthController.getAuthUrl);
router.get('/steam/callback', steamAuthController.handleCallback);
router.post('/steam/link', authenticate, steamAuthController.linkSteamManual);
router.get('/steam/profile', authenticate, steamAuthController.getSteamProfile);
router.delete('/steam/unlink', authenticate, steamAuthController.unlinkSteam);

// ===== Server Settings Routes =====
router.get('/settings', authenticate, serverSettingsController.getPublicSettings);
router.get('/admin/settings', authenticate, adminOnly, serverSettingsController.getSettings);
router.put('/admin/settings', authenticate, adminOnly, serverSettingsController.updateSettings);
router.get('/admin/settings/video', authenticate, adminOnly, serverSettingsController.getVideoSettings);
router.put('/admin/settings/video', authenticate, adminOnly, serverSettingsController.updateVideoSettings);
router.get('/admin/settings/languages', authenticate, serverSettingsController.getSupportedLanguages);
router.get('/admin/settings/bots', authenticate, adminOnly, serverSettingsController.getBotStatus);
router.put('/admin/settings/bots', authenticate, adminOnly, serverSettingsController.updateBotStatus);

// Server icon
router.get('/settings/icon', serverSettingsController.getServerIcon);
router.post('/admin/settings/icon', authenticate, adminOnly, serverIconUpload.single('icon'), serverSettingsController.uploadServerIcon);
router.delete('/admin/settings/icon', authenticate, adminOnly, serverSettingsController.deleteServerIcon);

// ===== Two-Factor Authentication Routes =====
router.get('/auth/2fa/status', authenticate, twoFactorController.getStatus);
router.post('/auth/2fa/setup', authenticate, twoFactorController.setupStart);
router.post('/auth/2fa/verify-setup', authenticate, twoFactorController.setupComplete);
router.post('/auth/2fa/disable', authenticate, twoFactorController.disable);
router.post('/auth/2fa/verify', twoFactorController.verify); // No auth - used during login
router.post('/auth/2fa/backup-codes', authenticate, twoFactorController.regenerateBackupCodes);

// ===== Attachment Routes =====
router.post('/attachments/upload', authenticate, attachmentController.uploadFiles);
router.delete('/attachments/:filename', authenticate, attachmentController.deleteAttachment);

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
