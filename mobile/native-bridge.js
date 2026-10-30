/**
 * Android shell bridge: the same window.electronAPI surface the desktop
 * preload (electron-client/preload.js) exposes, so client/public runs
 * unchanged here. The conformance harness checks the two key sets match.
 */
(() => {
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const noop = () => {};
  window.electronAPI = {
    getSettings: async () => get('emberlan-settings', {}),
    saveSettings: async (s) => { set('emberlan-settings', s); return true; },
    saveToken: async (t) => { set('emberlan-token', t); return true; },
    getToken: async () => get('emberlan-token', null),
    clearToken: async () => { localStorage.removeItem('emberlan-token'); return true; },
    setServerUrl: async (url) => { set('emberlan-settings', { ...get('emberlan-settings', {}), serverUrl: url }); return true; },
    showNotification: (title, body) => {
      if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body });
    },
    flashWindow: noop,
    updateTrayStatus: noop,
    onToggleMute: noop,
    onToggleDeafen: noop,
    onPTTStart: noop,
    onPTTEnd: noop,
    onOpenSettings: noop,
    // ponytail: Android WebView has no screen-capture picker; returns none so the UI shows "no sources".
    getScreenSources: async () => [],
    selectFolder: async () => null,
    // Phones join Game Together as players; hosting needs the Windows desktop app.
    gamepad: {
      status: async () => ({ available: false, error: 'Hosting needs the Emberlan desktop app on Windows' }),
      set: noop, remove: noop, clear: noop,
    },
    platform: 'android',
    version: 'capacitor'
  };
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  document.addEventListener('DOMContentLoaded', () => window.Capacitor?.Plugins?.SplashScreen?.hide());
})();
