import Phaser from 'phaser';
import { PLAYER_COLORS } from './config';
import { makeCharacterTextures } from './art/characterArt';
import { makeHouseTextures } from './art/houseArt';

// All art is generated at boot from tiny pixel maps, so the game ships
// with no image assets. Each map row is a string; each char is a palette key.

type Palette = Record<string, number>;

function pixelTexture(scene: Phaser.Scene, key: string, rows: string[], pal: Palette) {
  const h = rows.length;
  const w = rows[0].length;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === '.' || pal[c] === undefined) continue;
      g.fillStyle(pal[c], 1);
      g.fillRect(x, y, 1, 1);
    }
  }
  g.generateTexture(key, w, h);
  g.destroy();
}

const AVATAR = [
  '...kkkk...',
  '..kssssk..',
  '..ksesek..',
  '..kssssk..',
  '...kssk...',
  '..kccccck.',
  '.kcccccck.',
  '.kcccccck.',
  '.ksccccsk.',
  '..kccccck.',
  '..kppkpp..',
  '..kppkpp..',
  '..kbbkbb..',
  '...kk.kk..',
];

const AVATAR_RUN = [
  '...kkkk...',
  '..kssssk..',
  '..ksesek..',
  '..kssssk..',
  '...kssk...',
  '..kccccck.',
  '.kcccccck.',
  '.kcccccck.',
  'ksccccccsk',
  '..kccccck.',
  '.kpp.kpp..',
  'kpp...kpp.',
  'kbb....bb.',
  '.k.....k..',
];

export function makeTextures(scene: Phaser.Scene) {
  PLAYER_COLORS.forEach((c, i) => {
    const pal = { k: 0x1a1420, s: 0xf2c6a0, e: 0x1a1420, c, p: 0x3a3550, b: 0x5a3a2a };
    pixelTexture(scene, `avatar${i}`, AVATAR, pal);
    pixelTexture(scene, `avatar${i}run`, AVATAR_RUN, pal);
  });
  pixelTexture(scene, 'apple', ['..g.', '.rrr', 'rrwr', 'rrrr', '.rr.'], { g: 0x3a8a3a, r: 0xd83a3a, w: 0xffb0a0 });
  pixelTexture(
    scene,
    'meteor',
    ['..oooo..', '.ooyyoo.', 'ooyyyyoo', 'oyywyyyo', 'oyyyyyyo', 'ooyyyyoo', '.ooyyoo.', '..oooo..'],
    { o: 0x8a3a1a, y: 0xe88a2a, w: 0xfff0a0 },
  );
  pixelTexture(scene, 'shadow', ['..kkkk..', 'kkkkkkkk', '..kkkk..'], { k: 0x000000 });
  pixelTexture(
    scene,
    'monkey',
    ['.bb..bb.', 'bbbbbbb.', 'btbbtbb.', 'bbttttb.', '.bbbbb..', 'bbbbbbbb', 'b.bbbb.b', '.b....b.'],
    { b: 0x7a4a2a, t: 0xe0b080 },
  );
  pixelTexture(
    scene,
    'beast',
    [
      '......gggggggg..',
      'w...gggggggggggg',
      'wgggggggggggggg.',
      'ggggkgggggggggg.',
      'gggggggggggggg..',
      '.gggggggggggg...',
      '..gg.gg..gg.gg..',
      '..gg.gg..gg.gg..',
    ],
    { g: 0x8a8a9a, w: 0xf0f0e0, k: 0x101010 },
  );
  pixelTexture(
    scene,
    'flame',
    ['...y....', '..yy....', '..yyo...', '.yyooy..', '.yoorry.', 'yoorrroy', 'yorrrroy', '.yorroy.', '..yyyy..'],
    { y: 0xfff060, o: 0xf0a030, r: 0xe04020 },
  );
  pixelTexture(scene, 'vine', ['.g..', 'gGg.', '.gGg', '..g.', '.gG.', 'gGg.', '.g..', '.gG.'], { g: 0x2e7d32, G: 0x66bb6a });
  pixelTexture(
    scene,
    'crate',
    ['bbbbbbbbbbbb', 'bllllllllllb', 'blbllllllblb', 'bllbllllbllb', 'blllbllblllb', 'bllllbblllll', 'bllllbblllll', 'blllbllblllb', 'bllbllllbllb', 'blbllllllblb', 'bllllllllllb', 'bbbbbbbbbbbb'],
    { b: 0x6a4a2a, l: 0xb08050 },
  );
  pixelTexture(scene, 'bomb', ['....y.', '...k..', '.kkkk.', 'kkwkkk', 'kwkkkk', 'kkkkkk', '.kkkk.'], { k: 0x202030, w: 0x8080a0, y: 0xffe040 });
  pixelTexture(scene, 'pennant', ['pyy...', 'pyyyy.', 'pyyyyy', 'pyyy..', 'p.....', 'p.....', 'p.....', 'p.....'], { p: 0x806040, y: 0xffd040 });
  pixelTexture(scene, 'flag', ['pwwww.', 'pwrrww', 'pwwwww', 'p.....', 'p.....', 'p.....', 'p.....', 'p.....', 'p.....', 'p.....'], { p: 0x806040, w: 0xf0f0f0, r: 0xd03030 });
  pixelTexture(
    scene,
    'boardprop',
    [
      '..pppppppppppppppppppppp..',
      '.pgrgbgrgygbgrgygbgrgbgyp.',
      '.pggggggggggggggggggggggp.',
      '.pbgygrgbgygrgbgygrgbgygp.',
      'kkkkkkkkkkkkkkkkkkkkkkkkkk',
      'kwwwwwwwwwwwwwwwwwwwwwwwwk',
      'kkkkkkkkkkkkkkkkkkkkkkkkkk',
      '.kk..................kk...',
      '.kk..................kk...',
      '.kk..................kk...',
      '.kk..................kk...',
      '.kk..................kk...',
    ],
    { p: 0x6a2a8a, g: 0x2a6a3a, r: 0xd04040, b: 0x4060d0, y: 0xe0c040, k: 0x4a2a1a, w: 0x7a4a2a },
  );
  pixelTexture(scene, 'vent', ['kkkkkkkkkkkk', 'kgkgkgkgkgkk', 'kkkkkkkkkkkk', 'kgkgkgkgkgkk', 'kkkkkkkkkkkk'], { k: 0x505060, g: 0x202028 });
  pixelTexture(scene, 'debris', ['.bb.', 'bbbb', 'bbb.'], { b: 0x8a8070 });
  pixelTexture(scene, 'water', ['bbbb', 'bbbb'], { b: 0x3a7ad8 });
  pixelTexture(scene, 'pixel', ['w'], { w: 0xffffff });
  pixelTexture(scene, 'spark', ['.w.', 'www', '.w.'], { w: 0xffffff });

  // Soft round light used to cut holes in the darkness overlay.
  const lg = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let r = 32; r > 0; r -= 2) {
    lg.fillStyle(0xffffff, Math.min(1, (34 - r) / 14));
    lg.fillCircle(32, 32, r);
  }
  lg.generateTexture('light', 64, 64);
  lg.destroy();
  pixelTexture(scene, 'book', ['rrrrrr', 'rwwwwr', 'rrrrrr'], { r: 0x8a2a5a, w: 0xf0e0c0 });

  // Furniture silhouettes for room dressing.
  const fur = (key: string, rows: string[], pal: Palette) => pixelTexture(scene, key, rows, pal);
  fur('fridge', Array.from({ length: 30 }, (_, i) => (i === 10 ? 'kkkkkkkkkkkk' : i % 29 === 0 ? 'kkkkkkkkkkkk' : 'kwwwwwwwwwhk')), { k: 0x606070, w: 0xd8dce8, h: 0x909090 });
  fur('couch', ['..mmmmmmmmmmmmmmmmmm..', '.mmmmmmmmmmmmmmmmmmmmm.', 'mmmMMMMMMMMMMMMMMMMMmmm', 'mmmMMMMMMMMMMMMMMMMMmmm', 'mmmmmmmmmmmmmmmmmmmmmmm', 'mmmmmmmmmmmmmmmmmmmmmmm', '.k...................k.'], { m: 0x8a3a4a, M: 0xa85060, k: 0x302020 });
  fur('car', ['.....bbbbbbbbbb..........', '....bwwwbwwwwwbb.........', '...bbwwwbwwwwwbbbbbbbbb..', 'bbbbbbbbbbbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbbbbbbbbbbl', 'bbbbbbbbbbbbbbbbbbbbbbbbb', '..kkk..............kkk...', '..kkk..............kkk...'], { b: 0x3a6aa8, w: 0xa0d0f0, k: 0x202020, l: 0xfff0a0 });
  fur('bed', ['k.......................', 'kww.....................', 'kwwwbbbbbbbbbbbbbbbbbbbk', 'kbbbbbbbbbbbbbbbbbbbbbbk', 'kkkkkkkkkkkkkkkkkkkkkkkk', 'k......................k'], { k: 0x6a4a2a, w: 0xf0f0f0, b: 0x4a6ac8 });
  fur('tub', ['k.....................', 'kk....................', 'wwwwwwwwwwwwwwwwwwwwww', 'wbbbbbbbbbbbbbbbbbbbbw', '.wwwwwwwwwwwwwwwwwwww.', '..k................k..'], { k: 0xa0a0a0, w: 0xf0f0f8, b: 0x80b8e8 });
  fur('toys', ['..r.....', '.rrr..y.', 'rrrrryyy', '.bbb.yyy', 'bbbbb...', 'bbbbb.gg', '.....ggg'], { r: 0xe04040, y: 0xf0d040, b: 0x4070e0, g: 0x40b040 });
  fur('boxes', ['bbbbbbbbbb......', 'bllllllllb......', 'bllllllllbbbbbbb', 'bbbbbbbbbbllllll', 'bllllllllbllllll', 'bllllllllbllllll', 'bbbbbbbbbbbbbbbb'], { b: 0x7a5a3a, l: 0xc09a6a });
  fur('desk', ['......mmm.....', '......mmm.....', 'kkkkkkkkkkkkkk', 'k.k........k.k', 'k.k........k.k', 'k.k........k.k'], { k: 0x6a4a2a, m: 0x40a0a0 });
  fur('trunk', ['.kkkkkkkkkk.', 'kbbbbbbbbbbk', 'kkkkkykkkkkk', 'kbbbbbbbbbbk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk'], { k: 0x4a2a1a, b: 0x8a5a2a, y: 0xe0c040 });
  // Option C art: these run last and may overwrite the placeholder textures above.
  makeHouseTextures(scene);
  makeCharacterTextures(scene);
}
