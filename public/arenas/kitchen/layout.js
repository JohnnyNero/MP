// Giant Kitchen layout, arena space: x along the counter (left -> right), z toward the camera (back wall at z = -4,
// open front edge at z = +4), y up, counter top at y = 0. Players are ~1.16 tall: everything else is huge.
// Plain data + surface functions, so tests and the page share them.
export const COUNTER = { x0: -8, x1: 8, z0: -4, z1: 4, y: 0, thick: 1.2 };
export const FLOOR_Y = -10.5;            // the kitchen floor, far below
export const KILL_Y = -2.2;              // fall this far below the counter top and you're out
export const SINK = { x0: -7.3, x1: -3.9, z0: -3.5, z1: -0.5, y: -0.8 };      // basin (the low area)
export const SINK_RAMP = { x0: -5.1, x1: -3.9, z0: -2.5, z1: -1.5 };          // drainboard ramp out of the basin, rises toward +x
export const BOARD = { x0: -3.4, x1: 1.0, z0: 0.4, z1: 3.4, y: 0.55, inset: 0.7 };   // thick cutting board, chamfered all round
export const STOVE = { x0: 3.4, x1: 7.35, z0: -4.0, z1: -0.2, y: 0.3, inset: 0.45 };  // hob, chamfered on the open sides, clear of the right edge
export const SHELF = { x0: -7.6, x1: 7.6, z0: -4.0, z1: -3.0, y: 4.4, t: 0.2 };
export const WINDOW = { x0: 0.6, x1: 7.0, y0: 5.3, y1: 10.5 };

// destructible pieces (baked in kitchenpieces.js): [def, x, y, z, rotY, materialOverride]
export const PIECES = [
  // cereal towers at the back: two boxes each
  { name: 'tower1_low', def: 'cereal_red', pos: [-2.6, 0, -2.6] }, { name: 'tower1_high', def: 'cereal_yellow', pos: [-2.6, 2.7, -2.6] },
  { name: 'tower2_low', def: 'cereal_blue', pos: [2.35, 0, -2.6] }, { name: 'tower2_high', def: 'cereal_red', pos: [2.35, 2.7, -2.6] },
  { name: 'toaster', def: 'toaster', pos: [-0.2, 0, -3.2] },
  { name: 'mug', def: 'mug', pos: [1.4, 0, -1.2], rotY: 0.3 },
  { name: 'jar_counter', def: 'jar_honey', pos: [-2.5, 0, -1.25] },
  { name: 'jar_stove', def: 'jar_jam', pos: [5.2, STOVE.y, -2.2] },
  // the domino row: five tall cracker boxes, then the plate stack it tips into
  ...[0, 1, 2, 3, 4].map((i) => ({ name: 'domino' + i, def: 'domino_' + ['green', 'blue', 'red', 'yellow', 'green'][i], pos: [1.45 + i * 1.0, 0, 1.6], domino: true })),
  { name: 'plates', def: 'plate_stack', pos: [7.05, 0, 1.6] },
  // shelf jars (fall when the shelf is shaken)
  { name: 'shelf0', def: 'jar_honey', pos: [-5.4, SHELF.y + SHELF.t, -3.45], shelf: true }, { name: 'shelf1', def: 'jar_jam', pos: [-1.6, SHELF.y + SHELF.t, -3.45], shelf: true },
  { name: 'shelf2', def: 'jar_honey', pos: [2.6, SHELF.y + SHELF.t, -3.45], shelf: true }, { name: 'shelf3', def: 'jar_jam', pos: [5.8, SHELF.y + SHELF.t, -3.45], shelf: true },
];
export const SPAWNS = [[-5.6, 1.4, 1.6], [-1.2, 2.0, 1.9], [2.9, 1.4, 0.15], [6.0, 1.4, 0.2]];

const inRect = (x, z, r, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
// chamfered platform height: flat top inset by `inset`, linear slope to y=0 at the base rect (sides flagged open)
function platform(x, z, P, open = { x0: true, x1: true, z0: true, z1: true }) {
  if (!inRect(x, z, P)) return null;
  const i = P.inset; let k = 1;
  if (open.x0) k = Math.min(k, (x - P.x0) / i); if (open.x1) k = Math.min(k, (P.x1 - x) / i);
  if (open.z0) k = Math.min(k, (z - P.z0) / i); if (open.z1) k = Math.min(k, (P.z1 - z) / i);
  return P.y * Math.max(0, Math.min(1, k));
}
export const STOVE_OPEN = { x0: true, x1: true, z0: false, z1: true };
export const inCounter = (x, z) => x > COUNTER.x0 && x < COUNTER.x1 && z > COUNTER.z0 && z < COUNTER.z1;
export function heightAt(x, z) {
  if (!inCounter(x, z)) return -1e9;
  if (inRect(x, z, SINK)) {
    if (inRect(x, z, SINK_RAMP)) return SINK.y * (SINK_RAMP.x1 - x) / (SINK_RAMP.x1 - SINK_RAMP.x0);
    return SINK.y;
  }
  const b = platform(x, z, BOARD); if (b != null) return b;
  const s = platform(x, z, STOVE, STOVE_OPEN); if (s != null) return s;
  return 0;
}
// distance to a drop (the back wall is safe)
export const edgeDist = (x, z) => Math.min(COUNTER.x1 - x, x - COUNTER.x0, COUNTER.z1 - z);
// static footprints the bots route around (the dominoes and plates move, but that corner stays cluttered)
export const OBSTACLES = [
  { x0: SINK.x0, x1: SINK.x1, z0: SINK.z0, z1: SINK.z1 },
  { x0: -1.6, x1: 1.4, z0: -4, z1: -2.45 },              // toaster
  { x0: 1.25, x1: 6.0, z0: 0.85, z1: 2.35 },             // domino row
];
const OCCUPIED = [
  { x0: -3.6, x1: 3.4, z0: -4, z1: -2.2 },               // back row: towers + toaster
  { x0: 0.7, x1: 2.6, z0: -1.95, z1: -0.45 },            // mug
  { x0: -3.05, x1: -1.95, z0: -1.8, z1: -0.7 },          // counter jar
  { x0: 1.2, x1: 6.0, z0: 0.8, z1: 2.4 },                // dominoes
  { x0: 5.9, x1: 8, z0: 0.6, z1: 2.6 },                  // plates
  { x0: 4.6, x1: 5.8, z0: -2.8, z1: -1.6 },              // jar on the stove
];
// walkable points [x, z, y, tag] for hazards and bots
export const POINTS = (() => {
  const out = [];
  for (let x = -7.2; x <= 7.25; x += 0.9) for (let z = -3.4; z <= 3.45; z += 0.85) {
    const X = +x.toFixed(2), Z = +z.toFixed(2);
    if (edgeDist(X, Z) < 0.75) continue;
    if (inRect(X, Z, SINK, 0.35)) continue;
    if (OCCUPIED.some((r) => inRect(X, Z, r))) continue;
    const y = heightAt(X, Z);
    const onBoardTop = inRect(X, Z, { x0: BOARD.x0 + BOARD.inset, x1: BOARD.x1 - BOARD.inset, z0: BOARD.z0 + BOARD.inset, z1: BOARD.z1 - BOARD.inset });
    const onStoveTop = inRect(X, Z, { x0: STOVE.x0 + STOVE.inset, x1: STOVE.x1 - STOVE.inset, z0: STOVE.z0, z1: STOVE.z1 - STOVE.inset });
    const slope = (inRect(X, Z, BOARD) && !onBoardTop) || (inRect(X, Z, STOVE) && !onStoveTop);
    if (slope) continue;
    out.push([X, Z, +y.toFixed(2), onBoardTop ? 'board' : onStoveTop ? 'stove' : 'counter']);
  }
  return out;
})();
export const STAMPEDE_LANES = [{ c: -1.7, hw: 0.75 }, { c: -0.1, hw: 0.75 }, { c: 1.55, hw: 0.75 }, { c: 3.1, hw: 0.7 }];
