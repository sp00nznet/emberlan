/**
 * IPTV dialog (server: services/iptvBotService.js). Admins add a playlist (upload or URL) and an
 * optional guide; everyone in a voice channel can browse channels by group and play one into it.
 * Uses app.js globals: state, showToast, escapeHtml.
 */
(() => {
  let status = null;
  let group = '';

  const call = (method, path, body, isForm) => fetch(`${state.serverUrl}/api/admin/iptv-bot/${path}`, {
    method,
    headers: { Authorization: `Bearer ${state.token}`, ...(isForm ? {} : { 'Content-Type': 'application/json' }) },
    body: isForm ? body : body && JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  });
  const isAdmin = () => ['admin', 'superadmin'].includes(state.user?.role);
  const abs = (u) => (u && u.startsWith('/api/') ? `${state.serverUrl}${u}` : u);
  const body = () => document.getElementById('tvBody');
  const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { showToast(e.message, 'error'); } };

  async function refresh() {
    try { status = await call('GET', 'status'); } catch (e) { body().innerHTML = `<p class="mb-err">${escapeHtml(e.message)}</p>`; return; }
    await render();
  }

  async function render() {
    const s = status;
    const mine = s.activeStreams.find((x) => String(x.channelId) === String(state.voiceChannel?._id));
    const admin = isAdmin() ? `
      <section class="mb-section">
        <div class="mb-row"><span>${s.configured ? `${s.channelCount} channels in ${s.groupCount} groups${s.hasEPG ? ', with guide' : ''}` : 'No playlist yet'}</span>
          <button class="btn-${s.enabled ? 'secondary' : 'primary'}" data-act="toggle">${s.enabled ? 'Turn off' : 'Turn on'}</button></div>
        <details ${s.configured ? '' : 'open'}><summary class="mb-hint">${s.configured ? 'Replace playlist' : 'Add a playlist'}</summary>
          <div class="mb-form">
            <input id="tvUrl" placeholder="Playlist URL (http://provider/get.php?...)">
            <label class="mb-hint">or upload an .m3u file <input id="tvFile" type="file" accept=".m3u,.m3u8"></label>
            <input id="tvEpg" placeholder="Guide (XMLTV) URL, optional">
            <button class="btn-primary" data-act="configure">Load playlist</button>
          </div></details>
      </section>` : '';

    let play;
    if (!s.enabled || !s.configured) {
      play = `<p class="mb-hint">${isAdmin() ? 'Add a playlist and turn IPTV on to watch from it.' : "An admin hasn't set up IPTV yet."}</p>`;
    } else if (!state.inVoice) {
      play = '<p class="mb-hint">Join a voice channel to watch something in it.</p>';
    } else {
      const [{ groups }, { channels }] = await Promise.all([call('GET', 'groups'), call('GET', `channels${group ? `?group=${encodeURIComponent(group)}` : ''}`)]);
      play = `
        ${mine ? `<div class="mb-row mb-now"><span>📺 ${escapeHtml(mine.channelName)}${mine.currentProgram ? ` · ${escapeHtml(mine.currentProgram.title)}` : ''}</span><button class="btn-danger" data-act="stop">Stop</button></div>` : ''}
        <div class="mb-search">
          <select id="tvGroup"><option value="">All groups</option>${groups.map((g) => `<option ${g.name === group ? 'selected' : ''} value="${escapeHtml(g.name)}">${escapeHtml(g.name)} (${g.count})</option>`).join('')}</select>
          <input id="tvFilter" placeholder="Filter channels…" autocomplete="off">
        </div>
        <div id="tvChannels" class="mb-results">${channels.map((c) => `
          <div class="mb-item" data-name="${escapeHtml(c.name.toLowerCase())}">
            ${c.logo ? `<img src="${escapeHtml(abs(c.logo))}" alt="" loading="lazy">` : '<div class="mb-noimg">📺</div>'}
            <div class="mb-meta"><b>${escapeHtml(c.name)}</b><small>${escapeHtml(c.now || c.group)}</small></div>
            <button class="btn-primary" data-play="${escapeHtml(c.id)}">Watch</button>
          </div>`).join('')}</div>`;
    }
    body().innerHTML = admin + `<section class="mb-section">${play}</section>`;
    body().querySelectorAll('[data-act]').forEach((el) => { el.onclick = actions[el.dataset.act]; });
    body().querySelectorAll('[data-play]').forEach((b) => { b.onclick = () => actions.play(b.dataset.play); });
    const sel = document.getElementById('tvGroup');
    if (sel) sel.onchange = () => { group = sel.value; render(); };
    const filter = document.getElementById('tvFilter');
    if (filter) filter.oninput = () => {
      const q = filter.value.toLowerCase();
      document.querySelectorAll('#tvChannels .mb-item').forEach((el) => { el.style.display = el.dataset.name.includes(q) ? '' : 'none'; });
    };
  }

  const actions = {
    toggle: run(async () => { await call('POST', 'enable', { enabled: !status.enabled }); await refresh(); }),
    configure: run(async () => {
      const form = new FormData();
      const file = document.getElementById('tvFile').files[0];
      if (file) form.append('playlist', file);
      form.append('playlistUrl', document.getElementById('tvUrl').value.trim());
      form.append('epgUrl', document.getElementById('tvEpg').value.trim());
      const r = await call('POST', 'configure', form, true);
      showToast(`Loaded ${r.channelCount} channels${r.epgError ? ` (guide failed: ${r.epgError})` : ''}`, r.epgError ? 'warning' : 'success');
      await refresh();
    }),
    stop: run(async () => { await call('POST', 'stop', { voiceChannelId: state.voiceChannel._id }); await refresh(); }),
    play: run(async (id) => {
      showToast('Tuning in…', 'info');
      await call('POST', 'play', { voiceChannelId: state.voiceChannel._id, iptvChannelId: id });
      await refresh();
    }),
  };

  window.iptv = {
    open() {
      document.getElementById('modalContent').innerHTML = `
        <div class="modal-header"><h2>IPTV</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
        <div class="modal-body" id="tvBody">Loading…</div>`;
      document.getElementById('modalOverlay').classList.add('active');
      refresh();
    },
  };
})();
