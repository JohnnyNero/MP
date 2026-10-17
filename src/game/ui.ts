import Phaser from 'phaser';

export const FONT = 'monospace';

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
    .text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color, resolution: 4, ...opts })
    .setDepth(90);
}

export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, alpha = 0.92) {
  const g = scene.add.graphics().setDepth(85);
  g.fillStyle(0x120e1c, alpha);
  g.fillRoundedRect(x, y, w, h, 4);
  g.lineStyle(1, 0x8a6ad0, 1);
  g.strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, 4);
  return g;
}

/** A vertical option list. Navigation is driven by the caller. */
export class Menu {
  index = 0;
  private items: Phaser.GameObjects.Text[] = [];
  private cursor: Phaser.GameObjects.Text;
  private objs: Phaser.GameObjects.GameObject[] = [];

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    w: number,
    title: string,
    public options: string[],
    color: string,
  ) {
    const h = 16 + options.length * 10;
    this.objs.push(panel(scene, x, y, w, h));
    this.objs.push(text(scene, x + 6, y + 4, title, 7, color).setDepth(91));
    options.forEach((o, i) => {
      const t = text(scene, x + 14, y + 14 + i * 10, o, 7, '#e8e0f8').setDepth(91);
      this.items.push(t);
      this.objs.push(t);
    });
    this.cursor = text(scene, x + 6, y + 14, '>', 7, color).setDepth(91);
    this.objs.push(this.cursor);
    this.refresh();
  }

  move(d: number) {
    this.index = (this.index + d + this.options.length) % this.options.length;
    this.refresh();
  }

  private refresh() {
    this.items.forEach((t, i) => t.setColor(i === this.index ? '#ffffff' : '#9a90b8'));
    this.cursor.setY(this.items[this.index].y);
  }

  destroy() {
    for (const o of this.objs) o.destroy();
  }
}
