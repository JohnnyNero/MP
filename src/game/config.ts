// Layout constants for the 480x270 world (rendered at 2x).

export const W = 480;
export const H = 270;
export const ZOOM = 2;

export const PLAYER_COLORS = [0xe8504a, 0x4a8be8, 0x5cc85a, 0xf2c94c];
export const PLAYER_CSS = ['#e8504a', '#4a8be8', '#5cc85a', '#f2c94c'];

/**
 * The house grid: 6 x 4 cells, row 0 at the top. Each row is CH tall and its
 * floor slab (SLAB thick) is the bottom of the row, so a one-row room is
 * CH - SLAB = 52 px tall inside. Roofs sit above the top-most cells.
 */
export const GRID_COLS = 6;
export const GRID_ROWS = 4;
export const X0 = 12;
export const CW = 76;
export const Y0 = 34;
export const CH = 58;
export const SLAB = 6;
export const WALL = 4;
export const DOOR_H = 30;
/** Height of a roof triangle over a top-most cell. */
export const ROOF_H = 18;
/** World x of vertical grid line gx. */
export const gridX = (gx: number) => X0 + gx * CW;
/** World y of the top of grid row gy (just under the slab above it). */
export const rowTop = (gy: number) => Y0 + gy * CH;
/** Floor surface (top of the slab) at the bottom of grid row gy. */
export const rowFloor = (gy: number) => Y0 + (gy + 1) * CH - SLAB;
export const HOUSE_X0 = gridX(0);
export const HOUSE_X1 = gridX(GRID_COLS);

export const GRAVITY = 620;
export const RUN_SPEED = 82;
export const JUMP_V = 215;
export const CLIMB_SPEED = 60;

export const MINIGAME_SECONDS = 40;
/** Per-goal minigame length (seconds); goals not listed use MINIGAME_SECONDS. `?mg=` overrides all. */
export const MINIGAME_SECONDS_BY_GOAL: Record<string, number> = {
  potato: 30,
  king: 45,
};
export function minigameSeconds(goal: string): number {
  const q = Number(new URLSearchParams(location.search).get('mg'));
  return q > 0 ? q : MINIGAME_SECONDS_BY_GOAL[goal] ?? MINIGAME_SECONDS;
}
export const REGROUP_SECONDS = 18;

export interface Climbable {
  id: string; // connection id
  kind: 'stairs' | 'ladder';
  x0: number; // bottom end
  y0: number;
  x1: number; // top end
  y1: number;
  lower: string;
  upper: string;
}
