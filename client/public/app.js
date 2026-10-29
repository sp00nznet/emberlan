// Emberlan Electron Client
// Desktop Application for Emberlan Gaming Community

// Audio context for notification sounds
let audioContext = null;

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Play notification tone for voice channel events
function playVoiceNotification(type) {
  // Check if sounds are enabled in settings
  if (state.settings?.enableSounds === false) return;

  try {
    const ctx = getAudioContext();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Set volume (soft notification)
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);

    if (type === 'join') {
      // Rising tone for join - pleasant soft chime
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(440, ctx.currentTime); // A4
      oscillator.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.1); // A5
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);
    } else if (type === 'leave') {
      // Falling tone for leave - soft descending tone
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(660, ctx.currentTime); // E5
      oscillator.frequency.linearRampToValueAtTime(330, ctx.currentTime + 0.15); // E4
      gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.2);
    }
  } catch (e) {
    // Audio not supported or blocked, silently ignore
    console.log('Audio notification not available');
  }
}

// State
const state = {
  user: null,
  token: null,
  serverUrl: null,
  socket: null,
  channels: [],
  currentChannel: null,
  messages: [],
  inVoice: false,
  voiceChannel: null,
  isMuted: false,
  isDeafened: false,
  isCameraOn: false,
  isScreenSharing: false,
  isPTTActive: false,
  localStream: null,
  cameraStream: null,
  screenStreams: {}, // Multiple screen shares: { shareId: stream }
  settings: {},
  devices: {
    audioInputs: [],
    audioOutputs: [],
    videoInputs: []
  },
  // Multi-server support
  servers: [], // Array of { id, name, url, token, user, icon }
  currentServerId: null,
  theme: 'dark', // Current theme
  // Pending attachments for current message
  pendingAttachments: [],
  // Modal navigation - track previous modal for back button
  previousModal: null,
  // Direct Messages (End-to-End Encrypted)
  dmConversations: [], // List of DM conversations
  currentDMUser: null, // Currently selected DM user
  dmMessages: [], // Messages in current DM conversation
  cryptoKeys: null, // { publicKey, privateKey } for E2E encryption
  publicKeyCache: {} // Cache of other users' public keys
};

// ==================== E2E Encryption Utilities ====================

// Generate RSA key pair for E2E encryption
async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    },
    true,
    ['encrypt', 'decrypt']
  );
  return keyPair;
}

// Export public key to JWK format for storage/sharing
async function exportPublicKey(publicKey) {
  return JSON.stringify(await window.crypto.subtle.exportKey('jwk', publicKey));
}

// Import public key from JWK string
async function importPublicKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
}

// Export private key to JWK for local storage
async function exportPrivateKey(privateKey) {
  return JSON.stringify(await window.crypto.subtle.exportKey('jwk', privateKey));
}

// Import private key from JWK
async function importPrivateKey(jwkString) {
  const jwk = JSON.parse(jwkString);
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['decrypt']
  );
}

// Generate AES key for message encryption
async function generateAESKey() {
  return window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

// Encrypt message with AES
async function encryptMessage(message, aesKey) {
  const encoder = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoder.encode(message)
  );
  return {
    encryptedContent: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv: btoa(String.fromCharCode(...iv))
  };
}

// Decrypt message with AES
async function decryptMessage(encryptedContent, iv, aesKey) {
  const decoder = new TextDecoder();
  const encryptedBytes = Uint8Array.from(atob(encryptedContent), c => c.charCodeAt(0));
  const ivBytes = Uint8Array.from(atob(iv), c => c.charCodeAt(0));
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    aesKey,
    encryptedBytes
  );
  return decoder.decode(decrypted);
}

// Encrypt AES key with recipient's public key
async function encryptAESKey(aesKey, recipientPublicKey) {
  const exportedKey = await window.crypto.subtle.exportKey('raw', aesKey);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'RSA-OAEP' },
    recipientPublicKey,
    exportedKey
  );
  return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}

// Decrypt AES key with our private key
async function decryptAESKey(encryptedKey, privateKey) {
  const encryptedBytes = Uint8Array.from(atob(encryptedKey), c => c.charCodeAt(0));
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    encryptedBytes
  );
  return window.crypto.subtle.importKey(
    'raw',
    decrypted,
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt']
  );
}

// Initialize or load encryption keys
async function initializeCryptoKeys() {
  const storedPrivateKey = localStorage.getItem('dm_private_key');
  const storedPublicKey = localStorage.getItem('dm_public_key');

  if (storedPrivateKey && storedPublicKey) {
    try {
      state.cryptoKeys = {
        privateKey: await importPrivateKey(storedPrivateKey),
        publicKey: await importPublicKey(storedPublicKey)
      };
      return;
    } catch (e) {
      console.warn('Failed to load stored keys, generating new ones');
    }
  }

  // Generate new key pair
  const keyPair = await generateKeyPair();
  state.cryptoKeys = keyPair;

  // Store locally
  localStorage.setItem('dm_private_key', await exportPrivateKey(keyPair.privateKey));
  localStorage.setItem('dm_public_key', await exportPublicKey(keyPair.publicKey));

  // Upload public key to server
  if (state.socket) {
    const publicKeyJwk = await exportPublicKey(keyPair.publicKey);
    state.socket.emit('dm:setPublicKey', { publicKey: publicKeyJwk });
  }
}

// Initialize application
async function init() {
  // Web client uses relative URLs (nginx proxies to backend)
  // For Electron, load settings from electron store
  if (window.electronAPI) {
    state.settings = await window.electronAPI.getSettings();
    state.serverUrl = state.settings.serverUrl;
    state.token = state.settings.token;
    state.servers = state.settings.servers || [];
    state.theme = state.settings.theme || 'dark';

    // Apply saved theme
    applyTheme(state.theme);

    // Set up IPC listeners
    setupIPCListeners();

    // If we have saved servers, try to auto-connect to the first one
    if (state.servers.length > 0) {
      const firstServer = state.servers[0];
      state.serverUrl = firstServer.url;
      state.token = firstServer.token;
      state.currentServerId = firstServer.id;
      document.getElementById('serverUrl').value = firstServer.url;
      tryAutoLogin();
    } else if (state.token && state.serverUrl) {
      // Legacy single server support
      document.getElementById('serverUrl').value = state.serverUrl;
      tryAutoLogin();
    }
  } else {
    // Web client - detect if running on different port than API
    // In development, client is on 3000, API is on 3001
    if (window.location.port === '3000') {
      state.serverUrl = `${window.location.protocol}//${window.location.hostname}:3001`;
    } else {
      // Production or same-origin: use relative URLs
      state.serverUrl = '';
    }
    document.getElementById('serverUrl').value = state.serverUrl;

    // Try to resume a saved web session. If a Google OAuth callback is in the URL
    // (?googleAuth=success&token=...), let setupGoogleAuth() handle that instead — it
    // runs after this and will overwrite state.token with the fresh one from the callback.
    const callbackParams = new URLSearchParams(window.location.search);
    const isGoogleCallback = callbackParams.get('googleAuth') === 'success';
    if (!isGoogleCallback) {
      const saved = loadWebSession();
      if (saved.token) {
        state.token = saved.token;
        if (saved.serverUrl) state.serverUrl = saved.serverUrl;
        tryAutoLogin();
      }
    }
  }

  // Set up form handler
  document.getElementById('connectionForm').addEventListener('submit', handleConnect);

  // Set up Google OAuth (shows button if server has it enabled, handles callback)
  setupGoogleAuth();

  // Populate the Ember login extras (server address display + recent servers)
  renderLoginExtras();

  // Set up in-window PTT keyboard handling
  // PTT only works when window is focused (safer than global hotkeys)
  setupPTTKeyboard();
}

// Set up Google OAuth: handle callback redirect, show button if enabled, wire click handler
async function setupGoogleAuth() {
  // If we just came back from Google's callback, the server redirected with ?googleAuth=success&token=...
  const params = new URLSearchParams(window.location.search);
  if (params.get('googleAuth') === 'success' && params.get('token')) {
    const token = params.get('token');
    // Clean the URL so a refresh doesn't replay the token
    window.history.replaceState({}, document.title, window.location.pathname);

    state.token = token;
    try {
      const meRes = await fetch(`${state.serverUrl}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (meRes.ok) {
        const data = await meRes.json();
        state.user = data.user;
        if (window.electronAPI) {
          await window.electronAPI.saveToken(token);
        } else {
          // Google sign-in always persists on the web — the user already opted in by
          // clicking the button, and re-doing the full OAuth dance on every reload
          // is worse UX than the implicit "remember me" the username/password form has.
          saveWebSession(token, state.serverUrl);
        }
        showMainApp();
        connectSocket();
        return;
      }
    } catch (err) {
      console.error('Google auth: failed to fetch user after callback', err);
    }
    // Fall through to login screen if /auth/me failed
    state.token = null;
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) errorEl.textContent = 'Google sign-in completed but session is invalid. Try again.';
  } else if (params.get('googleAuth') === 'error') {
    window.history.replaceState({}, document.title, window.location.pathname);
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) errorEl.textContent = 'Google sign-in failed.';
  }

  // Ask server whether Google OAuth is configured. If yes, reveal the button.
  try {
    const statusRes = await fetch(`${state.serverUrl}/api/auth/google/status`);
    if (!statusRes.ok) return;
    const status = await statusRes.json();
    if (!status.enabled) return;

    const section = document.getElementById('googleAuthSection');
    const btn = document.getElementById('googleSignInBtn');
    if (!section || !btn) return;
    section.style.display = '';

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const errorEl = document.getElementById('errorMessage');
      if (errorEl) errorEl.textContent = '';
      try {
        // Pass baseUrl explicitly — behind Cloudflare Tunnel the server sees http://, not https://,
        // so the callback URL it builds wouldn't match Google's registered redirect URI without this.
        const origin = window.location.origin;
        const urlRes = await fetch(
          `${state.serverUrl}/api/auth/google?baseUrl=${encodeURIComponent(origin)}`
        );
        if (!urlRes.ok) throw new Error('Failed to start Google sign-in');
        const { url } = await urlRes.json();
        window.location.href = url;
      } catch (err) {
        console.error('Google sign-in failed to start', err);
        if (errorEl) errorEl.textContent = err.message || 'Google sign-in failed.';
        btn.disabled = false;
      }
    });
  } catch (err) {
    // Server unreachable or no Google endpoint — silently leave button hidden
    console.debug('Google auth status check failed (button stays hidden):', err);
  }
}

// Fill the Ember login screen's server-address field and recent-servers list
function renderLoginExtras() {
  const addrEl = document.getElementById('serverAddress');
  if (addrEl) {
    let host = '';
    try {
      const raw = state.serverUrl || window.location.origin;
      host = new URL(raw, window.location.origin).host;
    } catch { host = window.location.host; }
    addrEl.value = host || '';
    // Desktop has no serving origin to inherit — let the user type a server.
    if (window.electronAPI) addrEl.removeAttribute('readonly');
  }

  const list = document.getElementById('recentServers');
  const divider = document.querySelector('.recent-divider');
  if (!list) return;

  const servers = state.servers || [];
  if (!servers.length) {
    list.innerHTML = '';
    if (divider) divider.style.display = 'none';
    return;
  }
  if (divider) divider.style.display = '';

  list.innerHTML = servers.map((s, i) => {
    const tag = (s.icon || s.name || '?').substring(0, 2).toUpperCase();
    const color = getServerColor(s, i);
    let host = s.url || '';
    try { host = new URL(s.url, window.location.origin).host; } catch {}
    return `
      <button type="button" class="recent-server" onclick="switchServer('${s.id}')">
        <div class="tag" style="background:${color};">${escapeHtml(tag)}</div>
        <div class="meta">
          <div class="name">${escapeHtml(s.name || 'Server')}</div>
          <div class="addr">${escapeHtml(host)}</div>
        </div>
        <div class="online"><div class="n">●</div><div class="lbl">saved</div></div>
      </button>`;
  }).join('');
}

// Set up push-to-talk keyboard handling within the window
function setupPTTKeyboard() {
  let pttKeyDown = false;

  document.addEventListener('keydown', (e) => {
    // Skip if typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Check if PTT is enabled and this is the PTT key
    const pttKey = state.settings?.pushToTalkKey;
    if (!pttKey || state.settings?.voiceActivated) return;

    // Map key names
    const pressedKey = e.code; // e.g., 'Space', 'KeyV', 'F1'

    if (pressedKey === pttKey && !pttKeyDown && state.inVoice) {
      pttKeyDown = true;
      e.preventDefault();
      state.isPTTActive = true;
      if (state.localStream) {
        state.localStream.getAudioTracks().forEach(t => t.enabled = true);
      }
      showPTTIndicator(true);
    }
  });

  document.addEventListener('keyup', (e) => {
    const pttKey = state.settings?.pushToTalkKey;
    if (!pttKey || state.settings?.voiceActivated) return;

    const pressedKey = e.code;

    if (pressedKey === pttKey && pttKeyDown) {
      pttKeyDown = false;
      e.preventDefault();
      state.isPTTActive = false;
      if (state.localStream && state.isMuted) {
        state.localStream.getAudioTracks().forEach(t => t.enabled = false);
      }
      showPTTIndicator(false);
    }
  });
}

// Set up IPC listeners from main process
function setupIPCListeners() {
  window.electronAPI.onToggleMute(() => {
    toggleMute();
  });

  window.electronAPI.onToggleDeafen(() => {
    toggleDeafen();
  });

  window.electronAPI.onPTTStart(() => {
    if (!state.settings.voiceActivated && state.inVoice && state.isMuted) {
      state.isPTTActive = true;
      if (state.localStream) {
        state.localStream.getAudioTracks().forEach(t => t.enabled = true);
      }
      showPTTIndicator(true);
    }
  });

  window.electronAPI.onPTTEnd(() => {
    if (state.isPTTActive) {
      state.isPTTActive = false;
      if (state.localStream && state.isMuted) {
        state.localStream.getAudioTracks().forEach(t => t.enabled = false);
      }
      showPTTIndicator(false);
    }
  });

  window.electronAPI.onOpenSettings(() => {
    openSettings();
  });
}

// Web-client session persistence (Electron has its own electron-store path)
const WEB_TOKEN_KEY = 'f7lans_token';
const WEB_SERVER_URL_KEY = 'f7lans_serverUrl';

function saveWebSession(token, serverUrl) {
  try {
    localStorage.setItem(WEB_TOKEN_KEY, token);
    if (serverUrl !== undefined && serverUrl !== null) {
      localStorage.setItem(WEB_SERVER_URL_KEY, serverUrl);
    }
  } catch (e) {
    console.warn('Could not persist session (storage unavailable):', e);
  }
}

function loadWebSession() {
  try {
    return {
      token: localStorage.getItem(WEB_TOKEN_KEY),
      serverUrl: localStorage.getItem(WEB_SERVER_URL_KEY)
    };
  } catch (e) {
    return { token: null, serverUrl: null };
  }
}

function clearWebSession() {
  try {
    localStorage.removeItem(WEB_TOKEN_KEY);
    localStorage.removeItem(WEB_SERVER_URL_KEY);
  } catch (e) {
    // ignore
  }
}

// Try auto login with saved token
async function tryAutoLogin() {
  try {
    const response = await fetch(`${state.serverUrl}/api/auth/me`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    if (response.ok) {
      const data = await response.json();
      state.user = data.user;
      showMainApp();
      connectSocket();
    } else {
      // Token invalid, clear it
      if (window.electronAPI) {
        await window.electronAPI.clearToken();
      } else {
        clearWebSession();
      }
      state.token = null;
    }
  } catch (error) {
    console.error('Auto-login failed:', error);
  }
}

// Handle connection form submit
async function handleConnect(e) {
  e.preventDefault();

  let serverUrl = document.getElementById('serverUrl').value.trim();
  // Desktop: the visible, editable field is the server address (no same-origin to fall back on).
  if (window.electronAPI) {
    let addr = document.getElementById('serverAddress').value.trim();
    if (addr) {
      if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr;
      serverUrl = addr;
    }
  }
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;

  const btn = e.target.querySelector('button[type="submit"]');
  const errorEl = document.getElementById('errorMessage');

  btn.disabled = true;
  btn.innerHTML = '<div class="loading-spinner"></div>';
  errorEl.textContent = '';

  try {
    // Validate server URL
    const cleanUrl = serverUrl.replace(/\/$/, '');

    // Try to login
    const response = await fetch(`${cleanUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Save credentials
    state.user = data.user;
    state.token = data.token;
    state.serverUrl = cleanUrl;

    if (window.electronAPI && rememberMe) {
      await window.electronAPI.saveToken(data.token);
      await window.electronAPI.setServerUrl(cleanUrl);
    } else if (!window.electronAPI && rememberMe) {
      saveWebSession(data.token, cleanUrl);
    }

    // Show main app
    showMainApp();
    connectSocket();

    // Update tray
    if (window.electronAPI) {
      window.electronAPI.updateTrayStatus('Online');
    }

  } catch (error) {
    errorEl.textContent = error.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect';
  }
}

// Connect to Socket.io server
function connectSocket() {
  state.socket = io(state.serverUrl, {
    auth: { token: state.token },
    transports: ['websocket', 'polling']
  });

  state.socket.on('connect', () => {
    console.log('Connected to Emberlan server');
    showToast('Connected to server', 'success');
    loadChannels();
  });

  state.socket.on('disconnect', () => {
    showToast('Disconnected from server', 'warning');
    if (window.electronAPI) {
      window.electronAPI.updateTrayStatus('Disconnected');
    }
  });

  state.socket.on('error', (data) => {
    showToast(data.message, 'error');
  });

  // Message handlers
  state.socket.on('message:new', (message) => {
    if (state.currentChannel && message.channel === state.currentChannel._id) {
      state.messages.push(message);
      renderMessages();
      scrollToBottom();
    }

    // Desktop notification if window not focused
    if (window.electronAPI && document.hidden) {
      const author = message.author.displayName || message.author.username;
      window.electronAPI.showNotification(`${author} in #${state.currentChannel?.name || 'channel'}`, message.content.substring(0, 100));
      window.electronAPI.flashWindow();
    }
  });

  state.socket.on('message:updated', (message) => {
    const idx = state.messages.findIndex(m => m._id === message._id);
    if (idx !== -1) {
      state.messages[idx] = message;
      renderMessages();
    }
  });

  state.socket.on('message:deleted', (data) => {
    state.messages = state.messages.filter(m => m._id !== data.messageId);
    renderMessages();
  });

  // Voice handlers
  state.socket.on('voice:userJoined', (data) => {
    showToast(`${data.user.displayName || data.user.username} joined voice`, 'info');
    playVoiceNotification('join');
    renderVoiceUsers();
    loadChannels(); // Refresh channel user counts
  });

  state.socket.on('voice:userLeft', (data) => {
    playVoiceNotification('leave');
    renderVoiceUsers();
    loadChannels();
  });

  state.socket.on('voice:currentUsers', (data) => {
    renderVoiceUsers(data.users);
  });

  // ===== Game Together Event Handlers =====
  state.socket.on('gameTogether:session-started', (data) => {
    showToast(`🎮 Game Together session started by ${data.hostUsername}`, 'success');
    console.log('[Game Together] Session started:', data);
  });

  state.socket.on('gameTogether:session-stopped', (data) => {
    showToast('Game Together session ended', 'info');

    // Clean up if we were in this session
    if (state.gameTogether?.active) {
      stopGameTogetherGamepadPolling();
      state.gameTogether.active = false;
      state.gameTogether.isHost = false;
      state.gameTogether.hostUserId = null;
      state.gameTogether.playerSlot = null;
    }
  });

  state.socket.on('gameTogether:player-joined', (data) => {
    showToast(`${data.username} joined as Player ${data.playerSlot}`, 'success');
    console.log('[Game Together] Player joined:', data);
  });

  state.socket.on('gameTogether:player-left', (data) => {
    showToast(`Player ${data.playerSlot} left the session`, 'info');
    console.log('[Game Together] Player left:', data);
  });

  state.socket.on('gameTogether:input-received', (data) => {
    // Input acknowledged by server (optional for debugging)
    // console.log('[Game Together] Input received by server');
  });

  // YouTube bot events
  state.socket.on('youtube:playing', (data) => {
    console.log('[YouTube] Now playing:', data);
    addBotVideoToGrid('youtube', data.title, data.url, data.thumbnail);
    showToast(`Now playing: ${data.title}`, 'success');
  });

  state.socket.on('youtube:stopped', (data) => {
    console.log('[YouTube] Stopped');
    removeBotVideoFromGrid('youtube');
    showToast('YouTube playback stopped', 'info');
  });

  // IPTV bot events
  state.socket.on('iptv:playing', (data) => {
    console.log('[IPTV] Now playing:', data);
    console.log('[IPTV] Original stream URL:', data.streamUrl);

    // Try to get HLS version of the stream (many providers support .m3u8 suffix)
    let streamUrl = data.streamUrl;
    if (!streamUrl.includes('.m3u8')) {
      // Remove any existing extension and add .m3u8 for HLS
      streamUrl = streamUrl.replace(/\.[^/.]+$/, '') + '.m3u8';
      // If no extension was present, just append
      if (!streamUrl.endsWith('.m3u8')) {
        streamUrl = data.streamUrl + '.m3u8';
      }
    }

    // Proxy the stream through our server to bypass CORS
    const proxyUrl = `${state.serverUrl}/api/stream/proxy?url=${encodeURIComponent(streamUrl)}`;
    console.log('[IPTV] Proxy URL (HLS):', proxyUrl);
    addBotVideoToGrid('iptv', data.channelName || 'Live TV', proxyUrl, null);
    showToast(`Now watching: ${data.channelName || 'Live TV'}`, 'success');
  });

  state.socket.on('iptv:stopped', (data) => {
    console.log('[IPTV] Stopped');
    removeBotVideoFromGrid('iptv');
    showToast('IPTV playback stopped', 'info');
  });

  // Chrome bot events
  state.socket.on('chrome:session-started', (data) => {
    console.log('[Chrome] Session started event received:', data);
    console.log('[Chrome] Current voice state - inVoice:', state.inVoice, 'voiceChannel:', state.voiceChannel?._id);
    addBotVideoToGrid('chrome', `Shared Browser: ${data.url}`, data.url, null);
    showToast('Browser session started', 'success');
  });

  state.socket.on('chrome:navigate', (data) => {
    console.log('[Chrome] Navigate:', data);
    // Update the iframe with new URL
    addBotVideoToGrid('chrome', `Shared Browser: ${data.url}`, data.url, null);
  });

  state.socket.on('chrome:session-ended', (data) => {
    console.log('[Chrome] Session ended event received:', data);
    console.log('[Chrome] Removing chrome tile from grid');
    removeBotVideoFromGrid('chrome');
    showToast('Browser session ended', 'info');
  });

  // Plex/Emby/Jellyfin events
  state.socket.on('media:playing', (data) => {
    console.log('[Media] Now playing:', data);
    const label = `${data.source}: ${data.title}`;

    // Prepend serverUrl to relative API paths (proxy URLs)
    let streamUrl = data.streamUrl;
    if (streamUrl && streamUrl.startsWith('/api/')) {
      streamUrl = `${state.serverUrl}${streamUrl}`;
    }

    let thumbnail = data.thumbnail;
    if (thumbnail && thumbnail.startsWith('/api/')) {
      thumbnail = `${state.serverUrl}${thumbnail}`;
    }

    console.log('[Media] Stream URL:', streamUrl);
    addBotVideoToGrid(`media-${data.source}`, label, streamUrl, thumbnail);
    showToast(`Now playing: ${data.title}`, 'success');
  });

  state.socket.on('media:stopped', (data) => {
    console.log('[Media] Stopped:', data);
    removeBotVideoFromGrid(`media-${data.source}`);
    showToast(`${data.source} playback stopped`, 'info');
  });

  // Twitch bot events
  state.socket.on('twitch:started', (data) => {
    console.log('[Twitch] Stream started:', data);
    const embedUrl = `https://player.twitch.tv/?channel=${data.streamer}&parent=${window.location.hostname}&autoplay=true`;
    addBotVideoToGrid('twitch', `Twitch: ${data.streamer}`, embedUrl, null);
    showToast(`Now watching: ${data.streamer} on Twitch`, 'success');
  });

  state.socket.on('twitch:stopped', (data) => {
    console.log('[Twitch] Stream stopped');
    removeBotVideoFromGrid('twitch');
    showToast('Twitch stream stopped', 'info');
  });

  // Direct Message events
  state.socket.on('dm:new', async (dm) => {
    console.log('[DM] New message:', dm);
    // Decrypt the message
    try {
      if (state.cryptoKeys?.privateKey && dm.encryptedKey) {
        const aesKey = await decryptAESKey(dm.encryptedKey, state.cryptoKeys.privateKey);
        dm.decryptedContent = await decryptMessage(dm.encryptedContent, dm.iv, aesKey);
      }
    } catch (e) {
      console.error('Failed to decrypt DM:', e);
      dm.decryptedContent = '[Unable to decrypt message]';
    }

    // Add to DM messages if viewing this conversation
    const otherUserId = dm.sender._id === state.user._id ? dm.recipient : dm.sender._id;
    if (state.currentDMUser?._id === otherUserId) {
      state.dmMessages.push(dm);
      renderDMMessages();
    }

    // Update conversation list
    loadDMConversations();

    // Show notification
    if (dm.sender._id !== state.user._id) {
      showToast(`DM from ${dm.sender.displayName || dm.sender.username}`, 'info');
    }
  });

  state.socket.on('dm:publicKey', (data) => {
    state.publicKeyCache[data.userId] = data.publicKey;
  });

  // Initialize E2E encryption keys
  initializeCryptoKeys();
}

// Show main app UI
function showMainApp() {
  document.getElementById('connectionScreen').style.display = 'none';
  document.getElementById('mainApp').style.display = 'grid';

  renderMainApp();

  // Initialize drag-drop after render
  setTimeout(() => setupDragDrop(), 100);
}

// Render main application
function renderMainApp() {
  const mainApp = document.getElementById('mainApp');

  const currentServer = state.servers.find(s => s.id === state.currentServerId);
  const serverName = currentServer?.name || 'Emberlan';

  const userInitial = (state.user?.displayName || state.user?.username || 'U')[0].toUpperCase();
  const userActivity = state.user?.customStatus || 'Online';

  mainApp.innerHTML = `
    <nav class="server-list">
      <div class="rail-home coal" title="Home · Direct Messages" onclick="goHome()"></div>
      <div class="rail-label">NET</div>
      ${state.servers.map((server, i) => {
        const tag = (server.icon || server.name.substring(0, 2)).toUpperCase().slice(0, 2);
        const color = getServerColor(server, i);
        return `
        <div class="server-icon ${server.id === state.currentServerId ? 'active' : ''}"
             title="${escapeHtml(server.name)}"
             onclick="switchServer('${server.id}')"
             data-server-id="${server.id}" data-color="1"
             style="--srv-color:${color};">
          ${escapeHtml(tag)}
        </div>`;
      }).join('')}
      ${state.servers.length === 0 ? `
        <div class="server-icon active" title="${escapeHtml(serverName)}" data-color="1" style="--srv-color:var(--ember);">${escapeHtml(serverName.substring(0,2).toUpperCase())}</div>
      ` : ''}
      <div class="server-icon add-server" title="Add Server" onclick="openAddServerModal()">+</div>
      <div class="rail-spacer"></div>
      <div class="rail-explore" title="Explore servers" onclick="openAddServerModal()">⌖</div>
    </nav>

    <aside class="channel-sidebar">
      <div class="server-header" onclick="openServerMenu(event)">
        <h2>${escapeHtml(serverName)}</h2>
        <span>⌄</span>
      </div>

      <div class="sidebar-search">🔍 Search</div>

      <div class="channels-container" id="channelsList"></div>

      <div class="dm-section" id="dmSection">
        <div class="channel-category"><span>Direct Messages</span></div>
        <div id="dmUsersList"></div>
      </div>

      <div class="voice-status" id="voiceStatus" style="display: none;">
        <div class="voice-info">
          <div class="status-dot"></div>
          <div>
            <div class="voice-text">Voice Connected</div>
            <div class="channel-name-small" id="connectedChannelName"></div>
          </div>
        </div>
        <div class="voice-controls">
          <button class="voice-btn" id="muteBtn" onclick="toggleMute()" title="Mute">🎙</button>
          <button class="voice-btn" id="deafenBtn" onclick="toggleDeafen()" title="Deafen">🎧</button>
          <button class="voice-btn" onclick="toggleScreenShare()" title="Share Screen">🖥</button>
          <button class="voice-btn disconnect" onclick="leaveVoice()" title="Disconnect">⏏</button>
        </div>
      </div>

      <div class="user-panel">
        <div class="user-avatar" onclick="openSettings()">
          ${state.user?.avatar ? `<img src="${state.user.avatar}">` : userInitial}
          <div class="status-indicator online"></div>
        </div>
        <div class="user-info">
          <div class="user-name">${escapeHtml(state.user?.displayName || state.user?.username || 'User')}</div>
          <div class="user-tag">${escapeHtml(userActivity)}</div>
        </div>
        <div class="user-controls">
          <button class="user-btn" onclick="toggleMute()" title="Mute">🎙</button>
          <button class="user-btn" onclick="openSettings()" title="Settings">⚙</button>
        </div>
      </div>
    </aside>

    <main class="main-content">
      <header class="channel-header">
        <span class="hash">#</span>
        <h3 id="channelName">general</h3>
        <div class="divider"></div>
        <span class="description" id="channelDescription"></span>
        <div class="fed-pill" onclick="openFederationModal()"><span class="glyph">◈</span> Federation</div>
        <div class="header-actions">
          <button class="header-btn" id="chatFullscreenBtn" onclick="toggleChatFullscreen()" title="Fullscreen">⛶</button>
          <button class="header-btn" id="membersToggleBtn" onclick="toggleMembers()" title="Members">☰</button>
          <button class="header-btn" onclick="openSettings()" title="Settings">⚙</button>
        </div>
      </header>

      <div class="messages-area" id="messagesArea"></div>

      <div class="typing-indicator" id="typingIndicator" style="display:none;"></div>

      <div class="message-input-container">
        <div class="message-input-wrapper">
          <div class="input-actions-left">
            <button class="input-btn" title="Attach Image" onclick="openFilePicker()">+</button>
            <span class="input-prefix" id="composerPrefix">[#general]</span>
          </div>
          <textarea class="message-input" id="messageInput"
            placeholder="Message #general"
            rows="1"
            onkeydown="handleInputKeyDown(event)"></textarea>
          <div class="input-actions-right">
            <button class="input-btn" title="GIF">GIF</button>
            <button class="input-btn" title="Emoji">☺</button>
            <button class="send-btn" title="Send" onclick="sendMessage()">➤</button>
          </div>
        </div>
      </div>
    </main>

    <aside class="members-panel" id="membersPanel" style="display:none;">
      <div id="membersList"></div>
    </aside>

    <aside class="voice-panel" id="voicePanel" style="display: none;">
      <div class="voice-panel-header">
        <span style="font-family:var(--font-mono);color:var(--ember-light);">🔊</span>
        <h3 id="voicePanelTitle">Voice</h3>
        <span class="voice-quality"><span style="width:6px;height:6px;border-radius:50%;background:var(--on);display:inline-block;"></span>Excellent · 24ms</span>
        <button class="header-btn" id="voicePanelFullscreenBtn" onclick="toggleVoicePanelFullscreen()" title="Fullscreen">⛶</button>
      </div>
      <div class="voice-panel-content" style="overflow-y: auto; flex: 1;">
        <div id="videoGrid" class="video-grid" style="margin-bottom: 4px;"></div>
        <div class="voice-participants">
          <h4>In Voice — <span id="participantCount">0</span></h4>
          <div id="participantsList"></div>
        </div>
      </div>
      <div class="voice-actions">
        <button class="action-btn" id="micBtnPanel" onclick="toggleMute()">
          <span class="icon">🎙</span><span class="label">Mic</span>
        </button>
        <button class="action-btn" id="deafenBtnPanel" onclick="toggleDeafen()">
          <span class="icon">🎧</span><span class="label">Deafen</span>
        </button>
        <button class="action-btn" id="camBtnPanel" onclick="toggleCamera()">
          <span class="icon">🎥</span><span class="label">Camera</span>
        </button>
        <button class="action-btn primary" id="shareBtnPanel" onclick="toggleScreenShare()">
          <span class="icon">🖥</span><span class="label">Share</span>
        </button>
        <button class="action-btn" onclick="openBotsModal()">
          <span class="icon">🤖</span><span class="label">Bots</span>
        </button>
        <button class="action-btn danger" onclick="leaveVoice()">
          <span class="icon">⏏</span><span class="label">Leave</span>
        </button>
      </div>
    </aside>

    <div class="ptt-indicator" id="pttIndicator">🎤 Transmitting...</div>
    <div class="toast-container" id="toastContainer"></div>
    <div class="modal-overlay" id="modalOverlay" onclick="closeModal()">
      <div class="modal" onclick="event.stopPropagation()" id="modalContent"></div>
    </div>
  `;
}

// Load channels from server
async function loadChannels() {
  try {
    const response = await fetch(`${state.serverUrl}/api/channels`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    state.channels = data.channels;
    renderChannels();

    // Load DM conversations
    loadDMConversations();

    // Select first text channel if none selected
    if (!state.currentChannel) {
      const textChannel = state.channels.find(c => c.type === 'text');
      if (textChannel) selectChannel(textChannel);
    }
  } catch (error) {
    showToast('Failed to load channels', 'error');
  }
}

// Render channels list
function renderChannels() {
  const container = document.getElementById('channelsList');
  if (!container) return;

  const isAdmin = state.user?.role === 'admin' || state.user?.role === 'superadmin';

  const grouped = state.channels.reduce((acc, ch) => {
    const cat = ch.category || 'General';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(ch);
    return acc;
  }, {});

  let html = '';

  // Add create channel button for admins
  if (isAdmin) {
    html += `<div class="channel create-channel" onclick="openCreateChannelModal()" style="color: var(--text-muted); font-style: italic;">
      <span class="channel-icon">+</span>
      <span class="channel-name">Create Channel</span>
    </div>`;
  }

  for (const [category, channels] of Object.entries(grouped)) {
    html += `<div class="channel-category"><span>▼</span><span>${category}</span></div>`;

    for (const channel of channels) {
      const isActive = state.currentChannel?._id === channel._id;
      const isVoice = ['voice', 'video'].includes(channel.type);
      const userCount = channel.currentUsers?.length || 0;

      html += `
        <div class="channel ${isActive ? 'active' : ''}"
             onclick="${isVoice ? `joinVoice('${channel._id}')` : `selectChannelById('${channel._id}')`}">
          <span class="channel-icon">${isVoice ? '🔊' : '#'}</span>
          <span class="channel-name">${channel.name}</span>
          ${isVoice && userCount > 0 ? `<span class="channel-users">${userCount}</span>` : ''}
          ${isAdmin ? `<span class="channel-edit" onclick="event.stopPropagation(); openEditChannelModal('${channel._id}')" title="Edit Channel">⚙️</span>` : ''}
        </div>
      `;
    }
  }

  container.innerHTML = html;
}

// Select channel by ID
function selectChannelById(channelId) {
  const channel = state.channels.find(c => c._id === channelId);
  if (channel) selectChannel(channel);
}

// Select channel
async function selectChannel(channel) {
  state.currentChannel = channel;
  state.currentDMUser = null; // Clear DM state

  if (state.socket) {
    state.socket.emit('channel:join', channel._id);
  }

  renderChannels();
  renderDMUsers();

  // Update header with hash symbol for channel
  document.querySelector('.channel-header .hash').style.display = '';
  document.getElementById('channelName').textContent = channel.name;
  const topic = channel.topic || channel.description || '';
  document.getElementById('channelDescription').textContent = topic ? `topic: ${topic}` : '';
  document.getElementById('messageInput').placeholder = `Message #${channel.name}`;
  const prefix = document.getElementById('composerPrefix');
  if (prefix) prefix.textContent = `[#${channel.name}]`;

  // Load messages
  await loadMessages(channel._id);
}

// Load messages
async function loadMessages(channelId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/channels/${channelId}/messages`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    state.messages = data.messages;
    renderMessages();
    scrollToBottom();
  } catch (error) {
    showToast('Failed to load messages', 'error');
  }
}

// ==================== Direct Messages ====================

// Load DM conversations list
async function loadDMConversations() {
  try {
    const response = await fetch(`${state.serverUrl}/api/dm/conversations`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    state.dmConversations = data.conversations || [];
    renderDMUsers();
  } catch (error) {
    console.error('Failed to load DM conversations:', error);
  }
}

// Render DM users in sidebar
function renderDMUsers() {
  const container = document.getElementById('dmUsersList');
  if (!container) return;

  if (state.dmConversations.length === 0) {
    container.innerHTML = '<div style="padding: 8px 16px; color: var(--txt-5); font-size: 12px;">No conversations yet</div>';
    return;
  }

  container.innerHTML = state.dmConversations.map(conv => {
    const user = conv.user;
    if (!user) return '';
    const isActive = state.currentDMUser?._id === user._id;
    const name = user.displayName || user.username || 'User';
    const unread = conv.unreadCount > 0 ? `<span class="dm-unread">${conv.unreadCount}</span>` : '';
    const presence = user.presence || 'offline';
    const preview = conv.lastMessagePreview || conv.preview || '';

    return `
      <div class="channel dm-user ${isActive ? 'active' : ''}" onclick="openDM('${user._id}')">
        <span class="dm-avatar" style="background:${getAvatarColor(name)};">${user.avatar ? `<img src="${user.avatar}" style="width:30px;height:30px;border-radius:50%;object-fit:cover;">` : name[0].toUpperCase()}<span class="status-indicator ${presence}"></span></span>
        <span class="channel-name" style="font-family:var(--font-ui);">${escapeHtml(name)}${preview ? `<div class="dm-preview">${escapeHtml(preview)}</div>` : ''}</span>
        ${unread}
      </div>
    `;
  }).join('');
}

// Open DM with a user
async function openDM(userId) {
  // Clear current channel selection
  state.currentChannel = null;
  renderChannels();

  // Get user info
  try {
    const response = await fetch(`${state.serverUrl}/api/users/${userId}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    state.currentDMUser = data.user || { _id: userId };
  } catch (e) {
    state.currentDMUser = { _id: userId };
  }

  // Update header - hide hash, show @ for DMs
  const hashEl = document.querySelector('.channel-header .hash');
  if (hashEl) hashEl.style.display = 'none';

  const userName = state.currentDMUser.displayName || state.currentDMUser.username || 'User';
  document.getElementById('channelName').textContent = '@' + userName;
  document.getElementById('channelDescription').innerHTML = '<span style="color:var(--on);font-family:var(--font-mono);font-size:11px;">● E2E ENCRYPTED</span>';

  // Update input placeholder + composer prefix
  document.getElementById('messageInput').placeholder = `Message @${userName}`;
  const prefix = document.getElementById('composerPrefix');
  if (prefix) prefix.textContent = `[@${userName}]`;

  // Load messages
  await loadDMMessages(userId);
  renderDMUsers();
}

// Load DM messages with a user
async function loadDMMessages(userId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/dm/${userId}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    state.dmMessages = data.messages || [];

    // Decrypt messages
    for (const dm of state.dmMessages) {
      try {
        if (state.cryptoKeys?.privateKey && dm.encryptedKey) {
          const aesKey = await decryptAESKey(dm.encryptedKey, state.cryptoKeys.privateKey);
          dm.decryptedContent = await decryptMessage(dm.encryptedContent, dm.iv, aesKey);
        }
      } catch (e) {
        dm.decryptedContent = '[Unable to decrypt]';
      }
    }

    renderDMMessages();
    scrollToBottom();
  } catch (error) {
    showToast('Failed to load messages', 'error');
  }
}

// Render DM messages
function renderDMMessages() {
  const container = document.getElementById('messagesArea');
  if (!container) return;

  const peer = state.currentDMUser?.displayName || state.currentDMUser?.username || 'this user';

  if (state.dmMessages.length === 0) {
    container.innerHTML = `
      <div class="channel-intro">
        <div class="intro-tile">🔒</div>
        <h2>@${escapeHtml(peer)}</h2>
        <p>This is the start of your <span style="color:var(--on);">end-to-end encrypted</span> direct messages. Even admins can't read these.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.dmMessages.map(dm => {
    const isMe = dm.sender?._id === state.user?._id || dm.sender === state.user?._id;
    const author = isMe ? state.user : (dm.sender || {});
    const name = author.displayName || author.username || 'User';
    const time = `[${new Date(dm.createdAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}]`;
    const nickColor = getNickColor(author.username || name);

    return `
      <div class="msg-row dm">
        <div class="msg-time">${time}</div>
        <div class="msg-nick"><span class="nick" style="color:${nickColor};">${escapeHtml(name)}</span><span class="encrypted-badge" title="End-to-end encrypted">🔒</span></div>
        <div class="msg-body"><div class="message-text">${escapeHtml(dm.decryptedContent || '[Encrypted]')}</div></div>
      </div>
    `;
  }).join('');
}

// Send encrypted DM
async function sendEncryptedDM(content) {
  if (!state.currentDMUser || !content.trim()) return;

  try {
    // Get recipient's public key
    let recipientPublicKeyJwk = state.publicKeyCache[state.currentDMUser._id];
    if (!recipientPublicKeyJwk) {
      const response = await fetch(`${state.serverUrl}/api/dm/${state.currentDMUser._id}/public-key`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const data = await response.json();
      recipientPublicKeyJwk = data.publicKey;
      state.publicKeyCache[state.currentDMUser._id] = recipientPublicKeyJwk;
    }

    if (!recipientPublicKeyJwk) {
      showToast('Recipient has not set up encryption yet', 'error');
      return;
    }

    const recipientPublicKey = await importPublicKey(recipientPublicKeyJwk);

    // Generate AES key for this message
    const aesKey = await generateAESKey();

    // Encrypt message content
    const { encryptedContent, iv } = await encryptMessage(content, aesKey);

    // Encrypt AES key with recipient's public key
    const encryptedKey = await encryptAESKey(aesKey, recipientPublicKey);

    // Send via socket
    state.socket.emit('dm:send', {
      recipientId: state.currentDMUser._id,
      encryptedContent,
      iv,
      encryptedKey
    });

    // Clear input
    document.getElementById('messageInput').value = '';

  } catch (error) {
    console.error('Failed to send encrypted DM:', error);
    showToast('Failed to send message: ' + error.message, 'error');
  }
}

// Start DM from user profile
function startDMWithUser(userId, userName) {
  // Add to conversations if not already there
  if (!state.dmConversations.find(c => c.user?._id === userId)) {
    state.dmConversations.unshift({
      user: { _id: userId, username: userName, displayName: userName }
    });
    renderDMUsers();
  }
  openDM(userId);
}

// Render messages
// Solid nick color (IRC-style colored handles) derived from the name
function getNickColor(name) {
  const palette = ['#FF6A2B', '#3D7BFF', '#19C37D', '#B86BFF', '#E8A33D', '#FF8A3D', '#4FCB6B'];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// IRC mode prefix + role tag for an author
function nickMeta(author) {
  const role = author?.role || 'member';
  const isBot = author?.isBot || author?.bot;
  if (isBot) return { mode: '', modeClass: '', tag: 'bot', tagClass: 'bot' };
  if (role === 'admin' || role === 'superadmin') return { mode: '@', modeClass: 'mode-op', tag: role === 'superadmin' ? 'admin' : 'op', tagClass: 'op' };
  if (role === 'moderator') return { mode: '@', modeClass: 'mode-op', tag: 'op', tagClass: 'op' };
  if (author?.voiced) return { mode: '+', modeClass: 'mode-voice', tag: '', tagClass: '' };
  return { mode: '', modeClass: '', tag: '', tagClass: '' };
}

function renderMessages() {
  const container = document.getElementById('messagesArea');
  if (!container) return;

  const chName = state.currentChannel?.name || 'general';

  if (state.messages.length === 0) {
    container.innerHTML = `
      <div class="channel-intro">
        <div class="intro-tile">#</div>
        <h2>Welcome to #${escapeHtml(chName)}</h2>
        <p>${escapeHtml(state.currentChannel?.description || 'The start of the channel. Squad up, share clips, and find your next match.')}</p>
      </div>
    `;
    return;
  }

  let html = '';

  for (const msg of state.messages) {
    const author = msg.author || {};
    const name = author.displayName || author.username || 'unknown';
    const time = new Date(msg.createdAt);
    const timeStr = `[${time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}]`;
    const meta = nickMeta(author);
    const nickColor = getNickColor(author.username || name);

    let attachments = '';
    if (Array.isArray(msg.attachments) && msg.attachments.length) {
      attachments = `<div class="message-attachments">` + msg.attachments.map(a => {
        const url = a.url || a;
        return `<div class="message-attachment" onclick="window.open('${escapeHtml(url)}','_blank')"><img src="${escapeHtml(url)}"></div>`;
      }).join('') + `</div>`;
    }

    html += `
      <div class="msg-row">
        <div class="msg-time">${timeStr}</div>
        <div class="msg-nick">
          ${meta.mode ? `<span class="${meta.modeClass}">${meta.mode}</span>` : ''}
          <span class="nick" style="color:${nickColor};">${escapeHtml(name)}</span>
          ${meta.tag ? `<span class="role-tag ${meta.tagClass}">${meta.tag}</span>` : ''}
        </div>
        <div class="msg-body">
          <div class="message-text">${escapeHtml(msg.content || '')}</div>
          ${attachments}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Voice functions
async function joinVoice(channelId) {
  const channel = state.channels.find(c => c._id === channelId);
  if (!channel) return;

  try {
    // Use selected audio input device if configured
    const audioInputDevice = state.settings.audioInputDevice || undefined;
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true
    };

    if (audioInputDevice) {
      audioConstraints.deviceId = { exact: audioInputDevice };
    }

    state.localStream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints
    });

    // Apply initial mute state
    if (state.isMuted || !state.settings.voiceActivated) {
      state.localStream.getAudioTracks().forEach(t => t.enabled = false);
      state.isMuted = true;
    }

    state.inVoice = true;
    state.voiceChannel = channel;

    state.socket.emit('voice:join', channelId);

    document.getElementById('mainApp').classList.add('voice-active');
    document.getElementById('voiceStatus').style.display = 'block';
    document.getElementById('voicePanel').style.display = 'flex';
    document.getElementById('connectedChannelName').textContent = channel.name;
    document.getElementById('voicePanelTitle').textContent = channel.name;

    updateVoiceUI();
    showToast(`Joined ${channel.name}`, 'success');

    if (window.electronAPI) {
      window.electronAPI.updateTrayStatus(`In voice: ${channel.name}`);
    }
  } catch (error) {
    showToast('Could not access microphone', 'error');
  }
}

function leaveVoice() {
  if (state.localStream) {
    state.localStream.getTracks().forEach(t => t.stop());
    state.localStream = null;
  }

  if (state.socket) {
    state.socket.emit('voice:leave');
  }

  state.inVoice = false;
  state.voiceChannel = null;
  state.isMuted = false;
  state.isDeafened = false;

  document.getElementById('mainApp')?.classList.remove('voice-active');
  document.getElementById('voiceStatus').style.display = 'none';
  document.getElementById('voicePanel').style.display = 'none';

  showToast('Left voice channel', 'success');

  if (window.electronAPI) {
    window.electronAPI.updateTrayStatus('Online');
  }
}

function toggleMute() {
  state.isMuted = !state.isMuted;

  if (state.localStream) {
    state.localStream.getAudioTracks().forEach(t => {
      t.enabled = !state.isMuted;
    });
  }

  if (state.socket && state.inVoice) {
    state.socket.emit('voice:mute', state.isMuted);
  }

  updateVoiceUI();
}

function toggleDeafen() {
  state.isDeafened = !state.isDeafened;

  if (state.isDeafened && !state.isMuted) {
    toggleMute();
  }

  if (state.socket && state.inVoice) {
    state.socket.emit('voice:deafen', state.isDeafened);
  }

  updateVoiceUI();
}

// Toggle chat fullscreen mode
function toggleChatFullscreen() {
  const mainContent = document.querySelector('.main-content');
  const btn = document.getElementById('chatFullscreenBtn');
  mainContent.classList.toggle('chat-fullscreen');

  // Update button tooltip
  if (mainContent.classList.contains('chat-fullscreen')) {
    btn.title = 'Exit Fullscreen';
  } else {
    btn.title = 'Fullscreen';
  }
}

// Toggle voice panel fullscreen mode (native browser fullscreen)
function toggleVoicePanelFullscreen() {
  const voicePanel = document.getElementById('voicePanel');
  const btn = document.getElementById('voicePanelFullscreenBtn');

  if (document.fullscreenElement === voicePanel) {
    document.exitFullscreen();
    btn.title = 'Fullscreen';
  } else if (voicePanel.requestFullscreen) {
    voicePanel.requestFullscreen();
    btn.title = 'Exit Fullscreen';
  }
}

async function toggleCamera() {
  if (!state.isCameraOn) {
    try {
      // Get the selected camera device or use default
      const cameraDeviceId = state.settings.cameraDevice || undefined;

      const constraints = {
        video: cameraDeviceId
          ? { deviceId: { exact: cameraDeviceId }, width: 640, height: 480 }
          : { width: 640, height: 480, facingMode: 'user' },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      state.cameraStream = stream;
      state.isCameraOn = true;

      if (state.socket && state.inVoice) {
        state.socket.emit('camera:toggle', true);
      }

      // Add video to grid
      addVideoToGrid('local-camera', stream, state.user?.displayName || 'You', true);

      showToast('Camera enabled', 'success');
    } catch (error) {
      console.error('Camera error:', error);
      if (error.name === 'NotAllowedError') {
        showToast('Camera access denied. Please allow camera access in your system settings.', 'error');
      } else if (error.name === 'NotFoundError') {
        showToast('No camera found. Please connect a camera.', 'error');
      } else {
        showToast('Could not access camera: ' + error.message, 'error');
      }
    }
  } else {
    // Stop camera
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(track => track.stop());
      state.cameraStream = null;
    }
    state.isCameraOn = false;

    if (state.socket && state.inVoice) {
      state.socket.emit('camera:toggle', false);
    }

    // Remove video from grid
    removeVideoFromGrid('local-camera');

    showToast('Camera disabled', 'success');
  }

  updateVoiceUI();
}

// Screen share quality presets (720p to 8K)
const SCREEN_SHARE_QUALITY = {
  '720p': { width: 1280, height: 720, frameRate: 30, label: '720p HD', description: 'Good for low bandwidth' },
  '1080p': { width: 1920, height: 1080, frameRate: 30, label: '1080p Full HD', description: 'Standard quality (Recommended)' },
  '1080p60': { width: 1920, height: 1080, frameRate: 60, label: '1080p 60fps', description: 'Smooth for gaming' },
  '1440p': { width: 2560, height: 1440, frameRate: 30, label: '1440p QHD', description: 'High quality' },
  '1440p60': { width: 2560, height: 1440, frameRate: 60, label: '1440p 60fps', description: 'High quality smooth' },
  '4k': { width: 3840, height: 2160, frameRate: 30, label: '4K Ultra HD', description: 'Maximum clarity' },
  '4k60': { width: 3840, height: 2160, frameRate: 60, label: '4K 60fps', description: 'Premium streaming' },
  '8k': { width: 7680, height: 4320, frameRate: 30, label: '8K Ultra HD', description: 'Highest resolution available' },
  'source': { width: null, height: null, frameRate: 60, label: 'Source', description: 'Native resolution' }
};

// Get current screen share quality preference
function getScreenShareQuality() {
  return state.settings?.screenShareQuality || '1080p';
}

async function toggleScreenShare() {
  // Exit fullscreen if active (modal won't show on top of native fullscreen)
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  }

  // Always allow adding more screen shares - show picker
  if (window.electronAPI && window.electronAPI.getScreenSources) {
    try {
      const sources = await window.electronAPI.getScreenSources();
      openScreenPickerModal(sources);
    } catch (error) {
      console.error('Failed to get screen sources:', error);
      showToast('Could not get screen sources: ' + error.message, 'error');
    }
  } else {
    // Fallback for web (browser) - use getDisplayMedia with quality selection
    openWebScreenShareModal();
  }
}

// Web browser screen share with quality selection
async function openWebScreenShareModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');
  const currentQuality = getScreenShareQuality();

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Share Your Screen</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="color: var(--text-muted); margin-bottom: 16px;">Select streaming quality:</p>
      <div class="quality-options" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px;">
        ${Object.entries(SCREEN_SHARE_QUALITY).map(([key, q]) => `
          <div class="quality-option ${currentQuality === key ? 'selected' : ''}"
               data-quality="${key}"
               onclick="selectWebScreenShareQuality('${key}')"
               style="padding: 12px; background: ${currentQuality === key ? 'var(--accent-primary)' : 'var(--bg-dark)'};
                      border-radius: var(--radius-sm); cursor: pointer; text-align: center; transition: all 0.2s;
                      border: 2px solid ${currentQuality === key ? 'var(--accent-primary)' : 'transparent'};">
            <div style="font-weight: 600; color: var(--text-primary);">${q.label}</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${q.description}</div>
          </div>
        `).join('')}
      </div>
      <p style="color: var(--text-muted); font-size: 12px;">Higher resolutions require more bandwidth and CPU.</p>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="startWebScreenShare()">Start Sharing</button>
    </div>
  `;

  // Add hover effect
  const style = document.createElement('style');
  style.textContent = `.quality-option:hover { background: var(--bg-medium) !important; }`;
  modal.appendChild(style);

  overlay.classList.add('active');
}

// Select quality for web screen share
function selectWebScreenShareQuality(quality) {
  document.querySelectorAll('.quality-option').forEach(el => {
    const isSelected = el.dataset.quality === quality;
    el.classList.toggle('selected', isSelected);
    el.style.background = isSelected ? 'var(--accent-primary)' : 'var(--bg-dark)';
    el.style.borderColor = isSelected ? 'var(--accent-primary)' : 'transparent';
  });
  state.settings.screenShareQuality = quality;
}

// Start web screen share with selected quality
async function startWebScreenShare() {
  const quality = getScreenShareQuality();
  const preset = SCREEN_SHARE_QUALITY[quality] || SCREEN_SHARE_QUALITY['1080p'];

  closeModal();

  try {
    const videoConstraints = preset.width ? {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.frameRate }
    } : {
      frameRate: { ideal: preset.frameRate }
    };

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: videoConstraints,
      audio: true
    });
    const shareId = 'screen-' + Date.now();
    startScreenShare(stream, shareId);
    showToast(`Screen sharing at ${preset.label}`, 'success');
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error('Screen share error:', error);
      showToast('Could not share screen: ' + error.message, 'error');
    }
  }
}

// Show screen picker modal for Electron with quality selection
function openScreenPickerModal(sources) {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');
  const currentQuality = getScreenShareQuality();

  // Store sources globally so we can access thumbnails by index
  window._screenSources = sources;
  window._selectedScreenQuality = currentQuality;

  const sourcesHtml = sources.map((source, index) => `
    <div class="screen-source" data-source-id="${source.id}"
         onclick="selectScreenSourcePreview('${source.id}')"
         style="cursor: pointer; padding: 8px; border-radius: 8px; background: var(--bg-dark); text-align: center; transition: all 0.2s;">
      <div class="screen-thumbnail" data-index="${index}"
           style="width: 100%; height: 120px; border-radius: 4px; margin-bottom: 8px; border: 2px solid transparent; background: var(--bg-medium); display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <span style="color: var(--text-muted); font-size: 32px;">🖥️</span>
      </div>
      <div style="font-size: 12px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${escapeHtml(source.name)}
      </div>
    </div>
  `).join('');

  // Quality presets for quick selection
  const quickQualities = ['720p', '1080p', '1080p60', '1440p', '4k', '4k60', '8k'];

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Share Your Screen</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height: 500px; overflow-y: auto;">
      <div style="margin-bottom: 16px;">
        <label style="color: var(--text-secondary); font-size: 12px; font-weight: 600; margin-bottom: 8px; display: block;">STREAMING QUALITY</label>
        <div class="quality-selector" style="display: flex; flex-wrap: wrap; gap: 6px;">
          ${quickQualities.map(key => {
            const q = SCREEN_SHARE_QUALITY[key];
            return `
              <button class="quality-btn ${currentQuality === key ? 'active' : ''}"
                      data-quality="${key}"
                      onclick="setScreenShareQuality('${key}')"
                      style="padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; transition: all 0.2s;
                             background: ${currentQuality === key ? 'var(--accent-primary)' : 'var(--bg-dark)'};
                             color: var(--text-primary);">
                ${q.label}
              </button>
            `;
          }).join('')}
        </div>
        <p style="color: var(--text-muted); font-size: 11px; margin-top: 8px;">
          ${SCREEN_SHARE_QUALITY[currentQuality]?.description || ''} • Higher quality uses more bandwidth
        </p>
      </div>

      <label style="color: var(--text-secondary); font-size: 12px; font-weight: 600; margin-bottom: 8px; display: block;">SELECT SCREEN OR WINDOW</label>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px;">
        ${sourcesHtml}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
    </div>
  `;

  // Add hover effects
  const style = document.createElement('style');
  style.textContent = `
    .screen-source:hover { background: var(--bg-medium) !important; }
    .screen-source:hover .screen-thumbnail { border-color: var(--accent-primary) !important; }
    .screen-source.selected { background: var(--bg-medium) !important; }
    .screen-source.selected .screen-thumbnail { border-color: var(--accent-primary) !important; }
    .quality-btn:hover { background: var(--bg-medium) !important; }
    .quality-btn.active { background: var(--accent-primary) !important; }
  `;
  modal.appendChild(style);

  overlay.classList.add('active');

  // Load thumbnails after modal is shown
  setTimeout(() => {
    document.querySelectorAll('.screen-thumbnail').forEach((el) => {
      const index = parseInt(el.dataset.index);
      const source = window._screenSources[index];
      if (source && source.thumbnail) {
        const img = document.createElement('img');
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        img.onload = () => {
          el.innerHTML = '';
          el.appendChild(img);
        };
        img.onerror = () => {
          // Keep the fallback icon on error
          console.log('Failed to load thumbnail for:', source.name);
        };
        img.src = source.thumbnail;
      }
    });
  }, 50);
}

// Set screen share quality from modal
function setScreenShareQuality(quality) {
  window._selectedScreenQuality = quality;
  state.settings.screenShareQuality = quality;

  // Update UI
  document.querySelectorAll('.quality-btn').forEach(btn => {
    const isActive = btn.dataset.quality === quality;
    btn.classList.toggle('active', isActive);
    btn.style.background = isActive ? 'var(--accent-primary)' : 'var(--bg-dark)';
  });

  // Update description
  const descEl = document.querySelector('.quality-selector + p');
  if (descEl) {
    descEl.textContent = `${SCREEN_SHARE_QUALITY[quality]?.description || ''} • Higher quality uses more bandwidth`;
  }

  // Save setting
  if (window.electronAPI) {
    window.electronAPI.getSettings().then(settings => {
      settings.screenShareQuality = quality;
      window.electronAPI.saveSettings(settings);
    });
  }
}

// Preview selection for screen source (visual feedback before starting)
function selectScreenSourcePreview(sourceId) {
  // Actually start the share directly
  selectScreenSource(sourceId);
}

// Select a screen source from the picker
async function selectScreenSource(sourceId) {
  closeModal();

  // Get selected quality
  const quality = window._selectedScreenQuality || getScreenShareQuality();
  const preset = SCREEN_SHARE_QUALITY[quality] || SCREEN_SHARE_QUALITY['1080p'];

  try {
    // Use the selected source with getUserMedia (Electron way)
    // For source/native resolution, don't set max constraints
    const videoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: preset.frameRate
      }
    };

    // Only set resolution constraints if not using 'source' quality
    if (preset.width && preset.height) {
      videoConstraints.mandatory.maxWidth = preset.width;
      videoConstraints.mandatory.maxHeight = preset.height;
      videoConstraints.mandatory.minWidth = Math.min(1280, preset.width);
      videoConstraints.mandatory.minHeight = Math.min(720, preset.height);
    } else {
      // Source quality - use very high limits to get native resolution
      videoConstraints.mandatory.maxWidth = 7680;
      videoConstraints.mandatory.maxHeight = 4320;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints
    });

    // Generate unique share ID
    const shareId = 'screen-' + Date.now();

    // Find the source name for the label
    const source = window._screenSources?.find(s => s.id === sourceId);
    const label = source?.name || 'Screen Share';

    // Get actual resolution from the stream
    const videoTrack = stream.getVideoTracks()[0];
    const settings = videoTrack?.getSettings();
    const actualRes = settings ? `${settings.width}x${settings.height}` : preset.label;

    startScreenShare(stream, shareId, `${label} (${actualRes})`);
    showToast(`Screen sharing at ${preset.label}`, 'success');
  } catch (error) {
    console.error('Failed to start screen share:', error);
    showToast('Could not share screen: ' + error.message, 'error');
  }
}

// Start screen sharing with a stream
function startScreenShare(stream, shareId, label = 'Your Screen') {
  state.screenStreams[shareId] = stream;
  state.isScreenSharing = Object.keys(state.screenStreams).length > 0;

  if (state.socket) {
    state.socket.emit('screen:start', { shareId, label });
  }

  // Add screen share to grid with close button
  addVideoToGrid(shareId, stream, label, false, true, true, state.user?._id);

  // Handle user stopping share via system
  stream.getVideoTracks()[0].onended = () => {
    stopScreenShare(shareId);
    showToast('Screen sharing stopped', 'info');
  };

  showToast('Screen sharing started: ' + label, 'success');
  updateVoiceUI();
}

// Stop a specific screen share or all if no shareId
function stopScreenShare(shareId) {
  if (shareId) {
    // Stop specific share
    if (state.screenStreams[shareId]) {
      state.screenStreams[shareId].getTracks().forEach(t => t.stop());
      delete state.screenStreams[shareId];
      removeVideoFromGrid(shareId);
    }
  } else {
    // Stop all shares
    for (const id in state.screenStreams) {
      state.screenStreams[id].getTracks().forEach(t => t.stop());
      removeVideoFromGrid(id);
    }
    state.screenStreams = {};
  }

  state.isScreenSharing = Object.keys(state.screenStreams).length > 0;

  if (state.socket) {
    state.socket.emit('screen:stop', { shareId });
  }

  updateVoiceUI();
}

// Add video element to the video grid
function addVideoToGrid(id, stream, label, isMirrored = false, showCloseButton = false, isScreenShare = false, userId = null) {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;

  // Remove existing element if present
  removeVideoFromGrid(id);

  const tile = document.createElement('div');
  tile.className = 'video-tile';
  tile.id = `video-tile-${id}`;
  tile.style.cssText = 'position: relative; background: var(--bg-dark); border-radius: 8px; overflow: hidden;';

  // Determine if Game Together button should be shown
  // Show on screen shares from other users (not your own, not on camera streams)
  const showGameTogetherBtn = isScreenShare && !showCloseButton && userId && userId !== state.user?._id;

  tile.innerHTML = `
    <video id="video-${id}" autoplay playsinline style="width: 100%; height: 100%; object-fit: cover; ${isMirrored ? 'transform: scaleX(-1);' : ''}"></video>
    <div class="video-label" style="position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.7); padding: 4px 8px; border-radius: 4px; font-size: 12px;">${escapeHtml(label)}</div>
    ${showCloseButton ? `<button onclick="stopScreenShare('${id}')" style="position: absolute; top: 8px; right: 8px; background: rgba(255,0,0,0.8); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 14px; display: flex; align-items: center; justify-content: center;">✕</button>` : ''}
    ${showGameTogetherBtn ? `<button onclick="openGameTogetherMenu('${userId}', '${escapeHtml(label)}')" style="position: absolute; top: 8px; right: 8px; background: rgba(102, 51, 153, 0.9); border: none; color: white; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">🎮 Play Together</button>` : ''}
  `;

  grid.appendChild(tile);

  const video = document.getElementById(`video-${id}`);
  if (video) {
    video.srcObject = stream;
    video.muted = true; // Mute local playback to prevent echo
  }
}

// Remove video element from the grid
function removeVideoFromGrid(id) {
  const tile = document.getElementById(`video-tile-${id}`);
  if (tile) {
    const video = tile.querySelector('video');
    if (video) {
      video.srcObject = null;
    }
    tile.remove();
  }
}

// Add bot video/stream to the video grid (YouTube, IPTV, Chrome, Plex, etc.)
function addBotVideoToGrid(botId, label, url, thumbnail) {
  console.log('[addBotVideoToGrid] Called with:', { botId, label, url, thumbnail });
  const grid = document.getElementById('videoGrid');
  console.log('[addBotVideoToGrid] videoGrid element:', grid);
  if (!grid) {
    console.warn('[addBotVideoToGrid] No videoGrid element found - user may not be in voice channel');
    return;
  }

  // Remove existing element if present
  removeBotVideoFromGrid(botId);

  const tile = document.createElement('div');
  tile.className = 'video-tile bot-video';
  tile.id = `bot-video-tile-${botId}`;
  // Let CSS handle most styling, just ensure it's visible
  tile.style.cssText = 'position: relative; min-height: 200px;';

  // For YouTube, use an iframe embed
  if (botId === 'youtube' && url) {
    // Extract video ID from URL
    const videoId = extractYouTubeId(url);
    if (videoId) {
      tile.innerHTML = `
        <iframe
          src="https://www.youtube.com/embed/${videoId}?autoplay=1"
          style="width: 100%; height: 100%; min-height: 200px; border: none; position: absolute; top: 0; left: 0;"
          allow="autoplay; encrypted-media"
          allowfullscreen>
        </iframe>
        <div class="video-label">${escapeHtml(label)}</div>
      `;
    } else {
      // Fallback if video ID can't be extracted
      tile.innerHTML = `
        <div style="width: 100%; height: 100%; min-height: 200px; display: flex; align-items: center; justify-content: center; background: var(--bg-darker);">
          <div style="text-align: center; color: var(--text-muted);">
            <div style="font-size: 32px; margin-bottom: 8px;">▶️</div>
            <div>${escapeHtml(label)}</div>
            <div style="font-size: 11px; margin-top: 4px;">Invalid YouTube URL</div>
          </div>
        </div>
      `;
    }
  } else if (botId === 'twitch' && url) {
    // For Twitch, use an iframe embed (URL is already the embed URL)
    tile.innerHTML = `
      <iframe
        src="${escapeHtml(url)}"
        style="width: 100%; height: 100%; min-height: 200px; border: none; position: absolute; top: 0; left: 0;"
        allow="autoplay; fullscreen"
        allowfullscreen>
      </iframe>
      <div class="video-label">${escapeHtml(label)}</div>
    `;
  } else if (botId === 'chrome' && url) {
    // For Chrome bot, use an iframe to show the webpage
    tile.innerHTML = `
      <iframe
        src="${escapeHtml(url)}"
        style="width: 100%; height: 100%; min-height: 200px; border: none; background: white; position: absolute; top: 0; left: 0;"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        allowfullscreen>
      </iframe>
      <div class="video-label">${escapeHtml(label)}</div>
    `;
  } else if (botId === 'iptv' && url) {
    // For IPTV, try HLS first, fall back to MPEG-TS
    const videoId = `iptv-video-${Date.now()}`;
    tile.innerHTML = `
      <video id="${videoId}" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: contain; background: #000;"></video>
      <div class="video-label">${escapeHtml(label)}</div>
      <button onclick="const v=this.parentElement.querySelector('video'); v.muted=!v.muted; this.textContent=v.muted?'🔊 Unmute':'🔇 Mute';" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; z-index: 10;">🔊 Unmute</button>
    `;

    // Store original URL (without .m3u8) for MPEG-TS fallback
    const originalUrl = url.replace('.m3u8', '');

    // After appending to DOM, initialize player
    setTimeout(() => {
      const video = document.getElementById(videoId);
      if (!video || !url) return;

      const tryMpegTs = () => {
        console.log('[IPTV] Trying MPEG-TS fallback with mpegts.js');
        if (typeof mpegts !== 'undefined' && mpegts.isSupported()) {
          const player = mpegts.createPlayer({
            type: 'mpegts',
            isLive: true,
            url: originalUrl
          });
          player.attachMediaElement(video);
          player.load();
          player.play().catch(e => console.log('[IPTV] MPEG-TS autoplay blocked:', e));
          video._mpegts = player;
          console.log('[IPTV] MPEG-TS player initialized');
        } else {
          console.error('[IPTV] mpegts.js not supported');
          tile.querySelector('.video-label').textContent = `${label} (Format not supported)`;
        }
      };

      if (Hls && Hls.isSupported()) {
        console.log('[IPTV] Trying HLS first');
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.loadSource(url);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('[IPTV] HLS manifest parsed, playing');
          video.play().catch(e => console.log('[IPTV] Autoplay blocked:', e));
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          console.error('[IPTV] HLS error:', data.type, data.details);
          if (data.fatal) {
            console.log('[IPTV] Fatal HLS error, trying MPEG-TS fallback');
            hls.destroy();
            tryMpegTs();
          }
        });

        video._hls = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        video.src = url;
        video.play().catch(e => console.log('[IPTV] Autoplay blocked:', e));
      } else {
        // No HLS support, try MPEG-TS directly
        tryMpegTs();
      }
    }, 100);
  } else if (url) {
    // For other bots (Plex, Emby, Jellyfin), use video element with HLS support
    const videoId = `media-video-${Date.now()}`;
    tile.innerHTML = `
      <video id="${videoId}" autoplay playsinline muted style="width: 100%; height: 100%; object-fit: contain; background: #000;"></video>
      <div class="video-label">${escapeHtml(label)}</div>
      <button onclick="const v=this.parentElement.querySelector('video'); v.muted=!v.muted; this.textContent=v.muted?'🔊 Unmute':'🔇 Mute';" style="position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,0.7); color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; z-index: 10;">🔊 Unmute</button>
    `;
    setTimeout(() => {
      const video = document.getElementById(videoId);
      if (video && url) {
        // Check if it's an HLS stream
        if (url.includes('.m3u8') && Hls && Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
          video._hls = hls;
        } else {
          video.src = url;
          video.play().catch(() => {});
        }
      }
    }, 100);
  } else if (thumbnail) {
    // Fallback to thumbnail with label
    tile.innerHTML = `
      <img src="${escapeHtml(thumbnail)}" style="width: 100%; height: 100%; object-fit: cover;" alt="${escapeHtml(label)}">
      <div class="video-label">${escapeHtml(label)}</div>
    `;
  } else {
    // Placeholder
    tile.innerHTML = `
      <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--bg-darker);">
        <div style="text-align: center; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 8px;">🎬</div>
          <div>${escapeHtml(label)}</div>
        </div>
      </div>
    `;
  }

  // Add double-click to fullscreen
  tile.addEventListener('dblclick', () => toggleVideoFullscreen(tile));

  grid.appendChild(tile);
  console.log('[addBotVideoToGrid] Tile appended to grid. Current grid children:', grid.children.length);
}

// Remove bot video from the grid
function removeBotVideoFromGrid(botId) {
  const tile = document.getElementById(`bot-video-tile-${botId}`);
  if (tile) {
    // Cleanup HLS or MPEG-TS instance if present
    const video = tile.querySelector('video');
    if (video) {
      if (video._hls) {
        video._hls.destroy();
      }
      if (video._mpegts) {
        video._mpegts.destroy();
      }
    }
    tile.remove();
  }
}

// Extract YouTube video ID from URL
function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

// Toggle video tile fullscreen
function toggleVideoFullscreen(element) {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (element.requestFullscreen) {
    element.requestFullscreen();
  }
}

function updateVoiceUI() {
  const muteBtn = document.getElementById('muteBtn');
  const deafenBtn = document.getElementById('deafenBtn');
  const micBtnPanel = document.getElementById('micBtnPanel');
  const shareBtnPanel = document.getElementById('shareBtnPanel');

  if (muteBtn) {
    muteBtn.classList.toggle('active', state.isMuted);
    muteBtn.textContent = state.isMuted ? '🔇' : '🎤';
  }

  if (deafenBtn) {
    deafenBtn.classList.toggle('active', state.isDeafened);
    deafenBtn.textContent = state.isDeafened ? '🔈' : '🎧';
  }

  if (micBtnPanel) {
    micBtnPanel.classList.toggle('active', state.isMuted);
    micBtnPanel.querySelector('.icon').textContent = state.isMuted ? '🔇' : '🎤';
  }

  if (shareBtnPanel) {
    shareBtnPanel.classList.toggle('active', state.isScreenSharing);
  }
}

function renderVoiceUsers(users = []) {
  const container = document.getElementById('participantsList');
  const countEl = document.getElementById('participantCount');
  if (!container) return;

  countEl.textContent = users.length;

  let html = '';
  for (const cu of users) {
    const user = cu.user;
    const avatarColor = getAvatarColor(user.username);

    html += `
      <div class="participant">
        <div class="avatar" style="background: ${avatarColor};">
          ${(user.displayName || user.username)[0].toUpperCase()}
        </div>
        <span class="name">${user.displayName || user.username}</span>
        <div class="status-icons">
          ${cu.isMuted ? '<span class="muted">🔇</span>' : ''}
          ${cu.isDeafened ? '<span>🔈</span>' : ''}
          ${cu.isStreaming ? '<span>📺</span>' : ''}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function showPTTIndicator(show) {
  const indicator = document.getElementById('pttIndicator');
  if (indicator) {
    indicator.classList.toggle('active', show);
  }
}

// Message input
function handleInputKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const content = input.value.trim();

  if (!content || !state.socket) return;

  // Check if we're in a DM conversation
  if (state.currentDMUser) {
    await sendEncryptedDM(content);
    return;
  }

  // Regular channel message
  if (!state.currentChannel) return;

  const messageData = {
    channelId: state.currentChannel._id,
    content
  };

  // Include attachments if any
  if (state.pendingAttachments.length > 0) {
    messageData.attachments = state.pendingAttachments;
  }

  state.socket.emit('message:send', messageData);

  // Clear input and attachments
  input.value = '';
  state.pendingAttachments = [];
  renderAttachmentPreview();
}

// File attachment handling
function setupDragDrop() {
  const messagesArea = document.getElementById('messagesArea');
  const inputContainer = document.querySelector('.message-input-container');

  if (!messagesArea || !inputContainer) return;

  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
    document.body.addEventListener(event, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // Highlight drop zone
  ['dragenter', 'dragover'].forEach(event => {
    messagesArea.addEventListener(event, () => {
      messagesArea.classList.add('drag-highlight');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    messagesArea.addEventListener(event, () => {
      messagesArea.classList.remove('drag-highlight');
    });
  });

  // Handle file drop
  messagesArea.addEventListener('drop', handleFileDrop);
  inputContainer.addEventListener('drop', handleFileDrop);
}

async function handleFileDrop(e) {
  const files = e.dataTransfer.files;
  if (!files || files.length === 0) return;

  await uploadFiles(Array.from(files));
}

// Open file picker
function openFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*,.gif';

  input.onchange = async (e) => {
    if (e.target.files && e.target.files.length > 0) {
      await uploadFiles(Array.from(e.target.files));
    }
  };

  input.click();
}

async function uploadFiles(files) {
  // Filter to only images
  const imageFiles = files.filter(f => f.type.startsWith('image/'));

  if (imageFiles.length === 0) {
    showToast('Only images and GIFs are supported', 'error');
    return;
  }

  if (imageFiles.length + state.pendingAttachments.length > 5) {
    showToast('Maximum 5 images per message', 'error');
    return;
  }

  try {
    const formData = new FormData();
    imageFiles.forEach(file => formData.append('files', file));

    const response = await fetch(`${state.serverUrl}/api/attachments/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`
      },
      body: formData
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Upload failed');
    }

    const data = await response.json();
    state.pendingAttachments.push(...data.attachments);
    renderAttachmentPreview();
    showToast(`${data.attachments.length} image(s) ready to send`, 'success');
  } catch (error) {
    console.error('Upload error:', error);
    showToast(error.message || 'Failed to upload files', 'error');
  }
}

function renderAttachmentPreview() {
  let previewContainer = document.getElementById('attachmentPreview');

  if (!previewContainer) {
    const inputWrapper = document.querySelector('.message-input-wrapper');
    if (!inputWrapper) return;

    previewContainer = document.createElement('div');
    previewContainer.id = 'attachmentPreview';
    previewContainer.className = 'attachment-preview';
    inputWrapper.insertBefore(previewContainer, inputWrapper.firstChild);
  }

  if (state.pendingAttachments.length === 0) {
    previewContainer.style.display = 'none';
    previewContainer.innerHTML = '';
    return;
  }

  previewContainer.style.display = 'flex';
  previewContainer.innerHTML = state.pendingAttachments.map((att, index) => `
    <div class="attachment-preview-item">
      <img src="${state.serverUrl}${att.url}" alt="${escapeHtml(att.filename)}" />
      <button class="remove-attachment" onclick="removeAttachment(${index})" title="Remove">✕</button>
    </div>
  `).join('');
}

function removeAttachment(index) {
  state.pendingAttachments.splice(index, 1);
  renderAttachmentPreview();
}

// Settings modal
async function openSettings() {
  const modal = document.getElementById('modalOverlay');
  const content = document.getElementById('modalContent');

  // Enumerate devices first
  await enumerateDevices();

  const audioInputOptions = state.devices.audioInputs.map(d =>
    `<option value="${d.deviceId}" ${state.settings.audioInputDevice === d.deviceId ? 'selected' : ''}>${escapeHtml(d.label || 'Microphone ' + (state.devices.audioInputs.indexOf(d) + 1))}</option>`
  ).join('');

  const audioOutputOptions = state.devices.audioOutputs.map(d =>
    `<option value="${d.deviceId}" ${state.settings.audioOutputDevice === d.deviceId ? 'selected' : ''}>${escapeHtml(d.label || 'Speaker ' + (state.devices.audioOutputs.indexOf(d) + 1))}</option>`
  ).join('');

  const videoInputOptions = state.devices.videoInputs.map(d =>
    `<option value="${d.deviceId}" ${state.settings.cameraDevice === d.deviceId ? 'selected' : ''}>${escapeHtml(d.label || 'Camera ' + (state.devices.videoInputs.indexOf(d) + 1))}</option>`
  ).join('');

  const isAdmin = state.user?.role === 'admin' || state.user?.role === 'superadmin';
  const u = state.user || {};
  const initials = (u.displayName || u.username || 'U').substring(0, 2).toUpperCase();
  const accent = (label) => `<div class="settings-label">${label}</div>`;

  // remove any prior takeover
  document.querySelector('.settings-takeover')?.remove();

  const toggleRow = (title, sub, on) => `
    <div class="card-row"><div class="grow"><div class="row-title">${title}</div>${sub ? `<div class="row-sub">${sub}</div>` : ''}</div>
      <div class="toggle ${on ? 'on' : ''}" onclick="this.classList.toggle('on')"><span class="knob"></span></div></div>`;

  const bots = [
    { id: 'youtube', name: 'YouTube', color: '#FF3D3D', letter: 'YT', cat: 'Streaming', desc: 'Queue and sync YouTube playback in any watch channel.', on: true },
    { id: 'plex', name: 'Plex', color: '#E8A33D', letter: 'PL', cat: 'Media server', desc: 'Stream your Plex library together, perfectly in sync.', on: true },
    { id: 'jellyfin', name: 'Jellyfin', color: '#7B5CFF', letter: 'JF', cat: 'Media server', desc: 'Open-source media server playback for the whole room.', on: true },
    { id: 'emby', name: 'Emby', color: '#19C37D', letter: 'EM', cat: 'Media server', desc: 'Watch your Emby library with friends.', on: false },
    { id: 'iptv', name: 'IPTV', color: '#3D7BFF', letter: 'IP', cat: 'Live TV', desc: 'Share live TV streams and channels.', on: true },
    { id: 'twitch', name: 'Twitch', color: '#B86BFF', letter: 'TW', cat: 'Streaming', desc: 'Co-watch Twitch streams in a watch channel.', on: true },
    { id: 'chrome', name: 'Chrome', color: '#FFB454', letter: 'CH', cat: 'Browser', desc: 'Shared browser session for anything else.', on: false },
    { id: 'game-together', name: 'Game Together', color: '#FF6A2B', letter: 'GT', cat: 'Co-op', desc: 'Stream a game and pass virtual controllers to friends.', on: true },
  ];
  const enabledCount = bots.filter(b => b.on).length;

  const roles = [
    { id: 'admin', name: 'Admin', color: '#FF6A2B', count: 2 },
    { id: 'moderator', name: 'Moderator', color: '#3D7BFF', count: 4 },
    { id: 'streamer', name: 'Streamer', color: '#B86BFF', count: 6 },
    { id: 'member', name: 'Member', color: '#9A938A', count: 142 },
  ];

  const nav = (group, items) => `
    <div class="settings-nav-group">${group}</div>
    ${items.map(it => `<button class="settings-nav-item ${it.id === 'account' ? 'active' : ''}" data-tab="${it.id}" onclick="switchSettingsTab('${it.id}')"><span class="nav-ico">${it.ico}</span><span class="nav-label">${it.label}</span></button>`).join('')}`;

  const takeover = document.createElement('div');
  takeover.className = 'settings-takeover';
  takeover.innerHTML = `
    <div class="settings-nav">
      <div class="settings-nav-head"><span>Settings</span></div>
      <div class="settings-nav-scroll">
        ${nav('User Settings', [
          { id: 'account', ico: '◉', label: 'Account' },
          { id: 'profile', ico: '✦', label: 'Profile' },
          { id: 'voice', ico: '🎙', label: 'Voice & Video' },
          { id: 'notifications', ico: '🔔', label: 'Notifications' },
          { id: 'appearance', ico: '◐', label: 'Appearance' },
        ])}
        ${nav('Server', [
          { id: 'bots', ico: '🤖', label: 'Media Bots' },
          { id: 'groups', ico: '⚑', label: 'Groups & Roles' },
          { id: 'federation', ico: '◈', label: 'Federation' },
          { id: 'channels', ico: '#', label: 'Channels' },
          { id: 'server', ico: '⚙', label: 'Server Settings' },
        ])}
      </div>
      <button class="settings-logout" onclick="disconnect()"><span>⏏</span>Log out</button>
    </div>

    <div class="settings-main">
      <div class="settings-topbar">
        <span class="settings-crumb" id="settingsCrumb">User Settings / <b>Account</b></span>
        <span style="flex:1;"></span>
        <button class="btn-accent" onclick="saveSettings()">Save changes</button>
        <button class="modal-close" onclick="closeSettings()" style="margin-left:10px;">✕</button>
      </div>
      <div class="settings-scroll">

        <!-- ACCOUNT -->
        <div class="settings-pane active" id="stab-account">
          <div class="settings-title">Account</div>
          <div class="settings-desc">Your identity on this server and how you sign in.</div>
          <div class="identity-card">
            <div class="id-avatar">${u.avatar ? `<img src="${u.avatar}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : initials}</div>
            <div class="id-meta">
              <div class="id-name">${escapeHtml(u.displayName || u.username || 'User')}</div>
              <div class="id-handle">@${escapeHtml(u.username || 'user')} · ${escapeHtml((u.role || 'member'))}</div>
            </div>
            <button class="btn-accent" onclick="switchSettingsTab('profile')">Edit profile</button>
          </div>
          <div class="grid-2">
            <div class="field"><div class="field-label">Email</div><div class="field-value">${escapeHtml(u.email || '—')}</div></div>
            <div class="field"><div class="field-label">Username</div><div class="field-value mono">${escapeHtml(u.username || '—')}</div></div>
          </div>
          ${accent('Security')}
          <div class="section-card">
            <div class="card-row"><div class="grow"><div class="row-title">Password</div><div class="row-sub">Sign in credential for this server</div></div><button class="btn-secondary" onclick="showToast('Use your server admin to reset passwords','info')">Change</button></div>
            <div class="card-row"><div class="grow"><div class="row-title">Two-factor authentication</div><div class="row-sub">Add an extra layer of security</div></div><button class="btn-secondary" onclick="showToast('2FA coming soon','info')">Manage</button></div>
            <div class="card-row"><div class="grow"><div class="row-title">Active sessions</div><div class="row-sub">Devices currently signed in</div></div><button class="btn-secondary" onclick="disconnect()">Sign out</button></div>
          </div>
          ${accent('<span style="color:var(--dnd-c)">Danger zone</span>')}
          <div class="danger-card">
            <div class="card-row"><div class="grow"><div class="row-title">Disconnect</div><div class="row-sub">Sign out of this server on this device</div></div><button class="btn-danger-outline" onclick="disconnect()">Disconnect</button></div>
            <div class="card-row"><div class="grow"><div class="row-title">Delete account</div><div class="row-sub">Permanently remove your account and data</div></div><button class="btn-danger" onclick="showToast('Account deletion must be done by a server admin','warning')">Delete</button></div>
          </div>
        </div>

        <!-- PROFILE -->
        <div class="settings-pane" id="stab-profile">
          <div class="settings-title">Profile</div>
          <div class="settings-desc">How you appear to others across the network.</div>
          <div class="profile-grid">
            <div>
              <div class="field"><div class="field-label">Display name</div><input type="text" id="displayName" value="${escapeHtml(u.displayName || '')}" placeholder="Your name"></div>
              <div class="field"><div class="field-label">Pronouns</div><input type="text" id="pronouns" value="${escapeHtml(u.pronouns || '')}" placeholder="they/them"></div>
              <div class="field"><div class="field-label">About me</div><textarea id="aboutMe" rows="3" placeholder="Tell the server about yourself">${escapeHtml(u.about || '')}</textarea></div>
              <div class="field"><div class="field-label">Custom status</div><input type="text" id="customStatus" value="${escapeHtml(u.customStatus || '')}" placeholder="🎮 Playing Helldivers 2"></div>
            </div>
            <div class="profile-preview">
              <div class="banner"></div>
              <div class="pp-body">
                <div class="pp-avatar">${initials}</div>
                <div style="font-family:var(--font-display);font-weight:700;font-size:17px;margin-top:9px;">${escapeHtml(u.displayName || u.username || 'User')}</div>
                <div style="font-family:var(--font-mono);font-size:11px;color:var(--ember-light);margin-top:3px;">@${escapeHtml(u.username || 'user')} · ${escapeHtml(u.role || 'member')}</div>
                <div style="font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--txt-5);text-transform:uppercase;margin-top:14px;">Preview</div>
              </div>
            </div>
          </div>
          ${accent('Connections')}
          <div class="conn-grid">
            <div class="conn-card"><div class="conn-tile" style="background:#3D7BFF;">ST</div><div style="flex:1;"><div style="font:600 13.5px var(--font-ui)">Steam</div><div style="font-size:11px;color:var(--txt-4);"><input type="text" id="steamId" value="${escapeHtml(u.steamId || '')}" placeholder="Steam ID" style="background:transparent;border:none;color:var(--txt-2);font-family:var(--font-mono);font-size:12px;padding:0;width:100%;"></div></div></div>
            <div class="conn-card"><div class="conn-tile" style="background:#B86BFF;">TW</div><div style="flex:1;"><div style="font:600 13.5px var(--font-ui)">Twitch</div><div style="font-size:11px;color:var(--txt-4);">Not connected</div></div><button class="btn-secondary" onclick="showToast('Twitch linking coming soon','info')">Link</button></div>
          </div>
        </div>

        <!-- VOICE & VIDEO -->
        <div class="settings-pane" id="stab-voice">
          <div class="settings-title">Voice &amp; Video</div>
          <div class="settings-desc">Devices, input mode, and screen-share quality.</div>
          <div class="grid-2">
            <div class="field"><div class="field-label">Input device</div><select id="audioInputDevice"><option value="">Default microphone</option>${audioInputOptions}</select></div>
            <div class="field"><div class="field-label">Output device</div><select id="audioOutputDevice"><option value="">Default speakers</option>${audioOutputOptions}</select></div>
            <div class="field"><div class="field-label">Camera</div><select id="cameraDevice"><option value="">Default camera</option>${videoInputOptions}</select></div>
            <div class="field"><div class="field-label">Screen-share quality</div><select id="screenShareQuality">
              <option value="720p" ${state.settings.screenShareQuality === '720p' ? 'selected' : ''}>720p HD</option>
              <option value="1080p" ${!state.settings.screenShareQuality || state.settings.screenShareQuality === '1080p' ? 'selected' : ''}>1080p Full HD</option>
              <option value="1080p60" ${state.settings.screenShareQuality === '1080p60' ? 'selected' : ''}>1080p 60fps</option>
              <option value="1440p" ${state.settings.screenShareQuality === '1440p' ? 'selected' : ''}>1440p QHD</option>
              <option value="1440p60" ${state.settings.screenShareQuality === '1440p60' ? 'selected' : ''}>1440p 60fps</option>
              <option value="4k" ${state.settings.screenShareQuality === '4k' ? 'selected' : ''}>4K Ultra HD</option>
              <option value="4k60" ${state.settings.screenShareQuality === '4k60' ? 'selected' : ''}>4K 60fps</option>
              <option value="8k" ${state.settings.screenShareQuality === '8k' ? 'selected' : ''}>8K</option>
              <option value="source" ${state.settings.screenShareQuality === 'source' ? 'selected' : ''}>Source</option>
            </select></div>
          </div>
          <div class="section-card pad" style="margin-top:16px;">
            <div class="row-title">Mic test</div>
            <div class="row-sub" style="margin-bottom:11px;">Speak and watch the input level. <a onclick="testMicrophone()" style="color:var(--ember-light);cursor:pointer;">Start test</a></div>
            <div class="mic-meter"><div style="width:64%"></div></div>
            <div class="vol-row"><span class="vol-label">Input vol</span><input type="range" id="inputVolume" min="0" max="200" value="${state.settings.inputVolume || 100}"><span id="inputVolumeLabel" style="font-family:var(--font-mono);font-size:11px;color:var(--txt-4);width:42px;text-align:right;">${state.settings.inputVolume || 100}%</span></div>
            <div class="vol-row"><span class="vol-label">Output vol</span><input type="range" id="outputVolume" min="0" max="200" value="${state.settings.outputVolume || 100}"><span id="outputVolumeLabel" style="font-family:var(--font-mono);font-size:11px;color:var(--txt-4);width:42px;text-align:right;">${state.settings.outputVolume || 100}%</span></div>
          </div>
          <div class="card-row" style="border-top:1px solid var(--line-1);border-bottom:1px solid var(--line-1);margin-top:10px;">
            <div class="grow"><div class="row-title">Input mode</div><div class="row-sub">Push-to-talk key: <span style="font-family:var(--font-mono);color:var(--ember-light);background:var(--bg-field);border:1px solid rgba(255,138,61,0.3);border-radius:5px;padding:1px 7px;" id="pttKeyBtn" onclick="capturePTTKey()">${state.settings.pushToTalkKey || 'set key'}</span></div></div>
            <select id="voiceMode" onchange="togglePTTKeyRow()" style="width:auto;">
              <option value="vad" ${state.settings.voiceActivated ? 'selected' : ''}>Voice activity</option>
              <option value="ptt" ${!state.settings.voiceActivated ? 'selected' : ''}>Push to talk</option>
            </select>
            <input type="hidden" id="pttKey" value="${state.settings.pushToTalkKey || ''}">
            <div id="pttKeyRow" style="display:none;"></div>
          </div>
          <div id="cameraPreviewContainer" style="display:none;margin-top:14px;background:var(--bg-card);border-radius:12px;overflow:hidden;"><video id="cameraPreview" autoplay playsinline muted style="width:100%;max-height:200px;transform:scaleX(-1);"></video></div>
          ${window.electronAPI ? `
          ${accent('Desktop')}
          <div class="section-card">
            <div class="card-row"><div class="grow"><div class="row-title">Minimize to tray</div></div><input type="checkbox" id="minimizeToTray" ${state.settings.minimizeToTray ? 'checked' : ''} style="accent-color:var(--ember);width:16px;height:16px;"></div>
            <div class="card-row"><div class="grow"><div class="row-title">Start minimized</div></div><input type="checkbox" id="startMinimized" ${state.settings.startMinimized ? 'checked' : ''} style="accent-color:var(--ember);width:16px;height:16px;"></div>
          </div>` : ''}
        </div>

        <!-- NOTIFICATIONS -->
        <div class="settings-pane" id="stab-notifications">
          <div class="settings-title">Notifications</div>
          <div class="settings-desc">Choose what reaches you, and how.</div>
          ${accent('Notify me about')}
          <div class="section-card">
            ${toggleRow('Direct messages', 'Private 1:1 conversations', true)}
            ${toggleRow('@mentions', 'When someone pings you', true)}
            ${toggleRow('All messages', 'Every message in every channel', false)}
            ${toggleRow('Voice activity', 'When friends join voice', true)}
            ${toggleRow('Server events', 'Joins, role changes, etc.', false)}
            ${toggleRow('Bot embeds', 'Watch-together and media bots', true)}
          </div>
          ${accent('Delivery')}
          <div class="section-card">
            ${toggleRow('Desktop notifications', '', true)}
            ${toggleRow('Notification sounds', '', true)}
            ${toggleRow('Mobile push', '', true)}
            ${toggleRow('Quiet hours', '10pm – 8am', false)}
          </div>
        </div>

        <!-- APPEARANCE -->
        <div class="settings-pane" id="stab-appearance">
          <div class="settings-title">Appearance</div>
          <div class="settings-desc">Ember is dark by nature — tune the shade and the accent.</div>
          ${accent('Theme')}
          <div class="theme-grid">
            <div class="theme-card ${state.theme === 'dark' ? 'active' : ''}" onclick="setTheme('dark'); refreshThemeCards();" data-theme="dark"><div class="swatch" style="background:#0C0B0A;"><span class="dot"></span><span class="bar"></span></div><div class="t-name">Ember Dark</div><div class="t-sub">Warm near-black</div></div>
            <div class="theme-card ${state.theme === 'midnight' ? 'active' : ''}" onclick="setTheme('midnight'); refreshThemeCards();" data-theme="midnight"><div class="swatch" style="background:#0d1016;"><span class="dot"></span><span class="bar"></span></div><div class="t-name">Midnight</div><div class="t-sub">Cool blue-black</div></div>
            <div class="theme-card ${state.theme === 'amoled' ? 'active' : ''}" onclick="setTheme('amoled'); refreshThemeCards();" data-theme="amoled"><div class="swatch" style="background:#000;"><span class="dot"></span><span class="bar"></span></div><div class="t-name">AMOLED</div><div class="t-sub">Pure black</div></div>
          </div>
          <div class="card-row" style="border-top:1px solid var(--line-1);border-bottom:1px solid var(--line-1);">
            <div class="grow"><div class="row-title">Accent color</div><div class="row-sub">Drives buttons, active states, and the ember glow</div></div>
            <div class="accent-swatches">
              <span class="active" style="background:#FF6A2B;"></span><span style="background:#FF8A3D;"></span><span style="background:#E8551F;"></span><span style="background:#FFB454;"></span><span style="background:#FF3D3D;"></span>
            </div>
          </div>
          <div class="card-row" style="border-bottom:1px solid var(--line-1);">
            <div class="grow"><div class="row-title">Message density</div><div class="row-sub">Compact mirrors the classic IRC log</div></div>
            <div class="segmented"><span onclick="this.parentElement.querySelectorAll('span').forEach(s=>s.classList.remove('active'));this.classList.add('active')">Cozy</span><span class="active" onclick="this.parentElement.querySelectorAll('span').forEach(s=>s.classList.remove('active'));this.classList.add('active')">Compact</span></div>
          </div>
          ${accent('Display')}
          <div class="section-card">
            ${toggleRow('24-hour timestamps', '', true)}
            ${toggleRow('Show avatars', '', true)}
            ${toggleRow('Reduce motion', '', false)}
            ${toggleRow('Underline links', '', false)}
          </div>
        </div>

        <!-- MEDIA BOTS -->
        <div class="settings-pane" id="stab-bots">
          <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:4px;">
            <div class="settings-title">8 built-in bots <span style="color:var(--txt-4);font-weight:400;font-size:15px;">· no subscriptions</span></div>
            <div style="font-family:var(--font-mono);font-size:11px;color:var(--on);">${enabledCount} enabled</div>
          </div>
          <div class="settings-desc">Enable a bot, set permissions per group, and toggle availability per channel.</div>
          <div class="bots-grid">
            ${bots.map(b => `
              <div class="bot-card ${b.on ? 'enabled' : ''}">
                <div class="bot-head">
                  <div class="bot-tile" style="background:${b.color};">${b.letter}</div>
                  <div style="flex:1;min-width:0;"><div class="bot-name">${b.name}</div><div class="bot-cat">${b.cat}</div></div>
                  <div class="toggle ${b.on ? 'on' : ''}" onclick="this.classList.toggle('on')"><span class="knob"></span></div>
                </div>
                <div class="bot-desc">${b.desc}</div>
                <div class="bot-foot">
                  <span class="bot-status ${b.on ? 'on' : ''}">${b.on ? '● enabled' : '○ disabled'}</span>
                  <span class="bot-config" onclick="${isAdmin ? `openAdminBotModal('${b.id}')` : `showToast('Only admins can configure bots','info')`}">Configure →</span>
                </div>
              </div>`).join('')}
          </div>
        </div>

        <!-- GROUPS & ROLES -->
        <div class="settings-pane" id="stab-groups">
          <div class="settings-title">Groups &amp; Roles</div>
          <div class="settings-desc">Define roles and what each can do on this server.</div>
          <div class="roles-grid">
            <div class="role-list">
              ${roles.map((r, i) => `<div class="role-item ${i === 0 ? 'active' : ''}"><span class="role-dot" style="background:${r.color};"></span><span class="role-name">${r.name}</span><span class="role-count">${r.count}</span></div>`).join('')}
              <button class="btn-secondary" style="margin-top:6px;" onclick="${isAdmin ? 'openGroupsModal()' : `showToast('Only admins can manage roles','info')`}">+ Manage roles</button>
            </div>
            <div class="section-card pad">
              <div class="row-title" style="margin-bottom:10px;">Permissions</div>
              ${toggleRow('Manage server', '', true)}
              ${toggleRow('Manage channels', '', true)}
              ${toggleRow('Kick members', '', true)}
              ${toggleRow('Ban members', '', true)}
              ${toggleRow('Manage messages', '', true)}
              ${toggleRow('Mute / move in voice', '', true)}
            </div>
          </div>
        </div>

        <!-- FEDERATION -->
        <div class="settings-pane" id="stab-federation">
          <div class="settings-title">Federation</div>
          <div class="settings-desc">Link servers into an Ember network with real-time sync.</div>
          <div class="section-card pad">
            <div class="row-title" style="margin-bottom:6px;">Linked servers</div>
            <div class="row-sub" style="margin-bottom:12px;">Manage which servers share channels, presence and messages.</div>
            <button class="btn-accent" onclick="${isAdmin ? 'openFederationModal()' : `showToast('Only admins can manage federation','info')`}">Open federation manager</button>
          </div>
          ${accent('Trust &amp; sync')}
          <div class="section-card">
            ${toggleRow('Auto-accept sync', 'Trust linked servers automatically', true)}
            ${toggleRow('Share presence', 'Show your status network-wide', true)}
            ${toggleRow('Federated voice', 'Allow cross-server voice rooms', false)}
          </div>
        </div>

        <!-- CHANNELS -->
        <div class="settings-pane" id="stab-channels">
          <div class="settings-title">Channels</div>
          <div class="settings-desc">Create and organize text, voice and watch channels.</div>
          <div class="section-card pad">
            <div class="row-title" style="margin-bottom:6px;">Channel management</div>
            <div class="row-sub" style="margin-bottom:12px;">Add categories and channels, reorder, and set per-channel options.</div>
            <button class="btn-accent" onclick="${isAdmin ? 'openCreateChannelModal()' : `showToast('Only admins can manage channels','info')`}">+ Create channel</button>
          </div>
          <div class="section-card" id="settingsChannelList"></div>
        </div>

        <!-- SERVER SETTINGS -->
        <div class="settings-pane" id="stab-server">
          <div class="settings-title">Server Settings</div>
          <div class="settings-desc">Identity, invites and maintenance for this server.</div>
          <div class="grid-2">
            <div class="field"><div class="field-label">Server name</div><div class="field-value">${escapeHtml(state.servers.find(s => s.id === state.currentServerId)?.name || 'Emberlan')}</div></div>
            <div class="field"><div class="field-label">Version</div><div class="field-value mono">v1.0.0</div></div>
          </div>
          ${accent('Invites')}
          <div class="section-card pad">
            <div class="row-title" style="margin-bottom:6px;">Invite people</div>
            <div class="row-sub" style="margin-bottom:12px;">Generate an invite link or code for new members.</div>
            <button class="btn-accent" onclick="${isAdmin ? 'openInviteModal()' : `showToast('Only admins can create invites','info')`}">Create invite</button>
            ${isAdmin ? `<button class="btn-secondary" style="margin-left:8px;" onclick="openCreateUserModal()">Create user</button><button class="btn-secondary" style="margin-left:8px;" onclick="openAdminPanel()">Manage users</button>` : ''}
          </div>
          ${accent('<span style="color:var(--dnd-c)">Danger zone</span>')}
          <div class="danger-card">
            <div class="card-row"><div class="grow"><div class="row-title">Restart server stack</div><div class="row-sub">Handled by your deployer / host</div></div><button class="btn-danger-outline" onclick="showToast('Restart from your host (docker compose restart)','info')">Info</button></div>
          </div>
        </div>

      </div>
    </div>
  `;

  document.body.appendChild(takeover);

  // Volume label updates
  const inV = document.getElementById('inputVolume');
  const outV = document.getElementById('outputVolume');
  inV?.addEventListener('input', (e) => { document.getElementById('inputVolumeLabel').textContent = e.target.value + '%'; });
  outV?.addEventListener('input', (e) => { document.getElementById('outputVolumeLabel').textContent = e.target.value + '%'; });

  // Populate the channels list inside settings
  renderSettingsChannelList();
}

// Switch the active settings panel
const SETTINGS_META = {
  account: ['User Settings', 'Account'], profile: ['User Settings', 'Profile'],
  voice: ['User Settings', 'Voice & Video'], notifications: ['User Settings', 'Notifications'],
  appearance: ['User Settings', 'Appearance'], bots: ['Server', 'Media Bots'],
  groups: ['Server', 'Groups & Roles'], federation: ['Server', 'Federation'],
  channels: ['Server', 'Channels'], server: ['Server', 'Server Settings'],
};
function switchSettingsTab(tab) {
  document.querySelectorAll('.settings-pane').forEach(p => p.classList.toggle('active', p.id === `stab-${tab}`));
  document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const crumb = document.getElementById('settingsCrumb');
  const meta = SETTINGS_META[tab];
  if (crumb && meta) crumb.innerHTML = `${meta[0]} / <b>${meta[1]}</b>`;
  const scroll = document.querySelector('.settings-scroll');
  if (scroll) scroll.scrollTop = 0;
}
function closeSettings() {
  document.querySelector('.settings-takeover')?.remove();
}
function refreshThemeCards() {
  document.querySelectorAll('.theme-card').forEach(c => c.classList.toggle('active', c.dataset.theme === state.theme));
}
function renderSettingsChannelList() {
  const el = document.getElementById('settingsChannelList');
  if (!el) return;
  const chans = state.channels || [];
  if (!chans.length) { el.innerHTML = '<div class="card-row"><div class="row-sub">No channels yet.</div></div>'; return; }
  el.innerHTML = chans.map(c => {
    const isVoice = ['voice', 'video'].includes(c.type);
    return `<div class="card-row"><span style="color:var(--txt-5);width:18px;text-align:center;font-family:var(--font-mono);">${isVoice ? '🔊' : '#'}</span><div class="grow"><div class="row-title" style="font-family:var(--font-mono);font-size:13px;">${escapeHtml(c.name)}</div></div><span class="row-sub">${escapeHtml(c.category || 'General')}</span></div>`;
  }).join('');
}

// Enumerate available media devices
async function enumerateDevices() {
  try {
    // Request permission first to get device labels
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      stream.getTracks().forEach(track => track.stop());
    } catch (e) {
      // Try audio only if video fails
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(track => track.stop());
      } catch (e2) {
        console.log('Could not get media permissions for device enumeration');
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();

    state.devices.audioInputs = devices.filter(d => d.kind === 'audioinput');
    state.devices.audioOutputs = devices.filter(d => d.kind === 'audiooutput');
    state.devices.videoInputs = devices.filter(d => d.kind === 'videoinput');
  } catch (error) {
    console.error('Failed to enumerate devices:', error);
  }
}

// Toggle PTT key row visibility
function togglePTTKeyRow() {
  const voiceMode = document.getElementById('voiceMode').value;
  const pttRow = document.getElementById('pttKeyRow');
  pttRow.style.display = voiceMode === 'ptt' ? 'flex' : 'none';
}

// Test microphone
let micTestStream = null;
async function testMicrophone() {
  const deviceId = document.getElementById('audioInputDevice').value;

  if (micTestStream) {
    micTestStream.getTracks().forEach(t => t.stop());
    micTestStream = null;
    showToast('Microphone test stopped', 'info');
    return;
  }

  try {
    micTestStream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true
    });
    showToast('Microphone working! Speak to test. Click again to stop.', 'success');
  } catch (error) {
    showToast('Could not access microphone: ' + error.message, 'error');
  }
}

// Test camera preview
let cameraTestStream = null;
async function testCamera() {
  const deviceId = document.getElementById('cameraDevice').value;
  const container = document.getElementById('cameraPreviewContainer');
  const video = document.getElementById('cameraPreview');

  if (cameraTestStream) {
    cameraTestStream.getTracks().forEach(t => t.stop());
    cameraTestStream = null;
    video.srcObject = null;
    container.style.display = 'none';
    return;
  }

  try {
    cameraTestStream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true
    });
    video.srcObject = cameraTestStream;
    container.style.display = 'block';
  } catch (error) {
    showToast('Could not access camera: ' + error.message, 'error');
  }
}

async function saveSettings() {
  // Stop any test streams before saving
  if (micTestStream) {
    micTestStream.getTracks().forEach(t => t.stop());
    micTestStream = null;
  }
  if (cameraTestStream) {
    cameraTestStream.getTracks().forEach(t => t.stop());
    cameraTestStream = null;
  }

  const newSettings = {
    // Device settings
    audioInputDevice: document.getElementById('audioInputDevice').value,
    audioOutputDevice: document.getElementById('audioOutputDevice').value,
    cameraDevice: document.getElementById('cameraDevice').value,
    // Audio settings
    inputVolume: parseInt(document.getElementById('inputVolume').value),
    outputVolume: parseInt(document.getElementById('outputVolume').value),
    voiceActivated: document.getElementById('voiceMode').value === 'vad',
    pushToTalkKey: document.getElementById('pttKey').value,
    // Screen sharing settings
    screenShareQuality: document.getElementById('screenShareQuality').value
  };

  // Electron-only behavior settings
  if (window.electronAPI) {
    newSettings.minimizeToTray = document.getElementById('minimizeToTray')?.checked || false;
    newSettings.startMinimized = document.getElementById('startMinimized')?.checked || false;
  }

  state.settings = { ...state.settings, ...newSettings };

  if (window.electronAPI) {
    await window.electronAPI.saveSettings(newSettings);
  }

  // Save profile updates
  const displayName = document.getElementById('displayName')?.value ?? state.user?.displayName ?? '';
  const steamId = document.getElementById('steamId')?.value ?? state.user?.steamId ?? '';
  const pronouns = document.getElementById('pronouns')?.value;
  const about = document.getElementById('aboutMe')?.value;
  const customStatus = document.getElementById('customStatus')?.value;

  const profileBody = { displayName, steamId };
  if (pronouns !== undefined) profileBody.pronouns = pronouns;
  if (about !== undefined) profileBody.about = about;
  if (customStatus !== undefined) profileBody.customStatus = customStatus;

  try {
    await fetch(`${state.serverUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify(profileBody)
    });

    if (state.user) {
      state.user.displayName = displayName;
      state.user.steamId = steamId;
      if (pronouns !== undefined) state.user.pronouns = pronouns;
      if (about !== undefined) state.user.about = about;
      if (customStatus !== undefined) state.user.customStatus = customStatus;
    }
  } catch (error) {
    console.error('Failed to update profile:', error);
  }

  closeSettings();
  closeModal();
  showToast('Settings saved', 'success');
  renderMainApp();
  renderChannels();
  loadDMConversations();

  // Re-select current channel to restore messages
  if (state.currentChannel) {
    selectChannel(state.currentChannel);
  }
}

// Capture a key for PTT
function capturePTTKey() {
  const btn = document.getElementById('pttKeyBtn');
  const input = document.getElementById('pttKey');
  if (!btn) return;

  btn.textContent = 'Press any key...';
  btn.style.borderColor = 'var(--accent-primary)';

  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Use the key code (e.g., 'Space', 'KeyV', 'F1')
    const keyCode = e.code;
    btn.textContent = keyCode;
    btn.style.borderColor = 'var(--bg-light)';
    input.value = keyCode;

    document.removeEventListener('keydown', handler);
  };

  document.addEventListener('keydown', handler);
}

// ===== Admin Panel Functions =====
function openInviteModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Create Invite</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="settings-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <label>Email (optional)</label>
        <input type="email" id="inviteEmail" placeholder="user@example.com" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        <small style="color: var(--text-muted);">Leave blank to generate a link without sending email</small>
      </div>
      <div class="settings-row" style="margin-top: 16px;">
        <label>Max Uses</label>
        <input type="number" id="inviteMaxUses" value="1" min="1" max="100" style="width: 80px; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
      </div>
      <div id="inviteResult" style="display: none; margin-top: 16px; padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm);">
        <label style="font-size: 12px; color: var(--text-muted);">Invite Code:</label>
        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <input type="text" id="inviteCode" readonly style="flex: 1; padding: 8px; background: var(--bg-medium); border: 1px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--accent-primary); font-family: monospace;">
          <button class="btn-secondary" onclick="copyInviteCode()">Copy</button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
      <button class="btn-primary" onclick="createInvite()">Generate Invite</button>
    </div>
  `;

  overlay.classList.add('active');
}

async function createInvite() {
  const email = document.getElementById('inviteEmail').value;
  const maxUses = parseInt(document.getElementById('inviteMaxUses').value) || 1;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/invites`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ email: email || null, maxUses })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    document.getElementById('inviteCode').value = result.invite?.code || result.code;
    document.getElementById('inviteResult').style.display = 'block';
    showToast('Invite created!', 'success');
  } catch (error) {
    showToast('Failed to create invite: ' + error.message, 'error');
  }
}

function copyInviteCode() {
  const code = document.getElementById('inviteCode');
  code.select();
  document.execCommand('copy');
  showToast('Invite code copied!', 'success');
}

function openCreateUserModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Create User</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="settings-row" style="flex-direction: column; align-items: flex-start; gap: 8px;">
        <label>Username</label>
        <input type="text" id="newUsername" required style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
      </div>
      <div class="settings-row" style="flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 12px;">
        <label>Email</label>
        <input type="email" id="newEmail" required style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
      </div>
      <div class="settings-row" style="flex-direction: column; align-items: flex-start; gap: 8px; margin-top: 12px;">
        <label>Password</label>
        <input type="password" id="newPassword" required style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
      </div>
      <div class="settings-row" style="margin-top: 12px;">
        <label>Role</label>
        <select id="newRole" style="padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          <option value="user">User</option>
          <option value="moderator">Moderator</option>
          <option value="admin">Admin</option>
        </select>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="createUser()">Create User</button>
    </div>
  `;

  overlay.classList.add('active');
}

async function createUser() {
  const username = document.getElementById('newUsername').value;
  const email = document.getElementById('newEmail').value;
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;

  if (!username || !email || !password) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ username, email, password, role })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('User created successfully!', 'success');
    closeModal();
  } catch (error) {
    showToast('Failed to create user: ' + error.message, 'error');
  }
}

async function openAdminPanel() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>User Management</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height: 400px; overflow-y: auto;">
      <div id="adminUserList">Loading users...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');

  // Load users
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/users`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const users = data.users || [];

    const userListHtml = users.map(user => `
      <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
        <div style="width: 36px; height: 36px; border-radius: 50%; background: ${getRoleColor(user.role)}; display: flex; align-items: center; justify-content: center; font-weight: 600;">
          ${user.username.charAt(0).toUpperCase()}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 500;">${escapeHtml(user.displayName || user.username)}</div>
          <div style="font-size: 12px; color: var(--text-muted);">@${escapeHtml(user.username)} • ${user.role}</div>
        </div>
        ${user._id !== state.user._id ? `
          <select onchange="updateUserRole('${user._id}', this.value)" style="padding: 6px; background: var(--bg-medium); border: 1px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option>
            <option value="moderator" ${user.role === 'moderator' ? 'selected' : ''}>Moderator</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        ` : '<span style="color: var(--text-muted); font-size: 12px;">You</span>'}
      </div>
    `).join('');

    document.getElementById('adminUserList').innerHTML = userListHtml || '<p style="color: var(--text-muted);">No users found</p>';
  } catch (error) {
    document.getElementById('adminUserList').innerHTML = `<p style="color: var(--danger);">Failed to load users: ${error.message}</p>`;
  }
}

async function updateUserRole(userId, role) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/users/${userId}/role`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ role })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('User role updated', 'success');
  } catch (error) {
    showToast('Failed to update role: ' + error.message, 'error');
    openAdminPanel(); // Refresh the list
  }
}

// YouTube Bot Modal
async function openYouTubeBotModal() {
  const prevModal = state.previousModal; // Preserve for refresh
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>YouTube Bot</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="youtubeBotContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal; // Restore for refresh

  // Load bot status
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/youtube-bot/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    renderYouTubeBotContent(data);
  } catch (error) {
    document.getElementById('youtubeBotContent').innerHTML = `
      <p style="color: var(--danger);">Failed to load YouTube bot status: ${error.message}</p>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">
        Make sure the server has ytdl-core installed: <code>npm install @distube/ytdl-core</code>
      </p>
    `;
  }
}

function renderYouTubeBotContent(data) {
  const { enabled, activeStreams } = data;
  const streamList = activeStreams || [];

  document.getElementById('youtubeBotContent').innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Bot Status</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--text-muted);">Status:</span>
          <span style="color: ${enabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">
            ${enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <button class="btn-${enabled ? 'danger' : 'primary'}" onclick="toggleYouTubeBot(${!enabled})">
          ${enabled ? 'Disable Bot' : 'Enable Bot'}
        </button>
      </div>
    </div>

    ${enabled ? `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Play Video</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <label style="min-width: 80px;">Channel:</label>
          <select id="ytBotChannel" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
            ${state.channels.filter(c => c.type === 'voice' || c.type === 'video').map(c => `
              <option value="${c._id}">${escapeHtml(c.name)}</option>
            `).join('')}
          </select>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <label style="min-width: 80px;">URL:</label>
          <input type="text" id="ytBotUrl" placeholder="YouTube video URL" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-primary" onclick="playYouTubeVideo()">Play</button>
          <button class="btn-secondary" onclick="previewYouTubeVideo()">Preview Info</button>
        </div>
        <div id="ytVideoPreview" style="display: none; padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm);"></div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Active Streams (${streamList.length})</h3>
      <div id="ytActiveStreams" style="margin-top: 12px;">
        ${streamList.length > 0 ? streamList.map(stream => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(stream.title || 'Unknown')}</div>
              <div style="font-size: 12px; color: var(--text-muted);">
                Channel: ${escapeHtml(stream.channelName || stream.channelId)} •
                By: ${escapeHtml(stream.requestedBy || 'Unknown')}
              </div>
            </div>
            <button class="btn-danger" onclick="stopYouTubeStream('${stream.channelId}')" style="padding: 6px 12px;">Stop</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No active streams</p>'}
      </div>
      ${streamList.length > 0 ? `
        <button class="btn-danger" onclick="stopAllYouTubeStreams()" style="margin-top: 12px;">Stop All Streams</button>
      ` : ''}
    </div>
    ` : `
    <div style="text-align: center; padding: 24px; color: var(--text-muted);">
      <p>Enable the bot to play YouTube videos in voice channels.</p>
    </div>
    `}
  `;
}

async function toggleYouTubeBot(enabled) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/youtube-bot/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ enabled })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast(result.message, 'success');
    openYouTubeBotModal(); // Refresh
  } catch (error) {
    showToast('Failed to toggle bot: ' + error.message, 'error');
  }
}

async function previewYouTubeVideo() {
  const url = document.getElementById('ytBotUrl').value.trim();
  if (!url) {
    showToast('Please enter a YouTube URL', 'error');
    return;
  }

  const preview = document.getElementById('ytVideoPreview');
  preview.style.display = 'block';
  preview.innerHTML = 'Loading video info...';

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/youtube-bot/video-info?url=${encodeURIComponent(url)}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    preview.innerHTML = `
      <div style="display: flex; gap: 12px;">
        ${data.thumbnail ? `<img src="${data.thumbnail}" style="width: 120px; height: 68px; border-radius: 4px; object-fit: cover;">` : ''}
        <div>
          <div style="font-weight: 600;">${escapeHtml(data.title)}</div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
            ${escapeHtml(data.author)} • ${data.duration || 'Unknown duration'}
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    preview.innerHTML = `<span style="color: var(--danger);">Failed to load: ${error.message}</span>`;
  }
}

async function playYouTubeVideo() {
  const channelId = document.getElementById('ytBotChannel').value;
  const url = document.getElementById('ytBotUrl').value.trim();

  if (!channelId) {
    showToast('Please select a channel', 'error');
    return;
  }
  if (!url) {
    showToast('Please enter a YouTube URL', 'error');
    return;
  }

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/youtube-bot/play`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ channelId, url })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast(`Now playing: ${result.title || 'Video'}`, 'success');
    openYouTubeBotModal(); // Refresh
  } catch (error) {
    showToast('Failed to play video: ' + error.message, 'error');
  }
}

async function stopYouTubeStream(channelId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/youtube-bot/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ channelId })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('Playback stopped', 'success');
    openYouTubeBotModal(); // Refresh
  } catch (error) {
    showToast('Failed to stop: ' + error.message, 'error');
  }
}

async function stopAllYouTubeStreams() {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/youtube-bot/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({})
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('All streams stopped', 'success');
    openYouTubeBotModal(); // Refresh
  } catch (error) {
    showToast('Failed to stop streams: ' + error.message, 'error');
  }
}

// ==================== Plex Bot Modal ====================
async function openPlexBotModal() {
  const prevModal = state.previousModal;
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Plex Bot</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="plexBotContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    renderPlexBotContent(data);
  } catch (error) {
    document.getElementById('plexBotContent').innerHTML = `
      <p style="color: var(--danger);">Failed to load Plex bot status: ${error.message}</p>
    `;
  }
}

function renderPlexBotContent(data) {
  const { enabled, connected, activeStreams, serverInfo } = data;
  const streamList = activeStreams || [];

  document.getElementById('plexBotContent').innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Bot Status</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--text-muted);">Status:</span>
          <span style="color: ${enabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">
            ${enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="color: var(--text-muted);">Plex:</span>
          <span style="color: ${connected ? 'var(--success)' : 'var(--text-muted)'}; font-weight: 600;">
            ${connected ? 'Connected' : 'Not Connected'}
          </span>
        </div>
        <button class="btn-${enabled ? 'danger' : 'primary'}" onclick="togglePlexBot(${!enabled})">
          ${enabled ? 'Disable Bot' : 'Enable Bot'}
        </button>
      </div>
    </div>

    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Plex Account</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        ${connected && serverInfo ? `
          <div style="padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm);">
            <div style="font-weight: 600;">${escapeHtml(serverInfo.name || 'Plex Server')}</div>
            <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
              ${serverInfo.libraries?.length || 0} libraries available
            </div>
          </div>
          <button class="btn-danger" onclick="disconnectPlex()">Disconnect Plex</button>
        ` : `
          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="min-width: 100px;">Server URL:</label>
            <input type="text" id="plexServerUrl" placeholder="http://your-plex:32400" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <label style="min-width: 100px;">Plex Token:</label>
            <input type="password" id="plexToken" placeholder="Your Plex token" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
          <div style="font-size: 11px; color: var(--text-muted);">
            Get your token from app.plex.tv settings or use plex-token CLI tools
          </div>
          <button class="btn-primary" onclick="connectPlex()">Connect to Plex</button>
        `}
      </div>
    </div>

    ${enabled && connected ? `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Play Media</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <label style="min-width: 80px;">Channel:</label>
          <select id="plexBotChannel" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
            ${state.channels.filter(c => c.type === 'voice' || c.type === 'video').map(c => `
              <option value="${c._id}">${escapeHtml(c.name)}</option>
            `).join('')}
          </select>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <label style="min-width: 80px;">Search:</label>
          <input type="text" id="plexSearch" placeholder="Search for music, movies..." style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          <button class="btn-secondary" onclick="searchPlex()">Search</button>
        </div>
        <div id="plexSearchResults" style="max-height: 200px; overflow-y: auto;"></div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Active Streams (${streamList.length})</h3>
      <div id="plexActiveStreams" style="margin-top: 12px;">
        ${streamList.length > 0 ? streamList.map(stream => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(stream.title || 'Unknown')}</div>
              <div style="font-size: 12px; color: var(--text-muted);">
                Channel: ${escapeHtml(stream.channelName || stream.channelId)}
              </div>
            </div>
            <button class="btn-danger" onclick="stopPlexStream('${stream.channelId}')" style="padding: 6px 12px;">Stop</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No active streams</p>'}
      </div>
      ${streamList.length > 0 ? `
        <button class="btn-danger" onclick="stopAllPlexStreams()" style="margin-top: 12px;">Stop All Streams</button>
      ` : ''}
    </div>
    ` : ''}
  `;
}

async function togglePlexBot(enabled) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/enable`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ enabled })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast(result.message, 'success');
    openPlexBotModal();
  } catch (error) {
    showToast('Failed to toggle Plex bot: ' + error.message, 'error');
  }
}

async function connectPlex() {
  const serverUrl = document.getElementById('plexServerUrl').value.trim();
  const token = document.getElementById('plexToken').value.trim();

  if (!serverUrl || !token) {
    showToast('Please enter server URL and token', 'error');
    return;
  }

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ serverUrl, token })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('Connected to Plex!', 'success');
    openPlexBotModal();
  } catch (error) {
    showToast('Failed to connect: ' + error.message, 'error');
  }
}

async function disconnectPlex() {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/disconnect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      }
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('Disconnected from Plex', 'success');
    openPlexBotModal();
  } catch (error) {
    showToast('Failed to disconnect: ' + error.message, 'error');
  }
}

async function searchPlex() {
  const query = document.getElementById('plexSearch').value.trim();
  if (!query) {
    showToast('Please enter a search query', 'error');
    return;
  }

  const resultsDiv = document.getElementById('plexSearchResults');
  resultsDiv.innerHTML = 'Searching...';

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/search?query=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const results = data.results || [];
    resultsDiv.innerHTML = results.length > 0 ? results.map(item => `
      <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px; cursor: pointer;" onclick="playPlexItem('${item.ratingKey}')">
        ${item.thumb ? `<img src="${state.serverUrl}/api/admin/plex-bot/thumb?key=${encodeURIComponent(item.thumb)}" style="width: 48px; height: 48px; border-radius: 4px; object-fit: cover;">` : ''}
        <div style="flex: 1;">
          <div style="font-weight: 500;">${escapeHtml(item.title)}</div>
          <div style="font-size: 12px; color: var(--text-muted);">${escapeHtml(item.type)} ${item.year ? '(' + item.year + ')' : ''}</div>
        </div>
        <button class="btn-primary" style="padding: 6px 12px;" onclick="event.stopPropagation(); playPlexItem('${item.ratingKey}')">Play</button>
      </div>
    `).join('') : '<p style="color: var(--text-muted);">No results found</p>';
  } catch (error) {
    resultsDiv.innerHTML = `<span style="color: var(--danger);">Search failed: ${error.message}</span>`;
  }
}

async function playPlexItem(ratingKey) {
  const channelId = document.getElementById('plexBotChannel').value;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/play`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ channelId, ratingKey })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast(`Now playing: ${result.title || 'Media'}`, 'success');
    openPlexBotModal();
  } catch (error) {
    showToast('Failed to play: ' + error.message, 'error');
  }
}

async function stopPlexStream(channelId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ channelId })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('Playback stopped', 'success');
    openPlexBotModal();
  } catch (error) {
    showToast('Failed to stop: ' + error.message, 'error');
  }
}

async function stopAllPlexStreams() {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/plex-bot/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({})
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('All Plex streams stopped', 'success');
    openPlexBotModal();
  } catch (error) {
    showToast('Failed to stop streams: ' + error.message, 'error');
  }
}

// ==================== Federation Modal ====================
async function openFederationModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Federation</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height: 500px; overflow-y: auto;">
      <div id="federationContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');

  try {
    const response = await fetch(`${state.serverUrl}/api/federation/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    renderFederationContent(data);
  } catch (error) {
    document.getElementById('federationContent').innerHTML = `
      <p style="color: var(--danger);">Failed to load federation status: ${error.message}</p>
    `;
  }
}

function renderFederationContent(data) {
  const { enabled, serverId, serverName, servers, pendingRequests } = data;

  document.getElementById('federationContent').innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>This Server</h3>
      <div style="padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-top: 12px;">
        <div style="font-weight: 600;">${escapeHtml(serverName || 'Emberlan Server')}</div>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          ID: ${serverId || 'Unknown'}<br>
          Federation: ${enabled ? '<span style="color: var(--success);">Enabled</span>' : '<span style="color: var(--danger);">Disabled</span>'}
        </div>
      </div>
    </div>

    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Join Federation</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <div style="display: flex; gap: 8px; align-items: center;">
          <label style="min-width: 100px;">Server URL:</label>
          <input type="text" id="federationTargetUrl" placeholder="https://other-server.com" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-secondary" onclick="analyzeFederation()">Analyze</button>
          <button class="btn-primary" onclick="initiateFederation()">Connect</button>
        </div>
        <div id="federationAnalysis" style="display: none; padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm);"></div>
      </div>
    </div>

    ${pendingRequests && pendingRequests.length > 0 ? `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Pending Requests (${pendingRequests.length})</h3>
      <div style="margin-top: 12px;">
        ${pendingRequests.map(req => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(req.fromServer?.name || 'Unknown Server')}</div>
              <div style="font-size: 12px; color: var(--text-muted);">
                ${escapeHtml(req.fromServer?.url || '')}
              </div>
            </div>
            <button class="btn-primary" onclick="approveFederationRequest('${req._id}')" style="padding: 6px 12px;">Approve</button>
            <button class="btn-danger" onclick="rejectFederationRequest('${req._id}')" style="padding: 6px 12px;">Reject</button>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}

    <div class="settings-section">
      <h3>Connected Servers (${servers?.filter(s => s.status === 'active').length || 0})</h3>
      <div style="margin-top: 12px;">
        ${servers && servers.length > 0 ? servers.map(server => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="width: 10px; height: 10px; border-radius: 50%; background: ${server.status === 'active' ? 'var(--success)' : 'var(--danger)'};"></div>
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(server.name)}</div>
              <div style="font-size: 12px; color: var(--text-muted);">
                ${escapeHtml(server.url)} • ${server.status}
              </div>
            </div>
            <button class="btn-danger" onclick="removeFederatedServer('${server.serverId}')" style="padding: 6px 12px;">Remove</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No federated servers</p>'}
      </div>
    </div>
  `;
}

async function analyzeFederation() {
  const targetUrl = document.getElementById('federationTargetUrl').value.trim();
  if (!targetUrl) {
    showToast('Please enter a server URL', 'error');
    return;
  }

  const analysisDiv = document.getElementById('federationAnalysis');
  analysisDiv.style.display = 'block';
  analysisDiv.innerHTML = 'Analyzing...';

  try {
    const response = await fetch(`${state.serverUrl}/api/federation/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ targetUrl })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    analysisDiv.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">Server: ${escapeHtml(data.targetServer?.name || 'Unknown')}</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px;">
        Users: ${data.targetServer?.stats?.userCount || 0} •
        Channels: ${data.targetServer?.stats?.channelCount || 0}
      </div>
      ${data.hasConflicts ? `
        <div style="color: var(--warning); font-size: 12px;">
          ${data.conflicts.length} channel name conflict(s) detected
        </div>
      ` : `
        <div style="color: var(--success); font-size: 12px;">No conflicts detected</div>
      `}
    `;
  } catch (error) {
    analysisDiv.innerHTML = `<span style="color: var(--danger);">Analysis failed: ${error.message}</span>`;
  }
}

async function initiateFederation() {
  const targetUrl = document.getElementById('federationTargetUrl').value.trim();
  if (!targetUrl) {
    showToast('Please enter a server URL', 'error');
    return;
  }

  try {
    const response = await fetch(`${state.serverUrl}/api/federation/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ targetUrl })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast(result.message || 'Federation request sent!', 'success');
    openFederationModal();
  } catch (error) {
    showToast('Federation failed: ' + error.message, 'error');
  }
}

async function approveFederationRequest(requestId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/federation/requests/${requestId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      }
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('Federation approved!', 'success');
    openFederationModal();
  } catch (error) {
    showToast('Failed to approve: ' + error.message, 'error');
  }
}

async function rejectFederationRequest(requestId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/federation/requests/${requestId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ reason: 'Rejected by admin' })
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('Federation request rejected', 'info');
    openFederationModal();
  } catch (error) {
    showToast('Failed to reject: ' + error.message, 'error');
  }
}

async function removeFederatedServer(serverId) {
  if (!confirm('Are you sure you want to remove this federated server?')) return;

  try {
    const response = await fetch(`${state.serverUrl}/api/federation/servers/${serverId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('Server removed from federation', 'success');
    openFederationModal();
  } catch (error) {
    showToast('Failed to remove server: ' + error.message, 'error');
  }
}

// ==================== Kick User Function ====================
async function kickUserFromChannel(userId, channelId) {
  if (!confirm('Are you sure you want to kick this user from the channel?')) return;

  try {
    const response = await fetch(`${state.serverUrl}/api/channels/${channelId}/kick/${userId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      }
    });

    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    showToast('User kicked from channel', 'success');
  } catch (error) {
    showToast('Failed to kick user: ' + error.message, 'error');
  }
}

// ==================== Emby Bot Modal ====================
async function openEmbyBotModal() {
  const prevModal = state.previousModal;
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Emby Bot</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="embyBotContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/emby-bot/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderMediaBotContent('emby', data);
  } catch (error) {
    document.getElementById('embyBotContent').innerHTML = `<p style="color: var(--danger);">Failed to load: ${error.message}</p>`;
  }
}

// ==================== Jellyfin Bot Modal ====================
async function openJellyfinBotModal() {
  const prevModal = state.previousModal;
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Jellyfin Bot</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="jellyfinBotContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/jellyfin-bot/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderMediaBotContent('jellyfin', data);
  } catch (error) {
    document.getElementById('jellyfinBotContent').innerHTML = `<p style="color: var(--danger);">Failed to load: ${error.message}</p>`;
  }
}

// Generic media bot content renderer (Emby/Jellyfin)
function renderMediaBotContent(botType, data) {
  const { enabled, connected, serverInfo, activeStreams } = data;
  const streamList = activeStreams || [];
  const contentId = `${botType}BotContent`;

  document.getElementById(contentId).innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Bot Status</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <span style="color: ${enabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${enabled ? 'Enabled' : 'Disabled'}</span>
        <span style="color: ${connected ? 'var(--success)' : 'var(--text-muted)'};">${connected ? 'Connected' : 'Not Connected'}</span>
        <button class="btn-${enabled ? 'danger' : 'primary'}" onclick="toggleMediaBot('${botType}', ${!enabled})">${enabled ? 'Disable' : 'Enable'}</button>
      </div>
    </div>

    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Server Connection</h3>
      ${connected && serverInfo ? `
        <div style="padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-top: 12px;">
          <div style="font-weight: 600;">${escapeHtml(serverInfo.name || 'Server')}</div>
          <div style="font-size: 12px; color: var(--text-muted);">Version: ${serverInfo.version || 'Unknown'}</div>
        </div>
        <button class="btn-danger" onclick="disconnectMediaBot('${botType}')" style="margin-top: 8px;">Disconnect</button>
      ` : `
        <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
          <input type="text" id="${botType}ServerUrl" placeholder="Server URL (http://server:port)" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          <input type="password" id="${botType}ApiKey" placeholder="API Key" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          <button class="btn-primary" onclick="connectMediaBot('${botType}')">Connect</button>
        </div>
      `}
    </div>

    ${enabled && connected ? `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Play Media</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <select id="${botType}Channel" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          ${state.channels.filter(c => c.type === 'voice' || c.type === 'video').map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="${botType}Search" placeholder="Search..." style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          <button class="btn-secondary" onclick="searchMediaBot('${botType}')">Search</button>
        </div>
        <div id="${botType}Results" style="max-height: 200px; overflow-y: auto;"></div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Active Streams (${streamList.length})</h3>
      <div style="margin-top: 12px;">
        ${streamList.length > 0 ? streamList.map(s => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(s.title || 'Unknown')}</div>
            </div>
            <button class="btn-danger" onclick="stopMediaBot('${botType}', '${s.channelId}')" style="padding: 6px 12px;">Stop</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No active streams</p>'}
      </div>
    </div>
    ` : ''}
  `;
}

async function toggleMediaBot(botType, enabled) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/${botType}-bot/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ enabled })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast(result.message, 'success');
    if (botType === 'emby') openEmbyBotModal();
    else if (botType === 'jellyfin') openJellyfinBotModal();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function connectMediaBot(botType) {
  const serverUrl = document.getElementById(`${botType}ServerUrl`).value.trim();
  const apiKey = document.getElementById(`${botType}ApiKey`).value.trim();
  if (!serverUrl || !apiKey) { showToast('Please enter server URL and API key', 'error'); return; }
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/${botType}-bot/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ serverUrl, apiKey })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast('Connected!', 'success');
    if (botType === 'emby') openEmbyBotModal();
    else if (botType === 'jellyfin') openJellyfinBotModal();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function disconnectMediaBot(botType) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/${botType}-bot/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` }
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast('Disconnected', 'success');
    if (botType === 'emby') openEmbyBotModal();
    else if (botType === 'jellyfin') openJellyfinBotModal();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function searchMediaBot(botType) {
  const query = document.getElementById(`${botType}Search`).value.trim();
  if (!query) { showToast('Enter a search term', 'error'); return; }
  const resultsDiv = document.getElementById(`${botType}Results`);
  resultsDiv.innerHTML = 'Searching...';
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/${botType}-bot/search?query=${encodeURIComponent(query)}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    resultsDiv.innerHTML = data.results?.length > 0 ? data.results.map(item => `
      <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
        <div style="flex: 1;"><div style="font-weight: 500;">${escapeHtml(item.title)}</div><div style="font-size: 12px; color: var(--text-muted);">${item.type}</div></div>
        <button class="btn-primary" onclick="playMediaBot('${botType}', '${item.itemId}')" style="padding: 6px 12px;">Play</button>
      </div>
    `).join('') : '<p style="color: var(--text-muted);">No results</p>';
  } catch (error) {
    resultsDiv.innerHTML = `<span style="color: var(--danger);">${error.message}</span>`;
  }
}

async function playMediaBot(botType, itemId) {
  const channelId = document.getElementById(`${botType}Channel`).value;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/${botType}-bot/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ channelId, itemId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast(`Playing: ${result.title || 'Media'}`, 'success');
    if (botType === 'emby') openEmbyBotModal();
    else if (botType === 'jellyfin') openJellyfinBotModal();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function stopMediaBot(botType, channelId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/${botType}-bot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ channelId })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast('Stopped', 'success');
    if (botType === 'emby') openEmbyBotModal();
    else if (botType === 'jellyfin') openJellyfinBotModal();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

// ==================== Chrome Bot Modal ====================
async function openChromeBotModal() {
  const prevModal = state.previousModal; // Preserve for refresh
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Chrome Bot (Shared Browser)</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="chromeBotContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal; // Restore for navigation

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/chrome-bot/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderChromeBotContent(data);
  } catch (error) {
    document.getElementById('chromeBotContent').innerHTML = `<p style="color: var(--danger);">Failed to load: ${error.message}</p>`;
  }
}

function renderChromeBotContent(data) {
  const { enabled, activeSessions, safeSearch, blockedDomains } = data;
  document.getElementById('chromeBotContent').innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Bot Status</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <span style="color: ${enabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${enabled ? 'Enabled' : 'Disabled'}</span>
        <button class="btn-${enabled ? 'danger' : 'primary'}" onclick="toggleChromeBot(${!enabled})">${enabled ? 'Disable' : 'Enable'}</button>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">Allows users to share a browser session that everyone in the channel can view and control.</p>
    </div>

    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Content Filtering</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
          <input type="checkbox" id="chromeSafeSearch" ${safeSearch !== false ? 'checked' : ''} onchange="toggleChromeSafeSearch(this.checked)" style="accent-color: var(--accent-primary);">
          <span>Safe Search (NSFW Filter)</span>
        </label>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">When enabled, Google and other search engines will use safe search mode to filter explicit content.</p>

      <div style="margin-top: 12px;">
        <label style="display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">Blocked Domains (one per line)</label>
        <textarea id="chromeBlockedDomains" placeholder="example.com&#10;badsite.net" style="width: 100%; height: 80px; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary); font-family: inherit; resize: vertical;">${(blockedDomains || []).join('\\n')}</textarea>
        <button class="btn-secondary" onclick="saveChromeBotSettings()" style="margin-top: 8px;">Save Filter Settings</button>
      </div>
    </div>

    ${enabled ? `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Start Session</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <select id="chromeChannel" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          ${state.channels.filter(c => c.type === 'voice' || c.type === 'video').map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <input type="text" id="chromeStartUrl" value="https://google.com" placeholder="Starting URL" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        <button class="btn-primary" onclick="startChromeSession()">Start Browser Session</button>
      </div>
    </div>

    <div class="settings-section">
      <h3>Active Sessions (${activeSessions?.length || 0})</h3>
      <div style="margin-top: 12px;">
        ${activeSessions?.length > 0 ? activeSessions.map(s => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500; word-break: break-all;">${escapeHtml(s.url)}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${s.participantCount} participants • Controller: ${escapeHtml(s.controller)}</div>
            </div>
            <button class="btn-danger" onclick="stopChromeSession('${s.channelId}')" style="padding: 6px 12px;">Stop</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No active sessions</p>'}
      </div>
    </div>
    ` : ''}
  `;
}

async function toggleChromeSafeSearch(enabled) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/chrome-bot/safe-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ safeSearch: enabled })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast(enabled ? 'Safe search enabled' : 'Safe search disabled (NSFW allowed)', 'success');
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function saveChromeBotSettings(silent = false) {
  const blockedDomainsEl = document.getElementById('chromeBlockedDomains');
  if (!blockedDomainsEl) return; // Element doesn't exist, nothing to save

  const blockedDomains = blockedDomainsEl.value
    .split('\n')
    .map(d => d.trim())
    .filter(d => d.length > 0);

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/chrome-bot/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ blockedDomains })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    if (!silent) showToast('Chrome bot settings saved', 'success');
  } catch (error) {
    if (!silent) showToast('Failed: ' + error.message, 'error');
  }
}

async function toggleChromeBot(enabled) {
  const prevModal = state.previousModal; // Preserve previous modal state
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/chrome-bot/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ enabled })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast(result.message, 'success');
    openChromeBotModal();
    state.previousModal = prevModal; // Restore previous modal state
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function startChromeSession() {
  const channelId = document.getElementById('chromeChannel').value;
  const url = document.getElementById('chromeStartUrl').value.trim();
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/chrome-bot/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ channelId, url })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast('Browser session started', 'success');
    openChromeBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function stopChromeSession(channelId) {
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/chrome-bot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ channelId })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast('Session stopped', 'success');
    openChromeBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

// ==================== IPTV Bot Modal ====================
async function openIPTVBotModal() {
  const prevModal = state.previousModal; // Preserve for refresh
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>IPTV Bot</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height: 500px; overflow-y: auto;">
      <div id="iptvBotContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal; // Restore for navigation

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/iptv-bot/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderIPTVBotContent(data);
  } catch (error) {
    document.getElementById('iptvBotContent').innerHTML = `<p style="color: var(--danger);">Failed to load: ${error.message}</p>`;
  }
}

function renderIPTVBotContent(data) {
  const { enabled, configured, channelCount, groupCount, hasEPG, activeStreams, scheduledRecordingsCount } = data;
  document.getElementById('iptvBotContent').innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Bot Status</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <span style="color: ${enabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${enabled ? 'Enabled' : 'Disabled'}</span>
        <span style="color: ${configured ? 'var(--success)' : 'var(--text-muted)'};">${configured ? `${channelCount} channels` : 'Not Configured'}</span>
        <button class="btn-${enabled ? 'danger' : 'primary'}" onclick="toggleIPTVBot(${!enabled})">${enabled ? 'Disable' : 'Enable'}</button>
      </div>
    </div>

    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Configure IPTV</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <div>
          <label style="display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">M3U/M3U8 Playlist File</label>
          <input type="file" id="iptvPlaylistFile" accept=".m3u,.m3u8" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary); width: 100%;">
          <p style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Upload your M3U/M3U8 playlist file</p>
        </div>
        <div>
          <label style="display: block; font-size: 13px; color: var(--text-secondary); margin-bottom: 4px;">EPG/XMLTV URL (optional)</label>
          <input type="text" id="iptvEpgUrl" placeholder="https://example.com/epg.xml" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary); width: 100%;">
        </div>
        <button class="btn-primary" onclick="configureIPTV()">Load Playlist</button>
      </div>
    </div>

    ${enabled && configured ? `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Watch TV</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <select id="iptvVoiceChannel" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          ${state.channels.filter(c => c.type === 'voice' || c.type === 'video').map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <button class="btn-secondary" onclick="loadIPTVChannels()">Load Channel Guide</button>
        <div id="iptvChannelList" style="max-height: 200px; overflow-y: auto;"></div>
      </div>
    </div>

    <div class="settings-section">
      <h3>Active Streams (${activeStreams?.length || 0})</h3>
      <div style="margin-top: 12px;">
        ${activeStreams?.length > 0 ? activeStreams.map(s => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(s.iptvChannel)}</div>
              ${s.currentProgram ? `<div style="font-size: 12px; color: var(--text-muted);">Now: ${escapeHtml(s.currentProgram)}</div>` : ''}
            </div>
            <button class="btn-danger" onclick="stopIPTV('${s.channelId}')" style="padding: 6px 12px;">Stop</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No active streams</p>'}
      </div>
    </div>

    <div class="settings-section" style="margin-top: 16px;">
      <h3>Scheduled Recordings (${scheduledRecordingsCount || 0})</h3>
      <button class="btn-secondary" onclick="loadIPTVRecordings()" style="margin-top: 8px;">View Recordings</button>
      <div id="iptvRecordings" style="margin-top: 12px;"></div>
    </div>
    ` : ''}
  `;
}

async function toggleIPTVBot(enabled) {
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/iptv-bot/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ enabled })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast(result.message, 'success');
    openIPTVBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function configureIPTV() {
  const fileInput = document.getElementById('iptvPlaylistFile');
  const epgUrl = document.getElementById('iptvEpgUrl').value.trim();

  if (!fileInput.files || fileInput.files.length === 0) {
    showToast('Please select an M3U playlist file', 'error');
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('playlist', file);
  if (epgUrl) {
    formData.append('epgUrl', epgUrl);
  }

  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/iptv-bot/configure`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` },
      body: formData
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast(`Loaded ${result.channelCount} channels`, 'success');
    openIPTVBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function loadIPTVChannels() {
  const listDiv = document.getElementById('iptvChannelList');
  listDiv.innerHTML = 'Loading...';
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/iptv-bot/channels`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    listDiv.innerHTML = data.channels?.length > 0 ? data.channels.slice(0, 50).map(ch => `
      <div style="display: flex; align-items: center; gap: 12px; padding: 8px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 4px;">
        ${ch.logo ? `<img src="${ch.logo}" style="width: 32px; height: 32px; border-radius: 4px; object-fit: cover;">` : ''}
        <div style="flex: 1;"><div style="font-weight: 500;">${escapeHtml(ch.name)}</div><div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(ch.group)}</div></div>
        <button class="btn-primary" onclick="playIPTV('${ch.id}')" style="padding: 4px 8px; font-size: 12px;">Watch</button>
      </div>
    `).join('') : '<p style="color: var(--text-muted);">No channels</p>';
  } catch (error) {
    listDiv.innerHTML = `<span style="color: var(--danger);">${error.message}</span>`;
  }
}

async function playIPTV(iptvChannelId) {
  const voiceChannelId = document.getElementById('iptvVoiceChannel').value;
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/iptv-bot/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ voiceChannelId, iptvChannelId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast(`Now watching: ${result.channel}`, 'success');
    openIPTVBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function stopIPTV(voiceChannelId) {
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/iptv-bot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ voiceChannelId })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast('Stopped', 'success');
    openIPTVBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function loadIPTVRecordings() {
  const div = document.getElementById('iptvRecordings');
  div.innerHTML = 'Loading...';
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/iptv-bot/recordings`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    const all = [...(data.scheduled || []), ...(data.recordings || [])];
    div.innerHTML = all.length > 0 ? all.map(r => `
      <div style="padding: 8px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 4px;">
        <div style="font-weight: 500;">${escapeHtml(r.programTitle)}</div>
        <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(r.channelName)} • ${r.status}</div>
      </div>
    `).join('') : '<p style="color: var(--text-muted);">No recordings</p>';
  } catch (error) {
    div.innerHTML = `<span style="color: var(--danger);">${error.message}</span>`;
  }
}

// ==================== Channel Management Modals ====================

// Open create channel modal
function openCreateChannelModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Create Channel</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="settings-section">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px;">Channel Name</label>
            <input type="text" id="newChannelName" placeholder="general-chat" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px;">Channel Type</label>
            <select id="newChannelType" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
              <option value="text">Text Channel</option>
              <option value="voice">Voice Channel</option>
              <option value="video">Video Channel</option>
              <option value="announcement">Announcement</option>
            </select>
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px;">Category</label>
            <input type="text" id="newChannelCategory" placeholder="Text Channels" value="Text Channels" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px;">Topic/Description</label>
            <input type="text" id="newChannelDescription" placeholder="What's this channel about?" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="createChannel()">Create Channel</button>
    </div>
  `;

  overlay.classList.add('active');
}

// Create a new channel
async function createChannel() {
  const name = document.getElementById('newChannelName').value.trim();
  const type = document.getElementById('newChannelType').value;
  const category = document.getElementById('newChannelCategory').value.trim() || 'General';
  const description = document.getElementById('newChannelDescription').value.trim();

  if (!name) {
    showToast('Please enter a channel name', 'warning');
    return;
  }

  try {
    const response = await fetch(`${state.serverUrl}/api/channels`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, type, category, description })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast(`Channel #${data.channel.name} created!`, 'success');
    closeModal();

    // Refresh channels
    await loadChannels();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

// Open edit channel modal
async function openEditChannelModal(channelId) {
  const channel = state.channels.find(c => c._id === channelId);
  if (!channel) {
    showToast('Channel not found', 'error');
    return;
  }

  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Edit Channel</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="settings-section">
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px;">Channel Name</label>
            <input type="text" id="editChannelName" value="${escapeHtml(channel.name)}" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px;">Topic/Description</label>
            <input type="text" id="editChannelDescription" value="${escapeHtml(channel.description || '')}" placeholder="Set a topic for this channel" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted); font-size: 12px;">Category</label>
            <input type="text" id="editChannelCategory" value="${escapeHtml(channel.category || 'General')}" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          </div>
        </div>
      </div>
      <div class="settings-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--bg-light);">
        <h3 style="color: var(--danger);">Danger Zone</h3>
        <button class="btn-danger" onclick="deleteChannel('${channelId}')" style="margin-top: 8px;">Delete Channel</button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" onclick="saveChannelChanges('${channelId}')">Save Changes</button>
    </div>
  `;

  overlay.classList.add('active');
}

// Save channel changes
async function saveChannelChanges(channelId) {
  const name = document.getElementById('editChannelName').value.trim();
  const description = document.getElementById('editChannelDescription').value.trim();
  const category = document.getElementById('editChannelCategory').value.trim();

  if (!name) {
    showToast('Channel name is required', 'warning');
    return;
  }

  try {
    const response = await fetch(`${state.serverUrl}/api/channels/${channelId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ name, description, category })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    showToast('Channel updated!', 'success');
    closeModal();

    // Refresh channels and update UI if current channel was edited
    await loadChannels();
    if (state.currentChannel?._id === channelId) {
      const updatedChannel = state.channels.find(c => c._id === channelId);
      if (updatedChannel) {
        document.getElementById('channelName').textContent = updatedChannel.name;
        document.getElementById('channelDescription').textContent = updatedChannel.description || '';
      }
    }
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

// Delete channel
async function deleteChannel(channelId) {
  if (!confirm('Are you sure you want to delete this channel? This cannot be undone.')) {
    return;
  }

  try {
    const response = await fetch(`${state.serverUrl}/api/channels/${channelId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${state.token}`
      }
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error);
    }

    showToast('Channel deleted', 'success');
    closeModal();

    // Refresh channels
    await loadChannels();

    // If the deleted channel was selected, select another
    if (state.currentChannel?._id === channelId) {
      const firstChannel = state.channels.find(c => c.type === 'text');
      if (firstChannel) {
        selectChannel(firstChannel);
      }
    }
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

// Load channels helper
async function loadChannels() {
  try {
    const response = await fetch(`${state.serverUrl}/api/channels`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (response.ok) {
      state.channels = data.channels;
      renderChannels();
    }
  } catch (error) {
    console.error('Failed to load channels:', error);
  }
}

// ==================== Groups Management Modal ====================
async function openGroupsModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Groups & Access Control</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body" style="max-height: 500px; overflow-y: auto;">
      <div id="groupsContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  await loadGroupsContent();
}

async function loadGroupsContent() {
  try {
    const [groupsRes, featuresRes] = await Promise.all([
      fetch(`${state.serverUrl}/api/admin/groups`, { headers: { 'Authorization': `Bearer ${state.token}` } }),
      fetch(`${state.serverUrl}/api/admin/groups/features`, { headers: { 'Authorization': `Bearer ${state.token}` } })
    ]);

    const groupsData = await groupsRes.json();
    const featuresData = await featuresRes.json();
    if (!groupsRes.ok) throw new Error(groupsData.error);

    const groups = groupsData.groups || [];
    const features = featuresData.features || [];

    document.getElementById('groupsContent').innerHTML = `
      <div class="settings-section" style="margin-bottom: 16px;">
        <h3>Create New Group</h3>
        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <input type="text" id="newGroupName" placeholder="Group name" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          <button class="btn-primary" onclick="createGroup()">Create</button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Groups (${groups.length})</h3>
        <div id="groupsList" style="margin-top: 12px;">
          ${groups.map(group => `
            <div style="padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <div>
                  <div style="font-weight: 600; font-size: 14px;">${escapeHtml(group.name)}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(group.description || 'No description')}</div>
                </div>
                <div style="display: flex; gap: 8px;">
                  <button class="btn-secondary" onclick="editGroupPermissions('${group.id}')" style="padding: 4px 8px; font-size: 12px;">Permissions</button>
                  <button class="btn-secondary" onclick="manageGroupMembers('${group.id}')" style="padding: 4px 8px; font-size: 12px;">Members</button>
                  ${!group.isDefault ? `<button class="btn-danger" onclick="deleteGroup('${group.id}')" style="padding: 4px 8px; font-size: 12px;">Delete</button>` : ''}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (error) {
    document.getElementById('groupsContent').innerHTML = `<p style="color: var(--danger);">Failed to load groups: ${error.message}</p>`;
  }
}

async function createGroup() {
  const name = document.getElementById('newGroupName').value.trim();
  if (!name) { showToast('Enter group name', 'error'); return; }

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ name })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast('Group created', 'success');
    await loadGroupsContent();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function deleteGroup(groupId) {
  if (!confirm('Are you sure you want to delete this group?')) return;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/groups/${groupId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast('Group deleted', 'success');
    await loadGroupsContent();
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function editGroupPermissions(groupId) {
  try {
    const [groupRes, permsRes, featuresRes] = await Promise.all([
      fetch(`${state.serverUrl}/api/admin/groups/${groupId}`, { headers: { 'Authorization': `Bearer ${state.token}` } }),
      fetch(`${state.serverUrl}/api/admin/groups/${groupId}/permissions`, { headers: { 'Authorization': `Bearer ${state.token}` } }),
      fetch(`${state.serverUrl}/api/admin/groups/features`, { headers: { 'Authorization': `Bearer ${state.token}` } })
    ]);

    const groupData = await groupRes.json();
    const permsData = await permsRes.json();
    const featuresData = await featuresRes.json();

    if (!groupRes.ok) throw new Error(groupData.error);

    const group = groupData.group;
    const permissions = permsData.permissions || {};
    const features = featuresData.features || [];

    document.getElementById('groupsContent').innerHTML = `
      <div style="margin-bottom: 16px;">
        <button class="btn-secondary" onclick="loadGroupsContent()">← Back to Groups</button>
      </div>

      <div class="settings-section">
        <h3>Permissions for: ${escapeHtml(group.name)}</h3>
        <div style="margin-top: 12px;">
          ${features.map(feature => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 6px;">
              <div>
                <div style="font-weight: 500;">${escapeHtml(feature.name)}</div>
                <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(feature.description)}</div>
              </div>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="perm-${feature.id}" ${permissions[feature.id] ? 'checked' : ''} onchange="updateGroupPermission('${groupId}', '${feature.id}', this.checked)">
                <span style="font-size: 12px; color: var(--text-muted);">${permissions[feature.id] ? 'Allowed' : 'Denied'}</span>
              </label>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (error) {
    showToast('Failed to load permissions: ' + error.message, 'error');
  }
}

async function updateGroupPermission(groupId, featureId, allowed) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/groups/${groupId}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ permissions: { [featureId]: allowed } })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);

    // Update the label
    const checkbox = document.getElementById(`perm-${featureId}`);
    if (checkbox) {
      const label = checkbox.parentElement.querySelector('span');
      if (label) label.textContent = allowed ? 'Allowed' : 'Denied';
    }
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function manageGroupMembers(groupId) {
  try {
    const [groupRes, membersRes, usersRes] = await Promise.all([
      fetch(`${state.serverUrl}/api/admin/groups/${groupId}`, { headers: { 'Authorization': `Bearer ${state.token}` } }),
      fetch(`${state.serverUrl}/api/admin/groups/${groupId}/members`, { headers: { 'Authorization': `Bearer ${state.token}` } }),
      fetch(`${state.serverUrl}/api/admin/users`, { headers: { 'Authorization': `Bearer ${state.token}` } })
    ]);

    const groupData = await groupRes.json();
    const membersData = await membersRes.json();
    const usersData = await usersRes.json();

    if (!groupRes.ok) throw new Error(groupData.error);

    const group = groupData.group;
    const members = membersData.members || [];
    const users = usersData.users || [];

    document.getElementById('groupsContent').innerHTML = `
      <div style="margin-bottom: 16px;">
        <button class="btn-secondary" onclick="loadGroupsContent()">← Back to Groups</button>
      </div>

      <div class="settings-section" style="margin-bottom: 16px;">
        <h3>Members of: ${escapeHtml(group.name)}</h3>
        ${group.id === 'everyone' ? `
          <p style="color: var(--text-muted); margin-top: 8px;">All users are automatically members of this group.</p>
        ` : `
          <div style="margin-top: 12px;">
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
              <select id="addUserToGroup" style="flex: 1; padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
                <option value="">Select user to add...</option>
                ${users.filter(u => !members.includes(u._id)).map(u => `
                  <option value="${u._id}">${escapeHtml(u.displayName || u.username)} (@${escapeHtml(u.username)})</option>
                `).join('')}
              </select>
              <button class="btn-primary" onclick="addUserToGroup('${groupId}')">Add</button>
            </div>

            <div id="membersList">
              ${members.length > 0 ? members.map(memberId => {
                const user = users.find(u => u._id === memberId);
                return user ? `
                  <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 6px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--bg-lighter); display: flex; align-items: center; justify-content: center; font-weight: 600;">
                        ${user.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style="font-weight: 500;">${escapeHtml(user.displayName || user.username)}</div>
                        <div style="font-size: 11px; color: var(--text-muted);">@${escapeHtml(user.username)}</div>
                      </div>
                    </div>
                    <button class="btn-danger" onclick="removeUserFromGroup('${groupId}', '${memberId}')" style="padding: 4px 8px; font-size: 12px;">Remove</button>
                  </div>
                ` : '';
              }).join('') : '<p style="color: var(--text-muted);">No members in this group yet.</p>'}
            </div>
          </div>
        `}
      </div>
    `;
  } catch (error) {
    showToast('Failed to load members: ' + error.message, 'error');
  }
}

async function addUserToGroup(groupId) {
  const userId = document.getElementById('addUserToGroup').value;
  if (!userId) { showToast('Select a user', 'error'); return; }

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/groups/${groupId}/users/${userId}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast('User added to group', 'success');
    await manageGroupMembers(groupId);
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function removeUserFromGroup(groupId, userId) {
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/groups/${groupId}/users/${userId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast('User removed from group', 'success');
    await manageGroupMembers(groupId);
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

function getRoleColor(role) {
  switch (role) {
    case 'superadmin': return 'var(--accent-primary)';
    case 'admin': return '#ff6b6b';
    case 'moderator': return '#6bff6b';
    default: return 'var(--bg-lighter)';
  }
}

function closeModal() {
  // Stop any test streams
  if (micTestStream) {
    micTestStream.getTracks().forEach(t => t.stop());
    micTestStream = null;
  }
  if (cameraTestStream) {
    cameraTestStream.getTracks().forEach(t => t.stop());
    cameraTestStream = null;
  }

  // Check if we should return to a previous modal
  if (state.previousModal) {
    const returnTo = state.previousModal;
    state.previousModal = null;
    // Call the return modal function
    if (returnTo === 'settings') {
      openSettings().catch(err => {
        console.error('Failed to open settings:', err);
        showToast('Error returning to settings: ' + err.message, 'error');
        document.getElementById('modalOverlay').classList.remove('active');
      });
    } else if (returnTo === 'bots') {
      openBotsModal();
    }
    return;
  }

  document.getElementById('modalOverlay').classList.remove('active');
}

// Close modal completely without returning to previous
function closeModalFull() {
  state.previousModal = null;
  if (micTestStream) {
    micTestStream.getTracks().forEach(t => t.stop());
    micTestStream = null;
  }
  if (cameraTestStream) {
    cameraTestStream.getTracks().forEach(t => t.stop());
    cameraTestStream = null;
  }
  document.getElementById('modalOverlay').classList.remove('active');
}

// Close bot modal and return to settings (for admin context)
function closeBotModalToSettings() {
  state.previousModal = null;
  openSettings();
}

// ==================== Bot Picker Modal ====================
// Opens from voice panel - shows all available bots to users
function openBotsModal() {
  // Exit fullscreen if active (modal won't show on top of native fullscreen)
  if (document.fullscreenElement) {
    document.exitFullscreen();
  }

  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Channel Bots</h2>
      <button class="modal-close" onclick="closeModalFull()">✕</button>
    </div>
    <div class="modal-body">
      <p style="color: var(--text-muted); margin-bottom: 16px;">Select a bot to use in the current voice channel</p>

      <div class="settings-section">
        <h3>Media & Entertainment</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin-top: 12px;">
          <button class="bot-tile" onclick="openUserBotModal('youtube')">
            <span style="font-size: 32px;">🎬</span>
            <span>YouTube</span>
          </button>
          <button class="bot-tile" onclick="openUserBotModal('twitch')">
            <span style="font-size: 32px;">📺</span>
            <span>Twitch</span>
          </button>
          <button class="bot-tile" onclick="openUserBotModal('iptv')">
            <span style="font-size: 32px;">📡</span>
            <span>IPTV</span>
          </button>
          <button class="bot-tile" onclick="openUserBotModal('plex')">
            <span style="font-size: 32px;">🎞️</span>
            <span>Plex</span>
          </button>
          <button class="bot-tile" onclick="openUserBotModal('jellyfin')">
            <span style="font-size: 32px;">🎥</span>
            <span>Jellyfin</span>
          </button>
          <button class="bot-tile" onclick="openUserBotModal('emby')">
            <span style="font-size: 32px;">🎦</span>
            <span>Emby</span>
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Gaming</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin-top: 12px;">
          <button class="bot-tile" onclick="state.previousModal = 'bots'; openGameTogetherFromBots();">
            <span style="font-size: 32px;">🎮</span>
            <span>Game Together</span>
          </button>
        </div>
      </div>

      <div class="settings-section">
        <h3>Tools & Utilities</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; margin-top: 12px;">
          <button class="bot-tile" onclick="openUserBotModal('chrome')">
            <span style="font-size: 32px;">🌐</span>
            <span>Chrome</span>
          </button>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModalFull()">Close</button>
    </div>
  `;

  // Add bot tile styles if not present
  if (!document.getElementById('botTileStyles')) {
    const style = document.createElement('style');
    style.id = 'botTileStyles';
    style.textContent = `
      .bot-tile {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        padding: 16px 12px;
        background: var(--bg-medium);
        border: 2px solid var(--bg-light);
        border-radius: var(--radius-md);
        color: var(--text-secondary);
        cursor: pointer;
        font-family: inherit;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s;
      }
      .bot-tile:hover {
        background: var(--bg-light);
        border-color: var(--accent-primary);
        color: var(--text-primary);
        transform: translateY(-2px);
      }
      .bot-tile:active {
        transform: translateY(0);
      }
    `;
    document.head.appendChild(style);
  }

  overlay.classList.add('active');
}

// Open user-facing bot modal (for voice channel users)
async function openUserBotModal(botType) {
  state.previousModal = 'bots';

  switch (botType) {
    case 'youtube':
      openYouTubeBotModal();
      break;
    case 'twitch':
      openTwitchBotModal();
      break;
    case 'iptv':
      openIPTVBotModal();
      break;
    case 'plex':
      openPlexBotModal();
      break;
    case 'jellyfin':
      openJellyfinBotModal();
      break;
    case 'emby':
      openEmbyBotModal();
      break;
    case 'chrome':
      openChromeBotModal();
      break;
    default:
      showToast('Bot not yet implemented', 'warning');
  }
}

// Open admin bot modal (from settings - returns to settings)
function openAdminBotModal(botType) {
  state.previousModal = 'settings';

  switch (botType) {
    case 'youtube':
      openYouTubeBotModal();
      break;
    case 'twitch':
      openTwitchBotModal();
      break;
    case 'iptv':
      openIPTVBotModal();
      break;
    case 'plex':
      openPlexBotModal();
      break;
    case 'jellyfin':
      openJellyfinBotModal();
      break;
    case 'emby':
      openEmbyBotModal();
      break;
    case 'chrome':
      openChromeBotModal();
      break;
    case 'game-together':
      openGameTogetherBotModal();
      break;
    default:
      showToast('Bot admin panel not yet implemented', 'warning');
      openSettings();
  }
}

// ==================== Twitch Bot Modal ====================
async function openTwitchBotModal() {
  const prevModal = state.previousModal; // Preserve for refresh
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Twitch Bot</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="twitchBotContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal; // Restore for navigation

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/twitch-bot/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderTwitchBotContent(data);
  } catch (error) {
    document.getElementById('twitchBotContent').innerHTML = `<p style="color: var(--danger);">Failed to load: ${error.message}</p>`;
  }
}

function renderTwitchBotContent(data) {
  const { enabled, activeStreams } = data;
  document.getElementById('twitchBotContent').innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Bot Status</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <span style="color: ${enabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${enabled ? 'Enabled' : 'Disabled'}</span>
        <button class="btn-${enabled ? 'danger' : 'primary'}" onclick="toggleTwitchBot(${!enabled})">${enabled ? 'Disable' : 'Enable'}</button>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">Watch Twitch streams together in voice channels.</p>
    </div>

    ${enabled ? `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Watch Stream</h3>
      <div style="display: flex; flex-direction: column; gap: 12px; margin-top: 12px;">
        <select id="twitchChannel" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
          ${state.channels.filter(c => c.type === 'voice' || c.type === 'video').map(c => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
        <input type="text" id="twitchStreamer" placeholder="Streamer username" style="padding: 8px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        <button class="btn-primary" onclick="watchTwitchStream()">Watch Stream</button>
      </div>
    </div>

    <div class="settings-section">
      <h3>Active Streams (${activeStreams?.length || 0})</h3>
      <div style="margin-top: 12px;">
        ${activeStreams?.length > 0 ? activeStreams.map(s => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500;">${escapeHtml(s.streamer)}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${s.viewers} watching</div>
            </div>
            <button class="btn-danger" onclick="stopTwitchStream('${s.channelId}')" style="padding: 6px 12px;">Stop</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No active streams</p>'}
      </div>
    </div>
    ` : ''}
  `;
}

async function toggleTwitchBot(enabled) {
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/twitch-bot/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ enabled })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast(enabled ? 'Twitch bot enabled' : 'Twitch bot disabled', 'success');
    openTwitchBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function watchTwitchStream() {
  const channelId = document.getElementById('twitchChannel').value;
  const streamer = document.getElementById('twitchStreamer').value.trim();
  if (!streamer) {
    showToast('Please enter a streamer username', 'warning');
    return;
  }
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/twitch-bot/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ channelId, streamer })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast('Now watching ' + streamer, 'success');
    openTwitchBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function stopTwitchStream(channelId) {
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/twitch-bot/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ channelId })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast('Stream stopped', 'success');
    openTwitchBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

// ==================== Game Together Bot Modal ====================
async function openGameTogetherBotModal() {
  const prevModal = state.previousModal;
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Game Together</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="gameTogetherContent">Loading...</div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
  if (prevModal) state.previousModal = prevModal;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/game-together/status`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    renderGameTogetherContent(data);
  } catch (error) {
    document.getElementById('gameTogetherContent').innerHTML = `<p style="color: var(--danger);">Failed to load: ${error.message}</p>`;
  }
}

function renderGameTogetherContent(data) {
  const { enabled, platform, backendAvailable, activeSessions } = data;
  document.getElementById('gameTogetherContent').innerHTML = `
    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Service Status</h3>
      <div style="display: flex; align-items: center; gap: 16px; margin-top: 12px;">
        <span style="color: ${enabled ? 'var(--success)' : 'var(--danger)'}; font-weight: 600;">${enabled ? 'Enabled' : 'Disabled'}</span>
        <button class="btn-${enabled ? 'danger' : 'primary'}" onclick="toggleGameTogether(${!enabled})">${enabled ? 'Disable' : 'Enable'}</button>
      </div>
      <p style="color: var(--text-muted); font-size: 12px; margin-top: 8px;">Virtual controller emulation for remote multiplayer gaming.</p>
    </div>

    <div class="settings-section" style="margin-bottom: 16px;">
      <h3>Platform Info</h3>
      <div style="margin-top: 12px; padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: var(--text-muted);">Platform:</span>
          <span>${escapeHtml(platform || 'Unknown')}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: var(--text-muted);">Controller Backend:</span>
          <span style="color: ${backendAvailable ? 'var(--success)' : 'var(--danger)'};">${backendAvailable ? 'Available' : 'Not Available'}</span>
        </div>
      </div>
      ${!backendAvailable ? `<p style="color: var(--warning); font-size: 12px; margin-top: 8px;">Virtual controller backend not available. Install ViGEmBus (Windows), uinput (Linux), or foohid (macOS).</p>` : ''}
    </div>

    <div class="settings-section">
      <h3>Active Sessions (${activeSessions?.length || 0})</h3>
      <div style="margin-top: 12px;">
        ${activeSessions?.length > 0 ? activeSessions.map(s => `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 500;">Host: ${escapeHtml(s.hostUsername)}</div>
              <div style="font-size: 12px; color: var(--text-muted);">${s.playerCount} player(s) connected</div>
            </div>
            <button class="btn-danger" onclick="stopGameTogetherSession('${s.channelId}')" style="padding: 6px 12px;">Stop</button>
          </div>
        `).join('') : '<p style="color: var(--text-muted);">No active sessions</p>'}
      </div>
    </div>
  `;
}

async function toggleGameTogether(enabled) {
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/game-together/enable`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ enabled })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    showToast(enabled ? 'Game Together enabled' : 'Game Together disabled', 'success');
    openGameTogetherBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

async function stopGameTogetherSession(channelId) {
  const prevModal = state.previousModal;
  try {
    const response = await fetch(`${state.serverUrl}/api/admin/game-together/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ channelId })
    });
    if (!response.ok) throw new Error((await response.json()).error);
    showToast('Session stopped', 'success');
    openGameTogetherBotModal();
    state.previousModal = prevModal;
  } catch (error) {
    showToast('Failed: ' + error.message, 'error');
  }
}

function disconnect() {
  if (state.socket) {
    state.socket.disconnect();
  }

  if (window.electronAPI) {
    window.electronAPI.clearToken();
  } else {
    clearWebSession();
  }

  state.user = null;
  state.token = null;
  state.socket = null;

  document.getElementById('mainApp').style.display = 'none';
  document.getElementById('connectionScreen').style.display = 'flex';

  closeModal();
}

// Utility functions
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <div class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</div>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function scrollToBottom() {
  const container = document.getElementById('messagesArea');
  if (container) {
    container.scrollTop = container.scrollHeight;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(date) {
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  if (isToday) return `Today at ${time}`;
  return date.toLocaleDateString() + ` at ${time}`;
}

function getAvatarColor(name) {
  const colors = [
    'linear-gradient(135deg, #FF8A3D, #E8551F)',
    'linear-gradient(135deg, #3D7BFF, #2A5BD0)',
    'linear-gradient(135deg, #19C37D, #128A5A)',
    'linear-gradient(135deg, #B86BFF, #8A3DE8)',
    'linear-gradient(135deg, #E8A33D, #C77F1F)'
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Solid server-identity color for rail tiles (Ember orange / blue / green / purple / amber)
function getServerColor(server, index = 0) {
  const palette = ['#FF6A2B', '#3D7BFF', '#19C37D', '#B86BFF', '#E8A33D'];
  const key = server?.name || String(index);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  // first/current server keeps the Ember orange
  if (index === 0) return '#FF6A2B';
  return palette[Math.abs(hash) % palette.length];
}

function getRoleColor(role) {
  switch (role) {
    case 'superadmin': return '#FF6A2B';
    case 'admin': return '#FF8A3D';
    case 'moderator': return '#3D7BFF';
    default: return '#D7D0C6';
  }
}

// Home coal → jump to Direct Messages section
function goHome() {
  const dm = document.getElementById('dmSection');
  if (dm) dm.scrollIntoView({ behavior: 'smooth' });
}

// Toggle the members panel (chat only)
function toggleMembers() {
  const app = document.getElementById('mainApp');
  const btn = document.getElementById('membersToggleBtn');
  if (!app) return;
  const showing = app.classList.toggle('members-active');
  const panel = document.getElementById('membersPanel');
  if (panel) panel.style.display = showing ? 'flex' : 'none';
  if (btn) btn.classList.toggle('active', showing);
  if (showing) renderMembers();
}
// alias kept for any older callers
function showMembers() { toggleMembers(); }

// Render the members panel, grouped by IRC mode (Ops / Voiced / Online / Offline)
function renderMembers() {
  const list = document.getElementById('membersList');
  if (!list) return;

  // Best-effort member source: channel members, voice participants, or known users.
  const members = (state.channelMembers && state.channelMembers.length)
    ? state.channelMembers
    : (state.onlineUsers || []);

  // Always include self so the panel is never empty.
  const self = state.user ? [{
    username: state.user.username,
    displayName: state.user.displayName || state.user.username,
    role: state.user.role,
    presence: 'online',
    activity: state.user.customStatus || ''
  }] : [];

  const all = [...self, ...members.filter(m => m.username !== state.user?.username)];

  const groups = { ops: [], voiced: [], online: [], offline: [] };
  for (const m of all) {
    const role = m.role || 'member';
    if (role === 'admin' || role === 'superadmin' || role === 'moderator') groups.ops.push(m);
    else if (m.voiced) groups.voiced.push(m);
    else if ((m.presence || 'online') === 'offline') groups.offline.push(m);
    else groups.online.push(m);
  }

  const modeFor = (g) => g === 'ops' ? '@' : g === 'voiced' ? '+' : '';
  const modeClass = (g) => g === 'ops' ? 'mode-op' : g === 'voiced' ? 'mode-voice' : '';

  const renderGroup = (label, key) => {
    const arr = groups[key];
    if (!arr.length) return '';
    return `<div class="members-group">${label} — ${arr.length}</div>` + arr.map(m => {
      const name = m.displayName || m.username || 'user';
      const presence = key === 'offline' ? 'offline' : (m.presence || 'online');
      const initials = name.substring(0, 2).toUpperCase();
      const activity = m.activity || '';
      const mode = modeFor(key);
      return `
        <div class="member-row ${key === 'offline' ? 'offline' : ''}">
          <div class="member-avatar" style="background:${getAvatarColor(name)};">
            ${initials}
            <div class="status-indicator ${presence}"></div>
          </div>
          <div class="member-meta">
            <div class="member-nick">${mode ? `<span class="${modeClass(key)}">${mode}</span>` : ''}<span class="nick">${escapeHtml(name)}</span></div>
            ${activity ? `<div class="member-activity">${escapeHtml(activity)}</div>` : ''}
          </div>
        </div>`;
    }).join('');
  };

  list.innerHTML =
    renderGroup('Ops', 'ops') +
    renderGroup('Voiced', 'voiced') +
    renderGroup('Online', 'online') +
    renderGroup('Offline', 'offline');
}

// ==================== Multi-Server Support ====================
async function switchServer(serverId) {
  const server = state.servers.find(s => s.id === serverId);
  if (!server) return;

  // Disconnect from current server
  if (state.socket) {
    state.socket.disconnect();
  }

  // Leave voice if connected
  if (state.inVoice) {
    await leaveVoice();
  }

  // Switch to new server
  state.currentServerId = serverId;
  state.serverUrl = server.url;
  state.token = server.token;
  state.user = server.user;
  state.channels = [];
  state.messages = [];
  state.currentChannel = null;

  // Connect to new server
  setupSocketConnection();
  renderMainApp();

  // Fetch channels
  await loadChannels();

  showToast(`Switched to ${server.name}`, 'success');
}

function openAddServerModal() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Add Server</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div class="settings-section">
        <h3>Connect to a Server</h3>
        <p style="color: var(--text-muted); margin-bottom: 16px;">Enter the server URL and your credentials to add a new server.</p>

        <div class="form-group" style="margin-bottom: 12px;">
          <label>Server URL</label>
          <input type="text" id="addServerUrl" placeholder="http://localhost:3001" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        </div>

        <div class="form-group" style="margin-bottom: 12px;">
          <label>Username</label>
          <input type="text" id="addServerUsername" placeholder="Username" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        </div>

        <div class="form-group" style="margin-bottom: 16px;">
          <label>Password</label>
          <input type="password" id="addServerPassword" placeholder="Password" style="width: 100%; padding: 10px; background: var(--bg-medium); border: 2px solid var(--bg-light); border-radius: var(--radius-sm); color: var(--text-primary);">
        </div>

        <button class="btn-primary" onclick="addServer()" style="width: 100%;">Connect</button>
      </div>

      ${state.servers.length > 0 ? `
      <div class="settings-section" style="margin-top: 20px;">
        <h3>Your Servers (${state.servers.length})</h3>
        <div style="margin-top: 12px;">
          ${state.servers.map(server => `
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 6px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--accent-primary); display: flex; align-items: center; justify-content: center; font-weight: 600;">
                  ${server.icon || server.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <div style="font-weight: 500;">${escapeHtml(server.name)}</div>
                  <div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(server.url)}</div>
                </div>
              </div>
              <button class="btn-danger" onclick="removeServer('${server.id}')" style="padding: 4px 8px; font-size: 12px;">Remove</button>
            </div>
          `).join('')}
        </div>
      </div>
      ` : ''}
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
}

async function addServer() {
  const url = document.getElementById('addServerUrl').value.trim();
  const username = document.getElementById('addServerUsername').value.trim();
  const password = document.getElementById('addServerPassword').value;

  if (!url || !username || !password) {
    showToast('Please fill in all fields', 'error');
    return;
  }

  try {
    // Try to login to the server
    const response = await fetch(`${url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');

    // Get server info
    let serverName = 'Emberlan Server';
    try {
      const infoRes = await fetch(`${url}/api/federation/info`);
      const infoData = await infoRes.json();
      serverName = infoData.name || serverName;
    } catch (e) {
      // Use default name
    }

    // Create server entry
    const serverId = 'server_' + Date.now();
    const newServer = {
      id: serverId,
      name: serverName,
      url: url,
      token: data.token,
      user: data.user,
      icon: null
    };

    state.servers.push(newServer);
    await saveServers();

    // Switch to new server
    state.currentServerId = serverId;
    state.serverUrl = url;
    state.token = data.token;
    state.user = data.user;

    closeModal();
    setupSocketConnection();
    showMainApp();
    await loadChannels();

    showToast(`Connected to ${serverName}!`, 'success');
  } catch (error) {
    showToast('Failed to connect: ' + error.message, 'error');
  }
}

async function removeServer(serverId) {
  if (!confirm('Are you sure you want to remove this server?')) return;

  const serverIndex = state.servers.findIndex(s => s.id === serverId);
  if (serverIndex === -1) return;

  state.servers.splice(serverIndex, 1);
  await saveServers();

  // If we removed the current server, switch to another or show connection screen
  if (state.currentServerId === serverId) {
    if (state.servers.length > 0) {
      await switchServer(state.servers[0].id);
    } else {
      disconnect();
    }
  }

  showToast('Server removed', 'success');
  openAddServerModal(); // Refresh the modal
}

async function saveServers() {
  if (window.electronAPI) {
    const settings = await window.electronAPI.getSettings();
    settings.servers = state.servers;
    await window.electronAPI.saveSettings(settings);
  }
}

function openServerMenu(event) {
  event.stopPropagation();
  // Could show a dropdown menu with server options
  showToast('Server options coming soon', 'info');
}

// ==================== Theming System ====================
const themes = {
  dark: {
    name: 'Ember Dark',
    vars: {
      '--bg-darkest': '#0A0908',
      '--bg-darker': '#100E0C',
      '--bg-dark': '#13110E',
      '--bg-medium': '#1A1714',
      '--bg-light': '#2A2621',
      '--bg-lighter': '#3a352e',
      '--text-primary': '#F4EFE8',
      '--text-secondary': '#D7D0C6',
      '--text-muted': '#9A938A',
      '--accent-primary': '#FF6A2B',
      '--accent-secondary': '#FF8A3D',
      '--success': '#4FCB6B',
      '--danger': '#F2554D',
      '--warning': '#FFB454'
    }
  },
  midnight: {
    name: 'Midnight',
    vars: {
      '--bg-darkest': '#080a0f',
      '--bg-darker': '#0d1016',
      '--bg-dark': '#11151d',
      '--bg-medium': '#1a1f29',
      '--bg-light': '#262c38',
      '--bg-lighter': '#39404e',
      '--text-primary': '#F4EFE8',
      '--text-secondary': '#cdd3dd',
      '--text-muted': '#8c93a0',
      '--accent-primary': '#FF6A2B',
      '--accent-secondary': '#FF8A3D',
      '--success': '#4FCB6B',
      '--danger': '#F2554D',
      '--warning': '#FFB454'
    }
  },
  amoled: {
    name: 'AMOLED',
    vars: {
      '--bg-darkest': '#000000',
      '--bg-darker': '#040403',
      '--bg-dark': '#090806',
      '--bg-medium': '#121110',
      '--bg-light': '#1f1d1a',
      '--bg-lighter': '#2c2925',
      '--text-primary': '#F4EFE8',
      '--text-secondary': '#D7D0C6',
      '--text-muted': '#9A938A',
      '--accent-primary': '#FF6A2B',
      '--accent-secondary': '#FF8A3D',
      '--success': '#4FCB6B',
      '--danger': '#F2554D',
      '--warning': '#FFB454'
    }
  },
  forest: {
    name: 'Forest',
    vars: {
      '--bg-darkest': '#1a1f16',
      '--bg-darker': '#232b1e',
      '--bg-dark': '#2d3726',
      '--bg-medium': '#374430',
      '--bg-light': '#44523a',
      '--bg-lighter': '#536347',
      '--text-primary': '#e8f5e9',
      '--text-secondary': '#a5d6a7',
      '--text-muted': '#81c784',
      '--accent-primary': '#66bb6a',
      '--accent-secondary': '#43a047',
      '--success': '#4caf50',
      '--danger': '#ef5350',
      '--warning': '#ffca28'
    }
  },
  crimson: {
    name: 'Crimson',
    vars: {
      '--bg-darkest': '#1a1214',
      '--bg-darker': '#241a1c',
      '--bg-dark': '#2e2224',
      '--bg-medium': '#3a2a2c',
      '--bg-light': '#4a3638',
      '--bg-lighter': '#5c4446',
      '--text-primary': '#ffeaea',
      '--text-secondary': '#ffb3b3',
      '--text-muted': '#cc8080',
      '--accent-primary': '#e53935',
      '--accent-secondary': '#c62828',
      '--success': '#4caf50',
      '--danger': '#ff5252',
      '--warning': '#ffc107'
    }
  },
  light: {
    name: 'Light',
    vars: {
      '--bg-darkest': '#ffffff',
      '--bg-darker': '#f5f5f5',
      '--bg-dark': '#eeeeee',
      '--bg-medium': '#e0e0e0',
      '--bg-light': '#d0d0d0',
      '--bg-lighter': '#c0c0c0',
      '--text-primary': '#1a1a1a',
      '--text-secondary': '#4a4a4a',
      '--text-muted': '#757575',
      '--accent-primary': '#ff8c00',
      '--accent-secondary': '#f57c00',
      '--success': '#2e7d32',
      '--danger': '#c62828',
      '--warning': '#f9a825'
    }
  }
};

function applyTheme(themeName) {
  const theme = themes[themeName] || themes.dark;
  const root = document.documentElement;

  Object.entries(theme.vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  state.theme = themeName;
}

async function setTheme(themeName) {
  applyTheme(themeName);

  if (window.electronAPI) {
    const settings = await window.electronAPI.getSettings();
    settings.theme = themeName;
    await window.electronAPI.saveSettings(settings);
  }

  showToast(`Theme changed to ${themes[themeName]?.name || themeName}`, 'success');
}

function openThemeSelector() {
  const overlay = document.getElementById('modalOverlay');
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>Choose Theme</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
        ${Object.entries(themes).map(([key, theme]) => `
          <div onclick="setTheme('${key}'); closeModal();"
               style="padding: 16px; background: ${theme.vars['--bg-dark']}; border-radius: var(--radius-sm); cursor: pointer; border: 2px solid ${state.theme === key ? 'var(--accent-primary)' : 'transparent'};">
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
              <div style="width: 20px; height: 20px; border-radius: 50%; background: ${theme.vars['--bg-darkest']};"></div>
              <div style="width: 20px; height: 20px; border-radius: 50%; background: ${theme.vars['--accent-primary']};"></div>
              <div style="width: 20px; height: 20px; border-radius: 50%; background: ${theme.vars['--text-primary']};"></div>
            </div>
            <div style="color: ${theme.vars['--text-primary']}; font-weight: 500;">${theme.name}</div>
            ${state.theme === key ? '<div style="color: var(--accent-primary); font-size: 11px; margin-top: 4px;">Current</div>' : ''}
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `;

  overlay.classList.add('active');
}

// ==================== Game Together Functions ====================

// Game Together state
state.gameTogether = {
  active: false,
  isHost: false,
  hostUserId: null,
  playerSlot: null,
  gamepadIndex: null,
  pollingInterval: null
};

// Open Game Together from bots modal - shows the main Game Together info/start screen
function openGameTogetherFromBots() {
  if (!state.inVoice) {
    showToast('Join a voice channel first', 'error');
    return;
  }

  const modal = document.getElementById('modalContent');
  const overlay = document.getElementById('modalOverlay');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>🎮 Game Together</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <p style="color: var(--text-muted); margin-bottom: 16px;">Play ANY local multiplayer game together with friends in your voice channel!</p>

      <div style="background: var(--bg-dark); padding: 16px; border-radius: var(--radius-md); margin-bottom: 24px;">
        <h3 style="margin-bottom: 12px;">How it works:</h3>
        <ul style="text-align: left; color: var(--text-muted); line-height: 1.8; padding-left: 20px;">
          <li>One person hosts the game on their PC</li>
          <li>Host shares their screen in the voice channel</li>
          <li>Other players join and their controllers get mapped to virtual controllers on the host's PC</li>
          <li>Works with ANY game that supports local multiplayer!</li>
        </ul>
      </div>

      <div style="background: var(--bg-dark); padding: 16px; border-radius: var(--radius-md); margin-bottom: 24px;">
        <h3 style="margin-bottom: 12px;">Requirements:</h3>
        <ul style="text-align: left; color: var(--text-muted); line-height: 1.8; padding-left: 20px;">
          <li><strong>Host:</strong> Windows with ViGEmBus driver or Linux with uinput</li>
          <li><strong>Players:</strong> Any gamepad/controller connected to their computer</li>
        </ul>
      </div>

      <div style="display: flex; gap: 12px; justify-content: center;">
        <button class="btn-primary" onclick="startGameTogetherAsHost()" style="flex: 1; max-width: 200px;">
          🖥️ Host Game
        </button>
        <button class="btn-secondary" onclick="showGameTogetherJoinList()" style="flex: 1; max-width: 200px;">
          👥 Join Game
        </button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="${state.previousModal === 'bots' ? 'openBotsModal()' : 'closeModal()'}">Back</button>
    </div>
  `;

  overlay.classList.add('active');
}

// Start Game Together as host
async function startGameTogetherAsHost() {
  if (!state.voiceChannel) {
    showToast('Join a voice channel first', 'error');
    return;
  }

  try {
    showToast('Starting Game Together session...', 'info');

    const response = await fetch(`${state.serverUrl}/api/admin/game-together/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: state.voiceChannel._id
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start session');
    }

    state.gameTogether.active = true;
    state.gameTogether.isHost = true;
    state.gameTogether.hostUserId = state.user._id;
    state.gameTogether.playerSlot = 1;

    closeModal();
    showToast('🎮 Game Together session started! You are the host (Player 1). Share your screen!', 'success');
  } catch (error) {
    console.error('Failed to start Game Together session:', error);
    showToast('Failed to start session: ' + error.message, 'error');
  }
}

// Show list of available Game Together sessions to join
async function showGameTogetherJoinList() {
  const modal = document.getElementById('modalContent');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>🎮 Join Game Together</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="modal-body">
      <div id="gameTogetherSessionList" style="text-align: center;">
        <div class="loading-spinner"></div>
        <p style="color: var(--text-muted); margin-top: 12px;">Looking for sessions...</p>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="openGameTogetherFromBots()">Back</button>
    </div>
  `;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/game-together/sessions`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await response.json();

    const listEl = document.getElementById('gameTogetherSessionList');
    if (!data.sessions || data.sessions.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-muted);">
          <div style="font-size: 48px; margin-bottom: 16px;">🎮</div>
          <p>No active Game Together sessions found.</p>
          <p style="font-size: 12px; margin-top: 8px;">Ask someone in voice to start hosting!</p>
        </div>
      `;
    } else {
      listEl.innerHTML = data.sessions.map(session => `
        <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg-dark); border-radius: var(--radius-sm); margin-bottom: 8px;">
          <div style="flex: 1;">
            <div style="font-weight: 500; color: var(--text-primary);">Hosted by ${escapeHtml(session.hostUsername)}</div>
            <div style="font-size: 12px; color: var(--text-muted);">${session.playerCount}/4 players</div>
          </div>
          <button class="btn-primary" onclick="joinGameTogetherSession('${session.hostUserId}')" style="padding: 6px 12px;">Join</button>
        </div>
      `).join('');
    }
  } catch (error) {
    document.getElementById('gameTogetherSessionList').innerHTML = `
      <p style="color: var(--danger);">Failed to load sessions: ${error.message}</p>
    `;
  }
}

// Join a specific Game Together session
async function joinGameTogetherSession(hostUserId) {
  try {
    showToast('Joining Game Together session...', 'info');

    const response = await fetch(`${state.serverUrl}/api/admin/game-together/join`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        hostUserId,
        channelId: state.voiceChannel._id
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to join session');
    }

    state.gameTogether.active = true;
    state.gameTogether.isHost = false;
    state.gameTogether.hostUserId = hostUserId;
    state.gameTogether.playerSlot = data.playerSlot;

    closeModal();
    showToast(`🎮 Joined! You are Player ${data.playerSlot}. Connect your controller!`, 'success');

    // Start gamepad polling for this player
    startGameTogetherPolling();
  } catch (error) {
    console.error('Failed to join Game Together session:', error);
    showToast('Failed to join: ' + error.message, 'error');
  }
}

// Start polling gamepad for Game Together
function startGameTogetherPolling() {
  if (state.gameTogether.pollingInterval) return;

  // Find first connected gamepad
  const gamepads = navigator.getGamepads();
  for (let i = 0; i < gamepads.length; i++) {
    if (gamepads[i]) {
      state.gameTogether.gamepadIndex = i;
      showToast(`Controller connected: ${gamepads[i].id}`, 'success');
      break;
    }
  }

  state.gameTogether.pollingInterval = setInterval(() => {
    pollGameTogetherInput();
  }, 16); // ~60Hz polling
}

// Poll gamepad input for Game Together
function pollGameTogetherInput() {
  if (!state.gameTogether.active || state.gameTogether.isHost) return;

  const gamepads = navigator.getGamepads();
  const gamepad = gamepads[state.gameTogether.gamepadIndex] || gamepads[0];

  if (!gamepad) return;

  // Map to Xbox 360 layout
  const inputData = {
    buttons: {
      A: gamepad.buttons[0]?.pressed || false,
      B: gamepad.buttons[1]?.pressed || false,
      X: gamepad.buttons[2]?.pressed || false,
      Y: gamepad.buttons[3]?.pressed || false,
      LB: gamepad.buttons[4]?.pressed || false,
      RB: gamepad.buttons[5]?.pressed || false,
      BACK: gamepad.buttons[8]?.pressed || false,
      START: gamepad.buttons[9]?.pressed || false,
      LS: gamepad.buttons[10]?.pressed || false,
      RS: gamepad.buttons[11]?.pressed || false,
      DPAD_UP: gamepad.buttons[12]?.pressed || false,
      DPAD_DOWN: gamepad.buttons[13]?.pressed || false,
      DPAD_LEFT: gamepad.buttons[14]?.pressed || false,
      DPAD_RIGHT: gamepad.buttons[15]?.pressed || false,
      GUIDE: gamepad.buttons[16]?.pressed || false
    },
    axes: {
      LEFT_X: gamepad.axes[0] || 0,
      LEFT_Y: gamepad.axes[1] || 0,
      RIGHT_X: gamepad.axes[2] || 0,
      RIGHT_Y: gamepad.axes[3] || 0,
      LT: gamepad.buttons[6]?.value || 0,
      RT: gamepad.buttons[7]?.value || 0
    }
  };

  // Send via socket for low latency
  if (state.socket) {
    state.socket.emit('gameTogether:input', {
      hostUserId: state.gameTogether.hostUserId,
      playerSlot: state.gameTogether.playerSlot,
      inputData
    });
  }
}

// Stop Game Together polling
function stopGameTogetherPolling() {
  if (state.gameTogether.pollingInterval) {
    clearInterval(state.gameTogether.pollingInterval);
    state.gameTogether.pollingInterval = null;
  }
}

// Leave Game Together session
async function leaveGameTogether() {
  stopGameTogetherPolling();

  if (state.gameTogether.active) {
    try {
      await fetch(`${state.serverUrl}/api/admin/game-together/leave`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${state.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          hostUserId: state.gameTogether.hostUserId
        })
      });
    } catch (e) {
      console.error('Failed to leave Game Together:', e);
    }
  }

  state.gameTogether.active = false;
  state.gameTogether.isHost = false;
  state.gameTogether.hostUserId = null;
  state.gameTogether.playerSlot = null;
  showToast('Left Game Together session', 'info');
}

// Open Game Together menu
function openGameTogetherMenu(hostUserId, hostLabel) {
  if (!state.inVoice) {
    showToast('Join a voice channel first', 'error');
    return;
  }

  const modal = document.getElementById('modalContent');
  const overlay = document.getElementById('modalOverlay');

  modal.innerHTML = `
    <div class="modal-header">
      <h2>🎮 Game Together</h2>
      <button class="modal-close" onclick="closeModalFull()">✕</button>
    </div>
    <div class="modal-body" style="text-align: center;">
      <p style="margin-bottom: 24px;">Play games together with ${hostLabel}!</p>

      <div style="background: var(--bg-dark); padding: 16px; border-radius: var(--radius-md); margin-bottom: 24px;">
        <h3 style="margin-bottom: 12px;">How it works:</h3>
        <ul style="text-align: left; color: var(--text-muted); line-height: 1.6;">
          <li>Host starts the session (becomes Player 1)</li>
          <li>You join and become Player 2, 3, or 4</li>
          <li>Your controller gets mapped to the host's system</li>
          <li>Play any local multiplayer game together!</li>
        </ul>
      </div>

      <div style="display: flex; gap: 12px; justify-content: center;">
        <button class="btn-primary" onclick="requestStartGameTogether('${hostUserId}')" style="flex: 1; max-width: 200px;">
          🎮 Start Session
        </button>
        <button class="btn-primary" onclick="joinGameTogether('${hostUserId}')" style="flex: 1; max-width: 200px;">
          👥 Join Session
        </button>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="closeModalFull()">Cancel</button>
    </div>
  `;

  overlay.style.display = 'flex';
}

// Request to start a Game Together session (as host)
async function requestStartGameTogether(hostUserId) {
  closeModalFull();

  if (!state.voiceChannel) {
    showToast('Join a voice channel first', 'error');
    return;
  }

  try {
    showToast('Starting Game Together session...', 'info');

    const response = await fetch(`${state.serverUrl}/api/admin/game-together/start`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: state.voiceChannel
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to start session');
    }

    state.gameTogether.active = true;
    state.gameTogether.isHost = true;
    state.gameTogether.hostUserId = state.user._id;
    state.gameTogether.playerSlot = 1;

    showToast('🎮 Game Together session started! You are Player 1', 'success');

    // Note: Host uses their physical controller, no emulation needed
  } catch (error) {
    console.error('Failed to start Game Together session:', error);
    showToast('Failed to start session: ' + error.message, 'error');
  }
}

// Join an existing Game Together session
async function joinGameTogether(hostUserId) {
  closeModalFull();

  if (!state.voiceChannel) {
    showToast('Join a voice channel first', 'error');
    return;
  }

  try {
    showToast('Joining Game Together session...', 'info');

    const response = await fetch(`${state.serverUrl}/api/admin/game-together/join`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: state.voiceChannel
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to join session');
    }

    state.gameTogether.active = true;
    state.gameTogether.isHost = false;
    state.gameTogether.hostUserId = hostUserId;
    state.gameTogether.playerSlot = data.playerSlot;

    showToast(`🎮 Joined as Player ${data.playerSlot}! Connect your controller.`, 'success');

    // Start polling gamepad for input
    startGameTogetherGamepadPolling();
  } catch (error) {
    console.error('Failed to join Game Together session:', error);
    showToast('Failed to join session: ' + error.message, 'error');
  }
}

// Leave Game Together session
async function leaveGameTogether() {
  if (!state.gameTogether.active) return;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/game-together/leave`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: state.voiceChannel
      })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to leave session');
    }

    stopGameTogetherGamepadPolling();

    state.gameTogether.active = false;
    state.gameTogether.isHost = false;
    state.gameTogether.hostUserId = null;
    state.gameTogether.playerSlot = null;

    showToast('Left Game Together session', 'info');
  } catch (error) {
    console.error('Failed to leave Game Together session:', error);
    showToast('Failed to leave session: ' + error.message, 'error');
  }
}

// Stop Game Together session (host only)
async function stopGameTogether() {
  if (!state.gameTogether.active || !state.gameTogether.isHost) return;

  try {
    const response = await fetch(`${state.serverUrl}/api/admin/game-together/stop`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: state.voiceChannel
      })
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to stop session');
    }

    state.gameTogether.active = false;
    state.gameTogether.isHost = false;
    state.gameTogether.hostUserId = null;
    state.gameTogether.playerSlot = null;

    showToast('Game Together session stopped', 'info');
  } catch (error) {
    console.error('Failed to stop Game Together session:', error);
    showToast('Failed to stop session: ' + error.message, 'error');
  }
}

// Start polling gamepad for Game Together
function startGameTogetherGamepadPolling() {
  if (state.gameTogether.pollingInterval) return;

  console.log('[Game Together] Starting gamepad polling');

  state.gameTogether.pollingInterval = setInterval(() => {
    pollGameTogetherGamepad();
  }, 16); // ~60 FPS
}

// Stop polling gamepad
function stopGameTogetherGamepadPolling() {
  if (state.gameTogether.pollingInterval) {
    clearInterval(state.gameTogether.pollingInterval);
    state.gameTogether.pollingInterval = null;
    console.log('[Game Together] Stopped gamepad polling');
  }
}

// Poll gamepad and send input to server
function pollGameTogetherGamepad() {
  const gamepads = navigator.getGamepads();

  // Find first connected gamepad
  let gamepad = null;
  if (state.gameTogether.gamepadIndex !== null) {
    gamepad = gamepads[state.gameTogether.gamepadIndex];
  }

  if (!gamepad) {
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        gamepad = gamepads[i];
        state.gameTogether.gamepadIndex = i;
        break;
      }
    }
  }

  if (!gamepad) return;

  // Map gamepad to Xbox controller layout
  const inputData = {
    buttons: {
      A: gamepad.buttons[0]?.pressed || false,
      B: gamepad.buttons[1]?.pressed || false,
      X: gamepad.buttons[2]?.pressed || false,
      Y: gamepad.buttons[3]?.pressed || false,
      LB: gamepad.buttons[4]?.pressed || false,
      RB: gamepad.buttons[5]?.pressed || false,
      BACK: gamepad.buttons[8]?.pressed || false,
      START: gamepad.buttons[9]?.pressed || false,
      LS: gamepad.buttons[10]?.pressed || false,
      RS: gamepad.buttons[11]?.pressed || false,
      DPAD_UP: gamepad.buttons[12]?.pressed || false,
      DPAD_DOWN: gamepad.buttons[13]?.pressed || false,
      DPAD_LEFT: gamepad.buttons[14]?.pressed || false,
      DPAD_RIGHT: gamepad.buttons[15]?.pressed || false,
      GUIDE: gamepad.buttons[16]?.pressed || false
    },
    axes: {
      LEFT_X: gamepad.axes[0] || 0,
      LEFT_Y: gamepad.axes[1] || 0,
      RIGHT_X: gamepad.axes[2] || 0,
      RIGHT_Y: gamepad.axes[3] || 0,
      LT: gamepad.buttons[6]?.value || 0,
      RT: gamepad.buttons[7]?.value || 0
    }
  };

  sendGameTogetherInput(inputData);
}

// Send input to server (throttled)
let lastGameTogetherInputTime = 0;
async function sendGameTogetherInput(inputData) {
  const now = Date.now();
  if (now - lastGameTogetherInputTime < 16) return; // Max 60 updates/second
  lastGameTogetherInputTime = now;

  if (!state.socket || !state.gameTogether.active) return;

  // Send via Socket.IO for low latency
  state.socket.emit('gameTogether:input', {
    channelId: state.voiceChannel,
    inputData
  });

  // Also send via HTTP API as backup
  try {
    await fetch(`${state.serverUrl}/api/admin/game-together/input`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: state.voiceChannel,
        inputData
      })
    });
  } catch (error) {
    // Silently fail, socket.io is primary
  }
}

// Gamepad connection event listeners
window.addEventListener('gamepadconnected', (e) => {
  console.log('Gamepad connected:', e.gamepad.id);
  if (state.gameTogether?.active && !state.gameTogether.isHost) {
    state.gameTogether.gamepadIndex = e.gamepad.index;
    showToast(`Controller connected: ${e.gamepad.id}`, 'success');
  }
});

window.addEventListener('gamepaddisconnected', (e) => {
  console.log('Gamepad disconnected:', e.gamepad.id);
  if (state.gameTogether?.gamepadIndex === e.gamepad.index) {
    state.gameTogether.gamepadIndex = null;
    showToast('Controller disconnected', 'warning');
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Escape to close modals and exit fullscreen
  if (e.key === 'Escape') {
    // Exit chat fullscreen if active
    const mainContent = document.querySelector('.main-content');
    if (mainContent && mainContent.classList.contains('chat-fullscreen')) {
      mainContent.classList.remove('chat-fullscreen');
      const btn = document.getElementById('chatFullscreenBtn');
      if (btn) btn.title = 'Fullscreen';
      return;
    }

    // Close modal if open
    const modalOverlay = document.getElementById('modalOverlay');
    if (modalOverlay && modalOverlay.classList.contains('active')) {
      closeModalFull();
    }
  }
});

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
