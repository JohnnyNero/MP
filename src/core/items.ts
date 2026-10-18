// Items: the shop, and using items before the roll.
import { MAX_ITEMS } from '../content/board';
import { SHOP, SHOP_BY_ID } from '../content/cards';
import { distToFinish } from './board';
import type { Answer, ShopOption, TurnStep } from './events';
import type { GameState, ItemId, PlayerState } from './types';

const PRE_ROLL_ITEMS: ItemId[] = ['doubleDie', 'pushBack', 'warpSwap', 'respin'];

/** The rival closest to the finish (ties: lowest id). */
export function leadingRival(state: GameState, pid: number): PlayerState {
  return state.players
    .filter((o) => o.id !== pid)
    .reduce((best, o) => (distToFinish(o.space) < distToFinish(best.space) ? o : best));
}

export function shopOptions(p: PlayerState): ShopOption[] {
  if (p.items.length >= MAX_ITEMS) return [];
  return SHOP.filter((e) => e.price <= p.coins).map((e) => ({ id: e.id, price: e.price }));
}

function moveBack(p: PlayerState, n: number): string {
  for (let i = 0; i < n && p.trail.length > 0; i++) p.space = p.trail.pop()!;
  return p.space;
}

/** Use items until the player chooses to roll. Returns the number of dice to roll. */
export function* preRollItems(state: GameState, pid: number): Generator<TurnStep, number, Answer> {
  const p = state.players[pid];
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
  return dice;
}

/** A shop visit (passing or landing). */
export function* visitShop(p: PlayerState): Generator<TurnStep, void, Answer> {
  const options = shopOptions(p);
  if (options.length === 0) return;
  const ans = yield { kind: 'decide', dec: { d: 'shop', options } };
  const opt = options.find((o) => o.id === ans);
  if (!opt) return;
  p.coins -= opt.price;
  p.items.push(opt.id);
  yield { kind: 'event', ev: { t: 'coins', delta: -opt.price, reason: SHOP_BY_ID[opt.id].name } };
  yield { kind: 'event', ev: { t: 'bought', id: opt.id } };
}
