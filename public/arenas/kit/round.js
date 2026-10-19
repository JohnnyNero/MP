// Round loop for TABLETOP arenas (no THREE, no DOM): phases, escalation, eliminations, placements.
//   pull -> reveal -> prep -> active (escalation at esc1 / esc2) -> finish -> results
// The runner calls round.tick(dt, aliveCount) every fixed step and reacts to the events it fires.
export const DEFAULT_T = { pull: 1.0, reveal: 2.8, prep: 4.0, primaryAt: 1.2, active: 55, esc1: 30, esc2: 43, finish: 1.6 };

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hash(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
// named seeded streams: one per system, so adding a bot never changes where a meteor lands
export const STREAMS = ['hazard', 'bots', 'destruct', 'fx', 'round', 'arena'];
export function streams(seed) { const o = {}; for (const n of STREAMS) o[n] = mulberry32(hash(n + ':' + seed)); return o; }
export const nextSeed = (seed) => (seed * 1103515245 + 12345) >>> 0 || 1;

// pick from options, never the excluded one (no repeats)
export function pickOther(options, exclude, rng) { const o = options.filter((n) => n !== exclude); return o.length ? o[Math.floor(rng() * o.length)] : exclude; }

/**
 * createRound({ T, allowed, on }) where on = { phase(ph, round), primary(name), escalate(level, round), finish(), results(res) }
 */
export function createRound({ T = DEFAULT_T, allowed, on = {} }) {
  const r = {
    T, allowed, phase: 'boot', t: 0, tActive: 0, step: 0, level: 0, disaster: allowed[0], second: null,
    seed: 0, elims: [], results: null, startedWith: 0, primarySpawned: false, arena: '',
  };
  const fire = (k, ...a) => on[k]?.(...a);
  r.setPhase = (ph) => { r.phase = ph; r.t = 0; fire('phase', ph, r); if (ph === 'results') { r.results = r.computeResults(r.playersRef()); fire('results', r.results); } };
  r.start = ({ disaster, seed, players, arena, rng }) => {
    Object.assign(r, { disaster, seed, second: null, elims: [], results: null, level: 0, tActive: 0, step: 0, startedWith: players.length, primarySpawned: false, arena, rng });
    r.playersRef = () => players;
    r.setPhase('pull');
  };
  r.recordOut = (index, extra = {}) => { r.elims.push({ i: index, step: r.step, t: r.tActive, phase: r.phase, ...extra }); };
  r.tick = (dt, alive) => {
    r.step++; r.t += dt;
    const ph = r.phase;
    if (ph === 'pull' && r.t >= T.pull) r.setPhase('reveal');
    else if (ph === 'reveal' && r.t >= T.reveal) r.setPhase('prep');
    else if (ph === 'prep') {
      // hazards come alive during prep so the first telegraph is already visible, but cannot hit until GO
      if (!r.primarySpawned && r.t >= T.prep - T.primaryAt) { r.primarySpawned = true; fire('primary', r.disaster); }
      if (r.t >= T.prep) r.setPhase('active');
    } else if (ph === 'active') {
      r.tActive = r.t;
      if (!r.primarySpawned) { r.primarySpawned = true; fire('primary', r.disaster); }
      if (r.level === 0 && r.t >= T.esc1) { r.level = 1; r.second = pickOther(r.allowed, r.disaster, r.rng); fire('escalate', 1, r); }
      if (r.level === 1 && r.t >= T.esc2) { r.level = 2; fire('escalate', 2, r); }
      if (r.t >= T.active || alive === 0 || (r.startedWith >= 2 && alive <= 1)) r.setPhase('finish');
    } else if (ph === 'finish' && r.t >= T.finish) r.setPhase('results');
  };
  // what the board's settle step gets: survivors win; same-step eliminations tie; everyone out at once = draw (nobody scores)
  r.computeResults = (players) => {
    const survivors = players.filter((p) => !p.isOut);
    const byStep = new Map(); for (const e of r.elims) { if (!byStep.has(e.step)) byStep.set(e.step, []); byStep.get(e.step).push(e); }
    const groups = [...byStep.entries()].sort((a, b) => b[0] - a[0]).map(([, g]) => g);
    const place = []; let next = 1;
    if (survivors.length) { for (const p of survivors) place.push({ i: p.index, place: 1, status: 'SURVIVED' }); next = 1 + survivors.length; }
    for (const g of groups) { for (const e of g) place.push({ i: e.i, place: next, status: 'OUT ' + fmtTime(e.t) }); next += g.length; }
    const draw = survivors.length === 0 && groups.length === 1 && groups[0].length === players.length;
    return {
      arena: r.arena, seed: r.seed, disaster: r.disaster, second: r.second, survivors: survivors.map((p) => p.index), draw,
      eliminationOrder: r.elims.map((e) => ({ player: e.i, time: +e.t.toFixed(2), step: e.step, cause: e.cause || null })),
      placements: place, winners: draw ? [] : place.filter((q) => q.place === 1).map((q) => q.i),
    };
  };
  return r;
}
export const fmtTime = (t) => { const s = Math.max(0, Math.floor(t)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
