import { botDecide } from './bots';
import { newGame, planHouseTurn, settle, startRound, takeTurn, type Answer, type PlayerConfig, type TurnStep } from './game';
import { rand } from './rng';
import type { GameState, MinigamePlan, MinigameResult, SettleReport } from './types';

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

/** Uniform noise in [-1, 1) with a triangular shape (sum of two draws). */
function noise(state: GameState): number {
  return rand(state.rng, 'bot') + rand(state.rng, 'bot') - 1;
}

/** Skill 0..1 from a bot difficulty 0..3. */
const skill = (difficulty: number) => Math.max(0, Math.min(3, difficulty)) / 3;

/**
 * Modelled minigame outcome for headless simulation: each player's score is
 * their skill plus noise (so better bots usually place higher), and the group
 * score is the table's mean skill plus noise (so a stronger table contains
 * more hazards). An average table (mean difficulty 1.5) sits right at the
 * 0.65 containment bar.
 */
export function fakeMinigame(state: GameState, plan: MinigamePlan): MinigameResult {
  void plan;
  const skills = state.players.map((p) => skill(p.difficulty));
  const mean = skills.reduce((a, b) => a + b, 0) / skills.length;
  return {
    scores: skills.map((s) => Math.round((10 * s + 6 * noise(state)) * 10) / 10),
    groupScore: Math.max(0, Math.min(1, 0.5 + 0.3 * mean + 0.2 * noise(state))),
  };
}

export interface SimHooks {
  onSettle?: (state: GameState, plan: MinigamePlan, report: SettleReport) => void;
}

/** Play a whole game with bots in every seat. Returns the final state. */
export function simulateGame(seed: number, players = 4, hooks: SimHooks = {}): GameState {
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
    const report = settle(state, plan, fakeMinigame(state, plan));
    hooks.onSettle?.(state, plan, report);
    // Shuffle arrival order a bit for the next round.
    arrival = [...arrival].sort(() => rand(state.rng, 'bot') - 0.5);
  }
  return state;
}
