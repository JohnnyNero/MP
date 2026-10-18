import Phaser from 'phaser';

/** Body text: a plain monospace keeps column layouts (padEnd tables) aligned. */
export const FONT = 'monospace';
/** Headings (size >= 10): a chunky pixel font, loaded in index.html, with a monospace fallback. */
export const DISPLAY_FONT = '"Press Start 2P", monospace';

/** Option C "Chunky 16-bit" palette. */
export const C16 = {
  ink: 0x140c1c,
  panel: 0x241a3e,
  panelHi: 0x34285c,
  panelLo: 0x170f28,
  rim: 0x6a58b8,
  rimHi: 0xb8a8f0,
  rimLo: 0x3a2a78,
  gold: 0xffe08a,
  goldDk: 0xc08a2a,
  sky: 0x28307a,
  roof: 0xa8302a,
  lamp: 0xfff0a0,
};
export const INK_CSS = '#140c1c';

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** Linear blend between two colours (t = 0..1). */
export function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither threshold for a pixel, in (0, 1). */
export function bayer(x: number, y: number): number {
  return (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/** Pick a colour from a ramp with ordered dithering between neighbours (t = 0..1). */
export function ditherRamp(ramp: number[], t: number, x: number, y: number): number {
  const f = Math.max(0, Math.min(0.9999, t)) * (ramp.length - 1);
  const i = Math.floor(f);
  return f - i > bayer(x, y) ? ramp[Math.min(ramp.length - 1, i + 1)] : ramp[i];
}

/** A rectangle painter: works for a Canvas2D context or a Phaser Graphics. */
export type Plot = (x: number, y: number, w: number, h: number, color: number, alpha?: number) => void;

export function ctxPlot(ctx: CanvasRenderingContext2D): Plot {
  return (x, y, w, h, c, a = 1) => {
    ctx.globalAlpha = a;
    ctx.fillStyle = hex(c);
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
  };
}

export function gfxPlot(g: Phaser.GameObjects.Graphics): Plot {
  return (x, y, w, h, c, a = 1) => {
    g.fillStyle(c, a);
    g.fillRect(x, y, w, h);
  };
}

/**
 * Draw a pixel map. Each char is a palette key ('.' or ' ' = empty, 'k' = ink).
 * With `outline`, every empty pixel touching a filled one gets that colour.
 */
export function drawPixels(
  plot: Plot,
  map: string[],
  pal: Record<string, number>,
  x: number,
  y: number,
  outline?: number,
  scale = 1,
) {
  const h = map.length;
  const w = map[0].length;
  const filled = (cx: number, cy: number) => cy >= 0 && cy < h && cx >= 0 && cx < w && map[cy][cx] !== '.' && map[cy][cx] !== ' ';
  if (outline !== undefined) {
    for (let cy = -1; cy <= h; cy++) {
      for (let cx = -1; cx <= w; cx++) {
        if (filled(cx, cy)) continue;
        if (filled(cx - 1, cy) || filled(cx + 1, cy) || filled(cx, cy - 1) || filled(cx, cy + 1)) {
          plot(x + cx * scale, y + cy * scale, scale, scale, outline);
        }
      }
    }
  }
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      if (!filled(cx, cy)) continue;
      const ch = map[cy][cx];
      const c = ch === 'k' ? C16.ink : pal[ch];
      if (c !== undefined) plot(x + cx * scale, y + cy * scale, scale, scale, c);
    }
  }
}

/**
 * A chunky bevelled box: ink outline with notched corners, a 1px highlight on
 * the top/left and a shade on the bottom/right.
 */
export function bevelBox(
  plot: Plot,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  hi: number,
  lo: number,
  loDepth = 1,
) {
  plot(x + 1, y, w - 2, 1, C16.ink);
  plot(x + 1, y + h - 1, w - 2, 1, C16.ink);
  plot(x, y + 1, 1, h - 2, C16.ink);
  plot(x + w - 1, y + 1, 1, h - 2, C16.ink);
  plot(x + 1, y + 1, w - 2, h - 2, fill);
  plot(x + 1, y + h - 1 - loDepth, w - 2, loDepth, lo);
  plot(x + w - 2, y + 1, 1, h - 2, lo);
  plot(x + 1, y + 1, w - 3, 1, hi);
  plot(x + 1, y + 1, 1, h - 2 - loDepth, hi);
}

let uid = 0;
/** Draw into a fresh canvas texture and return an Image of it; the texture is freed with the image. */
export function canvasImage(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
  key = `ui-canvas-${++uid}`,
  keep = false,
): Phaser.GameObjects.Image {
  if (!scene.textures.exists(key)) {
    const tex = scene.textures.createCanvas(key, Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)))!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    draw(ctx);
    tex.refresh();
  }
  const img = scene.add.image(x, y, key).setOrigin(0, 0);
  if (!keep) img.once(Phaser.GameObjects.Events.DESTROY, () => scene.textures.exists(key) && scene.textures.remove(key));
  return img;
}

/** Fill a box with a vertical, ordered-dither gradient through `ramp`. */
export function ditherFill(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  ramp: number[],
  alpha = 1,
  tOf: (x: number, y: number) => number = (_x, y) => y / Math.max(1, h - 1),
) {
  if (w <= 0 || h <= 0) return;
  const img = ctx.createImageData(w, h);
  const a = Math.round(alpha * 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = ditherRamp(ramp, tOf(x, y), x + x0, y + y0);
      const i = (y * w + x) * 4;
      img.data[i] = (c >> 16) & 255;
      img.data[i + 1] = (c >> 8) & 255;
      img.data[i + 2] = c & 255;
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, x0, y0);
}

export function text(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  size = 8,
  color = '#ffffff',
  opts: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {},
): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, str, {
      fontFamily: size >= 10 ? DISPLAY_FONT : FONT,
      fontSize: `${size}px`,
      color,
      resolution: 4,
      // A hard 1px ink drop shadow: the 16-bit "printed on a cartridge" look.
      shadow: { offsetX: size >= 10 ? 2 : 1, offsetY: size >= 10 ? 2 : 1, color: INK_CSS, blur: 0, fill: true, stroke: true },
      ...opts,
    })
    .setDepth(90);
}

/** Draw a bevelled 16-bit panel into a canvas (used by panel() and the board). */
export function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha = 0.92, rim = C16.rim) {
  const p = ctxPlot(ctx);
  const rimHi = mix(rim, 0xffffff, 0.5);
  const rimLo = mix(rim, C16.ink, 0.5);
  // Outer ink with notched corners.
  p(x + 2, y, w - 4, 1, C16.ink);
  p(x + 2, y + h - 1, w - 4, 1, C16.ink);
  p(x, y + 2, 1, h - 4, C16.ink);
  p(x + w - 1, y + 2, 1, h - 4, C16.ink);
  p(x + 1, y + 1, 1, 1, C16.ink);
  p(x + w - 2, y + 1, 1, 1, C16.ink);
  p(x + 1, y + h - 2, 1, 1, C16.ink);
  p(x + w - 2, y + h - 2, 1, 1, C16.ink);
  // Rim, 2px, bevelled.
  p(x + 2, y + 1, w - 4, 2, rim);
  p(x + 1, y + 2, 2, h - 4, rim);
  p(x + 2, y + h - 3, w - 4, 2, rim);
  p(x + w - 3, y + 2, 2, h - 4, rim);
  p(x + 2, y + 1, w - 4, 1, rimHi);
  p(x + 1, y + 2, 1, h - 4, rimHi);
  p(x + 2, y + h - 2, w - 4, 1, rimLo);
  p(x + w - 2, y + 2, 1, h - 4, rimLo);
  // Inner ink line.
  p(x + 3, y + 3, w - 6, 1, C16.ink);
  p(x + 3, y + h - 4, w - 6, 1, C16.ink);
  p(x + 3, y + 3, 1, h - 6, C16.ink);
  p(x + w - 4, y + 3, 1, h - 6, C16.ink);
  // Dithered fill: lighter at the top, darker at the bottom.
  ditherFill(ctx, x + 4, y + 4, w - 8, h - 8, [C16.panelHi, C16.panel, C16.panel, C16.panelLo], alpha);
  // Gold rivets.
  for (const [rx, ry] of [
    [x + 1, y + 1],
    [x + w - 3, y + 1],
    [x + 1, y + h - 3],
    [x + w - 3, y + h - 3],
  ]) {
    p(rx, ry, 2, 2, C16.gold);
    p(rx + 1, ry + 1, 1, 1, C16.goldDk);
  }
}

/** A chunky bevelled 16-bit panel with a dithered fill. */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 0.96): Phaser.GameObjects.Image {
  return canvasImage(scene, x, y, w, h, (ctx) => drawPanel(ctx, 0, 0, w, h, alpha)).setDepth(85);
}

/** A pointing-hand cursor (finger to the right). 'c' = cuff in the menu colour. */
const HAND = [
  '...wwwwwww',
  '..wwwwwwws',
  'ccwwwkkkkk',
  'ccwwwwwwk.',
  'ccwwwkkkk.',
  'ccwwwwwk..',
  '..sssss...',
];

/** A vertical option list. Navigation is driven by the caller. */
export class Menu {
  index = 0;
  private items: Phaser.GameObjects.Text[] = [];
  private cursor: Phaser.GameObjects.Graphics;
  private bar: Phaser.GameObjects.Graphics;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private bob?: Phaser.Tweens.Tween;

  constructor(
    scene: Phaser.Scene,
    private x: number,
    y: number,
    private w: number,
    title: string,
    public options: string[],
    color: string,
  ) {
    const rowH = 12;
    const h = 24 + options.length * rowH;
    const col = Phaser.Display.Color.HexStringToColor(color).color;
    this.objs.push(panel(scene, x, y, w, h));
    // Title plate in the player's colour.
    const head = scene.add.graphics().setDepth(90);
    bevelBox(gfxPlot(head), x + 5, y + 5, w - 10, 12, col, mix(col, 0xffffff, 0.45), mix(col, C16.ink, 0.4));
    this.objs.push(head);
    this.objs.push(text(scene, x + 10, y + 7, title, 7, INK_CSS, { shadow: undefined, fontStyle: 'bold' }).setDepth(91));
    this.bar = scene.add.graphics().setDepth(90);
    this.objs.push(this.bar);
    options.forEach((o, i) => {
      const t = text(scene, x + 22, y + 21 + i * rowH, o, 7, '#e8e0f8').setDepth(91);
      this.items.push(t);
      this.objs.push(t);
    });
    this.cursor = scene.add.graphics().setDepth(92);
    drawPixels(gfxPlot(this.cursor), HAND, { w: 0xffffff, s: 0xb8b0d0, c: col }, 0, 0, C16.ink);
    this.objs.push(this.cursor);
    this.cursor.setX(x + 5);
    this.bob = scene.tweens.add({ targets: this.cursor, x: { from: x + 5, to: x + 7 }, duration: 260, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.refresh();
  }

  move(d: number) {
    this.index = (this.index + d + this.options.length) % this.options.length;
    this.refresh();
  }

  private refresh() {
    this.items.forEach((t, i) => t.setColor(i === this.index ? '#ffffff' : '#9a90b8'));
    const t = this.items[this.index];
    this.bar.clear();
    const p = gfxPlot(this.bar);
    const bx = this.x + 18;
    const bw = this.w - 24;
    p(bx, t.y - 2, bw, 11, 0x4a3a8a);
    p(bx, t.y - 2, bw, 1, 0x7a68c8);
    p(bx, t.y + 8, bw, 1, 0x2a1e58);
    this.cursor.setY(t.y - 1);
  }

  destroy() {
    this.bob?.remove();
    for (const o of this.objs) o.destroy();
  }
}
