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
const clientEmits = events(app, 'emit');
const clientListens = events(app, 'on');
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
  await check('parity/desktop renderer is generated from client/public', () => {
    const s = read('electron-client/scripts/copy-renderer.js');
    const missing = fs.readdirSync(path.join(ROOT, 'client/public')).filter((f) => !s.includes(`'${f}'`));
    return (!missing.length && read('.gitignore').includes('electron-client/renderer/')) || `not copied: ${missing}`;
  });
  await check('parity/android www is generated from client/public', () =>
    /client', 'public'/.test(read('mobile/scripts/copy-client.js')) || 'mobile copies from elsewhere');
  await check('parity/electron loads the generated renderer', () =>
    read('electron-client/main.js').includes("loadFile('renderer/index.html')"));

  // Look: no Discord brand leftovers in the UI.
  const ui = app + read('client/public/styles.css') + read('client/public/index.html');
  await check('style/no Discord brand colors or names', () => {
    const hits = ui.match(/#5865f2|#36393f|#2f3136|#202225|#7289da|blurple|\bdiscord\b|Whitney|gg sans/gi);
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
  const port = 40000 + Math.floor(Math.random() * 20000);
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
  } finally {
    srv.kill();
    await mongo.stop();
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
