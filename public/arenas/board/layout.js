// The board's shape (pure data, no THREE): a folded playset loop on a tabletop, sized so the shared camera keeps
// beans big (about the kitchen's footprint). Local frame = world. z+ faces the camera; the game box lid stands at the
// back. The loop runs clockwise seen from above: along the front (left to right), up the right ramp, along the back
// terrace (right to left) past the tower, down the left ramp. A narrow red bridge cuts from the front middle straight
// up to the terrace: the shortcut.
//   blocks: boxes { x0, y0, z0, x1, y1, z1 } and ramps (see RAMPS)
export const TABLE = { x0: -6.4, x1: 6.4, z0: -5.2, z1: 4.8, y: 0, thick: 0.8 };   // the playset sits flush with its sides: off the side is off the table
export const TRACK_Y = 0.3, TERRACE_Y = 1.5, HILL_Y = 3.0;
export const KILL_Y = -3;
export const FLOOR_Y = -12;

export const BOXES = [
  { name: 'front', x0: -6.2, x1: 6.2, y0: 0, y1: TRACK_Y, z0: 2.4, z1: 4.0 },
  { name: 'left', x0: -6.2, x1: -4.6, y0: 0, y1: TRACK_Y, z0: 0.6, z1: 2.4 },
  { name: 'right', x0: 4.6, x1: 6.2, y0: 0, y1: TRACK_Y, z0: 0.6, z1: 2.4 },
  { name: 'terrace', x0: -6.2, x1: 6.2, y0: 0, y1: TERRACE_Y, z0: -5.2, z1: -2.0 },
  { name: 'tower', x0: -1.5, x1: 1.5, y0: TERRACE_Y, y1: HILL_Y, z0: -5.2, z1: -3.7 },
];
// ramps rise from y0 at a0 to y1 at a1 along their axis; thick: a slab (the bridge) instead of a solid wedge
export const RAMPS = [
  { name: 'rampL', axis: 'z', x0: -6.2, x1: -4.6, a0: 0.6, a1: -2.0, y0: TRACK_Y, y1: TERRACE_Y, thick: null },
  { name: 'rampR', axis: 'z', x0: 4.6, x1: 6.2, a0: 0.6, a1: -2.0, y0: TRACK_Y, y1: TERRACE_Y, thick: null },
  { name: 'towerRampR', axis: 'x', z0: -5.2, z1: -3.7, a0: 4.6, a1: 1.5, y0: TERRACE_Y, y1: HILL_Y, thick: null },
  { name: 'towerRampL', axis: 'x', z0: -5.2, z1: -3.7, a0: -4.6, a1: -1.5, y0: TERRACE_Y, y1: HILL_Y, thick: null },
  { name: 'bridge', axis: 'z', x0: -0.5, x1: 0.5, a0: 2.4, a1: -2.0, y0: TRACK_Y, y1: TERRACE_Y, thick: 0.25 },
];
export const HILL = { x0: -1.5, x1: 1.5, z0: -5.2, z1: -3.7, y: HILL_Y };

// ramp surface height at (x, z), or null off its footprint
export function rampHeight(r, x, z) {
  const [u, c0, c1] = r.axis === 'z' ? [z, r.x0, r.x1] : [x, r.z0, r.z1];
  const v = r.axis === 'z' ? x : z;
  if (v < c0 || v > c1) return null;
  const lo = Math.min(r.a0, r.a1), hi = Math.max(r.a0, r.a1);
  if (u < lo || u > hi) return null;
  return r.y0 + (r.y1 - r.y0) * (u - r.a0) / (r.a1 - r.a0);
}
// the top walkable height at (x, z) (bridges count), or -Infinity off the table
export function heightAt(x, z) {
  if (!inTable(x, z)) return -Infinity;
  let h = TABLE.y;
  for (const b of BOXES) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) h = Math.max(h, b.y1);
  for (const r of RAMPS) { const y = rampHeight(r, x, z); if (y != null) h = Math.max(h, y); }
  return h;
}
export const inTable = (x, z) => x >= TABLE.x0 && x <= TABLE.x1 && z >= TABLE.z0 && z <= TABLE.z1;
// distance to a drop the bots must respect: the table edge, and the hill's rim when on top of it
export function edgeDist(x, z) {
  let d = Math.min(x - TABLE.x0, TABLE.x1 - x, z - TABLE.z0, TABLE.z1 - z);
  if (x > HILL.x0 && x < HILL.x1 && z > HILL.z0 && z < HILL.z1) d = Math.min(d, x - HILL.x0 + 0.6, HILL.x1 - x + 0.6, HILL.z1 - z + 0.6);
  return d;
}

// ---------------------------------------------------------------- spaces (the board graph)
// kind: blue (+coins), red (-coins). The star sits on one blue space at a time. next: forward links (one fork).
const S = (id, x, z, kind = 'blue', next = null) => ({ id, x, z, y: heightAt(x, z), kind, next: next || [] });
const FRONT_Z = 3.2, BACK_Z = -2.85, SIDE_X = 5.4, RAMP_Z = -0.7, SIDE_Z = 1.45;
export const SPACES = [
  S(0, -SIDE_X, FRONT_Z), S(1, -3.6, FRONT_Z), S(2, -1.8, FRONT_Z, 'red'), S(3, 0, FRONT_Z), S(4, 1.8, FRONT_Z), S(5, 3.6, FRONT_Z, 'red'), S(6, SIDE_X, FRONT_Z),
  S(7, SIDE_X, SIDE_Z), S(8, SIDE_X, RAMP_Z),
  S(9, SIDE_X, BACK_Z), S(10, 3.6, BACK_Z, 'red'), S(11, 1.8, BACK_Z), S(12, 0, BACK_Z), S(13, -1.8, BACK_Z), S(14, -3.6, BACK_Z, 'red'), S(15, -SIDE_X, BACK_Z),
  S(16, -SIDE_X, RAMP_Z), S(17, -SIDE_X, SIDE_Z),
  // the shortcut bridge: two red spaces from the front middle to the terrace middle
  S(18, 0, 1.3, 'red'), S(19, 0, -0.5, 'red'),
];
for (let i = 0; i < 18; i++) SPACES[i].next = [(i + 1) % 18];
SPACES[3].next = [4, 18]; SPACES[18].next = [19]; SPACES[19].next = [12];
export const START = 0;

// walking waypoints for bots: every space, plus the hill and its two ramps
export const WAYPOINTS = [
  ...SPACES.map((s) => ({ id: 's' + s.id, x: s.x, z: s.z, y: s.y })),
  { id: 'rampR', x: 4.3, z: -4.45, y: TERRACE_Y }, { id: 'rampL', x: -4.3, z: -4.45, y: TERRACE_Y },
  { id: 'hill', x: 0, z: -4.45, y: HILL_Y },
  // down on the table inside the loop (knocked off the track or the bridge): ways back up the low track edge
  { id: 'tL1', x: -2.7, z: 1.7, y: 0 }, { id: 'tL2', x: -2.7, z: -1.2, y: 0 }, { id: 'tR1', x: 2.7, z: 1.7, y: 0 }, { id: 'tR2', x: 2.7, z: -1.2, y: 0 },
];
// [a, b, extra cost] (both ways); stepping up the low track edge from the table costs a little extra
export const LINKS = [
  ...SPACES.flatMap((s) => s.next.map((n) => ['s' + s.id, 's' + n, 0])),
  ['s10', 'rampR', 0], ['s11', 'rampR', 0], ['rampR', 'hill', 0],
  ['s13', 'rampL', 0], ['s14', 'rampL', 0], ['rampL', 'hill', 0],
  ['tL1', 'tL2', 0], ['tL1', 's1', 1], ['tL1', 's2', 1], ['tL1', 's17', 1],
  ['tR1', 'tR2', 0], ['tR1', 's4', 1], ['tR1', 's5', 1], ['tR1', 's7', 1],
];

// grab-and-climb edges: terrace front (either side of the bridge), the tower's front, the bridge sides, the table
export const LEDGES = [
  [-4.6, TERRACE_Y, -2.0, -0.5, TERRACE_Y, -2.0], [0.5, TERRACE_Y, -2.0, 4.6, TERRACE_Y, -2.0],
  [-1.5, HILL_Y, -3.7, 1.5, HILL_Y, -3.7],
  [-0.5, TRACK_Y, 2.4, -0.5, TERRACE_Y, -2.0], [0.5, TRACK_Y, 2.4, 0.5, TERRACE_Y, -2.0],
  [TABLE.x0, 0, TABLE.z1, TABLE.x1, 0, TABLE.z1], [TABLE.x0, 0, TABLE.z0 + 3.2, TABLE.x0, 0, TABLE.z1], [TABLE.x1, 0, TABLE.z0 + 3.2, TABLE.x1, 0, TABLE.z1],
];

// walkable points (bots' fall catches, hazards): a 0.6 m grid over the table, tagged by what's there
export const POINTS = (() => {
  const out = [];
  for (let x = TABLE.x0 + 0.5; x <= TABLE.x1 - 0.5; x += 0.6) for (let z = TABLE.z0 + 0.5; z <= TABLE.z1 - 0.5; z += 0.6) {
    const y = heightAt(x, z);
    const tag = y >= HILL_Y - 0.01 ? 'hill' : y >= TERRACE_Y - 0.01 ? 'terrace' : y > 0.01 ? 'track' : 'table';
    out.push([+x.toFixed(2), +z.toFixed(2), +y.toFixed(3), tag]);
  }
  return out;
})();

// everyone starts around the first space; the hill game starts along the terrace in front of the tower
export const SPAWNS = [[-5.85, 0.9, 2.8], [-4.95, 0.9, 2.8], [-5.85, 0.9, 3.6], [-4.95, 0.9, 3.6]];
// (the game rotates who gets which spot)
export const HILL_SPAWNS = [[-1.65, 2.2, -2.5], [-0.55, 2.2, -2.5], [0.55, 2.2, -2.5], [1.65, 2.2, -2.5]];
