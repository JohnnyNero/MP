import Phaser from 'phaser';
import { COL_X, DOOR_H, FLOOR_Y, ROOF_Y, ROOM_INNER_H, SLAB, WALL } from '../config';

// Option C "Chunky 16-bit" house art. Everything is drawn into small pixel
// buffers in code and committed as canvas textures; no image files.

// ------------------------------------------------------------------ palette
export const INK = 0x140c1c;
const SKY = 0x28307a;
const SKY_TOP = 0x121640;
const ROOF = 0xa8302a;
const TRIM = 0xffe08a;
const TRIM_D = 0xc89a50;
const FLOOR = 0xe09a3a;
const FLOOR2 = 0xc07a2a;
const SEAM = 0x7a3a1a;
const SLABC = 0x5a2a1a;
const WIN = 0x58b8f8;
const LAMP = 0xfff0a0;
const WOOD = 0xa8744a;
const WOOD_D = 0x7a4a2a;
const PLASTER = 0xe0d0a8;
const CAVITY = 0x1a1028;
const STUD = 0x9a6a3a;
const LATH = 0xb8844a;
const SIDING = 0x2a8a7a;

// ------------------------------------------------------------------ colour helpers
function ch(c: number, s: number) {
  return (c >> s) & 255;
}
export function shade(c: number, f: number): number {
  const k = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return (k(ch(c, 16)) << 16) | (k(ch(c, 8)) << 8) | k(ch(c, 0));
}
export function mix(a: number, b: number, t: number): number {
  const k = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (k(16) << 16) | (k(8) << 8) | k(0);
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** Ordered-dither test: true when a pixel at (x,y) should take the "t" side. */
export function dith(x: number, y: number, t: number) {
  return t > (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

// ------------------------------------------------------------------ deterministic rng
export function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ pixel buffer
/** A small ARGB pixel buffer with chunky-pixel drawing helpers. */
export class Px {
  d: Uint32Array;
  constructor(public w: number, public h: number) {
    this.d = new Uint32Array(w * h);
  }
  set(x: number, y: number, c: number, a = 255) {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = ((a << 24) | (c & 0xffffff)) >>> 0;
  }
  get(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.d[y * this.w + x];
  }
  opaque(x: number, y: number) {
    return this.get(x, y) >>> 24 > 0;
  }
  clear(x: number, y: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = 0;
  }
  rect(x: number, y: number, w: number, h: number, c: number, a = 255) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, a);
  }
  clearRect(x: number, y: number, w: number, h: number) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.clear(xx, yy);
  }
  hline(x: number, y: number, w: number, c: number) {
    this.rect(x, y, w, 1, c);
  }
  vline(x: number, y: number, h: number, c: number) {
    this.rect(x, y, 1, h, c);
  }
  /** Vertical dithered gradient c1 (top) -> c2 (bottom). */
  vgrad(x: number, y: number, w: number, h: number, c1: number, c2: number) {
    for (let yy = 0; yy < h; yy++) {
      const t = h <= 1 ? 1 : yy / (h - 1);
      for (let xx = 0; xx < w; xx++) this.set(x + xx, y + yy, dith(x + xx, y + yy, t) ? c2 : c1);
    }
  }
  /** Chunky outlined box with a highlight and a shade row (Option C look). */
  box(x: number, y: number, w: number, h: number, c: number, outline = true) {
    if (outline) this.rect(x - 1, y - 1, w + 2, h + 2, INK);
    this.rect(x, y, w, h, c);
    this.rect(x, y, w, 1, mix(c, 0xffffff, 0.3));
    if (h > 2) this.rect(x, y + h - 1, w, 1, shade(c, 0.72));
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number) {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  disc(cx: number, cy: number, r: number, c: number) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.set(cx + x, cy + y, c);
  }
  blit(src: Px, dx: number, dy: number) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const v = src.d[y * src.w + x];
        if (v >>> 24) this.set(dx + x, dy + y, v & 0xffffff, v >>> 24);
      }
  }
  /** Outline every opaque pixel's transparent 4-neighbours in ink. */
  outline(c = INK) {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.opaque(x, y)) continue;
        if (this.opaque(x - 1, y) || this.opaque(x + 1, y) || this.opaque(x, y - 1) || this.opaque(x, y + 1)) add.push(x, y);
      }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
  }
  copy() {
    const p = new Px(this.w, this.h);
    p.d.set(this.d);
    return p;
  }
}

/** Commit a pixel buffer as a (re)placed canvas texture. */
export function commit(scene: Phaser.Scene, key: string, p: Px): Phaser.Textures.CanvasTexture {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, p.w, p.h)!;
  const ctx = tex.getContext();
  const img = ctx.createImageData(p.w, p.h);
  for (let i = 0; i < p.d.length; i++) {
    const v = p.d[i];
    const a = v >>> 24;
    if (!a) continue;
    img.data[i * 4] = (v >> 16) & 255;
    img.data[i * 4 + 1] = (v >> 8) & 255;
    img.data[i * 4 + 2] = v & 255;
    img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  tex.refresh();
  return tex;
}

/** Pixel buffers of every house sprite, so they can be baked into the house canvas. */
export const SPRITES = new Map<string, Px>();

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (p: Px) => void, broken = false, upload = true) {
  const p = new Px(w, h);
  draw(p);
  SPRITES.set(key, p);
  if (upload) commit(scene, key, p);
  if (broken) {
    const b = breakPx(p, rng(hashStr(key)));
    SPRITES.set(`${key}-broken`, b);
  }
  return p;
}

/** A wrecked copy of a furniture sprite: one side sags, a chunk is gone, cracks. */
function breakPx(src: Px, r: () => number): Px {
  const p = new Px(src.w, src.h);
  const left = r() < 0.5;
  const sag = 4;
  for (let x = 0; x < src.w; x++) {
    const f = left ? 1 - x / src.w : x / src.w;
    const dy = Math.round(Math.max(0, f - 0.4) * sag * 1.7);
    for (let y = src.h - 1; y >= 0; y--) {
      const v = src.d[y * src.w + x];
      if (v >>> 24) p.set(x, y + dy, v & 0xffffff, v >>> 24);
    }
  }
  // Bite a jagged chunk out of the top corner.
  const cx = left ? src.w - 1 : 0;
  const bw = Math.max(3, Math.round(src.w * 0.22));
  for (let i = 0; i < bw; i++) {
    const depth = Math.round((bw - i) * 0.8 + r() * 2);
    const x = left ? cx - i : cx + i;
    for (let y = 0; y < depth; y++) p.clear(x, y);
  }
  // Cracks.
  for (let k = 0; k < 2; k++) {
    let x = Math.floor(src.w * (0.25 + r() * 0.5));
    let y = Math.floor(src.h * 0.2);
    for (let s = 0; s < src.h * 0.6; s++) {
      if (p.opaque(x, y)) p.set(x, y, INK);
      y++;
      x += r() < 0.33 ? -1 : r() < 0.5 ? 1 : 0;
    }
  }
  // Re-close outlines around the bite.
  p.outline();
  return p;
}

// ------------------------------------------------------------------ room wallpapers
type Pattern = 'stripe' | 'dots' | 'damask' | 'stars' | 'diamond' | 'block' | 'vplank' | 'hplank' | 'floral';
interface Theme {
  base: number;
  pat: Pattern;
  patC: number;
  rail?: boolean;
  skirt?: number;
  wainscot?: { kind: 'tile' | 'panel' | 'hazard'; c: number; h: number };
}

export const ROOM_THEMES: Record<string, Theme> = {
  kitchen: { base: 0xc86a3a, pat: 'diamond', patC: 0xe08a4a, rail: true },
  living: { base: 0x6a58b8, pat: 'stripe', patC: 0x5a4aa0, rail: true, wainscot: { kind: 'panel', c: 0x4a3a8a, h: 22 } },
  garage: { base: 0x6a7a8a, pat: 'block', patC: 0x4a5868, wainscot: { kind: 'hazard', c: 0xf0c030, h: 10 }, skirt: 0x4a5868 },
  bedroom: { base: 0xc85a8a, pat: 'floral', patC: 0xe880a8, rail: true },
  bathroom: { base: 0x3a8ab8, pat: 'dots', patC: 0x68b0d8, rail: true, wainscot: { kind: 'tile', c: 0xe8f4fa, h: 30 } },
  kids: { base: 0x58a848, pat: 'stars', patC: 0xffe08a, rail: true },
  attic: { base: 0x8a5a3a, pat: 'vplank', patC: 0x5a3420, skirt: 0x5a3420 },
  study: { base: 0x2a7a5a, pat: 'damask', patC: 0x3a9a70, rail: true, wainscot: { kind: 'panel', c: 0x6a3a1a, h: 24 } },
  storage: { base: 0x7a6a5a, pat: 'hplank', patC: 0x54463a, skirt: 0x54463a },
};

function pattern(p: Px, t: Theme, w: number, h: number) {
  const c = t.patC;
  const r = rng(hashStr(t.pat));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = false;
      let col = c;
      switch (t.pat) {
        case 'stripe':
          on = x % 10 < 3;
          if (x % 10 === 6 && y % 2 === 0) {
            on = true;
            col = shade(t.base, 1.25);
          }
          break;
        case 'dots':
          on = (y % 6 === 2 && x % 6 === 2) || (y % 6 === 5 && x % 6 === 5);
          break;
        case 'damask': {
          const cx = ((x + (Math.floor(y / 10) % 2) * 5) % 10) - 5;
          const cy = (y % 10) - 5;
          on = Math.abs(cx) + Math.abs(cy) === 3 || (cx === 0 && cy === 0);
          break;
        }
        case 'stars': {
          const ox = (x + (Math.floor(y / 12) % 2) * 6) % 12;
          const oy = y % 12;
          on = (ox === 6 && oy >= 4 && oy <= 8) || (oy === 6 && ox >= 4 && ox <= 8);
          if (on && (ox === 6 && oy === 6)) col = 0xffffff;
          if (!on && ((ox === 1 && oy === 1) || (ox === 10 && oy === 9))) {
            on = true;
            col = shade(t.base, 1.3);
          }
          break;
        }
        case 'diamond':
          on = ((x + y) % 12 === 0 || (x - y + 1200) % 12 === 0) && (x + y) % 2 === 0;
          if ((x + y) % 12 === 6 && (x - y + 1200) % 12 === 6) {
            on = true;
            col = TRIM;
          }
          break;
        case 'block': {
          const row = Math.floor(y / 8);
          const bx = (x + (row % 2) * 8) % 16;
          on = y % 8 === 7 || bx === 15;
          break;
        }
        case 'vplank':
          on = x % 8 === 7;
          if (!on && x % 8 === 0) {
            on = true;
            col = shade(t.base, 1.15);
          }
          break;
        case 'hplank':
          on = y % 7 === 6 || (y % 7 !== 6 && (x + Math.floor(y / 7) * 13) % 31 === 0);
          break;
        case 'floral': {
          const ox = (x + (Math.floor(y / 9) % 2) * 6) % 12;
          const oy = y % 9;
          on = (Math.abs(ox - 6) + Math.abs(oy - 4) === 1);
          if (ox === 6 && oy === 4) {
            on = true;
            col = TRIM;
          }
          break;
        }
      }
      if (on) p.set(x, y, col);
    }
  }
  // Per-block tint for block/plank walls.
  if (t.pat === 'block' || t.pat === 'vplank' || t.pat === 'hplank') {
    for (let k = 0; k < 40; k++) {
      const x = Math.floor(r() * w);
      const y = Math.floor(r() * h);
      p.set(x, y, shade(t.base, 0.85));
      p.set(x + 1, y, shade(t.base, 0.85));
    }
  }
}

function drawWindow(p: Px, x: number, y: number, w: number, h: number, curtain?: number, moon = false) {
  p.rect(x - 2, y - 2, w + 4, h + 4, INK);
  p.rect(x - 1, y - 1, w + 2, h + 2, TRIM);
  p.vgrad(x, y, w, h, 0x2a3a90, WIN);
  // Stars, moon, glints.
  p.set(x + 3, y + 3, 0xffffff);
  p.set(x + w - 4, y + 5, 0xffffff);
  if (moon) p.rect(x + w - 7, y + 2, 3, 3, 0xf0e8b0);
  p.set(x + 2, y + h - 3, 0xc8f0ff);
  // Muntins.
  p.vline(x + (w >> 1), y, h, TRIM);
  p.hline(x, y + (h >> 1), w, TRIM);
  // Sill.
  p.rect(x - 3, y + h + 1, w + 6, 2, TRIM_D);
  p.hline(x - 3, y + h + 3, w + 6, INK);
  if (curtain !== undefined) {
    for (const [cx, dir] of [
      [x - 3, 1],
      [x + w - 2, -1],
    ] as const) {
      for (let yy = y - 3; yy < y + h + 2; yy++) {
        const sway = Math.round(Math.sin(yy / 3) * 0.6);
        for (let k = 0; k < 5; k++) p.set(cx + k + sway * dir, yy, k === 2 ? shade(curtain, 0.8) : curtain);
      }
    }
    p.rect(x - 5, y - 4, w + 10, 2, WOOD_D);
  }
}

function drawRoomWall(id: string, w: number, h: number): Px {
  const t = ROOM_THEMES[id];
  const p = new Px(w, h);
  p.rect(0, 0, w, h, t.base);
  pattern(p, t, w, h);
  // Ceiling shadow, dithered.
  for (let y = 0; y < 10; y++) for (let x = 0; x < w; x++) if (!dith(x, y, y / 10)) p.set(x, y, shade(t.base, 0.55));
  if (t.rail) {
    p.hline(0, 14, w, TRIM);
    p.hline(0, 15, w, TRIM_D);
    p.hline(0, 16, w, shade(t.base, 0.7));
  }
  const ws = t.wainscot;
  if (ws) {
    const y0 = h - 5 - ws.h;
    if (ws.kind === 'tile') {
      for (let y = y0; y < h - 5; y++)
        for (let x = 0; x < w; x++) {
          const grout = (y - y0) % 5 === 0 || x % 5 === 0;
          const chk = (Math.floor(x / 5) + Math.floor((y - y0) / 5)) % 2 === 0;
          p.set(x, y, grout ? 0x9ab8c8 : chk ? ws.c : 0xc8e4f0);
        }
      p.hline(0, y0 - 1, w, 0x2a5a8a);
      p.hline(0, y0 - 2, w, 0x2a5a8a);
      p.hline(0, y0 - 3, w, INK);
    } else if (ws.kind === 'panel') {
      p.rect(0, y0, w, ws.h, ws.c);
      p.hline(0, y0 - 1, w, INK);
      p.hline(0, y0, w, TRIM);
      p.hline(0, y0 + 1, w, TRIM_D);
      for (let x = 4; x + 16 < w; x += 20) {
        p.rect(x, y0 + 5, 16, ws.h - 9, shade(ws.c, 0.82));
        p.hline(x, y0 + 5, 16, shade(ws.c, 0.6));
        p.vline(x, y0 + 5, ws.h - 9, shade(ws.c, 0.6));
        p.hline(x, y0 + ws.h - 5, 16, mix(ws.c, 0xffffff, 0.25));
        p.vline(x + 15, y0 + 5, ws.h - 9, mix(ws.c, 0xffffff, 0.25));
      }
    } else {
      // Hazard stripe band.
      for (let y = h - 5 - ws.h; y < h - 5 - ws.h + 6; y++) for (let x = 0; x < w; x++) p.set(x, y, (x + y) % 8 < 4 ? ws.c : INK);
    }
  }
  // Skirting board.
  const sk = t.skirt ?? TRIM;
  p.hline(0, h - 6, w, INK);
  p.rect(0, h - 5, w, 4, sk);
  p.hline(0, h - 5, w, mix(sk, 0xffffff, 0.35));
  p.hline(0, h - 2, w, shade(sk, 0.7));
  p.hline(0, h - 1, w, shade(sk, 0.5));
  roomSpecifics(id, p, w, h);
  return p;
}

function roomSpecifics(id: string, p: Px, w: number, h: number) {
  switch (id) {
    case 'kitchen': {
      drawWindow(p, 14, 22, 26, 18, 0xe85050, true);
      // Tile backsplash and upper cabinets.
      for (let y = 38; y < h - 24; y++)
        for (let x = 102; x < 142; x++) p.set(x, y, (x % 4 === 0 || y % 4 === 0) ? 0x9ab8b8 : (x + y) % 8 < 4 ? 0xf0f0e0 : 0x8ad0c8);
      for (let x = 102; x < 142; x += 13) {
        p.box(x + 1, 20, 12, 14, 0xd8a060);
        p.rect(x + 3, 22, 8, 10, 0xc08a4a);
        p.set(x + (x % 2 ? 10 : 3), 30, TRIM);
      }
      break;
    }
    case 'garage': {
      drawWindow(p, 18, 20, 34, 10);
      // Pegboard with tools.
      p.box(76, 24, 34, 20, 0xc8a070);
      for (let y = 26; y < 43; y += 3) for (let x = 78; x < 109; x += 3) p.set(x, y, 0x8a6a40);
      p.rect(80, 27, 2, 10, WOOD_D); p.rect(78, 27, 6, 3, 0x8a8a9a); // hammer
      p.rect(88, 28, 2, 12, 0xb0b8c8); p.rect(87, 27, 4, 2, 0xb0b8c8); // wrench
      p.rect(95, 28, 10, 4, 0xc8d0d8); p.rect(103, 28, 3, 8, 0xd04040); // saw
      for (let x = 96; x < 104; x += 2) p.set(x, 32, 0x8a8a9a);
      // Oil stain.
      for (let y = h - 9; y < h - 6; y++) for (let x = 30; x < 58; x++) if (dith(x, y, 0.4)) p.set(x, y, shade(0x6a7a8a, 0.6));
      break;
    }
    case 'bedroom':
      drawWindow(p, 52, 22, 24, 18, 0x6a58b8, true);
      break;
    case 'kids': {
      drawWindow(p, 106, 24, 22, 16, 0xe8504a);
      // Bunting.
      const cols = [0xe8504a, 0xf2c94c, 0x4a8be8, 0xffffff, 0x5cc85a];
      for (let x = 2, i = 0; x < w - 6; x += 8, i++) {
        p.hline(x, 18 + (i % 2), 8, INK);
        for (let k = 0; k < 4; k++) p.rect(x + 1 + k, 19 + k, 6 - 2 * k, 1, cols[i % cols.length]);
      }
      break;
    }
    case 'attic': {
      // Rafters in the top corners, round window, cobwebs.
      for (let i = 0; i < 30; i++) {
        p.rect(i, 30 - i, 5, 1, WOOD_D);
        p.set(i + 5, 30 - i, INK);
        p.rect(w - 5 - i, 30 - i, 5, 1, WOOD_D);
        p.set(w - 6 - i, 30 - i, INK);
      }
      p.disc(76, 30, 11, INK);
      p.disc(76, 30, 10, TRIM_D);
      p.disc(76, 30, 8, 0x2a3a90);
      for (let y = 22; y < 39; y++) for (let x = 68; x < 85; x++) if ((x - 76) ** 2 + (y - 30) ** 2 <= 66 && dith(x, y, (y - 22) / 16)) p.set(x, y, WIN);
      p.vline(76, 22, 17, TRIM_D);
      p.hline(68, 30, 17, TRIM_D);
      p.set(72, 26, 0xffffff);
      for (const [cx, dir] of [
        [0, 1],
        [w - 1, -1],
      ] as const) {
        for (let k = 0; k < 12; k++) {
          p.set(cx + dir * k, 33 + k, 0xc8c8d8);
          p.set(cx + dir * Math.round(k * 0.5), 33 + k, 0xc8c8d8);
        }
        for (let k = 0; k < 8; k++) p.set(cx + dir * k, 38 + Math.round(k * 0.3), 0xc8c8d8);
      }
      break;
    }
    case 'storage':
      drawWindow(p, 118, 24, 14, 12);
      break;
  }
}

/** Behind-the-wallpaper layer: studs and lath over a dark cavity. */
function drawBacking(p: Px, x0: number, y0: number, w: number, h: number, r: () => number) {
  for (let y = y0; y < y0 + h; y++)
    for (let x = x0; x < x0 + w; x++) {
      const sx = ((x % 16) + 16) % 16;
      if (sx < 3) p.set(x, y, sx === 0 ? INK : sx === 1 ? STUD : shade(STUD, 0.7));
      else if (y % 4 === 3) p.set(x, y, CAVITY);
      else p.set(x, y, (Math.floor(x / 23) + Math.floor(y / 4)) % 3 === 0 ? shade(LATH, 0.85) : LATH);
    }
  // Missing lath strips let the night show through.
  for (let k = 0; k < (w * h) / 600; k++) {
    const x = x0 + Math.floor(r() * w);
    const y = y0 + Math.floor(r() * (h / 4)) * 4;
    const len = 4 + Math.floor(r() * 8);
    for (let i = 0; i < len; i++) if (((x + i) % 16) >= 3 && x + i < x0 + w) for (let yy = y; yy < y + 3; yy++) p.set(x + i, yy, CAVITY);
  }
}

// ------------------------------------------------------------------ whole-house chunk layers
export interface HoleSpan {
  x0: number;
  x1: number;
  y: number;
}

const staticHouse = new Map<string, Px>();

function roomBox(col: number, floor: number) {
  const x0 = COL_X[col] + (col === 0 ? 0 : WALL / 2);
  const x1 = COL_X[col + 1] - (col === 2 ? 0 : WALL / 2);
  return { x0, x1, top: FLOOR_Y[floor] - ROOM_INNER_H, bottom: FLOOR_Y[floor] };
}

/** Plank floor + slab face, drawn into p at world coords. */
function drawSlab(p: Px, y: number, x0: number, x1: number, ground: boolean) {
  for (let x = x0; x < x1; x++) {
    const plank = Math.floor((x + (ground ? 5 : 0)) / 13);
    const seam = (x + (ground ? 5 : 0)) % 13 === 0;
    p.set(x, y, mix(plank % 2 ? FLOOR2 : FLOOR, 0xffffff, 0.3));
    p.set(x, y + 1, seam ? SEAM : plank % 2 ? FLOOR2 : FLOOR);
    p.set(x, y + 2, seam ? SEAM : shade(plank % 2 ? FLOOR2 : FLOOR, 0.85));
    p.set(x, y + 3, INK);
    if (ground) {
      for (let yy = y + 4; yy < y + SLAB; yy++) p.set(x, yy, (x + (yy % 2) * 4) % 8 === 0 ? 0x3a3448 : 0x5a5468);
    } else {
      p.set(x, y + 4, dith(x, y + 4, 0.5) ? SLABC : shade(SLABC, 0.8));
      p.set(x, y + 5, x % 16 === 0 ? INK : shade(TRIM_D, 0.7));
    }
  }
}

function buildStatic(): { front: Px; back: Px } {
  const front = new Px(480, 270);
  const back = new Px(480, 270);
  const r = rng(hashStr('house-backing'));
  // Rooms.
  for (let f = 0; f < 3; f++)
    for (let c = 0; c < 3; c++) {
      const b = roomBox(c, f);
      const id = ['kitchen', 'living', 'garage', 'bedroom', 'bathroom', 'kids', 'attic', 'study', 'storage'][f * 3 + c];
      front.blit(drawRoomWall(id, b.x1 - b.x0, b.bottom - b.top), b.x0, b.top);
      drawBacking(back, b.x0, b.top, b.x1 - b.x0, b.bottom - b.top, r);
    }
  // Interior walls (door gaps stay open; door art is separate).
  for (let f = 0; f < 3; f++) {
    const top = FLOOR_Y[f] - ROOM_INNER_H;
    for (const wx of [COL_X[1], COL_X[2]]) {
      const x = wx - WALL / 2;
      const hh = ROOM_INNER_H - DOOR_H;
      for (let y = top; y < top + hh; y++) {
        front.set(x, y, INK);
        front.set(x + 1, y, mix(PLASTER, 0xffffff, 0.2));
        front.set(x + 2, y, PLASTER);
        front.set(x + 3, y, INK);
        back.set(x, y, INK);
        back.set(x + 1, y, STUD);
        back.set(x + 2, y, shade(STUD, 0.7));
        back.set(x + 3, y, INK);
      }
      front.rect(x, top + hh - 1, 4, 1, INK);
    }
  }
  // Floor slabs (full; holes are punched per build).
  for (let f = 0; f < 3; f++) {
    drawSlab(front, FLOOR_Y[f], 4, 476, f === 0);
    for (let y = FLOOR_Y[f]; y < FLOOR_Y[f] + SLAB; y++)
      for (let x = 4; x < 476; x++) back.set(x, y, x % 16 < 3 ? shade(STUD, 0.6) : (y + x) % 2 ? CAVITY : 0x2a1a20);
  }
  // Outer walls: clapboard siding.
  for (const x0 of [0, 472]) {
    for (let y = ROOF_Y; y < FLOOR_Y[0] + SLAB; y++)
      for (let x = x0; x < x0 + 8; x++) {
        const edge = x0 === 0 ? x === 0 : x === 479;
        const inner = x0 === 0 ? x === 7 : x === 472;
        const row = (y - ROOF_Y) % 5;
        front.set(x, y, edge || inner ? INK : row === 4 ? shade(SIDING, 0.6) : row === 0 ? mix(SIDING, 0xffffff, 0.25) : SIDING);
        back.set(x, y, edge || inner ? INK : (y % 16) < 3 ? STUD : CAVITY);
      }
  }
  // Roof: shingled gable, chimney, fascia and the attic ceiling beam.
  const peakY = 3;
  const eaveY = ROOF_Y;
  for (let x = 372; x < 386; x++)
    for (let y = 1; y < 16; y++) {
      const brick = (y % 4 === 0) || ((x + (Math.floor(y / 4) % 2) * 3) % 6 === 0);
      front.set(x, y, x === 372 || x === 385 ? INK : brick ? 0x5a2a2a : 0x9a4a3a);
    }
  front.rect(370, 0, 18, 2, INK);
  front.rect(371, 1, 16, 1, 0x8a8a9a);
  for (let y = peakY; y < eaveY; y++) {
    const hw = Math.round(((y - peakY + 1) / (eaveY - peakY)) * 248);
    const band = Math.floor((y - peakY) / 4);
    for (let x = Math.max(0, 240 - hw); x < Math.min(480, 240 + hw); x++) {
      const off = (band % 2) * 4;
      const tile = Math.floor((x + off) / 8);
      const rowY = (y - peakY) % 4;
      const tc = (tile * 7 + band * 3) % 5 === 0 ? shade(ROOF, 0.85) : (tile + band) % 7 === 0 ? mix(ROOF, 0xffd0a0, 0.25) : ROOF;
      let c = rowY === 3 ? shade(ROOF, 0.55) : (x + off) % 8 === 0 && rowY < 3 ? shade(ROOF, 0.7) : rowY === 0 ? mix(tc, 0xffffff, 0.15) : tc;
      if (x === Math.max(0, 240 - hw) || x === Math.min(480, 240 + hw) - 1) c = INK;
      front.set(x, y, c);
      back.set(x, y, (x % 12) < 2 ? WOOD_D : (y % 3 === 0 ? shade(WOOD, 0.6) : CAVITY));
    }
  }
  front.rect(228, peakY - 1, 24, 2, INK);
  front.rect(230, peakY, 20, 1, shade(ROOF, 0.6));
  for (let x = 0; x < 480; x++) {
    front.set(x, eaveY, INK);
    front.set(x, eaveY + 1, TRIM);
    front.set(x, eaveY + 2, TRIM_D);
    front.set(x, eaveY + 3, INK);
    if (x >= 4 && x < 476) {
      front.set(x, eaveY + 4, x % 16 < 2 ? INK : SLABC);
      front.set(x, eaveY + 5, shade(SLABC, 0.7));
    }
    for (let y = eaveY; y < eaveY + SLAB; y++) back.set(x, y, (x % 16) < 3 ? STUD : CAVITY);
  }
  return { front, back };
}

export const CHUNK = 8;
export const CHUNK_COLS = 60;
export const CHUNK_ROWS = 34;

/** Rotated / flipped nearest-neighbour blit of a sprite, clipped to a rect. */
export function blitSprite(
  dst: Px,
  src: Px,
  ax: number,
  ay: number,
  ox: number,
  oy: number,
  angleDeg: number,
  flip: boolean,
  clip: KeepClear,
) {
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const rad = Math.ceil(Math.hypot(src.w, src.h)) + 1;
  const x0 = Math.max(clip.x, Math.floor(ax - rad));
  const x1 = Math.min(clip.x + clip.w, Math.ceil(ax + rad));
  const y0 = Math.max(clip.y, Math.floor(ay - rad));
  const y1 = Math.min(clip.y + clip.h, Math.ceil(ay + rad));
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - ax;
      const dy = y + 0.5 - ay;
      let sx = Math.floor(dx * ca + dy * sa + ox);
      const sy = Math.floor(-dx * sa + dy * ca + oy);
      if (sx < 0 || sy < 0 || sx >= src.w || sy >= src.h) continue;
      if (flip) sx = src.w - 1 - sx;
      const v = src.d[sy * src.w + sx];
      if (v >>> 24) dst.set(x, y, v & 0xffffff, v >>> 24);
    }
}

/**
 * The whole static house baked into one 480x270 canvas texture ('house-base').
 * Composite per pixel: overlay (decor, damage, plaques) over surface (wallpaper,
 * slabs, siding, roof) over backing (studs, lath, joists) over the night sky.
 * Surface and backing are tracked per 8x8 chunk so they can be knocked out.
 */
export class HouseCanvas {
  front: Px;
  back: Px;
  sky: Px;
  over = new Px(480, 270);
  /** Per chunk: surface / backing still present (1) or broken (0). */
  surface = new Uint8Array(CHUNK_COLS * CHUNK_ROWS);
  backing = new Uint8Array(CHUNK_COLS * CHUNK_ROWS);
  private had = new Uint8Array(CHUNK_COLS * CHUNK_ROWS);
  tex: Phaser.Textures.CanvasTexture;
  private img: ImageData;
  private ctx: CanvasRenderingContext2D;

  constructor(private scene: Phaser.Scene, holes: HoleSpan[], key = 'house-base') {
    if (!staticHouse.has('front')) {
      const st = buildStatic();
      staticHouse.set('front', st.front);
      staticHouse.set('back', st.back);
    }
    this.front = staticHouse.get('front')!.copy();
    this.back = staticHouse.get('back')!.copy();
    this.sky = SPRITES.get('house-sky') ?? new Px(480, 270);
    // Punch meteor holes through the slabs, with splintered plank ends.
    for (const h of holes) {
      this.front.clearRect(h.x0, h.y, h.x1 - h.x0, SLAB);
      this.back.clearRect(h.x0, h.y, h.x1 - h.x0, SLAB);
      for (const [x, dir] of [
        [h.x0 - 1, -1],
        [h.x1, 1],
      ] as const) {
        for (let y = h.y; y < h.y + SLAB; y++) this.front.set(x, y, INK);
        this.front.set(x - dir, h.y + 1, FLOOR);
        this.front.set(x - dir, h.y, INK);
        this.front.set(x - dir * 2, h.y + 2, FLOOR2);
        this.front.set(x - dir, h.y + 2, INK);
      }
    }
    for (let cy = 0; cy < CHUNK_ROWS; cy++)
      for (let cx = 0; cx < CHUNK_COLS; cx++) {
        const i = cy * CHUNK_COLS + cx;
        this.surface[i] = this.cellHas(this.front, cx, cy) ? 1 : 0;
        this.backing[i] = this.cellHas(this.back, cx, cy) ? 1 : 0;
        this.had[i] = this.surface[i] | this.backing[i];
      }
    if (scene.textures.exists(key)) scene.textures.remove(key);
    this.tex = scene.textures.createCanvas(key, 480, 270)!;
    this.ctx = this.tex.getContext();
    this.img = this.ctx.createImageData(480, 270);
  }

  /** Whether chunk i had any structure when the house was built. */
  cellHad(i: number) {
    return !!this.had[i];
  }

  private cellHas(p: Px, cx: number, cy: number) {
    for (let y = cy * CHUNK; y < Math.min(p.h, cy * CHUNK + CHUNK); y++)
      for (let x = cx * CHUNK; x < cx * CHUNK + CHUNK; x++) if (p.opaque(x, y)) return true;
    return false;
  }

  /** Recomposite a region of the canvas and upload it. */
  compose(x0 = 0, y0 = 0, w = 480, h = 270, upload = true) {
    x0 = Math.max(0, Math.floor(x0));
    y0 = Math.max(0, Math.floor(y0));
    const x1 = Math.min(480, Math.ceil(x0 + w));
    const y1 = Math.min(270, Math.ceil(y0 + h));
    if (x1 <= x0 || y1 <= y0) return;
    const D = this.img.data;
    for (let y = y0; y < y1; y++) {
      const crow = (y >> 3) * CHUNK_COLS;
      for (let x = x0; x < x1; x++) {
        const i = y * 480 + x;
        const ci = crow + (x >> 3);
        let base = this.sky.d[i];
        if (this.surface[ci] && this.front.d[i] >>> 24) base = this.front.d[i];
        else if (this.backing[ci] && this.back.d[i] >>> 24) base = this.back.d[i];
        let r = (base >> 16) & 255;
        let g = (base >> 8) & 255;
        let b = base & 255;
        const o = this.over.d[i];
        const oa = o >>> 24;
        if (oa) {
          const t = oa / 255;
          r = Math.round(r + (((o >> 16) & 255) - r) * t);
          g = Math.round(g + (((o >> 8) & 255) - g) * t);
          b = Math.round(b + ((o & 255) - b) * t);
        }
        D[i * 4] = r;
        D[i * 4 + 1] = g;
        D[i * 4 + 2] = b;
        D[i * 4 + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
    if (upload) this.tex.refresh();
  }

  /** Clear overlay pixels in broken chunks inside a region (after restamping it). */
  maskBroken(x0: number, y0: number, w: number, h: number) {
    for (let cy = Math.max(0, y0 >> 3); cy <= Math.min(CHUNK_ROWS - 1, (y0 + h) >> 3); cy++)
      for (let cx = Math.max(0, x0 >> 3); cx <= Math.min(CHUNK_COLS - 1, (x0 + w) >> 3); cx++)
        if (!this.surface[cy * CHUNK_COLS + cx]) this.over.clearRect(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
  }

  /** Snapshot of the composited pixels of one chunk (for a falling fragment). */
  cellPx(cx: number, cy: number): Px {
    const p = new Px(CHUNK, CHUNK);
    const D = this.img.data;
    for (let y = 0; y < CHUNK; y++)
      for (let x = 0; x < CHUNK; x++) {
        const wx = cx * CHUNK + x;
        const wy = cy * CHUNK + y;
        if (wy >= 270) continue;
        const i = (wy * 480 + wx) * 4;
        p.set(x, y, (D[i] << 16) | (D[i + 1] << 8) | D[i + 2]);
      }
    return p;
  }

  /** Remove the top remaining layer of a chunk. Returns which layer broke. */
  breakCell(cx: number, cy: number): 'surface' | 'backing' | null {
    const i = cy * CHUNK_COLS + cx;
    let which: 'surface' | 'backing' | null = null;
    if (this.surface[i]) {
      this.surface[i] = 0;
      this.over.clearRect(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
      which = 'surface';
    } else if (this.backing[i]) {
      this.backing[i] = 0;
      which = 'backing';
    }
    if (which) this.compose(cx * CHUNK, cy * CHUNK, CHUNK, CHUNK);
    return which;
  }

  destroy() {
    if (this.scene.textures.exists(this.tex.key)) this.scene.textures.remove(this.tex.key);
  }
}

// ------------------------------------------------------------------ climbables
export function ladderTexture(scene: Phaser.Scene, h: number): string {
  const key = `house-ladder-${h}`;
  if (scene.textures.exists(key)) return key;
  make(scene, key, 14, h, (p) => {
    for (const x of [1, 10]) {
      p.rect(x - 1, 0, 4, h, INK);
      p.rect(x, 0, 2, h, 0xd8a060);
      p.vline(x + 1, 0, h, 0xa8743a);
    }
    for (let y = 3; y < h - 1; y += 6) {
      p.rect(3, y - 1, 8, 3, INK);
      p.rect(3, y, 8, 1, 0xe8b870);
    }
  });
  return key;
}

/** Staircase rising left-to-right; texture is (w) x (h + 14), top 14px is the banister. */
export function stairsTexture(scene: Phaser.Scene, w: number, h: number): string {
  const key = `house-stairs-${w}x${h}`;
  if (scene.textures.exists(key)) return key;
  const RAIL = 14;
  make(scene, key, w, h + RAIL, (p) => {
    const n = 10;
    const run = w / n;
    const rise = h / n;
    // Stringer underneath (dithered).
    for (let x = 0; x < w; x++) {
      const lineY = RAIL + h - (x / w) * h;
      for (let y = Math.floor(lineY); y < Math.min(RAIL + h, lineY + 12); y++) p.set(x, y, dith(x, y, (y - lineY) / 12) ? shade(WOOD_D, 0.75) : WOOD_D);
      p.set(x, Math.floor(lineY + 12), INK);
    }
    for (let i = 0; i < n; i++) {
      const x = Math.round(i * run);
      const top = Math.round(RAIL + h - (i + 0.5) * rise);
      const tw = Math.round(run) + 1;
      p.rect(x, top - 1, tw + 1, 1, INK);
      p.rect(x, top, tw, 2, 0xe8b060);
      p.rect(x, top + 2, tw, Math.round(rise) - 1, WOOD);
      p.vline(x, top - 1, Math.round(rise) + 2, INK);
      p.hline(x, top + 1, tw, 0xc08a4a);
    }
    // Banister + balusters.
    for (let x = 0; x < w; x++) {
      const ry = Math.round(RAIL + h - (x / w) * h - 13);
      p.set(x, ry - 1, INK);
      p.set(x, ry, 0xd8a060);
      p.set(x, ry + 1, WOOD_D);
      p.set(x, ry + 2, INK);
      if (x % 8 === 4) for (let y = ry + 3; y < ry + 13; y++) p.set(x, y, y % 2 ? TRIM_D : WOOD_D);
    }
    for (const x of [1, w - 3]) {
      const ry = Math.round(RAIL + h - (x / w) * h - 15);
      p.box(x, ry, 2, 16, WOOD);
    }
  });
  return key;
}

// ------------------------------------------------------------------ boot textures
export function makeHouseTextures(scene: Phaser.Scene): void {
  // Night sky with dithered gradient, stars, moon and a strip of lawn.
  make(scene, 'house-sky', 480, 270, (p) => {
    p.vgrad(0, 0, 480, 40, SKY_TOP, SKY);
    p.rect(0, 40, 480, 230, SKY);
    const r = rng(7);
    for (let i = 0; i < 70; i++) p.set(Math.floor(r() * 480), Math.floor(r() * 268), r() < 0.3 ? 0xffffff : 0x8a90d8);
    p.disc(458, 12, 5, 0xf0e8b0);
    p.disc(460, 11, 4, SKY_TOP);
    for (let y = 266; y < 270; y++) for (let x = 0; x < 480; x++) p.set(x, y, dith(x, y, (y - 266) / 4) ? 0x2a5a2a : 0x3a8a3a);
  }, false, false);

  // Doorway: dark gap with jambs and a lintel, separate so it can be blocked later.
  make(scene, 'house-door', 12, DOOR_H + 3, (p) => {
    for (let y = 3; y < DOOR_H + 3; y++) {
      for (let x = 2; x < 10; x++) p.set(x, y, dith(x, y, (y - 3) / DOOR_H) ? 0x2a1a38 : CAVITY);
      p.set(1, y, INK);
      p.set(2, y, TRIM);
      p.set(9, y, TRIM_D);
      p.set(10, y, INK);
    }
    p.rect(0, 0, 12, 4, INK);
    p.rect(1, 1, 10, 2, TRIM);
    p.hline(1, 2, 10, TRIM_D);
  });

  // Lamps and their glows.
  make(scene, 'lamp-pendant', 13, 16, (p) => {
    p.vline(6, 0, 7, INK);
    p.box(3, 7, 7, 2, 0xe8504a);
    p.box(1, 9, 11, 3, 0xe8504a);
    p.rect(4, 12, 5, 2, LAMP);
    p.rect(5, 14, 3, 1, 0xffffff);
    p.outline();
  });
  make(scene, 'lamp-bulb', 7, 14, (p) => {
    p.vline(3, 0, 8, INK);
    p.rect(2, 8, 3, 1, 0x8a8a9a);
    p.disc(3, 11, 2, LAMP);
    p.set(3, 10, 0xffffff);
    p.outline();
  });
  make(scene, 'lamp-glow', 80, 60, (p) => {
    for (let y = 0; y < 60; y++)
      for (let x = 0; x < 80; x++) {
        const d = Math.sqrt(((x - 40) / 40) ** 2 + ((y - 30) / 30) ** 2);
        if (d >= 1) continue;
        const step = d < 0.35 ? 70 : d < 0.65 ? 40 : dith(x, y, (1 - d) * 2.5) ? 20 : 0;
        if (step) p.set(x, y, LAMP, step);
      }
  });
  make(scene, 'board-glow', 64, 36, (p) => {
    for (let y = 0; y < 36; y++)
      for (let x = 0; x < 64; x++) {
        const d = Math.sqrt(((x - 32) / 32) ** 2 + ((y - 18) / 18) ** 2);
        if (d >= 1) continue;
        const a = d < 0.4 ? 90 : d < 0.7 ? 50 : dith(x, y, (1 - d) * 3) ? 25 : 0;
        if (a) p.set(x, y, 0xc070ff, a);
      }
  });

  // The cursed board game on its little table.
  make(scene, 'boardprop', 44, 24, (p) => {
    // Table.
    p.box(2, 11, 40, 3, WOOD);
    p.rect(2, 14, 40, 1, WOOD_D);
    for (const x of [5, 36]) p.box(x, 15, 3, 9, WOOD_D);
    p.box(9, 15, 26, 2, shade(WOOD, 0.85));
    // Board.
    p.box(5, 5, 34, 5, 0x6a2a8a);
    const sq = [0xe8504a, 0x4a8be8, 0xf2c94c, 0x5cc85a];
    for (let i = 0; i < 15; i++) p.set(7 + i * 2, 6, sq[i % 4]);
    for (let i = 0; i < 15; i++) p.set(7 + i * 2, 8, sq[(i + 2) % 4]);
    p.rect(19, 6, 6, 3, 0x2a0a3a);
    p.set(21, 7, 0xff60ff);
    p.set(22, 7, 0xff60ff);
    // Pieces and a die.
    p.box(10, 1, 2, 3, 0xe8504a);
    p.box(31, 2, 2, 2, 0x4a8be8);
    p.box(25, 1, 3, 3, 0xffffff);
    p.set(26, 2, INK);
    // Eerie wisps.
    p.set(16, 2, 0xc070ff);
    p.set(17, 0, 0xc070ff);
    p.set(28, 0, 0xc070ff);
  });

  makeChuteTextures(scene);

  // Overwrite placeholders with the same sizes (crates have fixed footprints).
  make(scene, 'crate', 12, 12, (p) => {
    p.rect(0, 0, 12, 12, INK);
    p.rect(1, 1, 10, 10, 0xc08a4a);
    p.rect(1, 1, 10, 2, 0xe0a860);
    p.rect(1, 9, 10, 2, 0xe0a860);
    p.line(2, 8, 9, 3, WOOD_D);
    p.line(2, 9, 10, 3, WOOD_D);
    p.set(1, 1, 0x8a8a9a);
    p.set(10, 10, 0x8a8a9a);
  });
  make(scene, 'debris', 4, 3, (p) => {
    p.rect(1, 0, 2, 1, INK);
    p.rect(0, 1, 4, 2, INK);
    p.rect(1, 1, 2, 1, 0xb0a890);
    p.set(2, 2, 0x7a7060);
  });
  make(scene, 'vine-hang', 7, 26, (p) => {
    for (let y = 0; y < 26; y++) {
      const x = 3 + Math.round(Math.sin(y / 3) * 1.5);
      p.set(x, y, 0x2e7d32);
      if (y % 5 === 2) {
        p.rect(x - 2, y, 2, 2, 0x66bb6a);
        p.set(x - 2, y + 1, 0x2e7d32);
      }
      if (y % 5 === 4) {
        p.rect(x + 1, y, 2, 2, 0x8ad070);
        p.set(x + 2, y + 1, 0x2e7d32);
      }
    }
  });
  make(scene, 'house-puddle', 16, 5, (p) => {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 16; x++) p.set(x, y, dith(x, y, y / 5) ? 0x2a5ab8 : 0x4a8ae8, 200);
    for (let x = 0; x < 16; x++) if (Math.sin(x / 2.5) > 0.2) p.set(x, 0, 0xc8f0ff);
  });

  makeFurniture(scene);
}

// ------------------------------------------------------------------ laundry chute
/** Metal pipe cross-section, light side (left / top) to shaded side. */
const PIPE = [INK, 0xe8f0f8, 0xb8c0d8, 0x9aa2bc, 0x8a90a8, 0x7a809a, 0x6a7090, 0x52587a, 0x3a3f5a, INK];
const CHUTE_GLOW = 0x8af0ff;
const HAZARD = 0xf2c94c;

/** Draw a tiny sprite from rows of characters (`.` = transparent). */
function rows(p: Px, x0: number, y0: number, art: string[], pal: Record<string, number>) {
  art.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && pal[ch] !== undefined && p.set(x0 + x, y0 + y, pal[ch])));
}

/** 3x5 pixel font, just enough letters for the sign. */
const FONT: Record<string, string[]> = {
  C: ['111', '100', '100', '100', '111'],
  H: ['101', '101', '111', '101', '101'],
  U: ['101', '101', '101', '101', '111'],
  T: ['111', '010', '010', '010', '010'],
  E: ['111', '100', '110', '100', '111'],
};

/** Hatch (with its lid standing open), hazard sign, bobbing arrow and glow. */
function makeChuteTextures(scene: Phaser.Scene) {
  // 22x20; the floor surface is row 14, the slab rows 14..19.
  make(scene, 'chute-hatch', 22, 20, (p) => {
    // Dark shaft going down, a cyan chevron hinting "down".
    for (let y = 14; y < 20; y++) for (let x = 3; x < 15; x++) p.set(x, y, dith(x, y, (y - 14) / 6) ? 0x05030a : CAVITY);
    rows(p, 6, 15, ['k.....k', '.k...k.', '..kgk..', '...k...'], { k: shade(CHUTE_GLOW, 0.55), g: CHUTE_GLOW });
    // Frame posts with hazard stripes, raised 5px above the floor.
    for (const x0 of [0, 15]) {
      for (let y = 9; y < 20; y++)
        for (let x = x0; x < x0 + 3; x++) p.set(x, y, x === x0 || x === x0 + 2 || y === 9 ? INK : (x + y) % 4 < 2 ? HAZARD : INK);
    }
    // Rim across the opening's top edge, lit from inside.
    p.hline(3, 13, 12, INK);
    p.hline(3, 14, 12, shade(CHUTE_GLOW, 0.7));
    // The lid, hinged on the right and leaning open.
    for (let y = 0; y < 12; y++) {
      const x = 18 + (y < 5 ? 1 : 0);
      p.set(x - 1, y, INK);
      p.set(x, y, mix(WOOD, 0xffffff, 0.25));
      p.set(x + 1, y, y < 3 ? HAZARD : WOOD);
      p.set(x + 2, y, INK);
    }
    p.hline(18, 0, 3, INK);
    p.rect(17, 12, 4, 2, 0x8a8a9a);
    p.set(17, 12, INK);
  });

  // Hazard sign with "CHUTE" in a 3x5 pixel font. 25x11.
  make(scene, 'chute-sign', 25, 11, (p) => {
    p.rect(0, 0, 25, 11, INK);
    p.rect(1, 1, 23, 9, HAZARD);
    p.hline(1, 1, 23, mix(HAZARD, 0xffffff, 0.45));
    p.hline(1, 9, 23, shade(HAZARD, 0.7));
    [...'CHUTE'].forEach((ch, i) => FONT[ch].forEach((r, y) => [...r].forEach((b, x) => b === '1' && p.set(3 + i * 4 + x, 3 + y, INK))));
    p.set(2, 2, 0x8a8a9a);
    p.set(22, 2, 0x8a8a9a);
  });

  // Down arrow. 9x8.
  make(scene, 'chute-arrow', 9, 8, (p) => {
    rows(p, 0, 0, ['..kkkkk..', '..kyyyk..', '..kyyyk..', 'kkkyyykkk', '.kyyyyyk.', '..kyyyk..', '...kyk...', '....k....'], {
      k: INK,
      y: HAZARD,
    });
  });

  make(scene, 'chute-glow', 26, 18, (p) => {
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 26; x++) {
        const d = Math.sqrt(((x - 13) / 13) ** 2 + ((y - 9) / 9) ** 2);
        if (d >= 1) continue;
        const a = d < 0.4 ? 80 : d < 0.7 ? 45 : dith(x, y, (1 - d) * 3) ? 20 : 0;
        if (a) p.set(x, y, CHUTE_GLOW, a);
      }
  });
}

/**
 * The chute's pipe as one texture: a funnel under the hatch, straight runs with
 * hazard bands and flow chevrons, chunky elbow collars, and a flared mouth
 * pointing down at the last point. Returns the key and its world top-left.
 */
export function chutePipeTexture(scene: Phaser.Scene, id: string, hatchX: number, path: [number, number][]) {
  const key = `chute-pipe-${id}`;
  const xs = path.map((q) => q[0]);
  const ys = path.map((q) => q[1]);
  const ox = Math.min(...xs, hatchX) - 10;
  const oy = Math.min(...ys) - 2;
  const w = Math.max(...xs, hatchX) + 10 - ox;
  const h = Math.max(...ys) + 4 - oy;
  if (scene.textures.exists(key)) return { key, x: ox, y: oy };
  make(scene, key, w, h, (p) => {
    const at = (x: number, y: number, c: number) => p.set(x - ox, y - oy, c);
    // Funnel from the hatch opening into the pipe.
    const [fx, fy] = path[0];
    const [px, py] = path[1];
    for (let y = fy; y <= py; y++) {
      const t = (y - fy) / Math.max(1, py - fy);
      const l = Math.round(fx - 8 + (px - 5 - (fx - 8)) * t);
      const r = Math.round(fx + 8 + (px + 4 - (fx + 8)) * t);
      for (let x = l; x <= r; x++) at(x, y, PIPE[Math.round(((x - l) / Math.max(1, r - l)) * 9)]);
    }
    // Straight runs (extended into the corners so elbows fill).
    const last = path.length - 1;
    for (let k = 1; k < last; k++) {
      const [ax, ay] = path[k];
      const [bx, by] = path[k + 1];
      const vertical = ax === bx;
      const dir = Math.sign(vertical ? by - ay : bx - ax);
      const a = (vertical ? ay : ax) - (k === 1 ? 0 : 5 * dir);
      const b = (vertical ? by : bx) + (k + 1 === last ? 0 : 5 * dir);
      const len = Math.abs(b - a);
      for (let s = 0; s <= len; s++) {
        const u = a + s * dir;
        for (let i = 0; i < 10; i++) {
          const v = (vertical ? ax : ay) - 5 + i;
          vertical ? at(v, u, PIPE[i]) : at(u, v, PIPE[i]);
        }
        // Hazard bands and flow chevrons.
        if (s > 8 && s < len - 8 && s % 28 === 0) {
          for (let i = -1; i < 11; i++) {
            const v = (vertical ? ax : ay) - 5 + i;
            for (let q = 0; q < 2; q++) {
              const c = i === -1 || i === 10 ? INK : q === 0 ? mix(HAZARD, 0xffffff, 0.35) : shade(HAZARD, 0.8);
              vertical ? at(v, u + q * dir, c) : at(u + q * dir, v, c);
            }
            vertical ? at(v, u - dir, INK) : at(u - dir, v, INK);
            vertical ? at(v, u + 2 * dir, INK) : at(u + 2 * dir, v, INK);
          }
        } else if (s > 8 && s < len - 8 && s % 28 === 14) {
          // A "V" (or ">") pointing along the flow, two pixels thick.
          for (let j = -3; j <= 2; j++) {
            const back = Math.abs(j + 0.5) - 0.5;
            for (let t = 0; t < 2; t++) {
              const along = u - (back + t) * dir;
              const c = t === 0 ? 0xffffff : CHUTE_GLOW;
              vertical ? at(ax + j, along, c) : at(along, ay + j, c);
            }
          }
        }
      }
    }
    // Elbow collars.
    for (let k = 1; k < last; k++) {
      if (k === 1) continue;
      const [cx, cy] = path[k];
      for (let y = cy - 6; y <= cy + 5; y++)
        for (let x = cx - 6; x <= cx + 5; x++) {
          const edge = x === cx - 6 || x === cx + 5 || y === cy - 6 || y === cy + 5;
          const hi = x === cx - 5 || y === cy - 5;
          const lo = x === cx + 4 || y === cy + 4;
          at(x, y, edge ? INK : hi ? 0xc8d0e0 : lo ? 0x52587a : 0x7a809a);
        }
      for (const [dx, dy] of [
        [-4, -4],
        [3, -4],
        [-4, 3],
        [3, 3],
      ])
        at(cx + dx, cy + dy, INK);
    }
    // Flared mouth, pointing down at the last point.
    const [mx, my] = path[last];
    for (let j = 0; j < 8; j++) {
      const y = my - 7 + j;
      const hw = 5 + Math.floor((j * 4) / 7);
      for (let x = mx - hw; x < mx + hw; x++) {
        const i = Math.round(((x - (mx - hw)) / (2 * hw - 1)) * 9);
        at(x, y, j === 7 ? INK : j === 6 ? (i === 0 || i === 9 ? INK : HAZARD) : j === 5 ? (i === 0 || i === 9 ? INK : shade(HAZARD, 0.75)) : PIPE[i]);
      }
    }
  });
  return { key, x: ox, y: oy };
}

// ------------------------------------------------------------------ furniture
function makeFurniture(scene: Phaser.Scene) {
  const F = (key: string, w: number, h: number, draw: (p: Px) => void) => make(scene, key, w, h, draw, true, false);
  const W_ = (key: string, w: number, h: number, draw: (p: Px) => void) => make(scene, key, w, h, draw, false, false);

  F('fridge', 18, 34, (p) => {
    p.box(1, 1, 16, 32, 0xe8ecf8);
    p.rect(13, 2, 3, 30, 0xc0c8dc);
    p.hline(1, 12, 16, INK);
    p.rect(3, 4, 1, 6, 0x8a90a8);
    p.rect(3, 15, 1, 9, 0x8a90a8);
    p.rect(7, 16, 2, 2, 0xe8504a);
    p.rect(10, 19, 2, 2, 0x4a8be8);
    p.rect(6, 22, 4, 3, 0xffffff);
    p.set(8, 5, 0xf2c94c);
  });
  F('counter', 30, 26, (p) => {
    p.box(2, 10, 26, 15, 0xc08a4a);
    p.vline(15, 11, 13, INK);
    p.rect(12, 14, 1, 3, TRIM);
    p.rect(18, 14, 1, 3, TRIM);
    p.box(1, 8, 28, 2, 0xe8e0d0);
    // Pot on the stove.
    p.box(16, 3, 8, 5, 0xe8504a);
    p.hline(15, 3, 10, INK);
    p.rect(19, 1, 2, 1, INK);
    p.box(5, 5, 6, 3, 0x8a8a9a);
  });
  F('couch', 46, 20, (p) => {
    const c = 0xd04a6a;
    p.box(6, 2, 34, 9, mix(c, 0xffffff, 0.12));
    p.box(4, 10, 38, 7, c);
    p.box(1, 6, 6, 12, shade(c, 0.85));
    p.box(39, 6, 6, 12, shade(c, 0.85));
    p.vline(23, 3, 7, shade(c, 0.7));
    p.vline(23, 10, 6, shade(c, 0.7));
    p.box(10, 5, 6, 5, 0xf2c94c);
    p.rect(3, 18, 2, 2, INK);
    p.rect(41, 18, 2, 2, INK);
  });
  F('tv', 24, 26, (p) => {
    p.box(2, 17, 20, 8, WOOD_D);
    p.rect(4, 19, 7, 4, shade(WOOD_D, 0.7));
    p.rect(13, 19, 7, 4, shade(WOOD_D, 0.7));
    p.box(3, 4, 18, 12, 0x5a5a6a);
    p.vgrad(5, 6, 11, 8, 0x58b8f8, 0x2a5ab8);
    p.set(6, 7, 0xffffff);
    p.rect(17, 7, 2, 2, 0xe8504a);
    p.rect(17, 11, 2, 1, INK);
    p.line(8, 3, 5, 0, INK);
    p.line(14, 3, 17, 0, INK);
  });
  F('floorlamp', 12, 42, (p) => {
    p.vline(6, 10, 30, INK);
    p.box(3, 40, 6, 1, INK);
    p.box(2, 2, 8, 8, LAMP);
    p.rect(2, 2, 8, 2, 0xf2c94c);
    p.rect(1, 9, 10, 1, INK);
  });
  W_('rug', 56, 3, (p) => {
    for (let x = 0; x < 56; x++) for (let y = 0; y < 3; y++) p.set(x, y, y === 1 && x % 4 < 2 ? 0xffe08a : (x === 0 || x === 55) ? INK : 0xa83a3a);
  });
  F('car', 62, 28, (p) => {
    const c = 0x2a9a8a;
    p.box(14, 4, 30, 10, c);
    p.rect(17, 6, 11, 7, WIN);
    p.rect(30, 6, 11, 7, WIN);
    p.set(18, 7, 0xffffff);
    p.box(2, 13, 58, 9, c);
    p.hline(2, 16, 58, shade(c, 0.75));
    p.rect(2, 13, 3, 3, 0xe8504a);
    p.rect(56, 14, 4, 3, LAMP);
    p.box(1, 21, 60, 2, 0xb0b8c8);
    for (const x of [13, 47]) {
      p.disc(x, 23, 4, INK);
      p.disc(x, 23, 2, 0x8a90a8);
      p.set(x, 23, 0xffffff);
    }
  });
  F('workbench', 34, 30, (p) => {
    p.box(1, 12, 32, 3, WOOD);
    p.box(3, 15, 3, 14, WOOD_D);
    p.box(28, 15, 3, 14, WOOD_D);
    p.box(6, 24, 22, 2, WOOD_D);
    p.box(4, 5, 10, 6, 0xd04040);
    p.rect(7, 3, 4, 2, INK);
    p.box(24, 7, 4, 4, 0x8a8a9a);
    p.box(9, 20, 5, 4, 0x4a8be8);
    p.box(17, 21, 5, 3, 0xf2c94c);
  });
  F('bed', 46, 20, (p) => {
    p.box(1, 2, 5, 17, WOOD);
    p.rect(2, 2, 3, 2, 0xd8a060);
    p.box(41, 8, 4, 11, WOOD);
    p.box(6, 10, 35, 4, 0xf0f0f8);
    p.box(14, 9, 27, 6, 0x4a8be8);
    for (let x = 16; x < 40; x += 4) p.rect(x, 11, 2, 2, 0x8ac0ff);
    p.box(7, 7, 7, 4, 0xffffff);
    p.box(6, 15, 35, 2, WOOD_D);
  });
  F('wardrobe', 24, 42, (p) => {
    p.box(2, 3, 20, 37, WOOD);
    p.box(1, 1, 22, 2, WOOD_D);
    p.vline(12, 4, 35, INK);
    p.rect(4, 6, 6, 30, shade(WOOD, 0.88));
    p.rect(14, 6, 6, 30, shade(WOOD, 0.88));
    p.rect(10, 20, 1, 3, TRIM);
    p.rect(14, 20, 1, 3, TRIM);
    p.rect(3, 40, 2, 2, INK);
    p.rect(19, 40, 2, 2, INK);
  });
  F('nightstand', 14, 24, (p) => {
    p.box(2, 13, 10, 10, WOOD);
    p.hline(2, 17, 10, INK);
    p.set(7, 15, TRIM);
    p.set(7, 20, TRIM);
    p.vline(7, 6, 7, INK);
    p.box(4, 2, 6, 4, 0xe8a0c8);
    p.box(5, 11, 4, 1, INK);
  });
  F('dresser', 26, 18, (p) => {
    p.box(1, 2, 24, 14, WOOD);
    for (const y of [6, 10]) p.hline(1, y, 24, INK);
    for (const y of [4, 8, 12]) {
      p.set(7, y, TRIM);
      p.set(18, y, TRIM);
    }
    p.rect(2, 16, 2, 2, INK);
    p.rect(22, 16, 2, 2, INK);
    p.box(4, 0, 4, 1, 0x5cc85a);
  });
  F('tub', 40, 20, (p) => {
    p.box(2, 6, 36, 10, 0xf0f0f8);
    p.rect(3, 6, 34, 2, 0x58b8f8);
    p.rect(4, 9, 32, 1, 0xc8d0e0);
    for (const x of [6, 32]) p.box(x, 16, 3, 3, 0xf2c94c);
    p.vline(36, 0, 6, INK);
    p.rect(34, 0, 3, 2, 0xb0b8c8);
    p.box(10, 3, 4, 3, 0xf2c94c);
    p.set(14, 4, 0xe8804a);
    p.set(11, 4, INK);
  });
  F('toilet', 16, 22, (p) => {
    p.box(8, 2, 6, 11, 0xf0f0f8);
    p.box(2, 11, 12, 4, 0xf0f0f8);
    p.box(5, 15, 6, 6, 0xe0e4f0);
    p.rect(9, 4, 3, 1, 0xb0b8c8);
  });
  F('sink', 16, 24, (p) => {
    p.box(1, 7, 14, 4, 0xf0f0f8);
    p.rect(3, 7, 10, 1, 0x58b8f8);
    p.box(6, 11, 4, 12, 0xe0e4f0);
    p.box(7, 3, 2, 3, 0xb0b8c8);
    p.set(10, 4, 0xb0b8c8);
  });
  W_('mirror', 14, 18, (p) => {
    p.box(1, 1, 12, 16, 0xf2c94c);
    p.vgrad(3, 3, 8, 12, 0xc8f0ff, 0x58b8f8);
    p.line(4, 7, 7, 4, 0xffffff);
  });
  W_('towel', 12, 14, (p) => {
    p.box(0, 1, 12, 1, 0xb0b8c8);
    p.box(2, 3, 8, 10, 0xe8504a);
    p.hline(2, 10, 8, 0xffffff);
  });
  F('toys', 28, 14, (p) => {
    p.box(2, 7, 6, 6, 0xe8504a);
    p.set(4, 9, 0xffffff);
    p.box(9, 8, 5, 5, 0x4a8be8);
    p.box(5, 2, 5, 5, 0xf2c94c);
    p.set(7, 4, INK);
    p.disc(20, 9, 4, INK);
    p.disc(20, 9, 3, 0x5cc85a);
    p.rect(19, 7, 3, 1, 0xffffff);
    p.box(25, 10, 2, 3, 0xe880a8);
  });
  F('toybox', 18, 16, (p) => {
    p.box(1, 5, 16, 10, 0x4a8be8);
    p.rect(1, 9, 16, 2, 0xf2c94c);
    p.box(3, 1, 3, 4, 0xe8504a);
    p.line(10, 4, 14, 0, 0x5cc85a);
    p.line(11, 4, 15, 0, 0x5cc85a);
  });
  F('kidbed', 42, 18, (p) => {
    p.box(1, 3, 5, 14, 0xf2c94c);
    p.box(36, 7, 5, 10, 0xf2c94c);
    p.box(6, 9, 30, 4, 0xffffff);
    p.box(12, 8, 24, 6, 0xe8504a);
    for (let x = 14; x < 34; x += 5) p.set(x, 10, 0xffe08a);
    p.box(7, 6, 6, 3, 0xffffff);
    p.box(6, 14, 30, 2, 0x4a8be8);
  });
  W_('poster', 14, 18, (p) => {
    p.box(1, 1, 12, 16, 0x28307a);
    p.box(5, 4, 4, 8, 0xe8e8f0);
    p.set(6, 6, 0x58b8f8);
    p.rect(4, 10, 1, 3, 0xe8504a);
    p.rect(9, 10, 1, 3, 0xe8504a);
    p.rect(6, 13, 2, 2, 0xf2c94c);
    p.set(3, 3, 0xffffff);
    p.set(10, 14, 0xffffff);
  });
  F('rockinghorse', 22, 18, (p) => {
    for (let x = 1; x < 21; x++) p.set(x, 15 + Math.round(((x - 11) / 10) ** 2 * -2), INK);
    for (let x = 2; x < 20; x++) p.set(x, 16 + Math.round(((x - 11) / 10) ** 2 * -2), 0xe8504a);
    p.box(5, 7, 12, 4, 0xf0f0f0);
    p.box(15, 2, 4, 6, 0xf0f0f0);
    p.rect(14, 2, 2, 4, 0xe8504a);
    p.set(17, 3, INK);
    p.vline(6, 11, 4, INK);
    p.vline(15, 11, 4, INK);
    p.rect(4, 7, 2, 3, 0xf2c94c);
  });
  F('trunk', 24, 16, (p) => {
    p.box(2, 2, 20, 4, WOOD);
    p.box(2, 7, 20, 8, WOOD);
    p.rect(2, 6, 20, 1, INK);
    for (const x of [6, 17]) p.vline(x, 2, 13, 0x8a8a9a);
    p.box(11, 5, 2, 3, 0xf2c94c);
  });
  F('desk', 36, 26, (p) => {
    p.box(1, 12, 34, 3, WOOD);
    p.box(3, 15, 10, 10, WOOD_D);
    p.hline(3, 19, 10, INK);
    p.set(8, 17, TRIM);
    p.set(8, 22, TRIM);
    p.box(31, 15, 2, 10, WOOD_D);
    // Old computer and a desk lamp.
    p.box(15, 3, 11, 8, 0xd8d0b8);
    p.rect(17, 5, 7, 4, 0x2a7a5a);
    p.rect(18, 6, 3, 1, 0x8af0a0);
    p.box(14, 11, 13, 1, 0xd8d0b8);
    p.line(5, 11, 7, 5, INK);
    p.box(6, 3, 5, 2, 0x5cc85a);
  });
  F('bookcase', 24, 42, (p) => {
    p.box(1, 1, 22, 40, WOOD_D);
    const cols = [0xe8504a, 0x4a8be8, 0xf2c94c, 0x5cc85a, 0xc070ff, 0xffffff];
    for (let s = 0; s < 4; s++) {
      const y = 3 + s * 10;
      p.rect(3, y, 18, 8, shade(WOOD_D, 0.6));
      for (let x = 3, i = s; x < 20; x += 2, i++) {
        const hh = 5 + ((i * 7) % 3);
        p.rect(x, y + 8 - hh, 2, hh, cols[i % cols.length]);
        p.set(x + 1, y + 8 - hh, INK);
      }
      p.hline(2, y + 8, 20, WOOD);
    }
  });
  F('globe', 12, 18, (p) => {
    p.disc(6, 6, 5, INK);
    p.disc(6, 6, 4, 0x4a8be8);
    p.rect(4, 4, 3, 3, 0x5cc85a);
    p.set(7, 8, 0x5cc85a);
    p.vline(6, 11, 5, WOOD_D);
    p.box(3, 16, 6, 1, WOOD_D);
  });
  F('armchair', 22, 20, (p) => {
    const c = 0x3a8a5a;
    p.box(4, 2, 14, 10, mix(c, 0xffffff, 0.1));
    p.box(2, 10, 18, 6, c);
    p.box(1, 7, 4, 9, shade(c, 0.85));
    p.box(17, 7, 4, 9, shade(c, 0.85));
    p.rect(3, 17, 2, 3, INK);
    p.rect(17, 17, 2, 3, INK);
  });
  F('plant', 12, 20, (p) => {
    p.box(3, 13, 6, 6, 0xc8603a);
    p.hline(2, 13, 8, shade(0xc8603a, 0.7));
    for (const [x, y] of [
      [6, 3],
      [3, 7],
      [9, 6],
      [5, 9],
      [8, 10],
    ])
      p.disc(x, y, 2, 0x3a9a4a);
    p.set(5, 2, 0x8ad070);
    p.set(8, 5, 0x8ad070);
    p.outline();
  });
  F('boxes', 32, 26, (p) => {
    const c = 0xc89a5a;
    p.box(2, 11, 16, 14, c);
    p.box(18, 15, 13, 10, shade(c, 0.9));
    p.box(5, 2, 12, 9, mix(c, 0xffffff, 0.1));
    p.vline(10, 11, 14, 0xe8d8a0);
    p.vline(11, 2, 9, 0xe8d8a0);
    p.vline(24, 15, 10, 0xe8d8a0);
    p.rect(4, 17, 5, 3, 0xffffff);
    p.hline(5, 18, 3, INK);
  });
  F('shelfunit', 24, 36, (p) => {
    for (const x of [1, 21]) p.box(x, 1, 2, 34, 0x8a90a8);
    for (const y of [3, 15, 27]) p.box(1, y, 22, 1, 0xb0b8c8);
    p.box(4, 8, 6, 6, 0xe8504a);
    p.box(12, 9, 7, 5, 0xc89a5a);
    p.box(4, 21, 4, 5, 0x4a8be8);
    p.box(10, 20, 4, 6, 0xf2c94c);
    p.box(15, 22, 5, 4, 0x5cc85a);
    p.box(5, 31, 14, 3, 0xc89a5a);
  });
  W_('frame-land', 18, 14, (p) => {
    p.box(1, 1, 16, 12, 0xf2c94c);
    p.vgrad(3, 3, 12, 8, 0x58b8f8, 0x5cc85a);
    p.rect(7, 4, 3, 3, 0xffe08a);
    p.line(3, 9, 8, 6, 0x2a7a3a);
    p.line(8, 6, 14, 10, 0x2a7a3a);
  });
  W_('frame-port', 12, 16, (p) => {
    p.box(1, 1, 10, 14, 0xe8e0d0);
    p.rect(3, 3, 6, 10, 0xe880a8);
    p.disc(6, 7, 2, 0xffc890);
    p.rect(4, 10, 5, 3, 0x4a8be8);
    p.set(5, 7, INK);
    p.set(7, 7, INK);
  });
  W_('clock', 12, 12, (p) => {
    p.disc(6, 6, 5, INK);
    p.disc(6, 6, 4, 0xffffff);
    p.vline(6, 3, 4, INK);
    p.hline(6, 6, 3, INK);
    p.set(6, 2, 0xe8504a);
  });
  W_('shelf-books', 28, 12, (p) => {
    const cols = [0xe8504a, 0x4a8be8, 0xf2c94c, 0x5cc85a, 0xc070ff];
    for (let i = 0; i < 9; i++) {
      const hh = 6 + (i % 3);
      p.rect(3 + i * 2, 9 - hh, 2, hh, cols[i % 5]);
      p.set(3 + i * 2, 9 - hh, INK);
    }
    p.line(22, 3, 25, 9, 0xe8504a);
    p.box(1, 9, 26, 2, WOOD);
    p.rect(4, 11, 1, 1, INK);
    p.rect(23, 11, 1, 1, INK);
  });
}

// ------------------------------------------------------------------ damage overlay
export interface KeepClear {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DamageRoom {
  id: string;
  col: number;
  floor: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
}

function blob(r: () => number, rad: number) {
  const n = 11;
  const radii = Array.from({ length: n }, () => rad * (0.55 + r() * 0.65));
  return (dx: number, dy: number) => {
    const a = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
    const i = a * n;
    const i0 = Math.floor(i) % n;
    const t = i - Math.floor(i);
    const rr = radii[i0] * (1 - t) + radii[(i0 + 1) % n] * t;
    return Math.sqrt(dx * dx + dy * dy) / rr; // <1 = inside
  };
}

function hits(k: KeepClear[], x: number, y: number, w: number, h: number) {
  return k.some((c) => x < c.x + c.w && x + w > c.x && y < c.y + c.h && y + h > c.y);
}

function place(r: () => number, k: KeepClear[], W: number, ymin: number, ymax: number, w: number, h: number) {
  for (let i = 0; i < 30; i++) {
    const x = Math.floor(4 + r() * (W - w - 8));
    const y = Math.floor(ymin + r() * Math.max(1, ymax - ymin - h));
    if (!hits(k, x, y, w, h)) return { x, y };
  }
  return null;
}

function crack(p: Px, r: () => number, x: number, y: number, len: number, dir: number) {
  for (let s = 0; s < len; s++) {
    p.set(x, y, INK);
    p.set(x + 1, y, mix(PLASTER, 0xffffff, 0.3), 160);
    y += r() < 0.75 ? 1 : 0;
    x += r() < 0.55 ? dir : r() < 0.3 ? -dir : 0;
    if (r() < 0.07) crack(p, r, x, y, Math.floor(len / 3), -dir);
  }
}

function rubble(p: Px, r: () => number, cx: number, base: number, w: number, h: number) {
  const cols = [0x8a8070, 0xb0a890, 0x6a5a4a, PLASTER, shade(STUD, 0.9)];
  const mound = new Px(p.w, p.h);
  for (let x = -w / 2; x <= w / 2; x++) {
    const top = Math.round(h * Math.sqrt(Math.max(0, 1 - (x / (w / 2)) ** 2)) * (0.8 + r() * 0.3));
    for (let y = 0; y < top; y++) {
      const c = cols[(Math.floor((x + 40) / 3) * 3 + Math.floor(y / 2) * 5 + ((x * y) & 3)) % cols.length];
      mound.set(cx + x, base - 1 - y, c);
    }
  }
  // A broken plank sticking out.
  const px = cx + Math.round((r() - 0.5) * w * 0.4);
  mound.line(px, base - h, px + 6, base - h - 4, WOOD);
  mound.line(px + 1, base - h, px + 7, base - h - 4, WOOD_D);
  mound.outline();
  p.blit(mound, 0, 0);
}

/**
 * Build (or fetch) the damage overlay textures for one room at one level.
 * Levels are cumulative and each level uses its own seeded stream, so level 2
 * keeps exactly the cracks of level 1. Returns [wall, front] buffers (room-local); the wall
 * layer sits between wallpaper and furniture, the front layer (rubble, debris)
 * in front of furniture but behind ladders, the board and avatars.
 */
const damageCache = new Map<string, [Px, Px]>();

export function roomDamagePx(room: DamageRoom, level: number, keep: KeepClear[]): [Px, Px] {
  const ck = `${room.id}:${level}:${hashStr(JSON.stringify(keep))}`;
  const hit = damageCache.get(ck);
  if (hit) return hit;
  const W = room.x1 - room.x0;
  const H = room.bottom - room.top;
  const wall = new Px(W, H);
  const front = new Px(W, H);
  const theme = ROOM_THEMES[room.id] ?? ROOM_THEMES.living;
  const outer = room.col !== 1 || room.floor === 2;

  for (let L = 1; L <= level; L++) {
    const r = rng(hashStr(`${room.id}:dmg:${L}`));
    if (L === 1) {
      for (let i = 0; i < 4; i++) {
        const at = place(r, [], W, 6, H - 20, 4, 4) ?? { x: 20, y: 10 };
        crack(wall, r, at.x, i === 0 ? 0 : at.y, 10 + Math.floor(r() * 16), r() < 0.5 ? 1 : -1);
      }
      for (let i = 0; i < 6; i++) {
        const x = Math.floor(4 + r() * (W - 8));
        front.rect(x, H - 2, 2, 1, 0xb0a890);
        front.set(x + 1, H - 1, 0x6a5a4a);
      }
    } else if (L === 2) {
      for (let i = 0; i < 3; i++) {
        const rad = 7 + r() * 6;
        const at = place(r, keep, W, 8, H - 14, rad * 2, rad * 2);
        if (!at) continue;
        const cx = at.x + rad;
        const cy = at.y + rad;
        const f = blob(r, rad);
        const g = blob(r, rad * 0.8);
        for (let y = Math.floor(cy - rad * 1.3); y < cy + rad * 1.3; y++)
          for (let x = Math.floor(cx - rad * 1.3); x < cx + rad * 1.3; x++) {
            const d = f(x - cx, y - cy);
            if (d < 1) {
              const lath = g(x - cx, y - cy) < 1;
              const slat = Math.floor(y / 3);
              const gap = y % 3 === 2 || (x + slat * 11) % 19 === 0;
              if (lath) wall.set(x, y, gap ? CAVITY : (slat % 2 ? LATH : shade(LATH, 0.82)));
              else wall.set(x, y, dith(x, y, d * 0.8) ? shade(PLASTER, 0.72) : shade(PLASTER, 0.9));
            } else if (d < 1.12) wall.set(x, y, INK);
            else if (d < 1.3 && y < cy) wall.set(x, y, mix(theme.base, 0xffffff, 0.3));
            else if (d < 1.3) wall.set(x, y, shade(theme.base, 0.6));
          }
      }
      // Scattered debris on the floor.
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(4 + r() * (W - 8));
        if (hits(keep, x, H - 4, 3, 4)) continue;
        const c = [PLASTER, 0x8a8070, theme.base, WOOD][i % 4];
        front.rect(x - 1, H - 3, 4, 3, INK);
        front.rect(x, H - 2, 2, 2, c);
      }
    } else if (L === 3) {
      // Big holes: studs in front of the night sky (outer walls) or a dark cavity.
      for (let i = 0; i < 2; i++) {
        const rad = 11 + r() * 6;
        const at = place(r, keep, W, 6, H - 10, rad * 2, rad * 2);
        if (!at) continue;
        const cx = at.x + rad;
        const cy = at.y + rad;
        const f = blob(r, rad);
        for (let y = Math.floor(cy - rad * 1.4); y < cy + rad * 1.4; y++)
          for (let x = Math.floor(cx - rad * 1.4); x < cx + rad * 1.4; x++) {
            const d = f(x - cx, y - cy);
            const wx = x + room.x0;
            if (d < 1) {
              const stud = ((wx % 16) + 16) % 16;
              if (stud < 3) wall.set(x, y, stud === 0 ? INK : stud === 1 ? STUD : shade(STUD, 0.7));
              else if (outer) wall.set(x, y, dith(x, y, (y - (cy - rad)) / (rad * 2)) ? SKY : SKY_TOP);
              else wall.set(x, y, dith(x, y, 0.3) ? 0x2a1a38 : CAVITY);
              if (outer && stud >= 3 && ((wx * 7 + y * 13) % 97 === 0)) wall.set(x, y, 0xffffff);
            } else if (d < 1.1) wall.set(x, y, INK);
            else if (d < 1.28) wall.set(x, y, (x + y) % 4 === 0 ? INK : PLASTER);
            else if (d < 1.4 && y % 3 === 0 && x % 2 === 0) wall.set(x, y, LATH);
          }
      }
      // Scorch or water stain.
      const sx = Math.floor(10 + r() * (W - 20));
      const scorch = r() < 0.5;
      for (let y = 0; y < H - 6; y++)
        for (let x = sx - 18; x < sx + 18; x++) {
          if (x < 0 || x >= W) continue;
          const t = scorch ? 1 - Math.abs(x - sx) / 18 - (H - 6 - y) / (H * 1.1) : 1 - Math.abs(x - sx) / 14 - y / (H * 0.8);
          if (t <= 0 || !dith(x, y, t * 1.6)) continue;
          if (scorch) wall.set(x, y, t > 0.4 ? 0x1a1010 : 0x3a2a24);
          else if (t < 0.15 || dith(x + 1, y, t * 0.6)) wall.set(x, y, 0x8a6a3a);
        }
      if (!scorch) for (let k = 0; k < 3; k++) {
        const dx = sx - 8 + Math.floor(r() * 16);
        for (let y = 0; y < 16 + r() * 20; y++) wall.set(dx, y, 0x6a5a3a);
      }
      // Collapsed shelf.
      const sh = place(r, keep, W, 16, 30, 26, 14);
      if (sh) {
        const left = r() < 0.5;
        const ya = sh.y + (left ? 0 : 12);
        const yb = sh.y + (left ? 12 : 0);
        for (let o = -1; o <= 1; o++) wall.line(sh.x, ya + o, sh.x + 24, yb + o, o === 0 ? WOOD : INK);
        wall.rect(left ? sh.x : sh.x + 22, (left ? ya : yb) + 2, 2, 4, 0x8a8a9a);
        const bx = left ? sh.x + 20 : sh.x + 2;
        const cols = [0xe8504a, 0x4a8be8, 0xf2c94c];
        for (let b = 0; b < 3; b++) {
          const x = bx + b * 3 - 3;
          if (hits(keep, x, H - 6, 4, 6)) continue;
          front.rect(x - 1, H - 5, 4, 5, INK);
          front.rect(x, H - 4, 2, 4, cols[b]);
        }
      }
      // Rubble piles.
      for (let i = 0; i < 3; i++) {
        const w = 14 + Math.floor(r() * 10);
        const h = 5 + Math.floor(r() * 4);
        const at = place(r, keep, W, H - h - 1, H, w, h + 1);
        if (at) rubble(front, r, at.x + Math.floor(w / 2), H, w, h);
      }
    }
  }
  // Never cover doorways, ladders, stairs, chutes or the board.
  for (const k of keep) {
    wall.clearRect(k.x, k.y, k.w, k.h);
    front.clearRect(k.x, k.y, k.w, k.h);
  }
  damageCache.set(ck, [wall, front]);
  return [wall, front];
}

/**
 * Stamp a room's damage overlay (0..3) into a baked house canvas overlay:
 * `wall` goes under the furniture, `front` (rubble) over it. Callers then
 * stamp decor in between and call `canvas.compose(...)` for the room rect.
 */
export function drawRoomDamage(over: Px, room: DamageRoom, level: number, keep: KeepClear[], part: 'wall' | 'front') {
  if (level <= 0) return;
  const [wall, front] = roomDamagePx(room, Math.min(3, level), keep);
  over.blit(part === 'wall' ? wall : front, room.x0, room.top);
}
