import type { CardDef, GoalDef, HazardId, ShopEntry } from '../core/types';

export const CARDS: Record<HazardId, CardDef> = {
  flood: {
    id: 'flood',
    name: 'Flood',
    blurb: 'The pipes burst. Water rises on the ground floor.',
    targeting: { kind: 'floor', floor: 0 },
    lingerTags: ['wet'],
    containBar: 0.65,
  },
  meteor: {
    id: 'meteor',
    name: 'Meteor Shower',
    blurb: 'Rocks crash through the roof into the top floor.',
    targeting: { kind: 'floor', floor: 2 },
    lingerTags: [],
    makesHole: true,
    containBar: 0.65,
  },
  vines: {
    id: 'vines',
    name: 'Vine Growth',
    blurb: 'Jungle vines burst out of the walls.',
    targeting: { kind: 'randomRoom' },
    lingerTags: ['overgrown'],
    blocksConnection: true,
    containBar: 0.65,
  },
  stampede: {
    id: 'stampede',
    name: 'Stampede',
    blurb: 'A herd thunders across a whole floor.',
    targeting: { kind: 'randomFloor' },
    lingerTags: ['cluttered'],
    movesBoard: true,
    containBar: 0.65,
  },
  blackout: {
    id: 'blackout',
    name: 'Blackout',
    blurb: 'The lights die. You can only see what is right next to you.',
    targeting: { kind: 'randomRoom' },
    lingerTags: ['dark'],
    containBar: 0.65,
  },
  gravity: {
    id: 'gravity',
    name: 'Gravity Flip',
    blurb: 'Up is down in one room (except right by its doors, ladders and vents).',
    targeting: { kind: 'randomRoom' },
    lingerTags: ['lowgrav'],
    containBar: 0.65,
  },
  fire: {
    id: 'fire',
    name: 'Fire',
    blurb: 'Something caught alight. It spreads if nobody deals with it.',
    targeting: { kind: 'randomRoom' },
    lingerTags: ['burning'],
    spreadChance: 0.4,
    containBar: 0.65,
  },
  monkeys: {
    id: 'monkeys',
    name: 'Monkey Thieves',
    blurb: 'Monkeys pour in and grab coins from anyone they touch.',
    targeting: { kind: 'randomRoom' },
    lingerTags: ['monkeys'],
    containBar: 0.65,
  },
};

/** Copies of each card in the deck. */
export const DECK_COUNTS: Record<HazardId, number> = {
  flood: 2,
  meteor: 2,
  vines: 2,
  stampede: 2,
  blackout: 2,
  gravity: 2,
  fire: 2,
  monkeys: 2,
};

export const GOALS: GoalDef[] = [
  { id: 'survive', name: 'Survive', blurb: 'Take the fewest hits.', formats: ['ffa', '1v3', '2v2'] },
  { id: 'collect', name: 'Apple Rain', blurb: 'Catch the most falling apples.', formats: ['ffa', '1v3', '2v2'] },
  { id: 'king', name: 'King of the Hill', blurb: 'Hold the flag zone the longest.', formats: ['ffa', '1v3', '2v2'] },
  { id: 'race', name: 'Pennant Race', blurb: 'Be first to each pennant.', formats: ['ffa', '1v3', '2v2'] },
  { id: 'potato', name: 'Hot Potato', blurb: "Don't be holding the bomb when it blows.", formats: ['ffa', '1v3', '2v2'] },
  { id: 'tag', name: 'Tag', blurb: 'The chasers tag; the runners run.', formats: ['1v3', '2v2'] },
];

export const SHOP: ShopEntry[] = [
  { id: 'doubleDie', kind: 'item', name: 'Double Die', blurb: 'Roll two dice this turn.', price: 8 },
  { id: 'reroll', kind: 'item', name: 'Reroll', blurb: 'Reroll once after seeing your roll.', price: 5 },
  { id: 'pushBack', kind: 'item', name: 'Push Back', blurb: 'Send a rival back 3 spaces.', price: 8 },
  { id: 'warpSwap', kind: 'item', name: 'Warp Swap', blurb: 'Swap board places with a random rival.', price: 12 },
  { id: 'respin', kind: 'item', name: 'Re-spin', blurb: "Force this round's roulette to spin again.", price: 6 },
  { id: 'headStart', kind: 'perk', name: 'Head Start', blurb: 'Speed boost at the start of the next minigame.', price: 5 },
  { id: 'springBoots', kind: 'perk', name: 'Spring Boots', blurb: 'Jump higher in the next minigame.', price: 5 },
];

export const SHOP_BY_ID = Object.fromEntries(SHOP.map((e) => [e.id, e]));
