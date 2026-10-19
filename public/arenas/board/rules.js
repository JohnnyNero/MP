// Board rules (pure: no THREE, no DOM, unit-tested). The physical game decides where beans stand; these functions
// turn that into board positions, coins and stars.
//   spaces: [{ id, x, y, z, kind: 'blue'|'red', next: [ids] }]
export const RULES = { startCoins: 5, blue: 3, red: 3, chest: 6, starCost: 10, back: 3, fallCost: 3, gameCoins: [6, 3, 1, 0] };

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
  } else if (kind === 'blue' || kind === 'chest') { const c = RULES[kind]; g.coins[i] += c; out.coins = c; }
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
// minigame placements, ties sharing a place: by score (higher is better; a zero score earns nothing, so it's last)
export function placeByScore(scores) {
  const order = scores.map((s, i) => ({ i, s })).sort((a, b) => b.s - a.s || a.i - b.i);
  const out = []; order.forEach((r, k) => { const p = order[k - 1]; out.push({ i: r.i, place: k && Math.abs(p.s - r.s) < 0.05 ? out[k - 1].place : k + 1, score: r.s }); });
  return out.map((r) => (r.score > 0.05 ? r : { ...r, place: scores.length, nothing: true }));
}
// by survival: everyone still in shares 1st; the rest by how long they lasted (out at the same moment ties)
export function placeBySurvival(n, outs) {
  const out = [], alive = []; for (let i = 0; i < n; i++) if (!outs.some((o) => o.i === i)) alive.push(i);
  for (const i of alive) out.push({ i, place: 1 });
  const rest = outs.slice().sort((a, b) => b.t - a.t); let next = alive.length + 1;
  rest.forEach((o, k) => { const tie = k && Math.abs(rest[k - 1].t - o.t) < 0.05; out.push({ i: o.i, place: tie ? out[out.length - 1].place : next }); next++; });
  return out;
}
// coins for a minigame's placements (RULES.gameCoins by place; a zero score gets none)
export const gameCoins = (places) => places.map((r) => ({ i: r.i, place: r.place, coins: r.nothing ? 0 : RULES.gameCoins[r.place - 1] ?? 0 }));
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
