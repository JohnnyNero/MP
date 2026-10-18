import { CARDS } from '../content/cards';
import { bottomRow, ownerGrid, roofCols, traverse } from './houseGrid';
import type { ConnectionDef, GameState, HouseDef, RoomDef, RoomTag } from './types';

export interface DerivedHouse {
  /** The base layout (geometry for the game layer). Never mutated. */
  def: HouseDef;
  tags: Record<string, RoomTag[]>;
  blocked: Set<string>;
  connections: ConnectionDef[]; // base + effect-created (holes)
  boardRoom: string;
  boardWrapped: boolean;
  /** Visual wreckage per room, 0 (pristine) to 3 (wrecked). Gameplay rules TBD. */
  damage: Record<string, number>;
}

/**
 * Rebuild the house from the base layout plus the active effects. This is
 * the only way the game layer learns what the house currently looks like.
 */
export function deriveHouse(state: Pick<GameState, 'effects' | 'house'>): DerivedHouse {
  const def = state.house;
  const tags: Record<string, RoomTag[]> = {};
  for (const r of def.rooms) tags[r.id] = [];
  const blocked = new Set<string>();
  const connections: ConnectionDef[] = [...def.connections];
  let boardRoom = def.boardRoom;

  for (const e of state.effects) {
    const card = CARDS[e.card];
    for (const room of e.rooms) {
      for (const t of card.lingerTags) if (!tags[room].includes(t)) tags[room].push(t);
    }
    if (e.blockedConnection) blocked.add(e.blockedConnection);
    if (e.hole) {
      connections.push({
        id: `h-${e.uid}`, kind: 'hole', a: e.hole.to, b: e.hole.from,
        ...(e.hole.colX !== undefined ? { colX: e.hole.colX, frac: e.hole.frac ?? 0.5 } : {}),
      });
    }
    if (e.boardTo) boardRoom = e.boardTo;
  }
  const boardWrapped = tags[boardRoom].includes('overgrown');
  // Until destruction rules exist, each lingering effect in a room adds a level.
  const damage: Record<string, number> = {};
  for (const r of def.rooms) damage[r.id] = 0;
  for (const e of state.effects) for (const r of e.rooms) damage[r] = Math.min(3, damage[r] + 1);
  return { def, tags, blocked, connections, boardRoom, boardWrapped, damage };
}

/**
 * Rooms a player can move to from `roomId`. One-way kinds only count in
 * their direction (chute/pole/slide/hole: b -> a; tramp: a -> b).
 */
export function neighbours(roomId: string, conns: ConnectionDef[], blocked?: Set<string>): string[] {
  const out: string[] = [];
  for (const c of conns) {
    if (blocked?.has(c.id)) continue;
    const to = traverse(c, roomId);
    if (to !== null && to !== roomId) out.push(to);
  }
  return out;
}

export function roomById(house: HouseDef, id: string): RoomDef | undefined {
  return house.rooms.find((r) => r.id === id);
}

/** Rooms whose floor is on `floor` (level counted from the bottom, 0 = lowest). */
export function roomsOnFloor(house: HouseDef, floor: number): string[] {
  return house.rooms.filter((r) => r.floor === floor).map((r) => r.id);
}

/** Rooms on the lowest level (the basement). */
export function lowestRooms(house: HouseDef): string[] {
  return roomsOnFloor(house, Math.min(...house.rooms.map((r) => r.floor)));
}

/** Rooms with open sky above at least one of their columns (right under the roof). */
export function highestRooms(house: HouseDef): string[] {
  const grid = ownerGrid(house);
  return house.rooms.filter((r) => roofCols(house, r, grid).length > 0).map((r) => r.id);
}

/** Levels that have at least one room. */
export function floorLevels(house: HouseDef): number[] {
  return [...new Set(house.rooms.map((r) => r.floor))].sort((a, b) => a - b);
}

/**
 * Where a meteor through `roomId`'s roof could punch down: one entry per
 * roof column that has a room directly below this room's floor.
 */
export function holeSpots(house: HouseDef, roomId: string): { colX: number; to: string }[] {
  const r = roomById(house, roomId);
  if (!r) return [];
  const grid = ownerGrid(house);
  const y = bottomRow(r) + 1;
  if (y >= house.rows) return [];
  return roofCols(house, r, grid)
    .map((colX) => ({ colX, to: grid[y][colX] }))
    .filter((s): s is { colX: number; to: string } => s.to !== null);
}

export function roomName(house: HouseDef, id: string): string {
  return roomById(house, id)?.name ?? id;
}

/** Room ids reachable from `from` (BFS), honouring blocked and one-way connections. */
export function reachable(from: string, house: DerivedHouse): Set<string> {
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of neighbours(cur, house.connections, house.blocked)) {
      if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
  }
  return seen;
}
