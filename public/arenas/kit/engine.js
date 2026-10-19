// Engine shared by every game mode: renderer, fixed 60 Hz step, physics world, players, bots, destruction, water,
// hazards, shared camera, render interpolation, adaptive quality and the generic test hooks. A place module (an
// arena or the board) supplies the world; a mode (run.js's disaster round, board/mode.js) supplies the rules.
//   const eng = await createEngine(place, { persistSlots });  eng.buildWorld();  eng.start(mode);
// Mode hooks (all optional unless noted):
//   tick(dt)                      first thing every step (phase clocks)
//   input(edges, dt) -> true      consume this step's input (the step ends there)
//   playerState(p) (required)     -> { locked, invulnerable, bot } for this step
//   botThink(p, dt, botCtx)       -> controller input, or undefined for the default arena bot
//   armed() -> bool               hazards may hurt; knocks() -> bool: flying debris knocks players over
//   onFall(p)                     a player dropped below killY (default: out)
//   onOut(p, { cause, at })       a player is out (fall, water)
//   view(dt)                      frame the camera (cam.frame / cam.reveal) and set the HUD timer
//   cutaway() -> bool             fade walls in front of players this frame (default true)
//   chips() -> [{ name, color, out, human, sub? }]
//   onFrame(ms, stats)            once per drawn frame (benchmarks); lockQuality() -> bool
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import RAPIER from 'rapier';
import { createDestruction, loadLibrary } from './destruct.js';
import { streams } from './round.js';
import { createSharedCamera, createCutaway } from './camera.js';
import { createLooseProps } from './props.js';
import { createInput } from './input.js';
import { createHUD } from './hud.js';
import { createFX } from './fx.js';
import { createBot } from './bots.js';
import { loadCharacter, loadHero } from './players.js';

export const DT = 1 / 60;
export const COLORS = ['#ef5a4f', '#3f86e8', '#43b65a', '#f2b51c'];
const VOICE_PITCH = [1, 0.86, 1.15, 0.76];        // each bean sounds a little different
const IDLE = () => ({ x: 0, y: 0, jump: false, grab: false, aim: 0 });

function identityFrame() {
  return {
    toWorld: (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z),
    toLocal: (v, out = new THREE.Vector3()) => out.copy(v),
    dirToWorld: (x, z) => new THREE.Vector3(x, 0, z).normalize(),
    groundVelocity: (rb, p, out) => out.set(0, 0, 0),
    object: null,   // a moving arena sets this to the Object3D that carries its local-frame visuals
  };
}

export async function createEngine(arena, { allBots = false, persistSlots = false, lockQuality = false, ctxExtra = {} } = {}) {
  const Q = new URLSearchParams(location.search);
  const N_SLOTS = Math.max(2, Math.min(4, +(Q.get('n') || 4)));
  let mode = null;

  // ---------------------------------------------------------------- page, renderer, scene
  const hud = createHUD({ title: arena.name, helpHTML: arena.help || '', wipeText: arena.wipeText || 'TABLETOP', theme: arena.theme || {}, loadingText: arena.loadingText || 'Loading…' });
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  hud.stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 400);
  function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
  addEventListener('resize', resize); resize();

  let seed = +(Q.get('seed') || 1 + Math.floor((Date.now() % 1e6)));
  let R = streams(seed);
  const fxRng = () => R.fx();
  const fx = createFX({ THREE, scene, rng: fxRng });
  const cam = createSharedCamera({ THREE, camera, ...(arena.camera || {}), ...(Q.get('shake') === 'off' ? { maxShake: 0 } : {}) });   // ?shake=off for anyone who gets queasy
  const cutaway = createCutaway({ THREE, camera, ...(arena.cutaway || {}) });
  const input = createInput({ nSlots: N_SLOTS, allBots, onClaim: () => refreshChips(), persistKey: persistSlots ? 'tabletop.slots' : null });

  // ---------------------------------------------------------------- assets
  const [hero, createPlayers] = await Promise.all([loadHero(GLTFLoader), loadCharacter(Q.get('character'))]);
  const library = arena.assets?.pieces ? await loadLibrary({ THREE, GLTFLoader, glb: arena.assets.pieces.GLB_BASE64, support: arena.assets.pieces.SUPPORT }) : null;
  await RAPIER.init();

  // ---------------------------------------------------------------- shared context (fields refreshed per world)
  const frame = arena.frame || identityFrame();
  const group = new THREE.Group(); group.name = 'arena-local'; scene.add(group);   // per-world local-frame things (telegraphs, markers)
  const surf = arena.surfaces;
  const immunity = new Map();
  let simT = 0;
  const water = arena.water ? {
    level: arena.water.base, target: arena.water.base, rate: arena.water.rate ?? 0.6,
    raise(step, cap) { this.target = Math.max(this.target, Math.min(cap, this.target + step)); },
    setTarget(v) { this.target = v; },
    height: (x, z) => arena.water.height(water.level, x, z, simT),
  } : null;
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const notPlayer = (c) => !c.parent()?.userData?.player;
  function castDown(wx, wz, fromY = 20, maxD = 40) {
    ray.origin.x = wx; ray.origin.y = fromY; ray.origin.z = wz; ray.dir.x = 0; ray.dir.y = -1; ray.dir.z = 0;
    const h = ctx.world.castRay(ray, maxD, true, undefined, undefined, undefined, undefined, notPlayer);
    if (!h) return null; const toi = h.toi ?? h.timeOfImpact; return { p: new THREE.Vector3(wx, fromY - toi, wz), c: h.collider };
  }
  const hasFloor = surf.hasFloor ? (w) => surf.hasFloor(w, ctx) : (w) => !!castDown(w.x, w.z, w.y + 0.5, 0.6);
  const ctx = {
    THREE, RAPIER, scene, renderer, camera, cam, fx, hud, input, library, frame, group, arena, water,
    world: null, D: null, R, players: [], bots: [], hazards: [], dangers: [], round: null, simT: 0,
    surface: { points: surf.points, heightAt: surf.heightAt, hasFloor, castDown, inBounds: surf.inBounds },
    now: () => simT,
    living: () => ctx.players.filter((p) => !p.isOut),
    cfg: (n) => arena.hazardConfig?.[n] || {},
    isImmune: (p) => (immunity.get(p.index) || 0) > simT,
    hitPlayer(p, imp, stun, immune = 1.5, src = '?') {
      if (p.isOut || p.invulnerable || ctx.isImmune(p)) return false;
      if (arena.hitBias) imp = arena.hitBias(p, imp, src, ctx) || imp;         // e.g. tilt knocks toward the arena's danger edge
      p.lastHit = src + '@' + (ctx.round ? ctx.round.t : simT).toFixed(1); p.knock(imp, { stun }); immunity.set(p.index, simT + immune); cam.shake(0.3);
      ctx.hits.push({ t: +simT.toFixed(2), i: p.index, src }); return true;
    },
    hits: [], events: [],
    rumble: (i, s, ms) => input.rumble(i, s, ms),
    rumbleAll: (s, ms) => { for (const p of ctx.living()) input.rumble(p.index, s, ms); },
    chunksNear(wp, r) {
      const out = [];
      for (const pc of ctx.D.pieces) for (const ch of pc.chunks) {
        if (!ch.alive || !ch.mesh || !ch.body) continue; const e = ch.mesh.matrix.elements;
        if (Math.hypot(e[12] - wp.x, e[13] - wp.y, e[14] - wp.z) < r) out.push(ch);
      }
      return out;
    },
  };
  Object.assign(ctx, ctxExtra);
  arena.init?.(ctx);
  hud.loaded();

  function refreshChips() {
    const list = mode?.chips?.() || ctx.players.map((p) => ({ name: 'P' + (p.index + 1), color: p.color, out: p.isOut, human: input.isHuman(p.index) }));
    hud.chips(list);
  }

  // ---------------------------------------------------------------- per-world physics, players and bots
  function disposeWorld() {
    for (const h of ctx.hazards) h.dispose(); ctx.hazards.length = 0;
    for (const p of ctx.players) p.dispose(); ctx.players.group?.dispose?.(); ctx.players = [];
    ctx.props?.dispose(); ctx.props = null; cutaway.reset();
    arena.disposeRound?.(ctx);
    if (ctx.D) { ctx.D.dispose(); ctx.D = null; }
    if (ctx.world) { ctx.world.free(); ctx.world = null; }
    ctx.dangers.length = 0; ctx.hits.length = 0; ctx.events.length = 0; fx.clear();
    while (group.children.length) group.remove(group.children[0]);
  }
  function buildWorld() {
    mode?.beforeDispose?.();
    disposeWorld();
    R = streams(seed); ctx.R = R; simT = 0; ctx.simT = 0; immunity.clear();
    if (water) { water.level = water.target = arena.water.base; }
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); world.timestep = DT; ctx.world = world;
    ctx.D = library ? createDestruction({ THREE, RAPIER, scene, world, rng: R.destruct, library, options: {
      maxDebris: 110, minDebris: 50, debrisLife: 18, onEvent: onDestructEvent,
      killY: surf.killY != null ? surf.killY - 10 : -40, groundHeight: surf.groundHeight || (() => 0), ...(arena.destructOptions || {}),
    } }) : null;
    arena.build(ctx);
    ctx.props = createLooseProps(ctx, arena.props || []);
    const slots = [];
    for (let i = 0; i < N_SLOTS; i++) { const [sx, sy, sz] = arena.spawns[i]; slots.push({ index: i, color: COLORS[i], name: 'P' + (i + 1), hat: i, spawn: frame.toWorld(sx, sy, sz), facing: 0 }); }
    ctx.players = createPlayers({ THREE, RAPIER, world, scene, hero, SkeletonUtils, slots, options: {
      groundVelocity: frame.groundVelocity, waterHeight: water ? water.height : () => -1e9, cameraBasis: () => cam.basis,
      onSplash: (p) => fx.splash(p.position, 0.8),
      onOut: (p) => {
        const cause = p.fellOff ? 'fall' : (water && water.height(p.position.x, p.position.z) - p.position.y > 0.25) ? 'water' : 'out';   // (stand-ins clear inWater before onOut)
        mode?.onOut?.(p, { cause, at: frame.toLocal(p.position).toArray().map((v) => +v.toFixed(1)) });
        if (cause === 'water') fx.splash(p.position, 1.4); else { fx.burst(p.position, 14, { colors: ['#ffffff', p.color], speed: 3, up: 4, size: 0.5, life: 0.9, g: 6 }); fx.ring(p.position, p.color, 2); }
        if (cause !== 'water') fx.sfx('yelp', { pitch: VOICE_PITCH[p.index % 4] });
        fx.sfx('out'); cam.shake(0.35); refreshChips();
      },
      onKnock: (p) => input.rumble(p.index, 0.8, 250),
      ledges: arena.ledges ? worldLedges : null,
      onEvent: (type, p, what) => {
        const pitch = VOICE_PITCH[p.index % 4];
        if (type === 'jump') fx.sfx('boing', { pitch, vol: 0.8 });
        else if (type === 'land' && what > 3.5) fx.sfx('squish', { pitch, vol: Math.min(1, 0.25 + (what - 3.5) / 8) });
        else if (type === 'mantle') fx.sfx('hup', { pitch });
        else if (type === 'knockout') { fx.sfx('bonk', { pitch }); input.rumble(p.index, 0.6, 200); }
        if (type === 'throw') { fx.sfx('whoosh'); input.rumble(p.index, 0.4, 120); ctx.events.push({ t: +simT.toFixed(2), type, i: p.index, what: what?.index ?? what?.userData?.name ?? (what?.userData?.destruct ? 'debris' : '?') }); }
        else if (type === 'grab') { fx.sfx('pop', { pitch, vol: 0.8 }); input.rumble(p.index, 0.25, 80); ctx.events.push({ t: +simT.toFixed(2), type, i: p.index }); }
        else if (type === 'knockout' || type === 'mantle') ctx.events.push({ t: +simT.toFixed(2), type, i: p.index });
        if (ctx.events.length > 60) ctx.events.splice(0, ctx.events.length - 60);
        mode?.onPlayerEvent?.(type, p, what);
      },
      ...(arena.characterOptions || {}),
    } });
    ctx.bots = ctx.players.map(() => createBot(R.bots, { mischief: ctx.players.group?.isRagdoll ? 1 : 0 }));   // grab games need a character that grabs
  }
  function onDestructEvent(type, e) {
    if (type === 'islandDetached' && e.mass > 150) { cam.shake(0.45); fx.sfx('crash'); }
    else if (type === 'impact' && e.force > 2e5) cam.shake(0.2);
    arena.onDestructEvent?.(type, e, ctx);
  }

  // ---------------------------------------------------------------- ledges (arena.ledges: [[x0, y0, z0, x1, y1, z1]] local, or { a, b, body } world) -> world
  const ledgeOut = []; const _la = new THREE.Vector3(), _lb = new THREE.Vector3();
  function worldLedges() {
    const body = arena.ledgeBody?.(ctx) || null; ledgeOut.length = 0;
    for (const s of arena.ledges) {
      if (!Array.isArray(s)) { ledgeOut.push(s); continue; }              // a ready { a, b, body } (world, on a body of its own)
      frame.toWorld(s[0], s[1], s[2], _la); frame.toWorld(s[3], s[4], s[5], _lb); ledgeOut.push({ a: [_la.x, _la.y, _la.z], b: [_lb.x, _lb.y, _lb.z], body });
    }
    return ledgeOut;
  }

  // ---------------------------------------------------------------- fields + knocks
  const _ff = new THREE.Vector3();
  function waterField(p, v, info) {
    let fx0 = 0, fy = 0, fz = 0;
    if (water) {
      const wh = water.height(p.x, p.z); const sub = Math.max(0, Math.min(1, (wh - p.y) / Math.max(0.1, info.radius * 2) + 0.5));
      if (sub > 0) { fy += 1000 * 9.81 * info.volume * sub * (arena.water.buoyancy ?? 1.05); fx0 -= v.x * info.mass * 1.2 * sub; fy -= v.y * info.mass * 1.5 * sub; fz -= v.z * info.mass * 1.2 * sub; }
    }
    for (const h of ctx.hazards) if (h.field) { const [ax, az] = h.field(p, v, info); fx0 += ax; fz += az; }
    return fx0 || fy || fz ? _ff.set(fx0, fy, fz) : null;
  }
  function debrisKnocks() {
    const world = ctx.world;
    for (const p of ctx.players) {
      if (p.isOut || !p.collider || ctx.isImmune(p)) continue;
      for (const col of (p.bodyColliders || [p.collider])) world.contactPairsWith(col, (other) => {
        const rb = other.parent(); if (!rb || !rb.isDynamic() || !(rb.userData?.destruct || rb.userData?.loose)) return;
        if (p.holds?.(rb) || ctx.isImmune(p)) return;                                             // what you carry can't bowl you over
        const v = rb.linvel(); const rel = Math.hypot(v.x, v.y, v.z);
        const t = rb.translation(); const toward = (p.position.x - t.x) * v.x + (p.position.y + 0.6 - t.y) * v.y + (p.position.z - t.z) * v.z;
        const DK = arena.debrisKnock || {};
        if (rel < (DK.minSpeed ?? 4.5) || toward <= 0 || rb.mass() < (DK.minMass ?? 15)) return;
        let touching = false; world.contactPair(col, other, (m) => { if (m.numContacts() > 0) touching = true; }); if (!touching) return;
        const d = new THREE.Vector3(v.x, 0, v.z); if (d.lengthSq() < 0.01) d.set(1, 0, 0); d.normalize();
        const k = DK.massRef ? Math.min(1, 0.35 + rb.mass() / DK.massRef) : 1;   // small shards nudge, big chunks bowl you over
        ctx.hitPlayer(p, d.multiplyScalar(p.mass * 4 * k).setY(p.mass * 3 * k), 1.0 * k, 1.2, 'debris');
      });
    }
  }

  // ---------------------------------------------------------------- fixed step
  const _hf = new THREE.Vector3();
  const botCtx = {
    points: surf.points, hints: arena.botHints || {}, dangers: ctx.dangers,
    toLocal: (v) => frame.toLocal(v, new THREE.Vector3()), toWorld: (x, y, z) => frame.toWorld(x, y, z, new THREE.Vector3()), dirToWorld: frame.dirToWorld,
    cameraBasis: () => cam.basis, waterHeight: (x, z) => (water ? water.height(x, z) : -1e9), hasFloor,
    floorBelow: (w, depth) => !!castDown(w.x, w.z, w.y + 0.3, depth + 0.3),      // anything to land on within depth?
    // grabbable loose things in the local frame: [{ rb, x, z, y, mass }] (cached per step)
    grabbables() {
      if (botCtx._grab) return botCtx._grab; const out = [];
      const add = (rb, mass) => { const t = rb.translation(); const l = frame.toLocal(_hf.set(t.x, t.y, t.z), new THREE.Vector3()); out.push({ rb, x: l.x, z: l.z, y: l.y, mass, held: (rb.userData.holders || 0) > 0 }); };
      if (ctx.D) for (const rec of ctx.D.bodies) if (rec.type === 'dynamic' && !rec.fading && rec.rb.userData?.grabbable && rec.mass < 70) add(rec.rb, rec.mass);
      for (const rb of ctx.props?.bodies() || []) add(rb, rb.userData.mass);
      return (botCtx._grab = out);
    },
    players: () => ctx.players,
    phase: () => ctx.round?.phase,
    blocked: (pos, d) => { ray.origin.x = pos.x; ray.origin.y = pos.y + 0.35; ray.origin.z = pos.z; ray.dir.x = d.x; ray.dir.y = 0; ray.dir.z = d.z; const h = ctx.world.castRay(ray, 0.75, true, undefined, undefined, undefined, undefined, notPlayer); return !!h && !!h.collider.parent()?.isDynamic(); },
    others: [],
  };
  const evq = new RAPIER.EventQueue(true);
  let physMs = 0, charMs = 0;
  let botsOff = false;
  function tick(dt, frameMs) {
    simT += dt; ctx.simT = simT;
    mode.tick?.(dt);
    arena.update?.(dt, ctx);
    // input
    const { edges } = input.poll();
    if (edges.length) fx.audioOn();                      // counts as a gesture only where the browser already trusts the site
    if (mode.input?.(edges, dt)) { input.endStep(); return; }
    for (const e of edges) if (e.button === 9) hud.toggleHelp();
    if (input.keyEdge.has('KeyH')) hud.toggleHelp();
    input.endStep();
    // players
    botCtx.others = ctx.living().map((p) => { const l = frame.toLocal(p.position); return [l.x, l.z]; }); botCtx._grab = null;
    const tc0 = performance.now();
    ctx.players.group?.beforeUpdate?.(dt);
    for (const p of ctx.players) {
      if (p.isOut) continue;
      const st = mode.playerState(p);
      p.locked = st.locked; p.invulnerable = st.invulnerable;
      p.input = input.isHuman(p.index) ? input.read(p.index) : (!botsOff && st.bot) ? (mode.botThink?.(p, dt, botCtx) ?? ctx.bots[p.index].think(dt, p, botCtx)) : IDLE();
      p.update(dt);
    }
    const tc1 = performance.now();
    // hazards (hitboxes only while the mode says armed)
    const armed = !!mode.armed?.();
    for (const h of ctx.hazards) h.update(dt, simT, armed);
    if (ctx.D) { ctx.D.applyField(waterField, dt); ctx.D.preStep(dt); }
    ctx.props?.update(dt);
    const eq = ctx.D ? ctx.D.eventQueue : evq;
    const tw0 = performance.now();
    ctx.world.step(eq);
    const tw1 = performance.now();
    ctx.players.group?.afterStep?.(dt, eq);          // the character reads contact-force events before destruction drains them
    const tw2 = performance.now();
    if (ctx.D) ctx.D.postStep(dt, frameMs); else eq.drainContactForceEvents(() => {});
    ctx.props?.sync();
    physMs = physMs * 0.95 + 0.05 * (tw1 - tw0); charMs = charMs * 0.95 + 0.05 * ((tc1 - tc0) + (tw2 - tw1));
    arena.postStep?.(dt, ctx);
    for (const p of ctx.players) p.sync(dt);
    // falling off: out after a short fall, unless the mode puts them back
    for (const p of ctx.players) if (!p.isOut && !p.invulnerable && p.position.y < surf.killY) { if (mode.onFall) mode.onFall(p); else { p.fellOff = true; p.eliminate(); } }
    if (mode.knocks?.()) debrisKnocks();
    mode.postStep?.(dt);
    if (water) water.level += (water.target - water.level) * Math.min(1, dt * water.rate);
    fx.update(dt);
  }

  // the shared camera's points: living players (one flying off the arena, not hanging on, counts for less so the
  // shot doesn't chase them into the void), plus every live circle telegraph when asked (a warning off screen is an
  // unfair hit)
  const _fl = new THREE.Vector3(), _fp = [], dangerSeen = new WeakMap();
  function framePoints(withDangers = false) {
    _fp.length = 0;
    for (const p of ctx.living()) {
      const l = frame.toLocal(p.position, _fl), on = !surf.inBounds || surf.inBounds(l.x, l.z);
      _fp.push({ p: p.position, w: on || p.hanging ? 1 : 0.35 });
    }
    if (withDangers) for (const d of ctx.dangers) {
      if (d.kind !== 'circle') continue;
      if (!dangerSeen.has(d)) dangerSeen.set(d, simT);
      const y = Math.max(-1, Math.min(4, surf.heightAt ? surf.heightAt(d.x, d.z) : 0));
      // soft (never at a player's expense) and eased in over half a second, so a new warning doesn't jerk the shot
      _fp.push({ p: frame.toWorld(d.x, Number.isFinite(y) ? y : 0, d.z), w: Math.min(1, (simT - dangerSeen.get(d)) / 0.5), soft: true });
    }
    return _fp;
  }

  // ---------------------------------------------------------------- per-frame visuals
  const _cp = new THREE.Vector3();
  function updateView(dt) {
    mode.view(dt);
    cam.apply(dt);
    ctx.players.group?.render?.(dt, renderAlpha);
    arena.render?.(dt, ctx);
    if (mode.cutaway?.() ?? true) {
      const pts = []; for (const p of ctx.living()) { pts.push(_cp.copy(p.position).setY(p.position.y + 0.55).clone(), _cp.copy(p.position).setY(p.position.y + 1.0).clone()); }
      const cands = (arena.occluders?.(ctx) || []).concat(ctx.D ? ctx.D.group.children : []);
      group.traverse((o) => { if (o.isMesh) cands.push(o); });          // hazard props (a stomping hand, a tentacle) fade too
      cutaway.update(dt, pts, cands);
    }
    hud.update(simT);
    mode.hud?.(simT);
  }

  // ---------------------------------------------------------------- loop, adaptive quality
  let noRender = false, paused = false, quality = 0, slowFor = 0, renderAlpha = 1;
  // render interpolation for things moved by physics (debris, loose props, a moving arena): after each step remember
  // their last two poses; draw them blended by alpha, then put them back before the next step
  const interp = new Map();
  function interpTargets() { return [...(ctx.D?.group.children || []), ...(ctx.props?.group.children || []), ...(mode?.interpTargets?.() || []), frame.object].filter(Boolean); }
  function interpSnapshot() {
    const seen = new Set();
    for (const o of interpTargets()) {
      seen.add(o); let s = interp.get(o);
      if (!s) interp.set(o, s = { p0: o.position.clone(), p1: o.position.clone(), q0: o.quaternion.clone(), q1: o.quaternion.clone() });
      else { s.p0.copy(s.p1); s.q0.copy(s.q1); s.p1.copy(o.position); s.q1.copy(o.quaternion); }
    }
    for (const o of interp.keys()) if (!seen.has(o)) interp.delete(o);
  }
  function interpApply(a) { for (const [o, s] of interp) { o.position.lerpVectors(s.p0, s.p1, a); o.quaternion.slerpQuaternions(s.q0, s.q1, a); } }
  function interpRestore() { for (const [o, s] of interp) { o.position.copy(s.p1); o.quaternion.copy(s.q1); } }
  let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0, fps = 0, tickMs = 0;
  function adapt() {
    if (lockQuality || mode.lockQuality?.() || Q.get('quality') === 'high' || noRender || paused || quality >= 2) return;
    slowFor = fps < 45 ? slowFor + 0.5 : 0;
    if (slowFor < 4) return;
    slowFor = 0; quality++;
    if (quality === 1) { renderer.setPixelRatio(0.75); resize(); }
    if (quality === 2) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.isLight && o.castShadow) o.castShadow = false; if (o.material) o.material.needsUpdate = true; }); }
  }
  function frameLoop(now) {
    const ms = now - last; last = now;
    fpsAcc += ms; fpsN++; if (fpsAcc > 500) { fps = Math.round(1000 * fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; hud.fps(fps + ' fps' + (quality ? ' q' + quality : '')); hud.sound(fx.soundOn); adapt(); }
    if (!hud.helpOn) mode.onFrame?.(ms, { tickMs, physMs, charMs });
    if (!paused && !hud.helpOn) {
      // a 60 Hz display delivers frames a little early or late; treat near-16.7 ms frames as exactly one physics step,
      // otherwise jitter gives 0-then-2 steps per frame and everything visibly hitches
      acc += Math.min(0.1, (Math.abs(ms - 1000 * DT) < 2.5 ? 1000 * DT : ms) / 1000); let n = 0;
      const t0 = performance.now();
      while (acc >= DT && n < 3) { tick(DT, ms); interpSnapshot(); acc -= DT; n++; }
      if (n) tickMs = tickMs * 0.9 + 0.1 * (performance.now() - t0) / n;
      if (n === 3) acc = 0;
    }
    renderAlpha = paused || hud.helpOn ? 1 : Math.max(0, Math.min(1, acc / DT));
    if (!noRender) { interpApply(renderAlpha); updateView(Math.min(0.05, ms / 1000)); renderer.render(scene, camera); interpRestore(); }
    requestAnimationFrame(frameLoop);
  }

  // ---------------------------------------------------------------- generic test / tooling hooks (modes add their own)
  function installHooks() {
    window.__skip = (sec) => { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) tick(DT, 16); };
    window.__tick = tick;
    window.__pause = (on) => { paused = !!on; };
    window.__render = (on) => { noRender = !on; };
    window.__renderFrames = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) updateView(dt); renderer.render(scene, camera); };
    window.__view = (dt = 1 / 60) => { updateView(dt); camera.updateMatrixWorld(); };   // camera + visuals, no draw (probes)
    window.__teleport = (i, x, y, z) => { const p = ctx.players[i]; if (p && !p.isOut) p.teleport(frame.toWorld(x, y, z)); };
    window.__hazards = () => ctx.hazards;
    window.__botsOff = (on) => { botsOff = !!on; };
    window.__inject = (i, st) => input.inject(i, st);       // tests: drive slot i like a human controller ({ x, y, jump, grab, aim } or null)
    window.__players = () => ctx.players;
    window.__cam = cam;
    window.__ctx = ctx;
    Object.defineProperty(window, '__simTime', { configurable: true, get: () => simT });
  }

  return {
    ctx, hud, input, cam, fx, cutaway, scene, renderer, camera, frame, surf, water, N_SLOTS, Q,
    get seed() { return seed; }, set seed(v) { seed = v; },
    get simT() { return simT; },
    buildWorld, refreshChips, framePoints, tick,
    stats: () => ({ fps, tickMs: +tickMs.toFixed(2), physMs: +physMs.toFixed(2), charMs: +charMs.toFixed(2), quality, faded: cutaway.faded }),
    // set the rules and start the frame loop (call once, after the first buildWorld); modeHooks() adds the mode's
    // window hooks before the place's own (which may override them)
    start(m, modeHooks) { mode = m; installHooks(); modeHooks?.(); arena.hooks?.(ctx, window); window.__ready = true; requestAnimationFrame(frameLoop); },
    setMode(m) { mode = m; },
  };
}
