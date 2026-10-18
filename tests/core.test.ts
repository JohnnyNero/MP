import { describe, expect, it } from 'vitest';
import { BOARD, GATE_COST, ROUND_CAP } from '../src/content/board';
import { distToFinish } from '../src/core/board';
import { addLingeringEffect, computePayouts, newGame, planHouseTurn, settle, startRound } from '../src/core/game';
import { deriveHouse, reachable } from '../src/core/house';
import { runTurnSync, simulateGame } from '../src/core/sim';
import type { MinigamePlan } from '../src/core/types';

const four = [
  { name: 'A', isBot: false },
  { name: 'B', isBot: false },
  { name: 'C', isBot: false },
  { name: 'D', isBot: false },
];

describe('board', () => {
  it('every space can reach the finish', () => {
    for (const id of Object.keys(BOARD.spaces)) expect(distToFinish(id) >= 0 || id === BOARD.finish).toBe(true);
    for (const id of Object.keys(BOARD.spaces)) {
      if (id !== BOARD.finish) expect(distToFinish(id)).toBeGreaterThan(0);
    }
  });
  it('every fork has a free branch', () => {
    for (const sp of Object.values(BOARD.spaces)) {
      if (sp.next.length < 2) continue;
      expect(sp.next.some((n) => !['toll', 'gate'].includes(BOARD.spaces[n].type))).toBe(true);
    }
  });
  it('has two forks', () => {
    expect(Object.values(BOARD.spaces).filter((s) => s.next.length > 1)).toHaveLength(2);
  });
});

describe('turns', () => {
  it('moves the rolled number of steps on a straight path', () => {
    const s = newGame(1, four);
    startRound(s, [0, 1, 2, 3]);
    let total = 0;
    runTurnSync(s, 0, () => 0, (e) => {
      if (e.ev.t === 'roll') total = e.ev.total;
    });
    expect(distToFinish(BOARD.start) - distToFinish(s.players[0].space)).toBe(total);
  });

  it('charges for opening the shortcut gate and opens it for everyone', () => {
    const s = newGame(2, four);
    const fork = Object.values(BOARD.spaces).find((sp) => sp.next.some((n) => BOARD.spaces[n].type === 'gate'))!;
    s.players[0].space = fork.id;
    s.players[0].coins = 50;
    startRound(s, [0, 1, 2, 3]);
    runTurnSync(s, 0, (d) => {
      if (d.dec.d === 'junction') return d.dec.options.findIndex((o) => o.cost === GATE_COST);
      return null;
    });
    expect(s.openGates).toHaveLength(1);
    expect(s.players[0].coins).toBeLessThanOrEqual(50 - GATE_COST + 3);
  });

  it('a player passing the finish wins immediately', () => {
    const s = newGame(3, four);
    const pre = Object.values(BOARD.spaces).find((sp) => sp.next.includes(BOARD.finish))!;
    s.players[1].space = pre.id;
    startRound(s, [1, 0, 2, 3]);
    runTurnSync(s, 1, () => 'roll');
    expect(s.winner).toBe(1);
  });
});

describe('house', () => {
  it('derives tags and blocked connections from effects only', () => {
    const s = newGame(4, four);
    s.effects.push({ uid: 1, card: 'vines', rooms: ['living'], round: 1, blockedConnection: 'd-kitchen-living' });
    const h = deriveHouse(s);
    expect(h.tags.living).toContain('overgrown');
    expect(h.blocked.has('d-kitchen-living')).toBe(true);
    expect(h.boardWrapped).toBe(true);
    s.effects = [];
    expect(deriveHouse(s).blocked.size).toBe(0);
  });
  it('base house is fully connected', () => {
    expect(reachable('living', deriveHouse({ effects: [] })).size).toBe(9);
  });
  it('meteor holes add a connection', () => {
    const h = deriveHouse({ effects: [{ uid: 1, card: 'meteor', rooms: ['study'], round: 1, hole: { from: 'study', to: 'bathroom' } }] });
    expect(h.connections.some((c) => c.kind === 'hole')).toBe(true);
  });
});

describe('lingering effects', () => {
  it('every hazard can linger and the house stays derivable', () => {
    const s = newGame(9, four);
    for (const id of ['flood', 'meteor', 'vines', 'stampede', 'blackout', 'gravity', 'fire', 'monkeys'] as const) {
      addLingeringEffect(s, id);
      addLingeringEffect(s, id);
    }
    const h = deriveHouse(s);
    expect(Object.values(h.tags).flat().length).toBeGreaterThan(5);
    const holes = s.effects.filter((e) => e.hole).map((e) => e.hole!.from);
    expect(new Set(holes).size).toBe(holes.length);
  });
});

describe('house turn and settle', () => {
  it('uncontained hazards linger, contained ones vanish', () => {
    const s = newGame(5, four);
    startRound(s, [0, 1, 2, 3]);
    s.pool = [{ card: 'blackout', drawnBy: 0 }];
    const plan = planHouseTurn(s);
    expect(plan.card).toBe('blackout');
    settle(s, plan, { scores: [1, 2, 3, 4], groupScore: 0.9 });
    expect(s.effects).toHaveLength(0);
    startRound(s, [0, 1, 2, 3]);
    s.pool = [{ card: 'blackout', drawnBy: 0 }];
    const plan2 = planHouseTurn(s);
    settle(s, plan2, { scores: [1, 2, 3, 4], groupScore: 0.1 });
    expect(s.effects).toHaveLength(1);
    expect(deriveHouse(s).tags[plan2.rooms[0]]).toContain('dark');
  });
  it('2-3 players are always free-for-all', () => {
    const s = newGame(6, four.slice(0, 3));
    startRound(s, [0, 1, 2]);
    expect(planHouseTurn(s).format).toBe('ffa');
  });
  it('payouts', () => {
    const base: MinigamePlan = { card: null, rooms: [], goal: 'collect', format: 'ffa', teams: [0, 0, 0, 0], soloTeam: -1, rouletteOptions: [], rouletteIndex: -1 };
    expect(computePayouts(base, [5, 9, 1, 9]).payouts).toEqual([3, 10, 1, 10]);
    const v13 = { ...base, format: '1v3' as const, teams: [1, 0, 0, 0], soloTeam: 1 };
    expect(computePayouts(v13, [10, 3, 3, 3]).payouts).toEqual([15, 2, 2, 2]);
  });
  it('house wins at the round cap', () => {
    const s = newGame(7, four);
    s.round = ROUND_CAP - 1;
    startRound(s, [0, 1, 2, 3]);
    const rep = settle(s, planHouseTurn(s), { scores: [0, 0, 0, 0], groupScore: 1 });
    expect(rep.houseWins).toBe(true);
    expect(s.winner).toBe(-1);
  });
});

describe('simulation', () => {
  it('is deterministic for a seed', () => {
    const a = simulateGame(42);
    const b = simulateGame(42);
    expect(a.round).toBe(b.round);
    expect(a.winner).toBe(b.winner);
    expect(a.log).toEqual(b.log);
  });
  it('games end in a sensible number of rounds', () => {
    const rounds: number[] = [];
    let houseWins = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = simulateGame(seed, 2 + (seed % 3));
      rounds.push(s.round);
      if (s.winner === -1) houseWins++;
    }
    const avg = rounds.reduce((a, b) => a + b, 0) / rounds.length;
    console.log(`avg rounds ${avg.toFixed(2)}, min ${Math.min(...rounds)}, max ${Math.max(...rounds)}, house wins ${houseWins}/300`);
    expect(avg).toBeGreaterThan(8);
    expect(avg).toBeLessThan(13);
    expect(Math.max(...rounds)).toBeLessThanOrEqual(ROUND_CAP);
  });
});
