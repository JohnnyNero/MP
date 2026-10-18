// Grid geometry and travel metrics for house layouts. Pure, no game state.
import type { ConnectionDef, ConnectionKind, HouseDef, RoomDef } from './types';

/** Grid row (from the top) of a room's floor. */
export const bottomRow = (r: RoomDef): number => r.gy + r.gh - 1;

/** Kinds that only go from b (upper) down to a (lower). */
export const DOWN_ONLY: readonly ConnectionKind[] = ['chute', 'pole', 'slide', 'hole'];
/** Kinds that only go from a (lower) up to b (upper). */
export const UP_ONLY: readonly ConnectionKind[] = ['tramp'];
/** Kinds positioned by colX/frac across a floor boundary. */
export const VERTICAL_KINDS: readonly ConnectionKind[] = ['stairs', 'ladder', 'lift', 'chute', 'pole', 'slide', 'tramp', 'hole'];

export const isTwoWay = (c: ConnectionDef): boolean => !DOWN_ONLY.includes(c.kind) && !UP_ONLY.includes(c.kind);

/** Can a player use connection `c` starting in room `from`? Returns the far room or null. */
export function traverse(c: ConnectionDef, from: string): string | null {
  if (DOWN_ONLY.includes(c.kind)) return c.b === from ? c.a : null;
  if (UP_ONLY.includes(c.kind)) return c.a === from ? c.b : null;
  if (c.a === from) return c.b;
  if (c.b === from) return c.a;
  return null;
}

/** owner[gy][gx] = room id, or null for a gap. */
export function ownerGrid(house: Pick<HouseDef, 'cols' | 'rows' | 'rooms'>): (string | null)[][] {
  const g: (string | null)[][] = Array.from({ length: house.rows }, () => Array<string | null>(house.cols).fill(null));
  for (const r of house.rooms) {
    for (let y = r.gy; y < r.gy + r.gh; y++) for (let x = r.gx; x < r.gx + r.gw; x++) g[y][x] = r.id;
  }
  return g;
}

/** Columns of `room` with nothing but sky above them (a meteor can land there). */
export function roofCols(house: HouseDef, room: RoomDef, grid = ownerGrid(house)): number[] {
  const out: number[] = [];
  for (let x = room.gx; x < room.gx + room.gw; x++) {
    let open = true;
    for (let y = 0; y < room.gy; y++) if (grid[y][x] !== null) open = false;
    if (open) out.push(x);
  }
  return out;
}

/** Horizontal position (in cells) where `c` touches `room`. */
export function connectorX(house: HouseDef, c: ConnectionDef, room: string): number {
  if (c.wallX !== undefined) return c.wallX;
  if (c.colX !== undefined) return c.colX + (c.frac ?? 0.5);
  const r = house.rooms.find((x) => x.id === room)!;
  const f = room === c.a ? c.fracA : c.fracB;
  return r.gx + (f ?? 0.5) * r.gw;
}

/** Walking speed in cells per second (82 px/s over a 76 px cell). */
export const WALK_CELLS_PER_S = 82 / 76;
/** Fixed cost (seconds) of using each kind of connection. */
export const TRAVEL_COST: Record<ConnectionKind, number> = {
  door: 0.3, bookcase: 0.6, stairs: 1.4, ladder: 1.1, lift: 2.4, portal: 0.3,
  chute: 0.5, pole: 0.4, slide: 0.7, tramp: 0.5, hole: 0.5,
};

export interface HouseMetrics {
  /** Seconds from each room to the board room. */
  toBoard: Record<string, number>;
  /** Seconds from the board room to each room. */
  fromBoard: Record<string, number>;
  worst: number;
  avg: number;
  /** Every room reaches the board and back using two-way links alone. */
  twoWayConnected: boolean;
}

function dijkstra(ids: string[], src: string, edges: Map<string, { to: string; t: number }[]>): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const id of ids) dist[id] = Infinity;
  dist[src] = 0;
  const done = new Set<string>();
  for (;;) {
    let u: string | null = null;
    for (const id of ids) if (!done.has(id) && (u === null || dist[id] < dist[u])) u = id;
    if (u === null || dist[u] === Infinity) break;
    done.add(u);
    for (const e of edges.get(u) ?? []) if (dist[u] + e.t < dist[e.to]) dist[e.to] = dist[u] + e.t;
  }
  return dist;
}

export function measureHouse(house: HouseDef, connections = house.connections, board = house.boardRoom): HouseMetrics {
  const ids = house.rooms.map((r) => r.id);
  const centre: Record<string, number> = {};
  for (const r of house.rooms) centre[r.id] = r.gx + r.gw / 2;
  const fwd = new Map<string, { to: string; t: number }[]>();
  const rev = new Map<string, { to: string; t: number }[]>();
  const twoWay = new Map<string, string[]>();
  const add = (m: Map<string, { to: string; t: number }[]>, k: string, v: { to: string; t: number }) => {
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  };
  for (const c of connections) {
    const walk = (room: string) => Math.abs(centre[room] - connectorX(house, c, room)) / WALK_CELLS_PER_S;
    const t = TRAVEL_COST[c.kind] + 0.5 * walk(c.a) + 0.5 * walk(c.b);
    for (const [from, to] of [[c.a, c.b], [c.b, c.a]]) {
      if (traverse(c, from) !== to) continue;
      add(fwd, from, { to, t });
      add(rev, to, { to: from, t });
    }
    if (isTwoWay(c)) {
      twoWay.set(c.a, [...(twoWay.get(c.a) ?? []), c.b]);
      twoWay.set(c.b, [...(twoWay.get(c.b) ?? []), c.a]);
    }
  }
  const toBoard = dijkstra(ids, board, rev);
  const fromBoard = dijkstra(ids, board, fwd);
  const seen = new Set([board]);
  const q = [board];
  while (q.length) for (const n of twoWay.get(q.shift()!) ?? []) if (!seen.has(n)) (seen.add(n), q.push(n));
  const vals = Object.values(toBoard);
  return {
    toBoard,
    fromBoard,
    worst: Math.max(...vals),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
    twoWayConnected: seen.size === ids.length,
  };
}
