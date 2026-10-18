import type { Avatar } from './avatar';
import type { HouseView, NavEdge } from './houseView';
import { VirtualPad } from './input';

export interface Danger {
  x: number;
  y: number;
  r: number;
  /** Jump over it rather than run from it. */
  jump?: boolean;
}

export type BotGoal =
  | { kind: 'goto'; x: number; y: number }
  | { kind: 'flee'; x: number; y: number }
  | { kind: 'idle' };

/** Real-time bot: turns a goal into virtual controller input. */
export class BotBrain {
  pad = new VirtualPad();
  private replanAt = 0;
  private route: NavEdge[] | null = null;
  private routeKey = '';
  private lastX = 0;
  private stuckMs = 0;
  private toggle = false;
  private fleeTarget: { x: number; y: number } | null = null;
  private fleeAt = 0;

  constructor(
    public difficulty: number,
    private rnd: () => number,
  ) {}

  update(av: Avatar, goal: BotGoal, house: HouseView, dangers: Danger[], now: number, dt: number) {
    let x = 0;
    let y = 0;
    let jump = false;
    let action = false;
    this.toggle = !this.toggle;

    let target: { x: number; y: number } | null = null;
    /** x of the feature we're heading for (so we don't hop over it). */
    let using: number | null = null;
    if (goal.kind === 'goto') target = goal;
    else if (goal.kind === 'flee') target = this.pickFlee(av, goal, house, now);

    if (av.climbing) {
      const e = this.route?.[0];
      y = e?.kind === 'climbDown' ? 1 : e?.kind === 'climbUp' ? -1 : av.climbT > 0.5 ? -1 : 1;
      if (av.climbing.kind === 'stairs') x = 0;
    } else if (av.ride) {
      // Riding a feature: nothing to steer.
    } else if (target) {
      const cur = av.room;
      const tRoom = house.roomAt(target.x, target.y)?.id;
      if (cur && tRoom && cur !== tRoom) {
        const key = `${cur}>${tRoom}`;
        if (key !== this.routeKey || now > this.replanAt) {
          this.route = house.route(cur, tRoom, av.x);
          this.routeKey = key;
          this.replanAt = now + 600 - this.difficulty * 100;
        }
        const e = this.route?.[0];
        if (e) {
          using = e.x;
          const dx = e.x - av.x;
          const near = Math.abs(dx) <= 2.5;
          if (e.kind === 'door') {
            x = Math.sign(e.x - (house.roomRect(e.from).x0 + house.roomRect(e.from).x1) / 2);
          } else if (e.kind === 'chute' || e.kind === 'slide') {
            // Nudge onto the hatch / lip; stepping on it drops us in.
            x = Math.sign(dx) || (this.toggle ? 1 : -1);
          } else if (!near) {
            x = Math.sign(dx);
          } else if (e.kind === 'climbUp') {
            y = -1;
          } else if (e.kind === 'climbDown' || e.kind === 'pole') {
            y = 1;
          } else if (e.kind === 'drop') {
            x = this.toggle ? 1 : -1;
          } else if (e.kind === 'tramp') {
            // Hop and land on the bed.
            jump = av.onGround;
          } else if (e.kind === 'portal') {
            // Up is edge-triggered: flick the stick.
            y = this.toggle ? -1 : 0;
          } else if (e.kind === 'lift') {
            y = e.dir ?? 0;
            action = this.toggle;
          } else if (e.kind === 'bookcase') {
            action = this.toggle;
          }
        } else {
          x = Math.sign(target.x - av.x);
        }
      } else {
        const dx = target.x - av.x;
        if (Math.abs(dx) > 3) x = Math.sign(dx);
        if (target.y < av.y - 14 && Math.abs(dx) < 28) jump = true;
      }
    }

    // Hop over hatches, slide lips and holes we don't mean to use.
    if (x !== 0 && av.onGround && !av.climbing && !av.ride) {
      for (const p of house.pitfalls) {
        if (p.room !== av.room || (using !== null && Math.abs(using - p.x) < 2)) continue;
        const ahead = (p.x - av.x) * Math.sign(x);
        if (ahead > p.half - 1 && ahead < p.half + 12) {
          jump = true;
          x = Math.sign(x);
        }
      }
    }

    // Dodge dangers on our floor.
    for (const d of dangers) {
      const dx = av.x - d.x;
      const dy = av.y - d.y;
      if (Math.abs(dy) > 40 || Math.abs(dx) > d.r) continue;
      const react = this.rnd() < 0.55 + this.difficulty * 0.15;
      if (!react) continue;
      if (d.jump) jump = true;
      else x = dx >= 0 ? 1 : -1;
    }

    // Unstick: if we want to move but aren't, hop.
    if (x !== 0 && Math.abs(av.x - this.lastX) < 0.2 && !av.climbing) {
      this.stuckMs += dt;
      if (this.stuckMs > 350) {
        jump = true;
        this.stuckMs = 0;
      }
    } else this.stuckMs = 0;
    this.lastX = av.x;

    // Lower difficulties hesitate a little.
    if (this.rnd() < 0.08 * (3 - this.difficulty)) x *= 0.4;

    this.pad.x = x;
    this.pad.y = y;
    this.pad.jumpHeld = jump && !this.pad.jumpHeld;
    this.pad.actionHeld = action;
    this.pad.commit(false);
  }

  private pickFlee(av: Avatar, goal: { x: number; y: number }, house: HouseView, now: number) {
    if (this.fleeTarget && now < this.fleeAt) return this.fleeTarget;
    const threatRoom = house.roomAt(goal.x, goal.y)?.id;
    let best = house.rooms[0];
    let bestScore = -Infinity;
    for (const r of house.rooms) {
      const hops = threatRoom ? (house.route(threatRoom, r.id)?.length ?? 6) : 3;
      const mine = av.room ? (house.route(av.room, r.id)?.length ?? 6) : 0;
      const score = hops * 2 - mine + this.rnd();
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    this.fleeTarget = { x: best.x0 + 20 + this.rnd() * (best.x1 - best.x0 - 40), y: best.bottom - 8 };
    this.fleeAt = now + 1500;
    return this.fleeTarget;
  }
}
