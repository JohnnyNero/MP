// Core data model. Everything here is plain JSON so GameState can be
// cloned, saved and replayed.

export type SpaceType =
  | 'start'
  | 'blue'
  | 'red'
  | 'danger'
  | 'shop'
  | 'repair'
  | 'toll'
  | 'gate'
  | 'finish';

export interface BoardSpace {
  id: string;
  type: SpaceType;
  x: number;
  y: number;
  next: string[];
}

export interface BoardDef {
  spaces: Record<string, BoardSpace>;
  start: string;
  finish: string;
}

export type RoomTag =
  | 'wet'
  | 'dark'
  | 'overgrown'
  | 'burning'
  | 'lowgrav'
  | 'cluttered'
  | 'monkeys';

export type ConnectionKind = 'door' | 'stairs' | 'ladder' | 'vent' | 'hole';

export interface RoomDef {
  id: string;
  name: string;
  floor: number; // 0 = ground
  col: number; // 0..2 left to right
}

export interface ConnectionDef {
  id: string;
  kind: ConnectionKind;
  a: string; // room id (for vertical connections: the lower room)
  b: string;
}

export interface HouseDef {
  rooms: RoomDef[];
  connections: ConnectionDef[];
  boardRoom: string;
}

export type HazardId =
  | 'flood'
  | 'meteor'
  | 'vines'
  | 'stampede'
  | 'blackout'
  | 'gravity'
  | 'fire'
  | 'monkeys';

export type Targeting =
  | { kind: 'floor'; floor: number }
  | { kind: 'randomRoom' }
  | { kind: 'randomFloor' };

export interface CardDef {
  id: HazardId;
  name: string;
  blurb: string;
  targeting: Targeting;
  lingerTags: RoomTag[];
  /** Lingering also blocks one connection of the target room. */
  blocksConnection?: boolean;
  /** Lingering also punches a hole in the floor of one target room. */
  makesHole?: boolean;
  /** Lingering also knocks the board prop into a neighbouring room. */
  movesBoard?: boolean;
  /** Lingering spreads to a neighbour room each round with this chance. */
  spreadChance?: number;
  containBar: number;
  incompatibleGoals?: GoalId[];
}

export type GoalId = 'survive' | 'collect' | 'king' | 'race' | 'potato' | 'tag';
export type Format = 'ffa' | '1v3' | '2v2';

export interface GoalDef {
  id: GoalId;
  name: string;
  blurb: string;
  formats: Format[];
}

export type ItemId = 'doubleDie' | 'reroll' | 'pushBack' | 'warpSwap' | 'respin';
export type PerkId = 'headStart' | 'springBoots';

export interface ShopEntry {
  id: ItemId | PerkId;
  kind: 'item' | 'perk';
  name: string;
  blurb: string;
  price: number;
}

export type LandColor = 'blue' | 'red' | 'neutral';

export interface PlayerState {
  id: number;
  name: string;
  isBot: boolean;
  difficulty: number; // 0..3
  coins: number;
  space: string;
  trail: string[]; // spaces visited, most recent last (for push-back)
  items: ItemId[];
  perks: PerkId[];
  color: LandColor;
}

export interface ActiveEffect {
  uid: number;
  card: HazardId;
  rooms: string[];
  round: number;
  blockedConnection?: string;
  hole?: { from: string; to: string };
  boardTo?: string;
}

export interface PoolCard {
  card: HazardId;
  drawnBy: number;
}

export type Phase = 'regroup' | 'turns' | 'house' | 'minigame' | 'over';

export interface GameState {
  seed: number;
  rng: Record<string, number>;
  round: number;
  roundCap: number;
  phase: Phase;
  players: PlayerState[];
  turnOrder: number[];
  pool: PoolCard[];
  deck: HazardId[];
  effects: ActiveEffect[];
  nextUid: number;
  openGates: string[];
  respinArmed: boolean;
  winner: number | null; // player id, or -1 for "the house"
  log: string[];
}

export interface MinigamePlan {
  card: HazardId | null;
  rooms: string[];
  goal: GoalId;
  format: Format;
  /** teams[pid] = 0 or 1 for team formats; all 0 for ffa. */
  teams: number[];
  /** For 1v3: the team index of the solo player. */
  soloTeam: number;
  rouletteOptions: HazardId[];
  /** -1 when no card was picked (empty pool, or the only card type was vetoed). */
  rouletteIndex: number;
  /** Set when a Re-spin veto threw out the first landing (index into rouletteOptions). */
  vetoedIndex?: number;
}

export interface MinigameResult {
  /** Higher is better. Indexed by player id. */
  scores: number[];
  /** 0..1, how well the group did as a whole against the hazard/goal. */
  groupScore: number;
  /** Extra coin changes during play (monkeys stealing etc). */
  coinDelta?: number[];
}

export interface SettleReport {
  ranks: number[]; // 1 = best
  payouts: number[];
  contained: boolean;
  newEffect: ActiveEffect | null;
  spread: ActiveEffect[];
  houseWins: boolean;
}
