// Repair spaces: pay to clear a lingering effect and move on a few spaces.
import { REPAIR_AGE_COST, REPAIR_BONUS_STEPS, REPAIR_COST, REPAIR_MAX_COST } from '../content/board';
import type { Answer, RepairOption, TurnStep } from './events';
import { log } from './setup';
import type { ActiveEffect, GameState, PlayerState } from './types';

/** Repair price grows with how long the effect has lingered. */
export function repairPrice(state: GameState, e: ActiveEffect): number {
  const age = Math.max(0, state.round - e.round - 1);
  return Math.min(REPAIR_MAX_COST, REPAIR_COST + REPAIR_AGE_COST * age);
}

export function repairOptions(state: GameState, p: PlayerState): RepairOption[] {
  return state.effects
    .map((e) => ({ uid: e.uid, card: e.card, rooms: e.rooms, price: repairPrice(state, e) }))
    .filter((o) => o.price <= p.coins);
}

/** A repair-space visit (passing or landing). Returns the bonus steps earned. */
export function* visitRepair(state: GameState, p: PlayerState): Generator<TurnStep, number, Answer> {
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
