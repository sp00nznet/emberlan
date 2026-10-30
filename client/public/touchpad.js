/**
 * On-screen touch gamepad for Game Together (Android, and the web on a phone).
 *
 * Produces the same inputData shape as a physical pad (pollGameTogetherGamepad
 * in app.js), so the server can't tell the difference. The layout is the
 * player's: in Edit mode every control can be dragged, hidden, and the whole
 * pad resized and faded. Saved per device in localStorage.
 */
(() => {
  const KEY = 'emberlan-touchpad';
  // x/y are the control's center as % of the screen.
  const DEFAULTS = {
    scale: 1, opacity: 0.6,
    controls: {
      LSTICK: { x: 14, y: 72 }, RSTICK: { x: 70, y: 80 },
      DPAD: { x: 30, y: 85 },
      A: { x: 90, y: 72 }, B: { x: 96, y: 60 }, X: { x: 84, y: 60 }, Y: { x: 90, y: 48 },
      LB: { x: 8, y: 30 }, LT: { x: 8, y: 16 }, RB: { x: 92, y: 30 }, RT: { x: 92, y: 16 },
      BACK: { x: 42, y: 24 }, START: { x: 58, y: 24 },
    },
  };
  const BUTTONS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'BACK', 'START'];
  const DPAD = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s) return { ...DEFAULTS, ...s, controls: { ...DEFAULTS.controls, ...s.controls } };
    } catch {}
    return structuredClone(DEFAULTS);
  };
  let cfg = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };

  const input = {
    buttons: Object.fromEntries([...BUTTONS, 'LS', 'RS', 'GUIDE', ...DPAD.map((d) => `DPAD_${d}`)].map((b) => [b, false])),
    axes: { LEFT_X: 0, LEFT_Y: 0, RIGHT_X: 0, RIGHT_Y: 0, LT: 0, RT: 0 },
  };
  let root, fab, editing = false, visible = false;

  function el(tag, cls, text) { const e = document.createElement(tag); e.className = cls; if (text) e.textContent = text; return e; }

  function place(node, id) {
    const c = cfg.controls[id];
    node.style.left = `${c.x}%`;
    node.style.top = `${c.y}%`;
    node.style.display = c.hidden && !editing ? 'none' : '';
    node.classList.toggle('tp-hidden', !!c.hidden);
  }

  // Press/release on a pointer, tracking each finger separately (multi-touch).
  function hold(node, onDown, onUp, onMove) {
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      node.setPointerCapture(e.pointerId);
      if (editing) return startDrag(node, e);
      node.classList.add('tp-on');
      onDown(e);
      if (navigator.vibrate) navigator.vibrate(8);
    });
    if (onMove) node.addEventListener('pointermove', (e) => { if (!editing && node.hasPointerCapture(e.pointerId)) onMove(e); });
    const up = (e) => { if (editing) return; node.classList.remove('tp-on'); onUp(e); };
    node.addEventListener('pointerup', up);
    node.addEventListener('pointercancel', up);
  }

  function startDrag(node, e) {
    const id = node.dataset.id;
    const move = (ev) => {
      cfg.controls[id].x = Math.min(98, Math.max(2, (ev.clientX / innerWidth) * 100));
      cfg.controls[id].y = Math.min(98, Math.max(2, (ev.clientY / innerHeight) * 100));
      place(node, id);
    };
    const end = () => { node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', end); save(); };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', end);
  }

  function addHide(node) {
    const x = el('button', 'tp-del', '×');
    x.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const c = cfg.controls[node.dataset.id];
      c.hidden = !c.hidden; place(node, node.dataset.id); save();
    });
    node.appendChild(x);
  }

  function stick(id, ax, ay, btn) {
    const base = el('div', 'tp-ctl tp-stick'); base.dataset.id = id;
    const knob = el('div', 'tp-knob'); base.appendChild(knob);
    let lastTap = 0;
    const set = (e) => {
      const r = base.getBoundingClientRect();
      const rad = r.width / 2;
      let dx = (e.clientX - (r.left + rad)) / rad, dy = (e.clientY - (r.top + rad)) / rad;
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      input.axes[ax] = dx; input.axes[ay] = dy;
      knob.style.transform = `translate(${dx * 50}%, ${dy * 50}%)`;
    };
    hold(base, (e) => {
      // Double-tap the stick = stick click (LS/RS).
      if (Date.now() - lastTap < 300) input.buttons[btn] = true;
      lastTap = Date.now();
      set(e);
    }, () => {
      input.axes[ax] = 0; input.axes[ay] = 0; input.buttons[btn] = false;
      knob.style.transform = '';
    }, set);
    return base;
  }

  function button(id, label, onDown, onUp) {
    const b = el('div', `tp-ctl tp-btn tp-${id.toLowerCase()}`, label); b.dataset.id = id;
    hold(b, onDown, onUp);
    return b;
  }

  function dpad() {
    const d = el('div', 'tp-ctl tp-dpad'); d.dataset.id = 'DPAD';
    for (const dir of DPAD) {
      const k = el('div', `tp-dir tp-${dir.toLowerCase()}`);
      d.appendChild(k);
    }
    // One pointer can roll between directions, so hit-test on move.
    const set = (e) => {
      const r = d.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const dead = r.width * 0.12;
      input.buttons.DPAD_LEFT = dx < -dead; input.buttons.DPAD_RIGHT = dx > dead;
      input.buttons.DPAD_UP = dy < -dead; input.buttons.DPAD_DOWN = dy > dead;
    };
    hold(d, set, () => DPAD.forEach((k) => { input.buttons[`DPAD_${k}`] = false; }), set);
    return d;
  }

  function toolbar() {
    const bar = el('div', 'tp-bar');
    const edit = el('button', 'tp-tool', 'Edit layout');
    const size = Object.assign(document.createElement('input'), { type: 'range', min: '0.6', max: '1.6', step: '0.05', value: cfg.scale, title: 'Size' });
    const fade = Object.assign(document.createElement('input'), { type: 'range', min: '0.15', max: '1', step: '0.05', value: cfg.opacity, title: 'Opacity' });
    const reset = el('button', 'tp-tool', 'Reset');
    const hide = el('button', 'tp-tool', 'Hide pad');
    const extras = el('span', 'tp-extras');
    extras.append('Size', size, 'Opacity', fade, reset);
    edit.onclick = () => setEditing(!editing);
    size.oninput = () => { cfg.scale = +size.value; apply(); save(); };
    fade.oninput = () => { cfg.opacity = +fade.value; apply(); save(); };
    reset.onclick = () => { cfg = structuredClone(DEFAULTS); save(); build(); setEditing(true); };
    hide.onclick = () => api.hide(true);
    bar.append(edit, extras, hide);
    return bar;
  }

  function setEditing(on) {
    editing = on;
    root.classList.toggle('tp-editing', on);
    root.querySelector('.tp-bar .tp-tool').textContent = on ? 'Done' : 'Edit layout';
    root.querySelectorAll('.tp-ctl').forEach((n) => place(n, n.dataset.id));
  }

  function apply() {
    root.style.setProperty('--tp-scale', cfg.scale);
    root.style.setProperty('--tp-opacity', cfg.opacity);
  }

  function build() {
    root?.remove();
    root = el('div', 'touchpad');
    root.id = 'touchPad';
    const controls = [
      stick('LSTICK', 'LEFT_X', 'LEFT_Y', 'LS'),
      stick('RSTICK', 'RIGHT_X', 'RIGHT_Y', 'RS'),
      dpad(),
      ...['A', 'B', 'X', 'Y', 'LB', 'RB', 'BACK', 'START'].map((b) =>
        button(b, b === 'BACK' ? '⧉' : b === 'START' ? '☰' : b, () => { input.buttons[b] = true; }, () => { input.buttons[b] = false; })),
      ...['LT', 'RT'].map((t) => button(t, t, () => { input.axes[t] = 1; }, () => { input.axes[t] = 0; })),
    ];
    for (const c of controls) { addHide(c); place(c, c.dataset.id); root.appendChild(c); }
    root.appendChild(toolbar());
    apply();
    root.style.display = visible ? '' : 'none';
    document.body.appendChild(root);
  }

  const isTouch = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

  // A real controller (USB or Bluetooth, via the Gamepad API) always wins:
  // app.js only reads the touch pad when no pad is connected. Hide the
  // on-screen pad while one is attached, and bring it back if it drops.
  const padConnected = () => [...(navigator.getGamepads?.() || [])].some(Boolean);
  let session = false;
  addEventListener('gamepadconnected', () => { if (session) api.hide(); });
  addEventListener('gamepaddisconnected', () => { if (session && !padConnected()) api.show(); });

  const api = {
    /** Called when a Game Together session starts (app.js); also by the 🎮 button. */
    start() { session = true; if (!padConnected()) api.show(); },
    /** Called when the session ends. */
    stop() { session = false; api.hide(); },
    show(force = false) {
      if (!force && !isTouch()) return;
      visible = true;
      if (!root) build();
      root.style.display = '';
      if (fab) fab.style.display = 'none';
    },
    /** byUser: hidden from its own toolbar mid-session, so leave a button to bring it back. */
    hide(byUser = false) {
      visible = false;
      if (root) { setEditing(false); root.style.display = 'none'; }
      if (!fab) {
        fab = el('button', 'tp-fab', '🎮');
        fab.title = 'Show touch controls';
        fab.onclick = () => api.show(true);
        document.body.appendChild(fab);
      }
      fab.style.display = byUser ? '' : 'none';
    },
    get visible() { return visible; },
    /** Current input in the physical-pad shape, or null when the pad is off. */
    read() { return visible && !editing ? structuredClone(input) : null; },
  };
  window.touchPad = api;
})();
