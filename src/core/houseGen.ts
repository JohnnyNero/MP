// Procedural houses: a 6 x 4 cell grid (row 0 at the top, row 3 the basement,
// row 2 the ground floor) of mixed-size rooms joined by a spanning tree of
// two-way links plus loops, with 3-5 signature features. Deterministic for
// (seed, goofiness).
import { HOUSE } from '../content/house';
import { HOUSE_NAMES_1, HOUSE_NAMES_2, THEMES, type FeatureId, type ThemeDef } from '../content/houseThemes';
import { bottomRow, measureHouse } from './houseGrid';
import { makeRandom } from './rng';
import type { ConnectionDef, Goofiness, HouseDef, PropDef, RoomDef } from './types';

export const HOUSE_COLS = 6;
export const HOUSE_ROWS = 4;
/** Longest allowed trip (seconds) from any room to the board room. */
export const MAX_TRIP_S = 9;
/** Vertical connectors and props keep this far from cell / room edges (0..1). */
export const EDGE_MARGIN = 0.15;
/** Portal ends must be at least this many cells apart (Manhattan). */
export const PORTAL_MIN_CELLS = 3;
export const MAX_ATTEMPTS = 300;

type R = () => number;

interface Build {
  house: HouseDef;
  ok: boolean;
}

export function generateHouse(seed: number, goofiness: Goofiness): HouseDef {
  const R = makeRandom((Math.imul(seed >>> 0, 2654435761) ^ (goofiness * 0x5bd1e995) ^ 0x1234567) >>> 0);
  const nameR = makeRandom((seed ^ 0xabc) >>> 0);
  const name = `${HOUSE_NAMES_1[Math.floor(nameR() * HOUSE_NAMES_1.length)]} ${HOUSE_NAMES_2[Math.floor(nameR() * HOUSE_NAMES_2.length)]}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const b = build(R, goofiness);
    if (b.ok) return { ...b.house, name, seed };
  }
  // Never seen in tests (6000 houses); a safe house beats a crash.
  return { ...(JSON.parse(JSON.stringify(HOUSE)) as HouseDef), seed, goofiness };
}

function shuffle<T>(R: R, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(R() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const rnd = <T>(R: R, a: readonly T[]): T => a[Math.floor(R() * a.length)];
const inset = (R: R) => EDGE_MARGIN + R() * (1 - 2 * EDGE_MARGIN);

function pickTheme(R: R, goof: Goofiness, used: Set<string>): ThemeDef {
  const avail = THEMES.filter((t) => t.level <= goof && !used.has(t.key));
  const exact = avail.filter((t) => t.level === goof);
  // Goofier houses lean on their own level's themes.
  if (goof > 0 && exact.length && R() < 0.65) return rnd(R, exact);
  return rnd(R, avail.length ? avail : THEMES);
}

interface HEdge { a: number; b: number; wallX: number; row: number }
interface VEdge { upper: number; lower: number; cols: number[]; boundary: number }

function build(R: R, goof: Goofiness): Build {
  const COLS = HOUSE_COLS;
  const ROWS = HOUSE_ROWS;
  // 1. Grid with a lumpy roofline: top-row cells may be missing.
  const present: boolean[][] = [];
  for (let r = 0; r < ROWS; r++) {
    present.push([]);
    for (let c = 0; c < COLS; c++) present[r].push(!(r === 0 && R() < 0.25 + goof * 0.1));
  }
  // 2. Merge cells into rooms.
  const owner: number[][] = present.map((row) => row.map(() => -1));
  const rooms: RoomDef[] = [];
  const usedThemes = new Set<string>();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!present[r][c] || owner[r][c] >= 0) continue;
      let w = 1;
      let h = 1;
      const maxW = R() < 0.25 ? 3 : R() < 0.55 ? 2 : 1;
      while (w < maxW && c + w < COLS && present[r][c + w] && owner[r][c + w] < 0) w++;
      if (r < ROWS - 1 && r > 0 && R() < 0.18 + goof * 0.06) {
        let okV = true;
        for (let k = 0; k < w; k++) if (!present[r + 1][c + k] || owner[r + 1][c + k] >= 0) okV = false;
        if (okV) h = 2;
      }
      const idx = rooms.length;
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) owner[r + dy][c + dx] = idx;
      const t = pickTheme(R, goof, usedThemes);
      usedThemes.add(t.key);
      rooms.push({
        id: usedThemes.size === rooms.length + 1 ? t.key : `${t.key}-${idx}`,
        name: t.name, theme: t.key, color: t.color,
        gx: c, gy: r, gw: w, gh: h, col: c, floor: ROWS - 1 - (r + h - 1),
      });
    }
  }
  const bottom = rooms.map(bottomRow);
  // Adjacency. Doors only where both rooms have their floor on the wall's row.
  const horiz = new Map<string, HEdge>();
  const vert = new Map<string, VEdge>();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const a = owner[r][c];
      if (a < 0) continue;
      if (c + 1 < COLS) {
        const b = owner[r][c + 1];
        if (b >= 0 && b !== a && bottom[a] === r && bottom[b] === r) horiz.set(`${a}-${b}`, { a, b, wallX: c + 1, row: r });
      }
      if (r + 1 < ROWS) {
        const b = owner[r + 1][c];
        if (b >= 0 && b !== a) {
          const k = `${a}-${b}`;
          if (!vert.has(k)) vert.set(k, { upper: a, lower: b, cols: [], boundary: r + 1 });
          vert.get(k)!.cols.push(c);
        }
      }
    }
  }
  // Vertical slots: one connector per column per floor boundary.
  const slotUsed = new Set<string>();
  const slot = (col: number, boundary: number) => `${col},${boundary}`;
  const freeCols = (e: VEdge) => e.cols.filter((c) => !slotUsed.has(slot(c, e.boundary)));

  const links: ConnectionDef[] = [];
  let nextId = 0;
  const id = (k: string, a: number, b: number) => `${k}-${rooms[a].id}-${rooms[b].id}-${nextId++}`;
  type Cand = { t: 'door'; e: HEdge } | { t: 'vert'; e: VEdge };
  const cands: Cand[] = shuffle(R, [
    ...[...horiz.values()].map((e) => ({ t: 'door' as const, e })),
    ...[...vert.values()].map((e) => ({ t: 'vert' as const, e })),
  ]);
  const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const linked = new Set<string>();
  const addTwoWay = (cn: Cand): boolean => {
    if (cn.t === 'door') {
      const kind = R() < 0.12 * goof ? 'bookcase' : 'door';
      links.push({ id: id(kind === 'door' ? 'd' : 'bk', cn.e.a, cn.e.b), kind, a: rooms[cn.e.a].id, b: rooms[cn.e.b].id, wallX: cn.e.wallX, row: cn.e.row });
      linked.add(pairKey(cn.e.a, cn.e.b));
      return true;
    }
    const cols = freeCols(cn.e);
    if (!cols.length) return false;
    const col = rnd(R, cols);
    const kind = R() < 0.5 ? 'stairs' : 'ladder';
    slotUsed.add(slot(col, cn.e.boundary));
    links.push({ id: id(kind[0], cn.e.lower, cn.e.upper), kind, a: rooms[cn.e.lower].id, b: rooms[cn.e.upper].id, colX: col, frac: inset(R) });
    linked.add(pairKey(cn.e.lower, cn.e.upper));
    return true;
  };
  const candPair = (cn: Cand) => (cn.t === 'door' ? [cn.e.a, cn.e.b] : [cn.e.upper, cn.e.lower]);
  // 3. Spanning tree of two-way links.
  const parent = rooms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const cn of cands) {
    const [a, b] = candPair(cn);
    if (find(a) !== find(b) && addTwoWay(cn)) parent[find(a)] = find(b);
  }
  // 4. Loops.
  const extra = Math.round(rooms.length * (0.3 + 0.08 * goof));
  for (const cn of cands) {
    if (links.length >= rooms.length - 1 + extra) break;
    const [a, b] = candPair(cn);
    if (!linked.has(pairKey(a, b)) && R() < 0.6) addTwoWay(cn);
  }
  // Board room: near the middle, floor on row 1 or 2, wider wins ties.
  const mid = rooms
    .filter((rm) => bottomRow(rm) >= 1 && bottomRow(rm) <= 2)
    .sort((p, q) => Math.abs(p.gx + p.gw / 2 - COLS / 2) - Math.abs(q.gx + q.gw / 2 - COLS / 2) || q.gw - p.gw);
  const board = (mid[0] ?? rooms[0]).id;
  // 5. Signature features.
  const props: PropDef[] = [];
  const deck: FeatureId[] = ['portal', 'tramp', 'chute', 'pole', 'slide', 'lift', 'switch', 'trapdoor'];
  if (goof === 0) deck.splice(deck.indexOf('portal'), 1);
  shuffle(R, deck);
  const nFeat = 3 + Math.floor(R() * (2 + goof * 0.5));
  const features: FeatureId[] = links.some((l) => l.kind === 'bookcase') ? ['bookcase'] : [];
  const ctx: FeatureCtx = { R, rooms, owner, links, vert: [...vert.values()], props, slotUsed, slot, freeCols, id };
  for (const f of deck) {
    if (features.length >= nFeat) break;
    if (placeFeature(f, ctx)) features.push(f);
  }
  const gaps: string[] = [];
  for (let c = 0; c < COLS; c++) if (!present[0][c]) gaps.push(`${c},0`);
  const house: HouseDef = {
    cols: COLS, rows: ROWS, rooms, connections: links, props, boardRoom: board,
    features, name: '', seed: 0, goofiness: goof, gaps,
  };
  const m = measureHouse(house);
  const ok = m.twoWayConnected && Object.values(m.fromBoard).every(Number.isFinite) && m.worst < MAX_TRIP_S && features.length >= 2;
  return { house, ok };
}

interface FeatureCtx {
  R: R;
  rooms: RoomDef[];
  owner: number[][];
  links: ConnectionDef[];
  vert: VEdge[];
  props: PropDef[];
  slotUsed: Set<string>;
  slot: (col: number, boundary: number) => string;
  freeCols: (e: VEdge) => number[];
  id: (k: string, a: number, b: number) => string;
}

function placeFeature(f: FeatureId, x: FeatureCtx): boolean {
  const { R, rooms, owner, links } = x;
  const idx = (roomId: string) => rooms.findIndex((r) => r.id === roomId);
  if (f === 'portal') {
    if (rooms.length < 4) return false;
    const endCell = (rm: RoomDef, frac: number) => ({ x: rm.gx + Math.min(rm.gw - 1, Math.floor(frac * rm.gw)), y: bottomRow(rm) });
    for (let n = 0; n < 20; n++) {
      const a = rnd(R, rooms);
      const b = rnd(R, rooms);
      const fa = inset(R);
      const fb = inset(R);
      if (a === b) continue;
      const ca = endCell(a, fa);
      const cb = endCell(b, fb);
      if (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) < PORTAL_MIN_CELLS) continue;
      links.push({ id: x.id('p', idx(a.id), idx(b.id)), kind: 'portal', a: a.id, b: b.id, fracA: fa, fracB: fb });
      return true;
    }
    return false;
  }
  if (f === 'switch' || f === 'trapdoor') {
    // A trapdoor needs a floor with something underneath.
    const opts = rooms.filter((rm) => (f === 'trapdoor' ? bottomRow(rm) < owner.length - 1 : true));
    if (!opts.length) return false;
    const rm = rnd(R, opts);
    x.props.push({ id: `${f === 'switch' ? 'sw' : 'td'}-${rm.id}`, kind: f, room: rm.id, frac: inset(R) });
    return true;
  }
  if (f === 'lift') {
    // A shaft through 2-3 stacked rooms in one column.
    for (const col of shuffle(R, [0, 1, 2, 3, 4, 5].slice(0, owner[0].length))) {
      const stops: number[] = [];
      for (let r = 0; r < owner.length; r++) {
        const o = owner[r][col];
        if (o >= 0 && !stops.includes(o)) stops.push(o);
      }
      if (stops.length < 2) continue;
      const len = Math.min(stops.length, 2 + Math.floor(R() * 2));
      const start = Math.floor(R() * (stops.length - len + 1));
      const run = stops.slice(start, start + len);
      const bounds = run.slice(1).map((s) => rooms[s].gy);
      if (bounds.some((b) => x.slotUsed.has(x.slot(col, b)))) continue;
      const frac = inset(R);
      for (const b of bounds) x.slotUsed.add(x.slot(col, b));
      for (let i = 0; i + 1 < run.length; i++) {
        // a = lower stop, b = upper stop.
        links.push({ id: x.id('lf', run[i + 1], run[i]), kind: 'lift', a: rooms[run[i + 1]].id, b: rooms[run[i]].id, colX: col, frac });
      }
      return true;
    }
    return false;
  }
  // One-way vertical: chute / pole / slide go down (b -> a), tramp goes up (a -> b).
  const v = x.vert.filter((e) => x.freeCols(e).length > 0);
  if (!v.length) return false;
  const e = rnd(R, v);
  const col = rnd(R, x.freeCols(e));
  x.slotUsed.add(x.slot(col, e.boundary));
  links.push({ id: x.id(f, e.lower, e.upper), kind: f, a: rooms[e.lower].id, b: rooms[e.upper].id, colX: col, frac: inset(R) });
  return true;
}
