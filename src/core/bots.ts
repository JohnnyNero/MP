import { distToFinish } from './board';
import { deriveHouse } from './house';
import { rand } from './rng';
import type { Answer, Decision } from './game';
import type { GameState, ItemId } from './types';

/** Chance (0..1) that a bot skips a sensible action, by difficulty 0..3. */
const MISTAKE = [0.45, 0.25, 0.1, 0];

function mistake(state: GameState, pid: number): boolean {
  return rand(state.rng, 'bot') < (MISTAKE[state.players[pid].difficulty] ?? 0.25);
}

function leader(state: GameState, pid: number) {
  return state.players
    .filter((o) => o.id !== pid)
    .reduce((best, o) => (distToFinish(o.space) < distToFinish(best.space) ? o : best));
}

/** Board-phase bot. Answers any Decision the turn generator yields. */
export function botDecide(state: GameState, pid: number, dec: Decision): Answer {
  const me = state.players[pid];
  const myDist = distToFinish(me.space);
  switch (dec.d) {
    case 'preRoll': {
      const has = (it: ItemId) => dec.options.includes(it);
      const lead = leader(state, pid);
      if (has('warpSwap') && distToFinish(lead.space) + 8 < myDist && !mistake(state, pid)) return 'warpSwap';
      if (has('pushBack') && (distToFinish(lead.space) < myDist || distToFinish(lead.space) < 10) && !mistake(state, pid))
        return 'pushBack';
      if (has('doubleDie') && myDist > 6 && !mistake(state, pid)) return 'doubleDie';
      if (has('respin') && rand(state.rng, 'bot') < 0.3) return 'respin';
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
        myDist < 12 ? ['doubleDie', 'pushBack', 'reroll', 'springBoots'] : ['doubleDie', 'warpSwap', 'reroll', 'pushBack', 'headStart', 'respin', 'springBoots'];
      for (const id of prefs) {
        const o = dec.options.find((x) => x.id === id);
        if (o && me.coins - o.price >= reserve && !mistake(state, pid)) return o.id;
      }
      return null;
    }
    case 'repair': {
      const house = deriveHouse(state);
      const nearCap = state.round >= state.roundCap - 4;
      const pressure = state.effects.length;
      const want = pressure >= 3 || (pressure >= 2 && me.difficulty >= 2) || (nearCap && pressure >= 1);
      if (!want || me.coins - dec.options[0].price < 3 || mistake(state, pid)) return null;
      // Prefer effects that touch the board's room (they slow every regroup).
      const touchesBoard = dec.options.find((o) => o.rooms.includes(house.boardRoom));
      return (touchesBoard ?? dec.options[0]).uid;
    }
    case 'target': {
      return dec.options.reduce((best, id) =>
        distToFinish(state.players[id].space) < distToFinish(state.players[best].space) ? id : best,
      );
    }
  }
}

