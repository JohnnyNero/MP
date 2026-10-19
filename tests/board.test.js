// The board's pure rules and layout (public/arenas/board): movement windows, landing, the star, the hill game,
// final standings, and that the board graph is a sane loop on the table. The physical game is covered by
// tools/probes (smoke.mjs plays a few turns in CI).
import { describe, it, expect } from 'vitest';
import * as L from '../public/arenas/board/layout.js';
import * as CL from '../public/arenas/cove/layout.js';
import { RULES, reach, behind, walkWindow, settle, newGame, land, loseCoins, moveStar, placeByScore, placeBySurvival, gameCoins, standings, faceUp, botGoal } from '../public/arenas/board/rules.js';

const S = L.SPACES;
const seq = (vals) => { let k = 0; return () => vals[k++ % vals.length]; };

describe('board layout', () => {
  it('is a loop of 18 spaces with one shortcut back into it', () => {
    let id = L.START; const seen = new Set();
    for (let k = 0; k < 18; k++) { seen.add(id); id = S[id].next[0]; }
    expect(id).toBe(L.START); expect(seen.size).toBe(18);
    expect(S[3].next).toEqual([4, 18]);
    expect(reach(S, 3, 3).targets.sort((a, b) => a - b)).toEqual([6, 12]);
  });
  it('puts every space on the table, on a walkable surface, clear of the edge', () => {
    for (const s of S) {
      expect(L.inTable(s.x, s.z)).toBe(true);
      expect(s.y).toBeCloseTo(L.heightAt(s.x, s.z), 5);
      expect(L.edgeDist(s.x, s.z)).toBeGreaterThan(0.6);
    }
  });
  it('links every waypoint into one graph the bots can route over', () => {
    const adj = new Map(L.WAYPOINTS.map((w) => [w.id, []]));
    for (const [a, b] of L.LINKS) { expect(adj.has(a) && adj.has(b)).toBe(true); adj.get(a).push(b); adj.get(b).push(a); }
    const seen = new Set(['hill']), q = ['hill'];
    while (q.length) for (const n of adj.get(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
    expect(seen.size).toBe(L.WAYPOINTS.length);
  });
  it('spawns everyone on the table above a surface', () => {
    for (const [x, y, z] of [...L.SPAWNS, ...L.HILL_SPAWNS]) { expect(L.inTable(x, z)).toBe(true); expect(y).toBeGreaterThan(L.heightAt(x, z)); }
  });
});

describe('walking', () => {
  it('reaches every branch of a fork and lists the spaces passed', () => {
    const r = reach(S, 2, 3);
    expect(r.targets.sort((a, b) => a - b)).toEqual([5, 19]);
    expect(r.passed.sort((a, b) => a - b)).toEqual([3, 4, 18]);
  });
  it('allows a few spaces behind the start (shoved back), across the shortcut too', () => {
    expect(behind(S, 0, 2).sort((a, b) => a - b)).toEqual([16, 17]);
    expect(behind(S, 12, 1).sort((a, b) => a - b)).toEqual([11, 19]);
  });
  it('lands you on the nearest space you were allowed to reach', () => {
    const w = walkWindow(S, 0, 2);
    expect(settle(S, w.window, { x: S[2].x, y: S[2].y, z: S[2].z })).toBe(2);
    expect(settle(S, w.window, { x: S[6].x, y: S[6].y, z: S[6].z })).toBe(2);          // walked past the roll: the end
    expect(settle(S, w.window, { x: S[17].x + 0.2, y: S[17].y, z: S[17].z })).toBe(17); // shoved back
  });
  it('counts height, so standing under the bridge is not standing on it', () => {
    const w = walkWindow(S, 3, 2);
    expect(settle(S, w.window, { x: 0.9, y: 0, z: 1.3 })).not.toBe(18);
  });
});

describe('landing, coins and the star', () => {
  it('pays blue and chests, charges red (never below zero)', () => {
    const g = newGame();
    expect(land(g, 0, 1, 'blue').coins).toBe(RULES.blue);
    expect(land(g, 3, 5, 'chest').coins).toBe(RULES.chest);
    g.coins[1] = 1; expect(land(g, 1, 2, 'red').coins).toBe(-1); expect(g.coins[1]).toBe(0);
  });
  it('sells the star only to a bean that can pay', () => {
    const g = newGame({ starAt: 9 });
    g.coins[0] = RULES.starCost - 1; expect(land(g, 0, 9, 'blue')).toMatchObject({ star: false, short: true });
    g.coins[1] = RULES.starCost + 2; expect(land(g, 1, 9, 'blue')).toMatchObject({ star: true });
    expect(g.stars[1]).toBe(1); expect(g.coins[1]).toBe(2);
  });
  it('moves the star to a free blue space', () => {
    const g = newGame({ starAt: 9 }); g.at = [1, 4, 6, 7];
    for (let k = 0; k < 30; k++) { const id = moveStar(g, S, Math.random); expect(S[id].kind).toBe('blue'); expect(g.at).not.toContain(id); }
  });
  it('loses coins on a fall, never below zero', () => {
    const g = newGame(); g.coins[2] = 2; expect(loseCoins(g, 2, RULES.fallCost)).toBe(2); expect(g.coins[2]).toBe(0);
  });
});

describe('minigames and the final table', () => {
  it('places score games by score, ties sharing, and pays nothing for a zero score', () => {
    expect(placeByScore([3, 9, 0, 3]).map((r) => [r.i, r.place])).toEqual([[1, 1], [0, 2], [3, 2], [2, 4]]);
    expect(gameCoins(placeByScore([3, 9, 0, 3])).map((r) => r.coins)).toEqual([RULES.gameCoins[0], RULES.gameCoins[1], RULES.gameCoins[1], 0]);
    expect(gameCoins(placeByScore([0, 0, 0, 0])).every((r) => r.coins === 0)).toBe(true);
  });
  it('places survival games: survivors share 1st, then whoever lasted longer', () => {
    const p = placeBySurvival(4, [{ i: 2, t: 3 }, { i: 0, t: 9 }]);
    expect(p.map((r) => [r.i, r.place])).toEqual([[1, 1], [3, 1], [0, 3], [2, 4]]);
    expect(placeBySurvival(3, [{ i: 0, t: 5 }, { i: 1, t: 5 }, { i: 2, t: 5 }]).map((r) => r.place)).toEqual([1, 1, 1]);
  });
  it('ranks by stars, then coins, sharing exact ties', () => {
    const g = newGame(); g.stars = [1, 2, 1, 0]; g.coins = [9, 0, 9, 30];
    expect(standings(g).map((r) => [r.i, r.place])).toEqual([[1, 1], [0, 2], [2, 2], [3, 4]]);
  });
});

describe('dice and bots', () => {
  it('reads the face pointing up', () => {
    expect(faceUp(1, 0, 0)).toBe(1); expect(faceUp(-1, 0, 0)).toBe(6);
    expect(faceUp(0, 1, 0)).toBe(2); expect(faceUp(0, -1, 0)).toBe(5);
    expect(faceUp(0.1, 0.2, 0.97)).toBe(3); expect(faceUp(0, 0, -1)).toBe(4);
  });
  it('sends a bot to the star when it can buy it, otherwise to a blue end', () => {
    const g = newGame({ starAt: 4 }); g.coins[0] = RULES.starCost;
    expect(botGoal(g, S, 0, walkWindow(S, 0, 6), seq([0.5]))).toBe(4);
    g.coins[0] = 0;
    expect(botGoal(g, S, 0, walkWindow(S, 2, 2), seq([0.9, 0.1]))).toBe(4);           // blue 4 over red 18
  });
});

describe('pirate cove layout', () => {
  const C = CL.SPACES;
  it('is a ring of 12 with a stone shortcut and a high road back into it', () => {
    let id = CL.START; const seen = new Set();
    for (let k = 0; k < 12; k++) { seen.add(id); id = C[id].next[0]; }
    expect(id).toBe(CL.START); expect(seen.size).toBe(12);
    expect(reach(C, 0, 3).targets.sort((a, b) => a - b)).toEqual([3, 6]);          // round the ring, or over the stones
    expect(reach(C, 3, 6).targets).toContain(8);                                    // the high road comes down onto the ring
  });
  it('puts every space on dry walkable ground, clear of the water', () => {
    for (const s of C) {
      expect(s.y).toBeGreaterThan(CL.WATER_Y + 0.4);
      expect(s.y).toBeCloseTo(CL.heightAt(s.x, s.z), 5);
      expect(CL.edgeDist(s.x, s.z)).toBeGreaterThan(s.tag === 'stone' ? 0.3 : 0.6);
    }
  });
  it('links every waypoint into one graph', () => {
    const adj = new Map(CL.WAYPOINTS.map((w) => [w.id, []]));
    for (const [a, b] of CL.LINKS) { expect(adj.has(a) && adj.has(b)).toBe(true); adj.get(a).push(b); adj.get(b).push(a); }
    const seen = new Set(['hill']), q = ['hill'];
    while (q.length) for (const n of adj.get(q.shift())) if (!seen.has(n)) { seen.add(n); q.push(n); }
    expect(seen.size).toBe(CL.WAYPOINTS.length);
  });
  it('has a lagoon to swim in and a captain\'s deck on the wreck', () => {
    expect(CL.terrainH(CL.LAGOON.cx, CL.LAGOON.cz)).toBeLessThan(CL.WATER_Y - 0.5);
    expect(CL.heightAt((CL.HILL.x0 + CL.HILL.x1) / 2, (CL.HILL.z0 + CL.HILL.z1) / 2)).toBeCloseTo(CL.HILL.y, 5);
    for (const [x, y, z] of CL.SPAWNS) expect(y).toBeGreaterThan(CL.heightAt(x, z));
  });
});
