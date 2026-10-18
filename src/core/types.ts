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

export type ConnectionKind =
  | 'door' // two-way, same level, through a shared wall
  | 'bookcase' // two-way door that spins you through (press action)
  | 'stairs' // two-way vertical
  | 'ladder' // two-way vertical
  | 'lift' // two-way vertical dumbwaiter (press action to ride)
  | 'portal' // two-way painting pair between any two rooms
  | 'chute' // one-way down
  | 'pole' // one-way down
  | 'slide' // one-way down
  | 'tramp' // one-way UP (trampoline bed)
  | 'hole'; // one-way down, created by meteors

/** 0 = Sensible, 1 = Silly, 2 = Nonsense. Chosen in the lobby. */
export type Goofiness = 0 | 1 | 2;

/**
 * Houses are built on a cell grid: `cols` x `rows`, row 0 at the top.
 * `level` counts from the bottom: level 0 is the lowest row (the basement).
 */
export interface RoomDef {
  id: string;
  name: string;
  /** Level of the room's floor (its bottom row); 0 = lowest. */
  floor: number;
  /** Left-most column. */
  col: number;
  /** Grid rect, in cells: gx/gy is the top-left cell, gw/gh the size. */
  gx: number;
  gy: number;
  gw: number;
  gh: number;
  /** Theme key used by the art (wallpaper, props), e.g. 'kitchen', 'ballpit'. */
  theme: string;
  /** Wall colour (0xRRGGBB). */
  color: number;
}

export interface ConnectionDef {
  id: string;
  kind: ConnectionKind;
  /**
   * Vertical kinds: a = the LOWER room, b = the UPPER room (for every kind,
   * including tramp, which goes a -> b, and chute/pole/slide/hole, which go b -> a).
   * Doors/bookcases: a = left room, b = right room. Portals and lifts: any order.
   */
  a: string;
  b: string;
  /** Doors/bookcases: index of the vertical grid line (wall) they sit in. */
  wallX?: number;
  /** Doors/bookcases: grid row the door is on (row index from the top). */
  row?: number;
  /** Vertical kinds: grid column, plus horizontal position inside it (0..1). */
  colX?: number;
  frac?: number;
  /** Portals: horizontal position (0..1) inside room a and room b. */
  fracA?: number;
  fracB?: number;
}

export type PropKind = 'switch' | 'trapdoor';

/** Interactables that live inside one room rather than linking two. */
export interface PropDef {
  id: string;
  kind: PropKind;
  room: string;
  /** Horizontal position inside the room (0..1). */
  frac: number;
}

export interface HouseDef {
  cols: number;
  rows: number;
  rooms: RoomDef[];
  connections: ConnectionDef[];
  props: PropDef[];
  boardRoom: string;
  /** Feature ids shown to players ("Portal paintings", ...). */
  features: string[];
  name: string;
  seed: number;
  goofiness: Goofiness;
  /** Top-row cells with no room (roof gaps), as "gx,gy". */
  gaps: string[];
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
  | { kind: 'lowest' } // every room on the lowest level (the basement)
  | { kind: 'highest' } // every room right under the roof
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
export interface ShopEntry {
  id: ItemId;
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
  /** Bonus spaces won in the last minigame, walked at the start of the next board turn. */
  pendingSteps: number;
  color: LandColor;
}

export interface ActiveEffect {
  uid: number;
  card: HazardId;
  rooms: string[];
  round: number;
  blockedConnection?: string;
  /**
   * Meteor hole from `from` (upper) down to `to` (the room directly below).
   * colX = grid column it punches through, frac = position inside it (0..1);
   * the boundary is `from`'s floor / `to`'s ceiling. Derived as a 'hole' connection.
   */
  hole?: { from: string; to: string; colX?: number; frac?: number };
  boardTo?: string;
}

export interface PoolCard {
  card: HazardId;
  drawnBy: number;
}

export type Phase = 'regroup' | 'turns' | 'house' | 'minigame' | 'over';

export interface GameState {
  seed: number;
  /** This game's procedurally generated house (fixed for the whole game). */
  house: HouseDef;
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
  /** Bonus board spaces won by placement (added to each player's pendingSteps). */
  steps: number[];
  contained: boolean;
  newEffect: ActiveEffect | null;
  spread: ActiveEffect[];
  houseWins: boolean;
}
