import Phaser from 'phaser';
import { DOOR_H, ROOF_H, SLAB, Y0 } from '../config';
import type { Layout, LiftGeo, SlideGeo, TrampGeo, TrapGeo } from '../houseLayout';

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
type Pattern =
  | 'stripe'
  | 'dots'
  | 'damask'
  | 'stars'
  | 'diamond'
  | 'block'
  | 'vplank'
  | 'hplank'
  | 'floral'
  | 'check'
  | 'wave'
  | 'bumps'
  | 'knit'
  | 'gears'
  | 'crater'
  | 'panes'
  | 'spots';

/** Hanging light per theme. */
export type LampKind = 'lamp-pendant' | 'lamp-bulb' | 'lamp-disco' | null;

export interface ThemeArt {
  pat: Pattern;
  rail?: boolean;
  wainscot?: { kind: 'tile' | 'panel' | 'hazard' | 'keys'; c?: number; h: number };
  skirt?: number;
  window?: boolean;
  lamp?: LampKind;
  /** Floor furniture, placed left to right where it fits. */
  floor: string[];
  /** Wall hangings (bottom edge `y` px above the floor). */
  wall: [string, number][];
  /** Furniture hangs from the ceiling, upside down. */
  ceiling?: boolean;
  /** Extra wallpaper drawing (room-local). */
  special?: (p: Px, w: number, h: number, base: number, r: () => number) => void;
}

const T = (t: ThemeArt) => t;

/** Art per theme key (content/houseThemes.ts). Unknown keys fall back by pattern hash. */
export const THEME_ART: Record<string, ThemeArt> = {
  // Sensible.
  kitchen: T({ pat: 'diamond', rail: true, window: true, floor: ['counter', 'fridge', 'table'], wall: [['clock', 30]], special: backsplash }),
  bathroom: T({ pat: 'dots', rail: true, wainscot: { kind: 'tile', c: 0xe8f4fa, h: 18 }, floor: ['tub', 'toilet', 'sink'], wall: [['mirror', 24], ['towel', 22]] }),
  bedroom: T({ pat: 'floral', rail: true, window: true, floor: ['bed', 'nightstand', 'wardrobe', 'dresser'], wall: [['frame-port', 26]] }),
  living: T({ pat: 'stripe', rail: true, wainscot: { kind: 'panel', h: 16 }, floor: ['couch', 'tv', 'floorlamp', 'armchair'], wall: [['frame-land', 26], ['clock', 32]] }),
  pantry: T({ pat: 'hplank', skirt: 0x5a3a20, lamp: 'lamp-bulb', floor: ['jars', 'boxes', 'jars'], wall: [] }),
  study: T({ pat: 'damask', rail: true, wainscot: { kind: 'panel', c: 0x6a3a1a, h: 16 }, floor: ['desk', 'globe', 'bookcase', 'armchair'], wall: [['shelf-books', 28]] }),
  garage: T({ pat: 'block', wainscot: { kind: 'hazard', c: 0xf0c030, h: 8 }, skirt: 0x4a5868, lamp: 'lamp-bulb', floor: ['car', 'workbench'], wall: [], special: pegboard }),
  laundry: T({ pat: 'check', rail: true, floor: ['washer', 'washer', 'boxes'], wall: [['towel', 24]] }),
  dining: T({ pat: 'damask', rail: true, wainscot: { kind: 'panel', h: 16 }, window: true, floor: ['table', 'plant'], wall: [['frame-land', 28]] }),
  hallway: T({ pat: 'stripe', rail: true, floor: ['coatrack', 'plant', 'trunk'], wall: [['frame-port', 26], ['mirror', 24]] }),
  nursery: T({ pat: 'stars', rail: true, window: true, floor: ['crib', 'toybox', 'rockinghorse'], wall: [['poster', 24]], special: bunting }),
  library: T({ pat: 'vplank', skirt: 0x3a2010, floor: ['bookcase', 'bookcase', 'armchair', 'globe'], wall: [['shelf-books', 30]] }),
  attic: T({ pat: 'vplank', skirt: 0x5a3420, lamp: 'lamp-bulb', floor: ['rockinghorse', 'trunk', 'boxes'], wall: [], special: atticBits }),
  cellar: T({ pat: 'block', skirt: 0x3a3028, lamp: 'lamp-bulb', floor: ['barrels', 'shelfunit', 'barrels'], wall: [] }),
  workshop: T({ pat: 'hplank', wainscot: { kind: 'hazard', c: 0xf0c030, h: 8 }, lamp: 'lamp-bulb', floor: ['workbench', 'boxes'], wall: [], special: pegboard }),
  guest: T({ pat: 'floral', rail: true, window: true, floor: ['bed', 'nightstand', 'plant'], wall: [['frame-land', 28]] }),
  playroom: T({ pat: 'stars', rail: true, floor: ['toys', 'toybox', 'kidbed'], wall: [['poster', 24]], special: bunting }),
  music: T({ pat: 'stripe', rail: true, wainscot: { kind: 'keys', h: 10 }, floor: ['piano', 'speaker'], wall: [['frame-port', 28]] }),
  office: T({ pat: 'check', rail: true, window: true, floor: ['desk', 'shelfunit', 'plant'], wall: [['clock', 32]] }),
  sunroom: T({ pat: 'panes', window: true, floor: ['plant', 'armchair', 'plant'], wall: [] }),
  mudroom: T({ pat: 'hplank', skirt: 0x3a2a1a, floor: ['coatrack', 'boxes'], wall: [['hats', 30]] }),
  den: T({ pat: 'stripe', wainscot: { kind: 'panel', h: 16 }, floor: ['couch', 'tv'], wall: [['frame-land', 28]] }),
  boiler: T({ pat: 'block', wainscot: { kind: 'hazard', c: 0xf0c030, h: 8 }, lamp: 'lamp-bulb', floor: ['boiler', 'barrels'], wall: [], special: pipes }),
  gamesroom: T({ pat: 'damask', rail: true, floor: ['pooltable', 'arcade'], wall: [['frame-land', 30]] }),
  // Silly.
  ballpit: T({ pat: 'spots', floor: ['slide-toy'], wall: [['poster', 30]], special: ballPit }),
  bouncycastle: T({ pat: 'bumps', lamp: null, floor: ['toys'], wall: [], special: castleTop }),
  knitting: T({ pat: 'knit', rail: true, window: true, floor: ['rockchair', 'yarn', 'basket', 'yarn'], wall: [['doily', 28]] }),
  aquarium: T({ pat: 'wave', floor: ['armchair', 'plant'], wall: [['tank', 10]], special: bubbles }),
  trophy: T({ pat: 'damask', rail: true, wainscot: { kind: 'panel', c: 0x6a3a1a, h: 16 }, floor: ['trophycase', 'trophy', 'trophycase'], wall: [['trophyshelf', 30]] }),
  catroom: T({ pat: 'dots', rail: true, floor: ['cattree', 'cat', 'yarn', 'cat'], wall: [['fishframe', 28]] }),
  disco: T({ pat: 'spots', lamp: 'lamp-disco', floor: ['speaker', 'speaker'], wall: [], special: discoFloor }),
  greenhouse: T({ pat: 'panes', lamp: 'lamp-bulb', floor: ['plant', 'bigplant', 'plant', 'bigplant'], wall: [] }),
  arcade: T({ pat: 'stars', floor: ['arcade', 'arcade', 'arcade'], wall: [], special: neon }),
  karaoke: T({ pat: 'stripe', lamp: 'lamp-disco', floor: ['speaker', 'mic', 'speaker'], wall: [] }),
  hatroom: T({ pat: 'floral', rail: true, floor: ['coatrack', 'mirrorstand'], wall: [['hats', 28], ['hats', 28]] }),
  snackvault: T({ pat: 'block', floor: ['snackshelf', 'vault', 'snackshelf'], wall: [] }),
  // Nonsense.
  sockdrawer: T({ pat: 'knit', floor: ['sockpile'], wall: [['sock', 14], ['sock', 18], ['sock', 12]] }),
  upsidedown: T({ pat: 'stripe', rail: true, ceiling: true, floor: ['couch', 'floorlamp', 'armchair'], wall: [['frame-land', 18]] }),
  hallofdoors: T({ pat: 'damask', floor: [], wall: [], special: wallDoors }),
  wardrobe: T({ pat: 'vplank', skirt: 0x2a1a10, lamp: 'lamp-bulb', floor: ['shoes', 'trunk', 'shoes'], wall: [], special: coats }),
  giantfridge: T({ pat: 'check', lamp: 'lamp-bulb', floor: ['milk', 'cheese', 'egg', 'milk'], wall: [], special: fridgeShelves }),
  bathtubboat: T({ pat: 'dots', wainscot: { kind: 'tile', c: 0xe8f4fa, h: 12 }, floor: ['boat'], wall: [['towel', 26]], special: bathWater }),
  pianostairs: T({ pat: 'stripe', wainscot: { kind: 'keys', h: 14 }, floor: ['grandpiano'], wall: [['frame-port', 30]] }),
  pillowfort: T({ pat: 'stars', lamp: null, floor: ['tent', 'pillows', 'pillows'], wall: [], special: fairyLights }),
  clockinside: T({ pat: 'gears', lamp: 'lamp-bulb', floor: ['pendulum'], wall: [['clock', 30]] }),
  jellyroom: T({ pat: 'spots', floor: ['jelly', 'jelly', 'jelly'], wall: [], special: jellyShine }),
  tinyroom: T({ pat: 'floral', rail: true, floor: ['tinydoor', 'nightstand'], wall: [['frame-port', 26]] }),
  moonroom: T({ pat: 'crater', lamp: null, floor: ['moonflag', 'rocket'], wall: [], special: moonWindow }),
};

const PATTERNS: Pattern[] = ['stripe', 'dots', 'damask', 'stars', 'diamond', 'floral', 'check'];
export function themeArt(theme: string): ThemeArt {
  return THEME_ART[theme] ?? { pat: PATTERNS[hashStr(theme) % PATTERNS.length], rail: true, floor: ['plant', 'boxes'], wall: [['frame-land', 28]] };
}

function pattern(p: Px, pat: Pattern, base: number, w: number, h: number, seed: number) {
  const c = pat === 'block' || pat === 'vplank' || pat === 'hplank' ? shade(base, 0.72) : mix(base, 0xffffff, 0.2);
  const r = rng(hashStr(pat) ^ seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let on = false;
      let col = c;
      switch (pat) {
        case 'stripe':
          on = x % 10 < 3;
          if (x % 10 === 6 && y % 2 === 0) {
            on = true;
            col = shade(base, 1.25);
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
          if (on) col = ox === 6 && oy === 6 ? 0xffffff : 0xffe08a;
          if (!on && ((ox === 1 && oy === 1) || (ox === 10 && oy === 9))) {
            on = true;
            col = shade(base, 1.3);
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
            col = shade(base, 1.15);
          }
          break;
        case 'hplank':
          on = y % 7 === 6 || (x + Math.floor(y / 7) * 13) % 31 === 0;
          break;
        case 'floral': {
          const ox = (x + (Math.floor(y / 9) % 2) * 6) % 12;
          const oy = y % 9;
          on = Math.abs(ox - 6) + Math.abs(oy - 4) === 1;
          if (ox === 6 && oy === 4) {
            on = true;
            col = TRIM;
          }
          break;
        }
        case 'check':
          on = (Math.floor(x / 6) + Math.floor(y / 6)) % 2 === 0;
          col = mix(base, 0xffffff, 0.12);
          break;
        case 'wave': {
          const yy = (y + Math.round(Math.sin(x / 4) * 2) + 40) % 9;
          on = yy === 0;
          if (yy === 1) {
            on = true;
            col = shade(base, 0.8);
          }
          break;
        }
        case 'bumps': {
          // Inflatable columns: rounded vertical tubes with a highlight.
          const tx = x % 14;
          on = tx === 0 || tx === 13;
          col = shade(base, 0.7);
          if (tx === 3 || tx === 4) {
            on = true;
            col = mix(base, 0xffffff, 0.35);
          }
          if (tx > 4 && tx < 12 && (Math.floor(x / 14) % 2 === 0)) {
            on = true;
            col = mix(base, 0xe84a4a, 0.35);
          }
          break;
        }
        case 'knit': {
          const kx = x % 6;
          const ky = (y + (kx < 3 ? kx : 5 - kx)) % 4;
          on = ky === 0;
          if (Math.floor(y / 12) % 3 === 1) col = mix(base, 0xffe08a, 0.4);
          break;
        }
        case 'gears': {
          const gx = (x % 24) - 12;
          const gy = (y % 24) - 12;
          const d = Math.sqrt(gx * gx + gy * gy);
          const teeth = Math.floor(((Math.atan2(gy, gx) + Math.PI) / (Math.PI * 2)) * 16) % 2 === 0;
          on = (d > 6 && d < 9) || (d >= 9 && d < 11 && teeth) || d < 2;
          col = mix(base, 0xffe08a, 0.35);
          break;
        }
        case 'crater':
          on = r() < 0.04;
          col = shade(base, r() < 0.5 ? 0.75 : 1.2);
          break;
        case 'panes':
          on = x % 18 === 0 || y % 16 === 0;
          col = mix(base, 0xffffff, 0.55);
          if (!on && (x % 18) + (y % 16) === 6) {
            on = true;
            col = 0xffffff;
          }
          break;
        case 'spots':
          on = ((x * 7 + y * 13) % 41 === 0 || (x * 11 + y * 5) % 53 === 0);
          col = [0xffe060, 0x60e0ff, 0xff60c0, 0x80ff80][(x + y) % 4];
          break;
      }
      if (on) p.set(x, y, col);
    }
  }
  if (pat === 'crater') {
    for (let k = 0; k < (w * h) / 500; k++) {
      const cx = Math.floor(r() * w);
      const cy = Math.floor(r() * (h - 10));
      const rad = 2 + Math.floor(r() * 4);
      for (let y = -rad; y <= rad; y++)
        for (let x = -rad; x <= rad; x++) {
          const d = x * x + y * y;
          if (d <= rad * rad) p.set(cx + x, cy + y, d >= (rad - 1) * (rad - 1) ? (y < 0 ? shade(base, 0.7) : mix(base, 0xffffff, 0.2)) : shade(base, 0.88));
        }
    }
  }
  // Per-block tint for block/plank walls.
  if (pat === 'block' || pat === 'vplank' || pat === 'hplank') {
    for (let k = 0; k < (w * h) / 100; k++) {
      const x = Math.floor(r() * w);
      const y = Math.floor(r() * h);
      p.set(x, y, shade(base, 0.85));
      p.set(x + 1, y, shade(base, 0.85));
    }
  }
}

function drawWindow(p: Px, x: number, y: number, w: number, h: number, curtain?: number, moon = false) {
  p.rect(x - 2, y - 2, w + 4, h + 4, INK);
  p.rect(x - 1, y - 1, w + 2, h + 2, TRIM);
  p.vgrad(x, y, w, h, 0x2a3a90, WIN);
  p.set(x + 3, y + 3, 0xffffff);
  p.set(x + w - 4, y + 5, 0xffffff);
  if (moon) p.rect(x + w - 7, y + 2, 3, 3, 0xf0e8b0);
  p.set(x + 2, y + h - 3, 0xc8f0ff);
  p.vline(x + (w >> 1), y, h, TRIM);
  p.hline(x, y + (h >> 1), w, TRIM);
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

/** Wallpaper, rail, wainscot, skirting and theme dressing for one room (room-local pixels). */
export function drawRoomWall(room: { id: string; theme: string; color: number; x0: number; x1: number; top: number; bottom: number }): Px {
  const t = themeArt(room.theme);
  const w = room.x1 - room.x0;
  const h = room.bottom - room.top;
  const base = room.color;
  const seed = hashStr(room.id);
  const r = rng(seed);
  const p = new Px(w, h);
  p.rect(0, 0, w, h, base);
  pattern(p, t.pat, base, w, h, seed);
  // Ceiling shadow, dithered.
  for (let y = 0; y < 8; y++) for (let x = 0; x < w; x++) if (!dith(x, y, y / 8)) p.set(x, y, shade(base, 0.55));
  if (t.rail) {
    p.hline(0, 11, w, TRIM);
    p.hline(0, 12, w, TRIM_D);
    p.hline(0, 13, w, shade(base, 0.7));
  }
  if (t.window && w >= 60) {
    const ww = 20;
    const wx = Math.round(8 + r() * (w - ww - 16));
    drawWindow(p, wx, h - 40, ww, 14, mix(base, 0xe8504a, 0.5), r() < 0.5);
  }
  const ws = t.wainscot;
  if (ws) {
    const c = ws.c ?? shade(base, 0.7);
    const y0 = h - 5 - ws.h;
    if (ws.kind === 'tile') {
      for (let y = y0; y < h - 5; y++)
        for (let x = 0; x < w; x++) {
          const grout = (y - y0) % 5 === 0 || x % 5 === 0;
          const chk = (Math.floor(x / 5) + Math.floor((y - y0) / 5)) % 2 === 0;
          p.set(x, y, grout ? 0x9ab8c8 : chk ? c : 0xc8e4f0);
        }
      p.hline(0, y0 - 1, w, 0x2a5a8a);
      p.hline(0, y0 - 2, w, INK);
    } else if (ws.kind === 'panel') {
      p.rect(0, y0, w, ws.h, c);
      p.hline(0, y0 - 1, w, INK);
      p.hline(0, y0, w, TRIM);
      p.hline(0, y0 + 1, w, TRIM_D);
      for (let x = 4; x + 14 < w; x += 18) {
        p.rect(x, y0 + 4, 14, ws.h - 7, shade(c, 0.82));
        p.hline(x, y0 + 4, 14, shade(c, 0.6));
        p.vline(x, y0 + 4, ws.h - 7, shade(c, 0.6));
        p.hline(x, y0 + ws.h - 4, 14, mix(c, 0xffffff, 0.25));
        p.vline(x + 13, y0 + 4, ws.h - 7, mix(c, 0xffffff, 0.25));
      }
    } else if (ws.kind === 'keys') {
      // Piano keys: white keys with black keys on top.
      p.rect(0, y0, w, ws.h, 0xf4f0e8);
      p.hline(0, y0 - 1, w, INK);
      for (let x = 0; x < w; x++) if (x % 6 === 0) p.vline(x, y0, ws.h, 0x9a9a9a);
      for (let x = 0; x < w; x += 6) {
        const k = Math.floor(x / 6) % 7;
        if (k === 2 || k === 6) continue;
        p.rect(x + 4, y0, 3, Math.round(ws.h * 0.6), INK);
      }
    } else {
      for (let y = y0; y < y0 + 5; y++) for (let x = 0; x < w; x++) p.set(x, y, (x + y) % 8 < 4 ? c : INK);
    }
  }
  // Skirting board.
  const sk = t.skirt ?? TRIM;
  p.hline(0, h - 6, w, INK);
  p.rect(0, h - 5, w, 4, sk);
  p.hline(0, h - 5, w, mix(sk, 0xffffff, 0.35));
  p.hline(0, h - 2, w, shade(sk, 0.7));
  p.hline(0, h - 1, w, shade(sk, 0.5));
  t.special?.(p, w, h, base, r);
  return p;
}

// Theme dressing painted into the wallpaper (behind furniture and players).
function backsplash(p: Px, w: number, h: number) {
  const x0 = Math.max(4, w - 52);
  for (let y = h - 30; y < h - 18; y++)
    for (let x = x0; x < x0 + 40; x++) p.set(x, y, x % 4 === 0 || y % 4 === 0 ? 0x9ab8b8 : (x + y) % 8 < 4 ? 0xf0f0e0 : 0x8ad0c8);
  for (let x = x0; x < x0 + 39; x += 13) {
    p.box(x + 1, 9, 11, 10, 0xd8a060);
    p.rect(x + 3, 11, 7, 6, 0xc08a4a);
  }
}
function pegboard(p: Px, w: number) {
  const x0 = Math.floor(w / 2) - 17;
  p.box(x0, 12, 34, 18, 0xc8a070);
  for (let y = 14; y < 29; y += 3) for (let x = x0 + 2; x < x0 + 33; x += 3) p.set(x, y, 0x8a6a40);
  p.rect(x0 + 4, 15, 2, 10, WOOD_D);
  p.rect(x0 + 2, 15, 6, 3, 0x8a8a9a);
  p.rect(x0 + 12, 16, 2, 11, 0xb0b8c8);
  p.rect(x0 + 19, 16, 10, 4, 0xc8d0d8);
  p.rect(x0 + 27, 16, 3, 8, 0xd04040);
}
function bunting(p: Px, w: number) {
  const cols = [0xe8504a, 0xf2c94c, 0x4a8be8, 0xffffff, 0x5cc85a];
  for (let x = 2, i = 0; x < w - 6; x += 8, i++) {
    p.hline(x, 15 + (i % 2), 8, INK);
    for (let k = 0; k < 4; k++) p.rect(x + 1 + k, 16 + k, 6 - 2 * k, 1, cols[i % cols.length]);
  }
}
function atticBits(p: Px, w: number) {
  for (let i = 0; i < 20; i++) {
    p.rect(i, 20 - i, 5, 1, WOOD_D);
    p.set(i + 5, 20 - i, INK);
    p.rect(w - 5 - i, 20 - i, 5, 1, WOOD_D);
    p.set(w - 6 - i, 20 - i, INK);
  }
  const cx = Math.floor(w / 2);
  p.disc(cx, 22, 8, INK);
  p.disc(cx, 22, 7, TRIM_D);
  p.disc(cx, 22, 5, 0x2a3a90);
  p.vline(cx, 17, 11, TRIM_D);
  p.hline(cx - 5, 22, 11, TRIM_D);
}
function pipes(p: Px, w: number, h: number) {
  for (const y of [10, 16]) {
    p.rect(0, y, w, 4, INK);
    p.rect(0, y + 1, w, 2, y === 10 ? 0xb87a3a : 0x8a90a8);
    for (let x = 12; x < w; x += 30) p.rect(x, y - 1, 3, 6, INK);
  }
  p.rect(w - 10, 18, 4, h - 24, INK);
  p.rect(w - 9, 18, 2, h - 24, 0x8a90a8);
}
function ballPit(p: Px, w: number, h: number, _b: number, r: () => number) {
  // The pit's netting wall and a deep heap of balls along the floor.
  for (let y = h - 26; y < h - 14; y++) for (let x = 0; x < w; x++) if ((x + y) % 5 === 0 || (x - y + 500) % 5 === 0) p.set(x, y, 0xffffff, 120);
  p.rect(0, h - 27, w, 2, 0x4a8be8);
  const cols = [0xe8504a, 0xf2c94c, 0x4a8be8, 0x5cc85a, 0xc070ff, 0xff9a40];
  for (let row = 0; row < 5; row++)
    for (let x = (row % 2) * 2; x < w + 3; x += 4) {
      const cy = h - 2 - row * 3 - Math.round(r() * 1.5);
      const c = cols[Math.floor(r() * cols.length)];
      p.rect(x - 1, cy - 1, 3, 3, INK);
      p.set(x, cy, c);
      p.set(x - 1, cy, c);
      p.set(x, cy - 1, mix(c, 0xffffff, 0.5));
    }
}
function castleTop(p: Px, w: number) {
  for (let x = 0; x < w; x++) {
    const m = x % 12 < 6;
    for (let y = 0; y < (m ? 9 : 4); y++) p.set(x, y, y === (m ? 8 : 3) ? INK : (x % 12) % 6 === 1 ? 0xfff0a0 : 0xe8504a);
  }
}
function bubbles(p: Px, w: number, h: number, _b: number, r: () => number) {
  for (let k = 0; k < w / 6; k++) {
    const x = Math.floor(r() * w);
    const y = Math.floor(r() * (h - 10));
    p.set(x, y, 0xc8f0ff);
    p.set(x + 1, y - 1, 0xffffff, 150);
  }
}
function discoFloor(p: Px, w: number, h: number) {
  const cols = [0xff4080, 0x40c0ff, 0xffe040, 0x60ff80];
  for (let x = 0; x < w; x++) for (let y = h - 6; y < h; y++) p.set(x, y, (x + 1) % 8 === 0 ? INK : cols[Math.floor(x / 8) % 4]);
  for (let k = 0; k < 6; k++) {
    const x = Math.floor((w * (k + 0.5)) / 6);
    for (let y = 4; y < h - 8; y++) if ((y + k) % 3 === 0 && Math.abs((x - w / 2) * (y / h)) < w) p.set(x + Math.round((x - w / 2) * (y / h) * 0.6), y, cols[k % 4], 110);
  }
}
function neon(p: Px, w: number) {
  for (let x = 6; x < w - 6; x++) {
    p.set(x, 9, 0xff60e0);
    p.set(x, 10, 0xffb0f0);
  }
}
function wallDoors(p: Px, w: number, h: number, base: number) {
  const cols = [0xa8302a, 0x4a8be8, 0x5cc85a, 0xf2c94c, 0xc070ff, 0xffffff];
  let i = 0;
  for (let x = 4; x + 14 < w; x += 18, i++) {
    const dh = 20 + ((i * 7) % 3) * 6;
    const y = (i % 2 ? 10 : h - 6 - dh) + (i % 3);
    const c = cols[i % cols.length];
    p.rect(x - 1, y - 1, 16, dh + 2, INK);
    p.rect(x, y, 14, dh, c);
    p.rect(x + 2, y + 2, 10, dh / 2 - 3, shade(c, 0.85));
    p.rect(x + 2, y + dh / 2 + 1, 10, dh / 2 - 3, shade(c, 0.85));
    p.rect(x + 11, y + dh / 2, 2, 2, TRIM);
    p.hline(x, y, 14, mix(c, base, 0.2));
  }
}
function coats(p: Px, w: number) {
  p.rect(0, 9, w, 2, 0xb0b8c8);
  p.hline(0, 11, w, INK);
  const cols = [0x8a3a3a, 0x3a5a8a, 0x5a7a3a, 0x8a6a2a, 0x6a3a7a];
  for (let x = 4, i = 0; x < w - 10; x += 12, i++) {
    const c = cols[i % cols.length];
    p.line(x + 5, 11, x + 5, 13, INK);
    p.rect(x, 13, 11, 22 + (i % 3) * 3, INK);
    p.rect(x + 1, 14, 9, 20 + (i % 3) * 3, c);
    p.vline(x + 5, 14, 20, shade(c, 0.7));
    p.rect(x + 1, 14, 2, 4, mix(c, 0xffffff, 0.3));
  }
}
function fridgeShelves(p: Px, w: number, h: number) {
  for (const y of [14, 30]) {
    p.rect(0, y, w, 3, 0xe8f4fa);
    p.hline(0, y + 3, w, 0x8aa0b8);
    p.hline(0, y - 1, w, INK);
  }
  // Frost in the corners and a jar on each shelf.
  for (let y = 0; y < 8; y++) for (let x = 0; x < 10 - y; x++) p.set(x, h - 7 - y, 0xffffff, 140);
  for (let x = 8; x < w - 10; x += 26) {
    p.box(x, 7, 7, 7, 0xe8504a);
    p.rect(x, 6, 7, 2, 0xf2c94c);
    p.box(x + 12, 22, 6, 8, 0x5cc85a);
  }
}
function bathWater(p: Px, w: number, h: number) {
  for (let y = h - 14; y < h; y++)
    for (let x = 0; x < w; x++) {
      const top = h - 14 + Math.round(Math.sin(x / 3) * 1);
      if (y < top) continue;
      p.set(x, y, y === top ? 0xc8f0ff : dith(x, y, (y - top) / 14) ? 0x2a6ab8 : 0x4a9ae8);
    }
}
function fairyLights(p: Px, w: number) {
  const cols = [0xfff0a0, 0xff9ad0, 0x9ae0ff];
  for (let x = 0; x < w; x++) {
    const y = 8 + Math.round(Math.abs(Math.sin(x / 9)) * 5);
    p.set(x, y, 0x3a2a40);
    if (x % 6 === 3) {
      p.set(x, y + 1, cols[(x / 6) % 3 | 0]);
      p.set(x, y + 2, cols[(x / 6) % 3 | 0]);
    }
  }
}
function jellyShine(p: Px, w: number, h: number) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + Math.round(Math.sin(y / 5) * 3)) % 20 === 0) p.set(x, y, 0xffb0b0, 120);
}
function moonWindow(p: Px, w: number) {
  const x = Math.floor(w * 0.6);
  p.disc(x, 18, 9, INK);
  p.disc(x, 18, 8, 0x0a0a20);
  p.disc(x - 2, 17, 4, 0x3a7ae8);
  p.rect(x - 3, 15, 3, 2, 0x5cc85a);
  p.set(x + 4, 13, 0xffffff);
  p.set(x - 5, 22, 0xffffff);
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
  for (let k = 0; k < (w * h) / 600; k++) {
    const x = x0 + Math.floor(r() * w);
    const y = y0 + Math.floor(r() * (h / 4)) * 4;
    const len = 4 + Math.floor(r() * 8);
    for (let i = 0; i < len; i++) if ((x + i) % 16 >= 3 && x + i < x0 + w) for (let yy = y; yy < y + 3; yy++) p.set(x + i, yy, CAVITY);
  }
}

// ------------------------------------------------------------------ whole-house chunk layers
export interface HoleSpan {
  x0: number;
  x1: number;
  y: number;
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

/** Eave trim along a roof slab (the ceiling of a top-most room). */
function drawEave(p: Px, y: number, x0: number, x1: number) {
  for (let x = x0; x < x1; x++) {
    p.set(x, y, INK);
    p.set(x, y + 1, TRIM);
    p.set(x, y + 2, TRIM_D);
    p.set(x, y + 3, INK);
    p.set(x, y + 4, x % 16 < 2 ? INK : SLABC);
    p.set(x, y + 5, shade(SLABC, 0.7));
  }
}

/** A shingled gable over one cell, its base on the eave at `y`. */
function drawGable(front: Px, back: Px, x0: number, x1: number, y: number, chimney: boolean) {
  const cx = (x0 + x1) / 2;
  const half = (x1 - x0) / 2 + 2;
  if (chimney) {
    const bx = Math.round(cx + half * 0.4);
    for (let x = bx; x < bx + 9; x++)
      for (let yy = y - ROOF_H - 2; yy < y - 4; yy++) {
        const brick = yy % 4 === 0 || (x + (Math.floor(yy / 4) % 2) * 3) % 6 === 0;
        front.set(x, yy, x === bx || x === bx + 8 ? INK : brick ? 0x5a2a2a : 0x9a4a3a);
      }
    front.rect(bx - 1, y - ROOF_H - 3, 11, 2, INK);
  }
  for (let yy = y - ROOF_H; yy < y; yy++) {
    const k = (yy - (y - ROOF_H) + 1) / ROOF_H;
    const hw = Math.round(k * half);
    const band = Math.floor((yy - (y - ROOF_H)) / 4);
    for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) {
      const off = (band % 2) * 4;
      const tile = Math.floor((x + off) / 8);
      const rowY = (yy - (y - ROOF_H)) % 4;
      const tc = (tile * 7 + band * 3) % 5 === 0 ? shade(ROOF, 0.85) : (tile + band) % 7 === 0 ? mix(ROOF, 0xffd0a0, 0.25) : ROOF;
      let c = rowY === 3 ? shade(ROOF, 0.55) : (x + off) % 8 === 0 && rowY < 3 ? shade(ROOF, 0.7) : rowY === 0 ? mix(tc, 0xffffff, 0.15) : tc;
      if (x === Math.round(cx - hw) || x === Math.round(cx + hw) - 1) c = INK;
      front.set(x, yy, c);
      back.set(x, yy, x % 12 < 2 ? WOOD_D : yy % 3 === 0 ? shade(WOOD, 0.6) : CAVITY);
    }
  }
  front.rect(Math.round(cx) - 2, y - ROOF_H - 1, 4, 2, INK);
}

const staticHouse = new Map<string, { front: Px; back: Px }>();

/** Rooms, walls, slabs, roofs and the fixed parts of features, at world coords. */
function buildStatic(L: Layout): { front: Px; back: Px } {
  const front = new Px(480, 270);
  const back = new Px(480, 270);
  const r = rng(hashStr(`house-backing:${L.key}`));
  for (const room of L.rooms) {
    front.blit(drawRoomWall(room), room.x0, room.top);
    drawBacking(back, room.x0, room.top, room.x1 - room.x0, room.bottom - room.top, r);
  }
  // Floor slabs and roof eaves.
  for (const s of L.slabs) {
    if (s.roof) drawEave(front, s.y, s.x0 - 2, s.x1 + 2);
    else drawSlab(front, s.y, s.x0, s.x1, s.ground);
    for (let y = s.y; y < s.y + SLAB; y++)
      for (let x = s.x0; x < s.x1; x++) back.set(x, y, x % 16 < 3 ? shade(STUD, 0.6) : (y + x) % 2 ? CAVITY : 0x2a1a20);
  }
  // Walls: plaster between rooms (behind the slabs), clapboard siding outside.
  for (const wseg of L.walls) {
    const xa = wseg.outside === -1 ? wseg.x - 6 : wseg.x - 2;
    const xb = wseg.outside === 1 ? wseg.x + 6 : wseg.x + 2;
    const gap = wseg.door ? [wseg.door.floor - DOOR_H, wseg.door.floor] : null;
    for (let y = wseg.y0; y < wseg.y1; y++) {
      if (gap && y >= gap[0] && y < gap[1]) continue;
      for (let x = xa; x < xb; x++) {
        if (wseg.outside) {
          const edge = x === xa || x === xb - 1;
          const row = (y - Y0) % 5;
          front.set(x, y, edge ? INK : row === 4 ? shade(SIDING, 0.6) : row === 0 ? mix(SIDING, 0xffffff, 0.25) : SIDING);
          back.set(x, y, edge ? INK : y % 16 < 3 ? STUD : CAVITY);
        } else {
          if (front.opaque(x, y) && L.slabs.some((s) => !s.roof && y >= s.y && y < s.y + SLAB && x >= s.x0 && x < s.x1)) continue;
          const k = x - xa;
          front.set(x, y, k === 0 || k === 3 ? INK : k === 1 ? mix(PLASTER, 0xffffff, 0.2) : PLASTER);
          back.set(x, y, k === 0 || k === 3 ? INK : k === 1 ? STUD : shade(STUD, 0.7));
        }
      }
    }
    if (gap && !wseg.outside) front.rect(xa, gap[0] - 1, 4, 1, INK);
  }
  // Roofs over every top-most cell; one chimney per house.
  const roofs = L.slabs.filter((s) => s.roof);
  const chimneyAt = roofs.length ? hashStr(L.key) % roofs.length : -1;
  roofs.forEach((s, i) => drawGable(front, back, s.x0, s.x1, s.y, i === chimneyAt));
  drawFeatures(front, L);
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

  constructor(private scene: Phaser.Scene, layout: Layout, holes: HoleSpan[], key = 'house-base') {
    let st = staticHouse.get(layout.key);
    if (!st) {
      // One house per game: drop older ones.
      staticHouse.clear();
      st = buildStatic(layout);
      staticHouse.set(layout.key, st);
    }
    this.front = st.front.copy();
    this.back = st.back.copy();
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
  makeThemeFurniture(scene);
  makeFeatureTextures(scene);
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
  /** Wall colour (theme base), for torn wallpaper edges. */
  color?: number;
  /** Big holes show the night sky (room touches the outside) rather than a cavity. */
  outer?: boolean;
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
  const ck = `${room.id}:${room.x0},${room.top},${room.x1 - room.x0}x${room.bottom - room.top}:${level}:${hashStr(JSON.stringify(keep))}`;
  const hit = damageCache.get(ck);
  if (hit) return hit;
  const W = room.x1 - room.x0;
  const H = room.bottom - room.top;
  const wall = new Px(W, H);
  const front = new Px(W, H);
  const theme = { base: room.color ?? 0x6a58b8 };
  const outer = room.outer ?? true;

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

// ------------------------------------------------------------------ features (baked parts)
const BRASS = 0xf0d070;
const BRASS_D = 0xb08a30;
const SLIDE_C = 0xffb040;
const LIFT_C = 0x8ad0ff;
const PORTAL_C = 0xc060ff;

function drawFeatures(p: Px, L: Layout) {
  for (const pole of L.poles) drawPole(p, pole.x, L.byId[pole.upper].top + 2, pole.topY, pole.bottomY);
  for (const s of L.slides) drawSlideArt(p, s, L.byId[s.lower].top);
  for (const lf of L.lifts) drawShaft(p, lf);
  for (const t of L.tramps) drawTrampHatch(p, t);
  for (const pt of L.portals) for (const e of pt.ends) drawFrame(p, e.x, e.floor);
  for (const sw of L.switches) {
    p.rect(sw.x - 4, sw.y - 6, 9, 12, INK);
    p.rect(sw.x - 3, sw.y - 5, 7, 10, 0xf0e8d0);
    p.hline(sw.x - 3, sw.y + 4, 7, 0xb8b0a0);
  }
  for (const tr of L.traps) drawRug(p, tr);
}

function drawPole(p: Px, x: number, top: number, upperFloor: number, bottom: number) {
  // Hole in the upper floor the pole drops through.
  for (let y = upperFloor; y < upperFloor + SLAB; y++)
    for (let xx = x - 5; xx <= x + 5; xx++) p.set(xx, y, xx === x - 5 || xx === x + 5 ? INK : 0x05030a);
  p.hline(x - 6, upperFloor, 13, INK);
  // Ceiling bracket.
  p.rect(x - 4, top - 2, 9, 3, INK);
  p.rect(x - 3, top - 1, 7, 1, 0x8a8a9a);
  for (let y = top; y < bottom; y++) {
    p.set(x - 2, y, INK);
    p.set(x - 1, y, mix(BRASS, 0xffffff, 0.5));
    p.set(x, y, BRASS);
    p.set(x + 1, y, BRASS_D);
    p.set(x + 2, y, INK);
  }
  // Landing mat.
  p.rect(x - 7, bottom - 2, 15, 2, INK);
  p.rect(x - 6, bottom - 2, 13, 1, 0xe8504a);
}

function drawSlideArt(p: Px, s: SlideGeo, lowerTop: number) {
  const N = 240;
  let lastX = -999;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const e = 1 - (1 - t) * (1 - t);
    const x = Math.round(s.x0 + (s.x1 - s.x0) * t);
    const y = Math.round(s.y0 + (s.y1 - s.y0) * e);
    p.set(x, y - 3, INK);
    p.set(x, y - 2, mix(SLIDE_C, 0xffffff, 0.45));
    p.set(x, y - 1, SLIDE_C);
    p.set(x, y, SLIDE_C);
    p.set(x, y + 1, shade(SLIDE_C, 0.7));
    p.set(x, y + 2, INK);
    // Posts down to the lower floor every 14 px.
    if (x !== lastX && (x - s.x0) % 14 === 7 && y > lowerTop + 2 && y < s.y1 - 6) {
      for (let yy = y + 3; yy < s.y1; yy++) {
        p.set(x, yy, INK);
        p.set(x + s.dir, yy, WOOD);
      }
    }
    lastX = x;
  }
  // Slot in the upper floor and a hazard lip marking the way in.
  for (let y = s.y0; y < s.y0 + SLAB; y++) for (let x = s.x0 - 4; x <= s.x0 + 4; x++) if (!(y > s.y0 + 1 && Math.abs(x - s.x0) < 3)) p.set(x, y, 0x05030a);
  for (let x = s.x0 - 7; x <= s.x0 + 7; x++) {
    p.set(x, s.y0 - 1, (x + s.y0) % 4 < 2 ? HAZARD : INK);
  }
}

function drawShaft(p: Px, lf: LiftGeo) {
  const top = lf.stops[0].floor - 34;
  const bot = lf.stops[lf.stops.length - 1].floor;
  for (let y = top; y < bot; y++)
    for (let x = lf.x - 8; x <= lf.x + 8; x++) {
      const edge = x === lf.x - 8 || x === lf.x + 8;
      const rail = x === lf.x - 6 || x === lf.x + 6;
      p.set(x, y, edge ? INK : rail ? shade(LIFT_C, 0.55) : y % 10 === 0 ? 0x2a3450 : 0x1a2238);
    }
  p.rect(lf.x - 9, top - 3, 19, 3, INK);
  p.rect(lf.x - 8, top - 2, 17, 1, 0x8a8a9a);
  p.vline(lf.x, top, 4, 0xb0b8c8);
  for (const s of lf.stops) {
    const y = s.floor;
    // Hatch frame at each stop, with a hazard header and a call plate.
    p.rect(lf.x - 10, y - 25, 21, 2, INK);
    for (let x = lf.x - 9; x <= lf.x + 9; x++) p.set(x, y - 24, (x + y) % 4 < 2 ? HAZARD : INK);
    for (let yy = y - 23; yy < y; yy++) {
      p.set(lf.x - 10, yy, INK);
      p.set(lf.x - 9, yy, LIFT_C);
      p.set(lf.x + 9, yy, LIFT_C);
      p.set(lf.x + 10, yy, INK);
    }
    p.rect(lf.x + 11, y - 17, 5, 8, INK);
    p.rect(lf.x + 12, y - 16, 3, 6, 0xd8d8e0);
    p.set(lf.x + 13, y - 15, 0x5cc85a);
    p.set(lf.x + 13, y - 12, 0xe8504a);
  }
}

function drawTrampHatch(p: Px, t: TrampGeo) {
  // An open hatch in the ceiling (the floor above), lid hinged up.
  for (let y = t.ceilY; y < t.ceilY + SLAB; y++) for (let x = t.x - 9; x <= t.x + 9; x++) p.set(x, y, Math.abs(x - t.x) === 9 ? INK : 0x05030a);
  for (let x = t.x - 10; x <= t.x + 10; x++) p.set(x, t.ceilY + SLAB, (x + 1) % 4 < 2 ? 0xff7aa0 : INK);
  // Dashed "boing" arrow from the bed up to the hatch.
  const yTop = t.ceilY + SLAB + 3;
  for (let y = yTop + 5; y < t.bedY - 16; y++) if (y % 5 < 3) {
    p.set(t.x, y, HAZARD);
    p.set(t.x - 1, y, INK);
    p.set(t.x + 1, y, INK);
  }
  rows(p, t.x - 3, yTop, ['...k...', '..kyk..', '.kyyyk.', 'kyyyyyk', 'kkkykkk'], { k: INK, y: HAZARD });
}

function drawFrame(p: Px, x: number, floor: number) {
  const y0 = floor - 32;
  p.rect(x - 10, y0 - 1, 21, 26, INK);
  p.rect(x - 9, y0, 19, 24, 0xd8a840);
  p.rect(x - 9, y0, 19, 1, 0xffe08a);
  p.rect(x - 9, y0 + 23, 19, 1, 0x8a6020);
  p.rect(x - 7, y0 + 2, 15, 20, INK);
  p.rect(x - 6, y0 + 3, 13, 18, 0x2a0a4a);
  for (const [dx, dy] of [[-9, 0], [9, 0], [-9, 23], [9, 23]]) p.set(x + dx, y0 + dy, 0xffffff);
}

function drawRug(p: Px, tr: TrapGeo) {
  const y = tr.floor;
  // Trapdoor seams in the slab under the rug.
  for (let yy = y; yy < y + SLAB; yy++) {
    p.set(tr.x0, yy, INK);
    p.set(tr.x1 - 1, yy, INK);
  }
  for (let x = tr.x0; x < tr.x1; x++) {
    p.set(x, y - 3, INK);
    p.set(x, y - 2, x % 4 < 2 ? 0xe05050 : 0xffe08a);
    p.set(x, y - 1, 0xa83a3a);
  }
  p.set(tr.x0, y - 2, INK);
  p.set(tr.x1 - 1, y - 2, INK);
  // Lever base.
  p.rect(tr.leverX - 3, y - 3, 7, 3, INK);
  p.rect(tr.leverX - 2, y - 2, 5, 1, 0x8a8a9a);
}

/** Textures for animated feature parts (separate images over the baked house). */
function makeFeatureTextures(scene: Phaser.Scene) {
  make(scene, 'portal-swirl', 13, 18, (p) => {
    for (let y = 0; y < 18; y++)
      for (let x = 0; x < 13; x++) {
        const dx = (x - 6) / 6.5;
        const dy = (y - 8.5) / 9;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 1) continue;
        const a = Math.atan2(dy, dx) + d * 7;
        const band = Math.floor(((a / (Math.PI * 2)) * 3 + 30) % 3);
        p.set(x, y, d < 0.2 ? 0xffffff : band === 0 ? PORTAL_C : band === 1 ? 0x6a2ab8 : 0xff9af0);
      }
  });
  make(scene, 'tramp-bed', 28, 10, (p) => {
    p.box(2, 1, 24, 3, 0xff7aa0);
    p.hline(3, 2, 22, 0xffc0d8);
    for (let x = 4; x < 25; x += 4) p.line(x, 4, x + 1, 7, 0xb0b8c8);
    p.box(1, 7, 3, 2, 0x5a5a6a);
    p.box(24, 7, 3, 2, 0x5a5a6a);
  });
  make(scene, 'tramp-bed-boing', 28, 10, (p) => {
    for (let x = 2; x < 26; x++) {
      const sag = Math.round(Math.sin(((x - 2) / 24) * Math.PI) * 3);
      p.set(x, 2 + sag, INK);
      p.set(x, 3 + sag, 0xff7aa0);
      p.set(x, 4 + sag, 0xff7aa0);
      p.set(x, 5 + sag, INK);
    }
    p.box(1, 7, 3, 2, 0x5a5a6a);
    p.box(24, 7, 3, 2, 0x5a5a6a);
  });
  make(scene, 'lift-car', 15, 22, (p) => {
    p.box(1, 1, 13, 20, 0x4a6a9a);
    p.rect(3, 3, 9, 14, 0x1a2238);
    for (let x = 4; x < 12; x += 2) p.vline(x, 3, 14, LIFT_C);
    p.rect(1, 18, 13, 2, 0x8ad0ff);
    p.vline(7, 0, 1, INK);
  });
  make(scene, 'bookcase-door', 12, DOOR_H + 3, (p) => {
    p.box(1, 1, 10, DOOR_H + 1, WOOD_D);
    const cols = [0xe8504a, 0x4a8be8, 0xf2c94c, 0x5cc85a, 0xc070ff];
    for (let s = 0; s < 4; s++) {
      const y = 3 + s * 7;
      p.rect(2, y, 8, 6, shade(WOOD_D, 0.55));
      for (let x = 2, i = s; x < 10; x += 2, i++) p.rect(x, y + 6 - (4 + (i % 2)), 2, 4 + (i % 2), cols[i % cols.length]);
      p.hline(2, y + 6, 8, WOOD);
    }
  });
  make(scene, 'switch-on', 3, 6, (p) => {
    p.rect(0, 0, 3, 6, INK);
    p.rect(1, 1, 1, 2, 0xffe060);
  });
  make(scene, 'switch-off', 3, 6, (p) => {
    p.rect(0, 0, 3, 6, INK);
    p.rect(1, 3, 1, 2, 0x8a8a9a);
  });
  make(scene, 'lever', 9, 14, (p) => {
    p.line(4, 13, 4, 3, INK);
    p.line(5, 13, 5, 3, 0xd8d8e0);
    p.disc(4, 2, 2, 0xe05050);
    p.outline();
  });
  make(scene, 'trap-open', 26, 10, (p) => {
    for (let y = 0; y < SLAB; y++) for (let x = 0; x < 26; x++) p.set(x, y, 0x05030a);
    // Two flaps hanging down.
    for (let y = 0; y < 10; y++) {
      p.set(0, y, INK);
      p.set(1, y, 0xa83a3a);
      p.set(2, y, INK);
      p.set(23, y, INK);
      p.set(24, y, 0xa83a3a);
      p.set(25, y, INK);
    }
  });
  make(scene, 'lamp-disco', 13, 16, (p) => {
    p.vline(6, 0, 5, INK);
    p.disc(6, 10, 5, 0xc8d0e0);
    for (let y = 5; y < 16; y++) for (let x = 1; x < 12; x++) if (p.opaque(x, y) && (x + y) % 3 === 0) p.set(x, y, (x * y) % 2 ? 0xffffff : 0x8a90a8);
    p.set(4, 8, 0xff60c0);
    p.set(8, 12, 0x60e0ff);
    p.outline();
  });
}

/** Furniture for the procedural room themes (sensible and goofy). */
function makeThemeFurniture(scene: Phaser.Scene) {
  const F = (key: string, w: number, h: number, draw: (p: Px) => void) => make(scene, key, w, h, draw, true, false);
  const W_ = (key: string, w: number, h: number, draw: (p: Px) => void) => make(scene, key, w, h, draw, false, false);
  const COLS = [0xe8504a, 0x4a8be8, 0xf2c94c, 0x5cc85a, 0xc070ff, 0xff9a40];

  F('washer', 18, 20, (p) => {
    p.box(1, 1, 16, 18, 0xe8ecf8);
    p.rect(2, 2, 14, 3, 0xc0c8dc);
    p.set(4, 3, 0x5cc85a);
    p.disc(9, 12, 5, INK);
    p.disc(9, 12, 4, 0x58b8f8);
    p.rect(7, 11, 3, 2, 0xe8504a);
  });
  F('jars', 22, 30, (p) => {
    for (const x of [1, 19]) p.box(x, 1, 2, 28, WOOD_D);
    for (const y of [9, 19, 28]) p.box(1, y, 20, 1, WOOD);
    for (let s = 0; s < 3; s++)
      for (let k = 0; k < 3; k++) {
        const x = 4 + k * 5;
        const y = 2 + s * 10;
        p.box(x, y + 2, 4, 5, COLS[(s * 3 + k) % COLS.length]);
        p.rect(x, y + 1, 4, 1, 0xb0b8c8);
      }
  });
  F('table', 34, 16, (p) => {
    p.box(5, 5, 24, 2, WOOD);
    p.box(8, 7, 2, 8, WOOD_D);
    p.box(24, 7, 2, 8, WOOD_D);
    p.box(14, 2, 6, 3, 0xffffff);
    p.set(16, 1, 0xe8504a);
    for (const x of [1, 30]) {
      p.box(x, 1, 2, 14, WOOD_D);
      p.box(x === 1 ? 1 : 28, 8, 5, 2, WOOD);
    }
  });
  F('coatrack', 12, 34, (p) => {
    p.vline(6, 3, 29, INK);
    p.vline(5, 3, 29, WOOD);
    p.box(2, 32, 8, 1, WOOD_D);
    p.box(1, 4, 4, 10, 0x8a3a3a);
    p.box(7, 6, 4, 8, 0x3a5a8a);
    p.box(3, 1, 6, 2, 0x5a5a6a);
  });
  F('crib', 30, 20, (p) => {
    p.box(1, 2, 2, 17, 0xf0f0f8);
    p.box(27, 2, 2, 17, 0xf0f0f8);
    p.box(3, 4, 24, 1, 0xf0f0f8);
    p.box(3, 13, 24, 2, 0xf0f0f8);
    for (let x = 5; x < 26; x += 3) p.vline(x, 5, 8, 0xd0d0e0);
    p.box(5, 10, 8, 3, 0x9ad0ff);
    p.box(15, 9, 5, 4, 0xf2c94c);
  });
  F('piano', 30, 26, (p) => {
    p.box(1, 2, 28, 18, 0x3a2a2a);
    p.rect(3, 4, 24, 6, 0x5a3a3a);
    p.box(1, 12, 28, 3, 0xf4f0e8);
    for (let x = 3; x < 28; x += 3) p.set(x, 12, INK);
    p.box(3, 20, 2, 5, 0x3a2a2a);
    p.box(25, 20, 2, 5, 0x3a2a2a);
    p.box(10, 0, 5, 2, 0xf2c94c);
  });
  F('speaker', 12, 22, (p) => {
    p.box(1, 1, 10, 20, 0x2a2a3a);
    p.disc(6, 6, 3, INK);
    p.disc(6, 6, 2, 0x5a5a6a);
    p.disc(6, 14, 4, INK);
    p.disc(6, 14, 3, 0x5a5a6a);
    p.set(6, 14, 0xc070ff);
  });
  F('boiler', 22, 34, (p) => {
    p.box(2, 3, 18, 28, 0xa83a2a);
    p.rect(4, 5, 3, 24, mix(0xa83a2a, 0xffffff, 0.3));
    p.disc(14, 10, 4, INK);
    p.disc(14, 10, 3, 0xf0f0f0);
    p.line(14, 10, 16, 8, 0xe8504a);
    p.box(6, 22, 10, 6, 0x2a1a1a);
    p.rect(8, 24, 6, 3, 0xff9a40);
    p.box(9, 0, 4, 3, 0x8a90a8);
  });
  F('barrels', 26, 18, (p) => {
    for (const x of [1, 13]) {
      p.box(x, 2, 11, 15, 0x9a6a3a);
      p.hline(x, 5, 11, 0x5a5a6a);
      p.hline(x, 13, 11, 0x5a5a6a);
      p.vline(x + 3, 3, 13, shade(0x9a6a3a, 0.8));
    }
  });
  F('pooltable', 40, 16, (p) => {
    p.box(1, 3, 38, 5, 0x2a8a4a);
    p.rect(1, 3, 38, 1, WOOD);
    p.box(1, 8, 38, 2, WOOD_D);
    p.box(3, 10, 3, 5, WOOD_D);
    p.box(34, 10, 3, 5, WOOD_D);
    p.set(12, 2, 0xffffff);
    p.set(20, 2, 0xe8504a);
    p.set(23, 2, 0xf2c94c);
    p.line(26, 1, 38, 0, WOOD);
  });
  F('arcade', 16, 32, (p) => {
    p.box(1, 2, 14, 29, 0x3a2a8a);
    p.box(1, 0, 14, 4, 0xff60c0);
    p.rect(3, 6, 10, 9, INK);
    p.vgrad(4, 7, 8, 7, 0x40c0ff, 0x2a3aa0);
    p.set(6, 9, 0xf2c94c);
    p.box(2, 17, 12, 3, 0x5a4ab8);
    p.set(5, 17, 0xe8504a);
    p.set(9, 18, 0x5cc85a);
    p.set(11, 18, 0x4a8be8);
  });
  F('cattree', 18, 34, (p) => {
    p.box(7, 6, 4, 26, 0xd8c098);
    for (let y = 8; y < 32; y += 3) p.hline(7, y, 4, 0xb89a70);
    p.box(1, 4, 16, 3, 0x9a6ac8);
    p.box(3, 18, 12, 3, 0x9a6ac8);
    p.box(1, 31, 16, 2, 0x9a6ac8);
    p.box(11, 0, 5, 4, 0xf2a040);
    p.set(12, 0, INK);
  });
  F('cat', 12, 9, (p) => {
    const c = 0xf2a040;
    p.box(2, 4, 8, 4, c);
    p.box(7, 1, 4, 4, c);
    p.set(7, 0, c);
    p.set(10, 0, c);
    p.set(8, 2, INK);
    p.line(2, 4, 0, 1, c);
    p.outline();
  });
  F('trophycase', 22, 32, (p) => {
    p.box(1, 1, 20, 30, WOOD_D);
    p.rect(3, 3, 16, 26, 0x6a8ab0);
    for (const y of [11, 20]) p.hline(3, y, 16, WOOD);
    for (const [x, y] of [[6, 5], [13, 5], [9, 14], [6, 23], [14, 23]]) {
      p.rect(x, y, 3, 3, 0xf2c94c);
      p.set(x + 1, y + 3, 0xc89a20);
      p.rect(x, y + 4, 3, 1, 0xc89a20);
    }
  });
  F('trophy', 12, 18, (p) => {
    p.box(2, 1, 8, 6, 0xf2c94c);
    p.set(1, 2, 0xf2c94c);
    p.set(10, 2, 0xf2c94c);
    p.box(5, 7, 2, 4, 0xc89a20);
    p.box(2, 12, 8, 5, 0x5a3a2a);
    p.set(4, 2, 0xffffff);
  });
  F('yarn', 8, 7, (p) => {
    p.disc(4, 3, 3, 0xe85080);
    p.line(2, 1, 6, 5, mix(0xe85080, 0xffffff, 0.4));
    p.line(1, 4, 5, 1, mix(0xe85080, 0xffffff, 0.4));
    p.outline();
  });
  F('basket', 14, 12, (p) => {
    p.box(1, 4, 12, 7, 0xc89a5a);
    for (let x = 2; x < 13; x += 2) p.vline(x, 5, 5, 0x9a6a3a);
    p.disc(5, 3, 2, 0x4a8be8);
    p.disc(9, 3, 2, 0x5cc85a);
    p.line(11, 0, 7, 4, 0xd8d8e0);
  });
  F('rockchair', 20, 22, (p) => {
    p.box(4, 1, 4, 14, WOOD);
    p.box(4, 11, 13, 3, WOOD);
    p.box(5, 3, 2, 8, 0xc85a8a);
    for (let x = 1; x < 20; x++) p.set(x, 20 - Math.round(((x - 10) / 9) ** 2 * 2), WOOD_D);
    p.vline(6, 14, 5, WOOD_D);
    p.vline(15, 14, 5, WOOD_D);
  });
  F('bigplant', 18, 32, (p) => {
    p.box(4, 22, 10, 9, 0xc8603a);
    for (const [x, y, r] of [[9, 6, 4], [4, 12, 4], [14, 11, 4], [8, 16, 4], [12, 3, 3]]) p.disc(x, y, r, 0x3a9a4a);
    for (const [x, y] of [[8, 4], [3, 10], [13, 9], [7, 14]]) p.set(x, y, 0x8ad070);
    p.vline(9, 16, 6, 0x2a6a2a);
    p.outline();
  });
  F('slide-toy', 30, 22, (p) => {
    p.box(2, 2, 3, 19, 0x4a8be8);
    for (let y = 5; y < 20; y += 4) p.hline(1, y, 6, 0xf2c94c);
    for (let x = 5; x < 29; x++) {
      const y = 3 + Math.round(((x - 5) / 24) * 15);
      p.set(x, y, INK);
      p.set(x, y + 1, 0xe8504a);
      p.set(x, y + 2, 0xe8504a);
      p.set(x, y + 3, INK);
    }
  });
  F('mic', 8, 26, (p) => {
    p.box(3, 1, 3, 4, 0x8a90a8);
    p.vline(4, 5, 19, INK);
    p.box(1, 24, 7, 1, 0x5a5a6a);
  });
  F('mirrorstand', 12, 30, (p) => {
    p.box(1, 1, 10, 22, 0xf2c94c);
    p.vgrad(3, 3, 6, 18, 0xc8f0ff, 0x58b8f8);
    p.line(4, 8, 7, 5, 0xffffff);
    p.vline(5, 23, 5, WOOD_D);
    p.box(2, 28, 8, 1, WOOD_D);
  });
  F('snackshelf', 24, 32, (p) => {
    for (const x of [1, 21]) p.box(x, 1, 2, 30, 0x8a90a8);
    for (const y of [10, 20, 30]) p.box(1, y, 22, 1, 0xb0b8c8);
    for (let s = 0; s < 3; s++)
      for (let k = 0; k < 3; k++) p.box(4 + k * 6, 3 + s * 10, 4, 6, COLS[(s + k * 2) % COLS.length]);
  });
  F('vault', 28, 34, (p) => {
    p.box(1, 1, 26, 32, 0x8a90a8);
    p.disc(14, 16, 10, INK);
    p.disc(14, 16, 9, 0xb0b8c8);
    p.disc(14, 16, 3, 0x5a5a6a);
    for (let a = 0; a < 6; a++) p.line(14, 16, 14 + Math.round(Math.cos(a) * 7), 16 + Math.round(Math.sin(a) * 7), 0x5a5a6a);
    p.rect(3, 3, 3, 3, 0xd8d8e0);
    p.rect(22, 3, 3, 3, 0xd8d8e0);
  });
  F('sockpile', 34, 12, (p) => {
    for (let k = 0; k < 6; k++) {
      const x = 2 + k * 5;
      const c = COLS[k % COLS.length];
      p.box(x, 4 + (k % 2) * 2, 7, 4, c);
      p.hline(x, 5 + (k % 2) * 2, 7, 0xffffff);
    }
  });
  F('shoes', 14, 6, (p) => {
    p.box(1, 2, 5, 3, 0x8a3a3a);
    p.box(8, 2, 5, 3, 0x8a3a3a);
    p.hline(1, 2, 2, 0xffffff);
    p.hline(8, 2, 2, 0xffffff);
  });
  F('milk', 16, 32, (p) => {
    p.box(1, 8, 14, 23, 0xf4f4fa);
    p.box(3, 2, 10, 6, 0xf4f4fa);
    p.rect(3, 1, 10, 1, 0x4a8be8);
    p.rect(2, 14, 12, 8, 0x4a8be8);
    p.rect(5, 16, 6, 3, 0xffffff);
  });
  F('cheese', 24, 14, (p) => {
    for (let y = 2; y < 13; y++) {
      const w = Math.round(((y - 2) / 10) * 22);
      p.rect(1, y, w, 1, 0xf2c94c);
    }
    p.disc(8, 10, 1, 0xc89a20);
    p.disc(14, 11, 2, 0xc89a20);
    p.outline();
  });
  F('egg', 12, 16, (p) => {
    for (let y = 1; y < 15; y++)
      for (let x = 1; x < 11; x++) {
        const dx = (x - 5.5) / 4.5;
        const dy = (y - 8.5) / (y < 8 ? 7.5 : 6.5);
        if (dx * dx + dy * dy <= 1) p.set(x, y, x < 4 && y < 7 ? 0xffffff : 0xf0e0c8);
      }
    p.outline();
  });
  F('boat', 44, 26, (p) => {
    p.box(3, 16, 38, 7, 0xf0f0f8);
    p.rect(3, 16, 38, 2, 0xe8504a);
    p.set(8, 23, 0xf2c94c);
    p.set(36, 23, 0xf2c94c);
    p.vline(22, 1, 15, WOOD_D);
    for (let y = 2; y < 14; y++) p.rect(23, y, Math.round((y - 1) * 1.2), 1, 0xffffff);
    p.box(10, 12, 6, 4, 0xf2c94c);
    p.set(15, 13, 0xe8804a);
  });
  F('grandpiano', 44, 26, (p) => {
    p.box(2, 8, 40, 8, 0x1a1a24);
    p.line(4, 7, 30, 0, INK);
    p.line(4, 8, 30, 1, 0x3a3a4a);
    p.box(2, 13, 14, 2, 0xf4f0e8);
    for (let x = 3; x < 16; x += 2) p.set(x, 13, INK);
    for (const x of [4, 22, 38]) p.box(x, 16, 2, 9, 0x1a1a24);
  });
  F('tent', 40, 30, (p) => {
    const c = 0xe880b0;
    for (let y = 2; y < 29; y++) {
      const hw = Math.round(((y - 2) / 27) * 19);
      p.rect(20 - hw, y, hw * 2, 1, (Math.floor((20 - hw) / 1) + y) % 9 === 0 ? 0xffffff : c);
    }
    for (let y = 12; y < 29; y++) {
      const hw = Math.round(((y - 12) / 17) * 6);
      p.rect(20 - hw, y, hw * 2, 1, 0x3a1a3a);
    }
    p.vline(20, 0, 3, WOOD_D);
    p.set(21, 0, 0xf2c94c);
    p.outline();
  });
  F('pillows', 28, 14, (p) => {
    const cs = [0xf0c0e0, 0x9ad0ff, 0xfff0a0, 0xc0f0c0];
    for (let k = 0; k < 4; k++) {
      const x = 1 + (k % 3) * 9;
      const y = k < 3 ? 6 : 1;
      p.box(x, y, 9, 6, cs[k]);
      p.set(x + 4, y + 3, shade(cs[k], 0.8));
    }
  });
  F('pendulum', 20, 40, (p) => {
    p.vline(10, 0, 30, 0xc89a20);
    p.disc(10, 32, 6, INK);
    p.disc(10, 32, 5, 0xf2c94c);
    p.set(8, 30, 0xffffff);
    p.box(2, 0, 16, 2, WOOD_D);
  });
  F('jelly', 18, 18, (p) => {
    for (let y = 2; y < 17; y++) {
      const hw = 5 + Math.round(((y - 2) / 14) * 3);
      for (let x = 9 - hw; x < 9 + hw; x++) p.set(x, y, (y % 4 === 0) ? 0xff8a8a : 0xe84a5a);
    }
    p.rect(5, 4, 2, 6, 0xffc0c0);
    p.rect(1, 17, 16, 1, 0xd8d8e0);
    p.outline();
  });
  F('tinydoor', 10, 14, (p) => {
    p.box(1, 1, 8, 12, 0xa8302a);
    p.set(6, 7, TRIM);
    p.rect(2, 2, 6, 1, 0xe8504a);
  });
  F('moonflag', 14, 26, (p) => {
    p.vline(2, 1, 24, 0xd8d8e0);
    p.box(3, 2, 10, 7, 0xffffff);
    p.rect(4, 3, 4, 3, 0x4a8be8);
    p.hline(4, 7, 8, 0xe8504a);
  });
  F('rocket', 18, 36, (p) => {
    for (let y = 1; y < 28; y++) {
      const hw = y < 8 ? Math.round(y * 0.6) + 1 : 5;
      p.rect(9 - hw, y, hw * 2, 1, y < 6 ? 0xe8504a : 0xf0f0f8);
    }
    p.disc(9, 13, 2, 0x58b8f8);
    p.box(1, 22, 3, 8, 0xe8504a);
    p.box(14, 22, 3, 8, 0xe8504a);
    p.rect(6, 28, 6, 3, 0xff9a40);
    p.rect(7, 31, 4, 3, 0xf2c94c);
    p.outline();
  });

  // Wall hangings.
  W_('tank', 44, 26, (p) => {
    p.box(1, 1, 42, 23, 0x2a7ab8);
    p.vgrad(2, 3, 40, 20, 0x58c8f8, 0x1a4a8a);
    p.rect(1, 1, 42, 2, 0x5a5a6a);
    for (const [x, y, c] of [[10, 9, 0xff9a40], [26, 14, 0xf2c94c], [33, 7, 0xe8504a]] as const) {
      p.rect(x, y, 4, 3, c);
      p.set(x - 1, y + 1, c);
      p.set(x + 4, y, c);
      p.set(x + 4, y + 2, c);
      p.set(x + 2, y + 1, INK);
    }
    for (let y = 14; y < 23; y++) {
      p.set(6 + Math.round(Math.sin(y / 2)), y, 0x3a9a4a);
      p.set(38 + Math.round(Math.cos(y / 2)), y, 0x3a9a4a);
    }
    p.rect(2, 21, 40, 2, 0xe0c890);
    p.set(20, 5, 0xffffff);
    p.set(21, 3, 0xffffff);
  });
  W_('trophyshelf', 30, 14, (p) => {
    p.box(1, 11, 28, 2, WOOD);
    for (const x of [4, 13, 22]) {
      p.box(x, 3, 5, 4, 0xf2c94c);
      p.box(x + 1, 7, 3, 3, 0xc89a20);
    }
  });
  W_('fishframe', 16, 12, (p) => {
    p.box(1, 1, 14, 10, 0xe8e0d0);
    p.rect(3, 3, 10, 6, 0x58b8f8);
    p.rect(5, 5, 5, 2, 0xff9a40);
    p.set(10, 4, 0xff9a40);
    p.set(10, 7, 0xff9a40);
  });
  W_('doily', 14, 14, (p) => {
    p.disc(7, 7, 6, 0xf4f0e8);
    for (let a = 0; a < 12; a++) p.set(7 + Math.round(Math.cos(a / 1.9) * 5), 7 + Math.round(Math.sin(a / 1.9) * 5), 0xc8b8a0);
    p.disc(7, 7, 2, 0xe85080);
    p.outline();
  });
  W_('hats', 30, 12, (p) => {
    p.box(1, 1, 28, 1, WOOD);
    p.box(3, 4, 7, 4, 0x2a2a3a);
    p.box(1, 8, 11, 1, 0x2a2a3a);
    p.box(15, 5, 6, 3, 0xe8504a);
    p.box(14, 8, 9, 1, 0xe8504a);
    p.box(25, 3, 3, 6, 0xf2c94c);
    p.set(26, 2, 0x5cc85a);
  });
  W_('sock', 10, 16, (p) => {
    const c = 0xe8504a;
    p.box(2, 1, 4, 10, c);
    p.box(2, 10, 7, 4, c);
    p.hline(2, 3, 4, 0xffffff);
    p.hline(2, 6, 4, 0xffffff);
  });
}
