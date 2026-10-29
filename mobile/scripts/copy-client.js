/**
 * Build mobile/www from client/public, the one UI source shared with the web
 * and desktop clients. Only change: load the Capacitor runtime and the
 * native bridge before app.js.
 */
const fs = require('fs-extra');
const path = require('path');

const src = path.join(__dirname, '..', '..', 'client', 'public');
const dest = path.join(__dirname, '..', 'www');

(async () => {
  await fs.emptyDir(dest);
  await fs.copy(src, dest);
  await fs.copy(path.join(__dirname, '..', 'native-bridge.js'), path.join(dest, 'native-bridge.js'));
  const html = path.join(dest, 'index.html');
  const out = (await fs.readFile(html, 'utf8')).replace(
    /<script src="app\.js"/,
    '<script src="capacitor.js"></script>\n<script src="native-bridge.js"></script>\n<script src="app.js"'
  );
  if (!out.includes('native-bridge.js')) throw new Error('index.html has no <script src="app.js"> to hook');
  await fs.writeFile(html, out);
  console.log(`mobile/www built from ${src}`);
})().catch((e) => { console.error(e); process.exit(1); });
