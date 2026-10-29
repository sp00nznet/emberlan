/**
 * Sync the Electron renderer from the unified Ember web client.
 * client/public is the single source of truth for the UI (it is already
 * Electron-aware — see `window.electronAPI` guards). This copies it into
 * electron-client/renderer so the desktop app ships the same UI as the web.
 */

const fs = require('fs-extra');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'client', 'public');
const dest = path.join(__dirname, '..', 'renderer');

async function copyRenderer() {
  console.log('Syncing renderer from client/public...');
  try {
    await fs.ensureDir(dest);
    // Copy the UI files, leaving anything else in renderer/ untouched.
    for (const file of ['index.html', 'app.js', 'styles.css', 'logo.svg']) {
      await fs.copy(path.join(src, file), path.join(dest, file));
    }
    console.log(`Renderer synced from ${src}`);
  } catch (error) {
    console.error('Failed to sync renderer:', error);
    process.exit(1);
  }
}

copyRenderer();
