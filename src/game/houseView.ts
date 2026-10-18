import Phaser from 'phaser';
import { HOUSE, ROOM_BY_ID } from '../content/house';
import type { DerivedHouse } from '../core/house';
import type { RoomTag } from '../core/types';
import {
  BOARD_X,
  CHUTE_GEOMETRY,
  CLIMB_GEOMETRY,
  COL_X,
  DOOR_H,
  FLOOR_Y,
  ROOF_Y,
  ROOM_INNER_H,
  SLAB,
  WALL,
  type Climbable,
} from './config';
import {
  CHUNK,
  CHUNK_COLS,
  CHUNK_ROWS,
  HouseCanvas,
  SPRITES,
  blitSprite,
  chutePipeTexture,
  drawRoomDamage,
  type Px,
  ladderTexture,
  stairsTexture,
  commit,
  type KeepClear,
} from './art/houseArt';

export interface RoomRect {
  id: string;
  floor: number;
  col: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number; // floor surface
}

/** An open, one-way laundry chute: step on the hatch, pop out of the mouth. */
export interface Chute {
  id: string;
  upper: string;
  lower: string;
  hatchX: number;
  hatchY: number; // floor surface of the upper room
  /** Pipe centerline from the hatch to the mouth (last point). */
  path: [number, number][];
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
  kind: 'door' | 'climbUp' | 'climbDown' | 'chute' | 'drop';
  x: number; // where to stand / walk to in `from`
  climb?: Climbable;
}

/** One 8x8 cell of the house's visible surfaces (walls, slab faces, roof). */
export interface Chunk {
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Wallpaper / plank / siding face still present. */
  surface: boolean;
  /** Studs, lath or joists still present behind it. */
  backing: boolean;
}

/** Room dressing. `y` is the height of the item's bottom above the floor (wall items). */
interface Decor {
  key: string;
  x: number;
  y?: number;
  flip?: boolean;
  wall?: boolean;
}

const ROOM_DECOR: Record<string, Decor[]> = {
  kitchen: [
    { key: 'counter', x: 124 },
    { key: 'fridge', x: 148 },
  ],
  living: [
    { key: 'rug', x: 240 },
    { key: 'tv', x: 180 },
    { key: 'clock', x: 194, y: 44, wall: true },
    { key: 'frame-port', x: 214, y: 38, wall: true },
    { key: 'frame-land', x: 286, y: 36, wall: true },
    { key: 'floorlamp', x: 262 },
    { key: 'couch', x: 288 },
  ],
  garage: [
    { key: 'car', x: 362 },
    { key: 'workbench', x: 413 },
  ],
  bedroom: [
    { key: 'wardrobe', x: 24 },
    { key: 'bed', x: 66, flip: false },
    { key: 'nightstand', x: 97 },
    { key: 'frame-port', x: 112, y: 40, wall: true },
    { key: 'mirror', x: 130, y: 30, wall: true },
    { key: 'dresser', x: 130 },
  ],
  bathroom: [
    { key: 'tub', x: 190 },
    { key: 'toilet', x: 226 },
    { key: 'mirror', x: 256, y: 30, wall: true },
    { key: 'sink', x: 256 },
    { key: 'towel', x: 276, y: 32, wall: true },
  ],
  kids: [
    { key: 'poster', x: 380, y: 34, wall: true },
    { key: 'toys', x: 378 },
    { key: 'toybox', x: 402 },
    { key: 'kidbed', x: 444 },
  ],
  attic: [
    { key: 'rockinghorse', x: 70 },
    { key: 'frame-land', x: 102, y: 0 },
    { key: 'trunk', x: 130 },
  ],
  study: [
    { key: 'bookcase', x: 176 },
    { key: 'shelf-books', x: 208, y: 38, wall: true },
    { key: 'desk', x: 208 },
    { key: 'globe', x: 244 },
    { key: 'frame-port', x: 268, y: 40, wall: true },
    { key: 'armchair', x: 268 },
  ],
  storage: [
    { key: 'shelfunit', x: 390 },
    { key: 'boxes', x: 428 },
    { key: 'boxes', x: 456, flip: true },
  ],
};

/** Ceiling lamp per room: x and kind. */
const ROOM_LAMP: Record<string, [number, 'lamp-pendant' | 'lamp-bulb']> = {
  kitchen: [80, 'lamp-pendant'],
  living: [206, 'lamp-pendant'],
  garage: [396, 'lamp-bulb'],
  bedroom: [70, 'lamp-pendant'],
  bathroom: [232, 'lamp-pendant'],
  kids: [404, 'lamp-pendant'],
  attic: [112, 'lamp-bulb'],
  study: [244, 'lamp-pendant'],
  storage: [400, 'lamp-bulb'],
};

interface DecorObj {
  sprite: Px;
  d: Decor;
  x: number;
  y: number;
}

export class HouseView {
  solids: Phaser.Physics.Arcade.StaticGroup;
  climbables: Climbable[] = [];
  blockedClimbables: Climbable[] = [];
  chutes: Chute[] = [];
  holes: Hole[] = [];
  rooms: RoomRect[];
  nav: NavEdge[] = [];
  boardX = 0;
  boardY = 0;
  boardRoom: string;
  boardWrapped: boolean;
  tags: Record<string, RoomTag[]>;
  crates: Phaser.GameObjects.Image[] = [];
  /** Current visual damage per room (0..3). */
  damage: Record<string, number> = {};
  /** Door art per connection id (separate so it can be blocked or blown open later). */
  doors: Record<string, Phaser.GameObjects.Image> = {};
  /** Ladder / stair art per connection id. */
  climbArt: Record<string, Phaser.GameObjects.Image> = {};
  private gfx: Phaser.GameObjects.GameObject[] = [];
  private decor: Record<string, DecorObj[]> = {};
  private lamps: Record<string, { lamp: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }> = {};
  private plaques: Record<string, { w: number; h: number }> = {};
  private damageFx: Record<string, (Phaser.Time.TimerEvent | Phaser.Tweens.Tween)[]> = {};
  private tweens: Phaser.Tweens.Tween[] = [];
  /** All static art (sky, studs, wallpaper, slabs, roof, furniture, damage) baked into one texture. */
  private canvas!: HouseCanvas;
  private fragN = 0;
  private building = false;
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

  /** Physics solid. Invisible: the chunked art layers draw the structure. */
  private solid(x: number, y: number, w: number, h: number, color: number, alpha = 1) {
    const r = this.add(this.scene.add.rectangle(x + w / 2, y + h / 2, w, h, color, alpha));
    r.setVisible(false);
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

    // Holes punched by meteors (gaps in the slab under an upper room).
    for (const c of this.house.connections) {
      if (c.kind !== 'hole') continue;
      const upper = this.roomRect(c.b);
      const mid = Math.round((upper.x0 + upper.x1) / 2) + 28;
      this.holes.push({ x0: mid - 12, x1: mid + 12, floor: upper.floor, upper: c.b, lower: c.a });
    }

    // Everything static is baked into one canvas texture (one draw call).
    this.canvas = new HouseCanvas(
      s,
      this.holes.map((h) => ({ x0: h.x0, x1: h.x1, y: FLOOR_Y[h.floor] })),
    );
    this.add(s.add.image(0, 0, this.canvas.tex.key).setOrigin(0, 0).setDepth(-15));

    for (const r of this.rooms) {
      // Room name plaque.
      const label = this.add(
        s.add
          .text(r.x0 + 5, r.top + 3, ROOM_BY_ID[r.id].name.toUpperCase(), {
            fontFamily: 'monospace',
            fontSize: '6px',
            fontStyle: 'bold',
            color: '#ffe08a',
            stroke: '#140c1c',
            strokeThickness: 2,
            resolution: 4,
          })
          .setDepth(-3)
          .setAlpha(0.92),
      );
      this.plaques[r.id] = { w: Math.ceil(label.width) + 4, h: Math.ceil(label.height) + 2 };

      // Ceiling lamp + glow.
      const lampDef = ROOM_LAMP[r.id];
      if (lampDef) {
        const glow = this.add(
          s.add.image(lampDef[0], r.top + 26, 'lamp-glow').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.55).setDepth(-12.5),
        );
        const lamp = this.add(s.add.image(lampDef[0], r.top, lampDef[1]).setOrigin(0.5, 0).setDepth(-11.5));
        this.lamps[r.id] = { lamp, glow };
      }

      // Furniture (decorative only, never solid).
      const isBoardRoom = r.id === this.boardRoom;
      const bx = BOARD_X[this.boardRoom];
      this.decor[r.id] = [];
      for (const d of ROOM_DECOR[r.id] ?? []) {
        const sprite = SPRITES.get(d.key);
        if (!sprite) continue;
        if (isBoardRoom && !d.wall && d.key !== 'rug' && Math.abs(d.x - bx) < sprite.w / 2 + 22) continue;
        this.decor[r.id].push({ sprite, d, x: d.x, y: r.bottom - (d.y ?? 0) });
      }

      // Lingering tag visuals.
      const tags = this.tags[r.id];
      if (tags.includes('wet')) {
        this.add(s.add.tileSprite(r.x0, r.bottom - 5, r.x1 - r.x0, 5, 'house-puddle').setOrigin(0, 0).setDepth(5).setAlpha(0.85));
        for (let x = r.x0 + 10; x < r.x1; x += 37) {
          const drip = this.add(s.add.rectangle(x, r.top + 2, 1, 3, 0x8ac8ff).setDepth(-11));
          this.tweens.push(s.tweens.add({ targets: drip, y: r.bottom - 6, duration: 1400, repeat: -1, delay: (x * 13) % 1400 }));
        }
      }
      if (tags.includes('overgrown')) {
        for (let x = r.x0 + 4, i = 0; x < r.x1; x += 12, i++) {
          this.add(s.add.image(x, r.top, 'vine-hang').setOrigin(0.5, 0).setScale(1, 0.8 + ((i * 7) % 5) * 0.25).setDepth(-11));
        }
      }
      if (tags.includes('lowgrav')) {
        this.add(s.add.rectangle((r.x0 + r.x1) / 2, (r.top + r.bottom) / 2, r.x1 - r.x0, r.bottom - r.top, 0x9a6ae8, 0.14).setDepth(-11));
        for (let i = 0; i < 6; i++) {
          const sp = this.add(s.add.image(r.x0 + 12 + ((i * 41) % (r.x1 - r.x0 - 24)), r.bottom - 10 - ((i * 23) % 50), 'spark').setTint(0xd0a0ff).setAlpha(0.7).setDepth(-11));
          this.tweens.push(s.tweens.add({ targets: sp, y: sp.y - 10, alpha: 0.2, duration: 1600 + i * 200, yoyo: true, repeat: -1 }));
        }
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

    // Floor slabs (with gaps for holes), roof, outer walls: physics only, art is chunked.
    for (let f = 0; f < 3; f++) {
      const y = FLOOR_Y[f];
      const gaps = this.holes.filter((h) => h.floor === f).sort((a, b) => a.x0 - b.x0);
      let x = 4;
      for (const g of gaps) {
        if (g.x0 > x) this.solid(x, y, g.x0 - x, SLAB, 0x6a5040);
        x = Math.max(x, g.x1);
      }
      this.solid(x, y, 476 - x, SLAB, 0x6a5040);
    }
    this.solid(4, ROOF_Y, 472, SLAB, 0x7a3a3a);
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
        const door = this.add(s.add.image(wx, FLOOR_Y[f], 'house-door').setOrigin(0.5, 1).setDepth(-14));
        if (conn) this.doors[conn.id] = door;
        if (conn && blocked.has(conn.id)) {
          const bar = this.solid(wx - 3, FLOOR_Y[f] - DOOR_H, 6, DOOR_H, 0x1e5a24);
          bar.setVisible(true).setDepth(3);
          for (let vy = FLOOR_Y[f] - DOOR_H; vy < FLOOR_Y[f]; vy += 8) this.add(s.add.image(wx, vy, 'vine').setOrigin(0.5, 0).setDepth(4));
          this.add(s.add.image(wx - 3, FLOOR_Y[f] - DOOR_H - 2, 'vine-hang').setOrigin(0.5, 0).setDepth(4));
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

    // Laundry chutes: pipe, open hatch, sign, arrow and glow (a few objects each).
    for (const c of HOUSE.connections) {
      const g = CHUTE_GEOMETRY[c.id];
      if (!g) continue;
      const hy = FLOOR_Y[ROOM_BY_ID[c.b].floor];
      const pipe = chutePipeTexture(s, c.id, g.hatchX, g.path);
      this.add(s.add.image(pipe.x, pipe.y, pipe.key).setOrigin(0, 0).setDepth(-13.5));
      this.add(s.add.image(g.hatchX - 9, hy - 14, 'chute-hatch').setOrigin(0, 0).setDepth(-5));
      const sign = this.add(s.add.image(g.hatchX + 7, hy - 30, 'chute-sign').setDepth(-12));
      if (blocked.has(c.id)) {
        // Vines grow over the hatch: it's shut.
        sign.setAlpha(0.6);
        for (let dx = -6; dx <= 6; dx += 6) this.add(s.add.image(g.hatchX + dx, hy - 3, 'vine').setDepth(4));
        continue;
      }
      // Glow rises from behind the hatch so its dark mouth stays crisp.
      const glow = this.add(s.add.image(g.hatchX + 1, hy - 6, 'chute-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(-5.2).setAlpha(0.35));
      this.tweens.push(s.tweens.add({ targets: glow, alpha: 0.85, scaleY: 1.25, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      const arrow = this.add(s.add.image(g.hatchX, hy - 17, 'chute-arrow').setDepth(-4.6));
      this.tweens.push(s.tweens.add({ targets: arrow, y: hy - 13, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeIn' }));
      this.chutes.push({ id: c.id, upper: c.b, lower: c.a, hatchX: g.hatchX, hatchY: hy, path: g.path });
      // One way only: bots treat it like a drop.
      this.nav.push({ from: c.b, to: c.a, kind: 'chute', x: g.hatchX });
    }

    // Holes are one-way drops.
    for (const h of this.holes) {
      this.nav.push({ from: h.upper, to: h.lower, kind: 'drop', x: (h.x0 + h.x1) / 2 });
      for (let x = h.x0 - 6; x < h.x1 + 6; x += 5) {
        this.add(s.add.image(x, FLOOR_Y[h.floor] - 1, 'debris').setDepth(3));
      }
    }

    // The board prop, with a pulsing cursed glow.
    const br = this.roomRect(this.boardRoom);
    this.boardX = BOARD_X[this.boardRoom];
    this.boardY = br.bottom;
    const glow = this.add(s.add.image(this.boardX, br.bottom - 16, 'board-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(-4.5).setAlpha(0.5));
    this.tweens.push(s.tweens.add({ targets: glow, alpha: 0.95, scale: 1.08, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
    this.boardSprite = this.add(s.add.image(this.boardX, br.bottom, 'boardprop').setOrigin(0.5, 1).setDepth(-4));
    if (this.boardWrapped) {
      for (let dx = -12; dx <= 12; dx += 6) this.add(s.add.image(this.boardX + dx, br.bottom - 10, 'vine').setDepth(6));
    }

    // Damage overlays last, so they can see decor and lamps.
    this.building = true;
    for (const r of this.rooms) this.setRoomDamage(r.id, this.house.damage?.[r.id] ?? 0);
    this.building = false;
    this.canvas.compose();
  }

  private drawClimbable(cl: Climbable, blocked: boolean) {
    const s = this.scene;
    if (cl.kind === 'ladder') {
      const h = cl.y0 - cl.y1 + 8;
      this.climbArt[cl.id] = this.add(s.add.image(cl.x0, cl.y1 - 8, ladderTexture(s, h)).setOrigin(0.5, 0).setDepth(-6));
    } else {
      const w = Math.abs(cl.x1 - cl.x0);
      const h = cl.y0 - cl.y1;
      this.climbArt[cl.id] = this.add(
        s.add
          .image(Math.min(cl.x0, cl.x1), cl.y1 - 14, stairsTexture(s, w, h))
          .setOrigin(0, 0)
          .setFlipX(cl.x1 < cl.x0)
          .setDepth(-6),
      );
    }
    if (blocked) {
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        this.add(s.add.image(cl.x0 + (cl.x1 - cl.x0) * t, cl.y0 + (cl.y1 - cl.y0) * t - 6, 'vine').setDepth(4));
      }
    }
  }

  // ------------------------------------------------------------ damage

  /** Room-local rects the damage overlay must leave clear (doors, climbables, chute, board, holes). */
  private keepClear(r: RoomRect): KeepClear[] {
    const W = r.x1 - r.x0;
    const H = r.bottom - r.top;
    const k: KeepClear[] = [];
    if (r.col > 0) k.push({ x: 0, y: H - DOOR_H - 4, w: 14, h: DOOR_H + 4 });
    if (r.col < 2) k.push({ x: W - 14, y: H - DOOR_H - 4, w: 14, h: DOOR_H + 4 });
    for (const g of Object.values(CLIMB_GEOMETRY)) {
      if (g.kind === 'ladder') {
        if (g.x0 >= r.x0 && g.x0 <= r.x1 && (g.y0 === r.bottom || g.y1 === r.bottom)) k.push({ x: g.x0 - r.x0 - 10, y: 0, w: 20, h: H });
        continue;
      }
      if (g.y0 === r.bottom && g.x0 >= r.x0 && g.x0 <= r.x1) {
        for (let t = 0; t <= 1.001; t += 0.1) {
          const x = g.x0 + (g.x1 - g.x0) * t - r.x0;
          const y = g.y0 + (g.y1 - g.y0) * t - r.top;
          k.push({ x: Math.round(x - 8), y: Math.round(y - 22), w: 16, h: 30 });
        }
      } else if (g.y1 === r.bottom && g.x1 >= r.x0 && g.x1 <= r.x1) {
        k.push({ x: g.x1 - r.x0 - 16, y: H - 22, w: 32, h: 22 });
      }
    }
    for (const c of HOUSE.connections) {
      const g = CHUTE_GEOMETRY[c.id];
      if (!g) continue;
      if (c.b === r.id) k.push({ x: g.hatchX - r.x0 - 12, y: H - 42, w: 32, h: 42 });
      const [mx, my] = g.path[g.path.length - 1];
      if (c.a === r.id) k.push({ x: mx - r.x0 - 12, y: my - r.top - 34, w: 24, h: 40 });
    }
    if (r.id === this.boardRoom) k.push({ x: BOARD_X[r.id] - r.x0 - 26, y: H - 36, w: 52, h: 36 });
    for (const h of this.holes) {
      if (h.upper === r.id) k.push({ x: h.x0 - r.x0 - 6, y: H - 14, w: h.x1 - h.x0 + 12, h: 14 });
      if (h.lower === r.id) k.push({ x: h.x0 - r.x0 - 6, y: 0, w: h.x1 - h.x0 + 12, h: 14 });
    }
    return k;
  }

  /**
   * Show a room at damage level 0..3 (cracks; torn paper + debris + tilted
   * furniture; holes, stains, collapsed shelf, rubble, flickering lamp).
   * Deterministic per room. With `animate`, the new overlay pops in with dust.
   */
  setRoomDamage(roomId: string, level: number, animate = false) {
    const s = this.scene;
    const r = this.roomRect(roomId);
    if (!r) return;
    level = Math.max(0, Math.min(3, Math.round(level)));
    const prev = this.damage[roomId] ?? 0;
    this.damage[roomId] = level;
    for (const fx of this.damageFx[roomId] ?? []) fx.remove();
    this.damageFx[roomId] = [];
    const fx = this.damageFx[roomId];
    this.stampRoom(r, level);

    // Lamp sways; at level 3 it hangs by a wire and flickers.
    const lamp = this.lamps[roomId];
    if (lamp) {
      lamp.lamp.setAngle(level >= 3 ? 28 : level === 2 ? 9 : 0);
      lamp.glow.setAlpha(level >= 3 ? 0.3 : 0.55).setX(lamp.lamp.x + (level >= 3 ? 8 : 0));
      if (level >= 3) {
        const pattern = [1, 0, 1, 1, 0, 0, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1];
        let i = (roomId.length * 5) % pattern.length;
        fx.push(
          s.time.addEvent({
            delay: 90,
            loop: true,
            callback: () => {
              const on = pattern[i++ % pattern.length];
              lamp.glow.setVisible(!!on);
              lamp.lamp.setTint(on ? 0xffffff : 0x8a8090);
            },
          }),
        );
      } else {
        lamp.glow.setVisible(true);
        lamp.lamp.clearTint();
      }
    }

    if (animate && level > prev) {
      const flash = this.add(s.add.rectangle(r.x0, r.top, r.x1 - r.x0, r.bottom - r.top, 0xe0d0a8, 0.35).setOrigin(0, 0).setDepth(-11));
      fx.push(s.tweens.add({ targets: flash, alpha: 0, duration: 300, onComplete: () => flash.destroy() }));
      for (let i = 0; i < 10; i++) {
        const p = this.add(s.add.image(r.x0 + ((i * 37) % (r.x1 - r.x0)), r.top + 6 + ((i * 17) % 40), 'debris').setDepth(9));
        fx.push(
          s.tweens.add({
            targets: p,
            y: r.bottom - 2,
            angle: 180,
            alpha: 0,
            duration: 500 + i * 40,
            ease: 'Quad.easeIn',
            onComplete: () => p.destroy(),
          }),
        );
      }
    }
  }

  /** Redraw one room's overlay (damage, plaque, decor, rubble) into the baked canvas. */
  private stampRoom(r: RoomRect, level: number) {
    const c = this.canvas;
    const clip = { x: r.x0, y: r.top, w: r.x1 - r.x0, h: r.bottom - r.top };
    const keep = this.keepClear(r);
    c.over.clearRect(clip.x, clip.y, clip.w, clip.h);
    drawRoomDamage(c.over, r, level, keep, 'wall');
    const pl = this.plaques[r.id];
    if (pl) for (let y = 0; y < pl.h; y++) for (let x = 0; x < pl.w; x++) c.over.set(r.x0 + 3 + x, r.top + 2 + y, 0x140c1c, 115);
    const list = this.decor[r.id] ?? [];
    const order = [...list.entries()].sort((a, b) => rank(a[1]) - rank(b[1]));
    for (const [i, o] of order) {
      const sign = i % 2 ? -1 : 1;
      const isWall = !!o.d.wall || o.d.key.startsWith('frame');
      let sprite = o.sprite;
      let ax = o.x;
      let ay = o.y;
      let ox = sprite.w / 2;
      let oy = sprite.h;
      let angle = 0;
      if (isWall) {
        if (level >= 1) angle = sign * (level === 1 ? 7 : 16);
        if (level >= 3 && o.d.y) {
          ox = sprite.w / 2;
          oy = sprite.h / 2;
          ax = o.x + sign * 4;
          ay = r.bottom - sprite.w / 2 + 1;
          angle = sign * 90;
        }
      } else if (o.d.key !== 'rug') {
        if (level === 2) {
          angle = sign * 5;
          ay += 1;
        }
        if (level >= 3) sprite = SPRITES.get(`${o.d.key}-broken`) ?? sprite;
      }
      blitSprite(c.over, sprite, ax, ay, ox, oy, angle, !!o.d.flip, clip);
    }
    drawRoomDamage(c.over, r, level, keep, 'front');
    c.maskBroken(clip.x, clip.y, clip.w, clip.h);
    if (!this.building) c.compose(clip.x, clip.y, clip.w, clip.h);
  }

  // ------------------------------------------------------------ chunks

  /** The 8x8 surface chunk under world point (x, y), or null outside the grid / empty. */
  chunkAt(x: number, y: number): Chunk | null {
    const col = Math.floor(x / CHUNK);
    const row = Math.floor(y / CHUNK);
    if (col < 0 || row < 0 || col >= CHUNK_COLS || row >= CHUNK_ROWS) return null;
    const i = row * CHUNK_COLS + col;
    const f = this.canvas.surface[i];
    const b = this.canvas.backing[i];
    if (!f && !b && !this.canvas.cellHad(i)) return null;
    return {
      col,
      row,
      x: col * CHUNK,
      y: row * CHUNK,
      w: CHUNK,
      h: Math.min(CHUNK, 270 - row * CHUNK),
      surface: !!f,
      backing: !!b,
    };
  }

  /**
   * Knock out the top remaining layer of the chunk at (x, y): first the
   * surface (revealing studs/lath), then the backing (revealing night sky).
   * Visual only; physics solids are untouched. Returns false if nothing was left.
   */
  breakChunk(x: number, y: number): boolean {
    const c = this.chunkAt(x, y);
    if (!c) return false;
    if (!c.surface && !c.backing) return false;
    // A falling fragment of the pixels as they looked before the break.
    const s = this.scene;
    const key = `house-frag-${this.fragN++ % 64}`;
    commit(s, key, this.canvas.cellPx(c.col, c.row));
    if (!this.canvas.breakCell(c.col, c.row)) return false;
    const frag = this.add(s.add.image(c.x + c.w / 2, c.y + c.h / 2, key).setDepth(9));
    const dir = (c.col * 7 + c.row) % 2 ? 1 : -1;
    s.tweens.add({
      targets: frag,
      x: frag.x + dir * 10,
      y: frag.y + 40,
      angle: dir * 200,
      alpha: 0,
      duration: 700,
      ease: 'Quad.easeIn',
      onComplete: () => frag.destroy(),
    });
    return true;
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
    for (const t of this.tweens) t.remove();
    this.tweens = [];
    for (const list of Object.values(this.damageFx)) for (const fx of list) fx.remove();
    this.damageFx = {};
    this.solids.destroy(false);
    for (const o of this.gfx) o.destroy();
    this.gfx = [];
    this.canvas?.destroy();
  }
}

/** Stamp order inside a room: rug, wall items, then floor furniture. */
function rank(o: DecorObj) {
  return o.d.key === 'rug' ? 0 : o.d.wall ? 1 : 2;
}
