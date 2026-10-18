import Phaser from 'phaser';
import type { MinigamePlan } from '../core/types';
import { MINIGAME_SECONDS } from './config';
import type { BotGoal } from './botBrain';
import { overlaps, type MGContext, type System } from './mgContext';

export interface GoalSystem extends System {
  scores(): number[];
  groupScore(): number;
  botGoal(i: number): BotGoal;
  hud(): string;
}

function rivalsOf(plan: MinigamePlan, i: number, n: number): number[] {
  return Array.from({ length: n }, (_, j) => j).filter((j) => j !== i && (plan.format === 'ffa' || plan.teams[j] !== plan.teams[i]));
}

/** A random floor point, never in a gravity-flipped room (its floor is out of reach). */
function randomRoomPoint(ctx: MGContext) {
  const ok = ctx.house.rooms.filter((r) => !ctx.flippedRooms.has(r.id) && !ctx.house.tags[r.id].includes('lowgrav'));
  const rooms = ok.length ? ok : ctx.house.rooms;
  const room = rooms[Math.floor(ctx.rnd() * rooms.length)];
  return ctx.house.randomPoint(room.id, ctx.rnd);
}

/** Pick a spot reachable-ish: any room point. */
function nearest<T extends { x: number; y: number }>(items: T[], x: number, y: number): T | undefined {
  let best: T | undefined;
  let bd = Infinity;
  for (const it of items) {
    const d = Math.abs(it.x - x) + Math.abs(it.y - y) * 3;
    if (d < bd) {
      bd = d;
      best = it;
    }
  }
  return best;
}

/** Head for the nearest room no hazard is active in, then wander there. */
export function safeRoomGoal(ctx: MGContext, i: number): BotGoal {
  const av = ctx.avatars[i];
  const h = ctx.house;
  const t = Math.floor(ctx.now / 2500 + i);
  if (av.room && !ctx.hotRooms.has(av.room)) {
    const r = h.roomRect(av.room);
    return { kind: 'goto', x: r.x0 + 16 + ((t * 37) % Math.max(1, r.x1 - r.x0 - 32)), y: r.bottom - 8 };
  }
  let best: string | null = null;
  let bestLen = Infinity;
  for (const r of h.rooms) {
    if (ctx.hotRooms.has(r.id)) continue;
    const len = av.room ? (h.route(av.room, r.id)?.length ?? Infinity) : 0;
    if (len < bestLen) {
      bestLen = len;
      best = r.id;
    }
  }
  if (!best) return { kind: 'idle' };
  const r = h.roomRect(best);
  return { kind: 'goto', x: (r.x0 + r.x1) / 2, y: r.bottom - 8 };
}

// ------------------------------------------------------------ survive
class Survive implements GoalSystem {
  private books: { x: number; floorY: number; top: number; t: number; shadow: Phaser.GameObjects.Image; img?: Phaser.GameObjects.Image }[] = [];
  private next = 500;
  private hits: number[];
  private elapsed = 0;
  constructor(private ctx: MGContext) {
    this.hits = ctx.avatars.map(() => 0);
  }
  update(dt: number) {
    const c = this.ctx;
    this.elapsed += dt;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 520;
      // Aim near a random player so nobody can idle safely.
      const target = c.avatars[Math.floor(c.rnd() * c.avatars.length)];
      const room = c.house.roomAt(target.x, target.y) ?? c.house.rooms[0];
      const x = Math.max(room.x0 + 6, Math.min(room.x1 - 6, target.x + (c.rnd() - 0.5) * 50));
      const shadow = c.scene.add.image(x, room.bottom - 1, 'shadow').setAlpha(0.4).setDepth(8);
      this.books.push({ x, floorY: room.bottom, top: room.top, t: 0, shadow });
    }
    for (const b of this.books) {
      b.t += dt;
      if (b.t > 600 && !b.img) b.img = c.scene.add.image(b.x, b.top, 'book').setDepth(22);
      if (b.img) b.img.y = b.top + (b.floorY - 4 - b.top) * Math.min(1, (b.t - 600) / 220);
      if (b.t >= 820 && b.t - dt < 820) {
        c.avatars.forEach((av, i) => {
          if (overlaps(av, b.x, b.floorY - 8, 8, 10) && av.hit(c.now, Math.sign(av.x - b.x) * 70, 800)) {
            this.hits[i] += 1;
            c.sfx('hit');
          }
        });
      }
      c.dangers.push({ x: b.x, y: b.floorY - 8, r: 13 });
    }
    for (const b of this.books.filter((q) => q.t > 900)) {
      b.shadow.destroy();
      b.img?.destroy();
    }
    this.books = this.books.filter((q) => q.t <= 900);
  }
  scores() {
    return this.hits.map((h, i) => 10 - h - this.ctx.hazardHits[i]);
  }
  /** Books only: the hazard's own trouble is folded in by the scene, like every goal. */
  groupScore() {
    // Book hits per player per 40 s: bots average ~8; 16 or more is a wipe-out.
    const total = this.hits.reduce((a, b) => a + b, 0);
    const per40 = total / this.hits.length / Math.max(0.25, this.elapsed / 40000);
    return Math.max(0, 1 - per40 / 16);
  }
  botGoal(i: number): BotGoal {
    return safeRoomGoal(this.ctx, i);
  }
  hud() {
    return 'Dodge everything!';
  }
  destroy() {
    for (const b of this.books) {
      b.shadow.destroy();
      b.img?.destroy();
    }
  }
}

// ------------------------------------------------------------ collect
class Collect implements GoalSystem {
  private apples: { x: number; y: number; floorY: number; t: number; img: Phaser.GameObjects.Image }[] = [];
  private next = 0;
  private spawned = 0;
  private caught: number[];
  constructor(private ctx: MGContext) {
    this.caught = ctx.avatars.map(() => 0);
  }
  update(dt: number) {
    const c = this.ctx;
    this.next -= dt;
    if (this.next <= 0) {
      this.next = 600;
      const p = randomRoomPoint(c);
      const room = c.house.roomAt(p.x, p.y)!;
      this.spawned++;
      this.apples.push({ x: p.x, y: room.top + 4, floorY: room.bottom - 3, t: 0, img: c.scene.add.image(p.x, room.top + 4, 'apple').setDepth(12) });
    }
    for (const a of this.apples) {
      a.t += dt;
      a.y = Math.min(a.floorY, a.y + dt * 0.05);
      a.img.setPosition(a.x, a.y);
      if (a.t > 7200) a.img.setAlpha(Math.floor(a.t / 100) % 2 ? 0.3 : 1);
      for (let i = 0; i < c.avatars.length; i++) {
        if (overlaps(c.avatars[i], a.x, a.y, 7, 9) && !c.avatars[i].isStunned(c.now)) {
          this.caught[i]++;
          a.t = 99999;
          c.sfx('pickup');
          break;
        }
      }
    }
    for (const a of this.apples.filter((q) => q.t > 8000)) a.img.destroy();
    this.apples = this.apples.filter((q) => q.t <= 8000);
  }
  scores() {
    return [...this.caught];
  }
  groupScore() {
    return Math.min(1, this.caught.reduce((a, b) => a + b, 0) / Math.max(1, this.spawned * 0.45));
  }
  botGoal(i: number): BotGoal {
    const av = this.ctx.avatars[i];
    // Prefer apples on our own floor; other floors cost a lot more to reach.
    let best: (typeof this.apples)[number] | undefined;
    let bd = Infinity;
    for (const a of this.apples) {
      if (a.t > 99000) continue;
      const d = Math.abs(a.x - av.x) + (Math.abs(a.floorY - av.y) > 20 ? 220 : 0) - Math.min(a.t, 7000) / 100;
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best ? { kind: 'goto', x: best.x, y: best.floorY - 4 } : { kind: 'idle' };
  }
  hud() {
    return 'Catch apples!';
  }
  destroy() {
    for (const a of this.apples) a.img.destroy();
  }
}

// ------------------------------------------------------------ king of the hill
class King implements GoalSystem {
  private zone!: { x: number; y: number };
  private zoneGfx: Phaser.GameObjects.Rectangle;
  private flag: Phaser.GameObjects.Image;
  private held: number[];
  private moveIn = 0;
  private heldTime = 0;
  private contestedTime = 0;
  private elapsed = 0;
  constructor(private ctx: MGContext, private plan: MinigamePlan) {
    this.held = ctx.avatars.map(() => 0);
    this.zoneGfx = ctx.scene.add.rectangle(0, 0, 40, 26, 0xffd040, 0.18).setStrokeStyle(1, 0xffd040, 0.8).setDepth(7);
    this.flag = ctx.scene.add.image(0, 0, 'flag').setOrigin(0, 1).setDepth(8);
  }
  update(dt: number) {
    const c = this.ctx;
    this.moveIn -= dt;
    if (this.moveIn <= 0) {
      this.moveIn = 9000;
      this.zone = randomRoomPoint(c);
      this.zoneGfx.setPosition(this.zone.x, this.zone.y - 5);
      this.flag.setPosition(this.zone.x - 2, this.zone.y + 8);
    }
    this.elapsed += dt;
    const inside = c.avatars.map((av, i) => ({ av, i })).filter(({ av }) => overlaps(av, this.zone.x, this.zone.y - 5, 20, 14) && !av.isStunned(c.now));
    const sides = new Set(inside.map(({ i }) => (this.plan.format === 'ffa' ? i : this.plan.teams[i])));
    if (sides.size === 1) {
      for (const { i } of inside) this.held[i] += dt / 1000;
      this.heldTime += dt;
      this.zoneGfx.setFillStyle(0xffd040, 0.35);
    } else this.zoneGfx.setFillStyle(0xffd040, 0.15);
    if (sides.size > 1) this.contestedTime += dt;
  }
  scores() {
    return this.held.map((h) => Math.round(h * 10) / 10);
  }
  groupScore() {
    // Held time counts fully and contested time half: with every bot piling
    // onto the zone, held time alone sat at ~3% and King never contained.
    const occupied = this.heldTime + 0.5 * this.contestedTime;
    return Math.min(1, occupied / Math.max(1, this.elapsed) / 0.5);
  }
  botGoal(): BotGoal {
    return this.zone ? { kind: 'goto', x: this.zone.x + (this.ctx.rnd() - 0.5) * 10, y: this.zone.y } : { kind: 'idle' };
  }
  hud() {
    return 'Hold the flag zone!';
  }
  destroy() {
    this.zoneGfx.destroy();
    this.flag.destroy();
  }
}

// ------------------------------------------------------------ race
class Race implements GoalSystem {
  private p!: { x: number; y: number };
  private img: Phaser.GameObjects.Image;
  private won: number[];
  private claimed = 0;
  private missed = 0;
  private timer = 0;
  constructor(private ctx: MGContext) {
    this.won = ctx.avatars.map(() => 0);
    this.img = ctx.scene.add.image(0, 0, 'pennant').setOrigin(0, 1).setDepth(12);
    this.place();
  }
  private place() {
    this.p = randomRoomPoint(this.ctx);
    this.img.setPosition(this.p.x - 1, this.p.y + 8);
    this.timer = 9000;
  }
  update(dt: number) {
    const c = this.ctx;
    this.timer -= dt;
    this.img.setScale(1, 1 + Math.sin(c.now / 120) * 0.1);
    if (this.timer <= 0) {
      this.missed++;
      this.place();
      return;
    }
    for (let i = 0; i < c.avatars.length; i++) {
      if (overlaps(c.avatars[i], this.p.x, this.p.y, 8, 10) && !c.avatars[i].isStunned(c.now)) {
        this.won[i]++;
        this.claimed++;
        c.popText('+1', this.p.x, this.p.y - 14, '#ffe060');
        c.sfx('pickup');
        this.place();
        break;
      }
    }
  }
  scores() {
    return [...this.won];
  }
  groupScore() {
    return this.claimed / Math.max(1, this.claimed + this.missed * 2);
  }
  botGoal(): BotGoal {
    return { kind: 'goto', x: this.p.x, y: this.p.y };
  }
  hud() {
    return 'Grab the pennants!';
  }
  destroy() {
    this.img.destroy();
  }
}

// ------------------------------------------------------------ hot potato
class Potato implements GoalSystem {
  private holder: number;
  private fuse: number;
  private immune = 0;
  private booms: number[];
  private passes = 0;
  private bomb: Phaser.GameObjects.Image;
  constructor(private ctx: MGContext, private plan: MinigamePlan) {
    this.booms = ctx.avatars.map(() => 0);
    this.holder = Math.floor(ctx.rnd() * ctx.avatars.length);
    this.fuse = 9000 + ctx.rnd() * 4000;
    this.bomb = ctx.scene.add.image(0, 0, 'bomb').setDepth(30);
  }
  update(dt: number) {
    const c = this.ctx;
    const h = c.avatars[this.holder];
    this.fuse -= dt;
    this.immune -= dt;
    this.bomb.setTexture(Math.floor(c.now / (this.fuse < 2000 ? 80 : 200)) % 2 ? 'bomb1' : 'bomb');
    this.bomb.setPosition(h.x, h.y - 14).setTint(this.fuse < 2000 && Math.floor(c.now / 100) % 2 ? 0xff4040 : 0xffffff);
    if (this.fuse <= 0) {
      this.booms[this.holder]++;
      h.hit(c.now, 0, 1200);
      c.sfx('boom');
      c.scene.cameras.main.shake(120, 0.006);
      c.popText('BOOM', h.x, h.y - 16, '#ff6040');
      const others = c.avatars.map((_, i) => i).filter((i) => i !== this.holder);
      this.holder = others[Math.floor(c.rnd() * others.length)];
      this.fuse = 9000 + c.rnd() * 4000;
      this.immune = 1200;
      return;
    }
    if (this.immune > 0) return;
    for (let i = 0; i < c.avatars.length; i++) {
      if (i === this.holder) continue;
      if (overlaps(c.avatars[i], h.x, h.y, 9, 12)) {
        this.holder = i;
        this.immune = 900;
        this.passes++;
        c.sfx('blip');
        break;
      }
    }
  }
  scores() {
    return this.booms.map((b) => 3 - b);
  }
  groupScore() {
    return Math.min(1, this.passes / 10);
  }
  botGoal(i: number): BotGoal {
    const c = this.ctx;
    const h = c.avatars[this.holder];
    if (i === this.holder) {
      const rivals = rivalsOf(this.plan, i, c.avatars.length);
      const pool = (rivals.length ? rivals : c.avatars.map((_, j) => j).filter((j) => j !== i)).map((j) => c.avatars[j]);
      const t = nearest(pool, h.x, h.y)!;
      return { kind: 'goto', x: t.x, y: t.y };
    }
    return { kind: 'flee', x: h.x, y: h.y };
  }
  hud() {
    return "Don't hold the bomb!";
  }
  destroy() {
    this.bomb.destroy();
  }
}

// ------------------------------------------------------------ tag
class Tag implements GoalSystem {
  private chaserTeam: number;
  private tags = 0;
  private runners: number;
  private elapsed = 0;
  /** Runner-ms spent frozen. */
  private frozenMs = 0;
  constructor(private ctx: MGContext, private plan: MinigamePlan) {
    this.chaserTeam = plan.format === '1v3' ? plan.soloTeam : 0;
    this.runners = plan.teams.filter((t) => t !== this.chaserTeam).length;
  }
  isChaser(i: number) {
    return this.plan.teams[i] === this.chaserTeam;
  }
  update(dt: number) {
    const c = this.ctx;
    this.elapsed += dt;
    c.avatars.forEach((rn, j) => {
      if (!this.isChaser(j) && rn.frozenUntil > c.now) this.frozenMs += dt;
    });
    c.avatars.forEach((ch, i) => {
      if (!this.isChaser(i) || ch.isStunned(c.now)) return;
      c.avatars.forEach((rn, j) => {
        if (this.isChaser(j) || rn.frozenUntil > c.now || rn.invulnUntil > c.now) return;
        if (overlaps(rn, ch.x, ch.y, 9, 12)) {
          rn.frozenUntil = c.now + 3000;
          rn.invulnUntil = c.now + 4500;
          this.tags++;
          c.popText('TAGGED', rn.x, rn.y - 14, '#80d0ff');
          c.sfx('blip');
        }
      });
    });
  }
  private ratio() {
    return Math.min(1, this.tags / Math.max(1, this.runners * 2.5));
  }
  scores() {
    return this.plan.teams.map((_, i) => (this.isChaser(i) ? 10 * this.ratio() : 10 * (1 - this.ratio())));
  }
  /** Share of runner-time spent frozen. */
  frozenShare() {
    return this.frozenMs / Math.max(1, this.elapsed * this.runners);
  }
  /**
   * Runners' survival: the less time runners spend frozen, the better the
   * group did. Bots spend ~20-25% of runner-time frozen, which scores ~0.5;
   * 45% frozen (chasers dominating) scores 0.
   */
  groupScore() {
    return Math.max(0, 1 - this.frozenShare() / 0.45);
  }
  botGoal(i: number): BotGoal {
    const c = this.ctx;
    const me = c.avatars[i];
    if (this.isChaser(i)) {
      const prey = c.avatars.filter((a, j) => !this.isChaser(j) && a.frozenUntil < c.now && a.invulnUntil < c.now);
      const t = nearest(prey, me.x, me.y);
      return t ? { kind: 'goto', x: t.x, y: t.y } : { kind: 'idle' };
    }
    const hunters = c.avatars.filter((_, j) => this.isChaser(j));
    const h = nearest(hunters, me.x, me.y)!;
    return { kind: 'flee', x: h.x, y: h.y };
  }
  hud() {
    return 'Chasers tag runners!';
  }
  destroy() {}
}

export function createGoal(ctx: MGContext, plan: MinigamePlan): GoalSystem {
  switch (plan.goal) {
    case 'survive':
      return new Survive(ctx);
    case 'collect':
      return new Collect(ctx);
    case 'king':
      return new King(ctx, plan);
    case 'race':
      return new Race(ctx);
    case 'potato':
      return new Potato(ctx, plan);
    case 'tag':
      return new Tag(ctx, plan);
  }
}

export const GOAL_SECONDS = MINIGAME_SECONDS;
