// TABLETOP board: the place. A folded toy playset on a wooden table in a warm room, with the game box lid standing
// at the back: a front track, two ramps, a back terrace with a tower (the hill), and a narrow shortcut bridge.
// Spaces are painted discs. The rules live in mode.js (and rules.js); this file builds the world and draws the
// board's own markers: which spaces each bean can reach this turn, where its walk ends, and the star.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import * as L from './layout.js';
import { createMarkers } from './markers.js';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
function addBox(parent, b, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.x1 - b.x0, b.y1 - b.y0, b.z1 - b.z0), mat); m.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2);
  m.castShadow = cast; m.receiveShadow = receive; parent.add(m); return m;
}
function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); t.anisotropy = 4; return t;
}
const seeded = (s) => () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
// the 8 corners of a ramp (a solid wedge down to its base, or a slab of `thick`)
function rampPts(r) {
  const out = [];
  for (const [a, y] of [[r.a0, r.y0], [r.a1, r.y1]]) for (const c of r.axis === 'z' ? [r.x0, r.x1] : [r.z0, r.z1]) {
    const lo = r.thick ? y - r.thick : (r.name.startsWith('towerRamp') ? L.TERRACE_Y : 0);
    for (const yy of [lo, y]) out.push(r.axis === 'z' ? [c, yy, a] : [a, yy, c]);
  }
  return out;
}

export const SPACE_COLORS = { blue: '#4f8fe6', red: '#e2553f', star: '#f2c335' };

function buildStatic(ctx) {
  const { scene, renderer } = ctx;
  const root = new THREE.Group(); root.name = 'board'; scene.add(root);
  scene.background = new THREE.Color('#e9d6bf');
  scene.fog = new THREE.Fog('#e3cdb2', 26, 70);
  renderer.toneMappingExposure = 1.0;
  const hemi = new THREE.HemisphereLight('#fff3e2', '#a98468', 1.2); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe0b8', 2.3); sun.position.set(-7, 16, 6); sun.target.position.set(0, 0, -0.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#d6e4ff', 0.5); fill.position.set(8, 9, 12); scene.add(fill);

  // the table: warm wood with a grain, thick edge
  const T = L.TABLE;
  const grain = canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#b07a4f'; g.fillRect(0, 0, w, h); const r = seeded(5);
    for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${r() < 0.5 ? '90,52,30' : '210,160,110'},${0.12 + r() * 0.15})`; g.lineWidth = 1 + r() * 3; g.beginPath(); const y = r() * h; g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 4); g.stroke(); }
  }, [3, 2]);
  addBox(root, { x0: T.x0, x1: T.x1, y0: -T.thick, y1: 0, z0: T.z0, z1: T.z1 }, new THREE.MeshStandardMaterial({ map: grain, roughness: 0.75 }));
  const legMat = std('#8a5a38');
  for (const [x, z] of [[T.x0 + 0.5, T.z0 + 0.5], [T.x1 - 0.5, T.z0 + 0.5], [T.x0 + 0.5, T.z1 - 0.5], [T.x1 - 0.5, T.z1 - 0.5]]) addBox(root, { x0: x - 0.35, x1: x + 0.35, y0: L.FLOOR_Y, y1: -T.thick, z0: z - 0.35, z1: z + 0.35 }, legMat);
  // the room below: floorboards and a rug
  const boards = canvasTex(256, 256, (g, w, h) => { g.fillStyle = '#9b6d4a'; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 32) { g.fillStyle = 'rgba(60,35,20,0.35)'; g.fillRect(0, y, w, 2); } }, [12, 12]);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshStandardMaterial({ map: boards, roughness: 0.9 })); floor.rotation.x = -Math.PI / 2; floor.position.y = L.FLOOR_Y; floor.receiveShadow = true; root.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(13, 48), std('#c4574a')); rug.rotation.x = -Math.PI / 2; rug.position.set(0, L.FLOOR_Y + 0.02, 3); rug.receiveShadow = true; root.add(rug);

  // the game box lid standing at the back, with the cover art
  const lidArt = canvasTex(1024, 320, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a2a6a'); gr.addColorStop(1, '#6a3a7a'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    const r = seeded(9); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(255,230,160,${0.2 + r() * 0.5})`; g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 3, 0, 7); g.fill(); }
    g.font = '900 150px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#1c1030'; g.fillText('TABLETOP', w / 2 + 6, h / 2 + 8); g.fillStyle = '#ffd04a'; g.fillText('TABLETOP', w / 2, h / 2);
  });
  const lidSide = std('#4a3270');
  const lid = new THREE.Mesh(new THREE.BoxGeometry(14.8, 4.5, 0.4), [lidSide, lidSide, lidSide, lidSide, new THREE.MeshStandardMaterial({ map: lidArt, roughness: 0.8 }), lidSide]);
  lid.position.set(0, 2.25, T.z0 - 0.2); lid.castShadow = lid.receiveShadow = true; root.add(lid);

  // the playset: cream track, mint terrace, a pink tower with a crown rim
  const trackMat = std('#f3e6cc'), terraceMat = std('#bfe3cf'), towerMat = std('#f2b6c6'), bridgeMat = std('#e98a7a');
  const mats = { front: trackMat, left: trackMat, right: trackMat, terrace: terraceMat, tower: towerMat };
  for (const b of L.BOXES) addBox(root, b, mats[b.name]);
  for (const r of L.RAMPS) {
    const g = new ConvexGeometry(rampPts(r).map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    const m = new THREE.Mesh(g, r.name === 'bridge' ? bridgeMat : r.name.startsWith('towerRamp') ? towerMat : trackMat); m.castShadow = m.receiveShadow = true; root.add(m);
  }
  // crenellations on the tower's back corners (decor only, no collider: they're behind the lid line)
  const H = L.HILL;
  for (const x of [H.x0 + 0.2, H.x1 - 0.2]) addBox(root, { x0: x - 0.2, x1: x + 0.2, y0: H.y, y1: H.y + 0.35, z0: H.z0 + 0.05, z1: H.z0 + 0.45 }, towerMat);

  // spaces: painted discs (the star's disc turns gold)
  const discGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.05, 32);
  const discs = L.SPACES.map((s) => {
    const m = new THREE.Mesh(discGeo, std(SPACE_COLORS[s.kind], { roughness: 0.6 }));
    m.position.set(s.x, s.y + 0.03, s.z); m.receiveShadow = true;
    const r = L.RAMPS.find((q) => q.axis === 'z' && L.rampHeight(q, s.x, s.z) != null && Math.abs(L.rampHeight(q, s.x, s.z) - s.y) < 0.01);
    if (r && s.y > L.TRACK_Y + 0.05 && s.y < L.TERRACE_Y - 0.05) m.rotation.x = Math.atan2(r.y1 - r.y0, r.a0 - r.a1);   // lie flat on the slope
    root.add(m); return m;
  });
  // the hill's glow (king of the hill)
  const hillGlow = new THREE.Mesh(new THREE.PlaneGeometry(H.x1 - H.x0 - 0.1, H.z1 - H.z0 - 0.1), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  hillGlow.rotation.x = -Math.PI / 2; hillGlow.position.set((H.x0 + H.x1) / 2, H.y + 0.02, (H.z0 + H.z1) / 2); hillGlow.renderOrder = 2; root.add(hillGlow);
  const flag = new THREE.Group();
  addBox(flag, { x0: -0.04, x1: 0.04, y0: 0, y1: 1.6, z0: -0.04, z1: 0.04 }, std('#6b4a2a'));
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), std('#ffd04a', { side: THREE.DoubleSide })); cloth.position.set(0.37, 1.35, 0); flag.add(cloth);
  flag.position.set((H.x0 + H.x1) / 2, H.y, H.z0 + 0.35); flag.visible = false; root.add(flag);
  return { root, discs, hillGlow, flag, cloth, discMats: discs.map((d) => d.material) };
}

function buildColliders(ctx) {
  const { world, RAPIER } = ctx; const T = L.TABLE;
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (d, fr = 0.7) => world.createCollider(d.setFriction(fr), rb);
  const cub = (b, fr) => add(RAPIER.ColliderDesc.cuboid((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2).setTranslation((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2), fr);
  cub({ x0: T.x0, x1: T.x1, y0: -T.thick, y1: 0, z0: T.z0, z1: T.z1 });
  cub({ x0: -7.4, x1: 7.4, y0: 0, y1: 4.5, z0: T.z0 - 0.4, z1: T.z0 });                       // the box lid
  for (const b of L.BOXES) cub(b);
  for (const r of L.RAMPS) add(RAPIER.ColliderDesc.convexHull(new Float32Array(rampPts(r).flat())), 0.8);
  cub({ x0: -60, x1: 60, y0: L.FLOOR_Y - 1, y1: L.FLOOR_Y, z0: -60, z1: 60 });                  // the room floor (dice and debris land there)
}

const state = { v: null, t: 0, hill: false };

const arena = {
  id: 'board', name: 'The Playset', wipeText: 'TABLETOP',
  theme: { '--accent': '#ffd04a' },
  help: `<p>Every turn: <b>jump</b> to hit the die over your head, then <b>walk</b> to the space it lights up before time runs out.
    Where your bean is standing when time is up is where you land. Shove, grab and throw the others off their spaces.</p>
    <p><b style="color:${SPACE_COLORS.blue}">Blue</b> +3 coins · <b style="color:${SPACE_COLORS.red}">Red</b> −3 coins · stop on the <b style="color:#c99a10">star</b> with 10 coins to buy it.
    The red bridge in the middle is a shortcut. Fall off the table and you lose 3 coins.</p>
    <p>After each turn a minigame is called: react from wherever you stand. Most stars after the last turn wins (then coins).</p>
    <p>Move: left stick / WASD · Jump: A / Space · Grab: LT, RT, RB / F · Look up to throw · Play dead: hold Y / Q</p>`,
  camera: { pitchDeg: 40, fov: 36, minDist: 12, maxDist: 24, padX: 1.4, padZ: 1.0, padY: 0.8, center: [0, 0.8, 0], homeSize: [13, 2, 8.5],
    centerPull: 0.2, lift: 0.2, zBias: 0.3, revealFrom: 8, revealTo: 24, revealCenter: [0, 1, -0.5], revealLift: 0.6, yMin: -0.5 },
  spawns: L.SPAWNS,
  surfaces: {
    points: L.POINTS,
    heightAt: (x, z) => { const h = L.heightAt(x, z); return Number.isFinite(h) ? h : L.FLOOR_Y; },
    inBounds: L.inTable, killY: L.KILL_Y, groundHeight: () => L.FLOOR_Y,
  },
  ledges: L.LEDGES,
  botHints: { edgeDist: L.edgeDist },
  disasters: [],

  init(ctx) {
    state.v = buildStatic(ctx);
    arena.markers = createMarkers({ THREE, root: state.v.root, anchors: state.v.discs,
      setSpaceColor: (id, c) => state.v.discMats[id].color.set(c ?? SPACE_COLORS[L.SPACES[id].kind]) });
  },
  build(ctx) { buildColliders(ctx); },
  render(dt) {
    const V = state.v; state.t += dt; const t = state.t;
    arena.markers.update(dt);
    V.hillGlow.material.opacity = state.hill ? 0.25 + 0.15 * Math.sin(t * 4) : 0;
    V.flag.visible = state.hill; V.cloth.rotation.y = 0.25 * Math.sin(t * 3);
  },
  // ---- for the board mode
  layout: L,
  minigames: ['hill'],
  markers: null,                         // created in init (board/markers.js)
  showHill(on) { state.hill = on; },
  state: () => ({ starAt: arena.markers?.starAt }),
};
export default arena;
