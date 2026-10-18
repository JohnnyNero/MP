import Phaser from 'phaser';
import type { DerivedHouse } from '../core/house';
import type { RoomTag } from '../core/types';
import { CLIMB_SPEED, DOOR_H, RUN_SPEED, SLAB, WALL, type Climbable } from './config';
import {
  buildLayout,
  type ChuteGeo,
  type DoorGeo,
  type HoleGeo,
  type Layout,
  type LiftGeo,
  type PortalEnd,
  type RoomRect,
  type TrapGeo,
} from './houseLayout';
import {
  CHUNK,
  CHUNK_COLS,
  CHUNK_ROWS,
  HouseCanvas,
  SPRITES,
  blitSprite,
  chutePipeTexture,
  commit,
  drawRoomDamage,
  ladderTexture,
  stairsTexture,
  themeArt,
  type KeepClear,
  type Px,
} from './art/houseArt';
import type { Avatar, RideSpec } from './avatar';
import type { VirtualPad } from './input';
import { sfx } from './sfx';

export type { RoomRect } from './houseLayout';

export type NavKind =
  | 'door'
  | 'bookcase'
  | 'climbUp'
  | 'climbDown'
  | 'chute'
  | 'drop'
  | 'pole'
  | 'slide'
  | 'tramp'
  | 'portal'
  | 'lift';

/** A directed navigation edge for bots. */
export interface NavEdge {
  from: string;
  to: string;
  kind: NavKind;
  x: number; // where to stand / walk to in `from`
  /** Where you come out in `to`. */
  toX: number;
  climb?: Climbable;
  /** Lifts: -1 = ride up, 1 = ride down. */
  dir?: number;
  /** Bookcases: which side of the wall `from` is on (-1 left, 1 right). */
  side?: number;
  /** Rough seconds to use the edge (walking to it is added by the router). */
  cost: number;
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
  /** Hangs upside down from the ceiling. */
  ceiling?: boolean;
}

interface DecorObj {
  sprite: Px;
  d: Decor;
  x: number;
  y: number;
}

/** Speeds (px/s) of the ride-along features. */
const CHUTE_SPEED = 420;
const POLE_SPEED = 300;
const SLIDE_SPEED = 230;
const TRAMP_SPEED = 380;
const LIFT_SPEED = 75;
const BOOKCASE_SPEED = 55;
/** How long a pulled trapdoor stays open (ms). */
const TRAP_OPEN_MS = 1500;

export class HouseView {
  solids: Phaser.Physics.Arcade.StaticGroup;
  layout: Layout;
  climbables: Climbable[] = [];
  blockedClimbables: Climbable[] = [];
  holes: HoleGeo[] = [];
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
  /** Floor spots that swallow you when walked over (chute hatches, slide lips, holes): bots hop them unless they mean to use them. */
  pitfalls: { room: string; x: number; half: number }[] = [];
  /** Light switch flicked: called with the room id. The scene owns the dark state. */
  onSwitch?: (room: string) => void;
  boardSprite!: Phaser.GameObjects.Image;
  private blocked: Set<string>;
  private gfx: Phaser.GameObjects.GameObject[] = [];
  private decor: Record<string, DecorObj[]> = {};
  private lamps: Record<string, { lamp: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image }> = {};
  private plaques: Record<string, { w: number; h: number }> = {};
  private damageFx: Record<string, (Phaser.Time.TimerEvent | Phaser.Tweens.Tween)[]> = {};
  private tweens: Phaser.Tweens.Tween[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  /** All static art (sky, studs, wallpaper, slabs, roof, furniture, damage) baked into one texture. */
  private canvas!: HouseCanvas;
  private fragN = 0;
  private building = false;
  private outer: Record<string, boolean> = {};
  private beds: Record<string, Phaser.GameObjects.Image> = {};
  private swirls: Record<string, Phaser.GameObjects.Image[]> = {};
  private liftCars: Record<string, { car: Phaser.GameObjects.Image; dir: number; busyUntil: number }> = {};
  private bookcases: Record<string, Phaser.GameObjects.Image> = {};
  private switchArt: Record<string, Phaser.GameObjects.Image> = {};
  private traps: Record<string, { geo: TrapGeo; solid: Phaser.GameObjects.Rectangle; open: Phaser.GameObjects.Image; lever: Phaser.GameObjects.Image; until: number }> = {};
  private portalReady = new Map<Avatar, number>();

  constructor(private scene: Phaser.Scene, public house: DerivedHouse) {
    this.solids = scene.physics.add.staticGroup();
    this.layout = buildLayout(house.def, house.connections, house.boardRoom);
    this.boardRoom = this.layout.boardRoom;
    this.boardWrapped = house.boardWrapped;
    this.tags = house.tags;
    this.blocked = house.blocked;
    this.rooms = this.layout.rooms;
    this.holes = this.layout.holes;
    this.build();
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.gfx.push(o);
    return o;
  }

  /** Physics solid. Invisible: the baked art draws the structure. */
  private solid(x: number, y: number, w: number, h: number, color = 0x6a5040, alpha = 1) {
    const r = this.add(this.scene.add.rectangle(x + w / 2, y + h / 2, w, h, color, alpha));
    r.setVisible(false);
    this.solids.add(r);
    return r;
  }

  roomRect(id: string): RoomRect {
    return this.layout.byId[id];
  }

  roomAt(x: number, y: number): RoomRect | undefined {
    return this.rooms.find((r) => x >= r.x0 - 2 && x <= r.x1 + 2 && y >= r.top - 4 && y <= r.bottom + 2);
  }

  hasTag(room: string | undefined, tag: RoomTag) {
    return !!room && this.tags[room]?.includes(tag);
  }

  private build() {
    const s = this.scene;
    const L = this.layout;
    const blocked = this.blocked;

    for (const r of this.rooms) {
      this.outer[r.id] =
        L.walls.some((w) => w.outside !== 0 && (w.x === r.x0 - WALL / 2 || w.x === r.x1 + WALL / 2) && w.gy >= r.gy && w.gy < r.gy + r.gh) ||
        L.slabs.some((sl) => sl.roof && sl.y === r.top - SLAB && sl.x0 < r.x1 && sl.x1 > r.x0);
    }

    // Everything static is baked into one canvas texture (one draw call).
    this.canvas = new HouseCanvas(
      s,
      L,
      this.holes.map((h) => ({ x0: h.x0, x1: h.x1, y: h.floor })),
    );
    this.add(s.add.image(0, 0, this.canvas.tex.key).setOrigin(0, 0).setDepth(-15));

    // The board's spot.
    const br = this.roomRect(this.boardRoom);
    this.boardX = L.boardX;
    this.boardY = br.bottom;

    for (const r of this.rooms) {
      // Room name plaque (short form if the full name doesn't fit).
      const style = { fontFamily: 'monospace', fontSize: '6px', fontStyle: 'bold', color: '#ffe08a', stroke: '#140c1c', strokeThickness: 2, resolution: 4 };
      const label = this.add(s.add.text(r.x0 + 5, r.top + 3, r.name.toUpperCase(), style).setDepth(-3).setAlpha(0.92));
      const room = r.x1 - r.x0 - 10;
      if (label.width > room) label.setText(r.name.replace(/\s*\(.*\)/, '').toUpperCase());
      if (label.width > room) label.setText(r.name.split(' ').slice(-1)[0].toUpperCase());
      this.plaques[r.id] = { w: Math.ceil(label.width) + 4, h: Math.ceil(label.height) + 2 };

      // Ceiling lamp + glow, nudged clear of ladders and poles.
      const art = themeArt(r.theme);
      const lampKey = art.lamp === undefined ? 'lamp-pendant' : art.lamp;
      if (lampKey) {
        let lx = Math.round((r.x0 + r.x1) / 2);
        if (L.anchors[r.id].some((a) => Math.abs(a - lx) < 12)) lx += lx + 24 < r.x1 - 8 ? 24 : -24;
        const glow = this.add(
          s.add
            .image(lx, r.top + 20, 'lamp-glow')
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(0.5)
            .setScale(0.8)
            .setDepth(-12.5)
            .setTint(lampKey === 'lamp-disco' ? 0xff80ff : 0xffffff),
        );
        const lamp = this.add(s.add.image(lx, r.top, lampKey).setOrigin(0.5, 0).setDepth(-11.5));
        if (lampKey === 'lamp-disco') this.tweens.push(s.tweens.add({ targets: glow, angle: 360, duration: 3000, repeat: -1 }));
        this.lamps[r.id] = { lamp, glow };
      }

      this.decor[r.id] = this.placeDecor(r);

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
          this.add(s.add.image(x, r.top, 'vine-hang').setOrigin(0.5, 0).setScale(1, 0.6 + ((i * 7) % 5) * 0.18).setDepth(-11));
        }
      }
      if (tags.includes('lowgrav')) {
        this.add(s.add.rectangle((r.x0 + r.x1) / 2, (r.top + r.bottom) / 2, r.x1 - r.x0, r.bottom - r.top, 0x9a6ae8, 0.14).setDepth(-11));
        for (let i = 0; i < 6; i++) {
          const sp = this.add(
            s.add
              .image(r.x0 + 12 + ((i * 41) % Math.max(1, r.x1 - r.x0 - 24)), r.bottom - 10 - ((i * 23) % Math.max(1, r.bottom - r.top - 20)), 'spark')
              .setTint(0xd0a0ff)
              .setAlpha(0.7)
              .setDepth(-11),
          );
          this.tweens.push(s.tweens.add({ targets: sp, y: sp.y - 10, alpha: 0.2, duration: 1600 + i * 200, yoyo: true, repeat: -1 }));
        }
      }
      if (tags.includes('cluttered')) {
        for (const fx of [0.3, 0.7]) {
          let cx = Math.round(r.x0 + (r.x1 - r.x0) * fx);
          // Keep crates off ladders, hatches and the board.
          for (let k = 0; k < 6 && L.anchors[r.id].concat(r.id === this.boardRoom ? [this.boardX] : []).some((a) => Math.abs(a - cx) < 14); k++) cx += 9;
          if (cx > r.x1 - 8) continue;
          const c = this.add(s.add.image(cx, r.bottom - 6, 'crate').setDepth(2));
          this.solids.add(c);
          this.crates.push(c);
        }
      }
    }

    this.buildStructure();
    this.buildDoors();
    this.buildClimbs();
    this.buildFeatures();

    // The board prop, with a pulsing cursed glow.
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
    void blocked;
  }

  /** Physics for slabs (with holes and trapdoors cut out) and walls (with door gaps). */
  private buildStructure() {
    const L = this.layout;
    for (const sl of L.slabs) {
      const cuts = [
        ...this.holes.filter((h) => h.floor === sl.y).map((h) => ({ x0: h.x0, x1: h.x1, trap: null as TrapGeo | null })),
        ...L.traps.filter((t) => t.floor === sl.y).map((t) => ({ x0: t.x0, x1: t.x1, trap: t })),
      ]
        .filter((c) => c.x1 > sl.x0 && c.x0 < sl.x1)
        .sort((a, b) => a.x0 - b.x0);
      let x = sl.x0;
      for (const c of cuts) {
        if (c.x0 > x) this.solid(x, sl.y, c.x0 - x, SLAB);
        if (c.trap && !this.traps[c.trap.id]) this.makeTrap(c.trap);
        x = Math.max(x, c.x1);
      }
      if (sl.x1 > x) this.solid(x, sl.y, sl.x1 - x, SLAB);
    }
    for (const w of L.walls) {
      const xa = w.outside === -1 ? w.x - 6 : w.x - WALL / 2;
      const xb = w.outside === 1 ? w.x + 6 : w.x + WALL / 2;
      const d = w.door;
      if (d && (d.kind === 'door' || d.kind === 'bookcase')) {
        this.solid(xa, w.y0, xb - xa, d.floor - DOOR_H - w.y0);
        this.solid(xa, d.floor, xb - xa, w.y1 - d.floor);
        // Bookcases stay shut (you spin through them); blocked doors get a vine bar.
        if (d.kind === 'bookcase') this.solid(xa, d.floor - DOOR_H, xb - xa, DOOR_H);
      } else this.solid(xa, w.y0, xb - xa, w.y1 - w.y0);
    }
  }

  private makeTrap(t: TrapGeo) {
    const s = this.scene;
    const solid = this.solid(t.x0, t.floor, t.x1 - t.x0, SLAB);
    const open = this.add(s.add.image(t.x0, t.floor, 'trap-open').setOrigin(0, 0).setDepth(-4).setVisible(false));
    const lever = this.add(s.add.image(t.leverX, t.floor - 2, 'lever').setOrigin(0.5, 1).setDepth(-5).setAngle(-25));
    this.traps[t.id] = { geo: t, solid, open, lever, until: 0 };
  }

  private buildDoors() {
    const s = this.scene;
    for (const d of this.layout.doors) {
      const isBlocked = this.blocked.has(d.id);
      if (d.kind === 'bookcase') {
        const img = this.add(s.add.image(d.x, d.floor, 'bookcase-door').setOrigin(0.5, 1).setDepth(-5));
        this.bookcases[d.id] = img;
        this.doors[d.id] = img;
      } else {
        this.doors[d.id] = this.add(s.add.image(d.x, d.floor, 'house-door').setOrigin(0.5, 1).setDepth(-14));
      }
      if (isBlocked) {
        if (d.kind === 'door') {
          const bar = this.solid(d.x - 3, d.floor - DOOR_H, 6, DOOR_H, 0x1e5a24);
          bar.setVisible(true).setDepth(3);
        }
        for (let vy = d.floor - DOOR_H; vy < d.floor; vy += 8) this.add(s.add.image(d.x, vy, 'vine').setOrigin(0.5, 0).setDepth(4));
        this.add(s.add.image(d.x - 3, d.floor - DOOR_H - 2, 'vine-hang').setOrigin(0.5, 0).setScale(1, 0.6).setDepth(4));
        continue;
      }
      const cost = d.kind === 'door' ? 0.3 : 0.9;
      for (const side of [-1, 1]) {
        const from = side < 0 ? d.left : d.right;
        const to = side < 0 ? d.right : d.left;
        if (d.kind === 'door') this.nav.push({ from, to, kind: 'door', x: d.x, toX: d.x - side * 10, cost });
        else this.nav.push({ from, to, kind: 'bookcase', x: d.x + side * 9, toX: d.x - side * 12, side, cost });
      }
    }
  }

  private buildClimbs() {
    for (const cl of this.layout.climbs) {
      const isBlocked = this.blocked.has(cl.id);
      this.drawClimbable(cl, isBlocked);
      if (isBlocked) {
        this.blockedClimbables.push(cl);
        continue;
      }
      this.climbables.push(cl);
      const cost = Math.hypot(cl.x1 - cl.x0, cl.y1 - cl.y0) / CLIMB_SPEED;
      this.nav.push({ from: cl.lower, to: cl.upper, kind: 'climbUp', x: cl.x0, toX: cl.x1, climb: cl, cost });
      this.nav.push({ from: cl.upper, to: cl.lower, kind: 'climbDown', x: cl.x1, toX: cl.x0, climb: cl, cost });
    }
  }

  /** Vines over a blocked feature. */
  private vinesAt(x: number, y: number) {
    for (let dx = -6; dx <= 6; dx += 6) this.add(this.scene.add.image(x + dx, y - 3, 'vine').setDepth(4));
  }

  private buildFeatures() {
    const s = this.scene;
    const L = this.layout;
    const blocked = this.blocked;

    // Laundry chutes: pipe, open hatch, sign, arrow and glow.
    for (const c of L.chutes) {
      const hy = c.hatchY;
      const pipe = chutePipeTexture(s, `${L.key}-${c.id}`, c.hatchX, c.path);
      this.add(s.add.image(pipe.x, pipe.y, pipe.key).setOrigin(0, 0).setDepth(-13.5));
      this.add(s.add.image(c.hatchX - 9, hy - 14, 'chute-hatch').setOrigin(0, 0).setDepth(-5));
      const sign = this.add(s.add.image(c.hatchX + (c.hatchX > this.roomRect(c.upper).x1 - 24 ? -9 : 7), hy - 28, 'chute-sign').setDepth(-12));
      if (blocked.has(c.id)) {
        sign.setAlpha(0.6);
        this.vinesAt(c.hatchX, hy);
        continue;
      }
      const glow = this.add(s.add.image(c.hatchX + 1, hy - 6, 'chute-glow').setBlendMode(Phaser.BlendModes.ADD).setDepth(-5.2).setAlpha(0.35));
      this.tweens.push(s.tweens.add({ targets: glow, alpha: 0.85, scaleY: 1.25, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' }));
      const arrow = this.add(s.add.image(c.hatchX, hy - 17, 'chute-arrow').setDepth(-4.6));
      this.tweens.push(s.tweens.add({ targets: arrow, y: hy - 13, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeIn' }));
      const mouth = c.path[c.path.length - 1][0];
      this.pitfalls.push({ room: c.upper, x: c.hatchX, half: 6 });
      this.nav.push({ from: c.upper, to: c.lower, kind: 'chute', x: c.hatchX, toX: mouth, cost: 0.5 });
    }

    for (const p of L.poles) {
      if (blocked.has(p.id)) {
        this.vinesAt(p.x, p.topY);
        continue;
      }
      this.nav.push({ from: p.upper, to: p.lower, kind: 'pole', x: p.x, toX: p.x, cost: 0.4 });
    }

    for (const sl of L.slides) {
      if (blocked.has(sl.id)) {
        this.vinesAt(sl.x0, sl.y0);
        continue;
      }
      const arrow = this.add(s.add.image(sl.x0, sl.y0 - 12, 'chute-arrow').setDepth(-4.6).setAngle(-sl.dir * 35));
      this.tweens.push(s.tweens.add({ targets: arrow, y: sl.y0 - 9, duration: 380, yoyo: true, repeat: -1, ease: 'Quad.easeIn' }));
      this.pitfalls.push({ room: sl.upper, x: sl.x0, half: 5 });
      this.nav.push({ from: sl.upper, to: sl.lower, kind: 'slide', x: sl.x0, toX: sl.x1, cost: 0.7 });
    }

    for (const t of L.tramps) {
      this.beds[t.id] = this.add(s.add.image(t.x, t.bedY, 'tramp-bed').setOrigin(0.5, 1).setDepth(-4));
      if (blocked.has(t.id)) {
        this.vinesAt(t.x, t.bedY);
        continue;
      }
      this.nav.push({ from: t.lower, to: t.upper, kind: 'tramp', x: t.x, toX: t.x, cost: 0.6 });
    }

    for (const p of L.portals) {
      this.swirls[p.id] = p.ends.map((e, k) => {
        const sw = this.add(s.add.image(e.x + 0.5, e.floor - 20, 'portal-swirl').setDepth(-4.8));
        this.tweens.push(s.tweens.add({ targets: sw, scaleX: -1, duration: 600, yoyo: true, repeat: -1, delay: k * 300, ease: 'Sine.easeInOut' }));
        return sw;
      });
      if (blocked.has(p.id)) {
        for (const e of p.ends) this.vinesAt(e.x, e.floor - 14);
        continue;
      }
      const [a, b] = p.ends;
      this.nav.push({ from: a.room, to: b.room, kind: 'portal', x: a.x, toX: b.x, cost: 0.4 });
      this.nav.push({ from: b.room, to: a.room, kind: 'portal', x: b.x, toX: a.x, cost: 0.4 });
    }

    for (const lf of L.lifts) {
      const last = lf.stops[lf.stops.length - 1];
      const car = this.add(s.add.image(lf.x, last.floor, 'lift-car').setOrigin(0.5, 1).setDepth(-4.2));
      this.liftCars[lf.id] = { car, dir: -1, busyUntil: 0 };
      if (lf.conns.some((id) => blocked.has(id))) {
        for (const st of lf.stops) this.vinesAt(lf.x, st.floor);
        continue;
      }
      for (let i = 0; i + 1 < lf.stops.length; i++) {
        const up = lf.stops[i];
        const lo = lf.stops[i + 1];
        const cost = 0.6 + (lo.floor - up.floor) / LIFT_SPEED;
        this.nav.push({ from: lo.room, to: up.room, kind: 'lift', x: lf.x, toX: lf.x, dir: -1, cost });
        this.nav.push({ from: up.room, to: lo.room, kind: 'lift', x: lf.x, toX: lf.x, dir: 1, cost });
      }
    }

    for (const sw of L.switches) {
      this.switchArt[sw.room] = this.add(s.add.image(sw.x, sw.y, 'switch-on').setDepth(-4.5));
    }

    // Meteor holes are one-way drops.
    for (const h of this.holes) {
      const mid = (h.x0 + h.x1) / 2;
      this.nav.push({ from: h.upper, to: h.lower, kind: 'drop', x: mid, toX: mid, cost: 0.4 });
      this.pitfalls.push({ room: h.upper, x: mid, half: (h.x1 - h.x0) / 2 });
      for (let x = h.x0 - 6; x < h.x1 + 6; x += 5) this.add(s.add.image(x, h.floor - 1, 'debris').setDepth(3));
    }
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

  // ------------------------------------------------------------ furniture

  /** Theme furniture laid out left to right, clear of features, doors and the board. */
  private placeDecor(r: RoomRect): DecorObj[] {
    const art = themeArt(r.theme);
    const busy: [number, number][] = this.layout.anchors[r.id].map((a) => [a - 13, a + 13]);
    if (r.id === this.boardRoom) busy.push([this.boardX - 28, this.boardX + 28]);
    // Wall hangings only keep clear of the features themselves (they hang above the board).
    const wallBusy: [number, number][] = this.layout.anchors[r.id].map((a) => [a - 9, a + 9]);
    const out: DecorObj[] = [];
    const clash = (a: number, b: number, list: [number, number][]) => list.some(([p, q]) => a < q && b > p);
    const floorUsed: [number, number][] = [];
    const wallUsed: [number, number][] = [];
    const seed = [...r.id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
    const fit = (w: number, used: [number, number][], avoid: [number, number][], k: number) => {
      const lo = r.x0 + 3 + w / 2;
      const hi = r.x1 - 3 - w / 2;
      if (hi < lo) return null;
      const span = hi - lo;
      const start = (seed * (k + 3) * 7) % Math.max(1, Math.floor(span));
      for (let i = 0; i <= span; i += 3) {
        const x = Math.round(lo + ((start + i) % (span + 1)));
        if (!clash(x - w / 2 - 2, x + w / 2 + 2, used) && !clash(x - w / 2, x + w / 2, avoid)) return x;
      }
      return null;
    };
    const max = 1 + r.gw * 2;
    const n = Math.min(max, Math.max(art.floor.length, r.gw * 2));
    for (let k = 0; k < n && art.floor.length; k++) {
      const key = art.floor[k % art.floor.length];
      const sprite = SPRITES.get(key);
      if (!sprite) continue;
      const x = fit(sprite.w, floorUsed, art.ceiling ? [] : busy, k);
      if (x === null) continue;
      floorUsed.push([x - sprite.w / 2, x + sprite.w / 2]);
      out.push({ sprite, d: { key, x, flip: (seed + k) % 3 === 0, ceiling: art.ceiling }, x, y: art.ceiling ? r.top : r.bottom });
    }
    const wallList = art.wall.length ? art.wall : [];
    const nw = Math.min(wallList.length * r.gw, 4);
    for (let k = 0; k < nw; k++) {
      const [key, y] = wallList[k % wallList.length];
      const sprite = SPRITES.get(key);
      if (!sprite) continue;
      const x = fit(sprite.w, wallUsed, wallBusy, k + 11);
      if (x === null) continue;
      wallUsed.push([x - sprite.w / 2, x + sprite.w / 2]);
      out.push({ sprite, d: { key, x, y, wall: true }, x, y: r.bottom - y });
    }
    return out;
  }

  // ------------------------------------------------------------ features in play

  /**
   * Features you trigger just by moving: chute hatches and slide lips (step
   * on them) and trampoline beds (land on them). Returns true if one fired.
   */
  touchFeatures(av: Avatar): boolean {
    if (av.flipped || av.body.velocity.y < 0) return false;
    const x = av.x;
    const feet = av.feetY;
    const L = this.layout;
    for (const c of L.chutes) {
      if (this.blocked.has(c.id)) continue;
      if (Math.abs(x - c.hatchX) < 6 && Math.abs(feet - c.hatchY) < 4) {
        av.startRide(this.chuteRide(c));
        return true;
      }
    }
    for (const sl of L.slides) {
      if (this.blocked.has(sl.id)) continue;
      if (Math.abs(x - sl.x0) < 5 && Math.abs(feet - sl.y0) < 4) {
        av.startRide({ path: sl.path, speed: SLIDE_SPEED, frame: 'fall', depth: 9, exitVel: [sl.dir * 110, -40], sound: 'whoosh' });
        return true;
      }
    }
    for (const t of L.tramps) {
      if (this.blocked.has(t.id)) continue;
      if (Math.abs(x - t.x) < 12 && feet >= t.bedY - 10 && feet <= t.bedY + 2 && av.body.velocity.y > 60) {
        this.boing(t.id);
        av.startRide({
          path: [
            [t.x, t.bedY - 12],
            [t.x, t.ceilY - 10],
          ],
          speed: TRAMP_SPEED,
          frame: 'jump',
          depth: 9,
          exitVel: [0, -150],
          sound: 'boing',
        });
        return true;
      }
    }
    return false;
  }

  private chuteRide(c: ChuteGeo): RideSpec {
    return { path: c.path, speed: CHUTE_SPEED, scale: 0.55, spin: true, depth: -13, frame: 'fall', pop: true, exitVel: [50, -95], sound: 'whoosh' };
  }

  private boing(id: string) {
    const bed = this.beds[id];
    if (!bed) return;
    bed.setTexture('tramp-bed-boing');
    this.scene.time.delayedCall(180, () => bed.active && bed.setTexture('tramp-bed'));
  }

  /**
   * Features you use with a button while standing on a floor: poles (down),
   * portal paintings (up), lifts, bookcases, light switches and trapdoor
   * levers (action). Returns true if one fired.
   */
  useFeatures(av: Avatar, pad: VirtualPad, now: number): boolean {
    if (av.flipped || !av.onGround) return false;
    const x = av.x;
    const feet = av.feetY;
    const on = (floor: number) => Math.abs(feet - floor) < 5;
    const L = this.layout;
    if (pad.y > 0.5) {
      for (const p of L.poles) {
        if (this.blocked.has(p.id) || Math.abs(x - p.x) > 7 || !on(p.topY)) continue;
        av.startRide({
          path: [
            [p.x, p.topY - 7],
            [p.x, p.bottomY - 7],
          ],
          speed: POLE_SPEED,
          frame: 'climb0',
          depth: 9,
          exitVel: [0, 0],
          sound: 'whoosh',
        });
        return true;
      }
    }
    if (pad.up && now >= (this.portalReady.get(av) ?? 0)) {
      for (const p of L.portals) {
        if (this.blocked.has(p.id)) continue;
        for (let k = 0; k < 2; k++) {
          const e = p.ends[k];
          if (Math.abs(x - e.x) > 8 || !on(e.floor)) continue;
          this.warp(av, e, p.ends[1 - k], p.id, k);
          this.portalReady.set(av, now + 500);
          return true;
        }
      }
    }
    if (!pad.action) return false;
    for (const lf of L.lifts) {
      if (Math.abs(x - lf.x) > 9) continue;
      const i = lf.stops.findIndex((st) => on(st.floor));
      if (i < 0 || lf.conns.some((id) => this.blocked.has(id))) continue;
      this.rideLift(av, lf, i, pad.y < -0.5 ? -1 : pad.y > 0.5 ? 1 : 0, now);
      return true;
    }
    for (const d of L.doors) {
      if (d.kind !== 'bookcase' || this.blocked.has(d.id) || Math.abs(x - d.x) > 14 || !on(d.floor)) continue;
      this.spinBookcase(av, d);
      return true;
    }
    for (const sw of L.switches) {
      if (Math.abs(x - sw.x) > 8 || av.room !== sw.room) continue;
      this.onSwitch?.(sw.room);
      sfx('blip');
      return true;
    }
    for (const t of Object.values(this.traps)) {
      if (Math.abs(x - t.geo.leverX) > 8 || !on(t.geo.floor)) continue;
      this.openTrap(t.geo.id, now);
      return true;
    }
    return false;
  }

  private warp(av: Avatar, from: PortalEnd, to: PortalEnd, id: string, k: number) {
    const s = this.scene;
    for (const [e, sw] of [
      [from, this.swirls[id]?.[k]],
      [to, this.swirls[id]?.[1 - k]],
    ] as const) {
      if (sw) s.tweens.add({ targets: sw, scale: { from: 1.6, to: 1 }, duration: 300 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const sp = s.add.image(e.x, e.floor - 20, 'spark').setTint(0xd080ff).setDepth(11);
        s.tweens.add({ targets: sp, x: e.x + Math.cos(a) * 14, y: e.floor - 20 + Math.sin(a) * 14, angle: 180, alpha: 0, duration: 380, onComplete: () => sp.destroy() });
      }
    }
    av.teleport(to.x, to.floor - 8);
    av.sprite.setScale(0.2);
    s.tweens.add({ targets: av.sprite, scaleX: 1, scaleY: 1, duration: 260, ease: 'Back.easeOut' });
    sfx('warp');
  }

  private rideLift(av: Avatar, lf: LiftGeo, i: number, want: number, now: number) {
    const st = this.liftCars[lf.id];
    let dir = want || st.dir;
    if (i === 0) dir = 1;
    else if (i === lf.stops.length - 1) dir = -1;
    st.dir = dir;
    const j = i + dir;
    const from = lf.stops[i];
    const to = lf.stops[j];
    const ms = (Math.abs(to.floor - from.floor) / LIFT_SPEED) * 1000;
    st.car.y = from.floor;
    this.scene.tweens.killTweensOf(st.car);
    this.scene.tweens.add({ targets: st.car, y: to.floor, duration: ms });
    st.busyUntil = now + ms;
    av.startRide({
      path: [
        [lf.x, from.floor - 8],
        [lf.x, to.floor - 8],
      ],
      speed: LIFT_SPEED,
      frame: 'idle0',
      depth: -4.1,
      exitVel: [0, 0],
      sound: 'blip',
    });
  }

  private spinBookcase(av: Avatar, d: DoorGeo) {
    const side = av.x < d.x ? -1 : 1;
    const img = this.bookcases[d.id];
    if (img) {
      this.scene.tweens.killTweensOf(img);
      img.scaleX = 1;
      this.scene.tweens.add({ targets: img, scaleX: -1, duration: 260, yoyo: true, ease: 'Sine.easeInOut' });
    }
    av.startRide({
      path: [
        [d.x + side * 9, d.floor - 7],
        [d.x - side * 12, d.floor - 7],
      ],
      speed: BOOKCASE_SPEED,
      frame: 'run1',
      depth: -4.9,
      exitVel: [0, 0],
      sound: 'whoosh',
    });
  }

  private openTrap(id: string, now: number) {
    const t = this.traps[id];
    if (!t || now < t.until) return;
    t.until = now + TRAP_OPEN_MS;
    (t.solid.body as Phaser.Physics.Arcade.StaticBody).enable = false;
    t.open.setVisible(true);
    t.lever.setAngle(25);
    sfx('step');
    this.timers.push(
      this.scene.time.delayedCall(TRAP_OPEN_MS, () => {
        if (!t.solid.active) return;
        (t.solid.body as Phaser.Physics.Arcade.StaticBody).enable = true;
        t.open.setVisible(false);
        t.lever.setAngle(-25);
      }),
    );
  }

  /** Show a room's light switch as on (lit) or off (dark). */
  setSwitchArt(room: string, lit: boolean) {
    this.switchArt[room]?.setTexture(lit ? 'switch-on' : 'switch-off');
  }

  /** Rooms that have a light switch. */
  get switchRooms(): string[] {
    return this.layout.switches.map((s) => s.room);
  }

  // ------------------------------------------------------------ damage

  /** Room-local rects the damage overlay must leave clear (doors, features, board, holes). */
  private keepClear(r: RoomRect): KeepClear[] {
    const W = r.x1 - r.x0;
    const H = r.bottom - r.top;
    const k: KeepClear[] = [];
    for (const d of this.layout.doors) {
      if (d.left !== r.id && d.right !== r.id) continue;
      k.push({ x: d.x - r.x0 - 14, y: d.floor - r.top - DOOR_H - 4, w: 28, h: DOOR_H + 4 });
    }
    for (const a of this.layout.anchors[r.id]) k.push({ x: a - r.x0 - 12, y: 0, w: 24, h: H });
    if (r.id === this.boardRoom) k.push({ x: this.boardX - r.x0 - 26, y: H - 36, w: 52, h: 36 });
    for (const h of this.holes) {
      if (h.upper === r.id) k.push({ x: h.x0 - r.x0 - 6, y: H - 14, w: h.x1 - h.x0 + 12, h: 14 });
      if (h.lower === r.id) k.push({ x: h.x0 - r.x0 - 6, y: 0, w: h.x1 - h.x0 + 12, h: 14 });
    }
    void W;
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
      lamp.glow.setAlpha(level >= 3 ? 0.3 : 0.5).setX(lamp.lamp.x + (level >= 3 ? 8 : 0));
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
        const p = this.add(s.add.image(r.x0 + ((i * 37) % (r.x1 - r.x0)), r.top + 6 + ((i * 17) % 30), 'debris').setDepth(9));
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
    const dr = { ...r, outer: this.outer[r.id] };
    c.over.clearRect(clip.x, clip.y, clip.w, clip.h);
    drawRoomDamage(c.over, dr, level, keep, 'wall');
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
      let angle = o.d.ceiling ? 180 : 0;
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
          angle += sign * 5;
          ay += o.d.ceiling ? -1 : 1;
        }
        if (level >= 3) sprite = SPRITES.get(`${o.d.key}-broken`) ?? sprite;
      }
      blitSprite(c.over, sprite, ax, ay, ox, oy, angle, !!o.d.flip, clip);
    }
    drawRoomDamage(c.over, dr, level, keep, 'front');
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

  // ------------------------------------------------------------ routing

  /**
   * Fastest room-level route from a to b (Dijkstra over nav edges: each edge's
   * cost plus the walk to it from where the previous edge left you).
   */
  route(from: string, to: string, fromX?: number): NavEdge[] | null {
    if (from === to) return [];
    const start = this.roomRect(from);
    if (!start) return null;
    const dist = new Map<string, number>([[from, 0]]);
    const atX = new Map<string, number>([[from, fromX ?? (start.x0 + start.x1) / 2]]);
    const prev = new Map<string, NavEdge>();
    const done = new Set<string>();
    for (;;) {
      let cur: string | null = null;
      for (const [k, d] of dist) if (!done.has(k) && (cur === null || d < dist.get(cur)!)) cur = k;
      if (cur === null) return null;
      if (cur === to) break;
      done.add(cur);
      const d0 = dist.get(cur)!;
      const x0 = atX.get(cur)!;
      for (const e of this.nav) {
        if (e.from !== cur || done.has(e.to)) continue;
        const d = d0 + e.cost + Math.abs(e.x - x0) / RUN_SPEED;
        if (d < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, d);
          atX.set(e.to, e.toX);
          prev.set(e.to, e);
        }
      }
    }
    const path: NavEdge[] = [];
    let n = to;
    while (n !== from) {
      const pe = prev.get(n)!;
      path.unshift(pe);
      n = pe.from;
    }
    return path;
  }

  /** A random standing point inside a room. */
  randomPoint(roomId: string, rnd: () => number) {
    const r = this.roomRect(roomId);
    return { x: r.x0 + 12 + rnd() * (r.x1 - r.x0 - 24), y: r.bottom - 8 };
  }

  destroy() {
    for (const t of this.tweens) t.remove();
    this.tweens = [];
    for (const t of this.timers) t.remove();
    this.timers = [];
    for (const list of Object.values(this.damageFx)) for (const fx of list) fx.remove();
    this.damageFx = {};
    this.solids.destroy(false);
    for (const o of this.gfx) {
      this.scene.tweens.killTweensOf(o);
      o.destroy();
    }
    this.gfx = [];
    this.canvas?.destroy();
  }
}

/** Stamp order inside a room: rug, wall items, then floor furniture. */
function rank(o: DecorObj) {
  return o.d.key === 'rug' ? 0 : o.d.wall ? 1 : 2;
}
