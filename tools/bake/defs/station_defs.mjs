// Space Station (Cargo Bay) destructible pieces for the fracture bake. Piece-local: y up, y=0 is the base, arena units
// (players are ~1.16 tall). Placement happens at runtime (station/layout.js).
//   node tools/bake/bake.mjs --defs tools/bake/defs/station_defs.mjs --name stationpieces --out public/arenas/station
export function pieces({ box }) {
  const P = {};
  const noAnchor = { anchor: false };
  // wooden supply crate with darker banding top and bottom
  P.crate = [
    box('body', 'crate', [-0.6, 0.12, -0.6], [0.6, 1.08, 0.6], { count: 4, mode: '2.5D', axis: 'z' }, noAnchor),
    box('base', 'wood', [-0.62, 0, -0.62], [0.62, 0.12, 0.62], { count: 2, mode: '2.5D', axis: 'y' }, noAnchor),
    box('lid', 'wood', [-0.62, 1.08, -0.62], [0.62, 1.2, 0.62], { count: 2, mode: '2.5D', axis: 'y' }, noAnchor),
  ];
  // cargo pods: long painted shells, one def per colour
  for (const c of ['orange', 'teal']) {
    P['pod_' + c] = [
      box('shell', 'cargo_' + c, [-1.5, 0.1, -0.7], [1.5, 1.4, 0.7], { count: 6, mode: '2.5D', axis: 'z' }, noAnchor),
      box('skid0', 'console_grey', [-1.4, 0, -0.62], [1.4, 0.1, -0.42], { count: 1 }, noAnchor),
      box('skid1', 'console_grey', [-1.4, 0, 0.42], [1.4, 0.1, 0.62], { count: 1 }, noAnchor),
    ];
  }
  // control console (anchored): a desk body and a glass screen that shatters
  P.console = [
    box('desk', 'console_grey', [-1.0, 0, -0.45], [1.0, 1.0, 0.45], { count: 3, mode: '2.5D', axis: 'z' }),
    box('screen', 'screen', [-0.85, 1.0, -0.3], [0.85, 1.8, -0.18], { count: 5, mode: '2.5D', axis: 'z' }),
  ];
  return P;
}
