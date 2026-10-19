// Space Station (Cargo Bay) layout, arena space: x across the bay (left -> right), z toward the camera (back wall at
// z = -5.5, the blown-open bay door along z = +5.5), y up, deck at y = 0. Players are ~1.16 tall.
// Plain data + surface functions, so tests and the page share them.
export const BAY = { x0: -11, x1: 11, z0: -5.5, z1: 5.5, y: 0, thick: 0.6, wallH: 7 };
export const KILL_Y = -3;                // drift this far below the deck and you're out
export const CATWALK = { x0: -11, x1: 11, z0: -5.5, z1: -3.6, y: 2.2, t: 0.25 };
// ramps up to the catwalk at both ends: base at z = z1 (deck), top at z = z0 (catwalk height)
export const RAMPS = [{ x0: -11, x1: -8.8, z0: -3.6, z1: 1.4 }, { x0: 8.8, x1: 11, z0: -3.6, z1: 1.4 }];
// the freight lift: a block in a shaft whose top travels between the deck and catwalk height
export const LIFT = { x0: -1.5, x1: 1.5, z0: -1.0, z1: 2.0, top: 2.2, down: 6, rise: 2.5, up: 6, lower: 2.5 };
export const PILLARS = [-8, -4, 0, 4, 8].map((x) => ({ x, z: -3.8, r: 0.18 }));
// grab rails (players hold on through decompression): under the catwalk on the back wall, and on both side walls
export const RAIL_Y = 0.9;
export const RAILS = [
  { a: [-8.2, RAIL_Y, -5.35], b: [8.2, RAIL_Y, -5.35], n: [0, -1] },
  { a: [-10.85, RAIL_Y, 1.8], b: [-10.85, RAIL_Y, 4.8], n: [-1, 0] },
  { a: [10.85, RAIL_Y, 1.8], b: [10.85, RAIL_Y, 4.8], n: [1, 0] },
];
export const PIECES = [
  { name: 'crateA', def: 'crate', pos: [-6.2, 0, 1.4] }, { name: 'crateA2', def: 'crate', pos: [-6.2, 1.2, 1.4] },
  { name: 'crateB', def: 'crate', pos: [-4.9, 0, 1.6], rotY: 0.3 },
  { name: 'crateC', def: 'crate', pos: [5.2, 0, -1.6] }, { name: 'crateC2', def: 'crate', pos: [5.2, 1.2, -1.6], rotY: 0.2 },
  { name: 'crateD', def: 'crate', pos: [-2.6, 0, 3.4], rotY: -0.25 },
  { name: 'crateE', def: 'crate', pos: [3.4, 2.2, -4.6] },
  { name: 'podO', def: 'pod_orange', pos: [6.4, 0, 2.6], rotY: 0.15 },
  { name: 'podT', def: 'pod_teal', pos: [-5.6, 0, -2.0] },
];
export const SPAWNS = [[-6.8, 1.4, -0.4], [-2.6, 1.4, 0.4], [3.0, 1.4, 0.6], [7.2, 1.4, -0.2]];

const inRect = (x, z, r, m = 0) => x > r.x0 - m && x < r.x1 + m && z > r.z0 - m && z < r.z1 + m;
export const inBay = (x, z) => x > BAY.x0 && x < BAY.x1 && z > BAY.z0 && z < BAY.z1;
export const onRamp = (x, z) => RAMPS.find((r) => inRect(x, z, r)) || null;
export const rampY = (r, z) => CATWALK.y * Math.max(0, Math.min(1, (r.z1 - z) / (r.z1 - r.z0)));
export const inLift = (x, z, m = 0) => inRect(x, z, LIFT, m);
// top surface (catwalk wins over the deck under it; the lift reads as deck height for hazards)
export function heightAt(x, z) {
  if (!inBay(x, z)) return -1e9;
  const r = onRamp(x, z); if (r) return rampY(r, z);
  if (z < CATWALK.z1) return CATWALK.y;
  return 0;
}
// distance to a drop: only the open bay door at the front
export const edgeDist = (x, z) => BAY.z1 - z;
export const OBSTACLES = [
  { x0: LIFT.x0 - 0.2, x1: LIFT.x1 + 0.2, z0: LIFT.z0 - 0.2, z1: LIFT.z1 + 0.2 },
  { x0: -6.9, x1: -4.2, z0: 0.7, z1: 2.3 },              // crate stack A + B
  { x0: 4.5, x1: 5.9, z0: -2.3, z1: -0.9 },              // crate stack C
  { x0: -3.3, x1: -1.9, z0: 2.7, z1: 4.1 },              // crate D
  { x0: 4.8, x1: 8.0, z0: 1.8, z1: 3.4 },                // orange pod
  { x0: -7.2, x1: -4.0, z0: -2.8, z1: -1.2 },            // teal pod
];
// walkable points [x, z, y, tag] for hazards and bots; tags: deck, catwalk, under (beneath the catwalk), rail (beside one)
export const POINTS = (() => {
  const out = [];
  for (let x = -10.2; x <= 10.25; x += 0.9) for (let z = -5.0; z <= 4.85; z += 0.85) {
    const X = +x.toFixed(2), Z = +z.toFixed(2);
    if (edgeDist(X, Z) < 0.75) continue;
    if (onRamp(X, Z) || RAMPS.some((r) => inRect(X, Z, r, 0.25))) continue;
    if (OBSTACLES.some((r) => inRect(X, Z, r))) continue;
    if (PILLARS.some((p) => Math.hypot(X - p.x, Z - p.z) < 0.6)) continue;
    if (Z < CATWALK.z1) {
      if (Z > CATWALK.z1 - 0.35) continue;                                       // catwalk lip / under its edge
      out.push([X, Z, CATWALK.y, 'catwalk']);
      out.push([X, Z, 0, Z < -4.7 && Math.abs(X) < 8 ? 'rail' : 'under']);
      continue;
    }
    out.push([X, Z, 0, Math.abs(X) > 9.9 && Z > 1.8 ? 'rail' : 'deck']);
  }
  return out;
})();
// lanes for runaway cargo (along x): mid deck and the front strip (never the catwalk zone)
export const CARGO_LANES = [{ c: -2.3, hw: 0.75 }, { c: 2.9, hw: 0.7 }, { c: 4.5, hw: 0.6 }];
