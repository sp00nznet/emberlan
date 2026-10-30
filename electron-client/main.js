const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage, Notification, desktopCapturer } = require('electron');
const path = require('path');
const Store = require('electron-store');
const { spawn } = require('child_process');
const { createGamepads } = require('./gamepads');

// Game Together: virtual Xbox pads for guests. vigemclient is a native module (Windows only).
let ViGEmClient = null;
try { ViGEmClient = require('vigemclient'); } catch (e) { console.warn('vigemclient unavailable:', e.message); }
const gamepads = createGamepads(ViGEmClient);

// EMBERLAN_* env vars; the old F7LANS_* names still work.
const env = (k) => process.env[`EMBERLAN_${k}`] ?? process.env[`F7LANS_${k}`];

// Check if running in embedded server mode
const EMBEDDED_SERVER = env("EMBEDDED_SERVER") === 'true' || process.argv.includes('--embedded-server');
const HEADLESS_MODE = env("HEADLESS") === 'true' || process.argv.includes('--headless');
const SERVER_PORT = env("PORT") || 3001;

// Server process reference
let serverProcess = null;

// Initialize settings store
const store = new Store({
  defaults: {
    serverUrl: 'http://localhost:3001',
    token: null,
    minimizeToTray: true,
    startMinimized: false,
    pushToTalkKey: '',  // Empty = PTT disabled. Use voice activation instead
    pushToTalkEnabled: false,
    voiceActivated: true,  // Voice activation enabled by default
    voiceActivationThreshold: 50,
    audioInputDevice: 'default',
    audioOutputDevice: 'default',
    inputVolume: 100,
    outputVolume: 100,
    windowBounds: { width: 1200, height: 800 }
  }
});

let mainWindow = null;
let tray = null;
let isQuitting = false;

// Create the main window
function createWindow() {
  const bounds = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    minWidth: 940,
    minHeight: 600,
    frame: true,
    backgroundColor: '#0a0a0f',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    show: !store.get('startMinimized')
  });

  // Load the app
  const serverUrl = store.get('serverUrl');
  mainWindow.loadFile('renderer/index.html');

  // Save window bounds on resize
  mainWindow.on('resize', () => {
    const { width, height } = mainWindow.getBounds();
    store.set('windowBounds', { width, height });
  });

  // Handle close to tray
  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get('minimizeToTray')) {
      event.preventDefault();
      mainWindow.hide();

      if (process.platform === 'win32') {
        showNotification('Emberlan', 'Emberlan is still running in the system tray');
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

// Create system tray
function createTray() {
  // Create tray icon
  const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');

  // Create a simple icon if file doesn't exist
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
  } catch (e) {
    // Create a simple colored icon
    trayIcon = nativeImage.createEmpty();
  }

  if (trayIcon.isEmpty()) {
    // Create 16x16 orange square as fallback
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      canvas[i * 4] = 255;     // R
      canvas[i * 4 + 1] = 140; // G
      canvas[i * 4 + 2] = 0;   // B
      canvas[i * 4 + 3] = 255; // A
    }
    trayIcon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Emberlan',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Mute',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-mute', menuItem.checked);
        }
      }
    },
    {
      label: 'Deafen',
      type: 'checkbox',
      checked: false,
      click: (menuItem) => {
        if (mainWindow) {
          mainWindow.webContents.send('toggle-deafen', menuItem.checked);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Emberlan - Gaming Community');
  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Register global shortcuts
function registerShortcuts() {
  // Mute toggle: Ctrl+Shift+M
  globalShortcut.register(`CommandOrControl+Shift+M`, () => {
    if (mainWindow) {
      mainWindow.webContents.send('toggle-mute');
    }
  });

  // Deafen toggle: Ctrl+Shift+D
  globalShortcut.register(`CommandOrControl+Shift+D`, () => {
    if (mainWindow) {
      mainWindow.webContents.send('toggle-deafen');
    }
  });

  // NOTE: Push-to-talk is NOT registered globally because Electron's
  // globalShortcut doesn't support key release events (only keydown).
  // PTT is handled within the renderer window using regular keyboard events.
  // Users should use voice activation for hands-free, or PTT within the app window.
}

// Show notification
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      icon: path.join(__dirname, 'assets', 'icon.png')
    }).show();
  }
}

// IPC Handlers
function setupIPC() {
  // Get settings
  ipcMain.handle('get-settings', () => {
    return {
      serverUrl: store.get('serverUrl'),
      token: store.get('token'),
      minimizeToTray: store.get('minimizeToTray'),
      startMinimized: store.get('startMinimized'),
      pushToTalkKey: store.get('pushToTalkKey'),
      voiceActivated: store.get('voiceActivated'),
      voiceActivationThreshold: store.get('voiceActivationThreshold'),
      audioInputDevice: store.get('audioInputDevice'),
      audioOutputDevice: store.get('audioOutputDevice'),
      inputVolume: store.get('inputVolume'),
      outputVolume: store.get('outputVolume')
    };
  });

  // Save settings
  ipcMain.handle('save-settings', (event, settings) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key, value);
    }
    return true;
  });

  // Save token
  ipcMain.handle('save-token', (event, token) => {
    store.set('token', token);
    return true;
  });

  // Get token
  ipcMain.handle('get-token', () => {
    return store.get('token');
  });

  // Clear token (logout)
  ipcMain.handle('clear-token', () => {
    store.delete('token');
    return true;
  });

  // Set server URL
  ipcMain.handle('set-server-url', (event, url) => {
    store.set('serverUrl', url);
    return true;
  });

  // Game Together host: guest input -> virtual pads (gamepads.js)
  ipcMain.handle('gamepad-status', () => gamepads.status());
  ipcMain.on('gamepad-set', (event, slot, input) => {
    try { gamepads.set(slot, input); } catch (e) { console.error('gamepad-set:', e.message); }
  });
  ipcMain.on('gamepad-remove', (event, slot) => gamepads.remove(slot));
  ipcMain.on('gamepad-clear', () => gamepads.clear());

  // Show notification
  ipcMain.on('show-notification', (event, { title, body }) => {
    showNotification(title, body);
  });

  // Update tray tooltip
  ipcMain.on('update-tray-status', (event, status) => {
    if (tray) {
      tray.setToolTip(`Emberlan - ${status}`);
    }
  });

  // Flash window (for notifications when minimized)
  ipcMain.on('flash-window', () => {
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true);
    }
  });

  // Get screen sources for screen sharing
  ipcMain.handle('get-screen-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true
      });

      return sources.map(source => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
        display_id: source.display_id
      }));
    } catch (error) {
      console.error('Failed to get screen sources:', error);
      throw error;
    }
  });

  // Select folder for file sharing
  ipcMain.handle('select-folder', async () => {
    const { dialog } = require('electron');
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select a folder to share'
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const folderPath = result.filePaths[0];
    const folderName = path.basename(folderPath);

    return { path: folderPath, name: folderName };
  });
}

// Start embedded server
async function startEmbeddedServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting embedded Emberlan server...');

    // Determine server path - in packaged app, it's in resources
    let serverPath;
    if (app.isPackaged) {
      serverPath = path.join(process.resourcesPath, 'server');
    } else {
      serverPath = path.join(__dirname, '..', 'server');
    }

    const serverScript = path.join(serverPath, 'index.js');

    // Set environment variables
    const env = {
      ...process.env,
      PORT: SERVER_PORT,
      NODE_ENV: 'production',
      EMBERLAN_DATA_DIR: app.getPath('userData')
    };

    serverProcess = spawn('node', [serverScript], {
      cwd: serverPath,
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[Server]', output);
      if (output.includes('Server running on port')) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[Server Error]', data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    serverProcess.on('exit', (code) => {
      console.log(`Server exited with code ${code}`);
      serverProcess = null;
    });

    // Resolve after timeout if server doesn't signal ready
    setTimeout(() => resolve(), 5000);
  });
}

// Stop embedded server
function stopEmbeddedServer() {
  if (serverProcess) {
    console.log('Stopping embedded server...');
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

// App ready
app.whenReady().then(async () => {
  // Start embedded server if enabled
  if (EMBEDDED_SERVER) {
    try {
      await startEmbeddedServer();
      // Update default server URL to localhost
      store.set('serverUrl', `http://localhost:${SERVER_PORT}`);
    } catch (err) {
      console.error('Failed to start embedded server:', err);
    }
  }

  // In headless mode, don't create window
  if (!HEADLESS_MODE) {
    createWindow();
    createTray();
    registerShortcuts();
  } else {
    console.log('Running in headless server mode');
    // Create minimal tray for server control
    createHeadlessTray();
  }

  setupIPC();

  app.on('activate', () => {
    if (!HEADLESS_MODE) {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else if (mainWindow) {
        mainWindow.show();
      }
    }
  });
});

// Create headless mode tray
function createHeadlessTray() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    canvas[i * 4] = 255;     // R
    canvas[i * 4 + 1] = 140; // G
    canvas[i * 4 + 2] = 0;   // B
    canvas[i * 4 + 3] = 255; // A
  }
  const trayIcon = nativeImage.createFromBuffer(canvas, { width: size, height: size });

  tray = new Tray(trayIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Emberlan Server (Port ${SERVER_PORT})`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: 'Open Web Interface',
      click: () => {
        require('electron').shell.openExternal(`http://localhost:${SERVER_PORT}`);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit Server',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip(`Emberlan Server - Port ${SERVER_PORT}`);
  tray.setContextMenu(contextMenu);
}

// Quit when all windows are closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Before quit
app.on('before-quit', () => {
  isQuitting = true;
  stopEmbeddedServer();
});

// Unregister shortcuts on quit
app.on('will-quit', () => {
  gamepads.clear();
  globalShortcut.unregisterAll();
});

// Handle certificate errors for self-signed certs (development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  // In production, you would want to verify the certificate
  if (process.env.NODE_ENV === 'development') {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
