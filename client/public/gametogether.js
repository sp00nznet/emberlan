/**
 * Game Together: play a local-multiplayer game with people in your voice channel.
 *
 * The host runs the game on Windows in the desktop app and shares their screen. Each guest
 * gets a full-screen play view of that share with their controller (or the on-screen touch
 * pad, touchpad.js) driving a virtual Xbox pad on the host's PC:
 *
 *   guest pad -> WebRTC data channel (voice-rtc.js) -> host app -> electronAPI.gamepad -> ViGEmBus
 *
 * The server (server/services/gameTogetherService.js) only hands out player slots.
 * Uses app.js globals: state, showToast, closeModal, escapeHtml, toggleScreenShare.
 */
(() => {
  const SEND_MS = 16; // ~60 Hz while input changes
  const KEEPALIVE_MS = 250; // resend unchanged state so a lost packet can't leave a button stuck
  let session = null; // the session in my voice channel, as the server describes it
  let loop = null;
  let lastSent = '', lastSentAt = 0;
  let padIndex = null;

  const api = (method, url, body) => fetch(`${state.serverUrl}/api/admin/game-together/${url}`, {
    method,
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    return j;
  });

  const myId = () => String(state.user?._id || state.user?.id);
  const channelId = () => state.voiceChannel?._id;
  const amHost = () => session && String(session.hostUserId) === myId();
  const mySlot = () => session?.players.find((p) => String(p.userId) === myId())?.playerSlot;
  const slotOf = (userId) => session?.players.find((p) => String(p.userId) === String(userId))?.playerSlot;
  const pads = () => window.electronAPI?.gamepad;

  // ---------- reading the local controller ----------

  // First connected physical pad (USB/Bluetooth) in Xbox layout, or null.
  function physicalPad() {
    const list = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    const gp = list[padIndex] || list.find(Boolean);
    if (!gp) return null;
    padIndex = gp.index;
    const b = (i) => !!gp.buttons[i]?.pressed;
    return {
      buttons: {
        A: b(0), B: b(1), X: b(2), Y: b(3), LB: b(4), RB: b(5), BACK: b(8), START: b(9), LS: b(10), RS: b(11),
        DPAD_UP: b(12), DPAD_DOWN: b(13), DPAD_LEFT: b(14), DPAD_RIGHT: b(15), GUIDE: b(16),
      },
      axes: {
        LEFT_X: gp.axes[0] || 0, LEFT_Y: gp.axes[1] || 0, RIGHT_X: gp.axes[2] || 0, RIGHT_Y: gp.axes[3] || 0,
        LT: gp.buttons[6]?.value || 0, RT: gp.buttons[7]?.value || 0,
      },
    };
  }

  function tick() {
    if (!session) return;
    const input = physicalPad() || window.touchPad?.read();
    renderStatus();
    if (!input) return;
    const msg = JSON.stringify(input);
    const now = Date.now();
    if (msg === lastSent && now - lastSentAt < KEEPALIVE_MS) return;
    if (window.rtc.send(session.hostUserId, msg)) { lastSent = msg; lastSentAt = now; }
  }

  // ---------- guest: the play view ----------

  function openPlayView() {
    let view = document.getElementById('gtPlay');
    if (!view) {
      view = document.createElement('div');
      view.id = 'gtPlay';
      view.className = 'gt-play';
      view.innerHTML = `
        <video class="gt-screen" autoplay playsinline muted></video>
        <div class="gt-wait">Waiting for the host to share their screen…</div>
        <div class="gt-bar">
          <span class="gt-title"></span>
          <span class="gt-status"></span>
          <button class="gt-btn" data-act="leave">Leave game</button>
        </div>`;
      view.querySelector('[data-act="leave"]').onclick = () => leave();
      document.body.appendChild(view);
    }
    document.body.classList.add('gt-playing');
    document.getElementById('toastContainer')?.replaceChildren(); // nothing on top of the game at the start
    view.querySelector('.gt-title').textContent = `${session.hostUsername}'s game · you are Player ${mySlot()}`;
    window.touchPad?.start();
    if (!loop) loop = setInterval(() => { attachScreen(); tick(); }, SEND_MS);
  }

  // The host's screen share arrives over the voice call; show it once it does.
  function attachScreen() {
    const view = document.getElementById('gtPlay');
    if (!view || !session) return;
    const video = view.querySelector('.gt-screen');
    const stream = window.rtc.remoteVideo(session.hostUserId);
    if (video.srcObject !== stream) video.srcObject = stream;
    view.classList.toggle('gt-has-video', !!stream);
  }

  function renderStatus() {
    const el = document.querySelector('#gtPlay .gt-status');
    if (!el) return;
    const text = physicalPad() ? '🎮 Controller' : window.touchPad?.visible ? '👆 Touch pad' : 'Connect a controller to play';
    if (el.textContent !== text) el.textContent = text;
  }

  function closePlayView() {
    clearInterval(loop);
    loop = null;
    lastSent = '';
    window.touchPad?.stop();
    document.getElementById('gtPlay')?.remove();
    document.body.classList.remove('gt-playing');
  }

  // ---------- host: guest input -> virtual pads ----------

  function onData(fromUserId, data) {
    if (!amHost()) return;
    const slot = slotOf(fromUserId);
    if (!slot || slot === 1) return; // only seated guests drive a pad
    try { pads()?.set(slot, JSON.parse(data)); } catch {}
  }

  // ---------- session lifecycle ----------

  function setSession(s) {
    const wasHost = amHost();
    session = s && String(s.channelId) === String(channelId()) ? s : null;
    if (wasHost && !amHost()) pads()?.clear();
    const playing = session && !amHost() && mySlot();
    if (playing) openPlayView(); else closePlayView();
    renderModal();
  }

  async function host() {
    const st = await pads()?.status();
    if (!st?.available) return showToast(st?.error || 'Hosting needs the Emberlan desktop app on Windows', 'error');
    try {
      setSession(await api('POST', 'start', { channelId: channelId() }));
      if (!state.isScreenSharing) {
        showToast('Share the game window so your players can see it', 'info');
        toggleScreenShare();
      }
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function join() {
    try {
      const r = await api('POST', 'join', { channelId: channelId() });
      setSession(r.session); // the play view's top bar says which player you are
      closeModal();
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function leave() {
    const id = channelId();
    try { if (id && session) await api('POST', amHost() ? 'stop' : 'leave', { channelId: id }); } catch {}
    setSession(null);
  }

  async function refresh() {
    if (!channelId()) return setSession(null);
    try { setSession((await api('GET', `session/${channelId()}`)).session); } catch {}
  }

  // ---------- the Game Together dialog ----------

  function renderModal() {
    const body = document.getElementById('gtModalBody');
    if (!body) return;
    const players = (session?.players || []).slice().sort((a, b) => a.playerSlot - b.playerSlot);
    const seats = [1, 2, 3, 4].map((n) => {
      const p = players.find((x) => x.playerSlot === n);
      return `<li class="gt-seat ${p ? 'taken' : ''}"><b>P${n}</b> ${p ? escapeHtml(p.username) + (n === 1 ? ' (host)' : '') : '<i>open</i>'}</li>`;
    }).join('');
    let actions;
    if (!session) {
      actions = `<p class="gt-hint">Start a game on this PC, then host: up to three people in this voice channel
        join as Players 2–4 with their controller or phone. Works with any game that supports local
        multiplayer with Xbox controllers.</p>
        <button class="btn-primary" data-act="host">Host a game</button>`;
    } else if (amHost()) {
      actions = `<p class="gt-hint">You are Player 1. Keep sharing the game window; guests' controllers appear on
        this PC as Xbox controllers.</p><button class="btn-danger" data-act="leave">End session</button>`;
    } else if (mySlot()) {
      actions = `<button class="btn-primary" data-act="play">Back to the game</button>
        <button class="btn-secondary" data-act="leave">Leave game</button>`;
    } else {
      actions = `<button class="btn-primary" data-act="join">Join as a player</button>`;
    }
    body.innerHTML = `${session ? `<p><b>${escapeHtml(session.hostUsername)}</b> is hosting.</p>` : ''}
      <ul class="gt-seats">${seats}</ul><div class="gt-actions">${actions}</div>`;
    body.querySelectorAll('[data-act]').forEach((b) => {
      b.onclick = { host, join, leave, play: () => { closeModal(); openPlayView(); } }[b.dataset.act];
    });
  }

  function open() {
    if (!state.inVoice) return showToast('Join a voice channel first', 'error');
    const modal = document.getElementById('modalContent');
    modal.innerHTML = `
      <div class="modal-header"><h2>🎮 Game Together</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
      <div class="modal-body" id="gtModalBody"></div>`;
    document.getElementById('modalOverlay').classList.add('active');
    renderModal();
    refresh();
  }

  window.gameTogether = {
    open, host, join, leave, refresh,
    get session() { return session; },
    get slot() { return mySlot(); },

    /** Hook up once per socket (app.js connectSocket). */
    attach(socket) {
      window.rtc.onData = onData;
      socket.on('gameTogether:session-started', (s) => {
        if (String(s.channelId) !== String(channelId())) return;
        setSession(s);
        if (!amHost()) showToast(`🎮 ${s.hostUsername} is hosting Game Together — open 🎮 in the voice panel to join`, 'success');
      });
      socket.on('gameTogether:session-stopped', ({ channelId: id }) => {
        if (!session || String(id) !== String(session.channelId)) return;
        if (!amHost()) showToast('The game session ended', 'info');
        setSession(null);
      });
      socket.on('gameTogether:player-joined', (p) => {
        if (!session || String(p.channelId) !== String(session.channelId)) return;
        session.players = session.players.filter((x) => String(x.userId) !== String(p.userId)).concat(p);
        if (amHost()) showToast(`${p.username} joined as Player ${p.playerSlot}`, 'success');
        renderModal();
      });
      socket.on('gameTogether:player-left', (p) => {
        if (!session || String(p.channelId) !== String(session.channelId)) return;
        session.players = session.players.filter((x) => String(x.userId) !== String(p.userId));
        if (amHost()) pads()?.remove(p.playerSlot);
        if (String(p.userId) === myId()) setSession(null); else renderModal();
      });
    },
  };
})();
