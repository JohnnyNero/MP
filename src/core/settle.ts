// Settle a minigame: payouts, placement rewards, containment, lingering and spread.
import { FFA_STEPS, SOLO_WIN_STEPS, TEAM_2V2_STEPS, TRIO_WIN_STEPS } from '../content/board';
import { CARDS } from '../content/cards';
import { deriveHouse, holeSpots, neighbours, roomById } from './house';
import { EDGE_MARGIN } from './houseGen';
import { targetRooms } from './houseTurn';
import { pick, rand } from './rng';
import { log } from './setup';
import type { ActiveEffect, GameState, HazardId, MinigamePlan, MinigameResult, SettleReport } from './types';

// Minigames now also pay board steps (the bigger prize), so coin payouts are
// smaller than they were before placement rewards existed.
const FFA_PAYOUT: Record<number, number[]> = {
  2: [6, 2],
  3: [6, 3, 1],
  4: [6, 4, 2, 1],
};

export function rankScores(scores: number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

/**
 * Coins and bonus board steps by placement. Tied players share the better
 * rank, so they share the higher reward.
 */
export function computePayouts(
  plan: MinigamePlan,
  scores: number[],
): { ranks: number[]; payouts: number[]; steps: number[] } {
  const n = scores.length;
  if (plan.format === 'ffa') {
    const ranks = rankScores(scores);
    return {
      ranks,
      payouts: ranks.map((r) => FFA_PAYOUT[n][r - 1]),
      steps: ranks.map((r) => FFA_STEPS[r - 1] ?? 0),
    };
  }
  const teamAvg = [0, 1].map((t) => {
    const members = scores.filter((_, i) => plan.teams[i] === t);
    return members.length ? members.reduce((a, b) => a + b, 0) / members.length : 0;
  });
  const winner = teamAvg[0] === teamAvg[1] ? -1 : teamAvg[0] > teamAvg[1] ? 0 : 1;
  const ranks = plan.teams.map((t) => (winner === -1 ? 1 : t === winner ? 1 : 2));
  const payouts = plan.teams.map((t) => {
    if (winner === -1) return 3;
    if (plan.format === '2v2') return t === winner ? 6 : 2;
    const solo = t === plan.soloTeam;
    if (t === winner) return solo ? 9 : 4;
    return solo ? 0 : 2;
  });
  // A drawn team game moves nobody.
  const steps = plan.teams.map((t) => {
    if (t !== winner) return 0;
    if (plan.format === '2v2') return TEAM_2V2_STEPS;
    return t === plan.soloTeam ? SOLO_WIN_STEPS : TRIO_WIN_STEPS;
  });
  return { ranks, payouts, steps };
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
    const free = rooms.filter((r) => !holed.has(r) && holeSpots(state.house, r).length > 0);
    if (free.length) {
      const room = pick(state.rng, 'house', free);
      // Prefer a column whose boundary has no vertical connector yet.
      const spots = holeSpots(state.house, room);
      const busy = (sp: { colX: number; to: string }) =>
        house.connections.some((c) => c.colX === sp.colX && c.a === sp.to && c.b === room);
      const clear = spots.filter((sp) => !busy(sp));
      const spot = pick(state.rng, 'house', clear.length ? clear : spots);
      const frac = EDGE_MARGIN + rand(state.rng, 'house') * (1 - 2 * EDGE_MARGIN);
      e.hole = { from: room, to: spot.to, colX: spot.colX, frac };
    }
  }
  if (def.movesBoard && rooms.includes(house.boardRoom)) {
    const opts = neighbours(house.boardRoom, house.connections, house.blocked).filter((x) => {
      const rr = roomById(state.house, x)!;
      const br = roomById(state.house, house.boardRoom)!;
      return rr.floor === br.floor;
    });
    if (opts.length) e.boardTo = pick(state.rng, 'house', opts);
  }
  return e;
}

export function settle(state: GameState, plan: MinigamePlan, result: MinigameResult): SettleReport {
  const { ranks, payouts, steps } = computePayouts(plan, result.scores);
  state.players.forEach((p, i) => {
    p.coins = Math.max(0, p.coins + payouts[i] + (result.coinDelta?.[i] ?? 0));
    p.pendingSteps += steps[i];
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
  return { ranks, payouts, steps, contained, newEffect, spread, houseWins };
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
