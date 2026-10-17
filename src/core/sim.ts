import { botDecide } from './bots';
import { newGame, planHouseTurn, settle, startRound, takeTurn, type Answer, type PlayerConfig, type TurnStep } from './game';
import { rand } from './rng';
import type { GameState, MinigamePlan, MinigameResult } from './types';

/** Drive one board turn to completion with a decision callback. */
export function runTurnSync(
  state: GameState,
  pid: number,
  decide: (step: Extract<TurnStep, { kind: 'decide' }>) => Answer,
  onEvent?: (step: Extract<TurnStep, { kind: 'event' }>) => void,
): void {
  const gen = takeTurn(state, pid);
  let answer: Answer = null;
  for (;;) {
    const r = gen.next(answer);
    if (r.done) return;
    if (r.value.kind === 'decide') answer = decide(r.value);
    else {
      answer = null;
      onEvent?.(r.value);
    }
  }
}

/** Fake minigame outcome for headless simulation. */
export function fakeMinigame(state: GameState, plan: MinigamePlan): MinigameResult {
  void plan;
  return {
    scores: state.players.map(() => Math.floor(rand(state.rng, 'bot') * 10)),
    groupScore: rand(state.rng, 'bot'),
  };
}

/** Play a whole game with bots in every seat. Returns the final state. */
export function simulateGame(seed: number, players = 4): GameState {
  const configs: PlayerConfig[] = Array.from({ length: players }, (_, i) => ({
    name: `Bot ${i + 1}`,
    isBot: true,
    difficulty: i % 4,
  }));
  const state = newGame(seed, configs);
  let arrival = state.players.map((p) => p.id);
  while (state.winner === null) {
    startRound(state, arrival);
    for (const pid of state.turnOrder) {
      runTurnSync(state, pid, (s) => botDecide(state, pid, s.dec));
      if (state.winner !== null) break;
    }
    if (state.winner !== null) break;
    const plan = planHouseTurn(state);
    settle(state, plan, fakeMinigame(state, plan));
    // Shuffle arrival order a bit for the next round.
    arrival = [...arrival].sort(() => rand(state.rng, 'bot') - 0.5);
  }
  return state;
}
