// Pirate Cove: the shape of the place (pure data, no THREE). A small island ringed by sea, a lagoon in its middle, a
// shipwreck beached at the back left, a cliff fort at the back right, a rope-and-plank bridge between the two, a pier
// at the front. The board is threaded through it: a ring of spaces on the sand around the lagoon, stepping stones
// across the lagoon (the shortcut), and a high road up the fort, over the bridge and through the wreck.
// Local frame = world. z+ faces the camera. y = 0 is the dry sand; the sea rests at WATER_Y.
export const WATER_Y = -0.5;
export const SEABED_Y = -2.6;
export const KILL_Y = -5;

// ---------------------------------------------------------------- terrain
export const ISLAND = { cz: -0.3, rx: 7.2, rz: 5.0, plateau: 0.86, shore: 1.16 };      // ellipse; sand to r = plateau, beach slope to shore
export const LAGOON = { cx: 0, cz: 0.7, rx: 2.9, rz: 1.45, floor: -1.3 };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const islandR = (x, z) => Math.hypot(x / ISLAND.rx, (z - ISLAND.cz) / ISLAND.rz);
export const lagoonR = (x, z) => Math.hypot((x - LAGOON.cx) / LAGOON.rx, (z - LAGOON.cz) / LAGOON.rz);
// the ground itself (sand, beach, seabed, lagoon basin); structures come on top
export function terrainH(x, z) {
  const r = islandR(x, z);
  let h = SEABED_Y + (0 - SEABED_Y) * (1 - smooth(ISLAND.plateau, ISLAND.shore, r));
  const lr = lagoonR(x, z);
  if (lr < 1.15) h = Math.min(h, LAGOON.floor + (h - LAGOON.floor) * smooth(0.82, 1.08, lr));
  return h;
}

// ---------------------------------------------------------------- structures (static)
export const PIER = { x0: -0.8, x1: 0.8, z0: 3.5, z1: 6.4, y: 0.3 };
export const FORT = { x0: 2.7, x1: 6.5, z0: -5.0, z1: -2.3, y: 1.5 };
// ramps rise from y0 at a0 to y1 at a1 along their axis (solid wedges down to `base`)
export const FORT_RAMP = { axis: 'z', x0: 5.0, x1: 6.3, a0: 1.0, a1: FORT.z1, y0: 0, y1: FORT.y, base: SEABED_Y };
export const BRIDGE = { axis: 'x', z0: -3.9, z1: -3.0, a0: -2.6, a1: FORT.x0, y0: 0.8, y1: FORT.y, thick: 0.16 };
export const STONES = [[0, 1.75], [0, 0.7], [0, -0.35]].map(([x, z]) => ({ x, z, r: 0.5, y: 0.05 }));

// ---------------------------------------------------------------- the wreck (one rigid thing: it floats in the flood)
// Ship-local coordinates are relative to SHIP.origin; at rest the ship sits beached with its deck at y = 0.8.
export const SHIP = {
  origin: [-4.6, 0, -3.5],
  hull: { x0: -2.0, x1: 2.0, y0: -2.0, y1: 0.8, z0: -1.2, z1: 1.2 },          // deck top at y 0.8
  castle: { x0: -2.0, x1: -0.6, y0: 0.8, y1: 1.6, z0: -1.2, z1: 1.2 },       // the stern castle: the captain's deck (the hill)
  castleRamp: { axis: 'x', z0: -1.2, z1: -0.2, a0: 1.0, a1: -0.6, y0: 0.8, y1: 1.6, base: 0.8 },
  plank: { axis: 'z', x0: 0.6, x1: 1.4, a0: 3.2, a1: 1.2, y0: 0, y1: 0.8, thick: 0.12 },   // the gangplank down to the beach
  mast: { x: 0.0, z: -0.75, r: 0.16, h: 5.2 },
  floatAt: 0.15,              // the flood lifts the ship once the water passes this height
};
export const shipToWorld = ([x, y, z], lift = 0) => [x + SHIP.origin[0], y + SHIP.origin[1] + lift, z + SHIP.origin[2]];
const inBox = (b, x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
export function rampHeight(r, x, z) {
  const [u, v, c0, c1] = r.axis === 'z' ? [z, x, r.x0, r.x1] : [x, z, r.z0, r.z1];
  if (v < c0 || v > c1) return null;
  if (u < Math.min(r.a0, r.a1) || u > Math.max(r.a0, r.a1)) return null;
  return r.y0 + (r.y1 - r.y0) * (u - r.a0) / (r.a1 - r.a0);
}
// the ship's walkable height at rest (world x, z), or null off it
export function shipHeight(x, z) {
  const lx = x - SHIP.origin[0], lz = z - SHIP.origin[2];
  let h = null;
  const S = SHIP;
  if (inBox(S.hull, lx, lz)) h = S.hull.y1;
  if (inBox(S.castle, lx, lz)) h = S.castle.y1;
  for (const r of [S.castleRamp, S.plank]) { const y = rampHeight(r, lx, lz); if (y != null) h = Math.max(h ?? -Infinity, y); }
  return h;
}
// the top walkable height at (x, z): ground, structures, the ship at rest
export function heightAt(x, z) {
  let h = terrainH(x, z);
  if (inBox(PIER, x, z)) h = Math.max(h, PIER.y);
  if (inBox(FORT, x, z)) h = Math.max(h, FORT.y);
  for (const r of [FORT_RAMP, BRIDGE]) { const y = rampHeight(r, x, z); if (y != null) h = Math.max(h, y); }
  for (const s of STONES) if (Math.hypot(x - s.x, z - s.z) < s.r) h = Math.max(h, s.y);
  const sh = shipHeight(x, z); if (sh != null) h = Math.max(h, sh);
  return h;
}
export const BOUNDS = { x0: -9.5, x1: 9.5, z0: -7.5, z1: 8 };
export const inBounds = (x, z) => x >= BOUNDS.x0 && x <= BOUNDS.x1 && z >= BOUNDS.z0 && z <= BOUNDS.z1;
export const isDry = (x, z) => heightAt(x, z) > WATER_Y + 0.12;

// distance to a drop the bots should respect: the waterline, and the rims of the fort, the castle and the bridge
const STEP = 0.25, GX0 = BOUNDS.x0, GZ0 = BOUNDS.z0, GW = Math.round((BOUNDS.x1 - BOUNDS.x0) / STEP) + 1, GH = Math.round((BOUNDS.z1 - BOUNDS.z0) / STEP) + 1;
const COAST = (() => {           // chamfer distance transform from every wet cell
  const d = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) d[j * GW + i] = isDry(GX0 + i * STEP, GZ0 + j * STEP) ? 1e6 : 0;
  const a = STEP, b = STEP * Math.SQRT2;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const k = j * GW + i; let v = d[k]; if (i) v = Math.min(v, d[k - 1] + a); if (j) { v = Math.min(v, d[k - GW] + a); if (i) v = Math.min(v, d[k - GW - 1] + b); if (i < GW - 1) v = Math.min(v, d[k - GW + 1] + b); } d[k] = v; }
  for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) { const k = j * GW + i; let v = d[k]; if (i < GW - 1) v = Math.min(v, d[k + 1] + a); if (j < GH - 1) { v = Math.min(v, d[k + GW] + a); if (i < GW - 1) v = Math.min(v, d[k + GW + 1] + b); if (i) v = Math.min(v, d[k + GW - 1] + b); } d[k] = v; }
  return d;
})();
export function edgeDist(x, z) {
  const i = Math.max(0, Math.min(GW - 1, Math.round((x - GX0) / STEP))), j = Math.max(0, Math.min(GH - 1, Math.round((z - GZ0) / STEP)));
  let e = COAST[j * GW + i];
  const rim = (b, open = {}) => { if (!inBox(b, x, z)) return; e = Math.min(e, open.x0 ? 9 : x - b.x0, open.x1 ? 9 : b.x1 - x, open.z0 ? 9 : z - b.z0, open.z1 ? 9 : b.z1 - z); };
  rim(FORT, { x0: false });
  const lx = x - SHIP.origin[0], lz = z - SHIP.origin[2];
  if (inBox(SHIP.castle, lx, lz)) e = Math.min(e, lx - SHIP.castle.x0 + 0.5, SHIP.castle.x1 - lx + 0.5, lz - SHIP.castle.z0 + 0.5, SHIP.castle.z1 - lz + 0.5);
  if (x > BRIDGE.a0 && x < BRIDGE.a1 && z > BRIDGE.z0 - 0.3 && z < BRIDGE.z1 + 0.3) e = Math.min(e, Math.max(0.35, Math.min(z - BRIDGE.z0, BRIDGE.z1 - z) + 0.3));
  return e;
}

// ---------------------------------------------------------------- the board threaded through it
// kind: blue +coins, red -coins, chest (bigger +coins: the high road's reward). next: forward links.
const S = (id, x, z, kind = 'blue', next = null, y = null) => ({ id, x, z, y: y ?? heightAt(x, z), kind, next: next || [], tag: '' });
export const SPACES = [
  // the ring on the sand around the lagoon (0..11)
  S(0, 0, 3.3), S(1, 2.3, 3.0), S(2, 4.3, 2.2, 'red'), S(3, 4.4, 0.6), S(4, 3.9, -1.45), S(5, 1.9, -1.5, 'red'),
  S(6, 0, -1.55), S(7, -1.9, -1.5), S(8, -3.6, 0.35), S(9, -5.5, 0.9, 'red'), S(10, -4.4, 2.3), S(11, -2.3, 3.0),
  // the stepping stones (12, 13): the shortcut across the lagoon
  S(12, 0, 1.75), S(13, 0, -0.35, 'red'),
  // the high road (14..18): up the fort ramp, the fort top, over the bridge, onto the wreck's deck
  S(14, 5.65, -0.6), S(15, 4.6, -3.6, 'chest'), S(16, 1.2, -3.45), S(17, -1.3, -3.45, 'red'), S(18, -3.4, -2.95, 'chest'),
];
for (let i = 0; i < 12; i++) SPACES[i].next = [(i + 1) % 12];
SPACES[0].next = [1, 12]; SPACES[12].next = [13]; SPACES[13].next = [6];
SPACES[3].next = [4, 14]; SPACES[14].next = [15]; SPACES[15].next = [16]; SPACES[16].next = [17]; SPACES[17].next = [18]; SPACES[18].next = [8];
for (const id of [12, 13]) SPACES[id].tag = 'stone';
for (const id of [16, 17]) SPACES[id].tag = 'bridge';
SPACES[18].tag = 'ship'; SPACES[15].tag = 'fort';
export const START = 0;

// the captain's deck (the stern castle top) is the hill
export const HILL = (() => { const c = SHIP.castle; const [x0, y, z0] = shipToWorld([c.x0, c.y1, c.z0]); const [x1, , z1] = shipToWorld([c.x1, c.y1, c.z1]); return { x0, x1, z0, z1, y }; })();

// bot waypoints: every space, plus the castle's ramp foot and the hill
export const WAYPOINTS = [
  ...SPACES.map((s) => ({ id: 's' + s.id, x: s.x, z: s.z, y: s.y })),
  { id: 'castleFoot', ...(([x, y, z]) => ({ x, y, z }))(shipToWorld([1.3, 0.8, -0.7])) },
  { id: 'hill', x: (HILL.x0 + HILL.x1) / 2, z: (HILL.z0 + HILL.z1) / 2, y: HILL.y },
];
export const LINKS = [
  ...SPACES.flatMap((s) => s.next.map((n) => ['s' + s.id, 's' + n, 0])),
  ['s18', 'castleFoot', 0], ['castleFoot', 'hill', 0], ['s8', 's18', 0],
];

// grab-and-climb edges: the fort's front and left, the castle front, the pier's sides, the deck's front edge
export const LEDGES = [
  [FORT.x0, FORT.y, FORT.z1, FORT_RAMP.x0, FORT.y, FORT.z1], [FORT.x0, FORT.y, FORT.z0, FORT.x0, FORT.y, BRIDGE.z0], [FORT.x0, FORT.y, BRIDGE.z1, FORT.x0, FORT.y, FORT.z1],
  [PIER.x0, PIER.y, PIER.z0, PIER.x0, PIER.y, PIER.z1], [PIER.x1, PIER.y, PIER.z0, PIER.x1, PIER.y, PIER.z1],
];
// ship ledges are ship-local (they move with it)
export const SHIP_LEDGES = [
  [SHIP.castle.x1, SHIP.castle.y1, -0.2, SHIP.castle.x1, SHIP.castle.y1, SHIP.castle.z1],
  [SHIP.hull.x0, SHIP.hull.y1, SHIP.hull.z1, SHIP.plank.x0, SHIP.hull.y1, SHIP.hull.z1], [SHIP.plank.x1, SHIP.hull.y1, SHIP.hull.z1, SHIP.hull.x1, SHIP.hull.y1, SHIP.hull.z1],
];

// walkable points (bots, hazards): a 0.6 m grid over the dry island and the structures, tagged
export const POINTS = (() => {
  const out = [];
  for (let x = -8; x <= 8; x += 0.6) for (let z = -6; z <= 6.6; z += 0.6) {
    const y = heightAt(x, z); if (!(y > WATER_Y + 0.15)) continue;
    const tag = shipHeight(x, z) != null && Math.abs(shipHeight(x, z) - y) < 0.01 ? 'ship' : inBox(FORT, x, z) ? 'fort' : inBox(PIER, x, z) ? 'pier' : y > 0.4 ? 'high' : 'sand';
    out.push([+x.toFixed(2), +z.toFixed(2), +y.toFixed(3), tag]);
  }
  return out;
})();

// everyone starts on the pier
export const SPAWNS = [[-0.4, 1.0, 4.3], [0.4, 1.0, 4.3], [-0.4, 1.0, 5.1], [0.4, 1.0, 5.1]];
