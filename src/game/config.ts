// Layout constants for the 480x270 world (rendered at 2x).

export const W = 480;
export const H = 270;
export const ZOOM = 2;

export const PLAYER_COLORS = [0xe8504a, 0x4a8be8, 0x5cc85a, 0xf2c94c];
export const PLAYER_CSS = ['#e8504a', '#4a8be8', '#5cc85a', '#f2c94c'];

/** Surface y (top of the floor slab) for floors 0..2, and the roof. */
export const FLOOR_Y = [262, 182, 102];
export const ROOF_Y = 22;
export const SLAB = 6;
export const ROOM_INNER_H = 74;
export const COL_X = [8, 160, 320, 472];
export const WALL = 4;
export const DOOR_H = 30;

export const GRAVITY = 620;
export const RUN_SPEED = 82;
export const JUMP_V = 215;
export const SPRING_JUMP_V = 265;
export const CLIMB_SPEED = 60;

export const MINIGAME_SECONDS = 40;
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

/** Fixed geometry for the base connections in content/house.ts. */
export const CLIMB_GEOMETRY: Record<string, Omit<Climbable, 'id' | 'lower' | 'upper'>> = {
  's-kitchen-bedroom': { kind: 'stairs', x0: 34, y0: FLOOR_Y[0], x1: 112, y1: FLOOR_Y[1] },
  'l-garage-kids': { kind: 'ladder', x0: 452, y0: FLOOR_Y[0], x1: 452, y1: FLOOR_Y[1] },
  'l-bathroom-study': { kind: 'ladder', x0: 296, y0: FLOOR_Y[1], x1: 296, y1: FLOOR_Y[2] },
  'l-kids-storage': { kind: 'ladder', x0: 344, y0: FLOOR_Y[1], x1: 344, y1: FLOOR_Y[2] },
};

export const VENT_GEOMETRY: Record<string, { ax: number; bx: number }> = {
  'v-living-attic': { ax: 196, bx: 40 },
};

export const BOARD_X: Record<string, number> = {
  kitchen: 84,
  living: 240,
  garage: 396,
  bedroom: 60,
  bathroom: 240,
  kids: 400,
  attic: 100,
  study: 240,
  storage: 400,
};
