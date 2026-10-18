import Phaser from 'phaser';
import { PLAYER_COLORS, ZOOM } from '../config';
import { inputHub } from '../input';
import { sfx } from '../sfx';
import { bayer, bevelBox, C16, canvasImage, ctxPlot, ditherFill, gfxPlot, hex, INK_CSS, mix, panel, text } from '../ui';
import type { GameSceneData, SeatConfig } from './GameScene';

const DIFFICULTY = ['Easy', 'Normal', 'Hard', 'Expert'];
const BOT_NAMES = ['Rex', 'Pip', 'Juno', 'Mo'];

/** Join screen: each controller presses jump to take a seat; bots fill the rest. */
export class TitleScene extends Phaser.Scene {
  private joined: string[] = [];
  private total = 4;
  private difficulty = 1;
  private slotTexts: Phaser.GameObjects.Text[] = [];
  private cards: { card: Phaser.GameObjects.Container; g: Phaser.GameObjects.Graphics; num: Phaser.GameObjects.Text; state: string }[] = [];
  private optText!: Phaser.GameObjects.Text;
  private starting = false;

  constructor() {
    super('title');
  }

  create() {
    this.cameras.main.setZoom(ZOOM).centerOn(240, 135);
    inputHub.attach(this);
    this.joined = [];
    this.slotTexts = [];
    this.cards = [];
    this.starting = false;
    canvasImage(this, 0, 0, 480, 270, drawTitleBackdrop, 'title-bg', true);
    // A few twinkling stars on top of the static sky.
    for (const [x, y, d] of [[60, 22, 0], [118, 58, 400], [356, 16, 800], [452, 78, 200], [30, 96, 600], [300, 50, 1000]]) {
      const st = this.add.graphics();
      const p = gfxPlot(st);
      p(x - 2, y, 5, 1, 0xfff0a0);
      p(x, y - 2, 1, 5, 0xfff0a0);
      p(x, y, 1, 1, 0xffffff);
      this.tweens.add({ targets: st, alpha: 0.15, duration: 700, delay: d, yoyo: true, repeat: -1 });
    }
    // Logo: a red extrusion behind a banded gold face, both with a thick ink outline.
    const logoStyle = { stroke: INK_CSS, strokeThickness: 6, shadow: undefined };
    text(this, 243, 15, 'TABLETOP', 24, '#a8302a', logoStyle).setOrigin(0.5, 0);
    text(this, 242, 14, 'TABLETOP', 24, '#a8302a', logoStyle).setOrigin(0.5, 0);
    const logo = text(this, 240, 12, 'TABLETOP', 24, '#ffd040', logoStyle).setOrigin(0.5, 0);
    const grd = logo.context.createLinearGradient(0, 0, 0, logo.height);
    for (const [at, col] of [
      [0, '#fff8d0'],
      [0.42, '#fff8d0'],
      [0.42, '#ffd040'],
      [0.68, '#ffd040'],
      [0.68, '#f08a2a'],
      [1, '#f08a2a'],
    ] as const)
      grd.addColorStop(at, col);
    logo.setFill(grd);
    // Tagline on a little ribbon.
    const rib = this.add.graphics().setDepth(89);
    const rp = gfxPlot(rib);
    rp(138, 44, 204, 12, C16.ink);
    rp(139, 45, 202, 10, 0x6a58b8);
    rp(139, 45, 202, 1, 0xb8a8f0);
    rp(139, 54, 202, 1, 0x3a2a78);
    for (const sx of [130, 342]) {
      rp(sx, 47, 8, 10, C16.ink);
      rp(sx + 1, 48, 6, 8, 0x4a3a8a);
    }
    text(this, 240, 46, 'a cursed board game for 2-4 players', 8, '#ffffff').setOrigin(0.5, 0);

    // Seat cartridges.
    for (let i = 0; i < 4; i++) {
      const cx = 80 + i * 107;
      const card = this.add.container(cx, 150).setDepth(88);
      const g = this.add.graphics();
      const num = text(this, -43, -8, `P${i + 1}`, 10, '#ffffff');
      const st = text(this, -19, -8, '', 8, '#ffffff');
      card.add([g, num, st]);
      this.cards.push({ card, g, num, state: '' });
      this.slotTexts.push(st);
    }

    panel(this, 30, 174, 420, 92);
    this.optText = text(this, 240, 180, '', 8, hex(C16.gold)).setOrigin(0.5, 0);
    this.add.graphics().setDepth(90).fillStyle(0x3a2a78, 1).fillRect(40, 192, 400, 1).fillStyle(0x5a4a9a, 1).fillRect(40, 193, 400, 1);
    const touch = inputHub.sources.has('touch');
    const help = touch
      ? [
          'Tap JUMP to join. Tap JUMP again to start. Empty seats are bots.',
          'Stick left/right = players, up/down = bot skill.',
          'Drag on the left half to move. Tap menu rows to pick.',
          'Stick up/down on ladders and stairs, down on vents.',
          'First game shows tips; BACK skips them.',
        ]
      : [
          'JOIN: press jump.  Gamepad: A jump, X action, B back.',
          'Keys P1: WASD, F jump, G action, Q back.  P2: arrows, K/L/J.',
          'Up/down climbs ladders and stairs; down on a vent crawls in.',
          'P1: left/right = players, up/down = bot skill, jump = START.',
          'Enter = start now (no humans: watch bots).  Esc = quit to title.',
        ];
    text(this, 42, 197, help.join('\n'), 8, '#c8bce8', { lineSpacing: 2 });
    this.refresh();

    const params = new URLSearchParams(location.search);
    if (params.get('demo') === '1') this.time.delayedCall(200, () => this.start());
    this.input.keyboard!.on('keydown-ENTER', (e: KeyboardEvent) => {
      if (!e.repeat) this.start();
    });
  }

  private refresh() {
    for (let i = 0; i < 4; i++) {
      let label: string;
      if (i < this.joined.length) label = `P${i + 1}  ${this.joined[i] === 'touch' ? 'Touch' : this.joined[i].startsWith('kb') ? 'Keyboard' : 'Gamepad'}`;
      else if (i < Math.max(this.total, this.joined.length)) label = `P${i + 1}  Bot (${DIFFICULTY[this.difficulty]})`;
      else label = `P${i + 1}  -- empty --`;
      this.slotTexts[i].setText(label.slice(4));
      this.styleCard(i, i < this.joined.length ? 'human' : i < Math.max(this.total, this.joined.length) ? 'bot' : 'empty');
    }
    this.optText.setText(`Players: < ${Math.max(this.total, this.joined.length, 2)} >     Bot skill: ${DIFFICULTY[this.difficulty]}`);
  }

  /** Draw seat i as a game cartridge: grey shell, label in the player's colour. */
  private styleCard(i: number, state: 'human' | 'bot' | 'empty') {
    const c = this.cards[i];
    if (c.state === state) return;
    const was = c.state;
    c.state = state;
    const col = PLAYER_COLORS[i];
    const g = c.g.clear();
    const p = gfxPlot(g);
    const x = -50;
    const y = -19;
    const w = 100;
    const h = 38;
    p(x + 2, y + 3, w, h, C16.ink, 0.5);
    const shell = state === 'empty' ? 0x4a4660 : 0x9a98b8;
    bevelBox(p, x, y, w, h, shell, mix(shell, 0xffffff, 0.45), mix(shell, C16.ink, 0.45), 2);
    // Shoulder notches and grip ridges.
    p(x, y, 6, 4, C16.ink);
    p(x + w - 6, y, 6, 4, C16.ink);
    for (let k = 0; k < 5; k++) p(x + 30 + k * 9, y + h - 6, 5, 1, mix(shell, C16.ink, 0.5));
    const label = state === 'human' ? col : state === 'bot' ? mix(col, C16.ink, 0.5) : 0x241a3e;
    bevelBox(p, x + 4, y + 4, w - 8, 25, label, mix(label, 0xffffff, 0.35), mix(label, C16.ink, 0.4), 1);
    if (state === 'human') {
      // A little "ready" lamp.
      p(x + w - 12, y + 7, 5, 5, C16.ink);
      p(x + w - 11, y + 8, 3, 3, 0x7aff7a);
    }
    c.num.setColor(state === 'empty' ? '#6a6090' : '#ffffff');
    this.slotTexts[i].setColor(state === 'empty' ? '#8a80a8' : '#ffffff');
    c.card.setAlpha(state === 'empty' ? 0.75 : 1);
    if (was && state === 'human') this.tweens.add({ targets: c.card, scale: { from: 1.15, to: 1 }, duration: 220, ease: 'Back.easeOut' });
  }

  update() {
    inputHub.poll();
    for (const [id, src] of inputHub.sources) {
      const pad = src.pad;
      const seat = this.joined.indexOf(id);
      if (seat === -1) {
        if (pad.jump && this.joined.length < 4) {
          this.joined.push(id);
          this.total = Math.max(this.total, this.joined.length);
          sfx('select');
          this.refresh();
        }
        continue;
      }
      if (seat === 0) {
        if (pad.left) this.total = Math.max(2, Math.max(this.joined.length, this.total - 1));
        if (pad.right) this.total = Math.min(4, this.total + 1);
        if (pad.up) this.difficulty = Math.min(3, this.difficulty + 1);
        if (pad.down) this.difficulty = Math.max(0, this.difficulty - 1);
        if (pad.left || pad.right || pad.up || pad.down) {
          sfx('blip');
          this.refresh();
        }
        if (pad.jump) this.start();
      }
      if (pad.back && seat === this.joined.length - 1) {
        this.joined.pop();
        this.refresh();
      }
    }
  }

  private start() {
    if (this.starting) return;
    this.starting = true;
    const n = Math.max(2, this.total, this.joined.length);
    const seats: SeatConfig[] = Array.from({ length: n }, (_, i) =>
      i < this.joined.length
        ? { name: `P${i + 1}`, isBot: false, difficulty: 1, source: this.joined[i] }
        : { name: BOT_NAMES[i], isBot: true, difficulty: this.difficulty, source: null },
    );
    const params = new URLSearchParams(location.search);
    const seed = Number(params.get('seed')) || (Date.now() & 0x7fffffff);
    const data: GameSceneData = { seats, seed };
    sfx('win');
    this.scene.start('game', data);
  }
}

/** Night sky, moon, the house and the tabletop it stands on (drawn once). */
function drawTitleBackdrop(ctx: CanvasRenderingContext2D) {
  const p = ctxPlot(ctx);
  ditherFill(ctx, 0, 0, 480, 132, [0x0e0a2a, 0x161650, 0x28307a, 0x3a3a90, 0x6a4aa0], 1);
  // Stars (a fixed scatter).
  let r = 7;
  const rnd = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 0; k < 70; k++) {
    const x = Math.floor(rnd() * 480);
    const y = Math.floor(rnd() * 110);
    p(x, y, 1, 1, rnd() < 0.3 ? 0xfff0a0 : 0xb8b8f0);
  }
  // Moon, with a dithered shade.
  for (let y = -15; y <= 15; y++)
    for (let x = -15; x <= 15; x++) {
      const d = x * x + y * y;
      if (d > 15 * 15) continue;
      const shade = (x + y + 15) / 40 > bayer(x + 420, y + 34) ? 0xe8c870 : C16.lamp;
      p(420 + x, 34 + y, 1, 1, d > 13.5 * 13.5 ? 0xffffff : shade);
    }
  p(412, 28, 4, 3, 0xe8c870);
  p(424, 40, 3, 3, 0xe8c870);

  // Distant hills.
  for (let x = 0; x < 480; x++) {
    const hgt = Math.round(10 + 6 * Math.sin(x / 37) + 4 * Math.sin(x / 13 + 1));
    p(x, 124 - hgt, 1, hgt + 8, 0x1a2a4a);
    p(x, 124 - hgt, 1, 1, 0x2a4a6a);
  }

  // The house.
  const ink = C16.ink;
  const wall = 0x6a58b8;
  const bx = 176;
  const bw = 128;
  const top = 82;
  const ground = 128;
  p(bx + 96, 54, 12, 22, ink); // chimney
  p(bx + 97, 55, 10, 21, 0x8a3a2a);
  p(bx + 97, 55, 10, 2, 0xc85a3a);
  // Stepped roof.
  for (let k = 0; k < 14; k++) {
    const y = 60 + k * 2;
    const half = 10 + k * 6;
    p(240 - half - 1, y - 1, half * 2 + 2, 3, ink);
  }
  for (let k = 0; k < 14; k++) {
    const y = 60 + k * 2;
    const half = 9 + k * 6;
    p(240 - half, y, half * 2, 2, k % 3 === 0 ? 0xd04a3a : C16.roof);
  }
  p(bx - 8, top - 2, bw + 16, 3, ink);
  p(bx - 7, top - 1, bw + 14, 1, 0xffe08a);
  // Walls, with a dithered shadow under the eaves.
  p(bx - 1, top, bw + 2, ground - top + 1, ink);
  ditherFill(ctx, bx, top + 1, bw, ground - top - 1, [0x3a2a78, wall, wall, wall], 1, (_x, y) => Math.min(1, y / 10));
  p(bx, ground - 3, bw, 3, 0x3a2a78);
  // Lit windows.
  const win = (x: number, y: number) => {
    p(x - 1, y - 1, 18, 14, ink);
    p(x, y, 16, 12, C16.lamp);
    p(x, y + 6, 16, 6, 0xffc850);
    p(x + 7, y, 2, 12, ink);
    p(x, y + 5, 16, 1, ink);
    p(x - 2, y + 12, 20, 2, 0xffe08a);
  };
  win(bx + 10, top + 7);
  win(bx + 56, top + 7);
  win(bx + 102, top + 7);
  win(bx + 10, top + 27);
  win(bx + 102, top + 27);
  // Door.
  p(bx + 55, top + 22, 18, ground - top - 22, ink);
  p(bx + 56, top + 23, 16, ground - top - 23, 0xa8302a);
  p(bx + 56, top + 23, 16, 1, 0xe8504a);
  p(bx + 68, top + 34, 2, 2, C16.gold);

  // The tabletop the house stands on: dithered wooden planks.
  ditherFill(ctx, 0, 129, 480, 141, [0x7a3a1a, 0x5a2a1a, 0x3a1a14, 0x1e0e14], 1);
  p(0, 128, 480, 1, ink);
  p(0, 129, 480, 1, 0xc07a3a);
  for (let y = 146; y < 270; y += 18) p(0, y, 480, 1, 0x2a120e);
  for (let k = 0; k < 24; k++) p(((k * 97) % 460) + 6, 134 + ((k * 53) % 130), 10 + (k % 3) * 6, 1, 0x8a4a22);
}
