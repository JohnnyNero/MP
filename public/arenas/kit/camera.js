// One shared raised three-quarter camera: frames every living player (plus a pull toward the arena centre),
// does the reveal pull-back, and trauma-based shake. Camera-relative sticks read `basis`. The yaw never changes, so
// stick directions always mean the same thing on screen.
//   const cam = createSharedCamera({ THREE, camera, ...arena.camera });
//   cam.reveal(k)                 k in [0,1] during the reveal phase (0 = close, 1 = wide)
//   cam.frame(dt, points, opts)   points: Vector3 or { p: Vector3, w, soft } (w < 1 pulls the point toward the group, so
//                                 a player flying off the edge doesn't yank the shot; soft points, e.g. telegraphs, are
//                                 framed only if that doesn't push the zoom past maxDist and cut a player); empty = home
//                                 opts.close: tighter framing (results celebration)
//   cam.shake(0..1)               cam.apply(dt)   (after reveal/frame, every rendered frame)
// Feel (from shared-camera practice: Smash-style group framing, Cinemachine-style dead zones):
//   - a dead zone: the aim point and zoom ignore small drifts of the group, so ragdoll wobble doesn't rock the shot
//   - zoom out fast (nobody leaves the screen), zoom in slowly (no pumping), eased in log space, no overshoot
// Default pitch is 35 deg: low enough to see faces and the height of things, high enough to read the whole floor and
// the front drop. `include` lists points always kept in frame. `lift` raises the look-at point above the players'
// feet, `zBias` pushes it toward the back wall.
export function createSharedCamera({ THREE, camera, pitchDeg = 35, fov = 38, minDist = 16, maxDist = 30, padX = 2.4, padZ = 1.8, padY = 1.2,
  center = [0, 0, 0], homeSize = [14, 1, 6], centerPull = 0.35, lift = 0.6, zBias = -0.6, revealFrom = 9, revealTo = 28, revealCenter = null, revealLift = null, yMin = -Infinity, include = [],
  deadZone = 0.35, zoomDead = 0.05, outTime = 0.3, inTime = 1.3, panTime = 0.5, maxShake = 0.4 }) {
  camera.fov = fov; camera.updateProjectionMatrix();
  const PITCH = THREE.MathUtils.degToRad(pitchDeg);
  const dir = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH));          // from the aim point toward the camera
  const up = new THREE.Vector3(0, Math.cos(PITCH), -Math.sin(PITCH));            // screen up
  const basis = { fx: 0, fz: -1, rx: 1, rz: 0 };          // horizontal forward / right of the view (looks down -z)
  const C = new THREE.Vector3(...center);
  const RC = new THREE.Vector3(...(revealCenter || center));
  const target = new THREE.Vector3().copy(C), goal = new THREE.Vector3().copy(C);
  let dist = (minDist + maxDist) / 2, distGoal = dist, trauma = 0;
  const bb = new THREE.Box3(), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tgt = new THREE.Vector3(), mean = new THREE.Vector3(), q = new THREE.Vector3();
  const homeV = new THREE.Vector3(...homeSize);
  const incl = include.map((v) => new THREE.Vector3(...v));     // points always kept in frame (e.g. the danger edge)
  const api = {
    basis, pitchDeg, get target() { return target; }, get dist() { return dist; }, get trauma() { return trauma; },
    setCenter(v) { C.copy(v); },
    shake(a) { trauma = Math.min(1, trauma + a); },
    reveal(k) {
      const e = 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
      target.copy(RC); target.y += revealLift ?? lift; dist = revealFrom + (revealTo - revealFrom) * e;
      goal.copy(target); distGoal = dist;
    },
    snap() { /* next frame() jumps instead of easing */ api._snap = true; },
    frame(dt, points, { close = false } = {}) {
      // weighted group: full-weight points define the box; lighter ones are pulled toward the weighted mean first
      let wsum = 0; mean.set(0, 0, 0);
      for (const it of points) { if (it.soft) continue; const p = it.p || it, w = it.w ?? 1; mean.addScaledVector(p, w); wsum += w; }
      if (wsum > 0) mean.divideScalar(wsum);
      const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect), k = close ? 0.55 : 1;
      const dz = close ? 0 : deadZone;            // margin for the aim point lagging inside its dead zone
      const padH = padX * k + dz, padV = (padZ * k + dz) * Math.sin(PITCH) + (padY * k + dz) * Math.cos(PITCH);
      const tx = Math.tan(hf), ty = Math.tan(vf);
      // exact fit: the camera distance that keeps point p inside the frame when aiming at aim (a point up in the air is
      // nearer the camera and spreads wider on screen than a flat bounding box suggests)
      const needFor = (p, aim, ph = padH, pv = padV) => { q.copy(p).sub(aim); const depth = q.dot(dir); return Math.max((Math.abs(q.x) + ph) / tx, (Math.abs(q.y * up.y + q.z * up.z) + pv) / ty) + depth; };
      const fit = (withSoft) => {
        bb.makeEmpty();
        const pts = [];
        for (const it of points) { if (it.soft && !withSoft) continue; const p = it.p || it, w = it.w ?? 1; pts.push(w >= 1 ? p : mean.clone().lerp(p, Math.max(0, w))); }
        for (const p of pts) bb.expandByPoint(p);
        const n = pts.length;
        if (!n) bb.setFromCenterAndSize(C, homeV);
        if (!close) for (const v of incl) { bb.expandByPoint(v); pts.push(v); }
        if (!close) bb.expandByPoint(bb.getCenter(tmp).lerp(C, centerPull));
        const c = bb.getCenter(tmp); const aim = new THREE.Vector3(c.x, Math.max(c.y, yMin) + lift, c.z + (close ? 0 : zBias));
        let need = 0;
        if (!n) { const s = bb.getSize(tmp2); need = Math.max((s.x / 2 + padH) / tx, (s.z / 2 * Math.sin(PITCH) + padV) / ty); }
        for (const p of pts) need = Math.max(need, needFor(p, aim));
        return { need, aim };
      };
      let F = fit(true);
      if (F.need > maxDist && points.some((it) => it.soft)) F = fit(false);    // the soft points don't fit: players win
      tgt.copy(F.aim);
      const want = THREE.MathUtils.clamp(F.need, close ? minDist * 0.6 : minDist, maxDist);
      if (api._snap) { target.copy(tgt); goal.copy(tgt); dist = distGoal = want; api._snap = false; return; }
      // dead zone: the goal is dragged only by the part of a move beyond deadZone (metres) / zoomDead (fraction)
      const off = tgt.distanceTo(goal); if (off > deadZone) goal.lerp(tgt, (off - deadZone) / off);
      if (want > distGoal || Math.abs(want - distGoal) / distGoal > zoomDead) distGoal = want;   // never late zooming out
      target.lerp(goal, 1 - Math.exp(-dt / panTime));
      const tau = distGoal > dist ? outTime : inTime;                                            // out fast, in slow
      dist = Math.exp(Math.log(dist) + (Math.log(distGoal) - Math.log(dist)) * (1 - Math.exp(-dt / tau)));
    },
    apply(dt) {
      camera.position.copy(target).addScaledVector(dir, dist); camera.lookAt(target);
      trauma = Math.max(0, trauma - dt * 1.4); const sh = trauma * trauma * maxShake; const tt = performance.now() / 1000;
      if (sh > 0) { camera.position.x += sh * Math.sin(tt * 41); camera.position.y += sh * Math.sin(tt * 37 + 1); camera.rotation.z += sh * 0.03 * Math.sin(tt * 29); }
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
