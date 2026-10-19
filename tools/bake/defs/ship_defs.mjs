// Ship arena pieces for the destruction bake. Piece-local: y up, y=0 is the anchor base, metres.
// Placement in ship space is done at runtime by main.js (SHIP_LAYOUT).
export function shipPieces({ box, cyl }) {
  const P = {};
  // deck: hull-material beams (anchored) under plank runs sliced along x
  function deck(x0, x1, z0, z1, beamH, nBeams, nPlanks, slices) {
    const parts = [];
    const step = (x1 - x0 - 0.24) / (nBeams - 1);
    for (let i = 0; i < nBeams; i++) { const x = x0 + 0.12 + i * step; parts.push(box('beam' + i, 'hull', [x - 0.12, 0, z0], [x + 0.12, beamH, z1], { count: 4, mode: 'slices', axis: 'z' })); }
    const w = (z1 - z0) / nPlanks;
    for (let i = 0; i < nPlanks; i++) parts.push(box('plank' + i, 'hull', [x0, beamH, z0 + i * w + 0.008], [x1, beamH + 0.12, z0 + (i + 1) * w - 0.008], { count: slices, mode: 'slices', axis: 'x' }));
    return parts;
  }
  P.deck_main = deck(-5.0, 3.5, -3.0, 3.0, 0.45, 7, 10, 5);
  P.deck_aft = deck(3.5, 7.2, -3.0, 3.0, 0.45, 3, 10, 2);
  P.deck_stern = deck(3.55, 7.2, -3.0, 3.0, 0.2, 3, 10, 2);
  // masts: square section (bonds need flat contact faces), sliced along y; main mast carries the crow's nest
  P.mast_fore = [box('mast', 'wood', [-0.17, 0, -0.17], [0.17, 6.2, 0.17], { count: 5, mode: 'slices', axis: 'y' })];
  const mm = [box('mast', 'wood', [-0.19, 0, -0.19], [0.19, 7.8, 0.19], { count: 6, mode: 'slices', axis: 'y' })];
  const y0 = 5.7, y1 = 5.82, R = 0.7, r = 0.19, t = 0.08, rh = 0.42;
  mm.push(box('nestN', 'wood', [-R, y0, r], [R, y1, R], { count: 1 }), box('nestS', 'wood', [-R, y0, -R], [R, y1, -r], { count: 1 }),
    box('nestE', 'wood', [r, y0, -r], [R, y1, r], { count: 1 }), box('nestW', 'wood', [-R, y0, -r], [-r, y1, r], { count: 1 }));
  mm.push(box('rimN', 'wood', [-R, y1, R - t], [R, y1 + rh, R], { count: 1 }), box('rimS', 'wood', [-R, y1, -R], [R, y1 + rh, -R + t], { count: 1 }),
    box('rimE', 'wood', [R - t, y1, -R + t], [R, y1 + rh, R - t], { count: 1 }), box('rimW', 'wood', [-R, y1, -R + t], [-R + t, y1 + rh, R - t], { count: 1 }));
  P.mast_main = mm;
  // rails: posts (sliced in 2) carrying a top rail sliced between posts
  function rail(L, n) {
    const parts = [];
    for (let i = 0; i < n; i++) { const x = 0.06 + i * (L - 0.12) / (n - 1); parts.push(box('post' + i, 'wood', [x - 0.06, 0, -0.06], [x + 0.06, 0.8, 0.06], { count: 2, mode: 'slices', axis: 'y' })); }
    parts.push(box('top', 'wood', [0, 0.8, -0.08], [L, 0.93, 0.08], { count: n - 1, mode: 'slices', axis: 'x' }));
    return parts;
  }
  P.rail_28 = rail(2.8, 4);
  P.rail_36 = rail(3.6, 4);
  P.rail_49 = rail(4.9, 5);
  P.rail_60 = rail(6.0, 6);
  // cabin front wall under the stern deck: two leaves either side of an open doorway
  P.cabin_wall = [
    box('wallL', 'wood', [-0.1, 0, -3.0], [0.1, 1.48, -0.6], { count: 6, mode: '2.5D', axis: 'x' }),
    box('wallR', 'wood', [-0.1, 0, 0.6], [0.1, 1.48, 2.0], { count: 4, mode: '2.5D', axis: 'x' }),
  ];
  // loose props (no anchors -> one dynamic body each)
  P.crate = [box('crate', 'wood', [-0.38, 0, -0.38], [0.38, 0.76, 0.38], { count: 6, mode: '3D' }, { anchor: false })];
  P.barrel = [cyl('barrel', 'wood', [0, 0, 0], 0.3, 0.8, { count: 6, mode: '3D' }, { anchor: false })];
  return P;
}

// generic entry point for tools/bake/bake.mjs --defs
export const pieces = (h) => shipPieces(h);
