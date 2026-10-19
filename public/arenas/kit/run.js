// Arena runner: renderer, fixed-step loop, round flow, shared camera, input, HUD, bots, hazards, destruction,
// water, debris knocks, adaptive quality and test hooks. An arena module supplies the place; see KIT.md.
//   import { runArena } from '../kit/run.js'; import arena from './arena.js'; runArena(arena);
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import RAPIER from 'rapier';
import { createDestruction, loadLibrary } from './destruct.js';
import { createRound, DEFAULT_T, streams, nextSeed, mulberry32, hash, pickOther } from './round.js';
import { createSharedCamera, createCutaway } from './camera.js';
import { createLooseProps } from './props.js';
import { createInput } from './input.js';
import { createHUD } from './hud.js';
import { createFX } from './fx.js';
import { createBot } from './bots.js';
import { HAZARDS } from './hazards/index.js';
import { loadCharacter, loadHero } from './players.js';

const DT = 1 / 60;
export const COLORS = ['#ef5a4f', '#3f86e8', '#43b65a', '#f2b51c'];

function identityFrame() {
  return {
    toWorld: (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z),
    toLocal: (v, out = new THREE.Vector3()) => out.copy(v),
    dirToWorld: (x, z) => new THREE.Vector3(x, 0, z).normalize(),
    groundVelocity: (rb, p, out) => out.set(0, 0, 0),
    object: null,   // a moving arena sets this to the Object3D that carries its local-frame visuals
  };
}

const VOICE_PITCH = [1, 0.86, 1.15, 0.76];        // each bean sounds a little different

export async function runArena(arena) {
  const Q = new URLSearchParams(location.search);
  const N_SLOTS = Math.max(2, Math.min(4, +(Q.get('n') || 4)));
  // Deck benchmark (?bench=1[&next=ship]): an all-bot round at locked full quality, then a frame-time report
  const BENCH = Q.get('bench') ? { frames: [], tick: [], phys: [], chr: [], shown: false, go: null } : null;
  const ALL_BOTS = Q.get('bots') === 'all' || !!BENCH;
  const T = { ...DEFAULT_T, ...(arena.timing || {}) };
  const allowed = arena.disasters.filter((n) => HAZARDS[n]);
  const meta = (n) => ({ title: arena.hazardConfig?.[n]?.title ?? HAZARDS[n].title, hint: arena.hazardConfig?.[n]?.hint ?? HAZARDS[n].hint });

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
  const cam = createSharedCamera({ THREE, camera, ...(arena.camera || {}) });
  const cutaway = createCutaway({ THREE, camera, ...(arena.cutaway || {}) });
  const input = createInput({ nSlots: N_SLOTS, allBots: ALL_BOTS, onClaim: () => refreshChips() });

  // ---------------------------------------------------------------- assets
  const [hero, createPlayers] = await Promise.all([loadHero(GLTFLoader), loadCharacter(Q.get('character'))]);
  const library = arena.assets?.pieces ? await loadLibrary({ THREE, GLTFLoader, glb: arena.assets.pieces.GLB_BASE64, support: arena.assets.pieces.SUPPORT }) : null;
  await RAPIER.init();

  // ---------------------------------------------------------------- shared context (fields refreshed per round)
  const frame = arena.frame || identityFrame();
  const group = new THREE.Group(); group.name = 'arena-local'; scene.add(group);   // per-round local-frame things (telegraphs, markers)
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
    THREE, RAPIER, scene, renderer, camera, cam, fx, hud, input, library, frame, group, arena, water, T,
    world: null, D: null, R, players: [], bots: [], hazards: [], dangers: [], round: null, simT: 0,
    surface: { points: surf.points, heightAt: surf.heightAt, hasFloor, castDown, inBounds: surf.inBounds },
    now: () => simT,
    living: () => ctx.players.filter((p) => !p.isOut),
    cfg: (n) => arena.hazardConfig?.[n] || {},
    isImmune: (p) => (immunity.get(p.index) || 0) > simT,
    hitPlayer(p, imp, stun, immune = 1.5, src = '?') {
      if (p.isOut || p.invulnerable || ctx.isImmune(p)) return false;
      p.lastHit = src + '@' + round.t.toFixed(1); p.knock(imp, { stun }); immunity.set(p.index, simT + immune); cam.shake(0.3);
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
  arena.init?.(ctx);
  hud.loaded();

  // ---------------------------------------------------------------- round
  const round = createRound({ T, allowed, on: {
    phase: (ph) => onPhase(ph),
    primary: (name) => { ctx.hazards.push(HAZARDS[name].create(0, ctx)); },
    escalate: (level, r) => {
      const E = arena.escalation || {};
      if (level === 1) {
        if (ctx.hazards[0]) ctx.hazards[0].lvl = 1;
        ctx.hazards.push(HAZARDS[r.second].create(0, ctx));
        hud.banner('+ ' + meta(r.second).title + '!', E.sub1 || 'It gets worse', 2.2, simT); fx.sfx('sting'); cam.shake(0.6); tag();
      } else {
        if (ctx.hazards[0]) ctx.hazards[0].lvl = 2; if (ctx.hazards[1]) ctx.hazards[1].lvl = 1;
        hud.banner(E.big2 || 'HOLD ON!', E.sub2 || 'Final stretch', 1.6, simT); cam.shake(0.6); fx.sfx('rumble');
      }
      arena.onEscalate?.(level, ctx);
    },
  } });
  ctx.round = round;

  let safeObjs = [];
  function showSafeZones(on) {
    for (const o of safeObjs) { group.remove(o); o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); } safeObjs = [];
    if (!on) return;
    for (const z of HAZARDS[round.disaster].safeZones(arena)) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(z.x1 - z.x0, z.z1 - z.z0), new THREE.MeshBasicMaterial({ color: '#7cf0a0', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.position.set((z.x0 + z.x1) / 2, z.y + 0.07, (z.z0 + z.z1) / 2); m.renderOrder = 3; group.add(m); safeObjs.push(m);
      const s = fx.labelSprite(z.label || 'SAFE'); s.position.set((z.x0 + z.x1) / 2, z.y + 1.6, (z.z0 + z.z1) / 2); group.add(s); safeObjs.push(s);
    }
  }
  function tag() { hud.tag(meta(round.disaster).title + (round.second ? ' + ' + meta(round.second).title : '') + `<small>${arena.name}</small>`); }
  function refreshChips() { hud.chips(ctx.players.map((p) => ({ name: 'P' + (p.index + 1), color: p.color, out: p.isOut, human: input.isHuman(p.index) }))); }
  function onPhase(ph) {
    const M = meta(round.disaster);
    if (ph === 'pull') { hud.wipe(true); hud.hideResults(); hud.tag(null); }
    if (ph === 'reveal') { hud.wipe(false); hud.banner(M.title + '!', M.hint, T.reveal + 0.6, simT); fx.sfx('sting'); showSafeZones(true); }
    if (ph === 'prep') tag();
    if (ph === 'active') { hud.banner('GO!', '', 0.8, simT); fx.sfx('go'); showSafeZones(false); }
    if (ph === 'finish') { for (const h of ctx.hazards) h.dispose(); ctx.hazards.length = 0; ctx.dangers.length = 0; hud.banner('FINISH!', '', 1.6, simT); fx.sfx('fanfare'); }
    if (ph === 'results') { hud.clearBanner(); }
    arena.onPhase?.(ph, ctx);
  }
  round.playersRef = () => ctx.players;
  const resultsHook = (res) => { window.__results = res; hud.showResults(res, { colors: COLORS, isHuman: (i) => input.isHuman(i) }); fx.sfx('fanfare'); arena.onResults?.(res, ctx); };
  // createRound fires on.results; wire it here (kept separate so arenas can wrap it)
  round.setPhase = ((orig) => (ph) => { orig(ph); if (ph === 'results') resultsHook(round.results); })(round.setPhase);

  // ---------------------------------------------------------------- per-round world
  function disposeRound() {
    for (const h of ctx.hazards) h.dispose(); ctx.hazards.length = 0;
    for (const p of ctx.players) p.dispose(); ctx.players.group?.dispose?.(); ctx.players = [];
    ctx.props?.dispose(); ctx.props = null; cutaway.reset();
    arena.disposeRound?.(ctx);
    if (ctx.D) { ctx.D.dispose(); ctx.D = null; }
    if (ctx.world) { ctx.world.free(); ctx.world = null; }
    ctx.dangers.length = 0; ctx.hits.length = 0; ctx.events.length = 0; fx.clear(); showSafeZones(false);
    while (group.children.length) group.remove(group.children[0]);
  }
  function buildRound(disaster) {
    disposeRound();
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
        round.recordOut(p.index, { cause, at: frame.toLocal(p.position).toArray().map((v) => +v.toFixed(1)) });
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
      },
      ...(arena.characterOptions || {}),
    } });
    ctx.bots = ctx.players.map(() => createBot(R.bots, { mischief: ctx.players.group?.isRagdoll ? 1 : 0 }));   // grab games need a character that grabs
    round.start({ disaster, seed, players: ctx.players, arena: arena.id, rng: R.round });
    cam.snap();
    refreshChips();
  }
  function onDestructEvent(type, e) {
    if (type === 'islandDetached' && e.mass > 150) { cam.shake(0.45); fx.sfx('crash'); }
    else if (type === 'impact' && e.force > 2e5) cam.shake(0.2);
    arena.onDestructEvent?.(type, e, ctx);
  }

  // ---------------------------------------------------------------- ledges (arena.ledges: [[x0, y0, z0, x1, y1, z1]] local) -> world
  const ledgeOut = []; const _la = new THREE.Vector3(), _lb = new THREE.Vector3();
  function worldLedges() {
    const body = arena.ledgeBody?.(ctx) || null; ledgeOut.length = 0;
    for (const s of arena.ledges) { frame.toWorld(s[0], s[1], s[2], _la); frame.toWorld(s[3], s[4], s[5], _lb); ledgeOut.push({ a: [_la.x, _la.y, _la.z], b: [_lb.x, _lb.y, _lb.z], body }); }
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
    phase: () => round.phase,
    blocked: (pos, d) => { ray.origin.x = pos.x; ray.origin.y = pos.y + 0.35; ray.origin.z = pos.z; ray.dir.x = d.x; ray.dir.y = 0; ray.dir.z = d.z; const h = ctx.world.castRay(ray, 0.75, true, undefined, undefined, undefined, undefined, notPlayer); return !!h && !!h.collider.parent()?.isDynamic(); },
    others: [],
  };
  void _hf;
  const evq = new RAPIER.EventQueue(true);
  let physMs = 0, charMs = 0;
  let botsOff = false;
  function tick(dt, frameMs) {
    simT += dt; ctx.simT = simT;
    round.tick(dt, ctx.players.filter((p) => !p.isOut).length);
    const ph = round.phase;
    arena.update?.(dt, ctx);
    // input
    const { edges } = input.poll();
    if (edges.length) fx.audioOn();                      // counts as a gesture only where the browser already trusts the site
    if (BENCH?.shown && (edges.some((e) => e.button === 0) || input.keyEdge.has('Enter'))) { BENCH.go(); return; }
    for (const e of edges) { if (e.button === 9) hud.toggleHelp(); if (e.button === 0 && ph === 'results') { playAgain(); return; } }
    if (input.keyEdge.has('KeyH')) hud.toggleHelp();
    if (ph === 'results' && ['Enter', 'Space', 'NumpadEnter'].some((c) => input.keyEdge.has(c))) { input.endStep(); playAgain(); return; }
    input.endStep();
    // players
    botCtx.others = ctx.living().map((p) => { const l = frame.toLocal(p.position); return [l.x, l.z]; }); botCtx._grab = null;
    const tc0 = performance.now();
    ctx.players.group?.beforeUpdate?.(dt);
    const locked = ph === 'pull' || ph === 'reveal' || ph === 'results';
    for (const p of ctx.players) {
      if (p.isOut) continue;
      p.locked = locked; p.invulnerable = ph === 'finish' || ph === 'results';   // results freeze at the finish banner
      p.input = input.isHuman(p.index) ? input.read(p.index) : (!botsOff && (ph === 'prep' || ph === 'active' || ph === 'finish')) ? ctx.bots[p.index].think(dt, p, botCtx) : { x: 0, y: 0, jump: false, grab: false, aim: 0 };
      p.update(dt);
    }
    const tc1 = performance.now();
    // hazards (armed only while active: hitboxes off in intro, prep, finish, results)
    const armed = ph === 'active';
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
    // falling off the arena: out after a short fall
    for (const p of ctx.players) if (!p.isOut && !p.invulnerable && p.position.y < surf.killY) { p.fellOff = true; p.eliminate(); }
    if (ph === 'active') debrisKnocks();
    if (water) water.level += (water.target - water.level) * Math.min(1, dt * water.rate);
    fx.update(dt);
  }

  function playAgain(disaster) {
    if (round.phase !== 'results' && !disaster && round.phase !== 'boot') return;
    seed = nextSeed(seed);
    const pick = mulberry32(hash('pick:' + seed));
    buildRound(disaster || pickOther(allowed, round.disaster, pick));
  }
  hud.onAgain(() => playAgain());

  // ---------------------------------------------------------------- per-frame visuals
  const _cp = new THREE.Vector3();
  function updateView(dt) {
    const ph = round.phase;
    if (ph === 'pull') cam.reveal(0);
    else if (ph === 'reveal') cam.reveal(round.t / T.reveal);
    else cam.frame(dt, ph === 'results' ? [] : ctx.living().map((p) => p.position));
    cam.apply(dt);
    ctx.players.group?.render?.(dt);
    arena.render?.(dt, ctx);
    if (ph !== 'pull') {
      const pts = []; for (const p of ctx.living()) { pts.push(_cp.copy(p.position).setY(p.position.y + 0.55).clone(), _cp.copy(p.position).setY(p.position.y + 1.0).clone()); }
      const cands = (arena.occluders?.(ctx) || []).concat(ctx.D ? ctx.D.group.children : []);
      group.traverse((o) => { if (o.isMesh) cands.push(o); });          // hazard props (a stomping hand, a tentacle) fade too
      cutaway.update(dt, pts, cands);
    }
    hud.update(simT);
    if (ph === 'active') { const left = T.active - round.t; hud.timer(String(Math.ceil(left)), left < 10); }
    else if (ph === 'prep') { const left = T.prep - round.t; hud.timer(left > 0.4 ? String(Math.ceil(left - 0.4)) : ''); }
    else hud.timer('');
  }

  // ---------------------------------------------------------------- loop, adaptive quality
  let noRender = false, paused = false, quality = 0, slowFor = 0;
  let last = performance.now(), acc = 0, fpsAcc = 0, fpsN = 0, fps = 0, tickMs = 0;
  function adapt() {
    if (BENCH || Q.get('quality') === 'high' || noRender || paused || quality >= 2) return;
    slowFor = fps < 45 ? slowFor + 0.5 : 0;
    if (slowFor < 4) return;
    slowFor = 0; quality++;
    if (quality === 1) { renderer.setPixelRatio(0.75); resize(); }
    if (quality === 2) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if (o.isLight && o.castShadow) o.castShadow = false; if (o.material) o.material.needsUpdate = true; }); }
  }
  function frameLoop(now) {
    const ms = now - last; last = now;
    fpsAcc += ms; fpsN++; if (fpsAcc > 500) { fps = Math.round(1000 * fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; hud.fps(fps + ' fps' + (quality ? ' q' + quality : '')); hud.sound(fx.soundOn); adapt(); }
    if (BENCH && !BENCH.shown && !hud.helpOn) {
      if (round.phase === 'active' || round.phase === 'finish') { BENCH.frames.push(ms); BENCH.tick.push(tickMs); BENCH.phys.push(physMs); BENCH.chr.push(charMs); }
      else if (round.phase === 'results') benchShow();
    }
    if (!paused && !hud.helpOn) {
      // a 60 Hz display delivers frames a little early or late; treat near-16.7 ms frames as exactly one physics step,
      // otherwise jitter gives 0-then-2 steps per frame and everything visibly hitches
      acc += Math.min(0.1, (Math.abs(ms - 1000 * DT) < 2.5 ? 1000 * DT : ms) / 1000); let n = 0;
      const t0 = performance.now();
      while (acc >= DT && n < 3) { tick(DT, ms); acc -= DT; n++; }
      if (n) tickMs = tickMs * 0.9 + 0.1 * (performance.now() - t0) / n;
      if (n === 3) acc = 0;
    }
    if (!noRender) { updateView(Math.min(0.05, ms / 1000)); renderer.render(scene, camera); }
    requestAnimationFrame(frameLoop);
  }
  function benchShow() {
    BENCH.shown = true;
    const f = BENCH.frames.slice(1).sort((a, b) => a - b), n = f.length, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    let prev = []; try { prev = JSON.parse(Q.get('r') || '[]'); if (!Array.isArray(prev)) prev = []; } catch { prev = []; }
    if (n) {
      let gpu = '?'; try { const gl = renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); gpu = String(e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { /* hidden */ }
      const avg = mean(f);
      prev.push({ arena: arena.name, fps: Math.round(1000 / avg), low: Math.round(1000 / f[Math.min(n - 1, Math.floor(n * 0.99))]), worst: Math.round(f[n - 1]),
        sim: +mean(BENCH.tick).toFixed(1), phys: +mean(BENCH.phys).toFixed(1), chr: +mean(BENCH.chr).toFixed(1),
        res: `${renderer.domElement.width}x${renderer.domElement.height}`, secs: Math.round(avg * n / 1000), gpu });
    }
    const queue = (Q.get('next') || '').split(',').filter((n) => /^[a-z]+$/.test(n)), next = queue[0] || null;
    hud.bench(prev, next ? 'Press A or Enter for the next arena' : 'Press A or Enter to go back to the menu');
    BENCH.go = () => { location.href = next ? `./${next}.html?bench=1&next=${queue.slice(1).join(',')}&r=${encodeURIComponent(JSON.stringify(prev))}` : './index.html'; };
  }
  const qd = Q.get('disaster');
  const initial = qd && (allowed.includes(qd) || (Q.get('any') && HAZARDS[qd])) ? qd : allowed[Math.floor(mulberry32(hash('pick:' + seed))() * allowed.length)];
  buildRound(initial);
  requestAnimationFrame(frameLoop);

  // ---------------------------------------------------------------- test / tooling hooks
  Object.defineProperty(window, '__round', { configurable: true, get: () => ({
    arena: arena.id, phase: round.phase, t: +round.t.toFixed(2), disaster: round.disaster, second: round.second, level: round.level, seed: round.seed,
    alive: ctx.living().map((p) => p.index), elims: round.elims.slice(), results: round.results, fps, tickMs: +tickMs.toFixed(2), physMs: +physMs.toFixed(2), charMs: +charMs.toFixed(2), quality, faded: cutaway.faded, events: ctx.events.slice(-20),
    dangers: ctx.dangers.length, hazards: ctx.hazards.map((h) => h.name + ':' + h.lvl + ':' + h.items.length), water: water ? +water.level.toFixed(3) : null, waterTarget: water ? +water.target.toFixed(3) : null,
    stats: ctx.D?.stats(), hits: ctx.hits.slice(-30),
    players: ctx.players.map((p) => ({ i: p.index, out: p.isOut, water: p.inWater, grounded: p.grounded, pos: p.position.toArray().map((v) => +v.toFixed(2)), local: frame.toLocal(p.position).toArray().map((v) => +v.toFixed(2)), stun: +p.stun.toFixed(2), hit: p.lastHit || null, ...(p.debugState?.() || {}) })),
    arenaState: arena.state?.(ctx),
  }) });
  window.__disaster = (name) => { if (!HAZARDS[name]) throw new Error('unknown disaster ' + name); seed = nextSeed(seed); buildRound(name); };
  window.__skip = (sec) => { const n = Math.round(sec / DT); for (let i = 0; i < n; i++) tick(DT, 16); };
  window.__tick = tick;
  window.__playAgain = () => playAgain();
  window.__pause = (on) => { paused = !!on; };
  window.__render = (on) => { noRender = !on; };
  window.__renderFrames = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) updateView(dt); renderer.render(scene, camera); };
  window.__overboard = (i) => { const p = ctx.players[i]; if (p && !p.isOut) { p.teleport(frame.toWorld(...(arena.overboard || [0, 0.5, 12]))); p.body?.setLinvel({ x: 0, y: -1, z: 2 }, true); } };
  window.__teleport = (i, x, y, z) => { const p = ctx.players[i]; if (p && !p.isOut) p.teleport(frame.toWorld(x, y, z)); };
  window.__hazards = () => ctx.hazards;
  window.__botsOff = (on) => { botsOff = !!on; };
  window.__inject = (i, st) => input.inject(i, st);       // tests: drive slot i like a human controller ({ x, y, jump, grab, aim } or null)
  window.__players = () => ctx.players;
  window.__cam = cam;
  window.__ctx = ctx;
  Object.defineProperty(window, '__simTime', { configurable: true, get: () => simT });
  arena.hooks?.(ctx, window);
  window.__ready = true;
  return ctx;
}
