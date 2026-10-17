import type Phaser from 'phaser';
import type { Avatar } from './avatar';
import type { Danger } from './botBrain';
import type { HouseView } from './houseView';

/** Shared state the hazard and goal systems work against. */
export interface MGContext {
  scene: Phaser.Scene;
  house: HouseView;
  avatars: Avatar[];
  rnd: () => number;
  now: number;
  /** Hazard hits per player this minigame (feeds the group score). */
  hazardHits: number[];
  coinDelta: number[];
  dangers: Danger[];
  flippedRooms: Set<string>;
  /** room id -> vision radius in that room. */
  darkRooms: Map<string, number>;
  /** Rooms a hazard is currently active in (bots avoid idling there). */
  hotRooms: Set<string>;
  /** Visual feedback helpers supplied by the scene. */
  popText(text: string, x: number, y: number, color?: string): void;
  sfx(name: 'hit' | 'coin' | 'pickup' | 'boom' | 'blip'): void;
}

export interface System {
  update(dt: number): void;
  destroy(): void;
}

export function overlaps(av: Avatar, x: number, y: number, rx: number, ry: number): boolean {
  return Math.abs(av.x - x) < rx && Math.abs(av.y - y) < ry;
}
