import Phaser from 'phaser';
import { GRAVITY, H, W, ZOOM } from './game/config';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { TitleScene } from './game/scenes/TitleScene';
import { inputHub } from './game/input';
import { isTouchDevice, TouchSource } from './game/touch';

// Phones and tablets get on-screen controls as an extra input source.
if (isTouchDevice()) inputHub.sources.set('touch', new TouchSource());

function boot() {
  new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: W * ZOOM,
    height: H * ZOOM,
    backgroundColor: '#14101c',
    pixelArt: true,
    roundPixels: true,
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: GRAVITY }, debug: false } },
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, TitleScene, GameScene],
  });
}

// Phaser rasterises text once, so wait for the pixel font (headings) before
// booting. Offline or slow networks fall back to monospace after a short wait.
const fontReady = document.fonts
  ? Promise.race([document.fonts.load('10px "Press Start 2P"'), new Promise((r) => setTimeout(r, 2500))])
  : Promise.resolve();
fontReady.catch(() => undefined).then(boot);
