import Phaser from 'phaser';
import { GRAVITY, H, W, ZOOM } from './game/config';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { TitleScene } from './game/scenes/TitleScene';

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
