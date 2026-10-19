// Giant Kitchen destructible pieces for the fracture bake. Piece-local: y up, y=0 is the base, arena units
// (players are ~1.16 tall). Placement on the counter happens at runtime (kitchen/layout.js).
//   node tools/bake/bake.mjs --defs tools/bake/defs/kitchen_defs.mjs --name kitchenpieces --out public/arenas/kitchen
export function pieces({ box, cyl, prism }) {
  const P = {};
  const noAnchor = { anchor: false };
  // cereal boxes: coloured body + cream top band; cardboard breaks into big 2.5D chunks
  for (const c of ['red', 'yellow', 'blue']) {
    P['cereal_' + c] = [
      box('body', 'card_' + c, [-0.95, 0, -0.35], [0.95, 2.05, 0.35], { count: 4, mode: '2.5D', axis: 'z' }, noAnchor),
      box('band', 'card_cream', [-0.95, 2.05, -0.35], [0.95, 2.7, 0.35], { count: 2, mode: '2.5D', axis: 'z' }, noAnchor),
    ];
  }
  // tall thin domino boxes (cracker boxes), one def per colour (colour is baked into vertex colours)
  for (const c of ['green', 'blue', 'red', 'yellow']) P['domino_' + c] = [box('box', 'card_' + c, [-0.18, 0, -0.7], [0.18, 2.6, 0.7], { count: 3, mode: '2.5D', axis: 'x' }, noAnchor)];
  // stack of 4 plates, weakly bonded to each other; porcelain shatters
  P.plate_stack = [0, 1, 2, 3].map((i) => cyl('plate' + i, i % 2 ? 'porcelain_blue' : 'porcelain', [0, i * 0.13, 0], 0.95, 0.13, { count: 5, mode: '2.5D', axis: 'y' }, { anchor: false, interBond: 0.15 }));
  // mug: octagonal wall ring around a cocoa core, with a handle on +x
  {
    const N = 8, ri = 0.52, ro = 0.66, H = 1.15, HC = 0.98;
    const at = (r, k) => { const a = (k + 0.5) * Math.PI * 2 / N; return [r * Math.cos(a), r * Math.sin(a)]; };
    const m = [];
    // prism() wants counter-clockwise points seen from +y; angle a runs from +x toward +z, which is clockwise from above, so reverse
    m.push(prism('core', 'cocoa', Array.from({ length: N }, (_, k) => at(ri, N - 1 - k)), 0, HC, { count: 3, mode: '3D' }, noAnchor));
    for (let k = 0; k < N; k++) m.push(prism('wall' + k, 'mug_red', [at(ri, k + 1), at(ro, k + 1), at(ro, k), at(ri, k)], 0, H, { count: 2, mode: '3D' }, noAnchor));
    const a = ro * Math.cos(Math.PI / N);
    m.push(box('hTop', 'mug_red', [a, 0.72, -0.08], [a + 0.32, 0.88, 0.08], { count: 1 }, noAnchor));
    m.push(box('hBot', 'mug_red', [a, 0.22, -0.08], [a + 0.32, 0.38, 0.08], { count: 1 }, noAnchor));
    m.push(box('hBar', 'mug_red', [a + 0.32, 0.22, -0.08], [a + 0.46, 0.88, 0.08], { count: 1 }, noAnchor));
    P.mug = m;
  }
  // jars: translucent jam / honey core and a tin lid; glass shatters
  for (const k of ['jam', 'honey']) {
    P['jar_' + k] = [
      cyl('glass', 'jar_' + k, [0, 0, 0], 0.5, 1.15, { count: 6, mode: '3D' }, noAnchor),
      cyl('lid', 'jar_lid', [0, 1.15, 0], 0.5, 0.16, { count: 1 }, noAnchor),
    ];
  }
  // toaster (anchored on four feet): enamel body, chrome top plate and lever. Heavy obstacle, dents under stomps.
  {
    const t = [];
    for (const [x, z] of [[-1.15, -0.55], [1.15, -0.55], [-1.15, 0.55], [1.15, 0.55]]) t.push(box('foot' + t.length, 'chrome', [x - 0.15, 0, z - 0.12], [x + 0.15, 0.1, z + 0.12], { count: 1 }));
    t.push(box('body', 'enamel', [-1.4, 0.1, -0.75], [1.4, 1.9, 0.75], { count: 6, mode: '2.5D', axis: 'z' }));
    t.push(box('top', 'chrome', [-1.4, 1.9, -0.75], [1.4, 2.0, 0.75], { count: 2, mode: '2.5D', axis: 'y' }));
    t.push(box('lever', 'chrome', [1.4, 1.1, -0.16], [1.6, 1.3, 0.16], { count: 1 }));
    P.toaster = t;
  }
  return P;
}
