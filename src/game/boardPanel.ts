import Phaser from 'phaser';
import { BLUE_COINS, BOARD, RED_COINS, REPAIR_COST, TOLL_COST } from '../content/board';
import { CARDS } from '../content/cards';
import { roomName } from '../core/house';
import type { GameState, SpaceType } from '../core/types';
import { PLAYER_COLORS } from './config';
import {
  bevelBox,
  C16,
  canvasImage,
  ctxPlot,
  ditherFill,
  drawPixels,
  gfxPlot,
  hex,
  mix,
  type Plot,
  text,
} from './ui';

// ------------------------------------------------------------------ tiles

interface TileLook {
  fill: number;
  icon: string[];
}

const ICON_PAL: Record<string, number> = {
  Y: 0xfff0a0, // gold light
  y: 0xffc830, // gold
  o: 0xc0701a, // gold shade
  w: 0xffffff,
  s: 0xb8b0d0, // silver shade
  G: 0xe8e8f8, // silver light
  g: 0x9898b0, // silver
  N: 0xf8e0b0, // bag light
  n: 0xd8a868, // bag
  m: 0x9a6a38, // bag shade
  r: 0xe8504a,
};

const COIN_PLUS = ['.YYYyy.', 'YYYyyyo', 'YYykyyo', 'Yykkkyo', 'yyykyyo', 'yyyyyoo', '.ooooo.'];
const COIN_MINUS = ['.YYYyy.', 'YYYyyyo', 'YYyyyyo', 'Yykkkyo', 'yyyyyyo', 'yyyyyoo', '.ooooo.'];
const SKULL = ['.wwwww.', 'wwwwwww', 'wkkwkkw', 'wkkwkkw', 'wwwkwws', '.wwwws.', '.wkwks.'];
const BAG = ['..nnn..', '.n...n.', 'NNNNNNm', 'NNNyNNm', 'NNyyyNm', 'NNNyNmm', '.mmmmm.'];
const WRENCH = ['....G.G', '....GGg', '...GGg.', '..GGg..', '.GGg...', 'GGg....', 'Gg.....'];
const DOLLAR = ['..y..', '.yyyy', 'y.y..', '.yyy.', '..y.y', 'yyyy.', '..y..'];
const LOCK = ['.ggg.', 'g...g', 'g...g', 'YYYYY', 'YYkYY', 'yykyy', 'ooooo'];
const ARROW = ['...w...', '...ww..', 'wwwwww.', 'wwwwwww', 'wwwwww.', '...ww..', '...w...'];
const STAR = [
  '....Y....',
  '...YYY...',
  'YYYYYYYYY',
  '.YYYYYYy.',
  '..YYYyy..',
  '.YYy.yyy.',
  '.Yy...yo.',
];

const TILE: Record<SpaceType, TileLook> = {
  start: { fill: 0x2ab0a0, icon: ARROW },
  blue: { fill: 0x3a7ae8, icon: COIN_PLUS },
  red: { fill: 0xd83a3a, icon: COIN_MINUS },
  danger: { fill: 0x8a38c8, icon: SKULL },
  shop: { fill: 0x28b060, icon: BAG },
  repair: { fill: 0xe8862a, icon: WRENCH },
  toll: { fill: 0x7a7a98, icon: DOLLAR },
  gate: { fill: 0x585868, icon: LOCK },
  finish: { fill: 0xf0c030, icon: STAR },
};
const GATE_OPEN: TileLook = { fill: 0x28b060, icon: ARROW };

function half(type: SpaceType) {
  return type === 'start' || type === 'finish' ? 9 : 7;
}

/** A chunky board-game tile with a drop shadow, a bevel and an icon. */
function drawTile(p: Plot, cx: number, cy: number, look: TileLook, s: number, checker = false) {
  const x = cx - s;
  const y = cy - s;
  const w = s * 2 + 1;
  p(x + 1, y + 2, w, w, C16.ink, 0.45); // drop shadow on the board
  bevelBox(p, x, y, w, w, look.fill, mix(look.fill, 0xffffff, 0.45), mix(look.fill, C16.ink, 0.45), 2);
  if (checker) {
    // Finish line: an ink checker on the gold.
    for (let yy = y + 2; yy < y + w - 3; yy += 2)
      for (let xx = x + 2; xx < x + w - 2; xx += 2) if (((xx - x) / 2 + (yy - y) / 2) % 2 === 0) p(xx, yy, 2, 2, 0xc89018);
  }
  const ih = look.icon.length;
  const iw = look.icon[0].length;
  drawPixels(p, look.icon, ICON_PAL, cx - Math.floor(iw / 2), cy - Math.floor(ih / 2) - 1, C16.ink);
}

// ------------------------------------------------------------------- dice

const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [[0, 0], [2, 2]],
  3: [[0, 0], [1, 1], [2, 2]],
  4: [[0, 0], [2, 0], [0, 2], [2, 2]],
  5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
  6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

/**
 * The dice display. Keeps the old Text-like `setText` API: "4" draws a die,
 * "3+5=8" draws two dice and a sum, numbers above 6 draw a counter badge.
 */
export class DiceDisplay {
  private g: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private last = '';

  constructor(scene: Phaser.Scene, root: Phaser.GameObjects.Container, private cx: number, private cy: number) {
    this.g = scene.add.graphics();
    root.add(this.g);
    for (let i = 0; i < 3; i++) {
      const t = text(scene, 0, 0, '', 10, '#ffffff').setOrigin(0.5, 0.5);
      this.labels.push(t);
      root.add(t);
    }
  }

  setText(s: string): this {
    if (s === this.last) return this;
    this.last = s;
    this.g.clear();
    this.labels.forEach((l) => l.setText(''));
    if (!s) return this;
    type Part = { kind: 'die' | 'badge' | 'sum' | 'eq'; v: number };
    const one = (v: number): Part => ({ kind: v >= 1 && v <= 6 ? 'die' : 'badge', v });
    const m = /^(\d+(?:\+\d+)+)=(\d+)$/.exec(s);
    const parts: Part[] = m
      ? [...m[1].split('+').map((v) => one(Number(v))), { kind: 'eq', v: 0 }, { kind: 'sum', v: Number(m[2]) }]
      : [one(Number(s) || 0)];
    const width = (q: Part) => (q.kind === 'die' ? 23 : q.kind === 'eq' ? 8 : 8 + String(q.v).length * 10);
    const total = parts.reduce((a, q) => a + width(q), 0) + 3 * (parts.length - 1);
    let x = Math.round(this.cx - total / 2);
    let li = 0;
    const p = gfxPlot(this.g);
    for (const q of parts) {
      const w = width(q);
      if (q.kind === 'eq') {
        p(x + 1, this.cy - 4, 6, 3, C16.ink);
        p(x + 1, this.cy + 1, 6, 3, C16.ink);
        p(x + 1, this.cy - 4, 6, 2, 0xffffff);
        p(x + 1, this.cy + 1, 6, 2, 0xffffff);
      } else if (q.kind === 'die') {
        this.drawDie(x, this.cy - 12, q.v);
      } else if (li < this.labels.length) {
        this.drawBadge(x, this.cy - 12, w, q.kind === 'sum');
        this.labels[li++]
          .setText(String(q.v))
          .setPosition(x + w / 2 + 1, this.cy)
          .setColor(q.kind === 'sum' ? '#7a3a10' : '#ffffff');
      }
      x += w + 3;
    }
    return this;
  }

  private drawDie(x: number, y: number, v: number) {
    const p = gfxPlot(this.g);
    p(x + 1, y + 2, 23, 23, C16.ink, 0.45);
    bevelBox(p, x, y, 23, 23, 0xf4f0ff, 0xffffff, 0xa898c8, 3);
    for (const [px, py] of PIPS[v]) {
      const col = v === 1 ? 0xd83a3a : C16.ink;
      p(x + 4 + px * 6, y + 4 + py * 5, 3, 3, col);
    }
  }

  private drawBadge(x: number, y: number, w: number, gold: boolean) {
    const p = gfxPlot(this.g);
    p(x + 1, y + 2, w, 23, C16.ink, 0.45);
    if (gold) bevelBox(p, x, y, w, 23, 0xffc830, 0xfff0a0, 0xc0701a, 3);
    else bevelBox(p, x, y, w, 23, 0x6a58b8, 0xb8a8f0, 0x3a2a78, 3);
  }
}

// ------------------------------------------------------------ board layout

const TOKEN_OFF = [
  [-3, -3],
  [3, -3],
  [-3, 3],
  [3, 3],
];

const INFO = { x: 38, y: 63, w: 188, h: 40 };
const LEGEND = { x: 200, y: 151, w: 244, h: 61 };
const LINGER = { x: 20, y: 235, w: 388, h: 26 };
const DICE = { x: 132, y: 119 };

const LEGEND_ITEMS: [SpaceType, string][] = [
  ['start', 'Start'],
  ['blue', `+${BLUE_COINS} coins`],
  ['red', `-${RED_COINS} coins`],
  ['danger', 'Danger card'],
  ['shop', 'Shop'],
  ['repair', `Repair (${REPAIR_COST}+)`],
  ['toll', `Toll: pay ${TOLL_COST}`],
  ['gate', 'Shortcut gate'],
  ['finish', 'Finish!'],
];

function legendPos(i: number): [number, number] {
  return [LEGEND.x + 14 + (i % 3) * 79, LEGEND.y + 21 + Math.floor(i / 3) * 15];
}

/** Bresenham walk with a square brush: crisp, chunky path links. */
function thickLine(p: Plot, x0: number, y0: number, x1: number, y1: number, r: number, c: number) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    p(x - r, y - r, r * 2 + 1, r * 2 + 1, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

function drawBoard(ctx: CanvasRenderingContext2D) {
  const p = ctxPlot(ctx);
  const X0 = 1;
  const Y0 = 13;
  const X1 = 479;
  const Y1 = 269;
  // Felt: a dithered purple-to-green print with a faint diamond lattice.
  const ramp = [0x3a2468, 0x30205a, 0x262a54, 0x1c3a48, 0x1a4a3c];
  ditherFill(ctx, X0, Y0, X1 - X0, Y1 - Y0, ramp, 1, (x, y) => (y + x * 0.15) / (Y1 - Y0 + 70));
  for (let y = Y0; y < Y1; y++) {
    for (let x = X0; x < X1; x++) {
      if ((x + y) & 1) continue;
      if ((x + y) % 32 === 0 || (x - y + 640) % 32 === 0) p(x, y, 1, 1, 0x5a4a8a, 0.35);
    }
  }

  // Cursed emblem in the lower-left loop: a ring and a big faint skull.
  for (let a = 0; a < 360; a += 2) {
    const r = a % 12 < 6 ? 25 : 24;
    const x = Math.round(92 + Math.cos((a * Math.PI) / 180) * r);
    const y = Math.round(181 + Math.sin((a * Math.PI) / 180) * r);
    p(x, y, 1, 1, 0x6a58b8, 0.55);
  }
  drawPixels(p, SKULL, { w: 0x4a3a7a, s: 0x3a2e64 }, 92 - 10, 181 - 12, 0x2a1e48, 3);

  // Carved wooden frame with a gold inlay.
  const wood = 0x7a3a1a;
  p(0, 12, 480, 1, C16.ink);
  p(0, 269, 480, 1, C16.ink);
  p(0, 12, 1, 258, C16.ink);
  p(479, 12, 1, 258, C16.ink);
  p(1, 13, 478, 5, wood);
  p(1, 264, 478, 5, wood);
  p(1, 13, 5, 256, wood);
  p(474, 13, 5, 256, wood);
  p(1, 13, 478, 1, 0xc07a3a);
  p(1, 13, 1, 256, 0xc07a3a);
  p(1, 268, 478, 1, 0x4a2010);
  p(478, 13, 1, 256, 0x4a2010);
  // Carved notches along the wood.
  for (let x = 12; x < 470; x += 8) {
    p(x, 15, 3, 1, 0x4a2010);
    p(x, 266, 3, 1, 0x4a2010);
  }
  for (let y = 22; y < 262; y += 8) {
    p(3, y, 1, 3, 0x4a2010);
    p(476, y, 1, 3, 0x4a2010);
  }
  p(6, 18, 468, 1, C16.ink);
  p(6, 263, 468, 1, C16.ink);
  p(6, 18, 1, 246, C16.ink);
  p(473, 18, 1, 246, C16.ink);
  p(7, 19, 466, 1, C16.gold);
  p(7, 262, 466, 1, C16.goldDk);
  p(7, 19, 1, 244, C16.gold);
  p(472, 19, 1, 244, C16.goldDk);

  // Corner plates with a skull.
  for (const [cx, cy] of [
    [9, 21],
    [457, 21],
    [9, 247],
    [457, 247],
  ]) {
    p(cx - 6, cy - 6, 16, 16, C16.ink);
    bevelBox(p, cx - 5, cy - 5, 14, 14, 0xd8a838, C16.gold, 0x8a5a18, 1);
    drawPixels(p, SKULL, { w: 0xfff8e0, s: 0xc8b890 }, cx - 2, cy - 2, C16.ink);
  }

  // Path links: an ink edge with a bone-coloured track.
  const sp = Object.values(BOARD.spaces);
  for (const pass of [
    [3, C16.ink],
    [2, 0xa07848],
  ] as const) {
    for (const a of sp) for (const n of a.next) thickLine(p, a.x, a.y, BOARD.spaces[n].x, BOARD.spaces[n].y, pass[0], pass[1]);
  }
  for (const a of sp)
    for (const n of a.next) {
      const b = BOARD.spaces[n];
      thickLine(p, a.x, a.y - 1, b.x, b.y - 1, 1, 0xe8cc8c);
    }

  // Tiles.
  for (const s of sp) drawTile(p, s.x, s.y, TILE[s.type], half(s.type), s.type === 'finish');

  // Info, legend and lingering boxes.
  drawInset(p, INFO.x, INFO.y, INFO.w, INFO.h);
  drawInset(p, LEGEND.x, LEGEND.y, LEGEND.w, LEGEND.h);
  drawInset(p, LINGER.x, LINGER.y, LINGER.w, LINGER.h);
  LEGEND_ITEMS.forEach(([type], i) => {
    const [x, y] = legendPos(i);
    drawTile(p, x, y, TILE[type], 6, type === 'finish');
  });
  // A small gold maker's plaque, bottom right.
  bevelBox(p, 412, 237, 36, 22, 0xd8a838, C16.gold, 0x8a5a18, 2);
  drawPixels(p, SKULL, { w: 0xfff8e0, s: 0xc8b890 }, 427, 243, C16.ink);
  for (const rx of [415, 443]) p(rx, 246, 2, 2, 0x8a5a18);
}

/** A sunken slot cut into the board, for text. */
function drawInset(p: Plot, x: number, y: number, w: number, h: number) {
  p(x, y, w, h, C16.ink);
  p(x + 1, y + 1, w - 2, h - 2, 0x120a20, 0.92);
  p(x + 1, y + 1, w - 2, 2, 0x0a0614);
  p(x + 1, y + h - 2, w - 2, 1, 0x5a4a8a);
  p(x + w - 2, y + 1, 1, h - 2, 0x3a2e64);
}

/** The cursed board, drawn over the house while board turns happen. */
export class BoardPanel {
  private root: Phaser.GameObjects.Container;
  private tokens: Phaser.GameObjects.Container[] = [];
  private highlight: Phaser.GameObjects.Graphics;
  private gateGfx: Phaser.GameObjects.Graphics;
  private info: Phaser.GameObjects.Text;
  private lingering: Phaser.GameObjects.Text;
  dice: DiceDisplay;

  constructor(private scene: Phaser.Scene, private state: GameState) {
    const s = scene;
    this.root = s.add.container(0, 0).setDepth(60);
    const bg = canvasImage(s, 0, 0, 480, 270, drawBoard, 'board-static', true);
    this.gateGfx = s.add.graphics();
    this.root.add([bg, this.gateGfx]);
    this.highlight = s.add.graphics();
    this.root.add(this.highlight);
    s.tweens.add({ targets: this.highlight, alpha: 0.35, duration: 320, yoyo: true, repeat: -1 });

    state.players.forEach((p, i) => {
      const tok = s.add.container(0, 0);
      const img = s.add.image(0, 0, `avatar${i}`).setOrigin(0.5, 1);
      img.setScale(Math.min(0.8, 18 / Math.max(1, img.height)));
      const base = s.add.graphics();
      const bp = gfxPlot(base);
      bp(-5, -1, 12, 4, C16.ink, 0.5); // shadow
      bp(-5, -2, 10, 3, C16.ink);
      bp(-4, -3, 8, 1, C16.ink);
      bp(-4, -2, 8, 2, PLAYER_COLORS[i]);
      bp(-3, -2, 5, 1, mix(PLAYER_COLORS[i], 0xffffff, 0.5));
      tok.add([base, img]);
      this.tokens.push(tok);
      this.root.add(tok);
      this.placeToken(i, p.space);
    });

    // Board title, carved in gold.
    this.root.add(text(s, 362, 69, 'TABLETOP', 10, hex(C16.gold)).setOrigin(0.5, 0));
    // Legend.
    this.root.add(text(s, LEGEND.x + 6, LEGEND.y + 3, 'BOARD KEY', 8, hex(C16.gold)));
    LEGEND_ITEMS.forEach(([, label], i) => {
      const [x, y] = legendPos(i);
      this.root.add(text(s, x + 9, y - 6, label, 8, '#d8d0f0'));
    });
    this.info = text(s, INFO.x + 6, INFO.y + 4, '', 8, '#ffffff', { wordWrap: { width: INFO.w - 12 }, lineSpacing: 1 });
    this.lingering = text(s, LINGER.x + 6, LINGER.y + 3, '', 8, '#ffb060', { wordWrap: { width: LINGER.w - 12 }, lineSpacing: 0 });
    this.root.add([this.info, this.lingering]);
    this.dice = new DiceDisplay(s, this.root, DICE.x, DICE.y);
    this.refresh();
    this.root.setVisible(false);
  }

  refresh() {
    this.gateGfx.clear();
    const p = gfxPlot(this.gateGfx);
    for (const sp of Object.values(BOARD.spaces)) {
      if (sp.type === 'gate' && this.state.openGates.includes(sp.id)) drawTile(p, sp.x, sp.y, GATE_OPEN, half(sp.type));
    }
    const eff = this.state.effects.map((e) => `${CARDS[e.card].name} (${e.rooms.map(roomName).join(', ')})`);
    this.lingering.setText(eff.length ? `Lingering in the house: ${eff.join(' · ')}` : 'The house is calm... for now.');
  }

  setInfo(s: string) {
    this.info.setText(s);
  }

  private tokenPos(pid: number, space: string): [number, number] {
    const sp = BOARD.spaces[space];
    const [ox, oy] = TOKEN_OFF[pid];
    return [sp.x + ox, sp.y + oy + 3];
  }

  placeToken(pid: number, space: string) {
    const [x, y] = this.tokenPos(pid, space);
    this.tokens[pid].setPosition(x, y);
  }

  moveToken(pid: number, space: string, ms = 170): Promise<void> {
    const [x, y] = this.tokenPos(pid, space);
    return new Promise((res) => {
      this.scene.tweens.add({
        targets: this.tokens[pid],
        x,
        y,
        duration: ms,
        ease: 'Quad.easeOut',
        onComplete: () => res(),
      });
      this.scene.tweens.add({ targets: this.tokens[pid], scaleY: 0.7, scaleX: 1.15, yoyo: true, duration: ms / 2 });
    });
  }

  showChoices(spaces: string[], pid: number) {
    this.highlight.clear();
    const p = gfxPlot(this.highlight);
    const c = PLAYER_COLORS[pid];
    for (const id of spaces) {
      const sp = BOARD.spaces[id];
      const r = half(sp.type) + 4;
      // Chunky corner brackets.
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const x = sp.x + sx * r;
        const y = sp.y + sy * r;
        const hx = sx < 0 ? x : x - 3;
        const vy = sy < 0 ? y : y - 3;
        p(hx - 1, y - 1, 6, 3, C16.ink);
        p(x - 1, vy - 1, 3, 6, C16.ink);
        p(hx, y, 4, 1, c);
        p(x, vy, 1, 4, c);
      }
    }
  }

  focus(pid: number) {
    this.tokens.forEach((t, i) => t.setAlpha(i === pid ? 1 : 0.6).setDepth(i === pid ? 2 : 1));
    this.root.bringToTop(this.tokens[pid]);
  }

  clearChoices() {
    this.highlight.clear();
  }

  setVisible(v: boolean) {
    this.root.setVisible(v);
    if (v) this.refresh();
  }

  destroy() {
    this.root.destroy();
  }
}
