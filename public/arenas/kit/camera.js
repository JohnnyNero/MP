// One shared raised three-quarter camera: frames every living player (plus a pull toward the arena centre),
// does the reveal pull-back, and trauma-based shake. Camera-relative sticks read `basis`.
//   const cam = createSharedCamera({ THREE, camera, ...arena.camera });
//   cam.reveal(k)            k in [0,1] during the reveal phase (0 = close, 1 = wide)
//   cam.frame(dt, points)    points: Vector3[] of living players (feet); empty = home framing
//   cam.shake(0..1)          cam.apply(dt)   (after reveal/frame, every rendered frame)
// Default pitch is 35 deg: low enough to see faces and the height of things, high enough to read the whole floor and
// the front drop. `look` raises the look-at point above the players' feet, `zBias` pushes it toward the back wall.
export function createSharedCamera({ THREE, camera, pitchDeg = 35, fov = 38, minDist = 16, maxDist = 30, padX = 2.4, padZ = 1.8, padY = 1.2,
  center = [0, 0, 0], homeSize = [14, 1, 6], centerPull = 0.35, lift = 0.6, zBias = -0.6, revealFrom = 9, revealTo = 28, revealCenter = null, revealLift = null, yMin = -Infinity }) {
  camera.fov = fov; camera.updateProjectionMatrix();
  const PITCH = THREE.MathUtils.degToRad(pitchDeg);
  const dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));
  const basis = { fx: 0, fz: -1, rx: 1, rz: 0 };          // horizontal forward / right of the view (looks down -z)
  const C = new THREE.Vector3(...center);
  const RC = new THREE.Vector3(...(revealCenter || center));
  const target = new THREE.Vector3().copy(C); let dist = (minDist + maxDist) / 2, trauma = 0;
  const bb = new THREE.Box3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tgt = new THREE.Vector3();
  const homeV = new THREE.Vector3(...homeSize);
  const api = {
    basis, pitchDeg, get target() { return target; }, get dist() { return dist; },
    setCenter(v) { C.copy(v); },
    shake(a) { trauma = Math.min(1, trauma + a); },
    reveal(k) {
      const e = 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
      target.copy(RC); target.y += revealLift ?? lift; dist = revealFrom + (revealTo - revealFrom) * e;
    },
    snap() { /* next frame() jumps instead of easing */ api._snap = true; },
    frame(dt, points) {
      bb.makeEmpty(); for (const p of points) bb.expandByPoint(p);
      if (!points.length) bb.setFromCenterAndSize(C, homeV);
      bb.expandByPoint(bb.getCenter(tmp).lerp(C, centerPull));
      const c = bb.getCenter(tmp); const s = bb.getSize(tmp2);
      const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
      const needX = (s.x / 2 + padX) / Math.tan(hf), needZ = ((s.z / 2 + padZ) * Math.sin(PITCH) + (s.y / 2 + padY) * Math.cos(PITCH)) / Math.tan(vf);
      const want = THREE.MathUtils.clamp(Math.max(needX, needZ), minDist, maxDist);
      tgt.copy(c); tgt.y = Math.max(c.y, yMin) + lift; tgt.z += zBias;
      if (api._snap) { target.copy(tgt); dist = want; api._snap = false; }
      else { target.lerp(tgt, 1 - Math.exp(-dt * 2.6)); dist += (want - dist) * (1 - Math.exp(-dt * 1.8)); }
    },
    apply(dt) {
      camera.position.copy(target).addScaledVector(dir, dist); camera.lookAt(target);
      trauma = Math.max(0, trauma - dt * 1.4); const sh = trauma * trauma * 0.5; const tt = performance.now() / 1000;
      if (sh > 0) { camera.position.x += sh * Math.sin(tt * 41); camera.position.y += sh * Math.sin(tt * 37 + 1); camera.rotation.z += sh * 0.04 * Math.sin(tt * 29); }
    },
  };
  return api;
}

// Cut-away: anything between the camera and a player fades out (a low camera lets tall things hide people).
//   const cut = createCutaway({ THREE, camera });
//   cut.update(dt, points, candidates)   points: world positions that must stay visible (chest + head of each player);
//                                        candidates: meshes that may fade (destruction chunks, tall arena props, sails)
// Each faded mesh gets its own material clone while it fades (shared materials stay untouched) and gets its original
// material back once it is fully visible again. cut.reset() restores everything (new round).
export function createCutaway({ THREE, camera, fadeTo = 0.18, rate = 9, hold = 0.3, margin = 0.5 }) {
  const ray = new THREE.Raycaster(), d = new THREE.Vector3();
  const state = new Map();     // mesh -> { orig, clone, op, hit }
  const hits = [];
  function fadeMat(m) {
    const arr = Array.isArray(m) ? m : [m];
    const cl = arr.map((x) => { const c = x.clone(); c.userData = { ...x.userData, baseOpacity: x.opacity, baseTransparent: x.transparent, cutClone: true }; return c; });
    return Array.isArray(m) ? cl : cl[0];
  }
  const each = (m, fn) => (Array.isArray(m) ? m.forEach(fn) : fn(m));
  function restore(mesh, s) {
    if (mesh.material === s.clone) mesh.material = s.orig;
    each(s.clone, (c) => c.dispose()); state.delete(mesh);
  }
  return {
    update(dt, points, candidates) {
      for (const t of points) {
        d.copy(t).sub(camera.position); const len = d.length(); if (len < 1e-3) continue;
        ray.set(camera.position, d.multiplyScalar(1 / len)); ray.near = 0; ray.far = Math.max(0, len - margin);
        hits.length = 0; ray.intersectObjects(candidates, false, hits);
        for (const h of hits) {
          const mesh = h.object; if (!mesh.isMesh || !mesh.visible) continue;
          let s = state.get(mesh);
          if (!s) { s = { orig: mesh.material, clone: fadeMat(mesh.material), op: 1, hit: 0 }; state.set(mesh, s); }
          s.hit = hold;
        }
      }
      for (const [mesh, s] of state) {
        s.hit -= dt; const goal = s.hit > 0 ? fadeTo : 1;
        s.op += (goal - s.op) * Math.min(1, dt * rate);
        if (goal === 1 && s.op > 0.99) { restore(mesh, s); continue; }
        if (mesh.material !== s.clone) { if (mesh.material !== s.orig) { s.orig = mesh.material; each(s.clone, (c) => c.dispose()); s.clone = fadeMat(mesh.material); } mesh.material = s.clone; }
        each(s.clone, (c) => { if (!c.transparent) { c.transparent = true; c.needsUpdate = true; } c.opacity = c.userData.baseOpacity * s.op; c.depthWrite = s.op > 0.95; });
      }
    },
    reset() { for (const [mesh, s] of [...state]) restore(mesh, s); },
    get faded() { let n = 0; for (const s of state.values()) if (s.op < 0.6) n++; return n; },
  };
}
