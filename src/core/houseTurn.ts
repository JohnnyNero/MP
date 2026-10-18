// The house turn: roulette over the drawn cards, target rooms, format and goal.
import { CARDS, GOALS } from '../content/cards';
import { HOUSE } from '../content/house';
import { roomsOnFloor } from './house';
import { pick, rand, randInt } from './rng';
import { log } from './setup';
import type { Format, GameState, GoalDef, GoalId, HazardId, MinigamePlan } from './types';

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

/** Goals that can be played in this format with this hazard (the curated pairs). */
export function validGoals(card: HazardId | null, format: Format): GoalDef[] {
  return GOALS.filter(
    (g) => g.formats.includes(format) && !(card && CARDS[card].incompatibleGoals?.includes(g.id)),
  );
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
  const goal: GoalId = pick(state.rng, 'house', validGoals(card, format)).id;
  state.pool = [];
  state.respinArmed = false;
  state.phase = 'minigame';
  log(state, `minigame ${goal} (${format}) hazard ${card ?? 'none'}`);
  return {
    card, rooms, goal, format, teams, soloTeam, rouletteOptions, rouletteIndex,
    ...(vetoedIndex !== undefined ? { vetoedIndex } : {}),
  };
}
