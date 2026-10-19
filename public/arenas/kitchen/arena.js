// TABLETOP arena: Giant Kitchen. Toy-sized players on a giant kitchen counter in warm morning light: a sink basin
// (the low ground), a hob and a thick cutting board (high ground), and huge destructible things that topple like
// dominoes. Falling off the counter edge is a long way down. Built on the arena kit (../kit/KIT.md).
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { GLB_BASE64, SUPPORT } from './kitchenpieces.js';
import * as L from './layout.js';
import { createSmash } from '../kit/smash.js';

// ---------------------------------------------------------------- small helpers
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.02, ...o });
function addBox(parent, [x0, y0, z0], [x1, y1, z1], mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m;
}
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 4; return t;
}
const seeded = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
// platform corner points (base rect at y=0, inset top at y=P.y; closed sides keep the full rect)
function platformPts(P, open = { x0: true, x1: true, z0: true, z1: true }) {
  const i = P.inset, t = { x0: P.x0 + (open.x0 ? i : 0), x1: P.x1 - (open.x1 ? i : 0), z0: P.z0 + (open.z0 ? i : 0), z1: P.z1 - (open.z1 ? i : 0) };
  return [[P.x0, 0, P.z0], [P.x1, 0, P.z0], [P.x0, 0, P.z1], [P.x1, 0, P.z1], [t.x0, P.y, t.z0], [t.x1, P.y, t.z0], [t.x0, P.y, t.z1], [t.x1, P.y, t.z1]];
}
const RAMP_PTS = (() => { const r = L.SINK_RAMP, y = L.SINK.y; return [[r.x0, y, r.z0], [r.x1, y, r.z0], [r.x0, y, r.z1], [r.x1, y, r.z1], [r.x1, 0, r.z0], [r.x1, 0, r.z1]]; })();

// ---------------------------------------------------------------- skins: rolling fruit (stampede) and falling food (meteors)
const FRUIT = (() => {
  let cache = null;
  return () => cache || (cache = {
    orange: { geo: new THREE.SphereGeometry(0.74, 26, 18), mat: std('#f39a2b', { roughness: 0.55 }), r: 0.74 },
    apple: { geo: new THREE.SphereGeometry(0.7, 26, 18), mat: std('#d93b3b', { roughness: 0.35 }), r: 0.7 },
    lime: { geo: new THREE.SphereGeometry(0.62, 24, 16), mat: std('#7cc043', { roughness: 0.5 }), r: 0.62 },
    lemon: { geo: new THREE.SphereGeometry(0.64, 24, 16).scale(1, 1, 1.25), mat: std('#f5d63d', { roughness: 0.5 }), r: 0.64 },
    leaf: { geo: new THREE.ConeGeometry(0.16, 0.4, 5).rotateX(Math.PI / 2), mat: std('#3f8f3a') },
    stem: { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.3, 6), mat: std('#6b4a2a') },
  });
})();
function makeFruit(ctx, rng, lane, k) {
  const F = FRUIT(); const kinds = ['orange', 'apple', 'lemon', 'lime']; const kind = kinds[(lane + k) % 4];
  const f = F[kind]; const g = new THREE.Group(); const body = new THREE.Mesh(f.geo, f.mat); body.castShadow = true; g.add(body);
  // a stem + leaf on the side so the roll reads
  const st = new THREE.Mesh(F.stem.geo, F.stem.mat); st.position.set(0, f.r * 0.98, 0); g.add(st);
  const lf = new THREE.Mesh(F.leaf.geo, F.leaf.mat); lf.position.set(0.12, f.r * 1.02, 0.12); g.add(lf);
  return { obj: g, r: f.r };
}
const FOOD = (() => {
  let cache = null;
  return () => cache || (cache = [
    { name: 'tomato', parts: [[new THREE.SphereGeometry(0.55, 20, 14).scale(1, 0.85, 1), std('#e2402c', { roughness: 0.35 })], [new THREE.ConeGeometry(0.28, 0.12, 5).translate(0, 0.5, 0), std('#3f8f3a')]], color: '#e2402c' },
    { name: 'meatball', parts: [[new THREE.IcosahedronGeometry(0.55, 1), std('#7a4a2e', { roughness: 0.9, flatShading: true })]], color: '#7a4a2e' },
    { name: 'cheese', parts: [[new THREE.CylinderGeometry(0.75, 0.75, 0.5, 3, 1, false, 0, Math.PI / 2.2), std('#f6c94a', { roughness: 0.6 })]], color: '#f6c94a' },
    { name: 'donut', parts: [[new THREE.TorusGeometry(0.42, 0.22, 12, 20).rotateX(Math.PI / 2), std('#d9a066')], [new THREE.TorusGeometry(0.42, 0.18, 10, 20).rotateX(Math.PI / 2).translate(0, 0.08, 0), std('#f58ab4', { roughness: 0.4 })]], color: '#f58ab4' },
  ]);
})();
let lastFood = null;
function makeFood(ctx, rng) {
  const all = FOOD(); const f = all[Math.floor(rng() * all.length)]; lastFood = f;
  const g = new THREE.Group(); for (const [geo, mat] of f.parts) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m); }
  g.scale.setScalar(1.15); g.userData.color = f.color; return g;
}

// loose fruit chunk meshes (a stem and a highlight so they read as fruit at couch distance)
function fruitMesh(color, r, berry = false) {
  return (T) => {
    const g = new T.Group();
    const b = new T.Mesh(berry ? new T.SphereGeometry(r, 18, 12).scale(1, 1.15, 1) : new T.SphereGeometry(r, 18, 12), new T.MeshStandardMaterial({ color, roughness: 0.35 })); g.add(b);
    const st = new T.Mesh(new T.CylinderGeometry(0.025, 0.03, 0.12, 6), new T.MeshStandardMaterial({ color: berry ? '#3f8f3a' : '#6b4a2a' })); st.position.y = r * (berry ? 1.15 : 1) + 0.03; g.add(st);
    return g;
  };
}
// The shared camera at 35 deg: faces and heights read, the whole counter and the front drop stay in view
export const KITCHEN_CAMERA = { pitchDeg: 35, fov: 36, minDist: 11.5, maxDist: 21, padX: 1.5, padZ: 0.8, padY: 0.7, center: [0, 0.2, 0.9], homeSize: [12, 1, 6],
  centerPull: 0.2, lift: 0.1, zBias: 0.15, revealFrom: 9, revealTo: 25, revealCenter: [0, 0.9, 0], revealLift: 0.6, yMin: -0.3 };

// ---------------------------------------------------------------- the arena module
const state = { tracked: [], splats: [], shelfQueue: [], faucet: null, visuals: null, toppledEver: new Set(), brokenEver: new Set() };

function buildStatic(ctx) {
  const { scene, renderer } = ctx;
  const root = new THREE.Group(); root.name = 'kitchen'; scene.add(root);
  scene.background = new THREE.Color('#f1d8b8');
  scene.fog = new THREE.Fog('#e8cba8', 22, 64);
  renderer.toneMappingExposure = 1.0;
  // warm morning light from the window (back right), soft sky fill, cool bounce from the room
  const hemi = new THREE.HemisphereLight('#fff1dc', '#b98d6a', 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd6a0', 2.4); sun.position.set(9, 17, -3); sun.target.position.set(0, 0, 0.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#cfe0ff', 0.45); fill.position.set(-8, 10, 14); scene.add(fill);

  const C = L.COUNTER;
  // counter top: cream laminate with a soft speckle, wooden front trim
  const speck = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#f4ead6'; g.fillRect(0, 0, w, h); const r = seeded(11); for (let i = 0; i < 900; i++) { g.fillStyle = r() < 0.5 ? 'rgba(160,130,100,0.18)' : 'rgba(255,255,255,0.5)'; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); } }, [6, 3]);
  const topMat = new THREE.MeshStandardMaterial({ map: speck, roughness: 0.55 });
  const S = L.SINK;
  for (const [a, b] of [[[C.x0, -C.thick, C.z0], [S.x0, 0, C.z1]], [[S.x1, -C.thick, C.z0], [C.x1, 0, C.z1]], [[S.x0, -C.thick, C.z0], [S.x1, 0, S.z0]], [[S.x0, -C.thick, S.z1], [S.x1, 0, C.z1]]]) addBox(root, a, b, topMat);
  const trim = std('#c98d55', { roughness: 0.6 });
  addBox(root, [C.x0 - 0.05, -C.thick - 0.05, C.z1 - 0.02], [C.x1 + 0.05, 0.02, C.z1 + 0.12], trim);
  for (const s of [-1, 1]) addBox(root, [s > 0 ? C.x1 - 0.02 : C.x0 - 0.12, -C.thick - 0.05, C.z0], [s > 0 ? C.x1 + 0.12 : C.x0 + 0.02, 0.02, C.z1 + 0.12], trim);
  // sink: stainless basin, drain, ramp (drainboard), faucet at the back
  const steel = std('#c9d2da', { roughness: 0.35, metalness: 0.25 });
  addBox(root, [S.x0, S.y - 0.3, S.z0], [S.x1, S.y, S.z1], steel);
  for (const [a, b] of [[[S.x0, S.y, S.z0 - 0.02], [S.x1, 0.01, S.z0 + 0.04]], [[S.x0, S.y, S.z1 - 0.04], [S.x1, 0.01, S.z1 + 0.02]], [[S.x0 - 0.02, S.y, S.z0], [S.x0 + 0.04, 0.01, S.z1]], [[S.x1 - 0.04, S.y, S.z0], [S.x1 + 0.02, 0.01, S.z1]]]) addBox(root, a, b, steel, { cast: false });
  const drain = new THREE.Mesh(new THREE.CircleGeometry(0.32, 20), std('#5a6470', { metalness: 0.6, roughness: 0.4 })); drain.rotation.x = -Math.PI / 2; drain.position.set(-6.3, S.y + 0.01, -2.0); root.add(drain);
  const ramp = new THREE.Mesh(new ConvexGeometry(RAMP_PTS.map((p) => new THREE.Vector3(...p))), std('#e7edf2', { roughness: 0.35, metalness: 0.4 })); ramp.castShadow = ramp.receiveShadow = true; root.add(ramp);
  for (let i = 0; i < 5; i++) { const z = L.SINK_RAMP.z0 + 0.12 + i * 0.19; const r = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.04, 0.05), steel); r.position.set((L.SINK_RAMP.x0 + L.SINK_RAMP.x1) / 2, S.y / 2 + 0.03, z); r.rotation.z = Math.atan2(-S.y, L.SINK_RAMP.x1 - L.SINK_RAMP.x0); root.add(r); }
  const chrome = std('#eef2f6', { roughness: 0.22, metalness: 0.3 });
  const fBase = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 2.4, 16), chrome); fBase.position.set(-5.6, 1.2, -3.78); fBase.castShadow = true; root.add(fBase);
  const fArc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.16, 10, 20, Math.PI), chrome); fArc.position.set(-5.6, 2.4, -3.23); fArc.rotation.y = Math.PI / 2; fArc.castShadow = true; root.add(fArc);
  const fSpout = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.35, 12), chrome); fSpout.position.set(-5.6, 2.25, -2.68); root.add(fSpout);
  for (const s of [-1, 1]) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 12), std(s < 0 ? '#e86a5a' : '#5a8fe0', { roughness: 0.4 })); k.position.set(-5.6 + s * 0.75, 0.15, -3.75); root.add(k); }
  const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 1, 10, 1, true), new THREE.MeshStandardMaterial({ color: '#bfe8ff', transparent: true, opacity: 0.7, roughness: 0.1 }));
  stream.visible = false; root.add(stream);
  // cutting board + hob
  const board = new THREE.Mesh(new ConvexGeometry(platformPts(L.BOARD).map((p) => new THREE.Vector3(...p))), std('#d9a066', { roughness: 0.75 })); board.castShadow = board.receiveShadow = true; root.add(board);
  const grain = std('#c48a52', { roughness: 0.8 });
  for (let i = 0; i < 6; i++) { const z = L.BOARD.z0 + L.BOARD.inset + 0.15 + i * 0.27; const gm = new THREE.Mesh(new THREE.BoxGeometry(2.6 - (i % 2) * 0.8, 0.012, 0.035), grain); gm.position.set(-1.2 + (i % 3) * 0.2, L.BOARD.y + 0.006, z); root.add(gm); }
  const hob = new THREE.Mesh(new ConvexGeometry(platformPts(L.STOVE, L.STOVE_OPEN).map((p) => new THREE.Vector3(...p))), std('#2c2a33', { roughness: 0.25, metalness: 0.3 })); hob.castShadow = hob.receiveShadow = true; root.add(hob);
  const burners = [];
  for (const [x, z, hot] of [[4.6, -1.4, false], [6.25, -1.4, true], [4.6, -3.2, false], [6.25, -3.2, false]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 32), new THREE.MeshStandardMaterial({ color: hot ? '#ff5a24' : '#5a2a2a', emissive: hot ? '#ff4a10' : '#000000', emissiveIntensity: hot ? 0.9 : 0, roughness: 0.4 }));
    ring.rotation.x = Math.PI / 2; ring.position.set(x, L.STOVE.y + 0.01, z); root.add(ring);
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.05, 8, 24), ring.material); ring2.rotation.x = Math.PI / 2; ring2.position.copy(ring.position); root.add(ring2);
    burners.push(ring);
  }
  for (let i = 0; i < 4; i++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.14, 14), std('#e9e2d6', { roughness: 0.4 })); k.position.set(4.2 + i * 0.85, 0.17, -0.38); k.rotation.x = 0.55; root.add(k); }
  // back wall: tiled splashback, window with morning sky, shelf with brackets, a wall clock
  const tiles = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#d8c7aa'; g.fillRect(0, 0, w, h); for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 5 === 0 ? '#9ccbd6' : '#fbf3e4'; g.fillRect(x * 64 + 3, y * 64 + 3, 58, 58); } }, [15, 4]);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(60, 16), new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.6 })); wall.position.set(0, 8 - 0.0, C.z0); wall.receiveShadow = true; root.add(wall);
  const W = L.WINDOW;
  const sky = canvasTex(256, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9fd2f0'); gr.addColorStop(0.65, '#fde2b8'); gr.addColorStop(1, '#ffc98a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const sg = g.createRadialGradient(w * 0.7, h * 0.72, 4, w * 0.7, h * 0.72, 70); sg.addColorStop(0, 'rgba(255,250,220,1)'); sg.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = sg; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(120,170,110,0.9)'; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(i * 32 + 10, h, 30 + (i % 3) * 10, 0, Math.PI * 2); g.fill(); } });
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(W.x1 - W.x0, W.y1 - W.y0), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false })); pane.position.set((W.x0 + W.x1) / 2, (W.y0 + W.y1) / 2, C.z0 + 0.02); root.add(pane);
  const frameM = std('#fbf7f0', { roughness: 0.5 });
  addBox(root, [W.x0 - 0.25, W.y0 - 0.25, C.z0], [W.x1 + 0.25, W.y0, C.z0 + 0.3], frameM); addBox(root, [W.x0 - 0.25, W.y1, C.z0], [W.x1 + 0.25, W.y1 + 0.25, C.z0 + 0.3], frameM);
  for (const x of [W.x0 - 0.25, (W.x0 + W.x1) / 2 - 0.1, W.x1]) addBox(root, [x, W.y0, C.z0], [x + 0.25, W.y1, C.z0 + 0.25], frameM);
  addBox(root, [W.x0, (W.y0 + W.y1) / 2 - 0.08, C.z0], [W.x1, (W.y0 + W.y1) / 2 + 0.08, C.z0 + 0.2], frameM);
  const curtain = std('#f7d77a', { roughness: 0.9 });
  for (const x of [W.x0 - 0.9, W.x1 + 0.2]) { const c = addBox(root, [x, W.y0 - 0.6, C.z0 + 0.3], [x + 0.7, W.y1 + 0.2, C.z0 + 0.5], curtain); c.castShadow = false; }
  // light shafts from the window across the counter (subtle, additive)
  const shaftMat = new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 11), shaftMat); s.position.set(1.6 + i * 2.1, 4.5, -1.2); s.rotation.set(-0.45, 0, 0.42); root.add(s); }
  const Sh = L.SHELF; const wood = std('#b9824e', { roughness: 0.7 });
  addBox(root, [Sh.x0, Sh.y, Sh.z0], [Sh.x1, Sh.y + Sh.t, Sh.z1], wood);
  for (const x of [-6.8, -0.4, 6.8]) { const b = addBox(root, [x - 0.1, Sh.y - 0.9, Sh.z0], [x + 0.1, Sh.y, Sh.z0 + 0.7], wood); b.castShadow = false; }
  const clock = new THREE.Group(); clock.position.set(-4.4, 6.9, C.z0 + 0.06); root.add(clock);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 32), std('#fffaf0')); face.rotation.x = Math.PI / 2; clock.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.1, 8, 32), std('#e8665a')); clock.add(rim);
  const hand1 = addBox(clock, [-0.04, 0, 0.07], [0.04, 0.75, 0.1], std('#3a2a20')); hand1.rotation.z = -0.9;
  const hand2 = addBox(clock, [-0.05, 0, 0.1], [0.05, 0.5, 0.13], std('#3a2a20')); hand2.rotation.z = 2.4;
  // cabinets below the counter, down to the tiled floor far below
  const cab = std('#8fb59a', { roughness: 0.65 }), knob = std('#e9d9b8', { roughness: 0.3, metalness: 0.4 });
  addBox(root, [C.x0 + 0.2, L.FLOOR_Y + 0.6, C.z1 - 0.6], [C.x1 - 0.2, -C.thick, C.z1 - 0.3], cab);
  for (let i = 0; i < 4; i++) { const x0 = C.x0 + 0.5 + i * 3.85; addBox(root, [x0, L.FLOOR_Y + 1.2, C.z1 - 0.3], [x0 + 3.5, -C.thick - 0.6, C.z1 - 0.2], std('#9dc2a8', { roughness: 0.6 })); const k = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), knob); k.position.set(x0 + (i % 2 ? 0.4 : 3.1), -C.thick - 2.2, C.z1 - 0.1); root.add(k); }
  addBox(root, [C.x0 + 0.2, L.FLOOR_Y, C.z1 - 0.9], [C.x1 - 0.2, L.FLOOR_Y + 0.6, C.z1 - 0.6], std('#3b2e2a'));
  // the floor far below: darker and hazier than the counter, with a soft contact shadow under the cabinets, so the drop reads
  const checker = canvasTex(128, 128, (g) => { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#9a5244' : '#c2b6a2'; g.fillRect(x * 64, y * 64, 64, 64); } }, [45, 33]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 66), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.85 })); floor.rotation.x = -Math.PI / 2; floor.position.set(0, L.FLOOR_Y, 20); floor.receiveShadow = true; root.add(floor);
  const ao = canvasTex(256, 128, (g, w, h) => { const gr = g.createRadialGradient(w / 2, h * 0.2, 10, w / 2, h * 0.2, w * 0.55); gr.addColorStop(0, 'rgba(40,20,10,0.75)'); gr.addColorStop(0.55, 'rgba(40,20,10,0.4)'); gr.addColorStop(1, 'rgba(40,20,10,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const aoM = new THREE.Mesh(new THREE.PlaneGeometry(34, 22), new THREE.MeshBasicMaterial({ map: ao, transparent: true, depthWrite: false })); aoM.rotation.x = -Math.PI / 2; aoM.position.set(0, L.FLOOR_Y + 0.02, 6); root.add(aoM);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(5, 40), std('#4f78b8', { roughness: 0.95 })); rug.rotation.x = -Math.PI / 2; rug.scale.set(1.6, 1, 1); rug.position.set(-6, L.FLOOR_Y + 0.03, 12); rug.receiveShadow = true; root.add(rug);
  const rug2 = new THREE.Mesh(new THREE.RingGeometry(3.6, 4.2, 40), std('#f2d27a', { roughness: 0.95 })); rug2.rotation.x = -Math.PI / 2; rug2.scale.set(1.6, 1, 1); rug2.position.set(-6, L.FLOOR_Y + 0.05, 12); root.add(rug2);
  // water: one plane over the counter (hidden under the top until it rises; visible in the basin), spill sheets at the edges
  const waterMat = new THREE.MeshStandardMaterial({ color: '#6cc4e6', transparent: true, opacity: 0.66, roughness: 0.08, metalness: 0.1, depthWrite: false });
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(C.x1 - C.x0, C.z1 - C.z0, 32, 16), waterMat); waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.set(0, -5, 0); waterMesh.renderOrder = 2; root.add(waterMesh);
  const fallTex = canvasTex(64, 256, (g, w, h) => { g.fillStyle = 'rgba(190,232,255,0.55)'; g.fillRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.75)'; const r = seeded(5); for (let i = 0; i < 40; i++) g.fillRect(r() * w, r() * h, 2, 18 + r() * 30); }, [12, 1]);
  const fallMat = new THREE.MeshBasicMaterial({ map: fallTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const falls = [];
  for (const [w, x, z, ry] of [[16, 0, C.z1 + 0.14, 0], [8, C.x0 - 0.14, 0, Math.PI / 2], [8, C.x1 + 0.14, 0, Math.PI / 2]]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(w, 1), fallMat); f.position.set(x, 0, z); f.rotation.y = ry; f.visible = false; root.add(f); falls.push(f); }
  return { root, hemi, sun, waterMesh, waterMat, falls, fallTex, fallMat, stream, burners, clockHands: [hand1, hand2], occluders: [fBase, fArc, fSpout] };
}

function buildColliders(ctx) {
  const { world, RAPIER } = ctx; const C = L.COUNTER, S = L.SINK;
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (d, fr = 0.6) => world.createCollider(d.setFriction(fr), rb);
  const cub = (x0, y0, z0, x1, y1, z1, fr) => add(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), fr);
  cub(C.x0, -C.thick, C.z0, S.x0, 0, C.z1); cub(S.x1, -C.thick, C.z0, C.x1, 0, C.z1); cub(S.x0, -C.thick, C.z0, S.x1, 0, S.z0); cub(S.x0, -C.thick, S.z1, S.x1, 0, C.z1);
  cub(S.x0, S.y - 0.4, S.z0, S.x1, S.y, S.z1);
  const hull = (pts, fr) => add(RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flat())), fr);
  hull(RAMP_PTS, 0.6); hull(platformPts(L.BOARD), 0.7); hull(platformPts(L.STOVE, L.STOVE_OPEN), 0.5);
  cub(-30, 0, C.z0 - 0.6, 30, 16, C.z0);                                                 // back wall
  const Sh = L.SHELF; cub(Sh.x0, Sh.y, Sh.z0, Sh.x1, Sh.y + Sh.t, Sh.z1, 0.8);
  cub(-5.95, 0, -4.0, -5.25, 2.4, -3.45, 0.4);                                           // faucet base
  cub(-45, L.FLOOR_Y - 1, -4, 45, L.FLOOR_Y, 50, 0.8);                                   // floor far below (debris lands there)
  cub(C.x0 + 0.2, L.FLOOR_Y, C.z1 - 0.9, C.x1 - 0.2, -C.thick, C.z1 - 0.3);               // cabinets
}

function trackedMain(ctx, t) {
  let best = null; for (const rec of ctx.D.bodies) if (rec.piece === t.piece && (!best || rec.chunks.length > best.chunks.length)) best = rec;
  return best;
}
function objState(ctx, t) {
  const rec = trackedMain(ctx, t); const st = ctx.D.pieceState(t.piece);
  if (!rec) return { name: t.name, gone: true, alive: st?.alive ?? 0, total: t.piece.chunks.length };
  const q = rec.rb.rotation(); const upY = 1 - 2 * (q.x * q.x + q.z * q.z); const p = rec.rb.translation();
  return { name: t.name, tilt: +THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, upY)))).toFixed(1), y: +p.y.toFixed(2), x: +p.x.toFixed(2), z: +p.z.toFixed(2), alive: st.alive, total: st.total, pieces: st.islands.length + st.looseDebris };
}

function knockShelf(ctx, idx, delay = 1.5) {
  const t = state.tracked.filter((q) => q.spec.shelf)[idx]; if (!t || t.knocked) return false;
  const rec = trackedMain(ctx, t); if (!rec || rec.rb.translation().y < L.SHELF.y) return false;
  t.knocked = true;
  const p = rec.rb.translation(); const land = new THREE.Vector3(p.x, Math.max(0, L.heightAt(p.x, -2.3)), -2.3);
  const tele = ctx.fx.circleTele(ctx.group, land, 1.0, '#ff7a2a');
  const danger = { kind: 'circle', x: land.x, z: land.z, r: 1.3 }; ctx.dangers.push(danger);
  state.shelfQueue.push({ t, at: ctx.now() + delay, tele, danger });
  return true;
}

const arena = {
  id: 'kitchen', name: 'Giant Kitchen', wipeText: 'TABLETOP', loadingText: 'Warming up the kitchen…',
  help: `<p>You're toy-sized on a giant kitchen counter. Don't fall off the edge, it's a long way down. Last ones standing win.</p>
    <p><b>Gamepad:</b> left stick move, <kbd>A</kbd> jump, hold <kbd>RT</kbd>/<kbd>RB</kbd> grab, right stick or D-pad aim (look up + let go = throw), <kbd>Start</kbd> this help. Press any button to join.</p>
    <p><b>Keyboard P1:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, <kbd>Space</kbd> jump, <kbd>F</kbd> grab, <kbd>R</kbd>/<kbd>V</kbd> aim. <b>P2:</b> arrows, <kbd>/</kbd> jump, <kbd>.</kbd> grab, <kbd>L</kbd>/<kbd>,</kbd> aim (press to join).</p>
    <p>Grab fruit and throw it at people, grab people and throw them off the edge. Fell off? Grab the edge, look up and climb back.</p>
    <p>Glowing lane = fruit stampede. Growing hand shadow = giant stomp (jump the shockwave). Rising water = sink overflow (climb the board or the hob). Shadow + food = food fight.</p>`,
  theme: { '--bg': '#2a1a12', '--panel': 'rgba(58, 34, 24, 0.92)', '--accent': '#ffb547', '--accent-ink': '#3a2214', '--line': '#a8774a', '--edge': '#2a1a12',
    '--shadow': '#6a2e1a', '--glow': 'rgba(255, 170, 80, 0.6)', '--wipe-a': '#ffcf7a', '--wipe-b': '#e8894a', '--wipe-c': '#5a2414' },
  assets: { pieces: { GLB_BASE64, SUPPORT } },
  camera: KITCHEN_CAMERA,
  // ledges players can hang off and climb back from (local segments [x0, y0, z0, x1, y1, z1]): the counter's front and
  // side edges (on the trim), the sink rims (climb out of the basin), the cutting-board and hob top rims
  ledges: [
    [L.COUNTER.x0 - 0.1, 0.02, L.COUNTER.z1 + 0.12, L.COUNTER.x1 + 0.1, 0.02, L.COUNTER.z1 + 0.12],
    [L.COUNTER.x0 - 0.12, 0.02, L.COUNTER.z0 + 0.2, L.COUNTER.x0 - 0.12, 0.02, L.COUNTER.z1 + 0.1],
    [L.COUNTER.x1 + 0.12, 0.02, L.COUNTER.z0 + 0.2, L.COUNTER.x1 + 0.12, 0.02, L.COUNTER.z1 + 0.1],
    [L.SINK.x0, 0, L.SINK.z1, L.SINK.x1, 0, L.SINK.z1], [L.SINK.x0, 0, L.SINK.z0, L.SINK.x0, 0, L.SINK.z1],
    [L.BOARD.x0 + L.BOARD.inset, L.BOARD.y, L.BOARD.z1 - L.BOARD.inset, L.BOARD.x1 - L.BOARD.inset, L.BOARD.y, L.BOARD.z1 - L.BOARD.inset],
    [L.STOVE.x0 + L.STOVE.inset, L.STOVE.y, L.STOVE.z1 - L.STOVE.inset, L.STOVE.x1 - L.STOVE.inset, L.STOVE.y, L.STOVE.z1 - L.STOVE.inset],
  ],
  // loose fruit chunks and crumbs to grab and throw (toy scale: a grape is a beach ball)
  props: [
    { name: 'grape1', shape: 'sphere', size: 0.24, mass: 10, pos: [-4.4, 0.3, 2.5], mesh: fruitMesh('#7d3f9e', 0.24) },
    { name: 'grape2', shape: 'sphere', size: 0.24, mass: 10, pos: [-3.9, 0.3, 3.1], mesh: fruitMesh('#9bd04e', 0.24) },
    { name: 'blueberry', shape: 'sphere', size: 0.2, mass: 8, pos: [4.3, 0.3, 3.1], mesh: fruitMesh('#3d4f9e', 0.2) },
    { name: 'strawberry', shape: 'sphere', size: 0.27, mass: 12, pos: [3.0, 0.35, -1.3], mesh: fruitMesh('#e0383a', 0.27, true) },
    { name: 'sugar', shape: 'box', size: [0.4, 0.4, 0.4], mass: 12, pos: [6.5, 0.3, 3.2], mesh: (T) => new T.Mesh(new T.BoxGeometry(0.4, 0.4, 0.4), new T.MeshStandardMaterial({ color: '#fbf8f2', roughness: 0.9 })) },
    { name: 'grape3', shape: 'sphere', size: 0.24, mass: 10, pos: [-1.0, 0.3, -1.9], mesh: fruitMesh('#7d3f9e', 0.24) },
  ],
  spawns: L.SPAWNS,
  surfaces: {
    points: L.POINTS, heightAt: L.heightAt, inBounds: L.inCounter, killY: L.KILL_Y,
    groundHeight: (x, z) => (L.inCounter(x, z) ? L.heightAt(x, z) : L.FLOOR_Y),
  },
  overboard: [0, 0.6, 5.0],
  debrisKnock: { minSpeed: 5, minMass: 15, massRef: 160 },
  characterOptions: { slideK: 0.12 },
  disasters: ['stampede', 'stomp', 'flood', 'meteor'],
  escalation: { sub1: 'The kitchen fights back', big2: 'HOLD ON!', sub2: 'Everything is falling over' },
  botHints: {
    edgeDist: L.edgeDist,
    obstacles: L.OBSTACLES,
    // in the basin: walk to the drainboard ramp and up it
    route(from, to) {
      if (from[2] > -0.4) return null;
      const r = L.SINK_RAMP; const zc = (r.z0 + r.z1) / 2;
      if (from[0] < r.x0 - 0.2 || Math.abs(from[1] - zc) > 0.4) return [r.x0 - 0.4, zc, L.SINK.y];
      return [r.x1 + 0.7, zc, 0];
    },
    prefer: (pt) => (pt[3] === 'counter' ? 0 : 0.4),
  },
  water: {
    base: -1.05, rate: 0.7, buoyancy: 1.0,
    // flat water over the counter area (and in the basin), slight ripple; nothing outside the counter
    height: (level, x, z, t) => (L.inCounter(x, z) ? level + 0.03 * Math.sin(0.9 * x + 1.7 * t) * Math.sin(0.7 * z - 1.1 * t) : -1e9),
  },
  hazardConfig: {
    stampede: {
      title: 'FRUIT STAMPEDE', hint: 'Glowing lane = rolling fruit · step out of it',
      axis: 'x', lanes: L.STAMPEDE_LANES, span: [L.COUNTER.x0 - 0.2, L.COUNTER.x1 + 0.2],
      heightAt: (x, z) => Math.max(0, L.heightAt(x, z)), makeRunner: makeFruit,
      knockSide: () => -1,   // throw hit players toward the back wall, never toward the open front edge
    },
    stomp: {
      title: 'GIANT STOMP', hint: 'Get out of the growing hand shadow · jump the shockwave', radius: 1.8, skinColor: '#f0b08a',
      onSlam(wp, ctx) { if (wp.z < -0.8) { const shelf = state.tracked.filter((q) => q.spec.shelf && !q.knocked); let bi = -1, bd = 3.2; shelf.forEach((q, i) => { const d = Math.abs(q.spec.pos[0] - wp.x); if (d < bd) { bd = d; bi = state.tracked.filter((s) => s.spec.shelf).indexOf(q); } }); if (bi >= 0) knockShelf(ctx, bi, 0.25); } },
    },
    flood: {
      title: 'SINK OVERFLOW', hint: 'Water rises in surges · climb the board or the hob · jump the surge',
      safe: [{ x0: L.BOARD.x0 + L.BOARD.inset, x1: L.BOARD.x1 - L.BOARD.inset, z0: L.BOARD.z0 + L.BOARD.inset, z1: L.BOARD.z1 - L.BOARD.inset, y: L.BOARD.y, label: 'HIGH GROUND' },
        { x0: L.STOVE.x0 + L.STOVE.inset, x1: L.STOVE.x1 - L.STOVE.inset, z0: L.STOVE.z0 + 0.4, z1: L.STOVE.z1 - L.STOVE.inset, y: L.STOVE.y, label: 'HOB' }],
      axis: 'x', sides: [-1], across: { c: 0, len: 8.2 }, teleFrom: 5.6, frontStart: 3.9, frontEnd: 8.6, baseY: 0, arrowY: 0,
      levels: [{ gap: 7.0, h: 0.42, speed: 4.2, cap: 0.12 }, { gap: 6.0, h: 0.58, speed: 4.8, cap: 0.26 }, { gap: 5.0, h: 0.72, speed: 5.4, cap: 0.42 }],
      riseStep: 0.17, firstSurgeRises: true, hitH: 0.56, push: 11,
      shelter: (l) => l.y > 0.22,   // the board and the hob are the promised safe zones: surges wash past them
      arrows: [-3, -1.5, 0, 1.5, 3], arrowsAt: 3.0, colors: { body: '#7cc8e8', foam: '#ffffff' },
    },
    meteor: {
      title: 'FOOD FIGHT', hint: 'Food falls off the shelf · watch the growing shadows',
      makeRock: (ctx, rng) => makeFood(ctx, rng), arc: 2.5, easeIn: true,
      from: (target, rng) => new THREE.Vector3(Math.max(-7, Math.min(7, target.x + (rng() - 0.5) * 3)), L.SHELF.y + 1.0, -3.5),
      damage: { r: 1.2, amount: 60, impulse: 4 }, embers: false, ringColor: '#ff9a3a', impactColors: ['#e2402c', '#f6c94a', '#7a4a2e', '#f58ab4'], impactSfx: 'splat',
      onImpact(wp, ctx) {
        const col = lastFood?.color || '#e2402c';
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.8 + ctx.R.fx() * 0.4, 18), new THREE.MeshStandardMaterial({ color: col, roughness: 0.3, transparent: true, opacity: 0.85, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.set(wp.x, wp.y + 0.025, wp.z); m.renderOrder = 1; ctx.group.add(m); state.splats.push(m);
        if (state.splats.length > 14) { const o = state.splats.shift(); ctx.group.remove(o); o.geometry.dispose(); o.material.dispose(); }
      },
    },
  },

  occluders: () => state.visuals?.occluders || [],
  init(ctx) { state.visuals = buildStatic(ctx); state.smash = createSmash({ THREE, minSpeed: 1.6, minMass: 30 }); },
  build(ctx) {
    buildColliders(ctx);
    state.tracked = []; state.splats = []; state.shelfQueue = []; state.toppledEver = new Set(); state.brokenEver = new Set(); state.smash.clear();
    for (const spec of L.PIECES) {
      const piece = ctx.D.addPiece(spec.def, { position: new THREE.Vector3(...spec.pos).add(new THREE.Vector3(0, 0.005, 0)), rotationY: spec.rotY || 0, name: spec.name });
      state.tracked.push({ name: spec.name, piece, spec });
      if (/^(plate|mug|jar)/.test(spec.def)) state.smash.add(piece);   // ceramic and glass shatter when something big hits them
    }
  },
  disposeRound() { state.tracked = []; state.splats = []; state.shelfQueue = []; },
  onEscalate(level, ctx) {
    // the shelf rattles: jars wobble (telegraph ring where they'll land), then topple off
    const shelf = state.tracked.filter((q) => q.spec.shelf); const free = shelf.map((q, i) => i).filter((i) => !shelf[i].knocked);
    for (let k = 0; k < level && free.length; k++) knockShelf(ctx, free.splice(Math.floor(ctx.R.arena() * free.length), 1)[0]);
  },
  update(dt, ctx) {
    // basin fills first when the sink overflows
    if (ctx.water && ctx.hazards.some((h) => h.name === 'flood') && ctx.water.target < -0.3) ctx.water.setTarget(-0.3);
    // shelf jars: wobble during the telegraph, then a nudge off the front of the shelf
    for (let i = state.shelfQueue.length - 1; i >= 0; i--) {
      const q = state.shelfQueue[i]; const now = ctx.now();
      const rec = trackedMain(ctx, q.t);                                   // re-resolve: the jar may have broken (its body freed)
      const done = () => { q.tele.dispose(); const j = ctx.dangers.indexOf(q.danger); if (j >= 0) ctx.dangers.splice(j, 1); state.shelfQueue.splice(i, 1); };
      if (!rec) { done(); continue; }
      const rb = rec.rb;
      q.tele.ring.material.opacity = 0.5 + 0.5 * Math.sin(now * 20);
      if (now < q.at) { if (Math.floor(now * 8) !== Math.floor((now - dt) * 8)) { const m = rb.mass(); const p = rb.translation(); rb.applyImpulseAtPoint({ x: (Math.floor(now * 8) % 2 ? 1 : -1) * m * 0.25, y: 0, z: 0 }, { x: p.x, y: p.y + 0.9, z: p.z }, true); } continue; }
      if (!q.pushed) { q.pushed = true; const m = rb.mass(); const p = rb.translation(); rb.applyImpulseAtPoint({ x: 0, y: m * 0.6, z: m * 2.6 }, { x: p.x, y: p.y + 1.0, z: p.z }, true); ctx.fx.sfx('whoosh'); q.at = now + 1.6; continue; }
      done();
    }
  },
  postStep(dt, ctx) {
    state.smash.update(ctx);
    // remember what toppled / broke (for the HUD-free tests and the domino-chain check)
    if (Math.floor(ctx.now() * 10) === Math.floor((ctx.now() - dt) * 10)) return;
    for (const t of state.tracked) {
      const s = objState(ctx, t);
      if (s.gone || s.tilt > 50 || (t.spec.shelf && s.y < L.SHELF.y - 0.5)) state.toppledEver.add(t.name);
      if (s.alive < s.total) state.brokenEver.add(t.name);
    }
  },
  render(dt, ctx) {
    const V = state.visuals; const w = ctx.water; const t = ctx.now();
    if (w) {
      const lv = w.level; V.waterMesh.visible = lv > L.SINK.y - 0.02; V.waterMesh.position.y = lv + 0.01 + 0.015 * Math.sin(t * 1.3);
      const spill = Math.max(0, Math.min(1, (lv - 0.01) * 10));
      V.fallMat.opacity = 0.5 * spill; V.fallTex.offset.y = -t * 1.6;
      for (const f of V.falls) { f.visible = spill > 0; const h = lv - L.FLOOR_Y; f.scale.y = h; f.position.y = lv - h / 2; }
      const flooding = ctx.hazards.some((h) => h.name === 'flood');
      V.stream.visible = flooding; if (flooding) { const top = 2.1, bot = Math.max(L.SINK.y, lv); V.stream.scale.y = top - bot; V.stream.position.set(-5.6, (top + bot) / 2, -2.68); if (ctx.R.fx() < 0.4) ctx.fx.puff(new THREE.Vector3(-5.6 + (ctx.R.fx() - 0.5) * 0.6, bot + 0.05, -2.68 + (ctx.R.fx() - 0.5) * 0.6), { color: '#ffffff', v: [(ctx.R.fx() - 0.5) * 2, 1.5, (ctx.R.fx() - 0.5) * 2], size: 0.3, grow: 1.2, life: 0.5, a: 0.8, g: 6 }); }
    }
    V.burners[1].material.emissiveIntensity = 0.75 + 0.2 * Math.sin(t * 2.2);
    V.clockHands[0].rotation.z = -0.9 - t * 0.02; V.clockHands[1].rotation.z = 2.4 - t * 0.0017;
  },
  state(ctx) {
    if (!ctx.D) return null;
    return { toppled: [...state.toppledEver], broken: [...state.brokenEver], smashes: state.smash.count, objects: state.tracked.map((t) => objState(ctx, t)), shelfQueue: state.shelfQueue.length };
  },
  hooks(ctx, w) {
    w.__pushDomino = (i = 0, dir = 1, k = 1) => { const t = state.tracked.find((q) => q.name === 'domino' + i); const rec = t && trackedMain(ctx, t); if (!rec) return false; const m = rec.rb.mass(); const p = rec.rb.translation(); rec.rb.applyImpulseAtPoint({ x: dir * m * 1.6 * k, y: 0, z: 0 }, { x: p.x, y: p.y + 1.1, z: p.z }, true); return true; };
    w.__knockShelf = (i, delay = 1.5) => knockShelf(ctx, i, delay);
  },
};
export default arena;
