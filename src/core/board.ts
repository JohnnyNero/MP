import { BOARD } from '../content/board';
import type { BoardDef } from './types';

/** Shortest number of steps from each space to the finish. */
export function distancesToFinish(board: BoardDef = BOARD): Record<string, number> {
  const prev: Record<string, string[]> = {};
  for (const s of Object.values(board.spaces)) {
    for (const n of s.next) (prev[n] ??= []).push(s.id);
  }
  const dist: Record<string, number> = { [board.finish]: 0 };
  const queue = [board.finish];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const p of prev[cur] ?? []) {
      if (dist[p] === undefined) {
        dist[p] = dist[cur] + 1;
        queue.push(p);
      }
    }
  }
  return dist;
}

export const DIST = distancesToFinish();

export function distToFinish(space: string): number {
  return DIST[space] ?? 0;
}
