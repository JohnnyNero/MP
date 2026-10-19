// Pure-logic checks for the 3D arenas (public/arenas): match scoring and flow, round results, and that every
// arena layout gives bots and hazards sane walkable points. The full game (rendering + physics) is covered by
// the headless probes in tools/probes (smoke.mjs runs in CI after the build).
import { describe, it, expect } from 'vitest';
import { arenaOrder, newMatch, awardRound, standings, advance, isFinal, loadMatch, saveMatch, clearMatch, PLACE_POINTS } from '../public/arenas/kit/match.js';
import * as kitchen from '../public/arenas/kitchen/layout.js';
import * as ship from '../public/arenas/ship/layout.js';
import * as station from '../public/arenas/station/layout.js';

const ARENAS = [{ id: 'kitchen', name: 'Giant Kitchen' }, { id: 'ship', name: 'Sinking Ship' }, { id: 'station', name: 'Space Station' }];
const placements = (places) => ({ placements: places.map((place, i) => ({ i, place })) });

describe('match order', () => {
  it('has the requested length, uses every arena, and never repeats an arena back to back', () => {
    for (let seed = 1; seed < 60; seed++) {
      const o = arenaOrder(['kitchen', 'ship', 'station'], 6, seed);
      expect(o).toHaveLength(6);
      expect(new Set(o).size).toBe(3);
      for (let k = 1; k < o.length; k++) expect(o[k]).not.toBe(o[k - 1]);
    }
  });
  it('is deterministic for a seed', () => {
    expect(arenaOrder(['a', 'b', 'c'], 7, 42)).toEqual(arenaOrder(['a', 'b', 'c'], 7, 42));
  });
});

describe('match scoring', () => {
  it('awards 3/2/1/0 by place and every survivor gets first-place points', () => {
    const m = newMatch({ arenas: ARENAS, rounds: 3, seed: 5 });
    awardRound(m, placements([1, 1, 3, 4]));
    expect(m.points).toEqual([PLACE_POINTS[0], PLACE_POINTS[0], PLACE_POINTS[2], PLACE_POINTS[3]]);
  });
  it('does not count the same round twice', () => {
    const m = newMatch({ arenas: ARENAS, rounds: 3, seed: 5 });
    awardRound(m, placements([1, 2, 3, 4])); awardRound(m, placements([1, 2, 3, 4]));
    expect(m.points).toEqual([3, 2, 1, 0]);
    expect(m.history).toHaveLength(1);
  });
  it('ranks by points and lets ties share a rank', () => {
    const m = newMatch({ arenas: ARENAS, rounds: 3, seed: 5 });
    awardRound(m, placements([2, 1, 1, 4]));
    const s = standings(m);
    expect(s.map((r) => r.i)).toEqual([1, 2, 0, 3]);
    expect(s.map((r) => r.rank)).toEqual([1, 1, 3, 4]);
    expect(s[0].delta).toBe(3);
  });
  it('advances round by round and ends after the last one', () => {
    const m = newMatch({ arenas: ARENAS, rounds: 3, seed: 9 });
    const urls = [];
    for (;;) { awardRound(m, placements([1, 2, 3, 4])); const u = advance(m); if (!u) break; urls.push(u); }
    expect(urls).toEqual([`./${m.order[1]}.html?match=1`, `./${m.order[2]}.html?match=1`]);
    expect(isFinal(m)).toBe(true);
    expect(m.points).toEqual([9, 6, 3, 0]);
  });
  it('round-trips through storage and ignores junk', () => {
    const store = new Map(); const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
    const m = newMatch({ arenas: ARENAS, rounds: 4, seed: 3 });
    saveMatch(m, storage); expect(loadMatch(storage)).toEqual(m);
    clearMatch(storage); expect(loadMatch(storage)).toBeNull();
    storage.setItem('tabletop.match', '{not json'); expect(loadMatch(storage)).toBeNull();
  });
});

// every arena: walkable points exist, sit on the arena, keep clear of the drop, and the spawns are on the arena
const LAYOUTS = {
  kitchen: { L: kitchen, inside: kitchen.inCounter },
  ship: { L: ship, inside: ship.onShip },
  station: { L: station, inside: station.inBay },
};
describe.each(Object.entries(LAYOUTS))('%s layout', (name, { L, inside }) => {
  it('has plenty of walkable points', () => { expect(L.POINTS.length).toBeGreaterThan(40); });
  it('keeps every point on the arena and away from the drop', () => {
    for (const [x, z, y] of L.POINTS) {
      expect(inside(x, z)).toBe(true);
      expect(L.edgeDist(x, z)).toBeGreaterThan(0.5);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
  it('spawns all four players on the arena', () => {
    expect(L.SPAWNS).toHaveLength(4);
    for (const [x, , z] of L.SPAWNS) expect(inside(x, z)).toBe(true);
  });
  if (L.OBSTACLES) it('keeps points out of obstacle footprints', () => {
    for (const [x, z] of L.POINTS) for (const r of L.OBSTACLES) expect(x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1).toBe(false);
  });
});

describe('station', () => {
  it('has grab rails the bots can find for decompression', () => {
    expect(station.POINTS.filter((p) => p[3] === 'rail').length).toBeGreaterThan(8);
    expect(station.POINTS.filter((p) => p[3] === 'under').length).toBeGreaterThan(8);
  });
  it('keeps cargo lanes clear of the lift', () => {
    for (const l of station.CARGO_LANES) expect(l.c - l.hw >= station.LIFT.z1 || l.c + l.hw <= station.LIFT.z0).toBe(true);
  });
});
