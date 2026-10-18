import Phaser from 'phaser';
import { CLIMB_SPEED, GRAVITY, JUMP_V, RUN_SPEED, type Climbable } from './config';
import type { Chute, HouseView } from './houseView';
import { sfx } from './sfx';
import type { VirtualPad } from './input';

/** Avatar frame height and the origin row (7px above the feet). */
const SPR_H = 18;
const SPR_ORIGIN_Y = SPR_H - 7;
/** Speed through a laundry chute (px/s). */
const CHUTE_SPEED = 420;

export interface AvatarMods {
  /** Rooms where gravity is inverted (Gravity Flip hazard). */
  flippedRooms: Set<string>;
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
  /** Riding a laundry chute: the chute and the distance travelled along its pipe. */
  chute: Chute | null = null;
  private chuteD = 0;
  private runFrame = 0;
  private bodyFlipped = false;

  constructor(
    scene: Phaser.Scene,
    public seat: number,
    x: number,
    y: number,
  ) {
    // 16x18 chibi frames. Origin sits 7px above the feet so sprite.y keeps
    // the old meaning (feet - 7) for all callers.
    this.sprite = scene.physics.add.sprite(x, y, `avatar${seat}_idle0`);
    this.sprite.setOrigin(0.5, SPR_ORIGIN_Y / SPR_H);
    this.sprite.setDepth(10);
    this.body = this.sprite.body as Phaser.Physics.Arcade.Body;
    this.body.setSize(8, 13).setOffset(4, SPR_H - 13);
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
    if (now < this.invulnUntil || this.chute) return false;
    this.hits += 1;
    this.stunnedUntil = now + stunMs;
    this.invulnUntil = now + stunMs + 700;
    this.climbing = null;
    this.body.allowGravity = true;
    this.body.setVelocity(knockX, this.flipped ? 120 : -120);
    return true;
  }

  teleport(x: number, y: number) {
    if (this.chute) this.leaveChute();
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
    if (this.flipped !== this.bodyFlipped) {
      // Keep the hitbox on the feet end of the frame when upside down.
      this.bodyFlipped = this.flipped;
      this.body.setOffset(4, this.flipped ? 0 : SPR_H - 13);
    }

    let speed = RUN_SPEED * this.slow;
    if (tags.includes('overgrown')) speed *= 0.65;
    this.slow = 1;

    // Blink while invulnerable/stunned; tint blue while frozen (tag).
    this.sprite.setAlpha(now < this.invulnUntil && Math.floor(now / 80) % 2 === 0 ? 0.35 : 1);
    const frozen = now < this.frozenUntil;
    this.sprite.setTint(0xffffff);

    if (this.chute) {
      this.updateChute(dt);
      return;
    }
    if (this.climbing) {
      this.updateClimb(pad, dt, stunned);
      return;
    }

    // Laundry chutes: step (or land) on an open hatch and you drop in.
    if (!this.flipped && this.body.velocity.y >= 0) {
      for (const c of house.chutes) {
        if (Math.abs(this.x - c.hatchX) < 6 && Math.abs(this.feetY - c.hatchY) < 4) {
          this.enterChute(c);
          return;
        }
      }
    }

    if (stunned) {
      this.body.setVelocityX(this.body.velocity.x * 0.9);
      this.setFrame(frozen ? 'frozen' : Math.floor(now / 140) % 2 ? 'hurt1' : 'hurt0');
      return;
    }

    // Horizontal movement: snappy normally, slippery when wet.
    const target = pad.x * speed;
    const grip = tags.includes('wet') ? 0.04 : this.onGround ? 0.35 : 0.18;
    this.body.setVelocityX(this.body.velocity.x + (target - this.body.velocity.x) * grip);
    if (Math.abs(pad.x) > 0.1) this.sprite.setFlipX(pad.x < 0);

    // Animation by state: ground idle/run, airborne jump/fall.
    if (!this.onGround) {
      const rising = this.flipped ? this.body.velocity.y > 20 : this.body.velocity.y < -20;
      this.setFrame(rising ? 'jump' : 'fall');
    } else if (Math.abs(this.body.velocity.x) > 10) {
      this.runFrame += dt;
      this.setFrame(`run${Math.floor(this.runFrame / 90) % 4}`);
    } else {
      this.runFrame = 0;
      this.setFrame(Math.floor(now / 520) % 2 ? 'idle1' : 'idle0');
    }

    if (pad.jump && this.onGround) {
      const v = JUMP_V;
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
  }

  private enterChute(c: Chute) {
    this.chute = c;
    this.chuteD = 0;
    this.climbing = null;
    this.body.setVelocity(0, 0);
    // The body sits out the ride: no gravity, no collisions, no overlaps.
    this.body.enable = false;
    this.sprite.setAlpha(1).setScale(0.55).setDepth(-13);
    this.setFrame('fall');
    sfx('step');
  }

  /** Slide the shrunken, spinning avatar along the pipe (over the pipe art, under lamps and stairs). */
  private updateChute(dt: number) {
    const path = this.chute!.path;
    this.chuteD += (CHUTE_SPEED * dt) / 1000;
    let d = this.chuteD;
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1];
      const [bx, by] = path[i];
      const len = Math.hypot(bx - ax, by - ay);
      if (d <= len) {
        const t = d / len;
        this.sprite.setPosition(ax + (bx - ax) * t, ay + (by - ay) * t);
        this.sprite.setAngle(this.sprite.angle + dt * 1.2);
        return;
      }
      d -= len;
    }
    this.exitChute();
  }

  /** Pop out of the mouth with a little bounce. */
  private exitChute() {
    const [mx, my] = this.chute!.path[this.chute!.path.length - 1];
    const scene = this.sprite.scene;
    this.leaveChute();
    this.body.reset(mx, my + 6);
    this.body.setVelocity(this.sprite.flipX ? -50 : 50, -95);
    this.sprite.setScale(1.35, 0.65);
    scene.tweens.add({ targets: this.sprite, scaleX: 1, scaleY: 1, duration: 220, ease: 'Back.easeOut' });
    for (let i = 0; i < 5; i++) {
      const puff = scene.add.image(mx, my + 1, 'spark').setDepth(11).setAlpha(0.9);
      scene.tweens.add({
        targets: puff,
        x: mx + (i - 2) * 7,
        y: my + 4 + Math.abs(i - 2) * 2,
        alpha: 0,
        scale: 0.4,
        duration: 320,
        onComplete: () => puff.destroy(),
      });
    }
    sfx('whoosh');
  }

  private leaveChute() {
    this.chute = null;
    this.body.enable = true;
    this.body.allowGravity = true;
    this.sprite.setScale(1).setAngle(0).setDepth(10);
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
    this.setFrame(Math.floor(this.climbT * 12) % 2 ? 'climb1' : 'climb0');
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

  private setFrame(name: string) {
    const key = `avatar${this.seat}_${name}`;
    if (this.sprite.texture.key !== key) this.sprite.setTexture(key);
  }

  destroy() {
    this.sprite.destroy();
  }
}
