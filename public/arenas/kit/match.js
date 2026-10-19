// A match: several rounds that rotate through the arenas, scored like the cursed board (survivors move furthest).
// Each arena is its own page, so the match lives in sessionStorage and pages pass ?match=1.
// The rules below are pure (no DOM) so tests can import them; storage access is guarded.
//   const m = newMatch({ arenas: [{ id, name }], rounds: 6, seed });  saveMatch(m); location.href = matchUrl(m);
//   on results: awardRound(m, results); saveMatch(m); standings(m); isFinal(m); advance(m) -> next url or null
export const MATCH_KEY = 'tabletop.match';
export const PLACE_POINTS = [3, 2, 1, 0];       // 1st (every survivor) .. 4th

const mulberry = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// arenas in shuffled passes, never the same arena twice in a row
export function arenaOrder(ids, rounds, seed = 1) {
  const rng = mulberry(seed), out = [];
  while (out.length < rounds) {
    const pass = ids.slice();
    for (let i = pass.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pass[i], pass[j]] = [pass[j], pass[i]]; }
    if (out.length && pass.length > 1 && pass[0] === out[out.length - 1]) pass.push(pass.shift());
    out.push(...pass);
  }
  return out.slice(0, rounds);
}

export function newMatch({ arenas, rounds = 6, seed = Date.now() % 2147483647, players = 4 }) {
  return { v: 1, rounds, order: arenaOrder(arenas.map((a) => a.id), rounds, seed), names: Object.fromEntries(arenas.map((a) => [a.id, a.name])),
    i: 0, points: Array(players).fill(0), history: [], awarded: -1 };
}

// add one round's placements (results.placements: [{ i, place }]); safe to call twice for the same round
export function awardRound(m, results) {
  if (m.awarded === m.i) return m;
  const delta = Array(m.points.length).fill(0);
  for (const r of results.placements || []) if (r.i < delta.length) delta[r.i] = PLACE_POINTS[Math.min(PLACE_POINTS.length, r.place) - 1] ?? 0;
  delta.forEach((d, k) => { m.points[k] += d; });
  m.history.push({ arena: m.order[m.i], disaster: results.disaster || null, second: results.second || null, delta });
  m.awarded = m.i;
  return m;
}

// [{ i, pts, delta, rank }] best first; equal points share a rank
export function standings(m) {
  const last = m.history[m.history.length - 1]?.delta || [];
  const rows = m.points.map((pts, i) => ({ i, pts, delta: last[i] || 0 })).sort((a, b) => b.pts - a.pts || a.i - b.i);
  rows.forEach((r, k) => { r.rank = k && r.pts === rows[k - 1].pts ? rows[k - 1].rank : k + 1; });
  return rows;
}

export const isFinal = (m) => m.i >= m.rounds - 1;
export const roundLabel = (m) => `Round ${m.i + 1} of ${m.rounds}`;
export const matchUrl = (m) => `./${m.order[m.i]}.html?match=1`;
// move on after a round's results: the next round's url, or null when the match is over
export function advance(m) { if (isFinal(m)) return null; m.i++; return matchUrl(m); }

export function loadMatch(storage = globalThis.sessionStorage) {
  try { const m = JSON.parse(storage?.getItem(MATCH_KEY) || 'null'); return m && m.v === 1 && Array.isArray(m.order) ? m : null; } catch { return null; }
}
export function saveMatch(m, storage = globalThis.sessionStorage) { try { storage?.setItem(MATCH_KEY, JSON.stringify(m)); } catch { /* private mode: the match just won't carry over */ } }
export function clearMatch(storage = globalThis.sessionStorage) { try { storage?.removeItem(MATCH_KEY); } catch { /* ignore */ } }
