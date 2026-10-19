// Shared effects: sprite puffs (smoke / splash / sparks), expanding rings, short-lived meshes (bolts, slams),
// a light flash, telegraph helpers, label sprites, and a tiny synth for sfx. Effects age in sim time.
//   const fx = createFX({ THREE, scene, rng });   fx.update(dt) once per fixed step;  fx.clear() between rounds
export function createFX({ THREE, scene, rng, maxPuffs = 160 }) {
  // ---- audio (starts on first input; browsers block it before that)
  // A gamepad press doesn't count as a user gesture in most browsers, so run.js also tries this on pad presses
  // (it works where the browser already trusts the site) and the HUD asks for a click or key while sound is off.
  let AC = null, master = null;
  const audioOn = () => {
    if (!AC) { try { AC = new AudioContext(); master = AC.createGain(); master.gain.value = 0.9; master.connect(AC.destination); } catch { AC = null; } }
    if (AC && AC.state === 'suspended') AC.resume().catch(() => {});
  };
  addEventListener('pointerdown', audioOn); addEventListener('keydown', audioOn);
  let noiseBuf = null;
  // character voices: a pitched tone sweep (f0 -> f1 over dur), optional wobble, through the master gain
  function tone(type, f0, f1, dur, vol, { t = 0, wob = 0, wobHz = 28, attack = 0.008 } = {}) {
    const t0 = AC.currentTime + t, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    if (wob) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = wobHz; lg.gain.value = wob; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur + 0.02); }
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const VOICE = {
    boing: (p, v) => tone('sine', 230 * p, 600 * p, 0.2, 0.16 * v, { wob: 40 * p }),                                  // jump
    hup: (p, v) => { tone('sine', 330 * p, 520 * p, 0.09, 0.12 * v); tone('sine', 520 * p, 780 * p, 0.12, 0.12 * v, { t: 0.08 }); },   // mantle over a ledge
    squish: (p, v) => tone('sine', 150 * p, 60 * p, 0.14, 0.22 * v),                                                    // land (plus a soft splat below)
    pop: (p, v) => tone('sine', 1150 * p, 360 * p, 0.07, 0.14 * v, { attack: 0.003 }),                                   // grab
    bonk: (p, v) => { tone('triangle', 560 * p, 170 * p, 0.22, 0.2 * v, { attack: 0.003 }); tone('sine', 1500 * p, 1400 * p, 0.35, 0.05 * v, { t: 0.05, wob: 60, wobHz: 9 }); },   // knocked out (+ tweeting)
    yelp: (p, v) => tone('triangle', 820 * p, 240 * p, 0.55, 0.13 * v, { wob: 25 * p, wobHz: 14 }),                    // falling out
  };
  function sfx(kind, { vol = 1, pitch = 1 } = {}) {
    if (!AC || AC.state !== 'running') return;
    if (VOICE[kind]) { VOICE[kind](pitch, vol); if (kind === 'squish') sfx('splat', { vol: vol * 0.5 }); return; }
    const t0 = AC.currentTime, out = AC.createGain(); out.connect(master);
    if (!noiseBuf) { noiseBuf = AC.createBuffer(1, AC.sampleRate * 2, AC.sampleRate); const d = noiseBuf.getChannelData(0); let a = 7; for (let i = 0; i < d.length; i++) { a = (a * 1103515245 + 12345) >>> 0; d[i] = a / 2147483648 - 1; } }
    const noise = () => { const s = AC.createBufferSource(); s.buffer = noiseBuf; return s; };
    const env = (g, a, peak, dur) => { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(peak, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); };
    const filt = (type, f, q = 1) => { const f1 = AC.createBiquadFilter(); f1.type = type; f1.frequency.value = f; f1.Q.value = q; return f1; };
    const P = { crackle: ['highpass', 2500, 0.01, 0.25, 0.4], thunder: ['lowpass', 260, 0.02, 0.6, 1.8], boom: ['lowpass', 180, 0.01, 0.9, 1.2], splash: ['bandpass', 900, 0.02, 0.35, 0.6],
      rumble: ['lowpass', 90, 0.2, 0.5, 1.4], whoosh: ['bandpass', 500, 0.6, 0.18, 1.0], crash: ['lowpass', 700, 0.01, 0.5, 0.8], stomp: ['lowpass', 120, 0.005, 1.0, 0.9],
      splat: ['bandpass', 400, 0.01, 0.45, 0.35], shatter: ['highpass', 3200, 0.005, 0.35, 0.5], roll: ['lowpass', 160, 0.3, 0.35, 1.6] }[kind];
    if (P) { const s = noise(); const f = filt(P[0], P[1]); s.connect(f); f.connect(out); env(out, P[2], P[3] * vol, P[4]); s.start(t0); s.stop(t0 + P[4]); return; }
    const notes = { sting: [392, 311, 262], go: [523, 784], fanfare: [523, 659, 784, 1046], out: [330, 220], horn: [196, 196, 262], tick: [880] }[kind];
    if (notes) notes.forEach((f, i) => { const o = AC.createOscillator(); const g = AC.createGain(); o.type = kind === 'horn' ? 'sawtooth' : 'triangle'; o.frequency.value = f; o.connect(g); g.connect(master);
      const s = t0 + i * (kind === 'horn' ? 0.22 : 0.13); g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(kind === 'horn' ? 0.08 : 0.18, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32); o.start(s); o.stop(s + 0.34); });
  }

  // ---- puffs: one sprite pool
  const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const PUFFS = []; let puffHead = 0;
  for (let i = 0; i < maxPuffs; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })); s.visible = false; scene.add(s); PUFFS.push({ s, life: 0, age: 0, v: new THREE.Vector3(), size: 1, grow: 1, a: 1, g: 0 }); }
  function puff(pos, { color = '#888', v = [0, 1, 0], size = 0.5, grow = 2, life = 1.2, a = 0.7, g = 0, add = false } = {}) {
    const p = PUFFS[puffHead]; puffHead = (puffHead + 1) % PUFFS.length;
    p.s.position.copy(pos); p.v.set(...v); p.size = size; p.grow = grow; p.life = life; p.age = 0; p.a = a; p.g = g; p.s.visible = true;
    p.s.material.color.set(color); const bl = add ? THREE.AdditiveBlending : THREE.NormalBlending; if (p.s.material.blending !== bl) { p.s.material.blending = bl; p.s.material.needsUpdate = true; }
    p.s.scale.setScalar(size); p.s.material.opacity = 0;
  }
  function burst(pos, n, { colors = ['#ffffff'], speed = 3, up = 3, size = 0.4, life = 0.9, g = 8, a = 0.85, add = false, grow = 1.4 } = {}) {
    for (let i = 0; i < n; i++) { const ang = rng() * Math.PI * 2, s = speed * (0.4 + rng() * 0.8); puff(pos, { color: colors[i % colors.length], v: [Math.cos(ang) * s, up * (0.5 + rng()), Math.sin(ang) * s], size, grow, life, a, g, add }); }
  }
  // ---- rings (expanding, fading)
  const rings = [];
  function ring(pos, color, r, life = 0.7) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y += 0.05; m.renderOrder = 4; scene.add(m); rings.push({ m, age: 0, r, life });
  }
  function splash(pos, big = 1) {
    sfx('splash');
    burst(pos, Math.round(12 * big), { colors: ['#e8f6ff'], speed: 2.5, up: 5 * big, size: 0.35, life: 0.8, g: 9, a: 0.9, grow: 1.2 });
    ring(pos, '#dff4ff', 1.6 * big);
  }
  // ---- timed meshes (bolts, slam dust, etc.)
  const timed = [];
  function addTimed(objs, life, { flicker = false, onUpdate = null } = {}) { for (const o of objs) scene.add(o); timed.push({ objs, age: 0, life, flicker, onUpdate }); }
  // ---- flash light
  const flashLight = new THREE.PointLight(0xa8c4ff, 0, 18, 1.6); scene.add(flashLight);
  const flashAmb = new THREE.AmbientLight(0xdfe8ff, 0); scene.add(flashAmb);
  let flash = 0;
  function flashAt(pos, amount = 1, color = 0xa8c4ff) { flash = Math.max(flash, amount); flashLight.color.set(color); flashLight.position.copy(pos).add(new THREE.Vector3(0, 2, 0)); }
  function bolt(wp) {
    const pts = []; const p = wp.clone().add(new THREE.Vector3((rng() - 0.5) * 4, 22, (rng() - 0.5) * 4));
    for (let i = 0; i <= 9; i++) { const k = i / 9; const q = p.clone().lerp(wp, k); if (i > 0 && i < 9) { q.x += (rng() - 0.5) * 1.6; q.z += (rng() - 0.5) * 1.6; } pts.push(q); }
    const path = new THREE.CurvePath(); for (let i = 0; i < 9; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
    const core = new THREE.Mesh(new THREE.TubeGeometry(path, 36, 0.08, 5, false), new THREE.MeshBasicMaterial({ color: '#f4f8ff', toneMapped: false }));
    const glow = new THREE.Mesh(new THREE.TubeGeometry(path, 36, 0.32, 6, false), new THREE.MeshBasicMaterial({ color: '#8fb4ff', transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    addTimed([core, glow], 0.32, { flicker: true }); flashAt(wp, 1);
  }
  // ---- telegraph helpers (added to a parent group: the arena's local frame)
  function circleTele(parent, local, r, color = '#ff4a2a') {
    const g = new THREE.Group(); g.position.copy(local); g.position.y += 0.05;
    const ringM = new THREE.Mesh(new THREE.RingGeometry(r * 0.84, r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.84, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    ringM.rotation.x = disc.rotation.x = -Math.PI / 2; ringM.renderOrder = disc.renderOrder = 3; g.add(ringM, disc); parent.add(g);
    return { g, ring: ringM, disc, dispose() { parent.remove(g); ringM.geometry.dispose(); disc.geometry.dispose(); ringM.material.dispose(); disc.material.dispose(); } };
  }
  function labelSprite(text, color = '#7cf0a0', w = 3.2) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = 'rgba(20,12,28,0.85)'; g.beginPath(); g.roundRect(8, 8, 496, 112, 30); g.fill(); g.lineWidth = 8; g.strokeStyle = color; g.stroke();
    g.fillStyle = color; g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.set(w, w / 4, 1); s.renderOrder = 12; return s;
  }
  function update(dt) {
    for (const p of PUFFS) {
      if (!p.s.visible) continue; p.age += dt; if (p.age >= p.life) { p.s.visible = false; continue; }
      const k = p.age / p.life; p.v.y -= p.g * dt; p.s.position.addScaledVector(p.v, dt); p.s.scale.setScalar(p.size * (1 + p.grow * k)); p.s.material.opacity = p.a * (1 - k) * Math.min(1, p.age * 10);
    }
    for (let i = rings.length - 1; i >= 0; i--) { const r = rings[i]; r.age += dt; const k = r.age / r.life; r.m.scale.setScalar(0.3 + r.r * k); r.m.material.opacity = 0.9 * (1 - k); if (k >= 1) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); rings.splice(i, 1); } }
    for (let i = timed.length - 1; i >= 0; i--) {
      const f = timed[i]; f.age += dt; f.onUpdate?.(f.age / f.life, f);
      for (const o of f.objs) o.visible = !f.flicker || Math.floor(f.age * 30) % 3 !== 1;
      if (f.age >= f.life) { for (const o of f.objs) { scene.remove(o); o.traverse?.((q) => { q.geometry?.dispose(); q.material?.dispose?.(); }); } timed.splice(i, 1); }
    }
    flash = Math.max(0, flash - dt * 3.2); flashLight.intensity = flash * 60; flashAmb.intensity = flash * 1.6;
  }
  function clear() {
    for (const f of timed) for (const o of f.objs) scene.remove(o); timed.length = 0;
    for (const r of rings) { scene.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); } rings.length = 0;
    for (const p of PUFFS) p.s.visible = false; flash = 0;
  }
  return { sfx, audioOn, get soundOn() { return !!AC && AC.state === 'running'; }, puff, burst, ring, splash, addTimed, flashAt, bolt, circleTele, labelSprite, update, clear, get flash() { return flash; } };
}
