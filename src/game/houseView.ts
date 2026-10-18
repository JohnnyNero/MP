import Phaser from 'phaser';
import { HOUSE, ROOM_BY_ID } from '../content/house';
import type { DerivedHouse } from '../core/house';
import type { RoomTag } from '../core/types';
import {
  BOARD_X,
  CLIMB_GEOMETRY,
  COL_X,
  DOOR_H,
  FLOOR_Y,
  ROOF_Y,
  ROOM_INNER_H,
  SLAB,
  VENT_GEOMETRY,
  WALL,
  type Climbable,
} from './config';

export interface RoomRect {
  id: string;
  floor: number;
  col: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number; // floor surface
}

export interface Vent {
  id: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Hole {
  x0: number;
  x1: number;
  floor: number; // the floor whose slab has the gap
  upper: string;
  lower: string;
}

/** A directed navigation edge for bots. */
export interface NavEdge {
  from: string;
  to: string;
  kind: 'door' | 'climbUp' | 'climbDown' | 'vent' | 'drop';
  x: number; // where to stand / walk to in `from`
  climb?: Climbable;
}

const ROOM_DECOR: Record<string, [string, number][]> = {
  kitchen: [['fridge', 150]],
  living: [['couch', 300]],
  garage: [['car', 360]],
  bedroom: [['bed', 140]],
  bathroom: [['tub', 186]],
  kids: [['toys', 380]],
  attic: [['trunk', 130]],
  study: [['desk', 180]],
  storage: [['boxes', 430]],
};

const WALLPAPER: Record<number, number> = { 0: 0x3b3346, 1: 0x34405a, 2: 0x4a3a32 };

export class HouseView {
  solids: Phaser.Physics.Arcade.StaticGroup;
  climbables: Climbable[] = [];
  blockedClimbables: Climbable[] = [];
  vents: Vent[] = [];
  holes: Hole[] = [];
  rooms: RoomRect[];
  nav: NavEdge[] = [];
  boardX = 0;
  boardY = 0;
  boardRoom: string;
  boardWrapped: boolean;
  tags: Record<string, RoomTag[]>;
  crates: Phaser.GameObjects.Image[] = [];
  private gfx: Phaser.GameObjects.GameObject[] = [];
  boardSprite!: Phaser.GameObjects.Image;

  constructor(private scene: Phaser.Scene, public house: DerivedHouse) {
    this.solids = scene.physics.add.staticGroup();
    this.boardRoom = house.boardRoom;
    this.boardWrapped = house.boardWrapped;
    this.tags = house.tags;
    this.rooms = HOUSE.rooms.map((r) => ({
      id: r.id,
      floor: r.floor,
      col: r.col,
      x0: COL_X[r.col] + (r.col === 0 ? 0 : WALL / 2),
      x1: COL_X[r.col + 1] - (r.col === 2 ? 0 : WALL / 2),
      top: FLOOR_Y[r.floor] - ROOM_INNER_H,
      bottom: FLOOR_Y[r.floor],
    }));
    this.build();
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.gfx.push(o);
    return o;
  }

  private solid(x: number, y: number, w: number, h: number, color: number, alpha = 1) {
    const r = this.add(this.scene.add.rectangle(x + w / 2, y + h / 2, w, h, color, alpha));
    this.solids.add(r);
    return r;
  }

  roomRect(id: string): RoomRect {
    return this.rooms.find((r) => r.id === id)!;
  }

  roomAt(x: number, y: number): RoomRect | undefined {
    return this.rooms.find((r) => x >= r.x0 - 2 && x <= r.x1 + 2 && y >= r.top - 4 && y <= r.bottom + 2);
  }

  hasTag(room: string | undefined, tag: RoomTag) {
    return !!room && this.tags[room]?.includes(tag);
  }

  private build() {
    const s = this.scene;
    const blocked = this.house.blocked;

    // Backdrop: sky, wallpaper per room, roof.
    this.add(s.add.rectangle(240, 135, 480, 270, 0x1d1830).setDepth(-20));
    for (const r of this.rooms) {
      this.add(s.add.rectangle((r.x0 + r.x1) / 2, (r.top + r.bottom) / 2, r.x1 - r.x0, r.bottom - r.top, WALLPAPER[r.floor]).setDepth(-15));
      // Wallpaper stripes.
      for (let x = r.x0 + 6; x < r.x1; x += 12) {
        this.add(s.add.rectangle(x, (r.top + r.bottom) / 2, 1, r.bottom - r.top, 0xffffff, 0.04).setDepth(-14));
      }
      this.add(
        s.add
          .text(r.x0 + 4, r.top + 2, ROOM_BY_ID[r.id].name.toUpperCase(), { fontFamily: 'monospace', fontSize: '6px', color: '#ffffff', resolution: 4 })
          .setAlpha(0.35)
          .setDepth(-13),
      );
      for (const [key, x] of ROOM_DECOR[r.id] ?? []) {
        this.add(s.add.image(x, r.bottom, key).setOrigin(0.5, 1).setDepth(-12));
      }
      // Lingering tag visuals.
      const tags = this.tags[r.id];
      if (tags.includes('wet')) {
        this.add(s.add.rectangle((r.x0 + r.x1) / 2, r.bottom - 2, r.x1 - r.x0, 4, 0x3a7ad8, 0.6).setDepth(5));
      }
      if (tags.includes('overgrown')) {
        for (let x = r.x0 + 4; x < r.x1; x += 14) {
          this.add(s.add.image(x, r.top + 4, 'vine').setOrigin(0.5, 0).setScale(1, 2).setDepth(-11));
        }
      }
      if (tags.includes('lowgrav')) {
        this.add(s.add.rectangle((r.x0 + r.x1) / 2, (r.top + r.bottom) / 2, r.x1 - r.x0, r.bottom - r.top, 0x9a6ae8, 0.12).setDepth(-11));
      }
      if (tags.includes('cluttered')) {
        for (const fx of [0.3, 0.7]) {
          const cx = Math.round(r.x0 + (r.x1 - r.x0) * fx);
          const c = this.add(s.add.image(cx, r.bottom - 6, 'crate').setDepth(2));
          this.solids.add(c);
          this.crates.push(c);
        }
      }
    }

    // Holes punched by meteors (gaps in the slab under an upper room).
    for (const c of this.house.connections) {
      if (c.kind !== 'hole') continue;
      const upper = this.roomRect(c.b);
      const mid = Math.round((upper.x0 + upper.x1) / 2) + 28;
      this.holes.push({ x0: mid - 12, x1: mid + 12, floor: upper.floor, upper: c.b, lower: c.a });
    }

    // Floor slabs (with gaps for holes), roof, outer walls.
    for (let f = 0; f < 3; f++) {
      const y = FLOOR_Y[f];
      const gaps = this.holes.filter((h) => h.floor === f).sort((a, b) => a.x0 - b.x0);
      let x = 4;
      for (const g of gaps) {
        if (g.x0 > x) this.solid(x, y, g.x0 - x, SLAB, 0x6a5040);
        x = Math.max(x, g.x1);
      }
      this.solid(x, y, 476 - x, SLAB, 0x6a5040);
      this.add(s.add.rectangle(240, y + 1, 472, 1, 0x9a7a5a).setDepth(1));
    }
    this.solid(4, ROOF_Y, 472, SLAB, 0x7a3a3a);
    // Roof triangle (decor).
    const roof = this.add(s.add.triangle(240, ROOF_Y - 1, -236, 0, 0, -20, 236, 0, 0x5a2a2a).setOrigin(0, 0));
    roof.setPosition(240, ROOF_Y).setDepth(-16);
    this.solid(0, ROOF_Y, 8, FLOOR_Y[0] + SLAB - ROOF_Y, 0x5a4636);
    this.solid(472, ROOF_Y, 8, FLOOR_Y[0] + SLAB - ROOF_Y, 0x5a4636);

    // Interior walls with door gaps; blocked doors get vine barriers.
    for (let f = 0; f < 3; f++) {
      const top = FLOOR_Y[f] - ROOM_INNER_H;
      for (const wx of [COL_X[1], COL_X[2]]) {
        this.solid(wx - WALL / 2, top, WALL, ROOM_INNER_H - DOOR_H, 0x5a4636);
        const left = this.rooms.find((r) => r.floor === f && r.x1 <= wx + 2 && r.x1 >= wx - 4)!;
        const right = this.rooms.find((r) => r.floor === f && r.x0 >= wx - 2 && r.x0 <= wx + 4)!;
        const conn = HOUSE.connections.find(
          (c) => c.kind === 'door' && ((c.a === left.id && c.b === right.id) || (c.a === right.id && c.b === left.id)),
        );
        // Door frame decor.
        this.add(s.add.rectangle(wx, FLOOR_Y[f] - DOOR_H, 10, 2, 0x8a6a4a).setDepth(1));
        if (conn && blocked.has(conn.id)) {
          const bar = this.solid(wx - 3, FLOOR_Y[f] - DOOR_H, 6, DOOR_H, 0x2e7d32);
          bar.setDepth(3);
          for (let vy = FLOOR_Y[f] - DOOR_H; vy < FLOOR_Y[f]; vy += 8) this.add(s.add.image(wx, vy, 'vine').setOrigin(0.5, 0).setDepth(4));
        } else if (conn) {
          this.nav.push({ from: left.id, to: right.id, kind: 'door', x: wx });
          this.nav.push({ from: right.id, to: left.id, kind: 'door', x: wx });
        }
      }
    }

    // Stairs and ladders.
    for (const c of HOUSE.connections) {
      const g = CLIMB_GEOMETRY[c.id];
      if (!g) continue;
      const cl: Climbable = { id: c.id, ...g, lower: c.a, upper: c.b };
      const isBlocked = blocked.has(c.id);
      this.drawClimbable(cl, isBlocked);
      if (isBlocked) {
        this.blockedClimbables.push(cl);
        continue;
      }
      this.climbables.push(cl);
      this.nav.push({ from: c.a, to: c.b, kind: 'climbUp', x: cl.x0, climb: cl });
      this.nav.push({ from: c.b, to: c.a, kind: 'climbDown', x: cl.x1, climb: cl });
    }

    // Vents.
    for (const c of HOUSE.connections) {
      const v = VENT_GEOMETRY[c.id];
      if (!v) continue;
      const ay = FLOOR_Y[ROOM_BY_ID[c.a].floor];
      const by = FLOOR_Y[ROOM_BY_ID[c.b].floor];
      this.add(s.add.image(v.ax, ay - 3, 'vent').setDepth(-5));
      this.add(s.add.image(v.bx, by - 3, 'vent').setDepth(-5));
      if (blocked.has(c.id)) {
        this.add(s.add.image(v.ax, ay - 8, 'vine').setDepth(4));
        this.add(s.add.image(v.bx, by - 8, 'vine').setDepth(4));
        continue;
      }
      this.vents.push({ id: c.id, ax: v.ax, ay, bx: v.bx, by });
      this.nav.push({ from: c.a, to: c.b, kind: 'vent', x: v.ax });
      this.nav.push({ from: c.b, to: c.a, kind: 'vent', x: v.bx });
    }

    // Holes are one-way drops.
    for (const h of this.holes) {
      this.nav.push({ from: h.upper, to: h.lower, kind: 'drop', x: (h.x0 + h.x1) / 2 });
      for (let x = h.x0 - 6; x < h.x1 + 6; x += 5) {
        this.add(s.add.image(x, FLOOR_Y[h.floor] - 1, 'debris').setDepth(3));
      }
    }

    // The board prop.
    const br = this.roomRect(this.boardRoom);
    this.boardX = BOARD_X[this.boardRoom];
    this.boardY = br.bottom;
    this.boardSprite = this.add(s.add.image(this.boardX, br.bottom, 'boardprop').setOrigin(0.5, 1).setScale(1.5).setDepth(-4));
    if (this.boardWrapped) {
      for (let dx = -12; dx <= 12; dx += 6) this.add(s.add.image(this.boardX + dx, br.bottom - 10, 'vine').setDepth(6));
    }
  }

  private drawClimbable(cl: Climbable, blocked: boolean) {
    const s = this.scene;
    if (cl.kind === 'ladder') {
      const h = cl.y0 - cl.y1;
      this.add(s.add.rectangle(cl.x0 - 5, cl.y1 + h / 2, 1, h, 0xa07a50).setDepth(-6));
      this.add(s.add.rectangle(cl.x0 + 5, cl.y1 + h / 2, 1, h, 0xa07a50).setDepth(-6));
      for (let y = cl.y1 + 2; y < cl.y0; y += 6) this.add(s.add.rectangle(cl.x0, y, 10, 1, 0xa07a50).setDepth(-6));
    } else {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = cl.x0 + (cl.x1 - cl.x0) * t;
        const y = cl.y0 + (cl.y1 - cl.y0) * t;
        this.add(s.add.rectangle(x, y + 3, (cl.x1 - cl.x0) / n + 1, 6, 0x8a6a4a).setDepth(-6));
      }
      this.add(s.add.line(0, 0, cl.x0, cl.y0, cl.x1, cl.y1, 0xc09a6a).setOrigin(0, 0).setDepth(-6));
    }
    if (blocked) {
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        this.add(s.add.image(cl.x0 + (cl.x1 - cl.x0) * t, cl.y0 + (cl.y1 - cl.y0) * t - 6, 'vine').setDepth(4));
      }
    }
  }

  /** Room-level route from a to b (BFS over nav edges). */
  route(from: string, to: string): NavEdge[] | null {
    if (from === to) return [];
    const prev = new Map<string, NavEdge>();
    const seen = new Set([from]);
    const q = [from];
    while (q.length) {
      const cur = q.shift()!;
      for (const e of this.nav) {
        if (e.from !== cur || seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, e);
        if (e.to === to) {
          const path: NavEdge[] = [];
          let n = to;
          while (n !== from) {
            const pe = prev.get(n)!;
            path.unshift(pe);
            n = pe.from;
          }
          return path;
        }
        q.push(e.to);
      }
    }
    return null;
  }

  /** A random standing point inside a room. */
  randomPoint(roomId: string, rnd: () => number) {
    const r = this.roomRect(roomId);
    return { x: r.x0 + 12 + rnd() * (r.x1 - r.x0 - 24), y: r.bottom - 8 };
  }

  destroy() {
    this.solids.destroy(false);
    for (const o of this.gfx) o.destroy();
    this.gfx = [];
  }
}
