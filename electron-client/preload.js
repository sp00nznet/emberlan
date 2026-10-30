const { contextBridge, ipcRenderer } = require('electron');

// Expose secure APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // Authentication
  saveToken: (token) => ipcRenderer.invoke('save-token', token),
  getToken: () => ipcRenderer.invoke('get-token'),
  clearToken: () => ipcRenderer.invoke('clear-token'),

  // Server
  setServerUrl: (url) => ipcRenderer.invoke('set-server-url', url),

  // Notifications
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  flashWindow: () => ipcRenderer.send('flash-window'),

  // Tray
  updateTrayStatus: (status) => ipcRenderer.send('update-tray-status', status),

  // Event listeners
  onToggleMute: (callback) => ipcRenderer.on('toggle-mute', callback),
  onToggleDeafen: (callback) => ipcRenderer.on('toggle-deafen', callback),
  onPTTStart: (callback) => ipcRenderer.on('ptt-start', callback),
  onPTTEnd: (callback) => ipcRenderer.on('ptt-end', callback),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback),

  // Screen sharing - get available sources via main process
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),

  // File sharing - folder selection
  selectFolder: () => ipcRenderer.invoke('select-folder'),

  // Game Together host: virtual Xbox pads for guests (ViGEmBus)
  gamepad: {
    status: () => ipcRenderer.invoke('gamepad-status'),
    set: (slot, input) => ipcRenderer.send('gamepad-set', slot, input),
    remove: (slot) => ipcRenderer.send('gamepad-remove', slot),
    clear: () => ipcRenderer.send('gamepad-clear'),
  },

  // Platform info
  platform: process.platform,
  version: process.versions.electron
});
