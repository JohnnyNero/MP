import { HOUSE, ROOM_BY_ID } from '../content/house';
import { CARDS } from '../content/cards';
import type { ConnectionDef, GameState, RoomTag } from './types';

export interface DerivedHouse {
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
export function deriveHouse(state: Pick<GameState, 'effects'>): DerivedHouse {
  const tags: Record<string, RoomTag[]> = {};
  for (const r of HOUSE.rooms) tags[r.id] = [];
  const blocked = new Set<string>();
  const connections: ConnectionDef[] = [...HOUSE.connections];
  let boardRoom = HOUSE.boardRoom;

  for (const e of state.effects) {
    const card = CARDS[e.card];
    for (const room of e.rooms) {
      for (const t of card.lingerTags) if (!tags[room].includes(t)) tags[room].push(t);
    }
    if (e.blockedConnection) blocked.add(e.blockedConnection);
    if (e.hole) {
      connections.push({ id: `h-${e.uid}`, kind: 'hole', a: e.hole.to, b: e.hole.from });
    }
    if (e.boardTo) boardRoom = e.boardTo;
  }
  const boardWrapped = tags[boardRoom].includes('overgrown');
  // Until destruction rules exist, each lingering effect in a room adds a level.
  const damage: Record<string, number> = {};
  for (const r of HOUSE.rooms) damage[r.id] = 0;
  for (const e of state.effects) for (const r of e.rooms) damage[r] = Math.min(3, damage[r] + 1);
  return { tags, blocked, connections, boardRoom, boardWrapped, damage };
}

export function neighbours(roomId: string, conns: ConnectionDef[], blocked?: Set<string>): string[] {
  const out: string[] = [];
  for (const c of conns) {
    if (blocked?.has(c.id)) continue;
    if (c.a === roomId) out.push(c.b);
    else if (c.b === roomId) out.push(c.a);
  }
  return out;
}

export function roomsOnFloor(floor: number): string[] {
  return HOUSE.rooms.filter((r) => r.floor === floor).map((r) => r.id);
}

export function roomName(id: string): string {
  return ROOM_BY_ID[id]?.name ?? id;
}

/** Room ids reachable from `from` (BFS), honouring blocked connections. */
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
