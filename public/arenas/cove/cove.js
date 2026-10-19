// TABLETOP map: Pirate Cove. The place: an island around a lagoon, a beached wreck that floats when the sea comes in,
// a cliff fort, a plank bridge, a pier. The art is in art.js, the shape in layout.js; this file builds the physics,
// runs the sea and the wreck, and tells the board mode what it needs (layout, markers, minigames, the flood hooks).
import * as THREE from 'three';
import * as L from './layout.js';
import { GLB_BASE64, SUPPORT } from '../ship/shippieces.js';
import { buildCoveArt } from './art.js';
import { createMarkers } from '../board/markers.js';

// the 8 corners of a ramp (a solid wedge down to its base, or a slab of `thick`)
function rampPts(r) {
  const out = [];
  for (const [a, y] of [[r.a0, r.y0], [r.a1, r.y1]]) for (const c of r.axis === 'z' ? [r.x0, r.x1] : [r.z0, r.z1]) {
    const lo = r.thick ? y - r.thick : r.base;
    for (const yy of [lo, y]) out.push(r.axis === 'z' ? [c, yy, a] : [a, yy, c]);
  }
  return out;
}
const SPACE_COLORS = { blue: '#4f8fe6', red: '#e2553f', chest: '#f2c335' };

const state = { art: null, shipRb: null, lift: 0, kick: 0, t: 0, wavesSeen: new WeakSet(), hill: false, hillGlow: null };
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
const O = L.SHIP.origin;

function buildColliders(ctx) {
  const { world, RAPIER } = ctx;
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const add = (d, fr = 0.7) => world.createCollider(d.setFriction(fr), rb);
  const box = (x0, y0, z0, x1, y1, z1, fr) => add(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2).setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), fr);
  // the ground: the art's terrain mesh is the physics mesh
  const geo = state.art.terrain.geometry, pos = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : Uint32Array.from({ length: pos.length / 3 }, (_, k) => k);
  add(RAPIER.ColliderDesc.trimesh(new Float32Array(pos), new Uint32Array(idx)), 0.8);
  const P = L.PIER; box(P.x0, P.y - 0.25, P.z0, P.x1, P.y, P.z1);
  const F = L.FORT; box(F.x0, L.SEABED_Y, F.z0, F.x1, F.y, F.z1);
  add(RAPIER.ColliderDesc.convexHull(new Float32Array(rampPts(L.FORT_RAMP).flat())), 0.8);
  add(RAPIER.ColliderDesc.convexHull(new Float32Array(rampPts(L.BRIDGE).flat())), 0.8);
  for (const s of L.STONES) add(RAPIER.ColliderDesc.cylinder((s.y - L.LAGOON.floor + 0.2) / 2, s.r).setTranslation(s.x, (s.y + L.LAGOON.floor - 0.2) / 2, s.z), 0.9);
  // the wreck: one kinematic body, so the flood can float it (ship-local colliders)
  const ship = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(O[0], O[1], O[2]));
  const sadd = (d) => world.createCollider(d.setFriction(0.8), ship);
  const sbox = (b) => sadd(RAPIER.ColliderDesc.cuboid((b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2, (b.z1 - b.z0) / 2).setTranslation((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2));
  const S = L.SHIP; sbox(S.hull); sbox(S.castle);
  sadd(RAPIER.ColliderDesc.convexHull(new Float32Array(rampPts(S.castleRamp).flat())));
  sadd(RAPIER.ColliderDesc.convexHull(new Float32Array(rampPts(S.plank).flat())));
  sadd(RAPIER.ColliderDesc.cylinder(S.mast.h / 2, S.mast.r).setTranslation(S.mast.x, S.hull.y1 + S.mast.h / 2, S.mast.z));
  state.shipRb = ship; state.lift = 0; state.kick = 0;
}

// loose cargo that breaks (from the ship arena's baked pieces): reset with the world after every minigame
const CARGO = [
  { def: 'crate', pos: [0.25, L.PIER.y, 6.0], rotY: 0.3 }, { def: 'barrel', pos: [-0.45, L.PIER.y, 6.1] },
  { def: 'barrel', pos: [6.0, L.FORT.y, -4.6] }, { def: 'crate', pos: [3.1, L.FORT.y, -4.6], rotY: 0.5 },
  { def: 'crate', pos: [-6.3, 0, 2.2], rotY: -0.4 }, { def: 'barrel', pos: [6.1, 0, 2.4] },
  { def: 'barrel', pos: [-2.9, 0.8, -4.4] },
];

// spots on the wreck's deck for each bean (ship-local), turned into world points with the ship's current pose
const DECK_SPOTS = [[-0.3, 0.8, -0.65], [0.9, 0.8, 0.55], [-0.3, 0.8, 0.55], [1.3, 0.8, -0.65]];
function shipPoint(local) {
  const t = state.shipRb.translation(), r = state.shipRb.rotation();
  _v.set(local[0], local[1], local[2]).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(new THREE.Vector3(t.x, t.y, t.z));
  return _v.clone();
}

const arena = {
  id: 'cove', name: 'Pirate Cove', wipeText: 'TABLETOP', loadingText: 'Hoisting the sails…',
  theme: { '--accent': '#ffcf4a' },
  help: `<p>Every turn: <b>jump</b> to hit the die over your head, then <b>walk</b> to your arrow before time runs out.
    Where you're standing when time is up is where you land. Shove, grab and throw the others off their spaces.</p>
    <p><b style="color:${SPACE_COLORS.blue}">Blue</b> +3 coins · <b style="color:${SPACE_COLORS.red}">Red</b> −3 · <b style="color:#c99a10">Chest</b> +6 · stop on the <b style="color:#c99a10">star</b> with 10 coins to buy it.
    The stepping stones are a shortcut; the high road over the fort and the bridge has the treasure.</p>
    <p>After every turn a minigame is called: react from wherever you stand. Stay in the sea too long and you wash back to your space, minus 3 coins.</p>
    <p>Move: left stick / WASD · Jump: A / Space · Grab: LT, RT, RB / F · Look up to throw · Play dead: hold Y / Q</p>`,
  camera: { pitchDeg: 40, fov: 36, minDist: 12, maxDist: 25, padX: 1.4, padZ: 1.0, padY: 0.8, center: [0, 0.4, -0.2], homeSize: [14, 2, 9.5],
    centerPull: 0.2, lift: 0.2, zBias: 0.3, revealFrom: 9, revealTo: 26, revealCenter: [0, 0.6, -0.5], revealLift: 0.6, yMin: -0.6 },
  spawns: L.SPAWNS,
  surfaces: {
    points: L.POINTS, heightAt: L.heightAt, inBounds: L.inBounds, killY: L.KILL_Y, groundHeight: (x, z) => L.terrainH(x, z),
    hasFloor: (w, ctx) => !!ctx.surface.castDown(w.x, w.z, w.y + 0.5, 1.1),    // a bot may step down off the pier or a stone (0.6 m)
  },
  // static ledges, plus the wreck's edges where it is right now (riding on its body: climb back aboard from the sea)
  get ledges() {
    if (!state.shipRb) return L.LEDGES;
    return [...L.LEDGES, ...L.SHIP_LEDGES.map((s) => ({ a: shipPoint(s.slice(0, 3)).toArray(), b: shipPoint(s.slice(3)).toArray(), body: state.shipRb }))];
  },
  botHints: { edgeDist: L.edgeDist },
  water: { base: L.WATER_Y, rate: 0.6, buoyancy: 1.05, height: (level, x, z, t) => level + 0.03 * Math.sin(t * 1.3 + x * 0.6 + z * 0.4) },
  assets: { pieces: { GLB_BASE64, SUPPORT } },
  characterOptions: { drownTime: 1e9 },                   // the board decides what water does to you
  disasters: [],
  hazardConfig: {
    flood: {                                              // the waves of the flood minigame (baseY follows the water)
      axis: 'z', sides: [1, -1], across: { c: 0, len: 24 }, teleFrom: 10.5, frontStart: 7, frontEnd: 8, baseY: L.WATER_Y,
      levels: [{ gap: 5.5, h: 0.85, speed: 4.4, cap: 3 }, { gap: 4.6, h: 1.0, speed: 4.8, cap: 3 }, { gap: 3.9, h: 1.2, speed: 5.2, cap: 3 }],
      riseStep: 0, hitH: 1.15, push: 7, arrows: [-4, -2, 0, 2, 4], arrowsAt: 5.5, colors: { body: '#2f9bb0', foam: '#f2fbff' },
    },
    meteor: {                                             // the cannon fire minigame: balls lobbed from the ship offshore
      title: 'CANNON FIRE!', arc: 5, embers: false, ringColor: '#ff7a3a', impactColors: ['#e9d3a0', '#cbb07a', '#ffffff', '#2a2a2a'], impactSfx: 'boom',
      filter: (pt) => pt[3] !== 'ship',
      from: (target, rng) => new THREE.Vector3(target.x * 0.4 + (rng() - 0.5) * 4, 9, -24),
      makeRock: (ctx) => { const m = new THREE.Mesh(arena._ballGeo ||= new THREE.SphereGeometry(0.34, 14, 10), arena._ballMat ||= new THREE.MeshStandardMaterial({ color: '#2b2b30', roughness: 0.75, metalness: 0 })); m.castShadow = true; return m; },
      damage: { r: 1.25, amount: 70, impulse: 5 },
    },
  },
  dieAim: [0, 1.0],
  dieLost: (t, ctx) => t.y < (ctx.water ? ctx.water.level : L.WATER_Y) - 0.05,
  dieLostText: 'Splash! 1',

  init(ctx) {
    state.art = buildCoveArt({ THREE, scene: ctx.scene, renderer: ctx.renderer, L });
    arena.markers = createMarkers({ THREE, root: state.art.root, anchors: state.art.spaces, setSpaceColor: (id, c) => state.art.setSpaceColor(id, c) });
    // the captain's deck glows during its game
    const H = L.SHIP.castle;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(H.x1 - H.x0 - 0.1, H.z1 - H.z0 - 0.1), new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    glow.rotation.x = -Math.PI / 2; glow.position.set((H.x0 + H.x1) / 2, H.y1 + 0.03, (H.z0 + H.z1) / 2); glow.renderOrder = 2; state.art.ship.add(glow); state.hillGlow = glow;
  },
  build(ctx) {
    buildColliders(ctx);
    state.art.ship.position.set(O[0], O[1], O[2]); state.art.ship.quaternion.identity();
    for (const c of CARGO) ctx.D.addPiece(c.def, { position: new THREE.Vector3(...c.pos).add(new THREE.Vector3(0, 0.005, 0)), rotationY: c.rotY || 0, name: c.def });
  },
  // the wreck floats once the water passes its keel line, then rolls with the sea and with every wave that hits it
  update(dt, ctx) {
    state.t += dt; const t = state.t, W = ctx.water;
    const want = Math.max(0, W.level - L.SHIP.floatAt);
    state.lift += (want - state.lift) * Math.min(1, dt * 2.5);
    for (const h of ctx.hazards) if (h.name === 'flood') for (const it of h.items) {
      if (it.phase === 'run' && !state.wavesSeen.has(it) && Math.abs(it.front - O[2]) < 1.2) { state.wavesSeen.add(it); state.kick += 0.14 * it.side; ctx.cam.shake(0.25); ctx.fx.sfx('crash'); }
    }
    state.kick *= Math.exp(-dt * 0.9);
    const k = Math.min(1, state.lift / 0.6);
    const roll = k * (0.05 * Math.sin(t * 1.1) + state.kick * Math.sin(t * 3.2)), pitch = k * 0.03 * Math.sin(t * 0.8 + 1), heave = k * 0.07 * Math.sin(t * 1.7);
    _q.setFromEuler(_e.set(roll, 0, pitch));
    state.shipRb.setNextKinematicTranslation({ x: O[0], y: O[1] + state.lift + heave, z: O[2] });
    state.shipRb.setNextKinematicRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
  },
  postStep() {
    const t = state.shipRb.translation(), r = state.shipRb.rotation();
    state.art.ship.position.set(t.x, t.y, t.z); state.art.ship.quaternion.set(r.x, r.y, r.z, r.w);
  },
  render(dt, ctx) {
    state.art.water.update(ctx.water.level, state.t);
    state.art.update(dt, state.t);
    arena.markers.update(dt);
    state.hillGlow.material.opacity = state.hill ? 0.25 + 0.15 * Math.sin(state.t * 4) : 0;
  },
  moving: () => [state.art.ship],
  occluders: () => state.art.occluders || [],

  // ---- for the board mode
  layout: L,
  minigames: ['flood', 'cannon', 'hill'],
  minigameSkins: { hill: { title: "CAPTAIN'S DECK", hint: 'Hold the stern deck of the wreck' } },
  markers: null,                                          // created in init
  showHill(on) { state.hill = on; },
  flood: { level: 1.8, floatAt: L.SHIP.floatAt, deckSpot: (i) => { const v = shipPoint(DECK_SPOTS[i % 4]); return [v.x, v.z, v.y]; }, focus: () => [shipPoint([0, 0.8, 0])] },
  state: () => ({ lift: +state.lift.toFixed(2), starAt: arena.markers?.starAt }),
};
export default arena;
