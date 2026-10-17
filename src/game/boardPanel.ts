import Phaser from 'phaser';
import { BOARD } from '../content/board';
import { CARDS } from '../content/cards';
import { roomName } from '../core/house';
import type { GameState, SpaceType } from '../core/types';
import { PLAYER_COLORS } from './config';
import { text } from './ui';

const SPACE_COLOR: Record<SpaceType, number> = {
  start: 0xffffff,
  blue: 0x3a7ae8,
  red: 0xd84040,
  danger: 0x9a3ad8,
  shop: 0x3ac87a,
  repair: 0xe8a03a,
  toll: 0xa0a0a0,
  gate: 0x707070,
  finish: 0xffd040,
};
const SPACE_LETTER: Partial<Record<SpaceType, string>> = {
  danger: '!',
  shop: '$',
  repair: '+',
  toll: 'T',
  gate: 'G',
  finish: '★',
  start: 'S',
};

const TOKEN_OFF = [
  [-3, -3],
  [3, -3],
  [-3, 3],
  [3, 3],
];

/** The cursed board, drawn over the house while board turns happen. */
export class BoardPanel {
  private root: Phaser.GameObjects.Container;
  private tokens: Phaser.GameObjects.Image[] = [];
  private highlight: Phaser.GameObjects.Graphics;
  private gates = new Map<string, Phaser.GameObjects.Arc>();
  private info: Phaser.GameObjects.Text;
  private lingering: Phaser.GameObjects.Text;
  dice: Phaser.GameObjects.Text;

  constructor(private scene: Phaser.Scene, private state: GameState) {
    const s = scene;
    this.root = s.add.container(0, 0).setDepth(60);
    const bg = s.add.rectangle(240, 140, 480, 260, 0x0c0814, 0.88);
    const g = s.add.graphics();
    // Links.
    g.lineStyle(2, 0x5a4a7a, 1);
    for (const sp of Object.values(BOARD.spaces)) {
      for (const n of sp.next) {
        const t = BOARD.spaces[n];
        g.lineBetween(sp.x, sp.y, t.x, t.y);
      }
    }
    this.root.add([bg, g]);
    for (const sp of Object.values(BOARD.spaces)) {
      const c = s.add.circle(sp.x, sp.y, sp.type === 'finish' || sp.type === 'start' ? 7 : 5, SPACE_COLOR[sp.type]);
      c.setStrokeStyle(1, 0x000000);
      this.root.add(c);
      if (sp.type === 'gate') this.gates.set(sp.id, c);
      const L = SPACE_LETTER[sp.type];
      if (L) this.root.add(text(s, sp.x, sp.y, L, 7, '#ffffff').setOrigin(0.5, 0.5));
    }
    this.highlight = s.add.graphics();
    this.root.add(this.highlight);
    state.players.forEach((p, i) => {
      const t = s.add.image(0, 0, `avatar${i}`).setScale(0.8);
      this.tokens.push(t);
      this.root.add(t);
      this.placeToken(i, p.space);
    });
    // Legend.
    this.root.add(
      text(s, 196, 156, 'Blue +3  Red -3  ! Danger card\n$ Shop   + Repair   T Toll\nG Shortcut gate   ★ Finish', 6, '#9a90b8', { lineSpacing: 2 }),
    );
    this.info = text(s, 196, 188, '', 7, '#ffffff', { wordWrap: { width: 250 } });
    this.lingering = text(s, 8, 248, '', 6, '#e8a03a', { wordWrap: { width: 460 } });
    this.dice = text(s, 410, 128, '', 16, '#ffffff').setOrigin(0.5, 0.5);
    this.root.add([this.info, this.lingering, this.dice]);
    this.refresh();
    this.root.setVisible(false);
  }

  refresh() {
    for (const [id, c] of this.gates) c.setFillStyle(this.state.openGates.includes(id) ? 0x3ac87a : SPACE_COLOR.gate);
    const eff = this.state.effects.map((e) => `${CARDS[e.card].name} (${e.rooms.map(roomName).join(', ')})`);
    this.lingering.setText(eff.length ? `Lingering in the house: ${eff.join(' · ')}` : 'The house is calm... for now.');
  }

  setInfo(s: string) {
    this.info.setText(s);
  }

  placeToken(pid: number, space: string) {
    const sp = BOARD.spaces[space];
    const [ox, oy] = TOKEN_OFF[pid];
    this.tokens[pid].setPosition(sp.x + ox, sp.y + oy - 4);
  }

  moveToken(pid: number, space: string, ms = 170): Promise<void> {
    const sp = BOARD.spaces[space];
    const [ox, oy] = TOKEN_OFF[pid];
    return new Promise((res) => {
      this.scene.tweens.add({
        targets: this.tokens[pid],
        x: sp.x + ox,
        y: sp.y + oy - 4,
        duration: ms,
        ease: 'Quad.easeOut',
        onComplete: () => res(),
      });
      this.scene.tweens.add({ targets: this.tokens[pid], scaleY: 0.6, yoyo: true, duration: ms / 2 });
    });
  }

  showChoices(spaces: string[], pid: number) {
    this.highlight.clear();
    this.highlight.lineStyle(2, PLAYER_COLORS[pid], 1);
    for (const id of spaces) {
      const sp = BOARD.spaces[id];
      this.highlight.strokeCircle(sp.x, sp.y, 9);
    }
  }

  focus(pid: number) {
    this.tokens.forEach((t, i) => t.setAlpha(i === pid ? 1 : 0.55).setDepth(i === pid ? 2 : 1));
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
