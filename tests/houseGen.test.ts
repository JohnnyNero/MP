import { describe, expect, it } from 'vitest';
import { HOUSE } from '../src/content/house';
import { THEME_BY_KEY } from '../src/content/houseThemes';
import { newGame } from '../src/core/game';
import { EDGE_MARGIN, generateHouse, HOUSE_COLS, HOUSE_ROWS, MAX_TRIP_S, PORTAL_MIN_CELLS } from '../src/core/houseGen';
import { bottomRow, measureHouse, ownerGrid, VERTICAL_KINDS } from '../src/core/houseGrid';
import type { Goofiness, HouseDef } from '../src/core/types';

/** Every rule a generated (or hand-made) house must satisfy. Returns the problems. */
function problems(h: HouseDef): string[] {
  const out: string[] = [];
  const byId = new Map(h.rooms.map((r) => [r.id, r]));
  if (byId.size !== h.rooms.length) out.push('duplicate room ids');
  // Cells: each is exactly one room or a listed gap; gaps only on the top row.
  const count: number[][] = Array.from({ length: h.rows }, () => Array(h.cols).fill(0));
  for (const r of h.rooms) {
    if (r.gx < 0 || r.gy < 0 || r.gx + r.gw > h.cols || r.gy + r.gh > h.rows) out.push(`${r.id} out of grid`);
    if (r.col !== r.gx || r.floor !== h.rows - 1 - bottomRow(r)) out.push(`${r.id} col/floor mismatch`);
    for (let y = r.gy; y < r.gy + r.gh; y++) for (let x = r.gx; x < r.gx + r.gw; x++) if (count[y]?.[x] !== undefined) count[y][x]++;
  }
  const gaps = new Set(h.gaps);
  for (let y = 0; y < h.rows; y++) {
    for (let x = 0; x < h.cols; x++) {
      const gap = gaps.has(`${x},${y}`);
      if (gap && y !== 0) out.push(`gap below the top row at ${x},${y}`);
      if (count[y][x] + (gap ? 1 : 0) !== 1) out.push(`cell ${x},${y} covered ${count[y][x]}x, gap=${gap}`);
    }
  }
  if (!byId.has(h.boardRoom)) out.push('no board room');
  else {
    const b = bottomRow(byId.get(h.boardRoom)!);
    if (b < 1 || b > 2) out.push('board room not on rows 1-2');
  }
  // Geometry.
  const slots = new Set<string>();
  for (const c of h.connections) {
    const a = byId.get(c.a);
    const b = byId.get(c.b);
    if (!a || !b) {
      out.push(`${c.id} dangling`);
      continue;
    }
    if (c.kind === 'door' || c.kind === 'bookcase') {
      if (c.wallX === undefined || c.row === undefined) out.push(`${c.id} no wall`);
      else {
        if (a.gx + a.gw !== c.wallX || b.gx !== c.wallX) out.push(`${c.id} not on the shared wall`);
        if (bottomRow(a) !== c.row || bottomRow(b) !== c.row) out.push(`${c.id} not on both floor rows`);
      }
    } else if (VERTICAL_KINDS.includes(c.kind)) {
      if (c.colX === undefined || c.frac === undefined) out.push(`${c.id} no column`);
      else {
        if (bottomRow(b) + 1 !== a.gy) out.push(`${c.id} upper floor does not sit on lower ceiling`);
        const inA = c.colX >= a.gx && c.colX < a.gx + a.gw;
        const inB = c.colX >= b.gx && c.colX < b.gx + b.gw;
        if (!inA || !inB) out.push(`${c.id} column not shared`);
        if (c.frac < EDGE_MARGIN - 1e-9 || c.frac > 1 - EDGE_MARGIN + 1e-9) out.push(`${c.id} frac too near the edge`);
        const k = `${c.colX},${a.gy}`;
        if (slots.has(k)) out.push(`${c.id} overlaps another vertical connector at ${k}`);
        slots.add(k);
      }
    } else if (c.kind === 'portal') {
      if (c.fracA === undefined || c.fracB === undefined) out.push(`${c.id} no fracs`);
      else {
        const cell = (r: typeof a, f: number) => [r.gx + Math.min(r.gw - 1, Math.floor(f * r.gw)), bottomRow(r)];
        const [ax, ay] = cell(a, c.fracA);
        const [bx, by] = cell(b, c.fracB);
        if (Math.abs(ax - bx) + Math.abs(ay - by) < PORTAL_MIN_CELLS) out.push(`${c.id} portal ends too close`);
      }
    }
  }
  for (const p of h.props) {
    const r = byId.get(p.room);
    if (!r) out.push(`${p.id} dangling`);
    else if (p.kind === 'trapdoor' && bottomRow(r) === h.rows - 1) out.push(`${p.id} trapdoor in the basement`);
  }
  const m = measureHouse(h);
  if (!m.twoWayConnected) out.push('not connected by two-way links');
  if (!Object.values(m.fromBoard).every(Number.isFinite)) out.push('board cannot reach every room');
  if (!(m.worst < MAX_TRIP_S)) out.push(`longest trip ${m.worst.toFixed(1)}s`);
  if (h.features.length < 2 || h.features.length > 5) out.push(`${h.features.length} features`);
  return out;
}

describe('house generator', () => {
  it('the fixed fixture house is valid', () => {
    expect(problems(HOUSE)).toEqual([]);
  });

  it('2000 seeds x 3 goofiness levels all pass every rule', () => {
    const bad: string[] = [];
    let total = 0;
    for (const g of [0, 1, 2] as Goofiness[]) {
      for (let seed = 1; seed <= 2000; seed++) {
        const h = generateHouse(seed, g);
        total++;
        if (h.cols !== HOUSE_COLS || h.rows !== HOUSE_ROWS) bad.push(`${seed}/${g}: grid size`);
        if (h.name === HOUSE.name) bad.push(`${seed}/${g}: fell back to the fixture`);
        if (h.seed !== seed || h.goofiness !== g) bad.push(`${seed}/${g}: seed/goofiness not recorded`);
        const themes = h.rooms.map((r) => r.theme);
        if (new Set(themes).size !== themes.length) bad.push(`${seed}/${g}: repeated theme`);
        for (const t of themes) if (!THEME_BY_KEY[t] || THEME_BY_KEY[t].level > g) bad.push(`${seed}/${g}: theme ${t} too goofy`);
        if (g === 0 && h.connections.some((c) => c.kind === 'portal')) bad.push(`${seed}/0: portal in a sensible house`);
        for (const p of problems(h)) bad.push(`${seed}/${g}: ${p}`);
        if (bad.length > 20) break;
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
    expect(total).toBe(6000);
  });

  it('is deterministic for a seed and varies across seeds', () => {
    for (const g of [0, 1, 2] as Goofiness[]) {
      for (const seed of [1, 7, 4242, 99999]) expect(generateHouse(seed, g)).toEqual(generateHouse(seed, g));
    }
    const shapes = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(ownerGrid(generateHouse(i + 1, 1)))));
    expect(shapes.size).toBeGreaterThan(40);
  });

  it('lifts are two-way stops in one column', () => {
    let lifts = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const h = generateHouse(seed, 1);
      const ls = h.connections.filter((c) => c.kind === 'lift');
      if (!ls.length) continue;
      lifts++;
      expect(new Set(ls.map((c) => c.colX)).size).toBe(1);
      expect(h.features).toContain('lift');
    }
    expect(lifts).toBeGreaterThan(0);
  });

  it('newGame builds the house from its seed', () => {
    const configs = [{ name: 'A', isBot: true }, { name: 'B', isBot: true }];
    expect(newGame(5, configs, 2).house).toEqual(generateHouse(5, 2));
    expect(newGame(5, configs).house.goofiness).toBe(1);
  });
});
