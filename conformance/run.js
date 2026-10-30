#!/usr/bin/env node
/**
 * Emberlan conformance harness. See docs/conformance.md.
 *
 * Two corpora, one PASS/FAIL line per check:
 *  - contract: static checks that the UI, the server and the three shells
 *    (web, Windows desktop, Android) agree: every API call the client makes
 *    has a route, every socket event has a handler, every bridge function the
 *    client calls exists in both native shells.
 *  - live: boots the real server against a throwaway in-memory MongoDB and
 *    drives it the way the client does (HTTP + socket.io).
 *
 * Results go to conformance/results.json; a check that passed in the
 * committed baseline and fails now is a regression and exits 1.
 *   node conformance/run.js            run, compare to baseline
 *   node conformance/run.js --accept   run, write the new baseline + history row
 *   node conformance/run.js --static   contract corpus only (no MongoDB)
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const args = new Set(process.argv.slice(2));

const results = [];
const record = (id, ok, detail = '') => {
  results.push({ id, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` - ${detail}` : ''}`);
};
async function check(id, fn) {
  try {
    const r = await fn();
    if (r === true || r === undefined) record(id, true);
    else record(id, false, typeof r === 'string' ? r : JSON.stringify(r));
  } catch (e) {
    record(id, false, e.message);
  }
}

// ---------- source extraction ----------
const app = read('client/public/app.js');
// All of the UI's own scripts (not vendor/): app.js, touchpad.js, voice-rtc.js.
const clientJs = fs.readdirSync(path.join(ROOT, 'client/public')).filter((f) => f.endsWith('.js'))
  .map((f) => read(path.join('client/public', f))).join('\n');
const serverSrc = fs.readdirSync(path.join(ROOT, 'server'), { recursive: true })
  .filter((f) => f.endsWith('.js'))
  .map((f) => read(path.join('server', f)))
  .join('\n');

// Client API calls: every template string containing /api/, with the method
// from the fetch options that follow it (GET when none).
function clientCalls() {
  const calls = new Map();
  // One-line quoted URLs: `${state.serverUrl}/api/...` or '/api/...'.
  const re = /(?:fetch\(\s*|=\s*)([`'"])(?:\$\{[^}]+\})?(\/api\/[^`'"?\n]*)[^`'"\n]*\1/g;
  let m;
  while ((m = re.exec(app))) {
    const tail = app.slice(m.index, m.index + 400);
    const end = tail.indexOf(');');
    const method = ((end > 0 ? tail.slice(0, end) : tail).match(/method:\s*['"`](\w+)/) || [, 'GET'])[1].toUpperCase();
    const p = m[2].replace(/\$\{[^}]+\}/g, ':x').replace(/\/$/, '');
    calls.set(`${method} ${p}`, { method, path: p });
  }
  return [...calls.values()];
}
const routes = [...read('server/routes/api.js').matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)]
  .map(([, method, p]) => ({ method: method.toUpperCase(), path: '/api' + p }));
const routeMatches = (call, route) => {
  if (call.method !== route.method) return false;
  const a = call.path.split('/'), b = route.path.split('/');
  // A client segment like `${base}/stats` collapses to ":x"; route params match anything.
  return a.length === b.length && a.every((s, i) => s === b[i] || b[i].startsWith(':') || s.includes(':x'));
};

const events = (src, verb) => new Set([...src.matchAll(new RegExp(`\\.${verb}\\(\\s*['"]([\\w:-]+)['"]`, 'g'))].map((m) => m[1]));
const clientEmits = events(clientJs, 'emit');
const clientListens = events(clientJs, 'on');
const serverListens = events(read('server/socket/socketHandler.js'), 'on');
const serverEmits = events(serverSrc, 'emit');
const SOCKET_BUILTINS = new Set(['connect', 'disconnect', 'connect_error', 'error']);

const bridgeKeys = (src) => new Set([...src.matchAll(/^\s{2,4}(\w+)\s*:/gm)].map((m) => m[1]));
const clientBridgeUse = new Set([...app.matchAll(/electronAPI\.(\w+)/g)].map((m) => m[1]));

// ---------- contract corpus ----------
async function contract() {
  const calls = clientCalls();
  await check('contract/api calls use state.serverUrl (desktop and Android have no same origin)', () => {
    const rel = [...app.matchAll(/fetch\(\s*['"`]\/api\//g)].length;
    return !rel || `${rel} fetch() call(s) use a relative /api/ URL`;
  });
  await check('contract/no function is defined twice in app.js (the later one silently wins)', () => {
    const seen = new Map();
    for (const [, n] of app.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)) seen.set(n, (seen.get(n) || 0) + 1);
    const d = [...seen].filter(([, c]) => c > 1).map(([n]) => n);
    return !d.length || d.join(', ');
  });
  for (const c of calls) {
    await check(`contract/api ${c.method} ${c.path}`, () =>
      routes.some((r) => routeMatches(c, r)) || 'no server route');
  }
  for (const e of clientEmits) {
    if (SOCKET_BUILTINS.has(e)) continue;
    await check(`contract/socket client->server ${e}`, () => serverListens.has(e) || 'server has no handler');
  }
  for (const e of clientListens) {
    if (SOCKET_BUILTINS.has(e)) continue;
    await check(`contract/socket server->client ${e}`, () => serverEmits.has(e) || 'server never emits it');
  }
  // Voice, video and screen share need the client to speak the server's WebRTC signaling.
  for (const e of ['webrtc:offer', 'webrtc:answer', 'webrtc:ice-candidate']) {
    await check(`contract/webrtc client handles ${e}`, () =>
      (clientEmits.has(e) && clientListens.has(e)) || 'client never sends/receives it, so no audio/video flows');
  }

  // Parity: one UI source, two native shells exposing the same bridge.
  const preload = bridgeKeys(read('electron-client/preload.js'));
  const android = bridgeKeys(read('mobile/native-bridge.js'));
  for (const k of clientBridgeUse) {
    await check(`parity/bridge ${k}`, () =>
      (preload.has(k) && android.has(k)) || `desktop:${preload.has(k)} android:${android.has(k)}`);
  }
  await check('parity/desktop renderer is generated from client/public', () =>
    (/client', 'public'/.test(read('electron-client/scripts/copy-renderer.js')) && read('.gitignore').includes('electron-client/renderer/')) || 'renderer is not a pure copy of client/public');
  await check('contract/UI loads no scripts from a CDN (CSP blocks them; desktop/Android must work offline)', () => {
    const ext = [...read('client/public/index.html').matchAll(/<script[^>]+src="(https?:[^"]+)"/g)].map((m) => m[1]);
    return !ext.length || ext.join(', ');
  });
  await check('parity/android www is generated from client/public', () =>
    /client', 'public'/.test(read('mobile/scripts/copy-client.js')) || 'mobile copies from elsewhere');
  await check('parity/electron loads the generated renderer', () =>
    read('electron-client/main.js').includes("loadFile('renderer/index.html')"));

  // Look: no Discord brand leftovers in the UI.
  const ui = app + read('client/public/styles.css') + read('client/public/index.html');
  await check('style/no Discord brand colors or names', () => {
    const hits = ui.match(/#5865f2|#36393f|#2f3136|#202225|#7289da|#40444b|#b9bbbe|#72767d|#dcddde|#96989d|#23a55a|#f23f43|#4f545c|#8e9297|blurple|\bdiscord\b|Whitney|gg sans|\bnitro\b|server boost|jump to present/gi);
    return !hits || `found: ${[...new Set(hits)].join(', ')}`;
  });

  // Desktop build inputs.
  for (const f of ['electron-client/assets/icon.ico', 'electron-client/assets/icon.png']) {
    await check(`build/${f} exists`, () => exists(f) || 'electron-builder needs it');
  }
  // Repo rules required files.
  for (const f of ['README.md', 'LICENSE', 'CHANGELOG.md', 'ROADMAP.md', 'SECURITY.md', 'CONTRIBUTING.md',
    'docs/architecture.md', 'docs/api.md', 'docs/running.md', 'docs/conformance.md']) {
    await check(`repo/${f}`, () => exists(f) || 'missing');
  }
}

// Ask the OS for a free port: random picks can land in ranges Windows reserves (Hyper-V).
const freePort = () => new Promise((res, rej) => {
  const srv = require('net').createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => res(port)); });
  srv.on('error', rej);
});

// ---------- live corpus ----------
async function live() {
  let MongoMemoryServer, ioc;
  try {
    ({ MongoMemoryServer } = require('mongodb-memory-server'));
    ioc = require('socket.io-client');
  } catch {
    console.log('SKIP live - run `npm install` first (needs mongodb-memory-server)');
    return;
  }
  const mongo = await MongoMemoryServer.create();
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const log = [];
  const srv = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), MONGODB_URI: mongo.getUri('emberlan-conformance'),
      JWT_SECRET: 'conformance', FEDERATION_ENABLED: 'false', NODE_ENV: 'test' },
  });
  srv.stdout.on('data', (d) => log.push(String(d)));
  srv.stderr.on('data', (d) => log.push(String(d)));

  const http = async (method, p, token, body) => {
    const r = await fetch(base + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
      body: body && JSON.stringify(body),
    });
    let json = null;
    try { json = await r.json(); } catch {}
    return { status: r.status, json };
  };
  const sock = (token) => new Promise((res, rej) => {
    const s = ioc(base, { auth: { token }, transports: ['websocket'], reconnection: false });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
  const once = (s, ev, ms = 3000) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`no ${ev} within ${ms}ms`)), ms);
    s.once(ev, (d) => { clearTimeout(t); res(d); });
  });

  try {
    const t0 = Date.now();
    let up = false;
    while (Date.now() - t0 < 30000 && !up) {
      try { up = (await fetch(base + '/health')).ok; } catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    await check('live/server boots and /health answers', () => up || `server never came up:\n${log.join('').slice(-1500)}`);
    if (!up) return;
    await check('live/web client is served at /', async () => {
      const r = await fetch(base + '/');
      return (r.ok && (await r.text()).includes('app.js')) || `status ${r.status}`;
    });

    for (const origin of ['null', 'https://emberlan.local']) {
      await check(`live/cors allows the ${origin === 'null' ? 'desktop' : 'Android'} app origin (${origin})`, async () => {
        const r = await fetch(base + '/api/auth/login', { method: 'OPTIONS', headers: { Origin: origin,
          'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization' } });
        const allow = r.headers.get('access-control-allow-origin');
        return allow === '*' || allow === origin || `allow-origin: ${allow}`;
      });
    }

    let admin, alice, bob;
    await check('live/auth login as default admin', async () => {
      const r = await http('POST', '/api/auth/login', null, { username: 'admin', password: 'admin123' });
      admin = r.json?.token;
      return !!admin || r;
    });
    await check('live/auth register two users', async () => {
      const a = await http('POST', '/api/auth/register', null, { username: 'alice', email: 'alice@example.com', password: 'password1' });
      const b = await http('POST', '/api/auth/register', null, { username: 'bobby', email: 'bob@example.com', password: 'password1' });
      alice = { token: a.json?.token, id: a.json?.user?._id || a.json?.user?.id };
      bob = { token: b.json?.token, id: b.json?.user?._id || b.json?.user?.id };
      return !!(alice.token && bob.token && alice.id && bob.id) || { a: a.status, b: b.status, body: a.json };
    });
    await check('live/auth /me returns the user', async () => {
      const r = await http('GET', '/api/auth/me', alice?.token);
      return (r.json?.user?.username || r.json?.username) === 'alice' || r;
    });

    let channels = [];
    await check('live/channels default channels exist', async () => {
      const r = await http('GET', '/api/channels', alice?.token);
      channels = Array.isArray(r.json) ? r.json : r.json?.channels || [];
      return (channels.some((c) => c.type === 'text') && channels.some((c) => c.type === 'voice')) || r;
    });
    const text = channels.find((c) => c.type === 'text');
    const voice = channels.find((c) => c.type === 'voice');

    let sa, sb;
    await check('live/socket both users connect', async () => { sa = await sock(alice.token); sb = await sock(bob.token); });
    if (sa && sb && text) {
      await check('live/chat message reaches the other user and is stored', async () => {
        sa.emit('channel:join', text._id); sb.emit('channel:join', text._id);
        await new Promise((r) => setTimeout(r, 200));
        const got = once(sb, 'message:new');
        const err = once(sa, 'error', 3500).then((e) => { throw new Error(`server error: ${JSON.stringify(e)}`); });
        sa.emit('message:send', { channelId: text._id, content: 'conformance hello' });
        const m = await Promise.race([got, err]);
        const r = await http('GET', `/api/channels/${text._id}/messages`, bob.token);
        const list = Array.isArray(r.json) ? r.json : r.json?.messages || [];
        return (m?.content === 'conformance hello' && list.some((x) => x.content === 'conformance hello')) || { m, r: r.status };
      });
      await check('live/dm encrypted payload reaches recipient', async () => {
        const got = once(sb, 'dm:new');
        sa.emit('dm:send', { recipientId: bob.id, encryptedContent: 'Y2lwaGVy', iv: 'aXY=', encryptedKey: 'a2V5' });
        const d = await got;
        return d?.encryptedContent === 'Y2lwaGVy' || d;
      });
    }
    if (sa && sb && voice) {
      await check('live/voice join announces the user to the channel', async () => {
        sb.emit('voice:join', voice._id);
        await once(sb, 'voice:currentUsers');
        const got = once(sb, 'voice:userJoined');
        sa.emit('voice:join', voice._id);
        const j = await got;
        return !!j || 'no userJoined';
      });
    }

    // Every GET the client makes, with ids filled in: must not 404 or 5xx.
    const ids = { channelId: text?._id, userId: bob?.id };
    for (const c of clientCalls().filter((c) => c.method === 'GET')) {
      if (c.path.includes(':x') && !/\/(channels|users|dm)\/:x(\/|$)/.test(c.path)) continue;
      const p = c.path.replace(/\/(channels)\/:x/, `/$1/${ids.channelId}`).replace(/\/(users|dm)\/:x/, `/$1/${ids.userId}`);
      if (p.includes(':x')) continue;
      // A missing route is express's bare 404 (no JSON); a crash is a 500. A handler
      // that answers "not configured" (503) or "not found" with a JSON error is fine.
      await check(`live/get ${c.path} has a working handler`, async () => {
        const r = await http('GET', p, admin);
        const bad = (r.status === 404 && !r.json) || r.status === 500;
        return !bad || `status ${r.status} ${JSON.stringify(r.json)?.slice(0, 120)}`;
      });
    }
    sa?.close(); sb?.close();
    await uiFlow(base, http);
  } finally {
    srv.kill();
    await mongo.stop();
  }
}

// ---------- UI corpus: the shared client/public UI in a headless browser ----------
// Drives the real login form and chat box over the DevTools protocol (Node's
// built-in WebSocket; no puppeteer). Same code the desktop and Android shells run.
function findBrowser() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find((p) => p && fs.existsSync(p));
}

async function uiFlow(base, http) {
  const bin = findBrowser();
  if (!bin) { console.log('SKIP ui - no Chrome/Edge found (set CHROME_PATH)'); return; }
  const os = require('os');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'emberlan-ui-'));
  const cdpPort = await freePort();
  // Fake mic/camera and no permission prompts, so voice and video run headless.
  const br = spawn(bin, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${cdpPort}`, 'about:blank']);
  const errors = [];
  const sockets = [];

  // One DevTools connection per tab: send / evaluate / waitFor.
  async function connect(target) {
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    sockets.push(ws);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url || '') && !/navigator.vibrate/.test(m.params.entry.text)) errors.push(m.params.entry.text);
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
    const waitFor = async (expr, ms = 8000) => {
      for (const t0 = Date.now(); Date.now() - t0 < ms;) { if (await evaluate(expr)) return true; await new Promise((r) => setTimeout(r, 150)); }
      return false;
    };
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    return { send, evaluate, waitFor };
  }
  // Log in through the real form. rememberMe off so tabs don't share a saved session.
  const login = (pg, user, pass) => pg.evaluate(`(() => { username.value = ${JSON.stringify(user)}; password.value = ${JSON.stringify(pass)};
    rememberMe.checked = false; connectionForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); })()`);

  try {
    let target;
    for (let i = 0; i < 50 && !target; i++) {
      try { target = (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === 'page'); }
      catch { await new Promise((r) => setTimeout(r, 200)); }
    }
    if (!target) return record('ui/browser starts', false, bin);
    const page1 = await connect(target);
    const { send, evaluate, waitFor } = page1;
    await send('Page.navigate', { url: base + '/' });

    await check('ui/login screen renders', () => waitFor(`!!document.getElementById('connectionForm') && document.readyState === 'complete'`) || 'no login form');
    await check('ui/vendored libraries load (socket.io, hls, mpegts)', async () =>
      (await evaluate(`typeof io === 'function' && typeof Hls !== 'undefined' && typeof mpegts !== 'undefined'`)) || 'a library is missing');
    await check('ui/login via the form reaches the app and connects the socket', async () => {
      await login(page1, 'admin', 'admin123');
      return (await waitFor(`getComputedStyle(connectionScreen).display === 'none' && !!(state.socket && state.socket.connected)`)) || 'still on login or socket not connected';
    });
    await check('ui/opens a text channel', async () =>
      (await waitFor(`!!(state.currentChannel && document.getElementById('messageInput')) && document.body.innerText.includes('conformance hello')`)) ||
      `no channel selected; channels=${await evaluate('JSON.stringify((state.channels||[]).map(c=>c.type))')} render=${await evaluate(`(() => { try { renderChannels(); return 'ok'; } catch (e) { return e.stack.split('\\n').slice(0, 3).join(' '); } })()`)} select=${await evaluate(`selectChannel(state.channels.find(c => c.type === 'text')).then(() => 'ok', e => e.stack.split('\\n').slice(0, 3).join(' '))`)}`);
    await check('ui/sending a message from the chat box stores and shows it', async () => {
      const text = `ui conformance ${Date.now()}`;
      await evaluate(`(() => { messageInput.value = ${JSON.stringify(text)}; sendMessage(); })()`);
      const shown = await waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`);
      const ch = await evaluate('state.currentChannel._id');
      const login = await http('POST', '/api/auth/login', null, { username: 'admin', password: 'admin123' });
      const r = await http('GET', `/api/channels/${ch}/messages`, login.json?.token);
      const list = Array.isArray(r.json) ? r.json : r.json?.messages || [];
      return (shown && list.some((m) => m.content === text)) || `shown:${shown} stored:${list.some((m) => m.content === text)}`;
    });
    const shot = async (name, pg = page1) => {
      if (!args.has('--screenshots')) return;
      const { result } = await pg.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.join(ROOT, 'docs/screenshots'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'docs/screenshots', name), Buffer.from(result.data, 'base64'));
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    await shot('desktop-chat.png');

    // Touch gamepad (Game Together on phones): a phone-sized touch screen, real touch events.
    await send('Emulation.setDeviceMetricsOverride', { width: 860, height: 400, deviceScaleFactor: 2, mobile: true });
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const center = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const touch = (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    await check('ui/touch pad appears for Game Together when no controller is connected', async () => {
      await evaluate(`localStorage.removeItem('emberlan-touchpad'); touchPad.start()`);
      return (await evaluate(`touchPad.visible && getComputedStyle(document.getElementById('touchPad')).display !== 'none'`)) || 'pad not shown';
    });
    await check('ui/touch pad: two fingers press A and push the left stick at once', async () => {
      const a = await center('.tp-a'), s = await center('[data-id="LSTICK"]');
      await touch('touchStart', [{ ...a, id: 1 }, { x: s.x + 60, y: s.y, id: 2 }]);
      await new Promise((r) => setTimeout(r, 100));
      const r = await evaluate('touchPad.read()');
      await touch('touchEnd', []);
      const after = await evaluate('touchPad.read()');
      return (r?.buttons.A === true && r.axes.LEFT_X > 0.5 && after.buttons.A === false && after.axes.LEFT_X === 0) || JSON.stringify({ r, after });
    });
    await shot('android-touchpad.png');
    await check('ui/touch pad: layout edits are saved', async () => {
      await evaluate(`document.querySelector('.tp-bar .tp-tool').click()`);
      const a = await center('.tp-a');
      await touch('touchStart', [{ ...a, id: 3 }]);
      await touch('touchMove', [{ x: a.x - 200, y: a.y - 100, id: 3 }]);
      await touch('touchEnd', []);
      await evaluate(`document.querySelector('.tp-bar .tp-tool').click()`);
      const saved = await evaluate(`JSON.parse(localStorage.getItem('emberlan-touchpad'))?.controls?.A`);
      return (saved && saved.x < 80) || `saved: ${JSON.stringify(saved)}`;
    });
    await evaluate('touchPad.stop()');

    // Voice and video between two real users in two tabs (fake mic and camera).
    await send('Emulation.clearDeviceMetricsOverride');
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    const t2 = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
    const page2 = await connect(t2);
    await page2.send('Page.navigate', { url: base + '/' });
    await page2.waitFor(`!!document.getElementById('connectionForm') && document.readyState === 'complete'`);
    await login(page2, 'alice', 'password1');
    const p2ok = await page2.waitFor(`!!(state.socket && state.socket.connected && state.channels?.length)`);
    const vc = await evaluate(`state.channels.find((c) => c.type === 'voice')._id`);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    await check('ui/voice: two users in a voice channel get a connected WebRTC call', async () => {
      if (!p2ok) return 'second user never logged in';
      await evaluate(`joinVoice(${JSON.stringify(vc)})`);
      await sleep(500);
      await page2.evaluate(`joinVoice(${JSON.stringify(vc)})`);
      const a = await waitFor(`rtc.peers().some((p) => p.state === 'connected')`, 15000);
      const b = await page2.waitFor(`rtc.peers().some((p) => p.state === 'connected')`, 15000);
      return (a && b) || `admin:${JSON.stringify(await evaluate('rtc.peers()'))} alice:${JSON.stringify(await page2.evaluate('rtc.peers()'))}`;
    });
    await check('ui/voice: audio from each user reaches the other', async () => {
      // Unmute both (the default voice mode may start muted) so real audio, not silence, is sent.
      for (const pg of [page1, page2]) await pg.evaluate(`state.isMuted && toggleMute()`);
      const before = [await evaluate('rtc.stats()'), await page2.evaluate('rtc.stats()')];
      await sleep(1500);
      const after = [await evaluate('rtc.stats()'), await page2.evaluate('rtc.stats()')];
      const grew = after.map((s, i) => s.audio - before[i].audio);
      const playing = await page2.evaluate(`[...document.querySelectorAll('audio.rtc-audio')].some((a) => a.srcObject?.getAudioTracks()[0]?.readyState === 'live' && !a.paused)`);
      return (grew.every((g) => g > 2000) && playing) || `audio bytes/1.5s admin<-alice:${grew[0]} alice<-admin:${grew[1]} alice playing:${playing}`;
    });
    await check('ui/voice: deafen silences what you hear', async () => {
      await page2.evaluate('toggleDeafen()');
      const muted = await page2.evaluate(`[...document.querySelectorAll('audio.rtc-audio')].every((a) => a.muted)`);
      await page2.evaluate('toggleDeafen()');
      const back = await page2.evaluate(`[...document.querySelectorAll('audio.rtc-audio')].every((a) => !a.muted)`);
      return (muted && back) || `deafened muted:${muted} undeafened audible:${back}`;
    });
    await check('ui/video: turning on a camera shows it to the other user', async () => {
      await evaluate('toggleCamera()');
      const seen = await page2.waitFor(`[...document.querySelectorAll('video[id^="video-remote-"]')].some((v) => v.videoWidth > 0)`, 15000);
      return seen || `alice tiles: ${await page2.evaluate(`[...document.querySelectorAll('video')].map((v) => v.id + ':' + v.videoWidth).join(',')`)}`;
    });
    await page2.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    await shot('desktop-voice-video.png', page2);
    await check('ui/video: turning the camera off removes it for the other user', async () => {
      await evaluate('toggleCamera()');
      return (await page2.waitFor(`!document.querySelector('video[id^="video-remote-"]')`, 10000)) || 'remote tile still there';
    });
    await check('ui/voice: leaving ends the call for the other user', async () => {
      await evaluate('leaveVoice()');
      return (await page2.waitFor('rtc.peers().length === 0', 10000)) || JSON.stringify(await page2.evaluate('rtc.peers()'));
    });
    await page2.evaluate('leaveVoice()');

    await check('ui/no JavaScript errors during the flow', () => !errors.length || errors.slice(0, 5).join(' | '));
  } finally {
    for (const w of sockets) { try { w.close(); } catch {} }
    br.kill();
    await new Promise((r) => setTimeout(r, 500));
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

// ---------- report ----------
(async () => {
  await contract();
  if (!args.has('--static')) await live();

  const pass = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log(`\nconformance: ${pass}/${total} passing`);

  const baseFile = path.join(__dirname, 'results.json');
  const baseline = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, 'utf8')) : { checks: {} };
  const ran = new Set(results.map((r) => r.id));
  const regressions = Object.entries(baseline.checks)
    .filter(([id, ok]) => ok && ran.has(id) && !results.find((r) => r.id === id).ok)
    .map(([id]) => id);

  if (args.has('--accept')) {
    const checks = Object.fromEntries(results.map((r) => [r.id, r.ok]));
    fs.writeFileSync(baseFile, JSON.stringify({ pass, total, checks }, null, 2) + '\n');
    const hist = path.join(__dirname, 'history.csv');
    if (!fs.existsSync(hist)) fs.writeFileSync(hist, 'date,commit,pass,total\n');
    let commit = 'uncommitted';
    try { commit = require('child_process').execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch {}
    fs.appendFileSync(hist, `${new Date().toISOString().slice(0, 10)},${commit},${pass},${total}\n`);
    const readme = path.join(ROOT, 'README.md');
    fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(
      /<!-- conformance -->.*<!-- \/conformance -->/,
      `<!-- conformance -->**${pass}/${total}** checks passing<!-- /conformance -->`));
    console.log('baseline, history and README updated');
  }
  if (regressions.length) {
    console.log(`\nREGRESSION: ${regressions.length} check(s) passed in the baseline and fail now:`);
    regressions.forEach((r) => console.log(`  ${r}`));
    process.exit(1);
  }
  process.exit(0);
})();
