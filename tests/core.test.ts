import { describe, expect, it } from 'vitest';
import {
  BOARD,
  FIRST_ARRIVAL_BONUS,
  GATE_COST,
  REPAIR_BONUS_STEPS,
  REPAIR_COST,
  REPAIR_MAX_COST,
  ROUND_CAP,
  STARTING_COINS,
  TOLL_COST,
} from '../src/content/board';
import { distToFinish } from '../src/core/board';
import {
  addLingeringEffect,
  computePayouts,
  newGame,
  planHouseTurn,
  repairOptions,
  settle,
  startRound,
  type TurnEvent,
} from '../src/core/game';
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
    expect(avg).toBeGreaterThan(11.5);
    expect(avg).toBeLessThan(13.5);
    expect(Math.max(...rounds)).toBeLessThanOrEqual(ROUND_CAP);
    expect(houseWins).toBeLessThan(15); // the house should win rarely (< 5%)
  });
});

const spaceOf = (type: string) => Object.values(BOARD.spaces).find((sp) => sp.type === type)!;
/** A space whose single next space has the given type. */
const before = (type: string) =>
  Object.values(BOARD.spaces).find((sp) => sp.next.length === 1 && BOARD.spaces[sp.next[0]].type === type)!;

function collect(s: ReturnType<typeof newGame>, pid: number, decide: Parameters<typeof runTurnSync>[2]) {
  const evs: TurnEvent[] = [];
  const decs: string[] = [];
  runTurnSync(s, pid, (d) => {
    decs.push(d.dec.d);
    return decide(d);
  }, (e) => evs.push(e.ev));
  return { evs, decs };
}

describe('board balance', () => {
  it('about a quarter of the spaces are red', () => {
    const all = Object.values(BOARD.spaces);
    const ratio = all.filter((sp) => sp.type === 'red').length / all.length;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.3);
  });
  it('spaces stay inside the board panel and apart', () => {
    const all = Object.values(BOARD.spaces);
    for (const a of all) {
      expect(a.x).toBeGreaterThanOrEqual(20);
      expect(a.x).toBeLessThanOrEqual(460);
      expect(a.y).toBeGreaterThanOrEqual(40);
      expect(a.y).toBeLessThanOrEqual(230);
      for (const b of all) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(17);
    }
  });
  it('the toll costs 8', () => {
    expect(TOLL_COST).toBe(8);
    const s = newGame(11, four);
    const fork = Object.values(BOARD.spaces).find((sp) => sp.next.some((n) => BOARD.spaces[n].type === 'toll'))!;
    s.players[0].space = fork.id;
    s.players[0].coins = 20;
    startRound(s, [0, 1, 2, 3]);
    const { evs } = collect(s, 0, (d) => (d.dec.d === 'junction' ? d.dec.options.findIndex((o) => o.cost === TOLL_COST) : 'roll'));
    expect(evs).toContainEqual({ t: 'coins', delta: -TOLL_COST, reason: 'Toll' });
  });
});

describe('press to roll', () => {
  it('humans always get a preRoll decision, bots with no items do not', () => {
    const s = newGame(12, [{ name: 'H', isBot: false }, { name: 'B', isBot: true }]);
    startRound(s, [0, 1]);
    const h = collect(s, 0, (d) => {
      if (d.dec.d === 'preRoll') expect(d.dec.options).toEqual(['roll']);
      return 'roll';
    });
    expect(h.decs[0]).toBe('preRoll');
    const b = collect(s, 1, () => 'roll');
    expect(b.decs).not.toContain('preRoll');
  });
});

describe('repair', () => {
  it('price scales with the effect age and is capped', () => {
    const s = newGame(13, four);
    s.round = 1;
    addLingeringEffect(s, 'blackout');
    s.players[0].coins = 100;
    s.round = 2;
    expect(repairOptions(s, s.players[0])[0].price).toBe(REPAIR_COST);
    s.round = 4;
    expect(repairOptions(s, s.players[0])[0].price).toBe(REPAIR_COST + 4);
    s.round = 40;
    expect(repairOptions(s, s.players[0])[0].price).toBe(REPAIR_MAX_COST);
    s.players[0].coins = REPAIR_COST - 1;
    s.round = 2;
    expect(repairOptions(s, s.players[0])).toHaveLength(0);
  });
  it('repairing clears the effect and moves the repairer on 2 spaces', () => {
    const s = newGame(14, four);
    s.round = 1;
    addLingeringEffect(s, 'vines');
    const pre = before('repair');
    s.players[0].space = pre.id;
    s.players[0].coins = 30;
    startRound(s, [0, 1, 2, 3]);
    let rolled = 0;
    let moves = 0;
    const { evs } = collect(s, 0, (d) => (d.dec.d === 'repair' ? d.dec.options[0].uid : d.dec.d === 'junction' ? 0 : 'roll'));
    for (const e of evs) {
      if (e.t === 'roll') rolled = e.total;
      if (e.t === 'move') moves++;
    }
    expect(s.effects).toHaveLength(0);
    expect(evs).toContainEqual({ t: 'bonusSteps', steps: REPAIR_BONUS_STEPS, reason: 'Repair reward' });
    expect(moves).toBe(rolled + REPAIR_BONUS_STEPS);
    expect(s.players[0].coins).toBeLessThan(30);
  });
});

describe('fire spread', () => {
  it('spreads at most once per settle', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = newGame(seed, four);
      for (let i = 0; i < 4; i++) addLingeringEffect(s, 'fire');
      startRound(s, [0, 1, 2, 3]);
      const rep = settle(s, planHouseTurn(s), { scores: [0, 0, 0, 0], groupScore: 1 });
      expect(rep.spread.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('items', () => {
  it('re-spin vetoes the landed card and re-picks another', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = newGame(seed, four);
      startRound(s, [0, 1, 2, 3]);
      s.pool = [{ card: 'fire', drawnBy: 0 }, { card: 'flood', drawnBy: 1 }];
      s.respinArmed = true;
      const plan = planHouseTurn(s);
      expect(plan.vetoedIndex).toBeDefined();
      expect(plan.rouletteIndex).not.toBe(plan.vetoedIndex);
      expect(plan.card).toBe(plan.rouletteOptions[plan.rouletteIndex]);
      expect(plan.card).not.toBe(plan.rouletteOptions[plan.vetoedIndex!]);
    }
  });
  it('vetoing the only card cancels the hazard', () => {
    const s = newGame(15, four);
    startRound(s, [0, 1, 2, 3]);
    s.pool = [{ card: 'fire', drawnBy: 0 }];
    s.respinArmed = true;
    const plan = planHouseTurn(s);
    expect(plan.card).toBeNull();
    expect(plan.rouletteIndex).toBe(-1);
    expect(plan.vetoedIndex).toBe(0);
  });
  it('warp swap swaps with the leading rival', () => {
    const s = newGame(16, four);
    const lead = before('finish');
    s.players[0].items = ['warpSwap'];
    s.players[2].space = lead.id;
    s.players[1].space = BOARD.spaces[BOARD.start].next[0];
    startRound(s, [0, 1, 2, 3]);
    let swapped = -1;
    runTurnSync(s, 0, (d) => (d.dec.d === 'preRoll' && d.dec.options.includes('warpSwap') ? 'warpSwap' : d.dec.d === 'preRoll' ? 'roll' : 0), (e) => {
      if (e.ev.t === 'swapped') swapped = e.ev.b;
    });
    expect(swapped).toBe(2);
  });
});

describe('catch-up', () => {
  it('last place rolls d6+1; nobody gets it when all are level', () => {
    const s = newGame(17, four);
    startRound(s, [0, 1, 2, 3]);
    const level = collect(s, 0, () => 'roll').evs.find((e) => e.t === 'roll')!;
    expect(level.t === 'roll' && level.bonus).toBeFalsy();
    const t = newGame(18, four);
    const mid = spaceOf('shop').id;
    for (const p of t.players) p.space = mid;
    t.players[3].space = BOARD.start;
    startRound(t, [0, 1, 2, 3]);
    const last = collect(t, 3, () => 'roll').evs.find((e) => e.t === 'roll')!;
    expect(last.t === 'roll' && last.bonus).toBe(1);
    if (last.t === 'roll') expect(last.total).toBe(last.values[0] + 1);
  });
  it('the arrival bonus goes to the arrival furthest behind', () => {
    const s = newGame(19, four);
    s.round = 1;
    const mid = spaceOf('shop').id;
    for (const p of s.players) p.space = mid;
    s.players[2].space = BOARD.start;
    s.players[3].space = BOARD.start; // furthest behind but a straggler
    startRound(s, [0, 2, 1, 3], 3);
    expect(s.players[2].coins).toBe(STARTING_COINS + FIRST_ARRIVAL_BONUS);
    expect(s.players[0].coins).toBe(STARTING_COINS);
    expect(s.players[3].coins).toBe(STARTING_COINS);
  });
});
