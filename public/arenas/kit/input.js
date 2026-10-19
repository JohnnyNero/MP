// Gamepad-first input with keyboard fallback for two, slot claiming, rumble.
//   P1 = keyboard (unless allBots) and the first gamepad that presses a button.
//   Any further gamepad (any button) or the P2 keyboard (arrows/Enter) claims the first CPU slot.
//   const inp = createInput({ nSlots, allBots, onClaim });
//   const { edges } = inp.poll();   // once per fixed step; edges: [{ pad, button }] and inp.keyEdge (Set of key codes)
//   inp.read(i) -> { x, y, jump, grab, aim }   (y = up / away from camera, aim -1..1 = look down..up)
//   inp.isHuman(i)   inp.rumble(i, strength, ms)   inp.inject(i, state|null)  (tests: override slot i's controller)
//
// Gamepad (standard mapping): left stick move, A jump, RT or RB grab (hold), right stick Y or D-pad up/down aim, Start help.
// Keyboard P1: WASD move, Space jump, F or Left Shift grab, R / V aim up / down.
// Keyboard P2: arrows move, / or Right Shift (or Enter) jump, . or Right Ctrl grab, L / , aim up / down.
const KB = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', j: ['Space'], g: ['KeyF', 'ShiftLeft'], au: 'KeyR', ad: 'KeyV' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', j: ['Slash', 'ShiftRight', 'Enter', 'NumpadEnter'], g: ['Period', 'ControlRight'], au: 'KeyL', ad: 'Comma' },
];
const PREVENT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash'];
const P2_JOIN = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Slash', 'Period'];
const dz = (v, d) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

export function createInput({ nSlots = 4, allBots = false, onClaim = null } = {}) {
  const keys = new Set(); const keyEdge = new Set(); const injected = [];
  addEventListener('keydown', (e) => { if (!keys.has(e.code)) keyEdge.add(e.code); keys.add(e.code); if (PREVENT.includes(e.code)) e.preventDefault(); });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  const slotDev = Array.from({ length: 4 }, (_, i) => (i === 0 && !allBots ? { kb: 0, pad: null } : null));
  const padPrev = {};
  let pads = [];
  function claim(dev) {
    // a new pad takes P1 if P1 has no pad yet (keyboard + first pad share P1), else the first CPU slot
    if (dev.pad != null && slotDev[0] && slotDev[0].pad == null && !allBots) { slotDev[0].pad = dev.pad; onClaim?.(0); return 0; }
    for (let i = 0; i < nSlots; i++) if (!slotDev[i]) { slotDev[i] = dev; onClaim?.(i); return i; }
    return -1;
  }
  function poll() {
    pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; const edges = [];
    for (const p of pads) {
      if (!p) continue; const prev = padPrev[p.index] || [];
      const now = p.buttons.map((b) => b.pressed); padPrev[p.index] = now;
      now.forEach((d, i) => { if (d && !prev[i]) edges.push({ pad: p.index, button: i }); });
    }
    for (const e of edges) if (e.button !== 9 && !slotDev.some((d) => d && d.pad === e.pad)) claim({ kb: null, pad: e.pad });
    if (P2_JOIN.some((c) => keyEdge.has(c)) && !slotDev.some((d) => d && d.kb === 1)) claim({ kb: 1, pad: null });
    return { edges };
  }
  function read(i) {
    if (injected[i]) return { x: 0, y: 0, jump: false, grab: false, aim: 0, ...injected[i] };
    const d = slotDev[i]; const o = { x: 0, y: 0, jump: false, grab: false, aim: 0 }; if (!d) return o;
    if (d.kb != null) {
      const k = KB[d.kb];
      o.x += (keys.has(k.r) ? 1 : 0) - (keys.has(k.l) ? 1 : 0); o.y += (keys.has(k.u) ? 1 : 0) - (keys.has(k.d) ? 1 : 0);
      o.jump ||= k.j.some((c) => keys.has(c)); o.grab ||= k.g.some((c) => keys.has(c));
      o.aim += (keys.has(k.au) ? 1 : 0) - (keys.has(k.ad) ? 1 : 0);
    }
    const p = d.pad != null ? pads[d.pad] : null;
    if (p) {
      let ax = p.axes[0] || 0, ay = -(p.axes[1] || 0); const m = Math.hypot(ax, ay);
      if (m < 0.2) { ax = 0; ay = 0; } else { const k = Math.min(1, (m - 0.2) / 0.75) / m; ax *= k; ay *= k; }   // radial deadzone, rescaled
      const b = (n) => !!(p.buttons[n] && (p.buttons[n].pressed || p.buttons[n].value > 0.35));
      o.x += ax; o.y += ay; o.jump ||= b(0); o.grab ||= b(7) || b(5);
      let aim = -dz(p.axes[3] || 0, 0.3); if (b(12)) aim = 1; if (b(13)) aim = -1;
      o.aim += aim;
    }
    const m = Math.hypot(o.x, o.y); if (m > 1) { o.x /= m; o.y /= m; }
    o.aim = Math.max(-1, Math.min(1, o.aim));
    return o;
  }
  function rumble(i, strong, dur = 200) {
    const d = slotDev[i]; if (!d || d.pad == null) return; const p = navigator.getGamepads?.()[d.pad];
    p?.vibrationActuator?.playEffect?.('dual-rumble', { duration: dur, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, strong * 0.6) })?.catch?.(() => {});
  }
  return { slotDev, keyEdge, keys, poll, read, rumble, claim, isHuman: (i) => !!slotDev[i] || !!injected[i], endStep: () => keyEdge.clear(),
    inject(i, st) { injected[i] = st || null; } };
}
