/**
 * YouTube dialog (server: services/youtubeBotService.js). Admins turn it on; anyone in a voice
 * channel pastes a link and everyone there watches it in the YouTube player.
 * Uses app.js globals: state, showToast, escapeHtml.
 */
(() => {
  let status = null;

  const call = (method, path, body) => fetch(`${state.serverUrl}/api/admin/youtube-bot/${path}`, {
    method,
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  });
  const isAdmin = () => ['admin', 'superadmin'].includes(state.user?.role);
  const body = () => document.getElementById('ytBody');
  const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { showToast(e.message, 'error'); } };

  async function refresh() {
    try { status = await call('GET', 'status'); } catch (e) { body().innerHTML = `<p class="mb-err">${escapeHtml(e.message)}</p>`; return; }
    const mine = status.activeStreams.find((x) => String(x.channelId) === String(state.voiceChannel?._id));
    const admin = isAdmin() ? `<section class="mb-section"><div class="mb-row"><span>YouTube is ${status.enabled ? 'on' : 'off'}</span>
      <button class="btn-${status.enabled ? 'secondary' : 'primary'}" data-act="toggle">${status.enabled ? 'Turn off' : 'Turn on'}</button></div></section>` : '';
    let play;
    if (!status.enabled) play = `<p class="mb-hint">${isAdmin() ? 'Turn YouTube on to watch videos together.' : "An admin hasn't turned YouTube on yet."}</p>`;
    else if (!state.inVoice) play = '<p class="mb-hint">Join a voice channel to watch something in it.</p>';
    else play = `
      ${mine ? `<div class="mb-row mb-now"><span>▶ ${escapeHtml(mine.title)}</span><button class="btn-danger" data-act="stop">Stop</button></div>` : ''}
      <form class="mb-search" id="ytForm"><input id="ytUrl" placeholder="Paste a YouTube link" autocomplete="off"><button class="btn-primary">Play</button></form>`;
    body().innerHTML = admin + `<section class="mb-section">${play}</section>`;
    body().querySelectorAll('[data-act]').forEach((el) => { el.onclick = actions[el.dataset.act]; });
    const form = document.getElementById('ytForm');
    if (form) form.onsubmit = (e) => { e.preventDefault(); actions.play(); };
  }

  const actions = {
    toggle: run(async () => { await call('POST', 'enable', { enabled: !status.enabled }); await refresh(); }),
    stop: run(async () => { await call('POST', 'stop', { channelId: state.voiceChannel._id }); await refresh(); }),
    play: run(async () => {
      const r = await call('POST', 'play', { channelId: state.voiceChannel._id, url: document.getElementById('ytUrl').value.trim() });
      showToast(`Playing ${r.title}`, 'success');
      await refresh();
    }),
  };

  window.youtube = {
    open() {
      document.getElementById('modalContent').innerHTML = `
        <div class="modal-header"><h2>YouTube</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div class="modal-body" id="ytBody">Loading…</div>`;
      document.getElementById('modalOverlay').classList.add('active');
      refresh();
    },
  };
})();
