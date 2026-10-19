// TABLETOP arena: Space Station (Cargo Bay). A hangar on an orbital station with its loading door blown open along
// the camera side: a raised catwalk across the back (two ramps, grab rails beneath), a freight lift rising and sinking
// in the middle, breakable crates and cargo pods, and a planet turning far below. Falling out of the door means
// drifting off into space. Signature disaster: decompression. Built on the arena kit (../kit/KIT.md).
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GLB_BASE64, SUPPORT } from './stationpieces.js';
import * as L from './layout.js';
import { createSmash } from '../kit/smash.js';

// ---------------------------------------------------------------- small helpers
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.15, ...o });
function addBox(parent, [x0, y0, z0], [x1, y1, z1], mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m;
}
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 4; return t;
}
const seeded = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
const stripes = (repeat) => canvasTex(128, 32, (g, w, h) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1f26'; for (let x = -h; x < w; x += 32) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 16, h); g.lineTo(x + 16 + h, 0); g.lineTo(x + h, 0); g.fill(); } }, repeat);
const rampPts = (r) => [[r.x0, 0, r.z1], [r.x1, 0, r.z1], [r.x0, 0, r.z0], [r.x1, 0, r.z0], [r.x0, L.CATWALK.y, r.z0], [r.x1, L.CATWALK.y, r.z0]];

// lift height over its cycle (deck -> rise -> top -> lower)
function liftTop(t) {
  const F = L.LIFT, T = F.down + F.rise + F.up + F.lower; let u = t % T;
  const ease = (k) => k * k * (3 - 2 * k);
  if (u < F.down) return 0; u -= F.down;
  if (u < F.rise) return F.top * ease(u / F.rise); u -= F.rise;
  if (u < F.up) return F.top; u -= F.up;
  return F.top * (1 - ease(u / F.lower));
}

// ---------------------------------------------------------------- skins: runaway canisters (stampede), loader claw (stomp)
const CAN = (() => { let c = null; return () => c || (c = {
  body: new THREE.CylinderGeometry(0.62, 0.62, 1.3, 24).rotateX(Math.PI / 2), bodyM: [std('#f08a2c', { roughness: 0.45 }), std('#e8edf5', { roughness: 0.4 }), std('#2fa4a8', { roughness: 0.45 })],
  band: new THREE.TorusGeometry(0.62, 0.06, 8, 24), bandM: std('#2b2f3a', { metalness: 0.5 }),
}); })();
function makeCanister(ctx, rng, lane, k) {
  const C = CAN(); const g = new THREE.Group(); const b = new THREE.Mesh(C.body, C.bodyM[(lane + k) % 3]); b.castShadow = true; g.add(b);
  for (const z of [-0.45, 0.45]) { const r = new THREE.Mesh(C.band, C.bandM); r.position.z = z; g.add(r); }
  return { obj: g, r: 0.62 };
}
function makeClaw() {
  const g = new THREE.Group(); const yel = std('#f2b632', { roughness: 0.5, metalness: 0.3 }), dark = std('#2f3440', { roughness: 0.5, metalness: 0.5 });
  const pad = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 2.4), dark); pad.position.y = 0.28; g.add(pad);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.35, 1.8), yel); plate.position.y = 0.72; g.add(plate);
  for (const [x, z, ry] of [[1.25, 0, 0], [-1.25, 0, Math.PI], [0, 1.15, -Math.PI / 2]]) {
    const f = new THREE.Group(); f.position.set(x, 0.6, z); f.rotation.y = ry; g.add(f);
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.45), yel); a.position.set(0.15, -0.1, 0); a.rotation.z = -0.35; f.add(a);
  }
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 4.2, 14), yel); arm.position.set(0, 2.8, -1.2); arm.rotation.x = -0.45; g.add(arm);
  const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3.0, 10), std('#d8dee8', { metalness: 0.8, roughness: 0.25 })); piston.position.set(0.7, 2.4, -0.7); piston.rotation.x = -0.45; g.add(piston);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export const STATION_CAMERA = { pitchDeg: 35, fov: 36, minDist: 14.5, maxDist: 26, padX: 1.6, padZ: 1.6, padY: 0.8, center: [0, 0.4, 1.6], homeSize: [16, 1, 9],
  centerPull: 0.25, lift: 0.1, zBias: 0.4, include: [[-3, -1.2, 7.0], [3, -1.2, 7.0]], revealFrom: 10, revealTo: 29, revealCenter: [0, 1.4, 0], revealLift: 0.6, yMin: -0.3 };

// ---------------------------------------------------------------- the arena module
const state = { tracked: [], visuals: null, lift: null, liftT: 0, alarm: 'idle', alarmT: 0, brokenEver: new Set() };

function buildStatic(ctx) {
  const { scene, renderer } = ctx;
  const root = new THREE.Group(); root.name = 'station'; scene.add(root);
  scene.background = new THREE.Color('#05081a');
  scene.fog = new THREE.Fog('#05081a', 60, 160);
  renderer.toneMappingExposure = 1.05;
  // starlight from the front left (through the open door), cool fill, warm bounce off the deck
  const hemi = new THREE.HemisphereLight('#d8e4ff', '#3a3448', 0.95); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3e2', 2.5); sun.position.set(-10, 18, 12); sun.target.position.set(0, 0, 0);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 13, bottom: -13, near: 1, far: 60 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#7f9cff', 0.5); fill.position.set(12, 8, -6); scene.add(fill);

  // stars and the planet below
  const starGeo = new THREE.BufferGeometry(); const sp = []; const r = seeded(7);
  for (let i = 0; i < 1800; i++) { const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u); sp.push(150 * s * Math.cos(a), 150 * u, 150 * s * Math.sin(a)); }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, fog: false })); root.add(stars);
  const planetTex = canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#2c6fd1'); gr.addColorStop(0.5, '#2a9bc4'); gr.addColorStop(1, '#1b4e9a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const q = seeded(3); g.fillStyle = '#3f9a5a'; for (let i = 0; i < 26; i++) { g.beginPath(); g.ellipse(q() * w, h * (0.2 + q() * 0.6), 20 + q() * 60, 10 + q() * 30, q() * 3, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = 'rgba(255,255,255,0.75)'; for (let i = 0; i < 60; i++) { g.beginPath(); g.ellipse(q() * w, q() * h, 18 + q() * 50, 3 + q() * 6, 0, 0, Math.PI * 2); g.fill(); }
  });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(70, 64, 40), new THREE.MeshStandardMaterial({ map: planetTex, roughness: 0.9, fog: false })); planet.position.set(-25, -92, 70); root.add(planet);
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(73, 48, 32), new THREE.MeshBasicMaterial({ color: '#7cc8ff', transparent: true, opacity: 0.25, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); atmo.position.copy(planet.position); root.add(atmo);

  const B = L.BAY, C = L.CATWALK;
  // deck: steel plates with seams and rivets, a hole for the lift shaft
  const deckTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#8994a8'; g.fillRect(0, 0, w, h); const q = seeded(11);
    for (let i = 0; i < 500; i++) { g.fillStyle = q() < 0.5 ? 'rgba(40,46,60,0.12)' : 'rgba(255,255,255,0.12)'; g.fillRect(q() * w, q() * h, 2, 2); }
    g.strokeStyle = '#596377'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    g.fillStyle = '#6a7488'; for (const [x, y] of [[12, 12], [w - 12, 12], [12, h - 12], [w - 12, h - 12], [w / 2 - 10, h / 2], [w / 2 + 10, h / 2]]) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
  }, [11, 5.5]);
  const deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.55, metalness: 0.35 });
  const F = L.LIFT;
  for (const [a, b] of [[[B.x0, -B.thick, B.z0], [F.x0, 0, B.z1]], [[F.x1, -B.thick, B.z0], [B.x1, 0, B.z1]], [[F.x0, -B.thick, B.z0], [F.x1, 0, F.z0]], [[F.x0, -B.thick, F.z1], [F.x1, 0, B.z1]]]) addBox(root, a, b, deckMat);
  // hazard stripes: the open door edge and the lift shaft rim
  const edgeM = new THREE.MeshStandardMaterial({ map: stripes([22, 1]), roughness: 0.5 });
  addBox(root, [B.x0, -B.thick - 0.05, B.z1 - 0.45], [B.x1, 0.012, B.z1 + 0.05], edgeM, { cast: false });
  const rimM = new THREE.MeshStandardMaterial({ map: stripes([3, 1]), roughness: 0.5 });
  for (const [a, b] of [[[F.x0 - 0.25, 0, F.z0 - 0.25], [F.x1 + 0.25, 0.015, F.z0]], [[F.x0 - 0.25, 0, F.z1], [F.x1 + 0.25, 0.015, F.z1 + 0.25]], [[F.x0 - 0.25, 0, F.z0], [F.x0, 0.015, F.z1]], [[F.x1, 0, F.z0], [F.x1 + 0.25, 0.015, F.z1]]]) addBox(root, a, b, rimM, { cast: false });
  // underside of the deck: dark hull with lights, so the drop reads as space
  addBox(root, [B.x0 - 0.4, -2.6, B.z0 - 0.4], [B.x1 + 0.4, -B.thick, B.z1 - 0.3], std('#3a4152', { metalness: 0.4 }));
  for (let i = 0; i < 9; i++) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.08), new THREE.MeshBasicMaterial({ color: '#7fe8ff', toneMapped: false })); l.position.set(-9 + i * 2.25, -1.6, B.z1 - 0.26); root.add(l); }
  // back wall: white panels, a long window onto the stars above the catwalk, a bay sign
  const wallTex = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#dfe4ec'; g.fillRect(0, 0, w, h); g.strokeStyle = '#b8c0cf'; g.lineWidth = 6; for (let y = 0; y <= h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); } for (let x = 0; x <= w; x += 128) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.fillStyle = '#c8cfdb'; g.fillRect(20, 20, 88, 30); g.fillRect(148, 148, 88, 30); }, [11, 3.5]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.6, metalness: 0.1 });
  addBox(root, [B.x0 - 0.4, 0, B.z0 - 0.4], [B.x1 + 0.4, B.wallH, B.z0], wallMat);
  const winTex = canvasTex(512, 128, (g, w, h) => { g.fillStyle = '#060a1c'; g.fillRect(0, 0, w, h); const q = seeded(5); for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + q() * 0.7})`; g.fillRect(q() * w, q() * h, 1.5, 1.5); } const gr = g.createRadialGradient(w * 0.8, h * 1.2, 10, w * 0.8, h * 1.2, 160); gr.addColorStop(0, 'rgba(90,160,255,0.55)'); gr.addColorStop(1, 'rgba(90,160,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const win = new THREE.Mesh(new THREE.PlaneGeometry(18, 2.4), new THREE.MeshBasicMaterial({ map: winTex, toneMapped: false })); win.position.set(0, 4.6, B.z0 + 0.02); root.add(win);
  const frameM = std('#5d6678', { metalness: 0.5, roughness: 0.4 });
  addBox(root, [-9.2, 3.3, B.z0], [9.2, 3.4, B.z0 + 0.25], frameM); addBox(root, [-9.2, 5.8, B.z0], [9.2, 5.9, B.z0 + 0.25], frameM);
  for (let x = -9.2; x <= 9.2; x += 3.07) addBox(root, [x - 0.06, 3.4, B.z0], [x + 0.06, 5.8, B.z0 + 0.22], frameM);
  const sign = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#f2c230'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1f26'; g.font = '900 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('CARGO BAY 07', w / 2, h / 2 + 2); });
  const signM = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshBasicMaterial({ map: sign })); signM.position.set(0, 6.4, B.z0 + 0.03); root.add(signM);
  // side walls with the door frame posts at the front
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? B.x0 - 0.45 : B.x1, x1 = s < 0 ? B.x0 : B.x1 + 0.45;
    addBox(root, [x0, 0, B.z0 - 0.4], [x1, B.wallH, B.z1 - 0.3], wallMat);
    addBox(root, [x0 - 0.05, -B.thick, B.z1 - 0.5], [x1 + 0.05, B.wallH, B.z1 + 0.05], new THREE.MeshStandardMaterial({ map: stripes([1, 10]), roughness: 0.5 }));
  }
  // catwalk: grated deck on yellow pillars, trimmed front edge
  const grate = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#4d5566'; g.fillRect(0, 0, w, h); g.fillStyle = '#2b303b'; for (let y = 4; y < h; y += 12) for (let x = 4; x < w; x += 12) g.fillRect(x, y, 8, 8); }, [44, 4]);
  const catwalk = addBox(root, [C.x0, C.y - C.t, C.z0], [C.x1, C.y, C.z1], new THREE.MeshStandardMaterial({ map: grate, roughness: 0.6, metalness: 0.4 }));
  const trim = addBox(root, [C.x0, C.y - C.t - 0.02, C.z1 - 0.12], [C.x1, C.y + 0.02, C.z1 + 0.02], new THREE.MeshStandardMaterial({ map: stripes([30, 1]), roughness: 0.5 }), { cast: false });
  const yel = std('#f2b632', { roughness: 0.5, metalness: 0.3 });
  const pillars = L.PILLARS.map((p) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r, C.y - C.t, 12), yel); m.position.set(p.x, (C.y - C.t) / 2, p.z); m.castShadow = true; root.add(m); return m; });
  // ramps
  const rampMat = new THREE.MeshStandardMaterial({ map: grate.clone(), roughness: 0.6, metalness: 0.4 }); rampMat.map.repeat.set(4, 10);
  const ramps = L.RAMPS.map((rp) => { const m = new THREE.Mesh(new ConvexGeometry(rampPts(rp).map((p) => new THREE.Vector3(...p))), rampMat); m.castShadow = m.receiveShadow = true; root.add(m); return m; });
  // grab rails on brackets
  const railM = std('#f2b632', { roughness: 0.35, metalness: 0.5 });
  for (const rl of L.RAILS) {
    const a = new THREE.Vector3(...rl.a), b = new THREE.Vector3(...rl.b), len = a.distanceTo(b);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, len, 10), railM); bar.position.copy(a).add(b).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); bar.castShadow = true; root.add(bar);
    for (let k = 0; k <= Math.floor(len / 2); k++) { const p = a.clone().lerp(b, Math.min(1, k * 2 / len)); const br = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), railM); br.position.set(p.x - rl.n[0] * 0.08, p.y, p.z - rl.n[1] * 0.08); root.add(br); }
  }
  // light strips under the catwalk and along the walls
  const glow = new THREE.MeshBasicMaterial({ color: '#8fe9ff', toneMapped: false });
  for (let x = -9; x <= 9; x += 3) { const l = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.06, 0.1), glow); l.position.set(x, C.y - C.t - 0.05, C.z1 - 0.3); root.add(l); }
  // alarm beacons (red), dark until a decompression warning
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#5a1a1a', emissive: '#ff2a1a', emissiveIntensity: 0, roughness: 0.4 });
  const beacons = [], alarmLights = [];
  for (const x of [-10.6, 10.6]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), beaconMat); m.position.set(x, 5.2, B.z1 - 0.9); root.add(m); beacons.push(m);
    const pl = new THREE.PointLight('#ff3a2a', 0, 16, 1.6); pl.position.set(x * 0.9, 4.6, B.z1 - 1.4); root.add(pl); alarmLights.push(pl);
  }
  // the lift block (moved every frame)
  const liftTopTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#9aa6bb'; g.fillRect(0, 0, w, h); g.strokeStyle = '#f2c230'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10); g.fillStyle = '#6a7488'; g.font = '900 34px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('LIFT', w / 2, h / 2); });
  const liftMats = [std('#5d6678', { metalness: 0.5 }), std('#5d6678', { metalness: 0.5 }), new THREE.MeshStandardMaterial({ map: liftTopTex, roughness: 0.5, metalness: 0.3 }), std('#5d6678'), new THREE.MeshStandardMaterial({ map: stripes([2, 6]), roughness: 0.5 }), std('#5d6678', { metalness: 0.5 })];
  const lift = new THREE.Mesh(new THREE.BoxGeometry(F.x1 - F.x0 - 0.04, F.top, F.z1 - F.z0 - 0.04), liftMats); lift.castShadow = lift.receiveShadow = true; root.add(lift);
  return { root, planet, stars, lift, beaconMat, beacons, alarmLights, occluders: [catwalk, trim, ...pillars] };
}

function buildColliders(ctx) {
  const { world, RAPIER } = ctx; const B = L.BAY, C = L.CATWALK, F = L.LIFT;
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (d, fr = 0.6) => world.createCollider(d.setFriction(fr), rb);
  const cub = (x0, y0, z0, x1, y1, z1, fr) => add(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), fr);
  cub(B.x0, -B.thick, B.z0, F.x0, 0, B.z1); cub(F.x1, -B.thick, B.z0, B.x1, 0, B.z1); cub(F.x0, -B.thick, B.z0, F.x1, 0, F.z0); cub(F.x0, -B.thick, F.z1, F.x1, 0, B.z1);
  cub(F.x0, -3.2, F.z0, F.x1, -3.0, F.z1);                                              // shaft floor (the lift block never leaves it open)
  cub(B.x0 - 1, 0, B.z0 - 0.6, B.x1 + 1, 12, B.z0);                                      // back wall
  cub(B.x0 - 0.6, 0, B.z0, B.x0, 12, B.z1); cub(B.x1, 0, B.z0, B.x1 + 0.6, 12, B.z1);    // side walls
  cub(C.x0, C.y - C.t, C.z0, C.x1, C.y, C.z1, 0.7);                                      // catwalk
  for (const p of L.PILLARS) add(RAPIER.ColliderDesc.cylinder((C.y - C.t) / 2, p.r).setTranslation(p.x, (C.y - C.t) / 2, p.z), 0.4);
  for (const rp of L.RAMPS) add(RAPIER.ColliderDesc.convexHull(new Float32Array(rampPts(rp).flat())), 0.8);
  // the lift: kinematic block in its shaft
  const lb = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation((F.x0 + F.x1) / 2, -F.top / 2, (F.z0 + F.z1) / 2));
  world.createCollider(RAPIER.ColliderDesc.cuboid((F.x1 - F.x0) / 2 - 0.03, F.top / 2, (F.z1 - F.z0) / 2 - 0.03).setFriction(0.8), lb);
  return lb;
}

function setAlarm(phase) { state.alarm = phase; state.alarmT = 0; }

const arena = {
  id: 'station', name: 'Space Station', wipeText: 'TABLETOP', loadingText: 'Docking with the station…',
  help: `<p>A cargo bay with its loading door blown open. Stay inside: drift out of the door and you're gone. Last ones standing win.</p>
    <p><b>Gamepad:</b> left stick move, <kbd>A</kbd> jump, hold <kbd>LT</kbd>/<kbd>RT</kbd> left/right hand (press lightly for a short reach), <kbd>RB</kbd> both hands, right stick or D-pad aim (look up + let go = throw), hold <kbd>Y</kbd> play dead, <kbd>Start</kbd> this help. Press any button to join.</p>
    <p><b>Keyboard P1:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, <kbd>Space</kbd> jump, <kbd>F</kbd> grab, <kbd>Q</kbd> play dead, <kbd>R</kbd>/<kbd>V</kbd> aim. <b>P2:</b> arrows, <kbd>/</kbd> jump, <kbd>.</kbd> grab, <kbd>K</kbd> play dead, <kbd>L</kbd>/<kbd>,</kbd> aim (press to join).</p>
    <p>Red lights and a klaxon = decompression: grab a yellow rail (under the catwalk or on the side walls) and hold on until the air stops. Don't jump while it's blowing.</p>
    <p>Glowing circle = power surge (shelter under the catwalk). Growing shadow = micrometeor. Glowing lane = runaway cargo. Yellow claw shadow = loader arm (jump the shockwave).</p>`,
  theme: { '--bg': '#0b1024', '--panel': 'rgba(18, 24, 44, 0.92)', '--accent': '#f2c230', '--accent-ink': '#1d1f26', '--line': '#5d6678', '--edge': '#0b1024',
    '--shadow': '#2a1f5a', '--glow': 'rgba(120, 200, 255, 0.55)', '--wipe-a': '#3b5bdb', '--wipe-b': '#2fa4a8', '--wipe-c': '#0b1024' },
  assets: { pieces: { GLB_BASE64, SUPPORT } },
  camera: STATION_CAMERA,
  ledges: [
    [L.BAY.x0 + 0.3, 0.0, L.BAY.z1 + 0.05, L.BAY.x1 - 0.3, 0.0, L.BAY.z1 + 0.05],                       // the open door's lip
    [-8.8, L.CATWALK.y, L.CATWALK.z1 + 0.05, 8.8, L.CATWALK.y, L.CATWALK.z1 + 0.05],                      // catwalk front edge
    ...L.RAILS.map((rl) => [...rl.a, ...rl.b]),                                                          // grab rails
  ],
  props: [
    { name: 'canister1', shape: 'cyl', size: [0.24, 0.62], mass: 12, pos: [-3.6, 0.4, -0.6], mesh: (T) => { const g = new T.Group(); g.add(new T.Mesh(new T.CylinderGeometry(0.24, 0.24, 0.62, 16), new T.MeshStandardMaterial({ color: '#e8edf5', roughness: 0.4 }))); const b = new T.Mesh(new T.CylinderGeometry(0.245, 0.245, 0.14, 16), new T.MeshStandardMaterial({ color: '#e2402c' })); g.add(b); return g; } },
    { name: 'canister2', shape: 'cyl', size: [0.24, 0.62], mass: 12, pos: [3.8, 0.4, 1.4], mesh: (T) => { const g = new T.Group(); g.add(new T.Mesh(new T.CylinderGeometry(0.24, 0.24, 0.62, 16), new T.MeshStandardMaterial({ color: '#e8edf5', roughness: 0.4 }))); const b = new T.Mesh(new T.CylinderGeometry(0.245, 0.245, 0.14, 16), new T.MeshStandardMaterial({ color: '#2f7fe0' })); g.add(b); return g; } },
    { name: 'toolbox', shape: 'box', size: [0.6, 0.32, 0.32], mass: 14, pos: [-8.2, 0.4, 3.2], mesh: (T) => new T.Mesh(new T.BoxGeometry(0.6, 0.32, 0.32), new T.MeshStandardMaterial({ color: '#d8402c', roughness: 0.4, metalness: 0.3 })) },
    { name: 'foodpack', shape: 'box', size: [0.42, 0.42, 0.42], mass: 9, pos: [7.4, 0.4, -2.4], mesh: (T) => new T.Mesh(new T.BoxGeometry(0.42, 0.42, 0.42), new T.MeshStandardMaterial({ color: '#f6f2ea', roughness: 0.8 })) },
    { name: 'helmet', shape: 'sphere', size: 0.26, mass: 8, pos: [1.6, 2.6, -4.5], mesh: (T) => { const g = new T.Group(); g.add(new T.Mesh(new T.SphereGeometry(0.26, 18, 12), new T.MeshStandardMaterial({ color: '#f4f6fa', roughness: 0.3 }))); const v = new T.Mesh(new T.SphereGeometry(0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), new T.MeshStandardMaterial({ color: '#3a7bd5', roughness: 0.1, metalness: 0.4 })); v.rotation.x = Math.PI / 2; v.position.z = 0.1; g.add(v); return g; } },
  ],
  spawns: L.SPAWNS,
  surfaces: {
    points: L.POINTS, heightAt: L.heightAt, inBounds: L.inBay, killY: L.KILL_Y,
    groundHeight: (x, z) => (L.inBay(x, z) ? L.heightAt(x, z) : -1e9),
  },
  overboard: [0, 0.6, 7.0],
  // every knock is tilted toward the open door and a little stronger: the bay is big and only one side is open
  hitBias(p, imp) {
    const h = Math.hypot(imp.x, imp.z); if (h < 1e-3) return imp;
    const dx = imp.x / h, dz = imp.z / h + 0.9, n = Math.hypot(dx, dz) || 1;
    imp.x = dx / n * h * 1.15; imp.z = dz / n * h * 1.15; return imp;
  },
  debrisKnock: { minSpeed: 5, minMass: 15, massRef: 160 },
  disasters: ['decompress', 'meteor', 'lightning', 'stampede', 'stomp'],
  secondDisaster: 'decompress',   // the hull gives way late in every round: the air starts rushing out
  escalation: { sub1: 'The hull is giving way', big2: 'HOLD ON!', sub2: 'Everything is breaking loose' },
  botHints: {
    edgeDist: L.edgeDist,
    obstacles: L.OBSTACLES,
    prefer: (pt) => (pt[3] === 'catwalk' ? 0.3 : 0),
    // which way the handhold is from a 'rail' point
    holdDir: (pt) => (pt[1] < L.CATWALK.z1 ? [0, -1] : [Math.sign(pt[0]) || 1, 0]),
  },
  hazardConfig: {
    decompress: {
      dir: [0, 1], near: (x, z) => Math.max(0, Math.min(1, (z - L.BAY.z0) / (L.BAY.z1 - L.BAY.z0))), holdTag: 'rail',
      arrows: [[-7.5, 0], [-4.5, 3.4], [-1.5, 3.4], [2.8, -2.4], [4.5, 3.6], [7.5, 0], [-3.2, -2.6], [7.8, -2.4]],
      safe: [{ x0: -8, x1: 8, z0: -5.4, z1: -4.7, y: 0, label: 'GRAB RAILS' }],
      onPhase: (phase) => setAlarm(phase),
    },
    meteor: {
      title: 'MICROMETEORS', hint: 'Rocks punch through the open roof · watch the glowing shadows',
      filter: (pt) => pt[3] !== 'under' && pt[3] !== 'catwalk' && pt[1] > -2.2, ringColor: '#ff7a2a',   // the front two thirds
    },
    lightning: { title: 'POWER SURGE', hint: 'Sparks arc down from the cables · shelter under the catwalk', shelterTag: 'under' },
    stampede: {
      title: 'RUNAWAY CARGO', hint: 'Glowing lane = rolling canisters · step out of it',
      axis: 'x', lanes: L.CARGO_LANES, span: [L.BAY.x0 - 0.4, L.BAY.x1 + 0.4],
      heightAt: (x, z) => Math.max(0, L.heightAt(x, z)), makeRunner: makeCanister,
      knockSide: () => 1,    // hit players are thrown toward the open door
      levels: [{ gap: 4.2, lanes: 1, speed: 7.5, tele: 1.9, n: 3 }, { gap: 3.8, lanes: 2, speed: 9.0, tele: 1.7, n: 4 }, { gap: 3.4, lanes: 2, speed: 10.5, tele: 1.6, n: 4 }],
    },
    stomp: {
      title: 'LOADER ARM', hint: "Get out of the claw's shadow · jump the shockwave", radius: 1.8,
      makeHand: () => makeClaw(), filter: (pt) => pt[3] !== 'under' && pt[1] > -2.6,
      levels: [{ gap: 3.6, n: 1, tele: 1.9 }, { gap: 3.4, n: 2, tele: 1.7 }, { gap: 3.2, n: 2, tele: 1.6 }],   // a big bay: claws come sooner and in pairs
    },
  },

  occluders: () => state.visuals?.occluders || [],
  init(ctx) { state.visuals = buildStatic(ctx); state.smash = createSmash({ THREE, minSpeed: 1.6, minMass: 30 }); },
  build(ctx) {
    state.lift = buildColliders(ctx); state.liftT = 0; setAlarm('idle');
    state.tracked = []; state.brokenEver = new Set(); state.smash.clear();
    for (const spec of L.PIECES) {
      const piece = ctx.D.addPiece(spec.def, { position: new THREE.Vector3(...spec.pos).add(new THREE.Vector3(0, 0.005, 0)), rotationY: spec.rotY || 0, name: spec.name });
      state.tracked.push({ name: spec.name, piece, spec });
      if (spec.def === 'console') state.smash.add(piece);   // the glass screen shatters when something big hits it
    }
  },
  disposeRound() { state.tracked = []; },
  update(dt, ctx) {
    state.liftT += dt;
    const F = L.LIFT, y = liftTop(state.liftT) - F.top / 2;
    state.lift?.setNextKinematicTranslation({ x: (F.x0 + F.x1) / 2, y, z: (F.z0 + F.z1) / 2 });
    state.alarmT += dt;
  },
  postStep(dt, ctx) {
    state.smash.update(ctx);
    if (Math.floor(ctx.now() * 10) === Math.floor((ctx.now() - dt) * 10)) return;
    for (const t of state.tracked) { const st = ctx.D.pieceState(t.piece); if (st && st.alive < st.total) state.brokenEver.add(t.name); }
  },
  render(dt, ctx) {
    const V = state.visuals, t = ctx.now();
    if (state.lift) { const p = state.lift.translation(); V.lift.position.set(p.x, p.y, p.z); }
    V.planet.rotation.y = t * 0.01; V.stars.rotation.y = t * 0.002;
    // alarm: strobing beacons while a decompression warning or surge is on
    const on = state.alarm === 'warn' || state.alarm === 'surge', k = on ? (Math.sin(state.alarmT * (state.alarm === 'surge' ? 18 : 10)) > 0 ? 1 : 0.15) : 0;
    V.beaconMat.emissiveIntensity = 2.5 * k; for (const l of V.alarmLights) l.intensity = 40 * k;
  },
  state(ctx) {
    if (!ctx.D) return null;
    return { lift: +(liftTop(state.liftT)).toFixed(2), alarm: state.alarm, broken: [...state.brokenEver] };
  },
  hooks(ctx, w) { w.__liftT = (s) => { state.liftT = s; }; },
};
export default arena;
