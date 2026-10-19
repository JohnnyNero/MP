// Board markers shared by every map: four little coloured pegs per space (one per bean, on the spaces it can reach
// this turn), a bobbing arrow over the spaces its roll ends on, and the star floating over its space.
//   const M = createMarkers({ THREE, root, anchors, setSpaceColor });  M.show(i, ids, ends); M.clear(); M.star(id); M.update(dt)
// anchors[id] is an Object3D on each space's top surface (a moving space, like the ship's deck, carries its pegs along).
// setSpaceColor(id, color | null) recolours a space (the star's space turns gold).
const COLORS = ['#ef5a4f', '#3f86e8', '#43b65a', '#f2b51c'];
const PEG_AT = [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]];

export function createMarkers({ THREE, root, anchors, setSpaceColor }) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, metalness: 0, ...o });
  const pegGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.12, 12);
  const pegMats = COLORS.map((c) => std(c, { emissive: c, emissiveIntensity: 0.35 }));
  const pegs = anchors.map((a) => PEG_AT.map(([dx, dz], i) => { const m = new THREE.Mesh(pegGeo, pegMats[i]); m.position.set(dx, 0.06, dz); m.visible = false; a.add(m); return m; }));
  const arrowGeo = new THREE.ConeGeometry(0.22, 0.5, 16).rotateX(Math.PI);
  const arrows = COLORS.map((c) => [0, 1].map(() => { const m = new THREE.Mesh(arrowGeo, std(c, { emissive: c, emissiveIntensity: 0.4 })); m.visible = false; m.castShadow = true; root.add(m); return m; }));
  const shape = new THREE.Shape();
  for (let k = 0; k < 10; k++) { const r = k % 2 ? 0.2 : 0.46, a = Math.PI / 2 + k * Math.PI / 5; (k ? shape.lineTo : shape.moveTo).call(shape, r * Math.cos(a), r * Math.sin(a)); }
  shape.closePath();
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 }).center(), std('#f2c335', { emissive: '#f2a01a', emissiveIntensity: 0.35, roughness: 0.7 }));
  star.castShadow = true; root.add(star);
  const st = { t: 0, starAt: null, arrowAt: [[], [], [], []] };
  const W = new THREE.Vector3();
  const M = {
    // ids: spaces bean i can end on this turn (pegs); ends: where its roll ends (arrows); null clears bean i
    show(i, ids, ends = []) {
      for (const row of pegs) row[i].visible = false;
      for (const a of arrows[i]) a.visible = false;
      st.arrowAt[i] = [];
      if (!ids) return;
      for (const id of ids) pegs[id][i].visible = true;
      st.arrowAt[i] = ends.slice(0, 2); st.arrowAt[i].forEach((id, k) => { arrows[i][k].visible = true; });
    },
    clear() { for (let i = 0; i < 4; i++) M.show(i, null); },
    star(id) {
      if (st.starAt != null) setSpaceColor(st.starAt, null);
      st.starAt = id; setSpaceColor(id, '#f2c335');
    },
    get starAt() { return st.starAt; },
    update(dt) {
      st.t += dt; const t = st.t;
      if (st.starAt != null) { anchors[st.starAt].getWorldPosition(W); star.position.set(W.x, W.y + 1.25 + 0.12 * Math.sin(t * 2.2), W.z); star.rotation.y = t * 1.6; }
      for (let i = 0; i < 4; i++) st.arrowAt[i].forEach((id, k) => { anchors[id].getWorldPosition(W); arrows[i][k].position.set(W.x + (i % 2 ? 0.18 : -0.18), W.y + 1.45 + 0.15 * Math.sin(t * 5 + i), W.z + (i < 2 ? -0.18 : 0.18)); });
    },
  };
  return M;
}
