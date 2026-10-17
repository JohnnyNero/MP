import Phaser from 'phaser';

/**
 * A virtual controller. Humans (gamepad or keyboard) and bots all drive the
 * game through this, so every code path is shared.
 */
export class VirtualPad {
  x = 0; // -1..1
  y = 0; // -1..1 (down positive)
  jumpHeld = false;
  actionHeld = false;
  // Edge-triggered, valid for one frame.
  jump = false;
  action = false;
  back = false;
  up = false;
  down = false;
  left = false;
  right = false;
  private prev = { x: 0, y: 0, jump: false, action: false, back: false };

  /** Called once per frame by the owning source after it sets raw state. */
  commit(rawBack: boolean) {
    this.jump = this.jumpHeld && !this.prev.jump;
    this.action = this.actionHeld && !this.prev.action;
    this.back = rawBack && !this.prev.back;
    const dir = (v: number) => (v > 0.5 ? 1 : v < -0.5 ? -1 : 0);
    const cx = dir(this.x);
    const cy = dir(this.y);
    const px = dir(this.prev.x);
    const py = dir(this.prev.y);
    this.left = cx === -1 && px !== -1;
    this.right = cx === 1 && px !== 1;
    this.up = cy === -1 && py !== -1;
    this.down = cy === 1 && py !== 1;
    this.prev = { x: this.x, y: this.y, jump: this.jumpHeld, action: this.actionHeld, back: rawBack };
  }

  /** Confirm in menus = jump or action. */
  get confirm() {
    return this.jump || this.action;
  }
}

export type SourceId = 'kb1' | 'kb2' | `pad${number}`;

export const SOURCE_LABEL: Record<string, string> = {
  kb1: 'Keys WASD  F=jump G=action',
  kb2: 'Keys Arrows  K=jump L=action',
};

export interface InputSource {
  id: SourceId;
  pad: VirtualPad;
  poll(): void;
}

const KB_LAYOUTS = {
  kb1: { left: 'A', right: 'D', up: 'W', down: 'S', jump: 'F', action: 'G', back: 'Q' },
  kb2: { left: 'LEFT', right: 'RIGHT', up: 'UP', down: 'DOWN', jump: 'K', action: 'L', back: 'J' },
} as const;

class KeyboardSource implements InputSource {
  pad = new VirtualPad();
  private keys: Record<string, Phaser.Input.Keyboard.Key>;
  constructor(public id: 'kb1' | 'kb2', kb: Phaser.Input.Keyboard.KeyboardPlugin) {
    const L = KB_LAYOUTS[id];
    this.keys = {} as Record<string, Phaser.Input.Keyboard.Key>;
    for (const [k, code] of Object.entries(L)) this.keys[k] = kb.addKey(code, true, false);
  }
  poll() {
    const k = this.keys;
    this.pad.x = (k.right.isDown ? 1 : 0) - (k.left.isDown ? 1 : 0);
    this.pad.y = (k.down.isDown ? 1 : 0) - (k.up.isDown ? 1 : 0);
    this.pad.jumpHeld = k.jump.isDown;
    this.pad.actionHeld = k.action.isDown;
    this.pad.commit(k.back.isDown);
  }
}

class GamepadSource implements InputSource {
  pad = new VirtualPad();
  id: SourceId;
  constructor(public index: number) {
    this.id = `pad${index}`;
  }
  poll() {
    const gp = navigator.getGamepads?.()[this.index];
    if (!gp) {
      this.pad.x = this.pad.y = 0;
      this.pad.jumpHeld = this.pad.actionHeld = false;
      this.pad.commit(false);
      return;
    }
    const b = (i: number) => !!gp.buttons[i]?.pressed;
    let x = gp.axes[0] ?? 0;
    let y = gp.axes[1] ?? 0;
    if (Math.abs(x) < 0.25) x = 0;
    if (Math.abs(y) < 0.25) y = 0;
    if (b(14)) x = -1;
    if (b(15)) x = 1;
    if (b(12)) y = -1;
    if (b(13)) y = 1;
    this.pad.x = x;
    this.pad.y = y;
    this.pad.jumpHeld = b(0);
    this.pad.actionHeld = b(2) || b(3);
    this.pad.commit(b(1));
  }
}

/** Owns every physical input source and polls them each frame. */
export class InputHub {
  sources = new Map<string, InputSource>();
  private kb?: Phaser.Input.Keyboard.KeyboardPlugin;

  attach(scene: Phaser.Scene) {
    this.kb = scene.input.keyboard!;
    for (const id of ['kb1', 'kb2'] as const) {
      if (!this.sources.has(id)) this.sources.set(id, new KeyboardSource(id, this.kb));
      else {
        // Re-bind keys to the new scene's keyboard plugin.
        this.sources.set(id, new KeyboardSource(id, this.kb));
      }
    }
  }

  poll() {
    const pads = navigator.getGamepads?.() ?? [];
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && !this.sources.has(`pad${i}`)) this.sources.set(`pad${i}`, new GamepadSource(i));
    }
    for (const s of this.sources.values()) s.poll();
  }

  get(id: string): VirtualPad | undefined {
    return this.sources.get(id)?.pad;
  }
}

export const inputHub = new InputHub();
