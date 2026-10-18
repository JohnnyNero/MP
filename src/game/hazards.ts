import Phaser from 'phaser';
import type { ActiveEffect, HazardId } from '../core/types';
import { FLOOR_Y, H, ROOF_Y, W } from './config';
import { overlaps, type MGContext, type System } from './mgContext';

// Each hazard has an intense form (the card in play this minigame) and the
// mild lingering form comes from room tags (see LingeringSystem).

function hitAvatar(ctx: MGContext, i: number, knockX = 0, stunMs?: number) {
  const av = ctx.avatars[i];
  if (av.hit(ctx.now, knockX, stunMs)) {
    ctx.hazardHits[i] += 1;
    ctx.sfx('hit');
  }
}

// ------------------------------------------------------------------ flood
class Flood implements System {
  private water: Phaser.GameObjects.Rectangle;
  private surface: Phaser.GameObjects.Rectangle;
  private level = 0;
  private under: number[];
  constructor(private ctx: MGContext) {
    this.water = ctx.scene.add.rectangle(W / 2, FLOOR_Y[0], 464, 0, 0x2a6ad0, 0.55).setOrigin(0.5, 1).setDepth(20);
    this.surface = ctx.scene.add.rectangle(W / 2, FLOOR_Y[0], 464, 1, 0x9ad0ff, 0.9).setDepth(21);
    this.under = ctx.avatars.map(() => 0);
  }
  update(dt: number) {
    this.level = Math.min(46, this.level + dt * 0.0016);
    const top = FLOOR_Y[0] - this.level;
    this.water.setSize(464, this.level);
    this.water.setPosition(W / 2, FLOOR_Y[0]);
    if (this.level > 8) this.ctx.house.rooms.filter((r) => r.floor === 0).forEach((r) => this.ctx.hotRooms.add(r.id));
    this.surface.y = top + Math.sin(this.ctx.now / 200);
    this.ctx.avatars.forEach((av, i) => {
      if (av.y + 7 < top || av.y > FLOOR_Y[0] + 4) {
        this.under[i] = 0;
        return;
      }
      av.slow = Math.min(av.slow, 0.6);
      if (av.y - 7 > top) {
        this.under[i] += dt;
        if (this.under[i] > 2200) {
          this.under[i] = 0;
          hitAvatar(this.ctx, i, 0, 900);
        }
      } else this.under[i] = 0;
    });
  }
  destroy() {
    this.water.destroy();
    this.surface.destroy();
  }
}

// ------------------------------------------------------------------ meteor
interface Strike {
  x: number;
  floorY: number;
  t: number;
  shadow: Phaser.GameObjects.Image;
  rock?: Phaser.GameObjects.Image;
}
class Meteors implements System {
  private strikes: Strike[] = [];
  private next = 600;
  constructor(private ctx: MGContext, private rooms: string[]) {}
  update(dt: number) {
    const c = this.ctx;
    this.rooms.forEach((r) => c.hotRooms.add(r));
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 650;
      const room = c.house.roomRect(this.rooms[Math.floor(c.rnd() * this.rooms.length)]);
      const x = room.x0 + 8 + c.rnd() * (room.x1 - room.x0 - 16);
      const shadow = c.scene.add.image(x, room.bottom - 1, 'shadow').setAlpha(0.5).setDepth(8);
      this.strikes.push({ x, floorY: room.bottom, t: 0, shadow });
    }
    for (const s of this.strikes) {
      s.t += dt;
      s.shadow.setScale(0.5 + Math.min(1, s.t / 900));
      if (s.t > 650 && !s.rock) s.rock = c.scene.add.image(s.x, ROOF_Y, 'meteor').setDepth(22);
      if (s.rock) {
        const k = Math.min(1, (s.t - 650) / 260);
        s.rock.y = ROOF_Y + (s.floorY - 4 - ROOF_Y) * k;
        s.rock.rotation += dt * 0.02;
      }
      if (s.t >= 910 && s.t - dt < 910) {
        c.avatars.forEach((av, i) => {
          if (overlaps(av, s.x, s.floorY - 8, 11, 12)) hitAvatar(c, i, Math.sign(av.x - s.x) * 90);
        });
        c.scene.cameras.main.shake(80, 0.004);
        c.sfx('boom');
      }
    }
    for (const s of this.strikes.filter((q) => q.t > 1000)) {
      s.shadow.destroy();
      s.rock?.destroy();
    }
    this.strikes = this.strikes.filter((q) => q.t <= 1000);
    for (const s of this.strikes) c.dangers.push({ x: s.x, y: s.floorY - 8, r: 16 });
  }
  destroy() {
    for (const s of this.strikes) {
      s.shadow.destroy();
      s.rock?.destroy();
    }
  }
}

// ------------------------------------------------------------------ vines
interface VineCol {
  x: number;
  floorY: number;
  t: number;
  imgs: Phaser.GameObjects.Image[];
  touched: Set<number>;
}
class Vines implements System {
  private cols: VineCol[] = [];
  private next = 400;
  constructor(private ctx: MGContext, private rooms: string[]) {}
  update(dt: number) {
    const c = this.ctx;
    this.rooms.forEach((r) => c.hotRooms.add(r));
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 1100;
      const room = c.house.roomRect(this.rooms[Math.floor(c.rnd() * this.rooms.length)]);
      const x = room.x0 + 10 + c.rnd() * (room.x1 - room.x0 - 20);
      const imgs = Array.from({ length: 5 }, (_, k) =>
        c.scene.add.image(x, room.bottom - 4 - k * 8, 'vine').setDepth(9).setVisible(false),
      );
      this.cols.push({ x, floorY: room.bottom, t: 0, imgs, touched: new Set() });
    }
    for (const v of this.cols) {
      v.t += dt;
      const grow = v.t < 1000 ? v.t / 1000 : v.t > 4500 ? Math.max(0, 1 - (v.t - 4500) / 500) : 1;
      const height = 40 * grow;
      v.imgs.forEach((img, k) => img.setVisible(k * 8 < height));
      if (height > 6) {
        c.avatars.forEach((av, i) => {
          if (Math.abs(av.x - v.x) < 6 && av.y > v.floorY - height - 7 && av.y < v.floorY + 2) {
            av.slow = Math.min(av.slow, 0.35);
            if (!v.touched.has(i)) {
              v.touched.add(i);
              hitAvatar(c, i, 0, 600);
            }
          }
        });
        c.dangers.push({ x: v.x, y: v.floorY - 10, r: 12 });
      }
    }
    for (const v of this.cols.filter((q) => q.t > 5000)) v.imgs.forEach((i) => i.destroy());
    this.cols = this.cols.filter((q) => q.t <= 5000);
  }
  destroy() {
    for (const v of this.cols) v.imgs.forEach((i) => i.destroy());
  }
}

// ------------------------------------------------------------------ stampede
interface Herd {
  dir: number;
  x: number;
  floorY: number;
  beasts: Phaser.GameObjects.Image[];
}
class Stampede implements System {
  private herds: Herd[] = [];
  private next = 1500;
  private floorY: number;
  constructor(private ctx: MGContext, private rooms: string[]) {
    this.floorY = ctx.house.roomRect(rooms[0]).bottom;
  }
  update(dt: number) {
    const c = this.ctx;
    this.rooms.forEach((r) => c.hotRooms.add(r));
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 3400;
      const dir = c.rnd() < 0.5 ? 1 : -1;
      const x = dir > 0 ? -30 : W + 30;
      const beasts = [0, 1, 2].map((k) =>
        c.scene.add.image(x - dir * k * 22, this.floorY - 4, 'beast').setFlipX(dir < 0).setDepth(18),
      );
      this.herds.push({ dir, x, floorY: this.floorY, beasts });
      c.popText('STAMPEDE!', dir > 0 ? 40 : W - 40, this.floorY - 40, '#ffcc66');
    }
    for (const h of this.herds) {
      h.x += h.dir * 0.16 * dt;
      h.beasts.forEach((b, k) => {
        b.x = h.x - h.dir * k * 22;
        b.y = h.floorY - 4 - Math.abs(Math.sin((c.now + k * 90) / 70)) * 2;
        c.avatars.forEach((av, i) => {
          if (overlaps(av, b.x, b.y, 10, 9)) hitAvatar(c, i, h.dir * 160, 900);
        });
        c.dangers.push({ x: b.x - h.dir * 10, y: h.floorY - 8, r: 30, jump: true });
      });
    }
    for (const h of this.herds.filter((q) => q.x < -120 || q.x > W + 120)) h.beasts.forEach((b) => b.destroy());
    this.herds = this.herds.filter((q) => q.x >= -120 && q.x <= W + 120);
  }
  destroy() {
    for (const h of this.herds) h.beasts.forEach((b) => b.destroy());
  }
}

// ------------------------------------------------------------------ fire
interface Flame {
  x: number;
  floorY: number;
  room: string;
  img: Phaser.GameObjects.Image;
}
export class Fire implements System {
  flames: Flame[] = [];
  private spreadIn = 1400;
  constructor(private ctx: MGContext, rooms: string[], start: number, private cap: number, private spreads: boolean) {
    for (let k = 0; k < start; k++) {
      const room = rooms[k % rooms.length];
      const r = ctx.house.roomRect(room);
      this.add(r.x0 + 14 + ctx.rnd() * (r.x1 - r.x0 - 28), room);
    }
  }
  private add(x: number, room: string) {
    const r = this.ctx.house.roomRect(room);
    x = Math.max(r.x0 + 6, Math.min(r.x1 - 6, x));
    if (this.flames.some((f) => f.room === room && Math.abs(f.x - x) < 7)) return;
    const img = this.ctx.scene.add.image(x, r.bottom, 'flame').setOrigin(0.5, 1).setDepth(9);
    this.flames.push({ x, floorY: r.bottom, room, img });
  }
  update(dt: number) {
    const c = this.ctx;
    for (const f of this.flames) {
      c.hotRooms.add(f.room);
      f.img.setScale(1 + Math.sin((c.now + f.x * 13) / 90) * 0.12, 1 + Math.sin((c.now + f.x * 7) / 70) * 0.2);
      c.avatars.forEach((av, i) => {
        if (overlaps(av, f.x, f.floorY - 6, 7, 11)) hitAvatar(c, i, Math.sign(av.x - f.x) * 80, 800);
      });
      c.dangers.push({ x: f.x, y: f.floorY - 8, r: 14 });
    }
    if (!this.spreads) return;
    this.spreadIn -= dt;
    if (this.spreadIn <= 0 && this.flames.length < this.cap) {
      this.spreadIn = 1400;
      const src = this.flames[Math.floor(c.rnd() * this.flames.length)];
      if (src) this.add(src.x + (c.rnd() < 0.5 ? -10 : 10), src.room);
    }
  }
  destroy() {
    for (const f of this.flames) f.img.destroy();
  }
}

// ------------------------------------------------------------------ monkeys
interface Monkey {
  room: string;
  x: number;
  img: Phaser.GameObjects.Image;
  fleeUntil: number;
  vx: number;
}
export class Monkeys implements System {
  monkeys: Monkey[] = [];
  constructor(private ctx: MGContext, rooms: string[], perRoom: number) {
    for (const room of rooms) {
      for (let k = 0; k < perRoom; k++) {
        const r = ctx.house.roomRect(room);
        const x = r.x0 + 10 + ctx.rnd() * (r.x1 - r.x0 - 20);
        this.monkeys.push({ room, x, img: ctx.scene.add.image(x, r.bottom - 4, 'monkey').setDepth(11), fleeUntil: 0, vx: 0 });
      }
    }
  }
  update(dt: number) {
    const c = this.ctx;
    for (const m of this.monkeys) {
      c.hotRooms.add(m.room);
      const r = c.house.roomRect(m.room);
      const targets = c.avatars.map((av, i) => ({ av, i })).filter(({ av }) => av.room === m.room);
      let want = 0;
      if (c.now < m.fleeUntil || targets.length === 0) want = Math.sin((c.now + m.x * 50) / 600) * 0.5;
      else {
        const near = targets.reduce((a, b) => (Math.abs(a.av.x - m.x) < Math.abs(b.av.x - m.x) ? a : b));
        want = Math.sign(near.av.x - m.x);
      }
      m.vx += (want * 0.07 - m.vx) * 0.1;
      m.x = Math.max(r.x0 + 6, Math.min(r.x1 - 6, m.x + m.vx * dt));
      m.img.setPosition(m.x, r.bottom - 4 - Math.abs(Math.sin(c.now / 110 + m.x)) * 4).setFlipX(m.vx < 0);
      if (c.now >= m.fleeUntil) {
        for (const { av, i } of targets) {
          if (overlaps(av, m.x, r.bottom - 6, 8, 10)) {
            c.coinDelta[i] -= 1;
            c.popText('-1', av.x, av.y - 12, '#ff8080');
            c.sfx('coin');
            m.fleeUntil = c.now + 2200;
            break;
          }
        }
      }
      c.dangers.push({ x: m.x, y: r.bottom - 8, r: 14 });
    }
  }
  destroy() {
    for (const m of this.monkeys) m.img.destroy();
  }
}

// ------------------------------------------------------------------ factory

export function createHazard(ctx: MGContext, id: HazardId, rooms: string[]): System {
  switch (id) {
    case 'flood':
      return new Flood(ctx);
    case 'meteor':
      return new Meteors(ctx, rooms);
    case 'vines':
      return new Vines(ctx, rooms);
    case 'stampede':
      return new Stampede(ctx, rooms);
    case 'fire':
      return new Fire(ctx, rooms, 2, 14, true);
    case 'monkeys':
      return new Monkeys(ctx, rooms, 3);
    case 'blackout':
      return { update: () => rooms.forEach((r) => ctx.darkRooms.set(r, 18)), destroy: () => {} };
    case 'gravity': {
      const marks = rooms.flatMap((id) => {
        const r = ctx.house.roomRect(id);
        const tint = ctx.scene.add.rectangle((r.x0 + r.x1) / 2, (r.top + r.bottom) / 2, r.x1 - r.x0, r.bottom - r.top, 0x9a6ae8, 0.18).setDepth(-10);
        const label = ctx.scene.add
          .text((r.x0 + r.x1) / 2, r.top + 12, '↑ GRAVITY FLIPPED ↑', { fontFamily: 'monospace', fontSize: '7px', color: '#d0b0ff', resolution: 4 })
          .setOrigin(0.5, 0)
          .setDepth(-9);
        return [tint, label];
      });
      return {
        update: () =>
          rooms.forEach((r) => {
            ctx.flippedRooms.add(r);
            ctx.hotRooms.add(r);
          }),
        destroy: () => marks.forEach((m) => m.destroy()),
      };
    }
  }
}

/** The mild, always-on version of everything that lingers in the house. */
/**
 * Every hazard that wasn't contained keeps running at full strength, in the
 * rooms it hit, through every regroup and minigame until it is repaired.
 */
export class LingeringSystem implements System {
  private hazards: System[];
  constructor(ctx: MGContext, effects: ActiveEffect[]) {
    // Hits from old hazards don't count against this round's containment:
    // give them their own hit counter, sharing everything else with ctx.
    const lingerCtx: MGContext = Object.create(ctx);
    lingerCtx.hazardHits = [0, 0, 0, 0];
    this.hazards = effects.map((e) => createHazard(lingerCtx, e.card, e.rooms));
  }
  update(dt: number) {
    for (const h of this.hazards) h.update(dt);
  }
  destroy() {
    for (const h of this.hazards) h.destroy();
  }
}

/** Draws darkness over dark rooms with a light around each avatar. */
export class DarkOverlay {
  private rt: Phaser.GameObjects.RenderTexture;
  private light: Phaser.GameObjects.Image;
  constructor(private ctx: MGContext) {
    this.rt = ctx.scene.add.renderTexture(0, 0, W, H).setOrigin(0, 0).setDepth(40);
    this.light = ctx.scene.make.image({ x: 0, y: 0, key: 'light' }, false);
  }
  update() {
    const rooms = this.ctx.darkRooms;
    this.rt.clear();
    if (rooms.size === 0) return;
    for (const [id] of rooms) {
      const r = this.ctx.house.roomRect(id);
      this.rt.fill(0x05030a, 0.95, r.x0, r.top, r.x1 - r.x0, r.bottom - r.top + 2);
    }
    for (const av of this.ctx.avatars) {
      const radius = av.room ? rooms.get(av.room) : undefined;
      if (!radius) continue;
      this.light.setScale(radius / 26);
      this.rt.erase(this.light, av.x, av.y);
    }
  }
  destroy() {
    this.rt.destroy();
    this.light.destroy();
  }
}
