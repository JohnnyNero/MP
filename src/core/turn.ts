// One player's board turn: minigame reward steps, items, roll, move, land.
import { BLUE_COINS, BOARD, GATE_COST, LAST_PLACE_ROLL_BONUS, RED_COINS, TOLL_COST } from '../content/board';
import { distToFinish } from './board';
import type { Answer, JunctionOption, TurnStep } from './events';
import { preRollItems, visitShop } from './items';
import { visitRepair } from './repair';
import { randInt } from './rng';
import { log, refillDeck } from './setup';
import type { GameState, PlayerState } from './types';

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

/**
 * One player's board turn as a generator. Yields events (for animation) and
 * decisions (answered by the UI or a bot via `next(answer)`).
 */
export function* takeTurn(state: GameState, pid: number): Generator<TurnStep, void, Answer> {
  const p = state.players[pid];
  if (state.winner !== null) return;

  // --- minigame reward: walk the bonus spaces first (passing, never landing).
  if (p.pendingSteps > 0) {
    const n = p.pendingSteps;
    p.pendingSteps = 0;
    yield { kind: 'event', ev: { t: 'bonusSteps', steps: n, reason: 'Minigame reward' } };
    if (yield* walk(state, p, pid, n)) return;
  }

  // --- pre-roll: use items until the player chooses to roll.
  const dice = yield* preRollItems(state, pid);

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

  // --- move and land (a repair reward can send us on a few more steps)
  let steps = total;
  for (;;) {
    if (yield* walk(state, p, pid, steps)) return;
    const extra = yield* land(state, p, pid);
    if (extra <= 0) return;
    steps = extra;
  }
}

/**
 * Move `steps` spaces: junction choices, gates, tolls, and the services of
 * spaces passed on the way (not the last one). Returns true if the player won.
 */
function* walk(state: GameState, p: PlayerState, pid: number, steps: number): Generator<TurnStep, boolean, Answer> {
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
      const idx = opts.length === 1 ? 0 : ((yield { kind: 'decide', dec: { d: 'junction', options: opts } }) as number);
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
      return true;
    }
    if (steps > 0) steps += yield* service(state, p, sp.type);
  }
  return false;
}

/** Shop and repair spaces work whether you pass or land. Returns bonus steps. */
function* service(state: GameState, p: PlayerState, type: string): Generator<TurnStep, number, Answer> {
  if (type === 'shop') yield* visitShop(p);
  else if (type === 'repair') return yield* visitRepair(state, p);
  return 0;
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
      return yield* service(state, p, sp.type);
    default:
      break;
  }
  return 0;
}
