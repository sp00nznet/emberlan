/**
 * Bot corpus for the conformance harness: Plex, Jellyfin, Emby, IPTV and YouTube driven end to
 * end against a fake media server that speaks their APIs and serves real test media
 * (conformance/media, made with ffmpeg).
 *
 * live() checks the server: setup, permissions, no secrets reaching clients, the stream proxy,
 * what each bot tells clients to play, late joiners, settings surviving a restart.
 * ui() checks the real dialogs in the browser and that the media actually decodes.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MEDIA = path.join(__dirname, 'media');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const KEYS = { plex: 'plex-token-123', jellyfin: 'jf-key-456', emby: 'emby-key-789' };
const IPTV_PASS = 'iptv-secret-pass';
const VIDEO_ID = 'dQw4w9WgXcQ';

// ---------- the fake media server ----------

function startFakeMedia() {
  const hits = [];
  const send = (res, status, type, body) => { res.writeHead(status, { 'Content-Type': type }); res.end(body); };
  const json = (res, obj) => send(res, 200, 'application/json', JSON.stringify(obj));
  // Serve a test file with byte ranges (seeking), like real media servers.
  const file = (req, res, name, type) => {
    const buf = fs.readFileSync(path.join(MEDIA, name));
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (!m) { res.writeHead(200, { 'Content-Type': type, 'Content-Length': buf.length, 'Accept-Ranges': 'bytes' }); return res.end(buf); }
    const start = +m[1], end = m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Accept-Ranges': 'bytes' });
    res.end(buf.subarray(start, end + 1));
  };
  const hls = (res, type = 'application/vnd.apple.mpegurl') => send(res, 200, type, fs.readFileSync(path.join(MEDIA, 'hls/index.m3u8')));
  const now = new Date();
  const xmltv = (d) => d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';

  const plexItem = (id) => ({
    101: { ratingKey: '101', title: 'Big Test Movie', type: 'movie', year: 2024, duration: 4000, thumb: '/library/metadata/101/thumb/1',
      Media: [{ container: 'mp4', Part: [{ key: '/library/parts/101/file.mp4', container: 'mp4' }] }] },
    102: { ratingKey: '102', title: 'Big Test Movie (MKV)', type: 'movie', year: 2023, duration: 4000,
      Media: [{ container: 'mkv', Part: [{ key: '/library/parts/102/file.mkv', container: 'mkv' }] }] },
    103: { ratingKey: '103', title: 'Test Tone', type: 'track', grandparentTitle: 'The Testers', duration: 4000,
      Media: [{ container: 'mp3', Part: [{ key: '/library/parts/103/file.mp3', container: 'mp3' }] }] },
  })[id];
  const mbItem = (id) => ({
    m1: { Id: 'm1', Name: 'Big Test Movie', Type: 'Movie', MediaType: 'Video', ProductionYear: 2024, RunTimeTicks: 4e7, ImageTags: { Primary: 'x' } },
    a1: { Id: 'a1', Name: 'Test Tone', Type: 'Audio', MediaType: 'Audio', AlbumArtist: 'The Testers', RunTimeTicks: 4e7 },
  })[id];

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://fake');
    const p = u.pathname;
    hits.push(p);
    // Any HLS segment, wherever the playlist sits.
    const seg = /\/(seg\d+\.ts)$/.exec(p);
    if (seg) return file(req, res, `hls/${seg[1]}`, 'video/mp2t');

    // Plex (JSON with Accept: application/json; token in header or query)
    if (p.startsWith('/plex')) {
      const q = p.slice(5) || '/';
      if ((req.headers['x-plex-token'] || u.searchParams.get('X-Plex-Token')) !== KEYS.plex) return send(res, 401, 'text/plain', 'Unauthorized');
      if (q === '/') return json(res, { MediaContainer: { friendlyName: 'Fake Plex', version: '1.40.0', machineIdentifier: 'fake' } });
      if (q === '/hubs/search') {
        const term = (u.searchParams.get('query') || '').toLowerCase();
        const items = [101, 102, 103].map(plexItem).filter((i) => i.title.toLowerCase().includes(term));
        return json(res, { MediaContainer: { Hub: [{ type: 'movie', Metadata: items.filter((i) => i.type === 'movie') }, { type: 'track', Metadata: items.filter((i) => i.type === 'track') }] } });
      }
      const meta = /^\/library\/metadata\/(\d+)$/.exec(q);
      if (meta) return plexItem(meta[1]) ? json(res, { MediaContainer: { Metadata: [plexItem(meta[1])] } }) : send(res, 404, 'text/plain', 'nope');
      if (/\/thumb\//.test(q)) return send(res, 200, 'image/png', PNG);
      if (q === '/library/parts/101/file.mp4') return file(req, res, 'test.mp4', 'video/mp4');
      if (q === '/library/parts/103/file.mp3') return file(req, res, 'test.mp3', 'audio/mpeg');
      if (/\/transcode\/universal\/start\.m3u8$/.test(q)) return hls(res);
    }

    // Jellyfin and Emby (MediaBrowser API)
    const mb = /^\/(jellyfin|emby)(\/.*)$/.exec(p);
    if (mb) {
      const [, kind, q] = mb;
      const auth = kind === 'jellyfin' ? (/Token="([^"]+)"/.exec(req.headers.authorization || '') || [])[1] : req.headers['x-emby-token'];
      if ((auth || u.searchParams.get('api_key')) !== KEYS[kind]) return send(res, 401, 'text/plain', 'Unauthorized');
      if (q === '/System/Info') return json(res, { ServerName: `Fake ${kind}`, Version: '10.9.0', Id: kind });
      if (q === '/Users') return json(res, [{ Id: 'u1', Name: 'admin' }]);
      if (q === '/Users/u1/Items') {
        const term = (u.searchParams.get('SearchTerm') || '').toLowerCase();
        return json(res, { Items: ['m1', 'a1'].map(mbItem).filter((i) => i.Name.toLowerCase().includes(term)) });
      }
      const item = /^\/Users\/u1\/Items\/(\w+)$/.exec(q);
      if (item) return mbItem(item[1]) ? json(res, mbItem(item[1])) : send(res, 404, 'text/plain', 'nope');
      if (/^\/Items\/\w+\/Images\/Primary$/.test(q)) return send(res, 200, 'image/png', PNG);
      if (/^\/Videos\/m1\/master\.m3u8$/.test(q)) return hls(res);
      if (/^\/Audio\/a1\/universal$/.test(q)) return file(req, res, 'test.mp3', 'audio/mpeg');
    }

    // IPTV provider: the account is in every stream URL, like real providers.
    if (p.startsWith('/iptv/')) {
      const acct = `username=tester&password=${IPTV_PASS}`;
      const base = `http://127.0.0.1:${server.address().port}/iptv`;
      if (p === '/iptv/playlist.m3u') {
        return send(res, 200, 'audio/x-mpegurl', [
          '#EXTM3U',
          `#EXTINF:-1 group-title="News" tvg-logo="${base}/logo.png" tvg-id="news.test",Test News HD`,
          `${base}/live/news/index.m3u8?${acct}`,
          `#EXTINF:-1 tvg-id="sports.test" group-title="Sports",Test Sports`,
          `${base}/live/sports?${acct}`,
          `#EXTINF:-1 tvg-name="Raw TS" group-title="Sports",Test Raw TS`,
          `${base}/live/raw.ts?${acct}`,
          `#EXTINF:-1 group-title="News",Dead Channel`,
          `${base}/live/dead?${acct}`,
        ].join('\n'));
      }
      if (u.searchParams.get('password') !== IPTV_PASS && /\/live\//.test(p)) return send(res, 401, 'text/plain', 'bad account');
      if (p === '/iptv/live/news/index.m3u8') return hls(res);
      if (p === '/iptv/live/sports') return hls(res, 'application/octet-stream'); // HLS with no .m3u8 and a useless type
      if (p === '/iptv/live/raw.ts') return file(req, res, 'test.ts', 'video/mp2t');
      if (p === '/iptv/logo.png') return send(res, 200, 'image/png', PNG);
      if (p === '/iptv/epg.xml') {
        const from = new Date(now.getTime() - 30 * 60000), to = new Date(now.getTime() + 60 * 60000);
        return send(res, 200, 'application/xml', `<?xml version="1.0"?><tv>
          <channel id="news.test"><display-name>Test News</display-name></channel>
          <programme channel="news.test" stop="${xmltv(to)}" start="${xmltv(from)}"><title lang="en">Evening News &amp; Weather</title><desc>Today</desc></programme>
        </tv>`);
      }
    }

    if (p === '/oembed') return json(res, { title: 'Conformance Video', author_name: 'Harness', thumbnail_url: 'https://i.ytimg.com/vi/x/hq.jpg' });
    send(res, 404, 'text/plain', 'not faked');
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}`;
    resolve({ url, hits, close: () => server.close() });
  }));
}

// ---------- server checks ----------

async function live({ check, http: api, sock, once, admin, alice, bob, sa, sb, voice, fake, restart, base }) {
  const vc = voice._id;
  const noSecret = (obj) => {
    const s = JSON.stringify(obj);
    const leaked = [...Object.values(KEYS), IPTV_PASS, fake.url].filter((k) => s.includes(k));
    return leaked.length ? `leaks ${leaked.join(', ')}` : true;
  };
  const get = (url, headers) => fetch(url.startsWith('/') ? base + url : url, { headers });

  // carol is logged in but not in the voice channel.
  const c = await api('POST', '/api/auth/register', null, { username: 'carol', email: 'carol@example.com', password: 'password1' });
  const carol = { token: c.json?.token };

  await check('bots/stream proxy refuses links the server did not issue (no open proxy)', async () => {
    const a = await get(`/api/stream/proxy?url=${encodeURIComponent(fake.url + '/iptv/logo.png')}`);
    const b = await get('/api/stream/proxy?u=AAAAforgedAAAA');
    return (a.status === 403 && b.status === 403) || `plain url:${a.status} forged:${b.status}`;
  });

  for (const type of ['plex', 'jellyfin', 'emby']) {
    const B = `/api/admin/${type}-bot`;
    const cred = type === 'plex' ? 'token' : 'apiKey';
    const serverUrl = `${fake.url}/${type}`;
    const ids = type === 'plex' ? { video: '101', audio: '103', mkv: '102' } : { video: 'm1', audio: 'a1' };

    await check(`bots/${type}: only admins can connect a server`, async () => {
      const r = await api('POST', `${B}/connect`, alice.token, { serverUrl, [cred]: KEYS[type] });
      return r.status === 403 || `non-admin got ${r.status}`;
    });
    await check(`bots/${type}: a wrong key is refused with a readable error`, async () => {
      const r = await api('POST', `${B}/connect`, admin, { serverUrl, [cred]: 'wrong' });
      const st = await api('GET', `${B}/status`, admin);
      return (r.status === 400 && /401/.test(r.json?.error) && !st.json?.connected) || { status: r.status, error: r.json?.error, connected: st.json?.connected };
    });
    await check(`bots/${type}: admin connects and turns it on`, async () => {
      const r = await api('POST', `${B}/connect`, admin, { serverUrl, [cred]: KEYS[type] });
      const e = await api('POST', `${B}/enable`, admin, { enabled: true });
      return (r.json?.connected && r.json.serverInfo?.name === `Fake ${type === 'plex' ? 'Plex' : type}` && e.json?.enabled) || { connect: r.json, enable: e.json };
    });
    await check(`bots/${type}: any user sees the status, with no key in it`, async () => {
      const r = await api('GET', `${B}/status`, alice.token);
      return (r.status === 200 && r.json.connected && r.json.enabled && noSecret(r.json) === true) || noSecret(r.json) || r;
    });
    let results = [];
    await check(`bots/${type}: any user can search; results and thumbnails carry no key`, async () => {
      const r = await api('GET', `${B}/search?query=test`, alice.token);
      results = r.json?.results || [];
      const withThumb = results.find((x) => x.thumb);
      const img = withThumb && await get(withThumb.thumb);
      const ok = results.some((x) => x.id === ids.video && x.kind === 'video') && results.some((x) => x.id === ids.audio && x.kind === 'audio');
      return (ok && img?.status === 200 && img.headers.get('content-type') === 'image/png' && noSecret(results) === true) ||
        { results: results.map((x) => `${x.id}:${x.kind}`), thumb: img?.status, secret: noSecret(results) };
    });
    await check(`bots/${type}: someone not in the voice channel cannot play into it`, async () => {
      const r = await api('POST', `${B}/play`, carol.token, { channelId: vc, itemId: ids.video });
      return r.status === 403 || `got ${r.status}`;
    });
    let playing;
    await check(`bots/${type}: playing a movie tells everyone in voice what to play`, async () => {
      const got = once(sb, 'media:playing', 8000);
      const r = await api('POST', `${B}/play`, alice.token, { channelId: vc, itemId: ids.video });
      playing = await got;
      const want = type === 'plex' ? 'file' : 'hls';
      return (r.status === 200 && playing.format === want && playing.kind === 'video' && playing.streamUrl.startsWith('/api/stream/proxy?u=') && noSecret(playing) === true) ||
        { status: r.status, error: r.json?.error, format: playing?.format, secret: noSecret(playing) };
    });
    if (type === 'plex') {
      await check('bots/plex: an mp4 streams through the proxy with byte ranges (seeking)', async () => {
        const r = await get(playing.streamUrl, { Range: 'bytes=0-99' });
        const body = Buffer.from(await r.arrayBuffer());
        return (r.status === 206 && body.length === 100 && /^bytes 0-99\//.test(r.headers.get('content-range')) && body.toString('latin1', 4, 8) === 'ftyp') ||
          { status: r.status, len: body.length, range: r.headers.get('content-range') };
      });
      await check('bots/plex: a file browsers cannot play (mkv) is transcoded to HLS', async () => {
        const got = once(sb, 'media:playing', 8000);
        await api('POST', `${B}/play`, alice.token, { channelId: vc, itemId: ids.mkv });
        const m = await got;
        const manifest = await (await get(m.streamUrl)).text();
        return (m.format === 'hls' && manifest.includes('#EXTM3U')) || { format: m.format, manifest: manifest.slice(0, 80) };
      });
    } else {
      await check(`bots/${type}: the HLS playlist and its segments come through the proxy`, async () => {
        const manifest = await (await get(playing.streamUrl)).text();
        const segs = manifest.split('\n').filter((l) => l && !l.startsWith('#'));
        const s0 = segs[0] && await get(segs[0]);
        const bytes = s0 && Buffer.from(await s0.arrayBuffer());
        return (segs.length === 2 && segs.every((l) => l.startsWith('/api/stream/proxy?u=')) && bytes?.[0] === 0x47 && !manifest.includes(KEYS[type])) ||
          { segs, first: s0?.status };
      });
    }
    await check(`bots/${type}: music plays as audio`, async () => {
      const got = once(sb, 'media:playing', 8000);
      await api('POST', `${B}/play`, alice.token, { channelId: vc, itemId: ids.audio });
      const m = await got;
      const r = await get(m.streamUrl, { Range: 'bytes=0-15' });
      return (m.kind === 'audio' && m.format === 'file' && /audio\/mpeg/.test(r.headers.get('content-type'))) || { kind: m.kind, format: m.format, type: r.headers.get('content-type') };
    });
    await check(`bots/${type}: someone joining voice later sees what is playing`, async () => {
      const late = await sock(admin);
      const got = once(late, 'media:playing', 5000);
      late.emit('voice:join', vc);
      const m = await got.catch((e) => e.message);
      late.emit('voice:leave'); late.close();
      return m?.source === (type === 'plex' ? 'Plex' : type[0].toUpperCase() + type.slice(1)) || m;
    });
    await check(`bots/${type}: stop ends it for everyone`, async () => {
      const got = once(sb, 'media:stopped', 5000);
      const r = await api('POST', `${B}/stop`, alice.token, { channelId: vc });
      const m = await got;
      return (r.json?.stopped && m.channelId === vc) || { r: r.json, m };
    });
  }

  // ---------- IPTV ----------
  const T = '/api/admin/iptv-bot';
  let channels = [];
  await check('bots/iptv: admin loads a playlist and guide from URLs', async () => {
    const form = new FormData();
    form.append('playlistUrl', `${fake.url}/iptv/playlist.m3u`);
    form.append('epgUrl', `${fake.url}/iptv/epg.xml`);
    const r = await (await fetch(`${base}${T}/configure`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form })).json();
    await api('POST', `${T}/enable`, admin, { enabled: true });
    return (r.channelCount === 4 && r.hasEPG && !r.epgError) || r;
  });
  await check('bots/iptv: channel list for users has groups, logos and the guide, but no stream URLs or account', async () => {
    const r = await api('GET', `${T}/channels`, alice.token);
    channels = r.json?.channels || [];
    const g = await api('GET', `${T}/groups`, alice.token);
    const news = channels.find((c) => c.name === 'Test News HD');
    const logo = news?.logo && await get(news.logo);
    return (channels.length === 4 && g.json?.groups?.length === 2 && news?.now === 'Evening News & Weather' && logo?.status === 200 && noSecret(channels) === true && !JSON.stringify(channels).includes('/live/')) ||
      { n: channels.length, groups: g.json?.groups, now: news?.now, logo: logo?.status, secret: noSecret(channels) };
  });
  const tune = async (name) => {
    const ch = channels.find((c) => c.name === name);
    const got = once(sb, 'iptv:playing', 8000);
    got.catch(() => {}); // a refused play never emits
    const r = await api('POST', `${T}/play`, alice.token, { voiceChannelId: vc, iptvChannelId: ch?.id });
    if (r.status !== 200) return { error: r.json?.error, status: r.status };
    return got;
  };
  await check('bots/iptv: an HLS channel plays as HLS, with the program from the guide', async () => {
    const m = await tune('Test News HD');
    const manifest = m.streamUrl && await (await get(m.streamUrl)).text();
    return (m.format === 'hls' && m.currentProgram?.title === 'Evening News & Weather' && manifest?.includes('/api/stream/proxy?u=') && noSecret(m) === true) || m;
  });
  await check('bots/iptv: HLS without .m3u8 in its URL is still detected as HLS', async () => {
    const m = await tune('Test Sports');
    return m.format === 'hls' || m;
  });
  await check('bots/iptv: a raw MPEG-TS channel plays as TS', async () => {
    const m = await tune('Test Raw TS');
    const r = m.streamUrl && await get(m.streamUrl, { Range: 'bytes=0-187' });
    const b = r && Buffer.from(await r.arrayBuffer());
    return (m.format === 'ts' && b?.[0] === 0x47) || { format: m.format, first: b?.[0] };
  });
  await check('bots/iptv: a dead channel gives a clear error instead of a black tile', async () => {
    const m = await tune('Dead Channel');
    return (m.status === 400 && /not reachable/.test(m.error)) || m;
  });
  await check('bots/iptv: someone not in the voice channel cannot stop it', async () => {
    const r = await api('POST', `${T}/stop`, carol.token, { voiceChannelId: vc });
    return r.status === 403 || `got ${r.status}`;
  });
  await check('bots/iptv: an uploaded .m3u playlist works too', async () => {
    const form = new FormData();
    form.append('playlist', new Blob([`#EXTM3U\n#EXTINF:-1 group-title="Up",Uploaded One\n${fake.url}/iptv/live/raw.ts?username=tester&password=${IPTV_PASS}\n`]), 'list.m3u');
    const r = await (await fetch(`${base}${T}/configure`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form })).json();
    // put the URL playlist back for the UI checks
    const back = new FormData();
    back.append('playlistUrl', `${fake.url}/iptv/playlist.m3u`);
    back.append('epgUrl', `${fake.url}/iptv/epg.xml`);
    await fetch(`${base}${T}/configure`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: back });
    return r.channelCount === 1 || r;
  });
  await check('bots/iptv: stop ends it for everyone', async () => {
    const got = once(sb, 'iptv:stopped', 5000);
    await api('POST', `${T}/stop`, alice.token, { voiceChannelId: vc });
    return (await got).channelId === vc;
  });

  // ---------- YouTube ----------
  const Y = '/api/admin/youtube-bot';
  await check('youtube/admin turns it on; users see it is on', async () => {
    await api('POST', `${Y}/enable`, admin, { enabled: true });
    const r = await api('GET', `${Y}/status`, alice.token);
    return r.json?.enabled === true || r;
  });
  await check('youtube/a link that is not YouTube is refused', async () => {
    const r = await api('POST', `${Y}/play`, alice.token, { channelId: vc, url: 'https://evil.example/watch?v=dQw4w9WgXcQ' });
    return r.status === 400 || r;
  });
  await check('youtube/a short link plays for everyone with the title from YouTube', async () => {
    const got = once(sb, 'youtube:playing', 8000);
    await api('POST', `${Y}/play`, alice.token, { channelId: vc, url: `https://youtu.be/${VIDEO_ID}?t=4` });
    const m = await got;
    return (m.videoId === VIDEO_ID && m.title === 'Conformance Video') || m;
  });
  await check('youtube/someone joining voice later sees the video', async () => {
    const late = await sock(admin);
    const got = once(late, 'youtube:playing', 5000);
    late.emit('voice:join', vc);
    const m = await got.catch((e) => e.message);
    late.emit('voice:leave'); late.close();
    return m?.videoId === VIDEO_ID || m;
  });
  await check('youtube/stop ends it for everyone', async () => {
    const got = once(sb, 'youtube:stopped', 5000);
    await api('POST', `${Y}/stop`, alice.token, { channelId: vc });
    return (await got).channelId === vc;
  });

  // ---------- settings survive a restart ----------
  await api('POST', '/api/admin/emby-bot/disconnect', admin);
  await check('bots/settings survive a server restart (and a disconnect stays disconnected)', async () => {
    if (!(await restart())) return 'server did not come back';
    const st = {};
    for (const t of ['plex', 'jellyfin', 'emby', 'iptv', 'youtube']) st[t] = (await api('GET', `/api/admin/${t}-bot/status`, admin)).json;
    const ok = st.plex?.connected && st.plex.enabled && st.jellyfin?.connected && st.emby && !st.emby.configured &&
      st.iptv?.channelCount === 4 && st.iptv.enabled && st.iptv.hasEPG && st.youtube?.enabled;
    return ok || JSON.stringify({ plex: st.plex?.connected, jellyfin: st.jellyfin?.connected, emby: st.emby?.configured, iptv: st.iptv?.channelCount, epg: st.iptv?.hasEPG, yt: st.youtube?.enabled });
  });
  // emby back on for the UI checks
  await api('POST', '/api/admin/emby-bot/connect', admin, { serverUrl: `${fake.url}/emby`, apiKey: KEYS.emby });
}

// ---------- UI checks: the real dialogs, real playback in both users' browsers ----------
// host = admin's tab, guest = alice's tab (not an admin); both in the same voice channel.
async function ui({ check, host, guest, shot, sleep }) {
  const sleepy = (ms) => sleep(ms);
  // A bot tile on both screens whose <video> is really decoding (time moving, frames for video).
  const playingOn = (pg, tile, needFrames) => pg.waitFor(`(() => { const v = document.querySelector('#bot-video-tile-${tile} video');
    return !!v && v.currentTime > 0.3 && !v.error${needFrames ? ' && v.videoWidth > 0' : ''}; })()`, 15000);
  const why = async (pg, tile) => pg.evaluate(`(() => { const v = document.querySelector('#bot-video-tile-${tile} video');
    return v ? 't=' + v.currentTime.toFixed(2) + ' w=' + v.videoWidth + ' err=' + (v.error && v.error.code) + ' src=' + (v.currentSrc || '').slice(0, 60) : 'no tile'; })()`);
  const click = (pg, sel) => pg.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.click(); return true; })()`);
  const submit = (pg, form, input, value) => pg.evaluate(`(() => { document.getElementById(${JSON.stringify(input)}).value = ${JSON.stringify(value)};
    document.getElementById(${JSON.stringify(form)}).dispatchEvent(new Event('submit', { cancelable: true })); })()`);

  const media = [
    { type: 'plex', name: 'Plex', tile: 'media-Plex', item: '101', frames: true, what: 'movie (mp4, direct)' },
    { type: 'jellyfin', name: 'Jellyfin', tile: 'media-Jellyfin', item: 'm1', frames: true, what: 'movie (HLS through hls.js)' },
    { type: 'emby', name: 'Emby', tile: 'media-Emby', item: 'a1', frames: false, what: 'music (mp3)' },
  ];
  for (const m of media) {
    await check(`ui/bots: a non-admin searches ${m.name} in its dialog and plays a ${m.what}; it plays for both users`, async () => {
      await guest.evaluate(`mediaBots.open('${m.type}')`);
      if (!(await guest.waitFor(`!!document.getElementById('mbQuery')`))) return `no search box: ${await guest.evaluate(`document.getElementById('mbBody')?.innerText`)}`;
      await guest.evaluate(`(() => { mbQuery.value = 'test'; document.querySelector('#mbBody form').dispatchEvent(new Event('submit', { cancelable: true })); })()`);
      if (!(await guest.waitFor(`!!document.querySelector('.mb-item[data-id="${m.item}"]')`))) return `no result: ${await guest.evaluate(`mbResults.innerText`)}`;
      if (m.type === 'plex') {
        const thumbs = await guest.waitFor(`[...document.querySelectorAll('.mb-item img')].some((i) => i.complete && i.naturalWidth > 0)`);
        if (!thumbs) return 'search thumbnails did not load';
        await shot('desktop-bots.png', guest);
      }
      await click(guest, `.mb-item[data-id="${m.item}"] [data-play]`);
      const a = await playingOn(guest, m.tile, m.frames);
      const b = await playingOn(host, m.tile, m.frames);
      return (a && b) || `guest: ${await why(guest, m.tile)} | host: ${await why(host, m.tile)}`;
    });
    if (m.type === 'plex') {
      await host.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await host.evaluate(`document.getElementById('toastContainer').replaceChildren()`);
      await sleepy(400);
      await shot('desktop-bots-playing.png', host);
    }
    await check(`ui/bots: stopping ${m.name} from the dialog removes it for both users`, async () => {
      await guest.evaluate(`mediaBots.open('${m.type}')`);
      await guest.waitFor(`!!document.querySelector('#mbBody [data-act="stop"]')`);
      await click(guest, '#mbBody [data-act="stop"]');
      const gone = (pg) => pg.waitFor(`!document.getElementById('bot-video-tile-${m.tile}')`);
      return ((await gone(guest)) && (await gone(host))) || 'tile still there';
    });
  }

  for (const [label, name, tile] of [['raw MPEG-TS (mpegts.js)', 'Test Raw TS', 'iptv'], ['HLS (hls.js)', 'Test News HD', 'iptv']]) {
    await check(`ui/bots: IPTV ${label} channel picked in the dialog plays for both users`, async () => {
      await guest.evaluate('iptv.open()');
      if (!(await guest.waitFor(`!!document.querySelector('#tvChannels .mb-item')`))) return `no channel list: ${await guest.evaluate(`tvBody.innerText`)}`;
      await guest.evaluate(`[...document.querySelectorAll('#tvChannels .mb-item')].find((e) => e.innerText.includes(${JSON.stringify(name)})).querySelector('[data-play]').click()`);
      const a = await playingOn(guest, tile, true);
      const b = await playingOn(host, tile, true);
      return (a && b) || `guest: ${await why(guest, tile)} | host: ${await why(host, tile)}`;
    });
  }
  await check('ui/bots: IPTV stop from the dialog removes it for both users', async () => {
    await guest.evaluate('iptv.open()');
    await guest.waitFor(`!!document.querySelector('#tvBody [data-act="stop"]')`);
    await click(guest, '#tvBody [data-act="stop"]');
    return ((await guest.waitFor(`!document.getElementById('bot-video-tile-iptv')`)) && (await host.waitFor(`!document.getElementById('bot-video-tile-iptv')`))) || 'tile still there';
  });

  await check('ui/bots: a YouTube link pasted in the dialog opens the same video for both users', async () => {
    await guest.evaluate('youtube.open()');
    if (!(await guest.waitFor(`!!document.getElementById('ytForm')`))) return `no form: ${await guest.evaluate(`ytBody.innerText`)}`;
    await submit(guest, 'ytForm', 'ytUrl', `https://www.youtube.com/shorts/${VIDEO_ID}`);
    const sel = `document.querySelector('#bot-video-tile-youtube iframe')?.src.includes('youtube.com/embed/${VIDEO_ID}')`;
    const ok = (await guest.waitFor(sel)) && (await host.waitFor(sel));
    await guest.evaluate('youtube.open()');
    await guest.waitFor(`!!document.querySelector('#ytBody [data-act="stop"]')`);
    await click(guest, '#ytBody [data-act="stop"]');
    const gone = await host.waitFor(`!document.getElementById('bot-video-tile-youtube')`);
    return (ok && gone) || { embedded: ok, stopped: gone };
  });
  await guest.evaluate('closeModal()');
}

module.exports = { startFakeMedia, live, ui, KEYS, VIDEO_ID };
