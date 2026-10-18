import {
  BLUE_COINS,
  BOARD,
  FIRST_ARRIVAL_BONUS,
  LAST_PLACE_ROLL_BONUS,
  GATE_COST,
  MAX_ITEMS,
  MAX_PERKS,
  RED_COINS,
  REPAIR_AGE_COST,
  REPAIR_BONUS_STEPS,
  REPAIR_COST,
  REPAIR_MAX_COST,
  ROUND_CAP,
  STARTING_COINS,
  TOLL_COST,
} from '../content/board';
import { CARDS, DECK_COUNTS, GOALS, SHOP, SHOP_BY_ID } from '../content/cards';
import { HOUSE } from '../content/house';
import { distToFinish } from './board';
import { deriveHouse, neighbours, roomsOnFloor } from './house';
import { initRng, pick, rand, randInt, shuffle } from './rng';
import type {
  ActiveEffect,
  Format,
  GameState,
  GoalId,
  HazardId,
  ItemId,
  MinigamePlan,
  MinigameResult,
  PerkId,
  PlayerState,
  SettleReport,
} from './types';

export interface PlayerConfig {
  name: string;
  isBot: boolean;
  difficulty?: number;
}

export function newGame(seed: number, configs: PlayerConfig[]): GameState {
  if (configs.length < 2 || configs.length > 4) throw new Error('2-4 players');
  const rng = initRng(seed);
  const players: PlayerState[] = configs.map((c, i) => ({
    id: i,
    name: c.name,
    isBot: c.isBot,
    difficulty: c.difficulty ?? 1,
    coins: STARTING_COINS,
    space: BOARD.start,
    trail: [],
    items: [],
    perks: [],
    color: 'neutral',
  }));
  const state: GameState = {
    seed,
    rng,
    round: 0,
    roundCap: ROUND_CAP,
    phase: 'regroup',
    players,
    turnOrder: players.map((p) => p.id),
    pool: [],
    deck: [],
    effects: [],
    nextUid: 1,
    openGates: [],
    respinArmed: false,
    winner: null,
    log: [],
  };
  refillDeck(state);
  return state;
}

function refillDeck(state: GameState) {
  const deck: HazardId[] = [];
  for (const [id, n] of Object.entries(DECK_COUNTS) as [HazardId, number][]) {
    for (let i = 0; i < n; i++) deck.push(id);
  }
  state.deck = shuffle(state.rng, 'cards', deck);
}

function log(state: GameState, msg: string) {
  state.log.push(`R${state.round}: ${msg}`);
  if (state.log.length > 200) state.log.shift();
}

// ---------------------------------------------------------------- regroup

/**
 * Start a new round. `arrivalOrder` lists player ids in the order they
 * reached the board; anyone missing was a straggler and goes last.
 */
export function startRound(state: GameState, arrivalOrder: number[], arrivedCount = arrivalOrder.length): void {
  state.round += 1;
  const seen = new Set<number>();
  const order: number[] = [];
  for (const id of arrivalOrder) {
    if (!seen.has(id) && state.players[id]) {
      seen.add(id);
      order.push(id);
    }
  }
  for (const p of state.players) if (!seen.has(p.id)) order.push(p.id);
  state.turnOrder = order;
  // Arrival bonus (catch-up): among the players who reached the board, the
  // one furthest from the finish gets it; ties go to the earliest arrival.
  const arrived = order.slice(0, Math.min(arrivedCount, order.length));
  if (arrived.length > 0 && state.round > 1) {
    const behind = arrived.reduce((best, id) =>
      distToFinish(state.players[id].space) > distToFinish(state.players[best].space) ? id : best,
    );
    state.players[behind].coins += FIRST_ARRIVAL_BONUS;
  }
  for (const p of state.players) p.color = 'neutral';
  state.pool = [];
  state.respinArmed = false;
  state.phase = 'turns';
  log(state, `round starts, order ${order.join(',')}`);
}

// ---------------------------------------------------------------- turns

export type TurnEvent =
  | { t: 'useItem'; item: ItemId }
  /** `bonus` is the catch-up +1 for last place (already included in total). */
  | { t: 'roll'; values: number[]; total: number; bonus?: number }
  | { t: 'move'; from: string; to: string; stepsLeft: number }
  | { t: 'coins'; delta: number; reason: string }
  | { t: 'drawCard'; card: HazardId }
  | { t: 'bought'; id: ItemId | PerkId }
  | { t: 'repaired'; uid: number; card: HazardId }
  /** Extra steps granted mid-turn (the repair reward). */
  | { t: 'bonusSteps'; steps: number; reason: string }
  | { t: 'gateOpened'; space: string }
  | { t: 'pushed'; target: number; to: string }
  | { t: 'swapped'; a: number; b: number }
  | { t: 'respinArmed' }
  | { t: 'win' };

export interface JunctionOption {
  to: string;
  cost: number;
  label: string;
}
export interface ShopOption {
  id: ItemId | PerkId;
  price: number;
}
export interface RepairOption {
  uid: number;
  card: HazardId;
  rooms: string[];
  price: number;
}

export type Decision =
  | { d: 'preRoll'; options: ('roll' | ItemId)[] }
  | { d: 'reroll'; total: number }
  | { d: 'junction'; options: JunctionOption[] }
  | { d: 'shop'; options: ShopOption[] }
  | { d: 'repair'; options: RepairOption[] }
  | { d: 'target'; options: number[]; purpose: 'pushBack' };

export type TurnStep = { kind: 'event'; ev: TurnEvent } | { kind: 'decide'; dec: Decision };

/** Answers: preRoll -> 'roll' | ItemId, reroll -> boolean, junction -> index,
 *  shop -> id | null, repair -> uid | null, target -> player id. */
export type Answer = string | number | boolean | null;

const PRE_ROLL_ITEMS: ItemId[] = ['doubleDie', 'pushBack', 'warpSwap', 'respin'];

function rollDie(state: GameState): number {
  return 1 + randInt(state.rng, 'board', 6);
}

/** Catch-up: +1 to the roll of the player(s) strictly furthest from the finish. */
export function catchUpBonus(state: GameState, pid: number): number {
  const d = state.players.map((o) => distToFinish(o.space));
  const max = Math.max(...d);
  // Only a lone straggler gets it: when several players share last place (e.g. at
  // the start) nobody does.
  return d[pid] === max && d.filter((x) => x === max).length === 1 ? LAST_PLACE_ROLL_BONUS : 0;
}

/** The rival closest to the finish (ties: lowest id). */
export function leadingRival(state: GameState, pid: number): PlayerState {
  return state.players
    .filter((o) => o.id !== pid)
    .reduce((best, o) => (distToFinish(o.space) < distToFinish(best.space) ? o : best));
}

/** Repair price grows with how long the effect has lingered. */
export function repairPrice(state: GameState, e: ActiveEffect): number {
  const age = Math.max(0, state.round - e.round - 1);
  return Math.min(REPAIR_MAX_COST, REPAIR_COST + REPAIR_AGE_COST * age);
}

export function junctionOptions(state: GameState, p: PlayerState, from: string): JunctionOption[] {
  const opts: JunctionOption[] = [];
  for (const to of BOARD.spaces[from].next) {
    const sp = BOARD.spaces[to];
    if (sp.type === 'toll') {
      if (p.coins >= TOLL_COST) opts.push({ to, cost: TOLL_COST, label: `Toll route (${TOLL_COST} coins)` });
    } else if (sp.type === 'gate' && !state.openGates.includes(to)) {
      if (p.coins >= GATE_COST) opts.push({ to, cost: GATE_COST, label: `Open shortcut (${GATE_COST} coins)` });
    } else {
      opts.push({ to, cost: 0, label: sp.type === 'gate' ? 'Shortcut (open)' : 'Long way' });
    }
  }
  return opts;
}

export function shopOptions(p: PlayerState): ShopOption[] {
  return SHOP.filter((e) => {
    if (e.price > p.coins) return false;
    if (e.kind === 'item') return p.items.length < MAX_ITEMS;
    return p.perks.length < MAX_PERKS && !p.perks.includes(e.id as PerkId);
  }).map((e) => ({ id: e.id, price: e.price }));
}

export function repairOptions(state: GameState, p: PlayerState): RepairOption[] {
  return state.effects
    .map((e) => ({ uid: e.uid, card: e.card, rooms: e.rooms, price: repairPrice(state, e) }))
    .filter((o) => o.price <= p.coins);
}

function moveBack(p: PlayerState, n: number): string {
  for (let i = 0; i < n && p.trail.length > 0; i++) p.space = p.trail.pop()!;
  return p.space;
}

/**
 * One player's board turn as a generator. Yields events (for animation) and
 * decisions (answered by the UI or a bot via `next(answer)`).
 */
export function* takeTurn(state: GameState, pid: number): Generator<TurnStep, void, Answer> {
  const p = state.players[pid];
  if (state.winner !== null) return;

  // --- pre-roll: use items until the player chooses to roll.
  let dice = 1;
  for (;;) {
    const pushable = state.players.filter((o) => o.id !== pid && o.trail.length > 0).map((o) => o.id);
    const usable = PRE_ROLL_ITEMS.filter(
      (it) =>
        p.items.includes(it) &&
        !(it === 'doubleDie' && dice > 1) &&
        !(it === 'respin' && state.respinArmed) &&
        !(it === 'pushBack' && pushable.length === 0),
    );
    // Humans always get a press-to-roll beat, even with nothing to use.
    if (usable.length === 0 && p.isBot) break;
    const ans = (yield { kind: 'decide', dec: { d: 'preRoll', options: ['roll', ...usable] } }) as string;
    if (ans === 'roll' || !usable.includes(ans as ItemId)) break;
    const item = ans as ItemId;
    p.items.splice(p.items.indexOf(item), 1);
    yield { kind: 'event', ev: { t: 'useItem', item } };
    if (item === 'doubleDie') dice = 2;
    else if (item === 'respin') {
      state.respinArmed = true;
      yield { kind: 'event', ev: { t: 'respinArmed' } };
    } else if (item === 'pushBack') {
      const rivals = pushable;
      const target = (yield { kind: 'decide', dec: { d: 'target', options: rivals, purpose: 'pushBack' } }) as number;
      const t = state.players[rivals.includes(target) ? target : rivals[0]];
      const to = moveBack(t, 3);
      yield { kind: 'event', ev: { t: 'pushed', target: t.id, to } };
    } else if (item === 'warpSwap') {
      const t = leadingRival(state, pid);
      [p.space, t.space] = [t.space, p.space];
      [p.trail, t.trail] = [t.trail, p.trail];
      yield { kind: 'event', ev: { t: 'swapped', a: pid, b: t.id } };
    }
  }

  // --- roll
  const bonus = catchUpBonus(state, pid);
  const roll = () => Array.from({ length: dice }, () => rollDie(state));
  let values = roll();
  let total = values.reduce((a, b) => a + b, 0) + bonus;
  yield { kind: 'event', ev: { t: 'roll', values, total, ...(bonus ? { bonus } : {}) } };
  if (p.items.includes('reroll')) {
    const again = yield { kind: 'decide', dec: { d: 'reroll', total } };
    if (again === true) {
      p.items.splice(p.items.indexOf('reroll'), 1);
      yield { kind: 'event', ev: { t: 'useItem', item: 'reroll' } };
      values = roll();
      total = values.reduce((a, b) => a + b, 0) + bonus;
      yield { kind: 'event', ev: { t: 'roll', values, total, ...(bonus ? { bonus } : {}) } };
    }
  }

  // --- move (and land; a repair reward can send us on a few more steps)
  let steps = total;
  for (;;) {
    while (steps > 0) {
      const from = p.space;
      const nexts = BOARD.spaces[from].next;
      if (nexts.length === 0) break;
      let to = nexts[0];
      if (nexts.length > 1) {
        let opts = junctionOptions(state, p, from);
        if (opts.length === 0) {
          // Every branch costs coins we don't have: take the first free-looking one.
          const free = nexts.find((n) => BOARD.spaces[n].type !== 'toll' && BOARD.spaces[n].type !== 'gate') ?? nexts[0];
          opts = [{ to: free, cost: 0, label: 'Only way' }];
        }
        const idx =
          opts.length === 1 ? 0 : ((yield { kind: 'decide', dec: { d: 'junction', options: opts } }) as number);
        const choice = opts[Math.max(0, Math.min(opts.length - 1, idx | 0))];
        to = choice.to;
        const sp = BOARD.spaces[to];
        if (sp.type === 'gate' && !state.openGates.includes(to)) {
          p.coins -= GATE_COST;
          state.openGates.push(to);
          yield { kind: 'event', ev: { t: 'coins', delta: -GATE_COST, reason: 'Opened the shortcut' } };
          yield { kind: 'event', ev: { t: 'gateOpened', space: to } };
        }
      }
      steps -= 1;
      p.trail.push(from);
      p.space = to;
      yield { kind: 'event', ev: { t: 'move', from, to, stepsLeft: steps } };
      const sp = BOARD.spaces[to];
      if (sp.type === 'toll') {
        const fee = Math.min(TOLL_COST, p.coins);
        p.coins -= fee;
        yield { kind: 'event', ev: { t: 'coins', delta: -fee, reason: 'Toll' } };
      }
      if (sp.type === 'finish') {
        state.winner = pid;
        state.phase = 'over';
        log(state, `${p.name} wins`);
        yield { kind: 'event', ev: { t: 'win' } };
        return;
      }
      if (steps > 0) steps += yield* passOrLandService(state, p, sp.type);
    }
    const extra = yield* land(state, p, pid);
    if (extra <= 0) return;
    steps = extra;
  }
}

function* land(state: GameState, p: PlayerState, pid: number): Generator<TurnStep, number, Answer> {
  const sp = BOARD.spaces[p.space];
  switch (sp.type) {
    case 'blue':
      p.coins += BLUE_COINS;
      p.color = 'blue';
      yield { kind: 'event', ev: { t: 'coins', delta: BLUE_COINS, reason: 'Blue space' } };
      break;
    case 'red': {
      const loss = Math.min(RED_COINS, p.coins);
      p.coins -= loss;
      p.color = 'red';
      yield { kind: 'event', ev: { t: 'coins', delta: -loss, reason: 'Red space' } };
      break;
    }
    case 'danger': {
      if (state.deck.length === 0) refillDeck(state);
      const card = state.deck.pop()!;
      state.pool.push({ card, drawnBy: pid });
      log(state, `${p.name} drew ${card}`);
      yield { kind: 'event', ev: { t: 'drawCard', card } };
      break;
    }
    case 'shop':
    case 'repair':
      return yield* passOrLandService(state, p, sp.type);
    default:
      break;
  }
  return 0;
}

function* passOrLandService(
  state: GameState,
  p: PlayerState,
  type: string,
): Generator<TurnStep, number, Answer> {
  if (type === 'shop') {
    const options = shopOptions(p);
    if (options.length === 0) return 0;
    const ans = yield { kind: 'decide', dec: { d: 'shop', options } };
    const opt = options.find((o) => o.id === ans);
    if (!opt) return 0;
    const entry = SHOP_BY_ID[opt.id];
    p.coins -= opt.price;
    if (entry.kind === 'item') p.items.push(opt.id as ItemId);
    else p.perks.push(opt.id as PerkId);
    yield { kind: 'event', ev: { t: 'coins', delta: -opt.price, reason: entry.name } };
    yield { kind: 'event', ev: { t: 'bought', id: opt.id } };
  } else if (type === 'repair') {
    const options = repairOptions(state, p);
    if (options.length === 0) return 0;
    const ans = yield { kind: 'decide', dec: { d: 'repair', options } };
    const opt = options.find((o) => o.uid === ans);
    if (!opt) return 0;
    p.coins -= opt.price;
    state.effects = state.effects.filter((e) => e.uid !== opt.uid);
    log(state, `${p.name} repaired ${opt.card}`);
    yield { kind: 'event', ev: { t: 'coins', delta: -opt.price, reason: 'Repair' } };
    yield { kind: 'event', ev: { t: 'repaired', uid: opt.uid, card: opt.card } };
    // Repair reward: the repairer gets a tempo boost, not just a public good.
    yield { kind: 'event', ev: { t: 'bonusSteps', steps: REPAIR_BONUS_STEPS, reason: 'Repair reward' } };
    return REPAIR_BONUS_STEPS;
  }
  return 0;
}

// ---------------------------------------------------------------- house turn

export function computeFormat(state: GameState): { format: Format; teams: number[]; soloTeam: number } {
  const n = state.players.length;
  const teams = state.players.map(() => 0);
  if (n < 4) return { format: 'ffa', teams, soloTeam: -1 };
  const colors = state.players.map((p) => p.color);
  const resolved = colors.map((c) =>
    c === 'neutral' ? (rand(state.rng, 'format') < 0.5 ? 'blue' : 'red') : c,
  );
  const reds = resolved.filter((c) => c === 'red').length;
  resolved.forEach((c, i) => (teams[i] = c === 'red' ? 1 : 0));
  if (reds === 0 || reds === 4) return { format: 'ffa', teams: teams.map(() => 0), soloTeam: -1 };
  if (reds === 2) return { format: '2v2', teams, soloTeam: -1 };
  return { format: '1v3', teams, soloTeam: reds === 1 ? 1 : 0 };
}

export function targetRooms(state: GameState, card: HazardId): string[] {
  const t = CARDS[card].targeting;
  if (t.kind === 'floor') return roomsOnFloor(t.floor);
  if (t.kind === 'randomFloor') return roomsOnFloor(randInt(state.rng, 'house', 3));
  return [pick(state.rng, 'house', HOUSE.rooms).id];
}

export function planHouseTurn(state: GameState): MinigamePlan {
  state.phase = 'house';
  const rouletteOptions = state.pool.map((c) => c.card);
  let card: HazardId | null = null;
  let rouletteIndex = -1;
  let vetoedIndex: number | undefined;
  if (rouletteOptions.length > 0) {
    rouletteIndex = randInt(state.rng, 'cards', rouletteOptions.length);
    if (state.respinArmed) {
      // Veto: the card it lands on is thrown out and the roulette re-picks
      // among the other cards. Vetoing the only card type cancels the hazard.
      vetoedIndex = rouletteIndex;
      const vetoed = rouletteOptions[rouletteIndex];
      const rest = rouletteOptions.map((c, i) => (c === vetoed ? -1 : i)).filter((i) => i >= 0);
      rouletteIndex = rest.length ? pick(state.rng, 'cards', rest) : -1;
    }
    card = rouletteIndex >= 0 ? rouletteOptions[rouletteIndex] : null;
  }
  const rooms = card ? targetRooms(state, card) : [];
  const { format, teams, soloTeam } = computeFormat(state);
  const goals = GOALS.filter(
    (g) => g.formats.includes(format) && !(card && CARDS[card].incompatibleGoals?.includes(g.id)),
  );
  const goal: GoalId = pick(state.rng, 'house', goals).id;
  state.pool = [];
  state.respinArmed = false;
  state.phase = 'minigame';
  log(state, `minigame ${goal} (${format}) hazard ${card ?? 'none'}`);
  return {
    card, rooms, goal, format, teams, soloTeam, rouletteOptions, rouletteIndex,
    ...(vetoedIndex !== undefined ? { vetoedIndex } : {}),
  };
}

// ---------------------------------------------------------------- settle

const FFA_PAYOUT: Record<number, number[]> = {
  2: [10, 3],
  3: [10, 5, 2],
  4: [10, 6, 3, 1],
};

export function rankScores(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

export function computePayouts(plan: MinigamePlan, scores: number[]): { ranks: number[]; payouts: number[] } {
  const n = scores.length;
  if (plan.format === 'ffa') {
    const ranks = rankScores(scores);
    return { ranks, payouts: ranks.map((r) => FFA_PAYOUT[n][r - 1]) };
  }
  const teamAvg = [0, 1].map((t) => {
    const members = scores.filter((_, i) => plan.teams[i] === t);
    return members.length ? members.reduce((a, b) => a + b, 0) / members.length : 0;
  });
  const winner = teamAvg[0] === teamAvg[1] ? -1 : teamAvg[0] > teamAvg[1] ? 0 : 1;
  const ranks = plan.teams.map((t) => (winner === -1 ? 1 : t === winner ? 1 : 2));
  const payouts = plan.teams.map((t) => {
    if (winner === -1) return 5;
    if (plan.format === '2v2') return t === winner ? 10 : 2;
    const solo = t === plan.soloTeam;
    if (t === winner) return solo ? 15 : 6;
    return solo ? 0 : 2;
  });
  return { ranks, payouts };
}

function lingerEffect(state: GameState, card: HazardId, rooms: string[]): ActiveEffect {
  const def = CARDS[card];
  const e: ActiveEffect = { uid: state.nextUid++, card, rooms: [...rooms], round: state.round };
  const house = deriveHouse(state);
  if (def.blocksConnection) {
    const room = pick(state.rng, 'house', rooms);
    const options = house.connections.filter(
      (c) => (c.a === room || c.b === room) && !house.blocked.has(c.id),
    );
    if (options.length) e.blockedConnection = pick(state.rng, 'house', options).id;
  }
  if (def.makesHole) {
    const holed = new Set(state.effects.filter((x) => x.hole).map((x) => x.hole!.from));
    const free = rooms.filter((r) => !holed.has(r));
    const room = free.length ? pick(state.rng, 'house', free) : null;
    const r = HOUSE.rooms.find((x) => x.id === room);
    const below = r && HOUSE.rooms.find((x) => x.floor === r.floor - 1 && x.col === r.col);
    if (room && below) e.hole = { from: room, to: below.id };
  }
  if (def.movesBoard && rooms.includes(house.boardRoom)) {
    const opts = neighbours(house.boardRoom, house.connections, house.blocked).filter((x) => {
      const rr = HOUSE.rooms.find((q) => q.id === x)!;
      const br = HOUSE.rooms.find((q) => q.id === house.boardRoom)!;
      return rr.floor === br.floor;
    });
    if (opts.length) e.boardTo = pick(state.rng, 'house', opts);
  }
  return e;
}

export function settle(state: GameState, plan: MinigamePlan, result: MinigameResult): SettleReport {
  const { ranks, payouts } = computePayouts(plan, result.scores);
  state.players.forEach((p, i) => {
    p.coins = Math.max(0, p.coins + payouts[i] + (result.coinDelta?.[i] ?? 0));
    p.perks = []; // perks are consumed by the minigame they were bought for
  });
  let newEffect: ActiveEffect | null = null;
  let contained = true;
  if (plan.card) {
    contained = result.groupScore >= CARDS[plan.card].containBar;
    if (!contained) {
      newEffect = lingerEffect(state, plan.card, plan.rooms);
      state.effects.push(newEffect);
    }
  }
  // Lingering effects that spread (fire) creep into a neighbouring room.
  const spread: ActiveEffect[] = [];
  const house = deriveHouse(state);
  const burning = new Set(Object.keys(house.tags).filter((r) => house.tags[r].includes('burning')));
  // At most one spread per settle: a single roll, then one random source.
  const spreaders = state.effects.filter((e) => e !== newEffect && CARDS[e.card].spreadChance);
  if (spreaders.length > 0) {
    const chance = Math.max(...spreaders.map((e) => CARDS[e.card].spreadChance!));
    if (rand(state.rng, 'house') < chance) {
      const sources = spreaders
        .map((e) => ({
          e,
          cands: e.rooms.flatMap((r) => neighbours(r, house.connections, house.blocked)).filter((r) => !burning.has(r)),
        }))
        .filter((x) => x.cands.length > 0);
      if (sources.length > 0) {
        const src = pick(state.rng, 'house', sources);
        const target = pick(state.rng, 'house', src.cands);
        const ne: ActiveEffect = { uid: state.nextUid++, card: src.e.card, rooms: [target], round: state.round };
        state.effects.push(ne);
        spread.push(ne);
      }
    }
  }
  let houseWins = false;
  if (state.winner === null && state.round >= state.roundCap) {
    state.winner = -1;
    state.phase = 'over';
    houseWins = true;
    log(state, 'the house wins');
  } else if (state.winner === null) {
    state.phase = 'regroup';
  }
  return { ranks, payouts, contained, newEffect, spread, houseWins };
}

/** Put a hazard straight into the house as a lingering effect (debug/tests). */
export function addLingeringEffect(state: GameState, card: HazardId): ActiveEffect {
  const e = lingerEffect(state, card, targetRooms(state, card));
  state.effects.push(e);
  return e;
}

/** Coins changed during the real-time regroup walk (e.g. monkeys). */
export function applyCoinDelta(state: GameState, delta: number[]): void {
  state.players.forEach((p, i) => (p.coins = Math.max(0, p.coins + (delta[i] ?? 0))));
}
