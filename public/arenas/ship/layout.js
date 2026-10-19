// Sinking Ship layout in ship space (the arena's local frame): x along the keel (bow at -x, stern at +x), z across,
// y up, main deck surface y = 0. Plain data + surface functions, so tests and the page share them.
export const DECK_Y = 0;             // main deck surface
export const STERN_Y = 1.8;          // stern (poop) deck surface
export const CABIN_X = 3.45;         // cabin front wall (under the stern deck)
export const BOW_X = -5.0;           // planked deck starts here; solid foredeck wedge forward to BOW_TIP
export const BOW_TIP = -8.6;
export const STERN_X = 7.2;
export const HALF_W = 3.0;           // planked half-width
export const RAMP = { x0: -0.6, x1: 3.55, z0: 2.08, z1: 2.92 };   // ramp up to the stern deck along the +z rail
export const KILL_Y = -6;            // world y: below this you're out (you normally drown first)
const H = Math.PI / 2;
export const PIECES = [
  { def: 'deck_main', pos: [0, -0.57, 0] },
  { def: 'deck_aft', pos: [0, -0.57, 0] },
  { def: 'deck_stern', pos: [0, 1.48, 0] },
  { def: 'mast_fore', pos: [-3.2, 0, 0], mast: true, top: 6.2 },
  { def: 'mast_main', pos: [0.6, 0, 0], mast: true, top: 7.8 },
  { def: 'cabin_wall', pos: [CABIN_X, 0, 0] },
  { def: 'rail_28', pos: [-5.0, 0, -2.94] }, { def: 'rail_28', pos: [-2.15, 0, -2.94] }, { def: 'rail_28', pos: [0.7, 0, -2.94] },
  { def: 'rail_28', pos: [-5.0, 0, 2.94] }, { def: 'rail_28', pos: [-2.15, 0, 2.94] }, { def: 'rail_28', pos: [0.7, 0, 2.94] },
  { def: 'rail_36', pos: [3.58, STERN_Y, -2.94] }, { def: 'rail_36', pos: [3.58, STERN_Y, 2.94] },
  { def: 'rail_60', pos: [7.1, STERN_Y, -3.0], rotY: -H },
  { def: 'rail_49', pos: [3.62, STERN_Y, -3.0], rotY: -H },
];
// loose cargo (destructible, dynamic): hollow crates and barrels, light enough to carry and throw
export const PROPS = [
  { def: 'crate', pos: [2.5, 0, -2.2], rotY: 0.3 }, { def: 'crate', pos: [-1.6, 0, 2.3], rotY: -0.2 },
  { def: 'crate', pos: [-6.2, 0, -0.9], rotY: 0.7 }, { def: 'crate', pos: [5.6, STERN_Y, 2.1], rotY: 0.1 },
  { def: 'barrel', pos: [-1.2, 0, -2.3] }, { def: 'barrel', pos: [-6.4, 0, 0.6] }, { def: 'barrel', pos: [6.3, STERN_Y, -2.2] },
];
export const SPAWNS = [[-4.3, 0.8, -1.3], [-4.3, 0.8, 1.3], [1.9, 0.8, -1.2], [2.0, 0.8, 0.9]];
// walkable points [x, z, y, tag] (deck | stern | cabin | bow)
export const POINTS = (() => {
  const out = [];
  for (let x = -6.6; x <= 3.0; x += 1.2) for (let z = -2.3; z <= 2.31; z += 1.15) {
    if (x < BOW_X && Math.abs(z) > (x - BOW_TIP) * 0.62) continue;           // outside the bow wedge
    if (x > RAMP.x0 - 0.3 && z > RAMP.z0 - 0.25) continue;                    // on the ramp
    out.push([+x.toFixed(2), +z.toFixed(2), DECK_Y, x < BOW_X ? 'bow' : 'deck']);
  }
  for (let x = 4.2; x <= 6.7; x += 1.2) for (let z = -2.2; z <= 2.21; z += 1.1) out.push([+x.toFixed(2), +z.toFixed(2), STERN_Y, 'stern']);
  for (const [x, z] of [[4.4, -1.6], [5.6, -0.6], [5.6, 0.8], [4.4, 1.2], [6.6, -1.8]]) out.push([x, z, DECK_Y, 'cabin']);
  return out;
})();
// deck height under (x, z) in ship space (the cabin floor is the main deck; the stern deck is its roof)
export function heightAt(x, z, fromY = 0) {
  if (x > RAMP.x0 && x < RAMP.x1 && z > RAMP.z0 && z < RAMP.z1) return STERN_Y * (x - RAMP.x0) / (RAMP.x1 - RAMP.x0);
  if (x > CABIN_X && fromY > 1.0) return STERN_Y;
  return DECK_Y;
}
export const onShip = (x, z) => x > BOW_TIP && x < 7.44 && Math.abs(z) < (x < BOW_X ? Math.max(0, (x - BOW_TIP) / (BOW_X - BOW_TIP)) * 3.1 : 3.1);
// distance to the side of the ship (a drop into the sea once the rails are gone; bots keep off it)
export function edgeDist(x, z) {
  const side = HALF_W - Math.abs(z);
  const bow = x < BOW_X ? (x - BOW_TIP) * 0.85 - Math.abs(z) * 0.6 : 9;
  return Math.min(side, bow, 7.3 - x);
}
// ledges to hang off and climb back up (ship space [x0, y0, z0, x1, y1, z1]): the stern deck's front lip, the stern
// castle's side tops and transom, and the hull's top edge outside the main-deck rails
export const LEDGES = [
  [CABIN_X - 0.02, STERN_Y, -2.85, CABIN_X - 0.02, STERN_Y, RAMP.z0 - 0.1],
  [3.5, 2.05, 3.3, 7.4, 2.05, 3.3], [3.5, 2.05, -3.3, 7.4, 2.05, -3.3],
  [7.6, 2.05, -3.2, 7.6, 2.05, 3.2],
  [BOW_X, 0.12, 3.24, 3.4, 0.12, 3.24], [BOW_X, 0.12, -3.24, 3.4, 0.12, -3.24],
];
// barrels rolling across the deck (rail to rail and over the side): lanes along x, between the masts
export const STAMPEDE_LANES = [{ c: -4.4, hw: 0.7 }, { c: -1.6, hw: 0.7 }, { c: 2.2, hw: 0.7 }];
