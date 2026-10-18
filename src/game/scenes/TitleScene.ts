import Phaser from 'phaser';
import { PLAYER_CSS, ZOOM } from '../config';
import { inputHub, SOURCE_LABEL } from '../input';
import { sfx } from '../sfx';
import { panel, text } from '../ui';
import type { GameSceneData, SeatConfig } from './GameScene';

const DIFFICULTY = ['Easy', 'Normal', 'Hard', 'Expert'];
const BOT_NAMES = ['Rex', 'Pip', 'Juno', 'Mo'];

/** Join screen: each controller presses jump to take a seat; bots fill the rest. */
export class TitleScene extends Phaser.Scene {
  private joined: string[] = [];
  private total = 4;
  private difficulty = 1;
  private slotTexts: Phaser.GameObjects.Text[] = [];
  private optText!: Phaser.GameObjects.Text;
  private starting = false;

  constructor() {
    super('title');
  }

  create() {
    this.cameras.main.setZoom(ZOOM).centerOn(240, 135);
    inputHub.attach(this);
    this.joined = [];
    this.slotTexts = [];
    this.starting = false;
    this.add.rectangle(240, 135, 480, 270, 0x14101c);
    // A little house silhouette behind the title.
    const g = this.add.graphics();
    g.fillStyle(0x2a2040, 1);
    g.fillTriangle(140, 70, 240, 22, 340, 70);
    g.fillRect(150, 70, 180, 60);
    g.fillStyle(0xffd040, 0.6);
    for (const [x, y] of [[170, 82], [226, 82], [282, 82], [170, 104], [282, 104]]) g.fillRect(x, y, 20, 14);
    text(this, 240, 38, 'TABLETOP', 24, '#ffd040').setOrigin(0.5, 0).setStroke('#3a1a5a', 4);
    text(this, 240, 70, 'a cursed board game for 2-4 players', 8, '#e0d0ff').setOrigin(0.5, 0);

    panel(this, 30, 138, 420, 124);
    for (let i = 0; i < 4; i++) {
      this.slotTexts.push(text(this, 44 + (i % 2) * 210, 146 + Math.floor(i / 2) * 14, '', 8, PLAYER_CSS[i]));
    }
    this.optText = text(this, 44, 178, '', 7, '#ffffff');
    text(
      this,
      44,
      198,
      [
        'JOIN: press jump on your controller.  Gamepad: A = jump, X = action, B = back.',
        `Keyboard P1: ${SOURCE_LABEL.kb1}   Keyboard P2: ${SOURCE_LABEL.kb2}`,
        'Climb ladders/stairs with up/down. Press down on a vent to crawl through.',
        'Player 1: left/right = players, up/down = bot skill, jump again = START.',
        'Enter = start now (no humans = watch the bots).   Esc in game = quit to title.',
      ].join('\n'),
      6,
      '#a898c8',
      { lineSpacing: 3 },
    );
    this.refresh();

    const params = new URLSearchParams(location.search);
    if (params.get('demo') === '1') this.time.delayedCall(200, () => this.start());
    this.input.keyboard!.on('keydown-ENTER', (e: KeyboardEvent) => {
      if (!e.repeat) this.start();
    });
  }

  private refresh() {
    for (let i = 0; i < 4; i++) {
      let label: string;
      if (i < this.joined.length) label = `P${i + 1}  ${this.joined[i].startsWith('kb') ? 'Keyboard' : 'Gamepad'}`;
      else if (i < Math.max(this.total, this.joined.length)) label = `P${i + 1}  Bot (${DIFFICULTY[this.difficulty]})`;
      else label = `P${i + 1}  -- empty --`;
      this.slotTexts[i].setText(label);
    }
    this.optText.setText(`Players: < ${Math.max(this.total, this.joined.length, 2)} >     Bot skill: ${DIFFICULTY[this.difficulty]}`);
  }

  update() {
    inputHub.poll();
    for (const [id, src] of inputHub.sources) {
      const pad = src.pad;
      const seat = this.joined.indexOf(id);
      if (seat === -1) {
        if (pad.jump && this.joined.length < 4) {
          this.joined.push(id);
          this.total = Math.max(this.total, this.joined.length);
          sfx('select');
          this.refresh();
        }
        continue;
      }
      if (seat === 0) {
        if (pad.left) this.total = Math.max(2, Math.max(this.joined.length, this.total - 1));
        if (pad.right) this.total = Math.min(4, this.total + 1);
        if (pad.up) this.difficulty = Math.min(3, this.difficulty + 1);
        if (pad.down) this.difficulty = Math.max(0, this.difficulty - 1);
        if (pad.left || pad.right || pad.up || pad.down) {
          sfx('blip');
          this.refresh();
        }
        if (pad.jump) this.start();
      }
      if (pad.back && seat === this.joined.length - 1) {
        this.joined.pop();
        this.refresh();
      }
    }
  }

  private start() {
    if (this.starting) return;
    this.starting = true;
    const n = Math.max(2, this.total, this.joined.length);
    const seats: SeatConfig[] = Array.from({ length: n }, (_, i) =>
      i < this.joined.length
        ? { name: `P${i + 1}`, isBot: false, difficulty: 1, source: this.joined[i] }
        : { name: BOT_NAMES[i], isBot: true, difficulty: this.difficulty, source: null },
    );
    const params = new URLSearchParams(location.search);
    const seed = Number(params.get('seed')) || (Date.now() & 0x7fffffff);
    const data: GameSceneData = { seats, seed };
    sfx('win');
    this.scene.start('game', data);
  }
}
