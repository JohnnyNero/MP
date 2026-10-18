// New game, the deck, the log and the start of each round (regroup result).
import { BOARD, FIRST_ARRIVAL_BONUS, ROUND_CAP, STARTING_COINS } from '../content/board';
import { DECK_COUNTS } from '../content/cards';
import { distToFinish } from './board';
import { initRng, shuffle } from './rng';
import type { GameState, HazardId, PlayerState } from './types';

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
    pendingSteps: 0,
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

export function refillDeck(state: GameState) {
  const deck: HazardId[] = [];
  for (const [id, n] of Object.entries(DECK_COUNTS) as [HazardId, number][]) {
    for (let i = 0; i < n; i++) deck.push(id);
  }
  state.deck = shuffle(state.rng, 'cards', deck);
}

export function log(state: GameState, msg: string) {
  state.log.push(`R${state.round}: ${msg}`);
  if (state.log.length > 200) state.log.shift();
}

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
