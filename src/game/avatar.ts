import Phaser from 'phaser';
import { CLIMB_SPEED, GRAVITY, JUMP_V, RUN_SPEED, SPRING_JUMP_V, type Climbable } from './config';
import type { HouseView } from './houseView';
import type { VirtualPad } from './input';

export interface AvatarMods {
  /** Rooms where gravity is inverted (Gravity Flip hazard). */
  flippedRooms: Set<string>;
  speedMul: number;
  springBoots: boolean;
}

export class Avatar {
  sprite: Phaser.Physics.Arcade.Sprite;
  body: Phaser.Physics.Arcade.Body;
  climbing: Climbable | null = null;
  climbT = 0;
  stunnedUntil = 0;
  invulnUntil = 0;
  frozenUntil = 0;
  hits = 0;
  slow = 1; // per-frame slow from hazards (reset each frame)
  room: string | undefined;
  flipped = false;
  private ventCooldown = 0;
  private runFrame = 0;

  constructor(
    scene: Phaser.Scene,
    public seat: number,
    x: number,
    y: number,
  ) {
    this.sprite = scene.physics.add.sprite(x, y, `avatar${seat}`);
    this.sprite.setDepth(10);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(8, 13).setOffset(1, 1);
    this.body.setMaxVelocity(400, 420);
  }

  get x() {
    return this.sprite.x;
  }
  get y() {
    return this.sprite.y;
  }
  get feetY() {
    return this.flipped ? this.body.top : this.body.bottom;
  }
  get onGround() {
    return this.flipped ? this.body.blocked.up : this.body.blocked.down || this.body.touching.down;
  }

  isStunned(now: number) {
    return now < this.stunnedUntil || now < this.frozenUntil;
  }

  /** Returns true if the hit landed. */
  hit(now: number, knockX = 0, stunMs = 1100): boolean {
    if (now < this.invulnUntil) return false;
    this.hits += 1;
    this.stunnedUntil = now + stunMs;
    this.invulnUntil = now + stunMs + 700;
    this.climbing = null;
    this.body.allowGravity = true;
    this.body.setVelocity(knockX, this.flipped ? 120 : -120);
    return true;
  }

  teleport(x: number, y: number) {
    this.climbing = null;
    this.body.allowGravity = true;
    this.body.reset(x, y);
  }

  update(pad: VirtualPad, now: number, dt: number, house: HouseView, mods: AvatarMods) {
    this.room = house.roomAt(this.x, this.y)?.id;
    const tags = this.room ? house.tags[this.room] : [];
    const stunned = this.isStunned(now);

    // Gravity per room.
    this.flipped = !!this.room && mods.flippedRooms.has(this.room);
    const lowgrav = tags.includes('lowgrav');
    this.body.setGravityY(this.flipped ? -2 * GRAVITY : lowgrav ? -0.55 * GRAVITY : 0);
    this.sprite.setFlipY(this.flipped);

    let speed = RUN_SPEED * mods.speedMul * this.slow;
    if (tags.includes('overgrown')) speed *= 0.65;
    this.slow = 1;

    // Blink while invulnerable/stunned; tint blue while frozen (tag).
    this.sprite.setAlpha(now < this.invulnUntil && Math.floor(now / 80) % 2 === 0 ? 0.35 : 1);
    this.sprite.setTint(now < this.frozenUntil ? 0x88ccff : 0xffffff);

    if (this.climbing) {
      this.updateClimb(pad, dt, stunned);
      return;
    }

    if (stunned) {
      this.body.setVelocityX(this.body.velocity.x * 0.9);
      this.sprite.setTexture(`avatar${this.seat}`);
      return;
    }

    // Horizontal movement: snappy normally, slippery when wet.
    const target = pad.x * speed;
    const grip = tags.includes('wet') ? 0.04 : this.onGround ? 0.35 : 0.18;
    this.body.setVelocityX(this.body.velocity.x + (target - this.body.velocity.x) * grip);
    if (Math.abs(pad.x) > 0.1) this.sprite.setFlipX(pad.x < 0);

    // Run animation.
    if (Math.abs(this.body.velocity.x) > 10 && this.onGround) {
      this.runFrame += dt;
      this.sprite.setTexture(Math.floor(this.runFrame / 120) % 2 ? `avatar${this.seat}run` : `avatar${this.seat}`);
    } else {
      this.sprite.setTexture(`avatar${this.seat}`);
    }

    if (pad.jump && this.onGround) {
      const v = mods.springBoots ? SPRING_JUMP_V : JUMP_V;
      this.body.setVelocityY(this.flipped ? v : -v);
    }

    // Enter a ladder/stairs.
    const climbHeld = pad.y < -0.5 || pad.y > 0.5;
    if (climbHeld && this.onGround && !this.flipped) {
      for (const c of house.climbables) {
        if (pad.y < -0.5 && Math.abs(this.x - c.x0) < 7 && Math.abs(this.feetY - c.y0) < 5) {
          this.startClimb(c, 0);
          break;
        }
        if (pad.y > 0.5 && Math.abs(this.x - c.x1) < 7 && Math.abs(this.feetY - c.y1) < 5) {
          this.startClimb(c, 1);
          break;
        }
      }
    }

    // Vents: press down while standing on one.
    this.ventCooldown -= dt;
    if (pad.down && this.onGround && this.ventCooldown <= 0) {
      for (const v of house.vents) {
        if (Math.abs(this.x - v.ax) < 8 && Math.abs(this.feetY - v.ay) < 5) {
          this.teleport(v.bx, v.by - 8);
          this.ventCooldown = 500;
          break;
        }
        if (Math.abs(this.x - v.bx) < 8 && Math.abs(this.feetY - v.by) < 5) {
          this.teleport(v.ax, v.ay - 8);
          this.ventCooldown = 500;
          break;
        }
      }
    }
  }

  private startClimb(c: Climbable, t: number) {
    this.climbing = c;
    this.climbT = t;
    this.body.allowGravity = false;
    this.body.setVelocity(0, 0);
    this.placeOnClimb();
  }

  private placeOnClimb() {
    const c = this.climbing!;
    const x = c.x0 + (c.x1 - c.x0) * this.climbT;
    const feet = c.y0 + (c.y1 - c.y0) * this.climbT;
    this.body.reset(x, feet - 7);
  }

  private updateClimb(pad: VirtualPad, dt: number, stunned: boolean) {
    const c = this.climbing!;
    const len = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
    let dir = -pad.y;
    if (c.kind === 'stairs') dir += pad.x * Math.sign(c.x1 - c.x0);
    dir = Math.max(-1, Math.min(1, dir));
    if (!stunned) this.climbT += (dir * CLIMB_SPEED * (dt / 1000)) / len;
    this.sprite.setTexture(Math.floor(this.climbT * 12) % 2 ? `avatar${this.seat}run` : `avatar${this.seat}`);
    if (this.climbT >= 1) {
      this.climbT = 1;
      this.placeOnClimb();
      this.exitClimb();
      return;
    }
    if (this.climbT <= 0) {
      this.climbT = 0;
      this.placeOnClimb();
      this.exitClimb();
      return;
    }
    this.placeOnClimb();
    if (pad.jump) {
      this.exitClimb();
      this.body.setVelocityY(-JUMP_V * 0.6);
    }
  }

  private exitClimb() {
    this.climbing = null;
    this.body.allowGravity = true;
    this.body.setVelocity(0, 0);
  }

  destroy() {
    this.sprite.destroy();
  }
}
