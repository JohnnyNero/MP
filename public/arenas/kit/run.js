// Arena runner: the disaster round on top of the shared engine (engine.js): round flow, hazards, results, matches
// across pages and the Deck benchmark. An arena module supplies the place; see KIT.md.
//   import { runArena } from '../kit/run.js'; import arena from './arena.js'; runArena(arena);
import * as THREE from 'three';
import { createRound, DEFAULT_T, nextSeed, mulberry32, hash, pickOther } from './round.js';
import { HAZARDS } from './hazards/index.js';
import { createEngine, COLORS } from './engine.js';
import { loadMatch, saveMatch, clearMatch, awardRound, standings, isFinal, roundLabel, advance } from './match.js';

export { COLORS };

export async function runArena(arena) {
  const Q = new URLSearchParams(location.search);
  // Deck benchmark (?bench=1[&next=ship]): an all-bot round at locked full quality, then a frame-time report
  const BENCH = Q.get('bench') ? { frames: [], tick: [], phys: [], chr: [], shown: false, go: null } : null;
  const ALL_BOTS = Q.get('bots') === 'all' || !!BENCH;
  // a match (?match=1, state in sessionStorage) only counts if this page is the round it expects
  const MATCH = (() => { const m = Q.get('match') ? loadMatch() : null; return m && m.order[m.i] === arena.id ? m : null; })();
  const T = { ...DEFAULT_T, ...(arena.timing || {}) };
  const allowed = arena.disasters.filter((n) => HAZARDS[n]);
  const meta = (n) => ({ title: arena.hazardConfig?.[n]?.title ?? HAZARDS[n].title, hint: arena.hazardConfig?.[n]?.hint ?? HAZARDS[n].hint });

  const eng = await createEngine(arena, { allBots: ALL_BOTS, persistSlots: !!MATCH, lockQuality: !!BENCH, ctxExtra: { T } });
  const { ctx, hud, cam, fx, input, renderer, frame } = eng;
  const group = ctx.group;

  // ---------------------------------------------------------------- round
  const round = createRound({ T, allowed, on: {
    phase: (ph) => onPhase(ph),
    primary: (name) => { ctx.hazards.push(HAZARDS[name].create(0, ctx)); },
    escalate: (level, r) => {
      const E = arena.escalation || {};
      if (level === 1) {
        if (ctx.hazards[0]) ctx.hazards[0].lvl = 1;
        ctx.hazards.push(HAZARDS[r.second].create(0, ctx));
        hud.banner('+ ' + meta(r.second).title + '!', E.sub1 || 'It gets worse', 2.2, eng.simT); fx.sfx('sting'); cam.shake(0.6); tag();
      } else {
        if (ctx.hazards[0]) ctx.hazards[0].lvl = 2; if (ctx.hazards[1]) ctx.hazards[1].lvl = 1;
        hud.banner(E.big2 || 'HOLD ON!', E.sub2 || 'Final stretch', 1.6, eng.simT); cam.shake(0.6); fx.sfx('rumble');
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
  function tag() { hud.tag(meta(round.disaster).title + (round.second ? ' + ' + meta(round.second).title : '') + `<small>${arena.name}${MATCH ? ' · ' + roundLabel(MATCH) : ''}</small>`); }
  function onPhase(ph) {
    const M = meta(round.disaster), simT = eng.simT;
    if (ph === 'pull') { hud.wipe(true); hud.hideResults(); hud.tag(null); }
    if (ph === 'reveal') { hud.wipe(false); hud.banner(M.title + '!', M.hint, T.reveal + 0.6, simT); fx.sfx('sting'); showSafeZones(true); }
    if (ph === 'prep') tag();
    if (ph === 'active') { hud.banner('GO!', '', 0.8, simT); fx.sfx('go'); showSafeZones(false); }
    if (ph === 'finish') { for (const h of ctx.hazards) h.dispose(); ctx.hazards.length = 0; ctx.dangers.length = 0; hud.banner('FINISH!', '', 1.6, simT); fx.sfx('fanfare'); }
    if (ph === 'results') { hud.clearBanner(); }
    arena.onPhase?.(ph, ctx);
  }
  round.playersRef = () => ctx.players;
  const resultsHook = (res) => {
    window.__results = res;
    let match = null;
    if (MATCH) {
      awardRound(MATCH, res); saveMatch(MATCH);
      const next = isFinal(MATCH) ? null : MATCH.order[MATCH.i + 1];
      match = { label: roundLabel(MATCH), final: !next, nextName: next ? MATCH.names[next] || next : '', table: standings(MATCH) };
      window.__match = MATCH;
    }
    // the card waits a moment so the camera's close-up on the survivors is seen first (A / Enter shows it at once)
    pendingResults = { res, opts: { colors: COLORS, isHuman: (i) => input.isHuman(i), match } };
    fx.sfx('fanfare'); arena.onResults?.(res, ctx);
  };
  let pendingResults = null;
  function showPendingResults() { if (!pendingResults) return false; hud.showResults(pendingResults.res, pendingResults.opts); pendingResults = null; return true; }
  // after a match round's results: on to the next arena, or back to the menu when the match is over
  function matchNext() {
    const url = advance(MATCH);
    if (url) { saveMatch(MATCH); location.href = url; } else { clearMatch(); location.href = './index.html'; }
  }
  // createRound fires on.results; wire it here (kept separate so arenas can wrap it)
  round.setPhase = ((orig) => (ph) => { orig(ph); if (ph === 'results') resultsHook(round.results); })(round.setPhase);

  function buildRound(disaster) {
    eng.buildWorld();
    round.start({ disaster, seed: eng.seed, players: ctx.players, arena: arena.id, rng: ctx.R.round, preferSecond: arena.secondDisaster || null });
    cam.snap();
    eng.refreshChips();
  }
  function playAgain(disaster) {
    if (round.phase !== 'results' && !disaster && round.phase !== 'boot') return;
    pendingResults = null;
    if (MATCH && !disaster && round.phase === 'results') { matchNext(); return; }
    eng.seed = nextSeed(eng.seed);
    const pick = mulberry32(hash('pick:' + eng.seed));
    buildRound(disaster || pickOther(allowed, round.disaster, pick));
  }
  hud.onAgain(() => playAgain());

  // ---------------------------------------------------------------- the round as an engine mode
  const OK_KEYS = ['Enter', 'Space', 'NumpadEnter'];
  const mode = {
    tick: (dt) => round.tick(dt, ctx.living().length),
    beforeDispose: () => showSafeZones(false),
    input(edges, dt) {
      const ph = round.phase;
      if (BENCH?.shown && (edges.some((e) => e.button === 0) || input.keyEdge.has('Enter'))) { BENCH.go(); return true; }
      if (ph !== 'results') return false;
      if ((round.t >= 1.5 || edges.some((e) => e.button === 0) || OK_KEYS.some((c) => input.keyEdge.has(c))) && showPendingResults()) return true;
      for (const p of ctx.living()) if (p.bean && round.results?.survivors?.includes(p.index)) { const b = p.bean; b.yaw += Math.atan2(Math.sin(-b.yaw), Math.cos(-b.yaw)) * Math.min(1, dt * 4); }   // winners turn to the camera
      if (edges.some((e) => e.button === 0) || OK_KEYS.some((c) => input.keyEdge.has(c))) { playAgain(); return true; }
      return false;
    },
    playerState() {
      const ph = round.phase;
      return { locked: ph === 'pull' || ph === 'reveal' || ph === 'results', invulnerable: ph === 'finish' || ph === 'results',   // results freeze at the finish banner
        bot: ph === 'prep' || ph === 'active' || ph === 'finish' };
    },
    armed: () => round.phase === 'active',          // hitboxes off in intro, prep, finish, results
    knocks: () => round.phase === 'active',
    onOut: (p, info) => round.recordOut(p.index, info),
    view(dt) {
      const ph = round.phase;
      if (ph === 'pull') cam.reveal(0);
      else if (ph === 'reveal') cam.reveal(round.t / T.reveal);
      else if (ph === 'results') {                     // celebration: close on the survivors (or the whole arena)
        const win = (round.results?.survivors || []).map((i) => ctx.players[i]).filter((p) => p && !p.isOut).map((p) => p.position);
        cam.frame(dt, win, { close: win.length > 0 });
      } else cam.frame(dt, eng.framePoints(ph === 'active' || ph === 'finish'));
    },
    cutaway: () => round.phase !== 'pull',
    hud() {
      const ph = round.phase;
      if (ph === 'active') { const left = T.active - round.t; hud.timer(String(Math.ceil(left)), left < 10); }
      else if (ph === 'prep') { const left = T.prep - round.t; hud.timer(left > 0.4 ? String(Math.ceil(left - 0.4)) : ''); }
      else hud.timer('');
    },
    lockQuality: () => !!BENCH,
    onFrame(ms, st) {
      if (!BENCH || BENCH.shown) return;
      if (round.phase === 'active' || round.phase === 'finish') { BENCH.frames.push(ms); BENCH.tick.push(st.tickMs); BENCH.phys.push(st.physMs); BENCH.chr.push(st.charMs); }
      else if (round.phase === 'results') benchShow();
    },
  };

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
  const initial = qd && (allowed.includes(qd) || (Q.get('any') && HAZARDS[qd])) ? qd : allowed[Math.floor(mulberry32(hash('pick:' + eng.seed))() * allowed.length)];
  buildRound(initial);

  // ---------------------------------------------------------------- round test hooks (the engine adds the generic ones)
  eng.start(mode, () => {
    Object.defineProperty(window, '__round', { configurable: true, get: () => ({
      arena: arena.id, phase: round.phase, t: +round.t.toFixed(2), disaster: round.disaster, second: round.second, level: round.level, seed: round.seed,
      alive: ctx.living().map((p) => p.index), elims: round.elims.slice(), results: round.results, ...eng.stats(), events: ctx.events.slice(-20),
      dangers: ctx.dangers.length, hazards: ctx.hazards.map((h) => h.name + ':' + h.lvl + ':' + h.items.length), water: eng.water ? +eng.water.level.toFixed(3) : null, waterTarget: eng.water ? +eng.water.target.toFixed(3) : null,
      stats: ctx.D?.stats(), hits: ctx.hits.slice(-30),
      players: ctx.players.map((p) => ({ i: p.index, out: p.isOut, water: p.inWater, grounded: p.grounded, pos: p.position.toArray().map((v) => +v.toFixed(2)), local: frame.toLocal(p.position).toArray().map((v) => +v.toFixed(2)), stun: +p.stun.toFixed(2), hit: p.lastHit || null, ...(p.debugState?.() || {}) })),
      arenaState: arena.state?.(ctx),
    }) });
    window.__disaster = (name) => { if (!HAZARDS[name]) throw new Error('unknown disaster ' + name); eng.seed = nextSeed(eng.seed); buildRound(name); };
    window.__playAgain = () => playAgain();
    window.__overboard = (i) => { const p = ctx.players[i]; if (p && !p.isOut) { p.teleport(frame.toWorld(...(arena.overboard || [0, 0.5, 12]))); p.body?.setLinvel({ x: 0, y: -1, z: 2 }, true); } };
  });
  return ctx;
}
