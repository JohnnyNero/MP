import { distToFinish } from './board';
import { deriveHouse } from './house';
import { rand } from './rng';
import type { Answer, Decision } from './events';
import { leadingRival } from './items';
import type { GameState, ItemId } from './types';

/** Chance (0..1) that a bot skips a sensible action, by difficulty 0..3. */
const MISTAKE = [0.45, 0.25, 0.1, 0];

function mistake(state: GameState, pid: number): boolean {
  return rand(state.rng, 'bot') < (MISTAKE[state.players[pid].difficulty] ?? 0.25);
}

/** Board-phase bot. Answers any Decision the turn generator yields. */
export function botDecide(state: GameState, pid: number, dec: Decision): Answer {
  const me = state.players[pid];
  const myDist = distToFinish(me.space);
  switch (dec.d) {
    case 'preRoll': {
      const has = (it: ItemId) => dec.options.includes(it);
      const lead = leadingRival(state, pid);
      if (has('warpSwap') && distToFinish(lead.space) + 8 < myDist && !mistake(state, pid)) return 'warpSwap';
      if (has('pushBack') && (distToFinish(lead.space) < myDist || distToFinish(lead.space) < 10) && !mistake(state, pid))
        return 'pushBack';
      if (has('doubleDie') && myDist > 6 && !mistake(state, pid)) return 'doubleDie';
      // Veto only makes sense once there is a card in the pool to throw out.
      if (has('respin') && state.pool.length > 0 && !mistake(state, pid)) return 'respin';
      return 'roll';
    }
    case 'reroll':
      return dec.total <= 2 && !mistake(state, pid);
    case 'junction': {
      let best = 0;
      let bestScore = Infinity;
      dec.options.forEach((o, i) => {
        const coinsAfter = me.coins - o.cost;
        // Shorter remaining distance is better; spending coins is a mild cost
        // unless we are near the end.
        const spendPenalty = myDist < 12 ? 0 : o.cost * 0.4 + (coinsAfter < 5 ? 4 : 0);
        const score = distToFinish(o.to) + spendPenalty;
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (mistake(state, pid) && dec.options.length > 1) return Math.floor(rand(state.rng, 'bot') * dec.options.length);
      return best;
    }
    case 'shop': {
      const reserve = 5;
      const prefs: string[] =
        myDist < 12 ? ['doubleDie', 'pushBack', 'reroll'] : ['doubleDie', 'warpSwap', 'reroll', 'pushBack', 'respin'];
      for (const id of prefs) {
        const o = dec.options.find((x) => x.id === id);
        if (o && me.coins - o.price >= reserve && !mistake(state, pid)) return o.id;
      }
      return null;
    }
    case 'repair': {
      // Repairing pays the repairer (+2 spaces), so it is a tempo buy as well
      // as a public good. Want it when an effect touches the board room, when
      // the house is under pressure for the rounds left, or simply when the
      // tempo is cheap enough and we can afford it.
      const house = deriveHouse(state);
      const roundsLeft = Math.max(1, state.roundCap - state.round);
      const touchesBoard = dec.options.filter((o) => o.rooms.includes(house.boardRoom));
      const cheapest = dec.options.reduce((a, b) => (b.price < a.price ? b : a));
      const choice = touchesBoard.length
        ? touchesBoard.reduce((a, b) => (b.price < a.price ? b : a))
        : cheapest;
      const pressure = state.effects.length * 2 >= roundsLeft || state.effects.length >= 3;
      const tempo = choice.price <= 10 && myDist > 4;
      const want = touchesBoard.length > 0 || pressure || tempo;
      if (!want || me.coins - choice.price < 3 || mistake(state, pid)) return null;
      return choice.uid;
    }
    case 'target': {
      return dec.options.reduce((best, id) =>
        distToFinish(state.players[id].space) < distToFinish(state.players[best].space) ? id : best,
      );
    }
  }
}

