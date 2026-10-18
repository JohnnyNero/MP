import Phaser from 'phaser';
import { CARDS, GOALS, SHOP_BY_ID } from '../../content/cards';
import { distToFinish } from '../../core/board';
import { botDecide } from '../../core/bots';
import {
  addLingeringEffect,
  applyCoinDelta,
  newGame,
  planHouseTurn,
  targetRooms,
  settle,
  startRound,
  takeTurn,
  type Answer,
  type Decision,
  type TurnEvent,
} from '../../core/game';
import { deriveHouse, roomName } from '../../core/house';
import { makeRandom } from '../../core/rng';
import type { GameState, GoalId, HazardId, MinigamePlan } from '../../core/types';
import { Avatar, type AvatarMods } from '../avatar';
import { BoardPanel } from '../boardPanel';
import { BotBrain, type BotGoal } from '../botBrain';
import { MINIGAME_SECONDS, PLAYER_CSS, REGROUP_SECONDS, W, ZOOM } from '../config';
import { createGoal, safeRoomGoal, type GoalSystem } from '../goals';
import { createHazard, DarkOverlay, LingeringSystem } from '../hazards';
import { HouseView } from '../houseView';
import { inputHub, VirtualPad } from '../input';
import type { MGContext, System } from '../mgContext';
import { sfx } from '../sfx';
import { Menu, panel, text } from '../ui';

export interface SeatConfig {
  name: string;
  isBot: boolean;
  difficulty: number;
  source: string | null;
}

export interface GameSceneData {
  seats: SeatConfig[];
  seed: number;
}

const ITEM_LETTER: Record<string, string> = {
  doubleDie: 'D',
  reroll: 'R',
  pushBack: 'P',
  warpSwap: 'W',
  respin: 'S',
  headStart: 'h',
  springBoots: 'b',
};

const BLANK = new VirtualPad();

export class GameScene extends Phaser.Scene {
  private seats!: SeatConfig[];
  private state!: GameState;
  private house!: HouseView;
  private collider?: Phaser.Physics.Arcade.Collider;
  private avatars: Avatar[] = [];
  private brains: (BotBrain | null)[] = [];
  private systems: System[] = [];
  private lingering?: LingeringSystem;
  private ctx!: MGContext;
  private dark!: DarkOverlay;
  private panel!: BoardPanel;
  private avatarsActive = false;
  private botGoalFn: (i: number) => BotGoal = () => ({ kind: 'idle' });
  private waiters: (() => void)[] = [];
  private lastDt = 16;
  private hudTexts: Phaser.GameObjects.Text[] = [];
  private roundText!: Phaser.GameObjects.Text;
  private centerText!: Phaser.GameObjects.Text;
  private mgStart = -1e9;
  private springSeats = new Set<number>();
  private headStartSeats = new Set<number>();
  private rnd!: () => number;
  private quitting = false;

  constructor() {
    super('game');
  }

  init(data: GameSceneData) {
    this.seats = data.seats;
    this.state = newGame(
      data.seed,
      data.seats.map((s) => ({ name: s.name, isBot: s.isBot, difficulty: s.difficulty })),
    );
    this.rnd = makeRandom(data.seed ^ 0x9e3779b9);
    // Debug: start with lingering effects, e.g. ?linger=fire,vines,meteor
    for (const id of new URLSearchParams(location.search).get('linger')?.split(',') ?? []) {
      if (CARDS[id as HazardId]) addLingeringEffect(this.state, id as HazardId);
    }
    this.avatars = [];
    this.brains = [];
    this.systems = [];
    this.waiters = [];
    this.quitting = false;
    this.avatarsActive = false;
    // The scene instance is reused between games: drop stale references.
    this.hudTexts = [];
    this.lingering = undefined;
    this.collider = undefined;
    this.house = undefined as unknown as HouseView;
    this.mgStart = -1e9;
    this.springSeats = new Set();
    this.headStartSeats = new Set();
  }

  create() {
    this.cameras.main.setZoom(ZOOM).centerOn(240, 135);
    inputHub.attach(this);
    this.ctx = {
      scene: this,
      house: undefined as unknown as HouseView,
      avatars: this.avatars,
      rnd: this.rnd,
      now: 0,
      hazardHits: this.seats.map(() => 0),
      coinDelta: this.seats.map(() => 0),
      dangers: [],
      flippedRooms: new Set(),
      darkRooms: new Map(),
      hotRooms: new Set(),
      popText: (t, x, y, c) => this.popText(t, x, y, c),
      sfx: (n) => sfx(n),
    };
    this.buildHouse();
    this.seats.forEach((s, i) => {
      const p = this.house.randomPoint(this.house.rooms[i].id, this.rnd);
      this.avatars.push(new Avatar(this, i, p.x, p.y));
      this.brains.push(s.isBot ? new BotBrain(s.difficulty, this.rnd) : null);
    });
    this.setCollider();
    this.dark = new DarkOverlay(this.ctx);
    this.panel = new BoardPanel(this, this.state);
    this.buildHud();
    this.input.keyboard!.on('keydown-ESC', () => this.quit());
    const onQuit = () => this.quit();
    window.addEventListener('tabletop-quit', onQuit);
    this.events.once('shutdown', () => window.removeEventListener('tabletop-quit', onQuit));
    this.events.once('shutdown', () => this.dark.destroy());
    void this.runGame().catch((e) => {
      if (!this.quitting) console.error(e);
    });
  }

  // ------------------------------------------------------------ plumbing

  private buildHouse(effects = this.state.effects) {
    this.lingering?.destroy();
    this.systems = this.systems.filter((s) => s !== this.lingering);
    this.house?.destroy();
    this.house = new HouseView(this, deriveHouse({ effects }));
    this.ctx.house = this.house;
    this.lingering = new LingeringSystem(this.ctx);
    this.systems.unshift(this.lingering);
    if (this.avatars.length) this.setCollider();
  }

  private setCollider() {
    this.collider?.destroy();
    this.collider = this.physics.add.collider(
      this.avatars.map((a) => a.sprite),
      this.house.solids,
      undefined,
      (a) => {
        const av = this.avatars.find((x) => x.sprite === a);
        return !av?.climbing;
      },
    );
  }

  private padFor(i: number): VirtualPad {
    const src = this.seats[i].source;
    return (src && inputHub.get(src)) || BLANK;
  }

  private anyHumanConfirm(): boolean {
    return this.seats.some((s, i) => !s.isBot && this.padFor(i).confirm);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((res) => this.time.delayedCall(ms, res));
  }

  private nextFrame(): Promise<void> {
    if (this.quitting) return new Promise(() => {});
    return new Promise((res) => this.waiters.push(res));
  }

  private async waitUntil(pred: () => boolean) {
    while (!pred()) await this.nextFrame();
  }

  /** Wait up to `ms`, or until a human presses confirm (after a short grace). */
  private async waitOrConfirm(ms: number, grace = 600) {
    const start = this.time.now;
    await this.waitUntil(() => this.time.now - start > ms || (this.time.now - start > grace && this.anyHumanConfirm()));
  }

  private quit() {
    this.quitting = true;
    this.scene.start('title');
  }

  update(time: number, delta: number) {
    const dt = Math.min(delta, 50);
    this.lastDt = dt;
    inputHub.poll();
    const c = this.ctx;
    c.now = time;
    c.dangers.length = 0;
    c.flippedRooms.clear();
    c.darkRooms.clear();
    c.hotRooms.clear();
    for (const s of this.systems) {
      // Lingering hazards only bite while players can actually move.
      if (s === this.lingering && !this.avatarsActive) continue;
      s.update(dt);
    }

    if (this.avatarsActive) {
      this.avatars.forEach((av, i) => {
        const brain = this.brains[i];
        let pad: VirtualPad;
        if (brain) {
          let goal = this.botGoalFn(i);
          if (goal.kind === 'idle' && av.room && c.hotRooms.has(av.room)) goal = safeRoomGoal(c, i);
          brain.update(av, goal, this.house, c.dangers, time, dt);
          pad = brain.pad;
        } else pad = this.padFor(i);
        const mods: AvatarMods = {
          flippedRooms: c.flippedRooms,
          speedMul: this.headStartSeats.has(i) && time - this.mgStart < 5000 ? 1.5 : 1,
          springBoots: this.springSeats.has(i),
        };
        av.update(pad, time, dt, this.house, mods);
        // Safety net: anything that escapes the house goes back to the board.
        if (av.y > 300 || av.y < -20 || av.x < -20 || av.x > W + 20) av.teleport(this.house.boardX, this.house.boardY - 10);
      });
    } else {
      for (const av of this.avatars) av.body.setVelocityX(av.body.velocity.x * 0.8);
    }
    this.dark.update();
    this.updateHud();
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  // ------------------------------------------------------------ HUD / feedback

  private buildHud() {
    this.add.rectangle(240, 6, 480, 12, 0x0c0814, 0.9).setDepth(95);
    this.seats.forEach((_, i) => {
      this.add.rectangle(6 + i * 96, 6, 6, 6, Phaser.Display.Color.HexStringToColor(PLAYER_CSS[i]).color).setDepth(96);
      this.hudTexts.push(text(this, 12 + i * 96, 2, '', 6, '#ffffff').setDepth(96));
    });
    this.roundText = text(this, 474, 2, '', 6, '#c0b0e0').setOrigin(1, 0).setDepth(96);
    this.centerText = text(this, 240, 20, '', 7, '#ffffff').setOrigin(0.5, 0).setDepth(96);
  }

  private updateHud() {
    this.state.players.forEach((p, i) => {
      const inv = [...p.items, ...p.perks].map((x) => ITEM_LETTER[x]).join('');
      const tag = p.isBot ? '' : '*';
      this.hudTexts[i].setText(`${p.name.slice(0, 7)}${tag} ${p.coins}c ${inv}`);
    });
    this.roundText.setText(`Round ${Math.max(1, this.state.round)}/${this.state.roundCap}`);
  }

  private popText(t: string, x: number, y: number, color = '#ffffff') {
    const o = text(this, x, y, t, 7, color).setOrigin(0.5, 1).setDepth(97);
    this.tweens.add({ targets: o, y: y - 14, alpha: 0, duration: 900, onComplete: () => o.destroy() });
  }

  private async banner(t: string, ms = 1400, color = '#ffffff', sub = '') {
    const g = panel(this, 90, 104, 300, sub ? 52 : 34).setDepth(98);
    const a = text(this, 240, 112, t, 12, color).setOrigin(0.5, 0).setDepth(99);
    const b = sub ? text(this, 240, 132, sub, 7, '#c0b0e0', { align: 'center', wordWrap: { width: 280 } }).setOrigin(0.5, 0).setDepth(99) : null;
    await this.waitOrConfirm(ms);
    g.destroy();
    a.destroy();
    b?.destroy();
  }

  // ------------------------------------------------------------ main loop

  private async runGame() {
    await this.banner('TABLETOP', 1800, '#ffd040', 'A cursed board game has spilled into the house.\nFirst to the end escapes. Find the board!');
    for (;;) {
      await this.regroup();
      await this.boardTurns();
      if (this.state.winner !== null) break;
      const plan = await this.houseTurn();
      await this.minigame(plan);
      if (this.state.winner !== null) break;
    }
    await this.ending();
  }

  // ------------------------------------------------------------ regroup

  private async regroup() {
    const n = this.avatars.length;
    const arrived: number[] = [];
    let unwrapped = !this.house.boardWrapped;
    let unwrapT = 0;
    const roundNo = this.state.round + 1;
    void this.banner(`ROUND ${roundNo}`, 1100, '#ffd040', 'Race back to the board! Arrival order = turn order.');
    if (this.house.boardWrapped) this.popText('Vines wrap the board! Stand at it to cut free.', 240, 40, '#80e080');
    this.botGoalFn = (i) =>
      arrived.includes(i)
        ? { kind: 'idle' }
        : { kind: 'goto', x: this.house.boardX + (i - 1.5) * 4, y: this.house.boardY - 8 };
    this.avatarsActive = true;
    const end = this.time.now + REGROUP_SECONDS * 1000;
    await this.waitUntil(() => {
      const left = Math.max(0, Math.ceil((end - this.time.now) / 1000));
      this.centerText.setText(`Get to the board! ${left}s   arrived: ${arrived.map((i) => this.state.players[i].name).join(', ')}`);
      for (let i = 0; i < n; i++) {
        if (arrived.includes(i)) continue;
        const av = this.avatars[i];
        const near = Math.abs(av.x - this.house.boardX) < 16 && Math.abs(av.feetY - this.house.boardY) < 8 && !av.climbing;
        if (!near) continue;
        if (!unwrapped) {
          unwrapT += this.lastDt;
          if (unwrapT > 1500) {
            unwrapped = true;
            this.popText('Vines cut!', this.house.boardX, this.house.boardY - 20, '#80e080');
            sfx('select');
          }
          continue;
        }
        arrived.push(i);
        this.popText(`#${arrived.length}`, av.x, av.y - 10, PLAYER_CSS[i]);
        sfx('pickup');
      }
      return arrived.length === n || this.time.now > end;
    });
    this.avatarsActive = false;
    this.centerText.setText('');
    const stragglers = this.avatars
      .map((_, i) => i)
      .filter((i) => !arrived.includes(i))
      .sort((a, b) => Math.abs(this.avatars[a].x - this.house.boardX) - Math.abs(this.avatars[b].x - this.house.boardX));
    if (stragglers.length) this.popText('Stragglers pulled to the board!', 240, 40, '#ff9090');
    applyCoinDelta(this.state, this.ctx.coinDelta);
    this.ctx.coinDelta.fill(0);
    startRound(this.state, [...arrived, ...stragglers], arrived.length);
    this.lineUpAtBoard();
    await this.wait(500);
  }

  private lineUpAtBoard() {
    this.state.turnOrder.forEach((pid, k) => {
      this.avatars[pid].teleport(this.house.boardX - 18 + k * 12, this.house.boardY - 8);
    });
  }

  // ------------------------------------------------------------ board turns

  private async boardTurns() {
    this.panel.setVisible(true);
    this.state.players.forEach((p, i) => this.panel.placeToken(i, p.space));
    for (const pid of this.state.turnOrder) {
      const p = this.state.players[pid];
      this.panel.focus(pid);
      this.panel.setInfo(`${p.name}'s turn.`);
      this.panel.dice.setText('');
      sfx('blip');
      await this.wait(500);
      const gen = takeTurn(this.state, pid);
      let ans: Answer = null;
      for (;;) {
        const r = gen.next(ans);
        if (r.done) break;
        ans = null;
        if (r.value.kind === 'event') await this.animateEvent(pid, r.value.ev);
        else ans = await this.decide(pid, r.value.dec);
      }
      this.panel.clearChoices();
      await this.wait(300);
      if (this.state.winner !== null) break;
    }
    this.panel.setVisible(false);
  }

  private async animateEvent(pid: number, ev: TurnEvent) {
    const p = this.state.players[pid];
    const name = p.name;
    switch (ev.t) {
      case 'useItem':
        this.panel.setInfo(`${name} uses ${SHOP_BY_ID[ev.item].name}!`);
        sfx('select');
        return this.wait(700);
      case 'roll': {
        for (let k = 0; k < 10; k++) {
          this.panel.dice.setText(String(1 + Math.floor(this.rnd() * 6 * ev.values.length)));
          sfx('roll');
          await this.wait(50);
        }
        this.panel.dice.setText(ev.values.length > 1 ? `${ev.values.join('+')}=${ev.total}` : String(ev.total));
        this.panel.setInfo(`${name} rolled ${ev.total}.`);
        return this.wait(500);
      }
      case 'move':
        sfx('step');
        this.panel.dice.setText(ev.stepsLeft > 0 ? String(ev.stepsLeft) : '');
        return this.panel.moveToken(pid, ev.to);
      case 'coins':
        this.panel.setInfo(`${ev.reason}: ${ev.delta >= 0 ? '+' : ''}${ev.delta} coins.`);
        sfx(ev.delta >= 0 ? 'coin' : 'bad');
        return this.wait(650);
      case 'drawCard':
        this.panel.setInfo(`DANGER! ${name} drew "${CARDS[ev.card].name}" into the house pool.`);
        sfx('bad');
        this.cameras.main.shake(150, 0.004);
        return this.wait(1200);
      case 'bought':
        this.panel.setInfo(`${name} bought ${SHOP_BY_ID[ev.id].name}.`);
        return this.wait(600);
      case 'repaired':
        this.panel.setInfo(`${name} repaired the house: ${CARDS[ev.card].name} is gone!`);
        sfx('select');
        this.buildHouse();
        this.lineUpAtBoard();
        this.panel.refresh();
        return this.wait(900);
      case 'gateOpened':
        this.panel.refresh();
        this.panel.setInfo(`${name} opened the shortcut for everyone!`);
        return this.wait(700);
      case 'pushed':
        this.panel.setInfo(`${this.state.players[ev.target].name} is pushed back!`);
        await this.panel.moveToken(ev.target, ev.to, 400);
        return this.wait(400);
      case 'swapped':
        this.panel.setInfo(`${name} swaps places with ${this.state.players[ev.b].name}!`);
        await Promise.all([
          this.panel.moveToken(ev.a, this.state.players[ev.a].space, 500),
          this.panel.moveToken(ev.b, this.state.players[ev.b].space, 500),
        ]);
        return this.wait(300);
      case 'respinArmed':
        this.panel.setInfo(`The roulette will spin twice this round.`);
        return this.wait(600);
      case 'win':
        sfx('win');
        this.panel.setInfo(`${name} reached the end!`);
        return this.wait(1200);
    }
  }

  private async decide(pid: number, dec: Decision): Promise<Answer> {
    const seat = this.seats[pid];
    if (seat.isBot) {
      if (dec.d === 'junction') this.panel.showChoices(dec.options.map((o) => o.to), pid);
      await this.wait(450);
      return botDecide(this.state, pid, dec);
    }
    let labels: string[] = [];
    let values: Answer[] = [];
    let title = '';
    let backValue: Answer | undefined;
    switch (dec.d) {
      case 'preRoll':
        title = 'Use an item before rolling?';
        labels = dec.options.map((o) => (o === 'roll' ? 'Roll the die' : `Use ${SHOP_BY_ID[o].name}`));
        values = dec.options;
        break;
      case 'reroll':
        title = `You rolled ${dec.total}. Use Reroll?`;
        labels = ['Keep it', 'Reroll'];
        values = [false, true];
        backValue = false;
        break;
      case 'junction':
        title = 'Which way?';
        labels = dec.options.map((o) => `${o.label} (${distToFinish(o.to)} to go)`);
        values = dec.options.map((_, i) => i);
        this.panel.showChoices(dec.options.map((o) => o.to), pid);
        break;
      case 'shop':
        title = `Shop - you have ${this.state.players[pid].coins} coins`;
        labels = [...dec.options.map((o) => `${SHOP_BY_ID[o.id].name} ${o.price}c - ${SHOP_BY_ID[o.id].blurb}`), 'Leave'];
        values = [...dec.options.map((o) => o.id), null];
        backValue = null;
        break;
      case 'repair':
        title = 'Repair the house? (helps everyone)';
        labels = [...dec.options.map((o) => `${CARDS[o.card].name} in ${o.rooms.map(roomName).join(', ')} (${o.price}c)`), 'Skip'];
        values = [...dec.options.map((o) => o.uid), null];
        backValue = null;
        break;
      case 'target':
        title = 'Push back whom?';
        labels = dec.options.map((id) => this.state.players[id].name);
        values = dec.options;
        break;
    }
    const menu = new Menu(this, 150, 144, 320, `${this.state.players[pid].name}: ${title}`, labels, PLAYER_CSS[pid]);
    let result: Answer | undefined;
    const openedAt = this.time.now;
    await this.nextFrame();
    await this.waitUntil(() => {
      // Nobody answering (e.g. a gamepad unplugged): let the bot logic decide.
      if (this.time.now - openedAt > 30000) {
        result = botDecide(this.state, pid, dec);
        return true;
      }
      const pad = this.padFor(pid);
      if (pad.up) {
        menu.move(-1);
        sfx('blip');
      }
      if (pad.down) {
        menu.move(1);
        sfx('blip');
      }
      if (pad.confirm) result = values[menu.index];
      else if (pad.back && backValue !== undefined) result = backValue;
      return result !== undefined;
    });
    sfx('select');
    menu.destroy();
    return result!;
  }

  // ------------------------------------------------------------ house turn

  private async houseTurn(): Promise<MinigamePlan> {
    const plan = planHouseTurn(this.state);
    // Debug overrides for testing a specific hazard/goal: ?card=fire&goal=king
    const q = new URLSearchParams(location.search);
    const qc = q.get('card') as HazardId | null;
    if (qc && CARDS[qc]) {
      plan.card = qc;
      plan.rooms = targetRooms(this.state, qc);
      plan.rouletteOptions = [qc];
      plan.rouletteIndex = 0;
    }
    const qg = q.get('goal') as GoalId | null;
    if (qg && GOALS.some((g) => g.id === qg)) plan.goal = qg;
    const objs: Phaser.GameObjects.GameObject[] = [panel(this, 40, 60, 400, 150)];
    objs.push(text(this, 240, 66, 'THE HOUSE STIRS', 12, '#e080ff').setOrigin(0.5, 0));
    const opts = plan.rouletteOptions;
    if (opts.length) {
      const bw = Math.min(90, 380 / opts.length);
      const boxes = opts.map((id, k) => {
        const x = 240 - (opts.length * bw) / 2 + k * bw + bw / 2;
        const r = this.add.rectangle(x, 104, bw - 6, 28, 0x2a1a3a).setStrokeStyle(1, 0x8a6ad0).setDepth(91);
        const t = text(this, x, 104, CARDS[id].name, 7, '#ffffff', { align: 'center', wordWrap: { width: bw - 8 } }).setOrigin(0.5, 0.5).setDepth(92);
        objs.push(r, t);
        return r;
      });
      const total = opts.length * 3 + plan.rouletteIndex;
      for (let k = 0; k <= total; k++) {
        boxes.forEach((b, j) => b.setFillStyle(j === k % opts.length ? 0x8a3ad8 : 0x2a1a3a));
        sfx('roll');
        await this.wait(60 + (k / total) ** 3 * 380);
      }
      sfx('bad');
      this.cameras.main.shake(200, 0.005);
    } else {
      objs.push(text(this, 240, 98, 'No danger cards this round.\nThe house picks a game anyway.', 8, '#c0b0e0', { align: 'center' }).setOrigin(0.5, 0));
    }
    await this.wait(700);
    const goal = GOALS.find((g) => g.id === plan.goal)!;
    const lines: [string, string][] = [];
    if (plan.card) {
      const c = CARDS[plan.card];
      lines.push([`HAZARD: ${c.name} in ${plan.rooms.map(roomName).join(', ')}`, '#ff9a60']);
      lines.push([c.blurb, '#c0b0e0']);
    } else lines.push(['No hazard: just the house as it is.', '#c0b0e0']);
    lines.push([`GAME: ${goal.name} - ${goal.blurb}`, '#ffe060']);
    lines.push([`FORMAT: ${this.formatLabel(plan)}`, '#80d0ff']);
    lines.forEach(([l, col], k) => objs.push(text(this, 52, 128 + k * 12, l, 7, col, { wordWrap: { width: 380 } })));
    objs.push(text(this, 240, 196, 'Contain the hazard together (good group score) or it lingers.', 6, '#9a90b8').setOrigin(0.5, 0));
    await this.waitOrConfirm(4200, 1200);
    objs.forEach((o) => o.destroy());
    return plan;
  }

  private formatLabel(plan: MinigamePlan): string {
    const names = (team: number) =>
      this.state.players.filter((_, i) => plan.teams[i] === team).map((p) => p.name).join(' & ');
    if (plan.format === 'ffa') return 'Free-for-all';
    if (plan.format === '2v2') return `2v2: ${names(0)}  vs  ${names(1)}`;
    return `1v3: ${names(plan.soloTeam)}  vs  ${names(1 - plan.soloTeam)}`;
  }

  // ------------------------------------------------------------ minigame

  private async minigame(plan: MinigamePlan) {
    const c = this.ctx;
    c.hazardHits.fill(0);
    c.coinDelta.fill(0);
    const hazard = plan.card ? createHazard(c, plan.card, plan.rooms) : null;
    const goal: GoalSystem = createGoal(c, plan);
    const mgSystems = [hazard, goal].filter(Boolean) as System[];
    this.springSeats = new Set(this.state.players.filter((p) => p.perks.includes('springBoots')).map((p) => p.id));
    this.headStartSeats = new Set(this.state.players.filter((p) => p.perks.includes('headStart')).map((p) => p.id));
    // Team colour markers above heads.
    const markers = this.avatars.map((av, i) =>
      this.add
        .rectangle(av.x, av.y - 11, 4, 2, plan.format === 'ffa' ? 0xffffff : plan.teams[i] === 1 ? 0xd84040 : 0x3a7ae8)
        .setDepth(31),
    );
    const followMarkers = () => markers.forEach((m, i) => m.setPosition(this.avatars[i].x, this.avatars[i].y - (this.avatars[i].flipped ? -11 : 11)));
    for (const s of ['3', '2', '1']) {
      this.centerText.setText(`${goal.hud()}   ${s}`);
      sfx('blip');
      followMarkers();
      await this.wait(600);
    }
    this.systems.push(...mgSystems);
    this.centerText.setText('GO!');
    sfx('select');
    this.mgStart = this.time.now;
    this.botGoalFn = (i) => goal.botGoal(i);
    this.avatarsActive = true;
    const secs = Number(new URLSearchParams(location.search).get('mg')) || MINIGAME_SECONDS;
    const end = this.time.now + secs * 1000;
    await this.waitUntil(() => {
      followMarkers();
      const left = Math.ceil((end - this.time.now) / 1000);
      const sc = goal.scores().map((v, i) => `${this.state.players[i].name.slice(0, 5)} ${Math.round(v * 10) / 10}`).join('  ');
      this.centerText.setText(`${goal.hud()}  ${left}s   ${sc}`);
      return this.time.now >= end;
    });
    this.avatarsActive = false;
    this.centerText.setText('');
    await this.banner('FINISH!', 900, '#ffd040');
    markers.forEach((m) => m.destroy());
    const scores = goal.scores();
    const n = this.avatars.length;
    const hazardTotal = c.hazardHits.reduce((a, b) => a + b, 0);
    const groupScore =
      plan.goal === 'survive' ? goal.groupScore() : 0.6 * goal.groupScore() + 0.4 * (1 - Math.min(1, hazardTotal / (n * 4)));
    const coinDelta = [...c.coinDelta];
    this.systems = this.systems.filter((s) => !mgSystems.includes(s));
    mgSystems.forEach((s) => s.destroy());
    this.springSeats.clear();
    this.headStartSeats.clear();
    c.coinDelta.fill(0);

    const rep = settle(this.state, plan, { scores, groupScore, coinDelta });
    // Results card.
    const objs: Phaser.GameObjects.GameObject[] = [panel(this, 60, 50, 360, 170)];
    objs.push(text(this, 240, 56, 'RESULTS', 12, '#ffd040').setOrigin(0.5, 0));
    const order = this.state.players.map((_, i) => i).sort((a, b) => rep.ranks[a] - rep.ranks[b]);
    order.forEach((i, k) => {
      const delta = coinDelta[i] ? `  (${coinDelta[i]} stolen)` : '';
      objs.push(
        text(this, 80, 78 + k * 12, `#${rep.ranks[i]}  ${this.state.players[i].name.padEnd(10)} score ${Math.round(scores[i] * 10) / 10}   +${rep.payouts[i]} coins${delta}`, 7, PLAYER_CSS[i]),
      );
    });
    let y = 134;
    objs.push(text(this, 80, y, `Group score: ${Math.round(groupScore * 100)}%`, 7, '#c0b0e0'));
    y += 12;
    if (plan.card) {
      const name = CARDS[plan.card].name;
      if (rep.contained) {
        objs.push(text(this, 80, y, `${name} was CONTAINED. The house is spared.`, 7, '#80e080'));
        sfx('win');
      } else {
        objs.push(text(this, 80, y, `${name} LINGERS in ${plan.rooms.map(roomName).join(', ')}.`, 7, '#ff8060'));
        sfx('bad');
      }
      y += 12;
    }
    for (const s of rep.spread) {
      objs.push(text(this, 80, y, `The fire spreads to the ${roomName(s.rooms[0])}!`, 7, '#ff8060'));
      y += 12;
    }
    if (rep.houseWins) objs.push(text(this, 80, y, 'Time is up...', 7, '#ff4040'));
    await this.waitOrConfirm(5000, 1200);
    objs.forEach((o) => o.destroy());
    this.buildHouse();
  }

  // ------------------------------------------------------------ ending

  private async ending() {
    const w = this.state.winner;
    this.avatarsActive = false;
    if (w !== null && w >= 0) {
      const p = this.state.players[w];
      sfx('win');
      this.cameras.main.flash(600, 255, 255, 255);
      // The reversal: the house rebuilds as if nothing ever happened.
      this.buildHouse([]);
      this.lineUpAtBoard();
      for (let k = 0; k < 40; k++) {
        const s = this.add.image(this.rnd() * 480, -10, 'spark').setTint([0xffd040, 0xe8504a, 0x4a8be8, 0x5cc85a][k % 4]).setDepth(97);
        this.tweens.add({ targets: s, y: 280, x: s.x + (this.rnd() - 0.5) * 80, duration: 1500 + this.rnd() * 1500, delay: this.rnd() * 800 });
      }
      await this.banner(`${p.name.toUpperCase()} ESCAPES!`, 2500, PLAYER_CSS[w], 'The game rewinds the house to how it was.\nEveryone else is stuck in the game...');
    } else {
      sfx('bad');
      this.cameras.main.shake(800, 0.01);
      await this.banner('THE HOUSE WINS', 2500, '#ff4040', 'Nobody reached the end in time.\nEveryone is trapped in the game.');
    }
    const standings = [...this.state.players].sort((a, b) => distToFinish(a.space) - distToFinish(b.space) || b.coins - a.coins);
    const objs: Phaser.GameObjects.GameObject[] = [panel(this, 110, 60, 260, 130)];
    objs.push(text(this, 240, 66, 'FINAL STANDINGS', 10, '#ffd040').setOrigin(0.5, 0));
    standings.forEach((p, k) =>
      objs.push(text(this, 130, 86 + k * 12, `${k + 1}. ${p.name.padEnd(10)} ${distToFinish(p.space)} spaces left, ${p.coins} coins`, 7, PLAYER_CSS[p.id])),
    );
    objs.push(text(this, 240, 170, `Rounds played: ${this.state.round}.  Press jump/confirm (or Enter) for the title.`, 6, '#c0b0e0').setOrigin(0.5, 0));
    const enter = this.input.keyboard!.addKey('ENTER');
    await this.wait(800);
    const allBots = this.seats.every((s) => s.isBot);
    const shownAt = this.time.now;
    await this.waitUntil(
      () => this.anyHumanConfirm() || Phaser.Input.Keyboard.JustDown(enter) || (allBots && this.time.now - shownAt > 8000),
    );
    this.scene.start('title');
  }
}
