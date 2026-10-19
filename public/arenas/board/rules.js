// Board rules (pure: no THREE, no DOM, unit-tested). The physical game decides where beans stand; these functions
// turn that into board positions, coins and stars.
//   spaces: [{ id, x, y, z, kind: 'blue'|'red', next: [ids] }]
export const RULES = { startCoins: 5, blue: 3, red: 3, starCost: 10, back: 3, hillWin: 8, hillSecond: 4, fallCost: 3 };

// spaces reachable with exactly `steps` forward moves (one per fork branch) and every space passed on the way
export function reach(spaces, from, steps) {
  const targets = new Set(), passed = new Set();
  const walk = (id, left) => {
    if (left === 0) { targets.add(id); return; }
    for (const n of spaces[id].next) { passed.add(n); walk(n, left - 1); }
  };
  walk(from, steps);
  for (const t of targets) passed.delete(t);
  return { targets: [...targets], passed: [...passed] };
}
// spaces up to `n` moves behind `from` (shoved back down the path)
export function behind(spaces, from, n) {
  const prev = new Map(spaces.map((s) => [s.id, []]));
  for (const s of spaces) for (const m of s.next) prev.get(m).push(s.id);
  const out = new Set(); let front = [from];
  for (let k = 0; k < n; k++) { const nx = []; for (const id of front) for (const p of prev.get(id)) if (!out.has(p) && p !== from) { out.add(p); nx.push(p); } front = nx; }
  return [...out];
}
// every space a walk of `steps` from `from` can end on: start, the way, the ends, and a few behind (shoved back)
export function walkWindow(spaces, from, steps, back = RULES.back) {
  const { targets, passed } = reach(spaces, from, steps);
  return { targets, passed, window: [...new Set([from, ...passed, ...targets, ...behind(spaces, from, back)])] };
}
// where a bean standing at pos ends its walk: the nearest space it was allowed to reach on its own level (knocked
// off the bridge onto the table is not on the bridge); off every level, the nearest one at all
export function settle(spaces, window, pos) {
  const near = (ids) => { let best = null, bd = Infinity; for (const id of ids) { const s = spaces[id]; const d = Math.hypot(s.x - pos.x, s.z - pos.z) + 1.5 * Math.abs(s.y - pos.y); if (d < bd) { bd = d; best = id; } } return best; };
  return near(window.filter((id) => Math.abs(spaces[id].y - pos.y) < 0.45)) ?? near(window);
}

export function newGame({ players = 4, turns = 10, starAt = 9 } = {}) {
  return { turn: 1, turns, at: Array(players).fill(0), coins: Array(players).fill(RULES.startCoins), stars: Array(players).fill(0), starAt, log: [] };
}
// a bean ends its walk on `id`: coins for blue/red, the star if it can pay. Returns what happened.
export function land(g, i, id, kind) {
  g.at[i] = id;
  const out = { i, id, coins: 0, star: false, short: false };
  if (id === g.starAt) {
    if (g.coins[i] >= RULES.starCost) { g.coins[i] -= RULES.starCost; g.stars[i]++; out.star = true; out.coins = -RULES.starCost; }
    else out.short = true;
  } else if (kind === 'blue') { g.coins[i] += RULES.blue; out.coins = RULES.blue; }
  else if (kind === 'red') { const c = Math.min(g.coins[i], RULES.red); g.coins[i] -= c; out.coins = -c; }
  g.log.push({ turn: g.turn, ...out });
  return out;
}
export function loseCoins(g, i, n) { const c = Math.min(g.coins[i], n); g.coins[i] -= c; return c; }
// the star moves to another blue space (never one a bean stands on), picked by rng
export function moveStar(g, spaces, rng) {
  const ok = spaces.filter((s) => s.kind === 'blue' && s.id !== g.starAt && !g.at.includes(s.id));
  g.starAt = ok[Math.floor(rng() * ok.length)].id;
  return g.starAt;
}
// king of the hill: seconds on top. Returns coin awards [{ i, coins }] for 1st and 2nd (ties share)
export function hillAwards(secs) {
  const order = secs.map((s, i) => ({ i, s })).filter((r) => r.s > 0.05).sort((a, b) => b.s - a.s);
  if (!order.length) return [];
  const top = order[0].s, first = order.filter((r) => Math.abs(r.s - top) < 0.05);
  const rest = order.filter((r) => !first.includes(r)), second = rest.length ? rest.filter((r) => Math.abs(r.s - rest[0].s) < 0.05) : [];
  return [...first.map((r) => ({ i: r.i, coins: RULES.hillWin })), ...(first.length === 1 ? second.map((r) => ({ i: r.i, coins: RULES.hillSecond })) : [])];
}
// final table: stars, then coins; equal stars and coins share a place
export function standings(g) {
  const rows = g.coins.map((c, i) => ({ i, stars: g.stars[i], coins: c })).sort((a, b) => b.stars - a.stars || b.coins - a.coins || a.i - b.i);
  rows.forEach((r, k) => { const p = rows[k - 1]; r.place = k && p.stars === r.stars && p.coins === r.coins ? p.place : k + 1; });
  return rows;
}
// physical die: which face is up, from the die's local up axis in world space ([x, y, z] of each local axis's y)
// faces: +x 1, -x 6, +y 2, -y 5, +z 3, -z 4 (opposites add to 7)
export function faceUp(ax, ay, az) {
  const c = [[ax, 1], [-ax, 6], [ay, 2], [-ay, 5], [az, 3], [-az, 4]];
  return c.reduce((a, b) => (b[0] > a[0] ? b : a))[1];
}
// a bot's pick of where to walk: the star if it can buy it, else the best end space (blue over red)
export function botGoal(g, spaces, i, win, rng) {
  if (g.coins[i] >= RULES.starCost && win.window.includes(g.starAt) && g.starAt !== g.at[i]) return g.starAt;
  const scored = win.targets.map((id) => ({ id, s: (spaces[id].kind === 'blue' ? 2 : 0) + rng() }));
  return scored.reduce((a, b) => (b.s > a.s ? b : a)).id;
}
