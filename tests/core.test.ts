import { describe, expect, it } from 'vitest';
import {
  BOARD,
  FFA_STEPS,
  FIRST_ARRIVAL_BONUS,
  GATE_COST,
  REPAIR_BONUS_STEPS,
  REPAIR_COST,
  REPAIR_MAX_COST,
  ROUND_CAP,
  SOLO_WIN_STEPS,
  STARTING_COINS,
  TEAM_2V2_STEPS,
  TOLL_COST,
  TRIO_WIN_STEPS,
} from '../src/content/board';
import { CARDS, GOALS, SHOP } from '../src/content/cards';
import { distToFinish } from '../src/core/board';
import {
  addLingeringEffect,
  computePayouts,
  newGame,
  planHouseTurn,
  repairOptions,
  settle,
  shopOptions,
  startRound,
  validGoals,
  type TurnEvent,
} from '../src/core/game';
import { HOUSE } from '../src/content/house';
import { deriveHouse, highestRooms, lowestRooms, neighbours, reachable } from '../src/core/house';
import { fakeMinigame, runTurnSync, simulateGame } from '../src/core/sim';
import type { Format, HazardId, MinigamePlan } from '../src/core/types';

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
    s.house = HOUSE;
    s.effects.push({ uid: 1, card: 'vines', rooms: ['living'], round: 1, blockedConnection: 'd-kitchen-living' });
    const h = deriveHouse(s);
    expect(h.tags.living).toContain('overgrown');
    expect(h.blocked.has('d-kitchen-living')).toBe(true);
    expect(h.boardWrapped).toBe(true);
    s.effects = [];
    expect(deriveHouse(s).blocked.size).toBe(0);
  });
  it('base house is fully connected', () => {
    expect(reachable('living', deriveHouse({ effects: [], house: HOUSE })).size).toBe(HOUSE.rooms.length);
  });
  it('meteor holes add a connection', () => {
    const h = deriveHouse({
      house: HOUSE,
      effects: [{ uid: 1, card: 'meteor', rooms: ['study'], round: 1, hole: { from: 'study', to: 'bathroom', colX: 3, frac: 0.3 } }],
    });
    const hole = h.connections.find((c) => c.kind === 'hole')!;
    expect(hole).toMatchObject({ a: 'bathroom', b: 'study', colX: 3, frac: 0.3 });
    expect(h.def).toBe(HOUSE);
  });
  it('one-way connections only go one way', () => {
    const conns = HOUSE.connections.filter((c) => c.id === 'c-bedroom-kitchen');
    expect(neighbours('bedroom', conns)).toEqual(['kitchen']);
    expect(neighbours('kitchen', conns)).toEqual([]);
    const tramp = [{ id: 't', kind: 'tramp' as const, a: 'kitchen', b: 'bedroom', colX: 0, frac: 0.5 }];
    expect(neighbours('kitchen', tramp)).toEqual(['bedroom']);
    expect(neighbours('bedroom', tramp)).toEqual([]);
  });
  it('flood hits the lowest level, meteors the rooms under the roof', () => {
    expect(lowestRooms(HOUSE).sort()).toEqual(['boiler', 'cellar']);
    expect(highestRooms(HOUSE).sort()).toEqual(['attic', 'bedroom', 'nursery', 'study']);
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
    for (const e of s.effects.filter((x) => x.hole)) {
      const from = s.house.rooms.find((r) => r.id === e.hole!.from)!;
      const to = s.house.rooms.find((r) => r.id === e.hole!.to)!;
      expect(to.gy).toBe(from.gy + from.gh);
      expect(e.hole!.colX).toBeGreaterThanOrEqual(Math.max(from.gx, to.gx));
      expect(e.hole!.colX).toBeLessThan(Math.min(from.gx + from.gw, to.gx + to.gw));
    }
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
    expect(computePayouts(base, [5, 9, 1, 9]).payouts).toEqual([2, 6, 1, 6]);
    const v13 = { ...base, format: '1v3' as const, teams: [1, 0, 0, 0], soloTeam: 1 };
    expect(computePayouts(v13, [10, 3, 3, 3]).payouts).toEqual([9, 2, 2, 2]);
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
    expect(avg).toBeGreaterThan(11);
    expect(avg).toBeLessThan(13);
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

const plan0: MinigamePlan = { card: null, rooms: [], goal: 'collect', format: 'ffa', teams: [0, 0, 0, 0], soloTeam: -1, rouletteOptions: [], rouletteIndex: -1 };

describe('minigame placement grants movement', () => {
  it('FFA: 1st and 2nd get steps, ties share the higher reward', () => {
    const at = (r: number) => FFA_STEPS[r - 1] ?? 0;
    expect(computePayouts(plan0, [5, 9, 1, 3]).steps).toEqual([at(2), at(1), at(4), at(3)]);
    expect(computePayouts(plan0, [5, 9, 1, 9]).steps).toEqual([at(3), at(1), at(4), at(1)]);
    expect(computePayouts(plan0, [4, 4, 4, 4]).steps).toEqual([at(1), at(1), at(1), at(1)]);
  });
  it('2v2 winners and 1v3 solo/trio winners get their steps', () => {
    const v22 = { ...plan0, format: '2v2' as const, teams: [0, 1, 0, 1] };
    expect(computePayouts(v22, [5, 1, 5, 1]).steps).toEqual([TEAM_2V2_STEPS, 0, TEAM_2V2_STEPS, 0]);
    const v13 = { ...plan0, format: '1v3' as const, teams: [1, 0, 0, 0], soloTeam: 1 };
    expect(computePayouts(v13, [10, 3, 3, 3]).steps).toEqual([SOLO_WIN_STEPS, 0, 0, 0]);
    expect(computePayouts(v13, [1, 3, 3, 3]).steps).toEqual([0, TRIO_WIN_STEPS, TRIO_WIN_STEPS, TRIO_WIN_STEPS]);
  });
  it('settle stores the steps as pending, as plain JSON', () => {
    const s = newGame(21, four);
    startRound(s, [0, 1, 2, 3]);
    const rep = settle(s, planHouseTurn(s), { scores: [1, 9, 5, 3], groupScore: 1 });
    expect(s.players.map((p) => p.pendingSteps)).toEqual(rep.steps);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
  it('pending steps are walked before the roll, passing but not landing', () => {
    const s = newGame(22, four);
    // Start two spaces before a blue space so the bonus walk ends on it.
    const prev2 = Object.values(BOARD.spaces).find((a) => {
      const b = BOARD.spaces[a.next[0]];
      return a.next.length === 1 && b.type === 'blue' && b.next.length === 1 && BOARD.spaces[b.next[0]].type === 'blue';
    })!;
    const prev = BOARD.spaces[prev2.next[0]];
    const blue = BOARD.spaces[prev.next[0]];
    s.players[0].space = prev2.id;
    s.players[0].pendingSteps = 2;
    startRound(s, [0, 1, 2, 3]);
    const { evs } = collect(s, 0, (d) => (d.dec.d === 'junction' ? 0 : d.dec.d === 'preRoll' ? 'roll' : null));
    expect(evs[0]).toEqual({ t: 'bonusSteps', steps: 2, reason: 'Minigame reward' });
    expect(evs[1]).toMatchObject({ t: 'move', from: prev2.id, to: prev.id });
    expect(evs[2]).toMatchObject({ t: 'move', from: prev.id, to: blue.id, stepsLeft: 0 });
    expect(evs[3].t).toBe('roll'); // no Blue space coins: the bonus walk doesn't land
    expect(s.players[0].pendingSteps).toBe(0);
  });
  it('the bonus walk offers the shop when passing it', () => {
    const s = newGame(23, four);
    const pre = before('shop');
    s.players[0].space = pre.id;
    s.players[0].coins = 30;
    s.players[0].pendingSteps = 2;
    startRound(s, [0, 1, 2, 3]);
    const { decs } = collect(s, 0, (d) => (d.dec.d === 'preRoll' ? 'roll' : d.dec.d === 'junction' ? 0 : null));
    expect(decs[0]).toBe('shop');
  });
});

describe('perks are gone', () => {
  it('the shop sells only board items', () => {
    expect(SHOP.map((e) => e.id).sort()).toEqual(['doubleDie', 'pushBack', 'reroll', 'respin', 'warpSwap']);
    const s = newGame(24, four);
    s.players[0].coins = 100;
    expect(shopOptions(s.players[0]).every((o) => SHOP.some((e) => e.id === o.id))).toBe(true);
    expect('perks' in s.players[0]).toBe(false);
  });
});

describe('hazard x goal pairs', () => {
  const formats: Format[] = ['ffa', '1v3', '2v2'];
  it('every hazard has at least 3 valid goals in every format', () => {
    for (const id of Object.keys(CARDS) as HazardId[]) {
      for (const f of formats) expect(validGoals(id, f).length, `${id} ${f}`).toBeGreaterThanOrEqual(3);
    }
    for (const f of formats) expect(validGoals(null, f).length).toBe(GOALS.filter((g) => g.formats.includes(f)).length);
  });
  it('the house never picks an incompatible goal', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const s = newGame(seed, four);
      startRound(s, [0, 1, 2, 3]);
      s.pool = [{ card: 'blackout', drawnBy: 0 }];
      expect(planHouseTurn(s).goal).not.toBe('race');
    }
  });
});

describe('balance sim', () => {
  it('scores follow difficulty and the group score follows the table', () => {
    const s = newGame(25, four.map((p, i) => ({ ...p, isBot: true, difficulty: i })));
    const sum = [0, 0, 0, 0];
    let group = 0;
    for (let k = 0; k < 400; k++) {
      const r = fakeMinigame(s, plan0);
      r.scores.forEach((v, i) => (sum[i] += v));
      group += r.groupScore;
      expect(r.groupScore).toBeGreaterThanOrEqual(0);
      expect(r.groupScore).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < 4; i++) expect(sum[i]).toBeGreaterThan(sum[i - 1]);
    // An average table (mean difficulty 1.5) sits near the containment bar.
    expect(group / 400).toBeGreaterThan(0.6);
    expect(group / 400).toBeLessThan(0.7);
    const experts = newGame(26, four.map((p) => ({ ...p, isBot: true, difficulty: 3 })));
    const novices = newGame(26, four.map((p) => ({ ...p, isBot: true, difficulty: 0 })));
    let e = 0;
    let n = 0;
    for (let k = 0; k < 200; k++) {
      e += fakeMinigame(experts, plan0).groupScore;
      n += fakeMinigame(novices, plan0).groupScore;
    }
    expect(e).toBeGreaterThan(n);
  });
  it('containment rate and skill both matter in whole games', () => {
    let hazards = 0;
    let contained = 0;
    const wins = [0, 0, 0, 0];
    for (let seed = 1; seed <= 200; seed++) {
      const s = simulateGame(seed, 4, {
        onSettle: (_st, plan, rep) => {
          if (!plan.card) return;
          hazards++;
          if (rep.contained) contained++;
        },
      });
      if (s.winner !== null && s.winner >= 0) wins[s.players[s.winner].difficulty]++;
    }
    const rate = contained / hazards;
    console.log(`4p containment ${(rate * 100).toFixed(1)}%, wins by difficulty ${wins.join(',')}`);
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.7);
    expect(wins[3]).toBeGreaterThan(wins[0]);
  });
});
