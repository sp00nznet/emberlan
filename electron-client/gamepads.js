/**
 * Virtual Xbox 360 pads for Game Together guests, via ViGEmBus
 * (https://github.com/nefarius/ViGEmBus, installed separately by the host).
 * One pad per guest player slot; the host's own controller stays Player 1.
 *
 * Takes the same input shape the UI sends: { buttons: { A, B, ..., DPAD_UP }, axes: { LEFT_X, LEFT_Y,
 * RIGHT_X, RIGHT_Y, LT, RT } } with browser conventions (sticks -1..1, Y down positive).
 * `ViGEmClient` is injected so the conformance harness can check the mapping without the driver.
 */
const BUTTONS = {
  A: 'A', B: 'B', X: 'X', Y: 'Y', LB: 'LEFT_SHOULDER', RB: 'RIGHT_SHOULDER',
  BACK: 'BACK', START: 'START', LS: 'LEFT_THUMB', RS: 'RIGHT_THUMB', GUIDE: 'GUIDE',
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

function createGamepads(ViGEmClient) {
  let client = null;
  const pads = new Map(); // slot -> X360Controller

  // Connect to the bus on first use; returns an error message or null.
  function bus() {
    if (client) return null;
    if (!ViGEmClient) return 'The virtual controller module is not built into this app';
    try {
      const c = new ViGEmClient();
      const err = c.connect();
      if (err) return /BUS_NOT_FOUND/.test(err.message) ? 'ViGEmBus is not installed' : err.message;
      client = c;
      return null;
    } catch (e) {
      return /BUS_NOT_FOUND/.test(e.message) ? 'ViGEmBus is not installed' : e.message;
    }
  }

  function pad(slot) {
    let p = pads.get(slot);
    if (p || bus()) return p;
    p = client.createX360Controller();
    const err = p.connect();
    if (err) throw err;
    p.updateMode = 'manual';
    pads.set(slot, p);
    return p;
  }

  return {
    status() {
      const error = bus();
      return { available: !error, error, pads: [...pads.keys()] };
    },

    set(slot, input) {
      const p = pad(slot);
      if (!p || !input) return;
      const b = input.buttons || {}, a = input.axes || {};
      for (const [k, name] of Object.entries(BUTTONS)) p.button[name].setValue(!!b[k]);
      p.axis.leftX.setValue(clamp(a.LEFT_X, -1, 1));
      p.axis.leftY.setValue(-clamp(a.LEFT_Y, -1, 1)); // XInput: up is positive
      p.axis.rightX.setValue(clamp(a.RIGHT_X, -1, 1));
      p.axis.rightY.setValue(-clamp(a.RIGHT_Y, -1, 1));
      p.axis.leftTrigger.setValue(clamp(a.LT, 0, 1));
      p.axis.rightTrigger.setValue(clamp(a.RT, 0, 1));
      p.axis.dpadHorz.setValue((b.DPAD_RIGHT ? 1 : 0) - (b.DPAD_LEFT ? 1 : 0));
      p.axis.dpadVert.setValue((b.DPAD_UP ? 1 : 0) - (b.DPAD_DOWN ? 1 : 0));
      p.update();
    },

    remove(slot) {
      const p = pads.get(slot);
      if (!p) return;
      pads.delete(slot);
      try { p.disconnect(); } catch {}
    },

    clear() { for (const slot of [...pads.keys()]) this.remove(slot); },
  };
}

module.exports = { createGamepads };
