// What a board turn yields: events (for animation) and decisions (answered
// by the UI or a bot).
import type { HazardId, ItemId } from './types';

export type TurnEvent =
  | { t: 'useItem'; item: ItemId }
  /** `bonus` is the catch-up +1 for last place (already included in total). */
  | { t: 'roll'; values: number[]; total: number; bonus?: number }
  | { t: 'move'; from: string; to: string; stepsLeft: number }
  | { t: 'coins'; delta: number; reason: string }
  | { t: 'drawCard'; card: HazardId }
  | { t: 'bought'; id: ItemId }
  | { t: 'repaired'; uid: number; card: HazardId }
  /** Extra steps granted (the repair reward, or the minigame reward at turn start). */
  | { t: 'bonusSteps'; steps: number; reason: string }
  | { t: 'gateOpened'; space: string }
  | { t: 'pushed'; target: number; to: string }
  | { t: 'swapped'; a: number; b: number }
  | { t: 'respinArmed' }
  | { t: 'win' };

export interface JunctionOption {
  to: string;
  cost: number;
  label: string;
}
export interface ShopOption {
  id: ItemId;
  price: number;
}
export interface RepairOption {
  uid: number;
  card: HazardId;
  rooms: string[];
  price: number;
}

export type Decision =
  | { d: 'preRoll'; options: ('roll' | ItemId)[] }
  | { d: 'reroll'; total: number }
  | { d: 'junction'; options: JunctionOption[] }
  | { d: 'shop'; options: ShopOption[] }
  | { d: 'repair'; options: RepairOption[] }
  | { d: 'target'; options: number[]; purpose: 'pushBack' };

export type TurnStep = { kind: 'event'; ev: TurnEvent } | { kind: 'decide'; dec: Decision };

/** Answers: preRoll -> 'roll' | ItemId, reroll -> boolean, junction -> index,
 *  shop -> id | null, repair -> uid | null, target -> player id. */
export type Answer = string | number | boolean | null;
