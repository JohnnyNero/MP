import type Phaser from 'phaser';
import { PLAYER_COLORS } from '../config';

// Option C "Chunky 16-bit" art for characters, hazards and pickups.
// Everything is drawn from tiny pixel maps onto canvas textures at boot.
// Palette values are CSS colours; a two-element array means a 1px checker
// dither of the two colours (null = transparent).

type Ink = string | [string | null, string | null];
type Pal = Record<string, Ink>;

const OUTLINE = '#140c1c';

interface TexOpts {
  /** Draw a 1px outline around the shape (adds 1px on every side). */
  outline?: string | null;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function hex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
function shade(h: string, f: number): string {
  const [r, g, b] = rgb(h);
  return hex(r * f, g * f, b * f);
}
function lighten(h: string, f: number): string {
  const [r, g, b] = rgb(h);
  return hex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}
const hexOf = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Paint a pixel map (optionally outlined) into a fresh canvas texture under `key`. */
function tex(scene: Phaser.Scene, key: string, rows: string[], pal: Pal, opts: TexOpts = {}) {
  const w0 = Math.max(...rows.map((r) => r.length));
  const h0 = rows.length;
  const pad = opts.outline ? 1 : 0;
  const w = w0 + pad * 2;
  const h = h0 + pad * 2;
  const at = (x: number, y: number) => (y >= 0 && y < h0 && x >= 0 && x < w0 ? (rows[y][x] ?? '.') : '.');
  const solid = (x: number, y: number) => {
    const c = at(x, y);
    if (c === '.' || pal[c] === undefined) return false;
    const p = pal[c];
    if (Array.isArray(p)) return p[(x + y) & 1] !== null;
    return true;
  };

  if (scene.textures.exists(key)) scene.textures.remove(key);
  const ct = scene.textures.createCanvas(key, w, h);
  if (!ct) return;
  const ctx = ct.getContext();
  ctx.clearRect(0, 0, w, h);

  if (opts.outline) {
    ctx.fillStyle = opts.outline;
    for (let y = -1; y <= h0; y++)
      for (let x = -1; x <= w0; x++) {
        if (solid(x, y)) continue;
        if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) ctx.fillRect(x + pad, y + pad, 1, 1);
      }
  }
  for (let y = 0; y < h0; y++)
    for (let x = 0; x < w0; x++) {
      const c = at(x, y);
      const p = pal[c];
      if (c === '.' || p === undefined) continue;
      const col = Array.isArray(p) ? p[(x + y) & 1] : p;
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x + pad, y + pad, 1, 1);
    }
  ct.refresh();
}

// ---------------------------------------------------------------- players
// 14x16 maps; with the outline every frame is 16x18. Facing right.
// h hair, H hair shine, s skin, e eye, w eye shine, r blush, m mouth,
// c shirt, l shirt light, x shirt dither, p pants, b shoe, k ink, W sweat.

const HEAD = [
  '....hhhhhh....',
  '..hhhhhhhhhh..',
  '.hhHHHhhhhhhh.',
  '.hHHhhhhhhhhhh',
  '.hhhhhshhhshhh',
  '.hhhssssssssss',
  '.hhssewssssews',
  '.hhsseessssees',
  '..hsrsssmssr..',
];
const face = (r6: string, r7: string, r8: string) => [...HEAD.slice(0, 6), r6, r7, r8];
const HEAD_JUMP = face('.hhssewssssews', '.hhsseessssees', '..hsrssmmssr..');
const HEAD_FALL = face('.hhsswwsssswws', '.hhsswesssswes', '..hsrssskssr..');
const HEAD_HURT = (() => {
  const h = face('.hhsskksssskks', '.hhsssssssssss', '..hsrskmksr...');
  h[0] = '..h.hhh.hh.h..';
  h[4] = '.hhhhhshhhshhW';
  return h;
})();

const BODY_IDLE = [
  '....cccccc....',
  '...cllccccc...',
  '..scllcccccs..',
  '...xxxxxxxx...',
  '....pppppp....',
  '....pp..pp....',
  '...bbb..bbb...',
];
const BODY_RUN_A = [
  '....cccccc.s..',
  '...cllccccs...',
  '..scclcccc....',
  '...xxxxxxxx...',
  '...pppppppp...',
  '..pp.....pp...',
  '.bbb......bb..',
];
const BODY_RUN_B = [
  '....cccccc....',
  '...cllcccc....',
  '...scllcccs...',
  '...xxxxxxxx...',
  '....pppppp....',
  '.....pppbb....',
  '.....bbb......',
];
const BODY_RUN_C = [
  '..s.cccccc....',
  '...scllcccc...',
  '....cllccccs..',
  '...xxxxxxxx...',
  '...pppppppp...',
  '..pp.....pp...',
  '.bb......bbb..',
];
const BODY_JUMP = [
  '....cccccc.s..',
  '...cllccccs...',
  '..scllcccc....',
  '...xxxxxxxx...',
  '....pppppp....',
  '...pp...ppb...',
  '..bb.....bb...',
];
const BODY_FALL = [
  '.s..cccccc..s.',
  '..cccllccccc..',
  '....cccccc....',
  '...xxxxxxxx...',
  '....pp..pp....',
  '....pp..pp....',
  '...bbb..bbb...',
];
const BODY_HURT = [
  '.s..cccccc..s.',
  '..cccllccccc..',
  '....cccccc....',
  '...xxxxxxxx...',
  '...pp....pp...',
  '..pp......pp..',
  '..bb......bb..',
];
const CLIMB = [
  '....hhhhhh....',
  '..hhhhhhhhhh..',
  '.hhHHHhhhhhhh.',
  'shHHhhhhhhhhh.',
  'chhhhhhhhhhhh.',
  '.chhhhhhhhhhh.',
  '.chhhhhhhhhhh.',
  '..chhhhhhhhh..',
  '..cssssssssc..',
  '..cccccccccc..',
  '..cccccccccc..',
  '...cccccccccs.',
  '...xxxxxxxx...',
  '....pppppp....',
  '....bb..pp....',
  '........bbb...',
];

const BLANK = '..............';
/** Head + body; `bob` drops the head 1px (squash) for breathing / run bounce. */
const frame = (head: string[], body: string[], bob = false) =>
  bob ? [BLANK, ...head, ...body.slice(1)] : [...head, ...body];
const mirror = (rows: string[]) => rows.map((r) => r.split('').reverse().join(''));
const nudge = (rows: string[], n: number) => rows.map((r, i) => (i < 9 ? ('.' + r).slice(0, r.length) : r)).slice(0, n);

const HAIR = ['#5a2a1a', '#ffd04a', '#2a1a4a', '#c8401a'];
const HAIR_SHINE = ['#9a5a3a', '#fff4b0', '#6a4a9a', '#ff8a4a'];

function avatarPal(i: number): Pal {
  const c = hexOf(PLAYER_COLORS[i]);
  const d = shade(c, 0.68);
  return {
    k: OUTLINE,
    e: OUTLINE,
    w: '#ffffff',
    s: '#ffc890',
    r: '#ff7a8a',
    m: '#a01a3a',
    W: '#8ad8ff',
    h: HAIR[i],
    H: HAIR_SHINE[i],
    c,
    l: lighten(c, 0.35),
    x: [c, d],
    p: '#3a3a7a',
    b: '#7a3a2a',
  };
}

/** Icy version of a palette for the frozen frame. */
function frozenPal(p: Pal): Pal {
  const ice = (col: string | null) => {
    if (!col) return col;
    const [r, g, b] = rgb(col);
    const lum = (0.3 * r + 0.55 * g + 0.15 * b) / 255;
    const t = Math.min(1, 0.08 + lum * 0.8);
    return hex(30 + 180 * t, 80 + 160 * t, 190 + 65 * t);
  };
  const out: Pal = {};
  for (const [k, v] of Object.entries(p)) out[k] = Array.isArray(v) ? [ice(v[0]), ice(v[1])] : (ice(v) as string);
  out.k = '#1a2a6a';
  out.e = '#1a2a6a';
  return out;
}

function makePlayers(scene: Phaser.Scene) {
  const idle0 = frame(HEAD, BODY_IDLE);
  const frames: Record<string, string[]> = {
    idle0,
    idle1: frame(HEAD, BODY_IDLE, true),
    run0: frame(HEAD, BODY_RUN_A),
    run1: frame(HEAD, BODY_RUN_B, true),
    run2: frame(HEAD, BODY_RUN_C),
    run3: frame(HEAD, BODY_RUN_B, true),
    jump: frame(HEAD_JUMP, BODY_JUMP),
    fall: frame(HEAD_FALL, BODY_FALL),
    climb0: CLIMB,
    climb1: mirror(CLIMB),
    hurt0: frame(HEAD_HURT, BODY_HURT),
    hurt1: nudge(frame(HEAD_HURT, BODY_HURT), 16),
  };
  PLAYER_COLORS.forEach((_, i) => {
    const pal = avatarPal(i);
    const o = { outline: OUTLINE };
    for (const [name, rows] of Object.entries(frames)) tex(scene, `avatar${i}_${name}`, rows, pal, o);
    tex(scene, `avatar${i}_frozen`, idle0, frozenPal(pal), { outline: '#1a2a6a' });
    // Legacy keys (board panel tokens, older code paths).
    tex(scene, `avatar${i}`, idle0, pal, o);
    tex(scene, `avatar${i}run`, frames.run0, pal, o);
  });
}

// ---------------------------------------------------------------- hazards

function makeHazards(scene: Phaser.Scene) {
  const o = { outline: OUTLINE };

  // Meteor: glowing rock with a fire trail on top (falls downward). 10x12.
  const rock: Pal = {
    y: '#ffe040',
    o: '#ff8a1a',
    r: '#e83a1a',
    R: '#7a3a5a',
    Q: '#4a1a3a',
    L: '#a85a7a',
    G: '#ffd040',
  };
  const meteorBody = ['oRRRRRRo', 'RLLRRGRR', 'RLGGRRQR', 'RRRRGRQR', 'RRQRRRQR', '.RQQRQR.', '..RRRR..'];
  tex(scene, 'meteor', ['.y....y.', '.yo..oy.', 'yoorrooy', ...meteorBody], rock, o);
  tex(scene, 'meteor1', ['..y..y..', 'y.oyyo.y', 'oorrroor', ...meteorBody], rock, o);

  // Landing shadow (dithered soft edge). 10x3.
  tex(scene, 'shadow', ['.xkkkkkkx.', 'xkkkkkkkkx', '.xkkkkkkx.'], { k: '#000000', x: ['#000000', null] });

  // Monkey: chibi, big head, tan face. 10x10.
  const monk: Pal = { b: '#9a5a2a', B: '#6a3418', H: '#c8844a', t: '#ffc890', e: OUTLINE, m: '#c83a4a' };
  tex(scene, 'monkey', ['..bHHbb..', '.bHbbbbb.', 'tbttbttbt', '.btebteb.', '..ttttt.B', '...tmt..B', '.bbbtbbbB', '.bb...bb.'], monk, o);
  tex(scene, 'monkey1', ['..bHHbb..', '.bHbbbbb.', 'tbttbttbt', 'bbtebtebb', 'b.ttttt.b', '...tmt..B', '..bbtbbbB', '.bb...bbB'], monk, o);

  // Stampede beast: charging bull, head low, faces right. 18x10.
  const bull: Pal = { L: '#f08a4a', g: '#c8502a', d: '#7a2a1a', w: '#fff4d0', k: OUTLINE, n: '#ff9aa0', b: '#3a1a2a' };
  const bullTop = ['...LLLLLLL......', '.LLggggggggL.w..', 'dgggggggggggdww.', '.ggggggggggdddd.', '.ggggggggggddkdn', '.dddddddddd.dddn'];
  tex(scene, 'beast', [...bullTop, '..dd.dd..dd.dd..', '..bb.bb..bb.bb..'], bull, o);
  tex(scene, 'beast1', [...bullTop, '.dd..dd..dd..dd.', 'bb....bbbb....bb'], bull, o);

  // Flames: three flicker frames. 9x12, sits on its bottom edge.
  const fire: Pal = { r: '#e83a1a', o: '#ff8a1a', y: '#ffe040', w: '#fff8c0' };
  const fo = { outline: '#7a1a1a' };
  const flameBase = ['rroyyor', 'royyyor', 'roywyyr', 'royywor', 'rrooorr'];
  tex(scene, 'flame', ['...r...', '..rr...', '..ror..', '.rooor.', '.royor.', ...flameBase], fire, fo);
  tex(scene, 'flame1', ['....r..', '...rr..', '..ror..', '.roor..', '.royorr', ...flameBase], fire, fo);
  tex(scene, 'flame2', ['..r....', '..rr...', '..ror..', '..roor.', 'rroyor.', ...flameBase], fire, fo);

  // Vine segment, tiles vertically. 5x8.
  tex(scene, 'vine', ['..d..', 'Lgd..', '.gdk.', '..d..', '..dg.', '..dgL', '.kdg.', '..d..'], {
    d: '#1a6a2a',
    g: '#3aa83a',
    L: '#8ae04a',
    k: '#0e3a1a',
  });

  // Crate. 12x12.
  tex(
    scene,
    'crate',
    [
      'kkkkkkkkkkkk',
      'kLLLLLLLLLLk',
      'kLLwwwwwwLdk',
      'kLwLwwwwLwdk',
      'kLwwLwwLwwdk',
      'kLwwwLLwwwdk',
      'kLwwwLLwwwdk',
      'kLwwLwwLwwdk',
      'kLwLwwwwLwdk',
      'kLLwwwwwwLdk',
      'kddddddddddk',
      'kkkkkkkkkkkk',
    ],
    { k: OUTLINE, L: '#f0b05a', w: '#c0702a', d: '#7a3a1a' },
  );

  // Rubble. 6x4.
  tex(scene, 'debris', ['..lk.', '.lddl', 'lddkd'], { l: '#c8b8b0', d: '#8a7a88', k: '#4a3a4a' }, o);

  // Falling book. 8x6.
  tex(scene, 'book', ['.kkkkkkk', 'kRRRRRRk', 'kRRYYRRk', 'kRRRRRRk', 'kwwwwwwk', 'kkkkkkkk'], {
    k: OUTLINE,
    R: '#c82a6a',
    Y: '#ffd040',
    w: '#fff4d0',
  });

  // Floor vent grille. 12x5.
  tex(scene, 'vent', ['kkkkkkkkkkkk', 'kLdLdLdLdLLk', 'kmdmdmdmdmmk', 'kmmmmmmmmmmk', 'kkkkkkkkkkkk'], {
    k: OUTLINE,
    L: '#b8c0d8',
    m: '#6a7090',
    d: '#1a1a2a',
  });

  // Water surface tile (tiles horizontally). 8x4.
  tex(scene, 'water', ['.lw..lw.', 'lbbllbbl', 'bbbbbbbb', 'BbBbBbBb'], { l: '#8ad8ff', w: '#ffffff', b: '#3a8ae0', B: '#2a5ab0' });

  // Confetti spark: kept white/grey so it can be tinted. 3x3.
  tex(scene, 'spark', ['.g.', 'gwg', '.g.'], { g: '#d8d8d8', w: '#ffffff' });
}

// ---------------------------------------------------------------- goal items

function makePickups(scene: Phaser.Scene) {
  const o = { outline: OUTLINE };
  // Apple. 8x8.
  tex(scene, 'apple', ['..sgg.', '.rrsrr', 'rwrrrr', 'rrrrrd', 'rrrrdd', '.rddd.'], { s: '#7a3a1a', g: '#5ac83a', r: '#e8302a', w: '#ffb0a0', d: '#a01a2a' }, o);

  // Bomb with a lit fuse; two spark frames. 9x10.
  const bomb: Pal = { y: '#ffe040', o: '#ff8a1a', f: '#d8b080', b: '#3a3a6a', h: '#7a7ac8', H: '#ffffff' };
  const bombBody = ['...bf..', '.bbbbb.', 'bhHbbbb', 'bhbbbbb', 'bbbbbbb', '.bbbbb.'];
  tex(scene, 'bomb', ['....y.y', '.....o.', ...bombBody], bomb, o);
  tex(scene, 'bomb1', ['.....y.', '....oyo', ...bombBody], bomb, o);

  // Pennant on a pole (origin bottom-left). 8x11.
  tex(scene, 'pennant', ['pyy...', 'pyYyy.', 'pyyyyo', 'pyyoo.', 'poo...', 'p.....', 'p.....', 'p.....', 'p.....'], { p: '#8a5a2a', y: '#ffd040', Y: '#fff8c0', o: '#e08a1a' }, o);

  // Capture flag (origin bottom-left). 8x12.
  tex(scene, 'flag', ['pwwwww', 'pwrrrw', 'pwrrrw', 'pwwwgg', 'p.....', 'p.....', 'p.....', 'p.....', 'p.....', 'p.....'], { p: '#8a5a2a', w: '#ffffff', r: '#e8302a', g: '#c8c8e0' }, o);
}

/** Character, hazard and pickup textures. */
export function makeCharacterTextures(scene: Phaser.Scene): void {
  makePlayers(scene);
  makeHazards(scene);
  makePickups(scene);
}
