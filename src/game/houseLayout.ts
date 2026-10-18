// World geometry of a house, derived from its HouseDef (pure, no Phaser).
// Shared by the baked art (art/houseArt.ts) and the live view (houseView.ts).
import type { ConnectionDef, HouseDef, PropDef } from '../core/types';
import { CH, CW, GRID_COLS, GRID_ROWS, SLAB, WALL, gridX, rowFloor, rowTop, type Climbable } from './config';

export interface RoomRect {
  id: string;
  name: string;
  theme: string;
  color: number;
  floor: number;
  col: number;
  gx: number;
  gy: number;
  gw: number;
  gh: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number; // floor surface
}

/** A vertical wall piece on grid line `gx`, row `gy`. `outside`: which side is open air (-1 left, 1 right, 0 none). */
export interface WallSeg {
  gx: number;
  gy: number;
  x: number;
  y0: number;
  y1: number;
  outside: -1 | 0 | 1;
  /** Door / bookcase cut into this piece. */
  door?: DoorGeo;
}

export interface SlabSeg {
  x0: number;
  x1: number;
  y: number;
  ground: boolean;
  /** A roof slab (open sky above). */
  roof: boolean;
}

export interface DoorGeo {
  id: string;
  kind: 'door' | 'bookcase';
  x: number;
  floor: number;
  left: string;
  right: string;
}

export interface ChuteGeo {
  id: string;
  upper: string;
  lower: string;
  hatchX: number;
  hatchY: number;
  /** Pipe centerline from the hatch to the mouth (last point). */
  path: [number, number][];
}

export interface PoleGeo {
  id: string;
  upper: string;
  lower: string;
  x: number;
  topY: number; // upper floor
  bottomY: number; // lower floor
}

export interface SlideGeo {
  id: string;
  upper: string;
  lower: string;
  /** Entry lip on the upper floor. */
  x0: number;
  y0: number;
  /** Run-out on the lower floor. */
  x1: number;
  y1: number;
  dir: 1 | -1;
  /** Avatar-centre path from the lip to the run-out. */
  path: [number, number][];
}

export interface TrampGeo {
  id: string;
  lower: string;
  upper: string;
  x: number;
  bedY: number; // lower floor
  ceilY: number; // upper floor (the hatch it bounces you through)
}

export interface PortalEnd {
  room: string;
  x: number;
  floor: number;
}
export interface PortalGeo {
  id: string;
  ends: [PortalEnd, PortalEnd];
}

export interface LiftStop {
  room: string;
  floor: number;
}
export interface LiftGeo {
  id: string;
  x: number;
  /** Top stop first. */
  stops: LiftStop[];
  conns: string[];
}

export interface SwitchGeo {
  id: string;
  room: string;
  x: number;
  y: number;
}

export interface TrapGeo {
  id: string;
  room: string;
  lower: string;
  x0: number;
  x1: number;
  floor: number;
  leverX: number;
}

export interface HoleGeo {
  id: string;
  upper: string;
  lower: string;
  x0: number;
  x1: number;
  floor: number;
}

export interface Layout {
  def: HouseDef;
  key: string;
  rooms: RoomRect[];
  byId: Record<string, RoomRect>;
  owner: (string | null)[][];
  walls: WallSeg[];
  slabs: SlabSeg[];
  doors: DoorGeo[];
  climbs: Climbable[];
  chutes: ChuteGeo[];
  poles: PoleGeo[];
  slides: SlideGeo[];
  tramps: TrampGeo[];
  portals: PortalGeo[];
  lifts: LiftGeo[];
  switches: SwitchGeo[];
  traps: TrapGeo[];
  holes: HoleGeo[];
  boardRoom: string;
  boardX: number;
  /** Feature anchor points per room (x on the floor) that furniture keeps clear of. */
  anchors: Record<string, number[]>;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function roomRects(def: HouseDef): RoomRect[] {
  return def.rooms.map((r) => ({
    id: r.id,
    name: r.name,
    theme: r.theme,
    color: r.color,
    floor: r.floor,
    col: r.gx,
    gx: r.gx,
    gy: r.gy,
    gw: r.gw,
    gh: r.gh,
    x0: gridX(r.gx) + WALL / 2,
    x1: gridX(r.gx + r.gw) - WALL / 2,
    top: rowTop(r.gy),
    bottom: rowFloor(r.gy + r.gh - 1),
  }));
}

/** x inside grid column `col` at fraction `frac`, kept clear of its walls. */
function colPos(col: number, frac = 0.5, margin = 10) {
  return Math.round(clamp(gridX(col) + frac * CW, gridX(col) + margin, gridX(col + 1) - margin));
}

/**
 * Lay a house out in world space. `connections` is the derived list (base
 * plus meteor holes); `boardRoom` is where the board currently stands.
 */
export function buildLayout(def: HouseDef, connections: ConnectionDef[] = def.connections, boardRoom = def.boardRoom): Layout {
  const cols = def.cols || GRID_COLS;
  const rows = def.rows || GRID_ROWS;
  const rooms = roomRects(def);
  const byId: Record<string, RoomRect> = Object.fromEntries(rooms.map((r) => [r.id, r]));
  const owner: (string | null)[][] = Array.from({ length: rows }, () => Array<string | null>(cols).fill(null));
  for (const r of rooms) for (let y = r.gy; y < r.gy + r.gh; y++) for (let x = r.gx; x < r.gx + r.gw; x++) owner[y][x] = r.id;
  const at = (gx: number, gy: number) => (gx >= 0 && gx < cols && gy >= 0 && gy < rows ? owner[gy][gx] : null);
  const anchors: Record<string, number[]> = Object.fromEntries(rooms.map((r) => [r.id, [] as number[]]));
  const anchor = (room: string, x: number) => anchors[room]?.push(x);

  // Doors and bookcases.
  const doors: DoorGeo[] = [];
  for (const c of connections) {
    if ((c.kind !== 'door' && c.kind !== 'bookcase') || c.wallX === undefined || c.row === undefined) continue;
    const l = at(c.wallX - 1, c.row);
    const left = l === c.a || l === c.b ? l : c.a;
    const right = left === c.a ? c.b : c.a;
    doors.push({ id: c.id, kind: c.kind, x: gridX(c.wallX), floor: rowFloor(c.row), left, right });
    anchor(left, gridX(c.wallX) - 8);
    anchor(right, gridX(c.wallX) + 8);
  }

  // Walls between differing cells (rooms or open air).
  const walls: WallSeg[] = [];
  for (let gx = 0; gx <= cols; gx++) {
    let above = false;
    for (let gy = 0; gy < rows; gy++) {
      const L = at(gx - 1, gy);
      const R = at(gx, gy);
      if (L === R) {
        above = false;
        continue;
      }
      const x = gridX(gx);
      const door = doors.find((d) => d.x === x && d.floor === rowFloor(gy));
      walls.push({
        gx,
        gy,
        x,
        y0: rowTop(gy) - (above ? 0 : SLAB),
        y1: rowTop(gy) + CH,
        outside: !L ? -1 : !R ? 1 : 0,
        door,
      });
      above = true;
    }
  }

  // Slabs: under every room, plus a roof over every cell with open sky above.
  const slabs: SlabSeg[] = [];
  for (const r of rooms) {
    slabs.push({ x0: gridX(r.gx), x1: gridX(r.gx + r.gw), y: r.bottom, ground: r.gy + r.gh === rows, roof: false });
  }
  for (let gx = 0; gx < cols; gx++)
    for (let gy = 0; gy < rows; gy++) {
      if (!owner[gy][gx]) continue;
      if (gy > 0 && owner[gy - 1][gx]) continue;
      slabs.push({ x0: gridX(gx), x1: gridX(gx + 1), y: rowTop(gy) - SLAB, ground: false, roof: true });
    }

  const climbs: Climbable[] = [];
  const chutes: ChuteGeo[] = [];
  const poles: PoleGeo[] = [];
  const slides: SlideGeo[] = [];
  const tramps: TrampGeo[] = [];
  const portals: PortalGeo[] = [];
  const holes: HoleGeo[] = [];
  const liftConns = new Map<number, ConnectionDef[]>();

  for (const c of connections) {
    const lo = byId[c.a];
    const up = byId[c.b];
    if (!lo || !up) continue;
    const col = c.colX ?? sharedCol(lo, up);
    switch (c.kind) {
      case 'stairs': {
        const x = colPos(col, c.frac, 10);
        const dir = (c.frac ?? 0.5) < 0.5 ? 1 : -1;
        const x1 = clamp(x + dir * 46, gridX(col) + 8, gridX(col + 1) - 8);
        climbs.push({ id: c.id, kind: 'stairs', x0: x, y0: lo.bottom, x1, y1: up.bottom, lower: lo.id, upper: up.id });
        anchor(lo.id, x);
        anchor(up.id, x1);
        break;
      }
      case 'ladder': {
        const x = colPos(col, c.frac, 10);
        climbs.push({ id: c.id, kind: 'ladder', x0: x, y0: lo.bottom, x1: x, y1: up.bottom, lower: lo.id, upper: up.id });
        anchor(lo.id, x);
        anchor(up.id, x);
        break;
      }
      case 'chute': {
        const x = colPos(col, c.frac, 13);
        chutes.push({
          id: c.id,
          upper: up.id,
          lower: lo.id,
          hatchX: x,
          hatchY: up.bottom,
          path: [
            [x, up.bottom - 1],
            [x, up.bottom + 7],
            [x, lo.bottom - 22],
          ],
        });
        anchor(up.id, x);
        anchor(lo.id, x);
        break;
      }
      case 'pole': {
        const x = colPos(col, c.frac, 10);
        poles.push({ id: c.id, upper: up.id, lower: lo.id, x, topY: up.bottom, bottomY: lo.bottom });
        anchor(up.id, x);
        anchor(lo.id, x);
        break;
      }
      case 'slide': {
        const x0 = colPos(col, c.frac, 10);
        const dir: 1 | -1 = (c.frac ?? 0.5) < 0.5 ? 1 : -1;
        const x1 = clamp(x0 + dir * 52, Math.max(lo.x0, gridX(col) - CW) + 8, Math.min(lo.x1, gridX(col + 1) + CW) - 8);
        const y0 = up.bottom;
        const y1 = lo.bottom;
        const path: [number, number][] = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12;
          // A banister curve: steep under the lip, flattening into the run-out.
          const e = 1 - (1 - t) * (1 - t);
          path.push([Math.round(x0 + (x1 - x0) * t), Math.round(y0 - 7 + (y1 - y0) * e)]);
        }
        slides.push({ id: c.id, upper: up.id, lower: lo.id, x0, y0, x1, y1, dir, path });
        anchor(up.id, x0);
        anchor(lo.id, x1);
        break;
      }
      case 'tramp': {
        const x = colPos(col, c.frac, 14);
        tramps.push({ id: c.id, lower: lo.id, upper: up.id, x, bedY: lo.bottom, ceilY: up.bottom });
        anchor(lo.id, x);
        anchor(up.id, x);
        break;
      }
      case 'hole': {
        const x = c.colX !== undefined ? colPos(c.colX, c.frac ?? 0.5, 16) : colPos(col, 0.62, 16);
        holes.push({ id: c.id, upper: up.id, lower: lo.id, x0: x - 12, x1: x + 12, floor: up.bottom });
        anchor(up.id, x);
        anchor(lo.id, x);
        break;
      }
      case 'portal': {
        const A = byId[c.a];
        const B = byId[c.b];
        const px = (r: RoomRect, f = 0.5) => Math.round(clamp(r.x0 + f * (r.x1 - r.x0), r.x0 + 10, r.x1 - 10));
        portals.push({
          id: c.id,
          ends: [
            { room: A.id, x: px(A, c.fracA), floor: A.bottom },
            { room: B.id, x: px(B, c.fracB), floor: B.bottom },
          ],
        });
        anchor(A.id, px(A, c.fracA));
        anchor(B.id, px(B, c.fracB));
        break;
      }
      case 'lift': {
        if (!liftConns.has(col)) liftConns.set(col, []);
        liftConns.get(col)!.push(c);
        break;
      }
    }
  }

  const lifts: LiftGeo[] = [];
  for (const [col, cs] of liftConns) {
    const ids = [...new Set(cs.flatMap((c) => [c.a, c.b]))];
    const stops = ids
      .map((id) => byId[id])
      .filter(Boolean)
      .sort((a, b) => a.bottom - b.bottom)
      .map((r) => ({ room: r.id, floor: r.bottom }));
    const x = colPos(col, cs[0].frac, 10);
    lifts.push({ id: `lift-${col}`, x, stops, conns: cs.map((c) => c.id) });
    for (const s of stops) anchor(s.room, x);
  }

  // Props.
  const switches: SwitchGeo[] = [];
  const traps: TrapGeo[] = [];
  for (const p of def.props ?? []) {
    const r = byId[p.room];
    if (!r) continue;
    if (p.kind === 'switch') {
      const x = propX(r, p, 8);
      switches.push({ id: p.id, room: r.id, x, y: r.bottom - 24 });
      anchor(r.id, x);
    } else {
      const x = propX(r, p, 24);
      const below = at(Math.floor((x - gridX(0)) / CW), r.gy + r.gh);
      if (!below) continue;
      const leverX = x + 22 < r.x1 - 6 ? x + 21 : x - 21;
      traps.push({ id: p.id, room: r.id, lower: below, x0: x - 13, x1: x + 13, floor: r.bottom, leverX });
      anchor(r.id, x);
      anchor(r.id, leverX);
    }
  }

  // The board: as central as possible, clear of every feature in its room.
  const br = byId[boardRoom] ?? rooms[0];
  const boardX = pickBoardX(br, anchors[br.id] ?? []);

  const key = `${def.seed}:${def.goofiness}:${def.name}:${rooms.length}`;
  return {
    def,
    key,
    rooms,
    byId,
    owner,
    walls,
    slabs,
    doors,
    climbs,
    chutes,
    poles,
    slides,
    tramps,
    portals,
    lifts,
    switches,
    traps,
    holes,
    boardRoom: br.id,
    boardX,
    anchors,
  };
}

function propX(r: RoomRect, p: PropDef, margin: number) {
  return Math.round(clamp(r.x0 + p.frac * (r.x1 - r.x0), r.x0 + margin, r.x1 - margin));
}

/** A column both rooms occupy (upper's floor row sits on lower's top row), middle-most first. */
function sharedCol(lo: RoomRect, up: RoomRect): number {
  const a = Math.max(lo.gx, up.gx);
  const b = Math.min(lo.gx + lo.gw, up.gx + up.gw) - 1;
  return b >= a ? Math.floor((a + b) / 2) : lo.gx;
}

function pickBoardX(r: RoomRect, anchors: number[]): number {
  const mid = (r.x0 + r.x1) / 2;
  let best = Math.round(mid);
  let bestScore = Infinity;
  for (let x = r.x0 + 24; x <= r.x1 - 24; x += 2) {
    const clash = anchors.reduce((s, a) => s + Math.max(0, 34 - Math.abs(a - x)), 0);
    const score = Math.abs(x - mid) + clash * 20;
    if (score < bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return best;
}

