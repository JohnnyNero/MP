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
import { minigameSeconds, PLAYER_COLORS, PLAYER_CSS, REGROUP_SECONDS, W, ZOOM } from '../config';
import { createGoal, safeRoomGoal, type GoalSystem } from '../goals';
import { createHazard, DarkOverlay, LingeringSystem } from '../hazards';
import { HouseView } from '../houseView';
import { inputHub, VirtualPad } from '../input';
import type { MGContext, System } from '../mgContext';
import { sfx } from '../sfx';
import { bevelBox, buttonName, C16, drawIcon, gfxPlot, keycap, Menu, mix, onCanvasTap, panel, text, Toaster } from '../ui';

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

/** The guided first round runs once per session (page load). */
let tutorialDone = false;
/** Width of one player's HUD chip. */
const CHIP_W = 94;

const BLANK = new VirtualPad();
const NO_FLIP = new Set<string>();
/** Gravity stays normal this close to a doorway, ladder, stairs or vent. */
const EXIT_ZONE = 22;

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
  private hudGfx: Phaser.GameObjects.Graphics[] = [];
  private hudSig: string[] = [];
  private toaster!: Toaster;
  /** Guided first round: contextual tips and in-world control glyphs. */
  private tutorial = false;
  private tipsShown = new Set<string>();
  private glyphs: Phaser.GameObjects.Container[] = [];
  private menuOpen = false;
  private glyphSig = '';

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
    this.hudGfx = [];
    this.hudSig = [];
    this.tipsShown = new Set();
    this.glyphs = [];
    this.menuOpen = false;
    const tq = new URLSearchParams(location.search).get('tutorial');
    this.tutorial = tq === '1' || (tq !== '0' && !tutorialDone && data.seats.some((s) => !s.isBot));
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
    this.toaster = new Toaster(this, 30, this.tutorial ? `${this.backName()} = skip tips` : '');
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
    this.lingering = new LingeringSystem(this.ctx, effects);
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

  /** Is the avatar standing by a way out of its room? (Flipped rooms keep these normal.) */
  private nearExit(av: Avatar): boolean {
    const room = av.room ? this.house.roomRect(av.room) : undefined;
    if (!room) return false;
    const xs: number[] = [];
    for (const e of this.house.nav) {
      if (e.from !== room.id && e.to !== room.id) continue;
      if (e.kind === 'door') xs.push(e.x);
      else if (e.climb) xs.push(e.climb.x0, e.climb.x1);
      else if (e.from === room.id) xs.push(e.x);
    }
    return xs.some((x) => Math.abs(av.x - x) < EXIT_ZONE);
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
          flippedRooms: this.nearExit(av) ? NO_FLIP : c.flippedRooms,
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
    if (this.tutorial && !this.menuOpen && this.seats.some((s, i) => !s.isBot && this.padFor(i).back)) this.endTutorial(true);
    this.dark.update();
    this.updateHud();
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  // ------------------------------------------------------------ HUD / feedback

  /** Top bar: one chip per player (colour pip, name, coin icon + count, item/perk icons) and the round. */
  private buildHud() {
    const bar = this.add.graphics().setDepth(95);
    const bp = gfxPlot(bar);
    bp(0, 0, 480, 14, 0x0c0814, 0.92);
    bp(0, 14, 480, 1, C16.rimLo);
    this.seats.forEach((s, i) => {
      const x = 2 + i * CHIP_W;
      const col = PLAYER_COLORS[i];
      // Pip in the player's colour; humans get a white top-light.
      bevelBox(bp, x, 3, 7, 9, col, s.isBot ? mix(col, 0xffffff, 0.3) : 0xffffff, mix(col, C16.ink, 0.45));
      this.hudTexts.push(text(this, x + 9, 2, this.state.players[i].name.slice(0, 4), 8, '#ffffff').setDepth(96));
      this.hudTexts.push(text(this, x + 42, 2, '', 8, '#ffe08a').setDepth(96));
      this.hudGfx.push(this.add.graphics().setDepth(96));
      this.hudSig.push('');
    });
    this.roundText = text(this, 477, 2, '', 8, '#c0b0e0').setOrigin(1, 0).setDepth(96);
    this.centerText = text(this, 240, 17, '', 8, '#ffffff', { align: 'center', wordWrap: { width: 440 } }).setOrigin(0.5, 0).setDepth(96);
  }

  private updateHud() {
    this.state.players.forEach((p, i) => {
      const x = 2 + i * CHIP_W;
      const inv = [...p.items, ...p.perks];
      const sig = `${p.coins}|${inv.join(',')}`;
      if (sig === this.hudSig[i]) return;
      this.hudSig[i] = sig;
      const ct = this.hudTexts[i * 2 + 1].setText(String(p.coins));
      const g = this.hudGfx[i].clear();
      drawIcon(g, 'coin', x + 34, 4);
      const ix = x + 44 + Math.ceil(ct.width);
      inv.forEach((it, k) => drawIcon(g, it, ix + k * 9, 4));
    });
    this.roundText.setText(`Round ${Math.max(1, this.state.round)}/${this.state.roundCap}`);
  }

  // ------------------------------------------------------------ guided first round

  private firstHuman(): number {
    return this.seats.findIndex((s) => !s.isBot);
  }

  private backName(): string {
    const h = this.firstHuman();
    return buttonName(h >= 0 ? this.seats[h].source : 'kb1', 'back');
  }

  /** Show a tutorial tip once (only while the guided first game is on). */
  private tip(id: string, msg: string) {
    if (!this.tutorial || this.tipsShown.has(id)) return;
    this.tipsShown.add(id);
    this.toaster.show(msg);
  }

  private endTutorial(skipped = false) {
    if (!this.tutorial) return;
    this.tutorial = false;
    tutorialDone = true;
    this.clearGlyphs();
    this.toaster.clear();
    if (skipped) this.popText('Tips off', 240, 40, '#c0b0e0');
  }

  private clearGlyphs() {
    this.glyphs.forEach((g) => {
      this.tweens.killTweensOf(g);
      g.destroy();
    });
    this.glyphs = [];
    this.glyphSig = '';
  }

  /**
   * In-world control prompts for each human: the button for the next ladder,
   * stairs or vent on their way to `targetRoom` (or the nearest one).
   */
  private placeGlyphs(targetRoom = this.house.boardRoom) {
    if (!this.tutorial) return this.clearGlyphs();
    const specs: { i: number; x: number; y: number; btn: 'up' | 'down'; verb: string }[] = [];
    this.seats.forEach((s, i) => {
      if (s.isBot) return;
      const av = this.avatars[i];
      if (!av.room) return;
      const route = this.house.route(av.room, targetRoom) ?? [];
      let e = route.find((r) => r.kind !== 'door');
      if (!e && av.room === targetRoom) return;
      e ??= this.house.nav
        .filter((r) => r.from === av.room && r.kind !== 'door')
        .sort((a, b) => Math.abs(a.x - av.x) - Math.abs(b.x - av.x))[0];
      if (!e) return;
      let x = e.x;
      let y: number;
      let btn: 'up' | 'down' = 'down';
      let verb = 'drop';
      if (e.kind === 'climbUp' && e.climb) {
        [x, y, btn, verb] = [e.climb.x0, e.climb.y0 - 22, 'up', e.climb.kind === 'stairs' ? 'stairs' : 'climb'];
      } else if (e.kind === 'climbDown' && e.climb) {
        [x, y, verb] = [e.climb.x1, e.climb.y1 - 22, 'down'];
      } else if (e.kind === 'vent') {
        const v = this.house.vents.find((vv) => vv.ax === e!.x || vv.bx === e!.x);
        y = (v ? (v.ax === e.x ? v.ay : v.by) : this.house.roomRect(e.from)!.bottom) - 22;
        verb = 'vent';
      } else {
        y = this.house.roomRect(e.from)!.bottom - 22;
      }
      // Stack prompts for several humans at the same spot.
      const dup = specs.filter((g) => Math.abs(g.x - x) < 40 && Math.abs(g.y - y) < 20).length;
      specs.push({ i, x: Math.max(34, Math.min(446, x)), y: y - dup * 22, btn, verb });
    });
    const sig = JSON.stringify(specs);
    if (sig === this.glyphSig) return;
    this.clearGlyphs();
    this.glyphSig = sig;
    for (const sp of specs) {
      const g = keycap(this, sp.x, sp.y, this.seats[sp.i].source, sp.btn, sp.verb);
      g.add(text(this, 0, -7, this.state.players[sp.i].name, 8, PLAYER_CSS[sp.i]).setOrigin(0.5, 1));
      this.tweens.add({ targets: g, y: g.y - 2, duration: 400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.glyphs.push(g);
    }
  }

  private popText(t: string, x: number, y: number, color = '#ffffff') {
    const o = text(this, x, y, t, 8, color).setOrigin(0.5, 1).setDepth(97);
    this.tweens.add({ targets: o, y: y - 14, alpha: 0, duration: 900, onComplete: () => o.destroy() });
  }

  private async banner(t: string, ms = 1400, color = '#ffffff', sub = '') {
    const g = panel(this, 90, 104, 300, sub ? 52 : 34).setDepth(98);
    const a = text(this, 240, 112, t, 10, color).setOrigin(0.5, 0).setDepth(99);
    const b = sub ? text(this, 240, 132, sub, 8, '#c0b0e0', { align: 'center', wordWrap: { width: 280 } }).setOrigin(0.5, 0).setDepth(99) : null;
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
      // The guided part covers the first two rounds.
      if (this.state.round >= 2) this.endTutorial();
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
    const firstRound = this.tutorial && roundNo === 1;
    if (firstRound) {
      this.time.delayedCall(1200, () => this.tip('race', 'Race to the board: arrival order = turn order.'));
      this.placeGlyphs();
    }
    let glyphT = this.time.now;
    this.botGoalFn = (i) =>
      arrived.includes(i)
        ? { kind: 'idle' }
        : { kind: 'goto', x: this.house.boardX + (i - 1.5) * 4, y: this.house.boardY - 8 };
    this.avatarsActive = true;
    const end = this.time.now + REGROUP_SECONDS * 1000;
    await this.waitUntil(() => {
      const left = Math.max(0, Math.ceil((end - this.time.now) / 1000));
      this.centerText.setText(`Get to the board! ${left}s   arrived: ${arrived.map((i) => this.state.players[i].name).join(', ')}`);
      if (firstRound && this.tutorial && this.time.now - glyphT > 500) {
        glyphT = this.time.now;
        this.placeGlyphs();
      }
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
    this.clearGlyphs();
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
    // Tips sit over the bottom strip while the board is up (clear of the path and the touch buttons).
    this.toaster.setPosition(200, 222);
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
    this.toaster.setPosition(240, 30);
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
        this.panel.dice.setText(ev.values.length > 1 || ev.bonus ? `${[...ev.values, ...(ev.bonus ? [ev.bonus] : [])].join('+')}=${ev.total}` : String(ev.total));
        this.panel.setInfo(ev.bonus ? `${name} rolled ${ev.total} (+${ev.bonus} catch-up bonus for last place).` : `${name} rolled ${ev.total}.`);
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
        this.tip('danger', 'Danger spaces add hazard cards to the house.');
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
        this.tip('repaired', 'Repairs fix the house for everyone.');
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
      case 'bonusSteps':
        this.panel.setInfo(`${ev.reason}: +${ev.steps} spaces!`);
        sfx('coin');
        return this.wait(650);
      case 'win':
        sfx('win');
        this.panel.setInfo(`${name} reached the end!`);
        return this.wait(1200);
    }
  }

  private async decide(pid: number, dec: Decision): Promise<Answer> {
    const seat = this.seats[pid];
    if (seat.isBot) {
      // Nothing to choose: bots roll straight away.
      if (dec.d === 'preRoll' && dec.options.length === 1) return dec.options[0];
      if (dec.d === 'junction') this.panel.showChoices(dec.options.map((o) => o.to), pid);
      await this.wait(450);
      return botDecide(this.state, pid, dec);
    }
    if (dec.d === 'preRoll') {
      // Only rolling is possible: skip the menu and go straight to the die.
      const opts = [...dec.options].sort((a, b) => (a === 'roll' ? -1 : b === 'roll' ? 1 : 0));
      if (opts.length === 1 && opts[0] === 'roll') return this.pressToRoll(pid, dec);
      if (opts.length) {
        const ans = await this.menuDecide(
          pid,
          dec,
          'Use an item before rolling?',
          opts.map((o) => (o === 'roll' ? 'Roll the die' : `Use ${SHOP_BY_ID[o].name} - ${SHOP_BY_ID[o].blurb}`)),
          opts,
        );
        return ans === 'roll' ? this.pressToRoll(pid, dec) : ans;
      }
    }
    let labels: string[] = [];
    let values: Answer[] = [];
    let title = '';
    let backValue: Answer | undefined;
    switch (dec.d) {
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
        this.tip('shop', 'Shop: items help on the board, perks in minigames.');
        title = `Shop - you have ${this.state.players[pid].coins} coins`;
        labels = [...dec.options.map((o) => `${SHOP_BY_ID[o.id].name} ${o.price}c - ${SHOP_BY_ID[o.id].blurb}`), 'Leave'];
        values = [...dec.options.map((o) => o.id), null];
        backValue = null;
        break;
      case 'repair':
        this.tip('repair', 'Repair spaces fix the house for everyone.');
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
    // A decision this UI doesn't know yet: let the bot logic answer it.
    if (!labels.length) return botDecide(this.state, pid, dec);
    return this.menuDecide(pid, dec, title, labels, values, backValue);
  }

  /** Show a menu for a human and wait for an answer (pad, or tap/click on a row). */
  private async menuDecide(pid: number, dec: Decision, title: string, labels: string[], values: Answer[], backValue?: Answer): Promise<Answer> {
    const menu = new Menu(this, 56, 128, 300, `${this.state.players[pid].name}: ${title}`, labels, PLAYER_CSS[pid]);
    this.menuOpen = true;
    let result: Answer | undefined;
    const openedAt = this.time.now;
    await this.nextFrame();
    menu.takeTap();
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
      if (pad.confirm || menu.takeTap()) result = values[menu.index];
      else if (pad.back && backValue !== undefined) result = backValue;
      return result !== undefined;
    });
    sfx('select');
    menu.destroy();
    this.menuOpen = false;
    return result!;
  }

  /**
   * The press-to-roll beat: a die spins on the board until the player presses
   * jump (or taps). The value is cosmetic; the core rolls right after.
   */
  private async pressToRoll(pid: number, dec: Decision): Promise<Answer> {
    const src = this.seats[pid].source;
    const name = this.state.players[pid].name;
    this.panel.setInfo(`${name}: press ${buttonName(src, 'jump')} to roll!`);
    this.tip('roll', 'Your turn: hit the die to roll!');
    const cap = keycap(this, 190, 119, src, 'jump', 'roll').setDepth(70);
    this.tweens.add({ targets: cap, scale: { from: 1, to: 1.15 }, duration: 300, yoyo: true, repeat: -1 });
    let tapped = false;
    const offTap = onCanvasTap(this, () => (tapped = true));
    const openedAt = this.time.now;
    let last = 0;
    await this.nextFrame();
    tapped = false;
    await this.waitUntil(() => {
      if (this.time.now - last > 70) {
        last = this.time.now;
        this.panel.dice.setText(String(1 + Math.floor(this.rnd() * 6)));
      }
      // Auto-roll if nobody presses for a long time (e.g. a controller dropped out).
      return this.padFor(pid).confirm || tapped || this.time.now - openedAt > 30000;
    });
    offTap();
    this.tweens.killTweensOf(cap);
    cap.destroy();
    sfx('select');
    return dec.d === 'preRoll' && dec.options.includes('roll') ? 'roll' : null;
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
      delete plan.vetoedIndex;
    }
    const qg = q.get('goal') as GoalId | null;
    if (qg && GOALS.some((g) => g.id === qg)) plan.goal = qg;
    const objs: Phaser.GameObjects.GameObject[] = [panel(this, 40, 60, 400, 156)];
    this.toaster.setPosition(200, 222);
    objs.push(text(this, 240, 66, 'THE HOUSE STIRS', 10, '#e080ff').setOrigin(0.5, 0));
    const opts = plan.rouletteOptions;
    if (opts.length) {
      const bw = Math.min(90, 380 / opts.length);
      const boxes = opts.map((id, k) => {
        const x = 240 - (opts.length * bw) / 2 + k * bw + bw / 2;
        const r = this.add.rectangle(x, 104, bw - 6, 30, 0x2a1a3a).setStrokeStyle(1, 0x8a6ad0).setDepth(91);
        const t = text(this, x, 104, CARDS[id].name, 8, '#ffffff', { align: 'center', wordWrap: { width: bw - 8 } }).setOrigin(0.5, 0.5).setDepth(92);
        objs.push(r, t);
        return r;
      });
      const spin = async (target: number, laps: number, skip = -1) => {
        const live = opts.map((_, j) => j).filter((j) => j !== skip);
        const end = laps * live.length + live.indexOf(target);
        for (let k = 0; k <= end; k++) {
          const at = live[k % live.length];
          boxes.forEach((b, j) => j !== skip && b.setFillStyle(j === at ? 0x8a3ad8 : 0x2a1a3a));
          sfx('roll');
          await this.wait(60 + (k / Math.max(1, end)) ** 3 * 380);
        }
      };
      const vetoed = plan.vetoedIndex;
      if (vetoed !== undefined && vetoed >= 0 && vetoed < opts.length) {
        // Re-spin veto: the first pick is thrown out and the roulette spins again.
        await spin(vetoed, 3);
        await this.wait(300);
        const vb = boxes[vetoed];
        vb.setFillStyle(0x3a2030).setStrokeStyle(1, 0xe8504a);
        objs.push(text(this, vb.x, vb.y + 18, 'VETOED', 8, '#ff8060').setOrigin(0.5, 0).setDepth(92));
        sfx('select');
        await this.wait(700);
        // Every box of the vetoed card type is out.
        const outIdx = opts.map((id, j) => (id === opts[vetoed] ? j : -1)).filter((j) => j >= 0);
        outIdx.forEach((j) => boxes[j].setFillStyle(0x3a2030));
        if (plan.rouletteIndex >= 0) {
          const live = opts.map((_, j) => j).filter((j) => !outIdx.includes(j));
          const end = 2 * live.length + live.indexOf(plan.rouletteIndex);
          for (let k = 0; k <= end; k++) {
            const at = live[k % live.length];
            live.forEach((j) => boxes[j].setFillStyle(j === at ? 0x8a3ad8 : 0x2a1a3a));
            sfx('roll');
            await this.wait(60 + (k / Math.max(1, end)) ** 3 * 380);
          }
        }
      } else if (plan.rouletteIndex >= 0) await spin(plan.rouletteIndex, 3);
      if (!plan.card) objs.push(text(this, 240, 78, 'Hazard vetoed!', 8, '#80e080').setOrigin(0.5, 0).setDepth(92));
      if (plan.card) {
        sfx('bad');
        this.cameras.main.shake(200, 0.005);
      } else sfx('win');
    } else {
      objs.push(text(this, 240, 92, 'No danger cards this round.\nThe house picks a game anyway.', 8, '#c0b0e0', { align: 'center' }).setOrigin(0.5, 0));
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
    let ly = 126;
    for (const [l, col] of lines) {
      const t = text(this, 52, ly, l, 8, col, { wordWrap: { width: 376 } });
      objs.push(t);
      ly += Math.max(11, t.height + 1);
    }
    if (plan.card) objs.push(text(this, 240, Math.max(ly + 2, 194), 'Contain the hazard together (good group score) or it lingers.', 8, '#9a90b8').setOrigin(0.5, 0));
    if (plan.card) this.tip('contain', 'Contain the hazard together or it lingers.');
    await this.waitOrConfirm(4200, 1200);
    objs.forEach((o) => o.destroy());
    this.toaster.setPosition(240, 30);
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
    // Let the goal know about this round's flipped rooms before the first frame runs.
    if (plan.card === 'gravity') plan.rooms.forEach((r) => c.flippedRooms.add(r));
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
    if (this.tutorial && this.state.round <= 1) {
      // Show each human their jump button over their head for a moment.
      this.seats.forEach((s, i) => {
        if (s.isBot) return;
        const av = this.avatars[i];
        const g = keycap(this, av.x, av.y - 22, s.source, 'jump', 'jump');
        this.tweens.add({ targets: g, y: g.y - 8, alpha: 0, delay: 2200, duration: 600, onComplete: () => g.destroy() });
      });
      const gd = GOALS.find((g) => g.id === plan.goal)!;
      this.tip('goal', `${gd.name}: ${gd.blurb}`);
    }
    const secs = minigameSeconds(plan.goal);
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
    // Group score: how well the group played the goal, and how little trouble
    // this round's hazard caused (hits, time in the dark/flipped, coins stolen).
    const trouble = hazard ? hazard.trouble() : 0;
    const groupScore = 0.6 * goal.groupScore() + 0.4 * (1 - trouble);
    const coinDelta = [...c.coinDelta];
    this.systems = this.systems.filter((s) => !mgSystems.includes(s));
    mgSystems.forEach((s) => s.destroy());
    this.springSeats.clear();
    this.headStartSeats.clear();
    c.coinDelta.fill(0);

    const coinsBefore = this.state.players.map((p) => p.coins);
    const rep = settle(this.state, plan, { scores, groupScore, coinDelta });
    // Results card.
    const objs: Phaser.GameObjects.GameObject[] = [];
    this.toaster.setPosition(200, 226);
    objs.push(text(this, 240, 50, 'RESULTS', 10, '#ffd040').setOrigin(0.5, 0));
    objs.push(text(this, 68, 66, 'rank  player  score', 8, '#9a90b8'), text(this, 212, 66, 'coins', 8, '#9a90b8'));
    const icons = this.add.graphics().setDepth(91);
    objs.push(icons);
    const order = this.state.players.map((_, i) => i).sort((a, b) => rep.ranks[a] - rep.ranks[b]);
    order.forEach((i, k) => {
      const y0 = 78 + k * 12;
      const before = coinsBefore[i];
      const after = this.state.players[i].coins;
      const d = after - before;
      const stolen = coinDelta[i] ? ` (${coinDelta[i] > 0 ? '+' : ''}${coinDelta[i]} stolen)` : '';
      objs.push(
        text(this, 68, y0, `#${rep.ranks[i]}    ${this.state.players[i].name.slice(0, 6).padEnd(6)}  ${String(Math.round(scores[i] * 10) / 10).padEnd(6)}`, 8, PLAYER_CSS[i]),
      );
      drawIcon(icons, 'coin', 212, y0 + 2);
      objs.push(text(this, 222, y0, `${before} → ${after}`, 8, '#ffe08a'));
      objs.push(text(this, 272, y0, `${d >= 0 ? '+' : ''}${d}${stolen}`, 8, d > 0 ? '#80e080' : d < 0 ? '#ff8060' : '#c0b0e0'));
    });
    let y = 132;
    objs.push(text(this, 68, y, `Group score: ${Math.round(groupScore * 100)}%`, 8, '#c0b0e0'));
    y += 12;
    if (plan.card) {
      const name = CARDS[plan.card].name;
      if (rep.contained) {
        objs.push(text(this, 68, y, `${name} was CONTAINED. The house is spared.`, 8, '#80e080'));
        sfx('win');
      } else {
        objs.push(text(this, 68, y, `${name} LINGERS in ${plan.rooms.map(roomName).join(', ')}.`, 8, '#ff8060', { wordWrap: { width: 340 } }));
        sfx('bad');
        this.tip('linger', 'Lingering hazards stay until someone repairs them.');
      }
      y += 12;
    }
    for (const s of rep.spread) {
      objs.push(text(this, 68, y, `The fire spreads to the ${roomName(s.rooms[0])}!`, 8, '#ff8060'));
      y += 12;
    }
    if (rep.houseWins) {
      objs.push(text(this, 68, y, 'Time is up...', 8, '#ff4040'));
      y += 12;
    }
    objs.push(panel(this, 50, 44, 380, Math.min(180, y - 44 + 10)));
    await this.waitOrConfirm(5000, 1200);
    objs.forEach((o) => o.destroy());
    this.toaster.setPosition(240, 30);
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
    const objs: Phaser.GameObjects.GameObject[] = [panel(this, 90, 56, 300, 140)];
    objs.push(text(this, 240, 66, 'FINAL STANDINGS', 10, '#ffd040').setOrigin(0.5, 0));
    standings.forEach((p, k) =>
      objs.push(text(this, 106, 84 + k * 12, `${k + 1}. ${p.name.padEnd(6)} ${String(distToFinish(p.space)).padStart(2)} spaces left, ${p.coins} coins`, 8, PLAYER_CSS[p.id])),
    );
    objs.push(text(this, 240, 140, `Rounds played: ${this.state.round}.\nPress jump (or Enter) for the title.`, 8, '#c0b0e0', { align: 'center', wordWrap: { width: 270 } }).setOrigin(0.5, 0));
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
