/**
 * Plex, Jellyfin and Emby: one dialog (server: services/mediaServerBot.js).
 * Admins see the setup (turn on, connect, disconnect); everyone in a voice channel can search
 * and play into it. Uses app.js globals: state, showToast, escapeHtml.
 */
(() => {
  const BOTS = {
    plex: { name: 'Plex', key: 'token', keyLabel: 'Plex token (X-Plex-Token)', url: 'http://plex-server:32400' },
    jellyfin: { name: 'Jellyfin', key: 'apiKey', keyLabel: 'API key (Dashboard > API Keys)', url: 'http://jellyfin-server:8096' },
    emby: { name: 'Emby', key: 'apiKey', keyLabel: 'API key (Settings > API Keys)', url: 'http://emby-server:8096' },
  };
  let type = null;
  let status = null;

  const api = (method, path, body) => fetch(`${state.serverUrl}/api/admin/${type}-bot/${path}`, {
    method,
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  });
  const isAdmin = () => ['admin', 'superadmin'].includes(state.user?.role);
  const abs = (u) => (u && u.startsWith('/api/') ? `${state.serverUrl}${u}` : u);
  const body = () => document.getElementById('mbBody');

  async function refresh() {
    try { status = await api('GET', 'status'); } catch (e) { status = null; body().innerHTML = `<p class="mb-err">${escapeHtml(e.message)}</p>`; return; }
    render();
  }

  function render() {
    const b = BOTS[type];
    const s = status;
    const mine = s.activeStreams.find((x) => String(x.channelId) === String(state.voiceChannel?._id));
    const serverLine = s.connected
      ? `Connected to <b>${escapeHtml(s.serverInfo?.name || b.name)}</b>${s.serverInfo?.version ? ` (v${escapeHtml(s.serverInfo.version)})` : ''}`
      : s.configured ? `<span class="mb-err">Saved server is unreachable${s.lastError ? `: ${escapeHtml(s.lastError)}` : ''}</span>` : 'Not set up';

    const admin = isAdmin() ? `
      <section class="mb-section">
        <div class="mb-row">
          <span>${serverLine}</span>
          <button class="btn-${s.enabled ? 'secondary' : 'primary'}" data-act="toggle">${s.enabled ? 'Turn off' : 'Turn on'}</button>
        </div>
        ${s.connected || s.configured ? `<button class="btn-secondary" data-act="disconnect">Disconnect ${escapeHtml(s.serverUrl || '')}</button>` : ''}
        ${s.connected ? '' : `
          <div class="mb-form">
            <input id="mbUrl" placeholder="${b.url}" value="${escapeHtml(s.serverUrl || '')}">
            <input id="mbKey" type="password" placeholder="${b.keyLabel}">
            <button class="btn-primary" data-act="connect">Connect</button>
          </div>`}
      </section>` : '';

    let play;
    if (!s.enabled || !s.configured) {
      play = `<p class="mb-hint">${isAdmin() ? `Connect a server and turn ${b.name} on to play from it.` : `An admin hasn't set up ${b.name} yet.`}</p>`;
    } else if (!state.inVoice) {
      play = '<p class="mb-hint">Join a voice channel to play something in it.</p>';
    } else {
      play = `
        ${mine ? `<div class="mb-row mb-now"><span>▶ ${escapeHtml(mine.title)}</span><button class="btn-danger" data-act="stop">Stop</button></div>` : ''}
        <form class="mb-search" data-act="search"><input id="mbQuery" placeholder="Search ${b.name}…" autocomplete="off"><button class="btn-primary">Search</button></form>
        <div id="mbResults" class="mb-results"></div>`;
    }
    body().innerHTML = admin + `<section class="mb-section">${play}</section>`;
    body().querySelectorAll('[data-act]').forEach((el) => {
      const fn = actions[el.dataset.act];
      if (el.tagName === 'FORM') el.onsubmit = (e) => { e.preventDefault(); fn(); };
      else el.onclick = () => fn(el);
    });
  }

  const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { showToast(e.message, 'error'); } };
  const actions = {
    toggle: run(async () => { await api('POST', 'enable', { enabled: !status.enabled }); await refresh(); }),
    connect: run(async () => {
      const serverUrl = document.getElementById('mbUrl').value.trim();
      const key = document.getElementById('mbKey').value.trim();
      await api('POST', 'connect', { serverUrl, [BOTS[type].key]: key });
      showToast(`${BOTS[type].name} connected`, 'success');
      await refresh();
    }),
    disconnect: run(async () => { await api('POST', 'disconnect'); await refresh(); }),
    stop: run(async () => { await api('POST', 'stop', { channelId: state.voiceChannel._id }); await refresh(); }),
    search: run(async () => {
      const out = document.getElementById('mbResults');
      out.textContent = 'Searching…';
      const { results } = await api('GET', `search?query=${encodeURIComponent(document.getElementById('mbQuery').value.trim())}`);
      out.innerHTML = results.length ? results.map((r) => `
        <div class="mb-item" data-id="${escapeHtml(r.id)}">
          ${r.thumb ? `<img src="${escapeHtml(abs(r.thumb))}" alt="">` : `<div class="mb-noimg">${r.kind === 'audio' ? '♪' : '▶'}</div>`}
          <div class="mb-meta"><b>${escapeHtml(r.title)}</b>
            <small>${escapeHtml([r.show || r.artist, r.year, r.type].filter(Boolean).join(' · '))}</small></div>
          <button class="btn-primary" data-play="${escapeHtml(r.id)}">Play</button>
        </div>`).join('') : '<p class="mb-hint">No results.</p>';
      out.querySelectorAll('[data-play]').forEach((btn) => { btn.onclick = () => actions.play(btn.dataset.play); });
    }),
    play: run(async (itemId) => {
      const r = await api('POST', 'play', { channelId: state.voiceChannel._id, itemId });
      showToast(`Playing ${r.title}`, 'success');
      await refresh();
    }),
  };

  window.mediaBots = {
    open(t) {
      type = t;
      document.getElementById('modalContent').innerHTML = `
        <div class="modal-header"><h2>${BOTS[t].name}</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div class="modal-body" id="mbBody">Loading…</div>`;
      document.getElementById('modalOverlay').classList.add('active');
      refresh();
    },
  };
})();
