// Pirate Cove: the look of the place. Everything here is visual; the physics is built from layout.js, so every walkable
// top drawn here sits exactly on the numbers there (pier, fort, ramps, bridge, stones, deck, castle, gangplank).
// Low-poly toy style, matte only (roughness >= 0.7, metalness 0). Static pieces are merged per material, repeated
// decor is instanced. Decor is placed by a seeded generator and rejected near the board spaces, the paths between
// them and the structures (see `clear`), so beans never walk into a palm.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KIND = { blue: '#4f8fe6', red: '#e2553f', chest: '#f2c335' };

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export function buildCoveArt({ THREE, scene, renderer, L }) {
  const R = mulberry(20261019);
  const rr = (a, b) => a + (b - a) * R();
  const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const M = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
    new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V3(sx, sy, sz));
  const col = (c) => (c && c.isColor ? c : new THREE.Color(c));
  const PI = Math.PI, RIG = -0.55;            // the yard is braced round so the torn sail shows to the camera

  // ------------------------------------------------------------------ batching: merge many parts into one mesh
  // color: hex / Color / fn(cx, cy, cz) -> hex|Color (centroid of each triangle in the part's own coordinates)
  class Batch {
    constructor() { this.geos = []; this.paint = []; }
    add(geo, color, m = null, jit = 0, paint = -1) {
      let g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.clearGroups();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      const p = g.attributes.position, n = p.count, arr = new Float32Array(n * 3);
      const fn = typeof color === 'function' ? color : null, base = fn ? null : col(color);
      const tc = new THREE.Color();
      for (let i = 0; i < n; i += 3) {
        const k = 1 + (R() * 2 - 1) * jit;
        if (fn) tc.copy(col(fn((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3)));
        else tc.copy(base);
        for (let v = i; v < Math.min(n, i + 3); v++) { arr[v * 3] = tc.r * k; arr[v * 3 + 1] = tc.g * k; arr[v * 3 + 2] = tc.b * k; }
      }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      if (m) g.applyMatrix4(m);
      this.geos.push(g);
      for (let i = 0; i < n; i++) this.paint.push(paint);
      geo.dispose();
      return g;
    }
    box(w, h, d, x, y, z, color, jit = 0, m = null) { return this.add(new THREE.BoxGeometry(w, h, d), color, m ? m.clone().multiply(M(x, y, z)) : M(x, y, z), jit); }
    rod(a, b, r, color, seg = 5) {                         // a thin cylinder from a to b (ropes, poles)
      const d = b.clone().sub(a), len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.normalize());
      return this.add(new THREE.CylinderGeometry(r, r, len, seg, 1, true), color, new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(1, 1, 1)));
    }
    rope(a, b, r, color, sag = 0.05, n = 4) {
      let prev = a;
      for (let i = 1; i <= n; i++) { const t = i / n, p = a.clone().lerp(b, t); p.y -= sag * 4 * t * (1 - t); this.rod(prev, p, r, color, 4); prev = p; }
    }
    geometry() { return this.geos.length ? mergeGeometries(this.geos, false) : null; }
    mesh(mat, cast = true, receive = true) {
      const g = this.geometry(); if (!g) return null;
      const me = new THREE.Mesh(g, mat); me.castShadow = cast; me.receiveShadow = receive; return me;
    }
  }

  // ------------------------------------------------------------------ materials (all matte)
  const matte = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const mats = {
    vc: matte({ vertexColors: true }),                                   // wood, cloth bits, small decor
    vcFlat: matte({ vertexColors: true, flatShading: true, roughness: 0.95 }),   // stone and rock
    foliage: matte({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }),
    terrain: matte({ vertexColors: true, roughness: 0.95 }),
    space: matte({ vertexColors: true, roughness: 0.75 }),
    iron: matte({ color: '#3b3e44', roughness: 0.75 }),
  };

  // ------------------------------------------------------------------ sky, lights
  scene.background = new THREE.Color('#a9d9f1');
  scene.fog = new THREE.Fog('#b9e0f2', 30, 85);
  if (renderer) renderer.toneMappingExposure = 1.0;
  const hemi = new THREE.HemisphereLight('#e4f3ff', '#d8bf8e', 1.15); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffe1b4', 2.4); sun.position.set(8, 15, 7); sun.target.position.set(0, 0, -0.5);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 50 });
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight('#cfe4ff', 0.45); fill.position.set(-9, 8, 10); scene.add(fill);

  const root = new THREE.Group(); root.name = 'coveArt'; scene.add(root);

  // ------------------------------------------------------------------ where decor may go
  const WP = Object.fromEntries(L.WAYPOINTS.map((w) => [w.id, w]));
  const segs = L.LINKS.map(([a, b]) => [WP[a], WP[b]]).filter(([a, b]) => a && b);
  const segD = (x, z, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(x - a.x - dx * t, z - a.z - dz * t); };
  const pathDist = (x, z) => { let d = 1e9; for (const [a, b] of segs) d = Math.min(d, segD(x, z, a, b)); return d; };
  const [ox, , oz] = L.SHIP.origin;
  const rect = (x0, x1, z0, z1) => ({ x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) });
  const FR = L.FORT_RAMP, BR = L.BRIDGE, SH = L.SHIP, PK = SH.plank;
  const structs = [
    rect(L.PIER.x0, L.PIER.x1, L.PIER.z0, L.PIER.z1), rect(L.FORT.x0, L.FORT.x1, L.FORT.z0, L.FORT.z1), rect(FR.x0, FR.x1, FR.a0, FR.a1),
    rect(BR.a0, BR.a1, BR.z0, BR.z1), rect(SH.hull.x0 + ox, SH.hull.x1 + ox, SH.hull.z0 + oz, SH.hull.z1 + oz), rect(PK.x0 + ox, PK.x1 + ox, PK.a0 + oz, PK.a1 + oz),
  ];
  const inStruct = (x, z, m) => structs.some((b) => x > b.x0 - m && x < b.x1 + m && z > b.z0 - m && z < b.z1 + m) || L.STONES.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + m);
  const spaceDist = (x, z) => Math.min(...L.SPACES.map((s) => Math.hypot(x - s.x, z - s.z)));
  const placed = [];                                   // every decor footprint, for spacing and for checking
  // r: footprint radius; path: clearance from the path lines (beyond r); sep: spacing to other decor
  function clear(x, z, r, path = 1.2, sep = 0.15) {
    if (!(x > L.BOUNDS.x0 - 4 && x < L.BOUNDS.x1 + 4 && z > L.BOUNDS.z0 - 4 && z < L.BOUNDS.z1 + 4)) return false;
    if (pathDist(x, z) < path + r || spaceDist(x, z) < 0.6 + r + path * 0.5) return false;
    if (inStruct(x, z, r + 0.15)) return false;
    return !placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + sep);
  }
  // try the wished spot, then spiral out up to `reach` m for one that passes test + clear
  function spot(x, z, r, test, { path = 1.2, reach = 1.5, sep = 0.15, kind = 'decor' } = {}) {
    for (let k = 0; k < 120; k++) {
      const a = k * 2.399, d = reach * Math.sqrt(k / 120), px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const h = L.terrainH(px, pz);
      if ((!test || test(px, pz, h)) && clear(px, pz, r, path, sep)) { const p = { kind, x: px, z: pz, r, h }; placed.push(p); return p; }
    }
    return null;
  }
  function scatter(n, r, test, { path = 1.2, sep = 0.15, kind = 'decor', tries = 3000, area = null } = {}) {
    const out = [], A = area || { x0: -9, x1: 9, z0: -7, z1: 7 };
    for (let k = 0; k < tries && out.length < n; k++) {
      const x = rr(A.x0, A.x1), z = rr(A.z0, A.z1), h = L.terrainH(x, z);
      if (test(x, z, h) && clear(x, z, r, path, sep)) { const p = { kind, x, z, r, h }; placed.push(p); out.push(p); }
    }
    return out;
  }
  const isl = (x, z) => L.islandR(x, z);

  // ------------------------------------------------------------------ terrain (also the physics trimesh)
  const B = L.BOUNDS, STEP = 0.25;
  const NX = Math.round((B.x1 - B.x0) / STEP) + 1, NZ = Math.round((B.z1 - B.z0) / STEP) + 1;
  const tPos = new Float32Array(NX * NZ * 3), tCol = new Float32Array(NX * NZ * 3);
  const cDry = col('#f4e2b4'), cDry2 = col('#ecd39f'), cWet = col('#c9a674'), cSub = col('#d9c493'), cDeep = col('#7ea595'), cLag = col('#cfd3a4');
  const tc = new THREE.Color();
  function groundColor(x, z, h) {
    const nse = 0.5 + 0.22 * Math.sin(x * 1.9 + z * 0.7) + 0.18 * Math.sin(z * 2.6 - x * 1.1) + 0.1 * Math.sin(x * 5.3 + z * 4.1);
    if (h > -0.12) tc.copy(cDry).lerp(cDry2, clamp(nse, 0, 1) * 0.8);
    else if (h > L.WATER_Y - 0.05) tc.copy(cDry2).lerp(cWet, smooth(-0.12, L.WATER_Y, h));
    else { tc.copy(cWet).lerp(cSub, smooth(L.WATER_Y, -0.9, h)).lerp(cDeep, smooth(-0.9, -2.4, h)); if (L.lagoonR(x, z) < 1.1) tc.lerp(cLag, 0.5); tc.multiplyScalar(0.94 + 0.12 * nse); }
    return tc;
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, x = B.x0 + i * STEP, z = B.z0 + j * STEP, y = L.terrainH(x, z);
    tPos[k * 3] = x; tPos[k * 3 + 1] = y; tPos[k * 3 + 2] = z;
    const c = groundColor(x, z, y); tCol[k * 3] = c.r; tCol[k * 3 + 1] = c.g; tCol[k * 3 + 2] = c.b;
  }
  const tIdx = [];
  for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    tIdx.push(a, c, b, b, c, d);
  }
  const tGeo = new THREE.BufferGeometry();
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.setIndex(tIdx); tGeo.computeVertexNormals(); tGeo.computeBoundingSphere();
  const terrain = new THREE.Mesh(tGeo, mats.terrain); terrain.name = 'terrain'; terrain.receiveShadow = true;
  root.add(terrain);
  {   // the seabed beyond the bounds: four flat strips at SEABED_Y around the terrain grid
    const sb = new Batch(), E = 70, y = L.SEABED_Y, deep = groundColor(20, 20, y).clone();
    const strip = (x0, x1, z0, z1) => sb.add(new THREE.PlaneGeometry(x1 - x0, z1 - z0), deep, M((x0 + x1) / 2, y, (z0 + z1) / 2, -PI / 2));
    strip(-E, E, -E, B.z0); strip(-E, E, B.z1, E); strip(-E, B.x0, B.z0, B.z1); strip(B.x1, E, B.z0, B.z1);
    const m = sb.mesh(mats.terrain, false, true); m.name = 'seabed'; root.add(m);
  }

  // ------------------------------------------------------------------ the sea: one plane, waves in the vertex shader,
  // depth from a baked terrain height texture gives the shallow tint, the alpha and the foam at the shoreline
  const water = (() => {
    const HN = 128, X0 = -24, SZ = 48, data = new Uint8Array(HN * HN * 4);
    for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
      const x = X0 + (i + 0.5) * SZ / HN, z = X0 + (j + 0.5) * SZ / HN;
      let h = L.terrainH(x, z);
      const v = Math.round(clamp((h + 3) / 4, 0, 1) * 255), k = (j * HN + i) * 4;
      data[k] = v; data[k + 1] = v; data[k + 2] = v; data[k + 3] = 255;
    }
    const hTex = new THREE.DataTexture(data, HN, HN, THREE.RGBAFormat);
    hTex.magFilter = hTex.minFilter = THREE.LinearFilter; hTex.wrapS = hTex.wrapT = THREE.ClampToEdgeWrapping; hTex.needsUpdate = true;
    const uni = {
      uTime: { value: 0 }, uLevel: { value: L.WATER_Y }, uHeight: { value: hTex }, uRegion: { value: new THREE.Vector4(X0, X0, SZ, SZ) },
      uShallow: { value: col('#7fdcd2') }, uDeep: { value: col('#3a8fc2') }, uFoam: { value: col('#ffffff') },
    };
    const geo = new THREE.PlaneGeometry(120, 120, 96, 96); geo.rotateX(-PI / 2);
    const mat = matte({ color: '#ffffff', roughness: 0.7, transparent: true });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader = 'uniform float uTime;\nvarying vec2 vWXZ;\n' + sh.vertexShader
        .replace('#include <beginnormal_vertex>', `
          float wp1 = position.x * 0.9 + uTime * 1.3, wp2 = position.z * 1.3 - uTime * 1.1, wp3 = (position.x + position.z) * 0.6 + uTime * 0.8;
          float wy = 0.022 * sin(wp1) + 0.016 * sin(wp2) + 0.012 * sin(wp3);
          float wdx = 0.022 * 0.9 * cos(wp1) + 0.012 * 0.6 * cos(wp3), wdz = 0.016 * 1.3 * cos(wp2) + 0.012 * 0.6 * cos(wp3);
          vec3 objectNormal = normalize(vec3(-wdx * 4.0, 1.0, -wdz * 4.0));`)
        .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += wy; vWXZ = (modelMatrix * vec4(position, 1.0)).xz;');
      sh.fragmentShader = 'uniform float uTime; uniform float uLevel; uniform sampler2D uHeight; uniform vec4 uRegion; uniform vec3 uShallow; uniform vec3 uDeep; uniform vec3 uFoam;\nvarying vec2 vWXZ;\n' + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          float th = texture2D(uHeight, (vWXZ - uRegion.xy) / uRegion.zw).r * 4.0 - 3.0;
          float depth = uLevel - th;
          float deep = smoothstep(0.05, 1.9, depth);
          vec3 wc = mix(uShallow, uDeep, deep);
          float foam = 1.0 - smoothstep(0.0, 0.05 + 0.02 * sin(uTime * 1.7 + vWXZ.x * 1.3 + vWXZ.y * 0.9), depth);
          float band = (1.0 - smoothstep(0.0, 0.02, abs(depth - 0.2 - 0.06 * sin(uTime * 0.9 + vWXZ.x * 0.15)))) * 0.4;
          foam = clamp(foam + band * (1.0 - deep), 0.0, 1.0);
          diffuseColor.rgb = mix(wc, uFoam, foam * 0.75);
          diffuseColor.a = mix(mix(0.5, 0.92, deep), 0.9, foam * 0.7);`);
    };
    const mesh = new THREE.Mesh(geo, mat); mesh.name = 'sea'; mesh.position.y = L.WATER_Y; mesh.receiveShadow = true; mesh.renderOrder = 1;
    scene.add(mesh);
    return { mesh, update(level, t) { mesh.position.y = level; uni.uLevel.value = level; uni.uTime.value = t; } };
  })();

  function flipWinding(g) { const a = g.attributes.position.array; for (let i = 0; i < a.length; i += 9) for (let k = 0; k < 3; k++) { const t = a[i + 3 + k]; a[i + 3 + k] = a[i + 6 + k]; a[i + 6 + k] = t; } g.computeVertexNormals(); return g; }

  // ------------------------------------------------------------------ ramp frames: (u along the slope, h up the normal,
  // v across) -> world, so a box with top at h = 0 lies exactly in the ramp plane
  function rampFrame(r) {
    const isZ = r.axis === 'z', mid = isZ ? (r.x0 + r.x1) / 2 : (r.z0 + r.z1) / 2, W = isZ ? r.x1 - r.x0 : r.z1 - r.z0;
    const P0 = isZ ? V3(mid, r.y0, r.a0) : V3(r.a0, r.y0, mid), P1 = isZ ? V3(mid, r.y1, r.a1) : V3(r.a1, r.y1, mid);
    const eu = P1.clone().sub(P0), len = eu.length(); eu.normalize();
    const n = (isZ ? V3(1, 0, 0) : V3(0, 0, 1)).cross(eu); if (n.y < 0) n.negate(); n.normalize();
    const ev = eu.clone().cross(n);
    return { m: new THREE.Matrix4().makeBasis(eu, n, ev).setPosition(P0), len, W, n, eu, ev };
  }
  // a solid wedge under a ramp (down to `base`), top at `drop` below the ramp plane
  function wedgeGeo(r, drop = 0) {
    const pts = [new THREE.Vector2(r.a0, r.base), new THREE.Vector2(r.a1, r.base), new THREE.Vector2(r.a1, r.y1 - drop)];
    if (r.y0 - drop > r.base + 0.01) pts.push(new THREE.Vector2(r.a0, r.y0 - drop));
    const s = new THREE.Shape(pts);
    const g = new THREE.ExtrudeGeometry(s, { depth: r.axis === 'z' ? r.x1 - r.x0 : r.z1 - r.z0, bevelEnabled: false });
    if (r.axis === 'z') g.applyMatrix4(new THREE.Matrix4().makeBasis(V3(0, 0, 1), V3(0, 1, 0), V3(-1, 0, 0)).setPosition(r.x1, 0, 0));
    else g.translate(0, 0, r.z0);
    return g;
  }

  const wood = new Batch();          // static wood / painted / small things (vertex colours, smooth)
  const stone = new Batch();         // static stone and rock (flat shaded)
  const plants = new Batch();        // tufts (double sided)
  const WOODS = ['#8b5a33', '#7d5130', '#946338', '#84552f'];
  const woodC = () => WOODS[Math.floor(R() * WOODS.length)];
  const ROCKS = ['#a59684', '#968876', '#b1a38e', '#9b8e7b', '#8d8170'];
  const rockC = () => ROCKS[Math.floor(R() * ROCKS.length)];
  const CLIFF = ['#9a8a74', '#8c7d69', '#a29178', '#857764', '#94846e'];

  // ------------------------------------------------------------------ the fort: rocky cliff, paved top, walls, ramp
  const F = L.FORT;
  function strata(b, axis, f, sg, s0, s1, y0, y1, rowH = 0.32, maxOut = 0.04) {
    for (let y = y0; y < y1 - 0.02; y += rowH) {
      const h = Math.min(rowH, y1 - y);
      let s = s0;
      const first = rr(0.2, 0.7);
      let w = first;
      while (s < s1 - 0.02) {
        w = Math.min(w, s1 - s);
        const d = 0.16, mason = y > y1 - 0.62;            // dressed stone courses at the top, rough rock below
        const out = mason ? rr(0, 0.015) : rr(0, maxOut), c = mason ? (R() < 0.5 ? '#cdbf9f' : '#bfb08f') : CLIFF[Math.floor(R() * CLIFF.length)];
        const hh = mason ? h - 0.03 : h * rr(0.8, 1.05), yy = y + h / 2 + (mason ? 0 : rr(-0.04, 0.04)), tw = mason ? 0 : rr(-0.1, 0.1);
        if (axis === 'x') b.add(new THREE.BoxGeometry(d, hh, w - 0.03), c, M(f + sg * (out - d / 2), yy, s + w / 2, tw, 0, 0), 0.05);
        else b.add(new THREE.BoxGeometry(w - 0.03, hh, d), c, M(s + w / 2, yy, f + sg * (out - d / 2), 0, 0, tw), 0.05);
        s += w; w = rr(0.45, 0.95);
      }
    }
  }
  {
    const top = F.y - 0.08;
    stone.box(F.x1 - F.x0 - 0.16, top + 0.01 - L.SEABED_Y, F.z1 - F.z0 - 0.16, (F.x0 + F.x1) / 2, (top + 0.01 + L.SEABED_Y) / 2, (F.z0 + F.z1) / 2, '#6f6558');
    const lowAlong = (fn, a0, a1) => { let m = 9; for (let a = a0; a <= a1; a += 0.25) m = Math.min(m, fn(a)); return Math.max(L.SEABED_Y, m - 0.35); };
    strata(stone, 'z', F.z0, -1, F.x0, F.x1, lowAlong((a) => L.terrainH(a, F.z0), F.x0, F.x1), top, 0.34, 0.07);   // back
    strata(stone, 'x', F.x1, 1, F.z0, F.z1, lowAlong((a) => L.terrainH(F.x1, a), F.z0, F.z1), top, 0.34, 0.07);   // right
    strata(stone, 'z', F.z1, 1, F.x0, F.x1, lowAlong((a) => L.terrainH(a, F.z1), F.x0, F.x1), top, 0.3, 0.03);    // front (faces the board)
    strata(stone, 'x', F.x0, -1, F.z0, F.z1, lowAlong((a) => L.terrainH(F.x0, a), F.z0, F.z1), top, 0.3, 0.03);   // left (under the bridge)
    // paved top: staggered slabs, tops exactly at FORT.y
    const rows = 6, rz = (F.z1 - F.z0) / rows;
    for (let j = 0; j < rows; j++) {
      let x = F.x0, w = rr(0.25, 0.5);
      while (x < F.x1 - 0.02) {
        w = Math.min(w, F.x1 - x);
        stone.box(w - 0.03, 0.08, rz - 0.03, x + w / 2, F.y - 0.04, F.z0 + rz * (j + 0.5), R() < 0.5 ? '#cdbf9f' : '#c3b493', 0.06);
        x += w; w = rr(0.38, 0.62);
      }
    }
    // low crenellated walls on the outer (back and right) edges, under 0.5 m
    const wallC = () => (R() < 0.5 ? '#d4c7a8' : '#c7b998');
    const wallZ0 = F.z0, wallX1 = F.x1, t = 0.28, wy = F.y;
    for (let x = F.x0; x < F.x1 - 0.01; x += 0.475) stone.box(Math.min(0.46, F.x1 - x), 0.22, t, x + Math.min(0.475, F.x1 - x) / 2, wy + 0.11, wallZ0 + t / 2, wallC(), 0.04);
    const tR = F.x1 - FR.x1;                     // the right wall stops short of the ramp's width
    for (let z = F.z0 + t; z < F.z1 - 0.01; z += 0.47) stone.box(tR, 0.22, Math.min(0.46, F.z1 - z), wallX1 - tR / 2, wy + 0.11, z + Math.min(0.47, F.z1 - z) / 2, wallC(), 0.04);
    for (let x = F.x0 + 0.05; x < F.x1 - 0.3; x += 0.75) stone.box(0.36, 0.2, t, x + 0.18, wy + 0.32, wallZ0 + t / 2, wallC(), 0.04);
    for (let z = F.z0 + 0.4; z < F.z1 - 0.3; z += 0.75) stone.box(tR, 0.2, 0.36, wallX1 - tR / 2, wy + 0.32, z + 0.18, wallC(), 0.04);
    stone.box(0.34, 0.2, 0.34, wallX1 - 0.17, wy + 0.32, wallZ0 + 0.17, wallC());
    // the ramp: a stone wedge, cobbled top exactly in the ramp plane, block courses up its sides
    stone.add(wedgeGeo(FR, 0.03), '#6f6558');
    const RF = rampFrame(FR);
    for (let u = 0; u < RF.len - 0.01; u += 0.3) {
      const lu = Math.min(0.3, RF.len - u);
      let v = -RF.W / 2, w = rr(0.18, 0.4);
      while (v < RF.W / 2 - 0.02) {
        w = Math.min(w, RF.W / 2 - v);
        const g = stone.add(new THREE.BoxGeometry(lu - 0.035, 0.07, w - 0.035), R() < 0.5 ? '#c9bb9a' : '#b9aa8a', RF.m.clone().multiply(M(u + lu / 2, -0.035, v + w / 2)), 0.07);
        v += w; w = rr(0.26, 0.46);
        void g;
      }
    }
    const sideRows = (x, sg) => {
      for (let y = -0.7; y < FR.y1 - 0.05; y += 0.3) {
        const yt = y + 0.3, aT = clamp(FR.a0 + (FR.a1 - FR.a0) * (yt - FR.y0) / (FR.y1 - FR.y0), FR.a1, FR.a0);
        let a = FR.a1, w = rr(0.3, 0.7);
        while (a < aT - 0.05) { w = Math.min(w, aT - a); stone.box(0.14, 0.27, w - 0.03, x + sg * (0.02 - 0.07), y + 0.15, a + w / 2, rockC(), 0.05); a += w; w = rr(0.45, 0.85); }
      }
    };
    sideRows(FR.x0, -1); sideRows(FR.x1, 1);
    // flag pole on the back-right corner
    wood.rod(V3(F.x1 - 0.17, F.y + 0.4, F.z0 + 0.17), V3(F.x1 - 0.17, F.y + 3.2, F.z0 + 0.17), 0.045, '#6a4a2c', 7);
    wood.add(new THREE.SphereGeometry(0.08, 8, 6), '#e8b93a', M(F.x1 - 0.17, F.y + 3.24, F.z0 + 0.17));
  }
  // cannonball stacks at the back of the fort
  const balls = [];
  for (const [bx, bz] of [[F.x0 + 0.35, F.z0 + 0.5], [F.x1 - 0.65, F.z0 + 0.55]]) {
    const r = 0.09;
    for (let l = 0; l < 3; l++) { const n = 3 - l; for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) balls.push([bx + (i - (n - 1) / 2) * 2 * r, F.y + r + l * r * 1.42, bz + (k - (n - 1) / 2) * 2 * r]); }
  }
  {
    const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 10, 8), mats.iron, balls.length);
    balls.forEach((b, i) => im.setMatrixAt(i, M(...b)));
    im.castShadow = true; im.receiveShadow = true; im.name = 'cannonballs'; root.add(im);
  }

  // ------------------------------------------------------------------ the cannon (group on the fort top, aims +z)
  const cannon = new THREE.Group(); cannon.name = 'cannon'; cannon.position.set(3.6, F.y, -4.4);
  {
    const cw = new Batch(), wc = '#7a4f2c';
    cw.box(0.07, 0.3, 0.78, -0.17, 0.2, 0, wc, 0.04); cw.box(0.07, 0.3, 0.78, 0.17, 0.2, 0, wc, 0.04);
    cw.box(0.34, 0.08, 0.7, 0, 0.1, 0, '#6e4627');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) cw.add(new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12), (x, y, z) => (Math.abs(y) > 0.03 ? '#5c3b22' : '#5c3b22'), M(sx * 0.25, 0.15, sz * 0.26, 0, 0, PI / 2), 0.03);
    for (const sz of [-1, 1]) cw.add(new THREE.CylinderGeometry(0.03, 0.03, 0.58, 6), '#2f3034', M(0, 0.15, sz * 0.26, 0, 0, PI / 2));
    const carriage = cw.mesh(mats.vc); carriage.name = 'carriage'; cannon.add(carriage);
    const barrel = new THREE.Group(); barrel.name = 'barrel'; barrel.position.set(0, 0.38, -0.05); barrel.rotation.x = -0.12; cannon.add(barrel);
    const ib = new Batch();
    ib.add(new THREE.CylinderGeometry(0.085, 0.125, 0.95, 14), '#3b3e44', M(0, 0, 0.25, PI / 2));
    ib.add(new THREE.CylinderGeometry(0.112, 0.112, 0.08, 14), '#34373c', M(0, 0, 0.7, PI / 2));
    ib.add(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 14), '#34373c', M(0, 0, -0.17, PI / 2));
    ib.add(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 14), '#34373c', M(0, 0, 0.3, PI / 2));
    ib.add(new THREE.SphereGeometry(0.11, 12, 8), '#3b3e44', M(0, 0, -0.22));
    ib.add(new THREE.SphereGeometry(0.05, 8, 6), '#3b3e44', M(0, 0, -0.35));
    ib.add(new THREE.CircleGeometry(0.06, 12), '#0d0d0f', M(0, 0, 0.742));
    const bm = ib.mesh(mats.vc); bm.name = 'barrelMesh'; barrel.add(bm);
    const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, 0, 0.76); barrel.add(muzzle);
  }
  root.add(cannon);

  // ------------------------------------------------------------------ the bridge: planks on two stringers, rope hand-lines
  {
    const RB = rampFrame(BR), th = BR.thick;
    for (let u = 0; u < RB.len - 0.01; u += 0.2) {
      const lu = Math.min(0.2, RB.len - u);
      wood.add(new THREE.BoxGeometry(lu - 0.025, 0.07, RB.W - rr(0, 0.04)), woodC(), RB.m.clone().multiply(M(u + lu / 2, -0.035, rr(-0.01, 0.01))), 0.05);
    }
    for (const v of [-0.33, 0.33]) wood.add(new THREE.BoxGeometry(RB.len, th - 0.07, 0.12), '#6b4528', RB.m.clone().multiply(M(RB.len / 2, -0.07 - (th - 0.07) / 2, v)));
    const at = (u, h, v) => V3(u, h, v).applyMatrix4(RB.m);
    const postsU = [0.12, 1.4, 2.67, 3.94, RB.len - 0.12];
    for (const sv of [-1, 1]) {
      const v = sv * (RB.W / 2 + 0.05);
      postsU.forEach((u, i) => {
        const a = at(u, -0.25, v), b = at(u, 0.62, v);
        wood.rod(a, b, 0.045, '#6f4a2b', 6);
        if (i) { const pu = postsU[i - 1]; for (const hh of [0.56, 0.3]) wood.rope(at(pu, hh, v), at(u, hh, v), 0.017, '#d8c08a', 0.07, 4); }
      });
    }
    for (const u of [1.8, 3.6]) {         // trestles down to the sand
      const g0 = at(u, -th, -0.42), g1 = at(u, -th, 0.42);
      for (const p of [g0, g1]) wood.rod(V3(p.x, L.terrainH(p.x, p.z) - 0.1, p.z), p, 0.06, '#6a4529', 6);
      wood.rod(V3(g0.x, L.terrainH(g0.x, g0.z) + 0.1, g0.z), g1, 0.03, '#6a4529', 5);
      wood.rod(V3(g1.x, L.terrainH(g1.x, g1.z) + 0.1, g1.z), g0, 0.03, '#6a4529', 5);
    }
  }

  // ------------------------------------------------------------------ the pier
  {
    const P = L.PIER;
    for (let z = P.z0; z < P.z1 - 0.01; z += 0.207) {
      const w = Math.min(0.207, P.z1 - z);
      wood.box(P.x1 - P.x0 - rr(0, 0.05), 0.07, w - 0.022, (P.x0 + P.x1) / 2 + rr(-0.012, 0.012), P.y - 0.035, z + w / 2, woodC(), 0.06);
    }
    for (const x of [-0.55, 0.55]) wood.box(0.12, 0.1, P.z1 - P.z0, x, P.y - 0.12, (P.z0 + P.z1) / 2, '#6b4528');
    wood.box(P.x1 - P.x0, P.y - 0.07, 0.05, 0, (P.y - 0.07) / 2, P.z0 + 0.025, '#6b4528');
    for (const x of [P.x0 + 0.07, P.x1 - 0.07]) for (const z of [P.z0 + 0.15, 4.6, 5.55, P.z1 - 0.12]) {
      const g = L.terrainH(x, z) - 0.2;
      wood.add(new THREE.CylinderGeometry(0.075, 0.085, P.y - 0.07 - g, 7), '#6a4529', M(x, (P.y - 0.07 + g) / 2, z), 0.05);
    }
    for (const x of [P.x0 + 0.12, P.x1 - 0.12]) {            // mooring bollards at the far end (edge decor)
      wood.add(new THREE.CylinderGeometry(0.075, 0.085, 0.36, 8), '#5f3f24', M(x, P.y + 0.18, P.z1 - 0.12));
      wood.add(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 8), '#d8c08a', M(x, P.y + 0.24, P.z1 - 0.12));
    }
    // the rowing boat tied up beside the pier
    const bx = 1.75, by = L.WATER_Y, bz = 5.35, Lb = 1.9;
    const bs = [-1, -0.6, -0.1, 0.4, 0.8, 1].map((t) => t * Lb / 2), hw = (z) => 0.42 * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, z / (Lb / 2)), 2.2))) * (z < 0 ? 1 - 0.3 * Math.pow(-z / (Lb / 2), 3) : 1);
    const hy = [0.18, 0.05, -0.08, -0.16], hs = [1, 0.97, 0.8, 0.45];
    const bg = new THREE.BufferGeometry(), bp = [];
    const pt = (i, j, s) => [s * hw(bs[i]) * hs[j], hy[j], bs[i]];
    for (let i = 0; i < bs.length - 1; i++) for (let j = 0; j < hy.length - 1; j++) for (const s of [-1, 1]) {
      const A = pt(i, j, s), Bp = pt(i + 1, j, s), Cp = pt(i + 1, j + 1, s), D = pt(i, j + 1, s);
      if (s < 0) bp.push(...A, ...D, ...Cp, ...A, ...Cp, ...Bp); else bp.push(...A, ...Cp, ...D, ...A, ...Bp, ...Cp);
    }
    for (let i = 0; i < bs.length - 1; i++) { const a = pt(i, 3, -1), b = pt(i, 3, 1), c = pt(i + 1, 3, 1), d = pt(i + 1, 3, -1); bp.push(...a, ...b, ...c, ...a, ...c, ...d); }
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3)); bg.computeVertexNormals();
    const boatM = M(bx, by, bz, 0, 0.12, 0);
    wood.add(bg, (x, y) => (y > 0.1 ? '#f1e6c8' : y > 0.0 ? '#c94a3a' : '#3f8f9a'), boatM);
    const bg2 = bg.clone(); bg2.scale(0.92, 0.9, 0.95); bg2.translate(0, 0.012, 0); flipWinding(bg2);
    wood.add(bg2, '#8b6038', boatM, 0, -1);
    for (const z of [-0.35, 0.25]) wood.add(new THREE.BoxGeometry(0.76, 0.04, 0.16), '#a2703f', boatM.clone().multiply(M(0, 0.1, z)));
    for (const s of [-1, 1]) wood.add(new THREE.CylinderGeometry(0.02, 0.02, 1.5, 5), '#b98a55', boatM.clone().multiply(M(s * 0.28, 0.16, -0.1, PI / 2 - 0.15, s * 0.25, 0)));
    const bow = V3(0, 0.18, Lb / 2 - 0.05).applyMatrix4(boatM);
    wood.rope(bow, V3(P.x1 - 0.12, P.y + 0.22, P.z1 - 0.12), 0.015, '#d8c08a', 0.25, 5);
  }

  // ------------------------------------------------------------------ the stepping stones (flat tops at stone.y)
  for (const s of L.STONES) {
    const g = new THREE.CylinderGeometry(s.r, s.r + 0.18, s.y - L.LAGOON.floor + 0.1, 9, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < (s.y - L.LAGOON.floor + 0.1) / 2 - 0.01) { const k = 1 + 0.12 * Math.sin(i * 2.7 + s.z * 5); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    stone.add(g, (x, y) => (y > (s.y - L.LAGOON.floor) / 2 - 0.05 ? '#b3a68e' : '#8f8676'), M(s.x, (s.y + L.LAGOON.floor - 0.1) / 2, s.z, 0, s.z, 0), 0.06);
  }

  // ------------------------------------------------------------------ the wreck (ship-local coordinates)
  const ship = new THREE.Group(); ship.name = 'ship'; ship.position.set(...SH.origin); scene.add(ship);
  const sw = new Batch();
  const H = SH.hull, CS = SH.castle;
  {
    // hull: lofted sections along x; full width at the deck, flared bow and stern below it, keel at y0
    const xs = [-2.0, -1.75, -1.3, -0.7, 0, 0.6, 1.1, 1.45, 1.75, 2.0];
    const ys = [0.8, 0.55, 0.3, 0.05, -0.25, -0.6, -1.0, -1.4, -1.75];
    const gY = [1, 1, 1, 0.97, 0.92, 0.82, 0.66, 0.44, 0.2];
    const kb = [0, 0.1, 0.28, 0.45, 0.6, 0.72, 0.82, 0.9, 0.95], ks = [0, 0.02, 0.05, 0.1, 0.15, 0.2, 0.26, 0.32, 0.4];
    const hw = (x, j) => (H.z1) * gY[j] * (1 - Math.pow(clamp((x - 0.8) / 1.2, 0, 1), 1.5) * kb[j]) * (1 - clamp((-1.4 - x) / 0.6, 0, 1) * ks[j]);
    const bandC = (j) => (j === 1 ? '#d9a441' : j === 0 ? '#6a4024' : j >= 5 ? (j % 2 ? '#4f3420' : '#573a24') : (j % 2 ? '#7a4b2a' : '#704427'));
    const pos = [], cols = [], cc = new THREE.Color();
    const quad = (A, Bq, C, D, c) => { pos.push(...A, ...D, ...C, ...A, ...C, ...Bq); cc.set(c); const k = 1 + rr(-0.05, 0.05); for (let i = 0; i < 6; i++) cols.push(cc.r * k, cc.g * k, cc.b * k); };
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < ys.length - 1; j++) for (const s of [1, -1]) {
        const A = [xs[i], ys[j], s * hw(xs[i], j)], Bq = [xs[i + 1], ys[j], s * hw(xs[i + 1], j)], C = [xs[i + 1], ys[j + 1], s * hw(xs[i + 1], j + 1)], D = [xs[i], ys[j + 1], s * hw(xs[i], j + 1)];
        if (s > 0) quad(A, Bq, C, D, bandC(j)); else quad(Bq, A, D, C, bandC(j));
      }
      const j = ys.length - 1;
      for (const s of [1, -1]) {
        const A = [xs[i], ys[j], s * hw(xs[i], j)], Bq = [xs[i + 1], ys[j], s * hw(xs[i + 1], j)], C = [xs[i + 1], H.y0, 0], D = [xs[i], H.y0, 0];
        if (s > 0) quad(A, Bq, C, D, '#4a301e'); else quad(Bq, A, D, C, '#4a301e');
      }
    }
    for (const [x, sg] of [[xs[0], -1], [xs[xs.length - 1], 1]]) {        // transom and bow caps (fans)
      const ring = ys.map((y, j) => [x, y, hw(x, j)]).concat([[x, H.y0, 0]]).concat(ys.slice().reverse().map((y, j) => [x, y, -hw(x, ys.length - 1 - j)]));
      const c = [x, -0.4, 0];
      for (let k = 0; k < ring.length - 1; k++) {
        const a = ring[k], b = ring[k + 1];
        if (sg > 0) pos.push(...c, ...a, ...b); else pos.push(...c, ...b, ...a);
        cc.set(sg > 0 ? '#6e4426' : '#654023'); for (let i = 0; i < 3; i++) cols.push(cc.r, cc.g, cc.b);
      }
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); hg.computeVertexNormals();
    sw.geos.push(hg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3))); for (let i = 0; i < pos.length / 3; i++) sw.paint.push(-1);
    // rub rails along the deck edge
    for (const s of [-1, 1]) sw.box(H.x1 - H.x0, 0.08, 0.06, 0, H.y1 - 0.1, s * (H.z1 + 0.02), '#4f311b');
    // deck: dark base, planks along x with tops at deck height
    sw.box(H.x1 - H.x0, 0.08, H.z1 - H.z0, 0, H.y1 - 0.1, 0, '#3d2716');
    for (let z = H.z0; z < H.z1 - 0.01; z += 0.2) {
      let x = CS.x1 - 0.02;
      while (x < H.x1 - 0.01) { const w = Math.min(rr(0.9, 1.6), H.x1 - x); sw.box(w - 0.02, 0.06, 0.18, x + w / 2, H.y1 - 0.03, z + 0.1, woodC(), 0.06); x += w; }
    }
    // the stern castle: plank walls, plank top at castle.y1, a door, windows, rails on its outer edges
    const cx = (CS.x0 + CS.x1) / 2, cwid = CS.x1 - CS.x0;
    sw.box(cwid - 0.04, CS.y1 - CS.y0 - 0.06, CS.z1 - CS.z0 - 0.04, cx, (CS.y0 + CS.y1 - 0.06) / 2, 0, '#5a3820');
    for (let k = 0; k < 4; k++) {
      const y = CS.y0 + 0.02 + k * 0.185 + 0.09;
      for (const s of [-1, 1]) sw.box(cwid, 0.17, 0.04, cx, y, s * (CS.z1 - 0.02), k % 2 ? '#7c4d2b' : '#875632', 0.04);
      sw.box(0.04, 0.17, CS.z1 - CS.z0, CS.x0 + 0.02, y, 0, k % 2 ? '#7c4d2b' : '#875632', 0.04);
      sw.box(0.04, 0.17, CS.z1 - SH.castleRamp.z1, CS.x1 - 0.02, y, (CS.z1 + SH.castleRamp.z1) / 2, k % 2 ? '#7c4d2b' : '#875632', 0.04);
    }
    for (let x = CS.x0; x < CS.x1 - 0.01; x += 0.2) sw.box(0.18, 0.06, CS.z1 - CS.z0, x + 0.1, CS.y1 - 0.03, 0, woodC(), 0.06);
    sw.box(0.05, 0.56, 0.42, CS.x1 + 0.005, CS.y0 + 0.3, 0.6, '#3a2414');                         // door
    sw.box(0.06, 0.06, 0.52, CS.x1 + 0.01, CS.y0 + 0.6, 0.6, '#d9a441');
    sw.add(new THREE.SphereGeometry(0.025, 6, 4), '#d9a441', M(CS.x1 + 0.04, CS.y0 + 0.3, 0.45));
    for (const x of [-1.65, -0.98]) {                                                               // windows facing the camera
      sw.box(0.3, 0.24, 0.04, x, CS.y0 + 0.42, CS.z1 + 0.012, '#d9a441');
      sw.box(0.22, 0.16, 0.04, x, CS.y0 + 0.42, CS.z1 + 0.02, '#26323e');
    }
    for (const z of [-0.6, 0.0, 0.6]) { sw.box(0.04, 0.24, 0.26, CS.x0 - 0.012, CS.y0 + 0.42, z, '#d9a441'); sw.box(0.04, 0.16, 0.18, CS.x0 - 0.02, CS.y0 + 0.42, z, '#26323e'); }
    const rail = (a, b, hgt = 0.36) => {                                                            // posts + top rail between two deck points
      const d = b.clone().sub(a), n = Math.max(1, Math.round(d.length() / 0.35));
      for (let i = 0; i <= n; i++) { const p = a.clone().lerp(b, i / n); sw.box(0.05, hgt, 0.05, p.x, p.y + hgt / 2, p.z, '#6a4226'); }
      sw.rod(a.clone().setY(a.y + hgt), b.clone().setY(b.y + hgt), 0.03, '#7a4b2a', 6);
    };
    const e = 0.03, ty = CS.y1;
    rail(V3(CS.x0 + e, ty, CS.z0 + e), V3(CS.x0 + e, ty, CS.z1 - e));
    rail(V3(CS.x0 + e, ty, CS.z1 - e), V3(CS.x1 - e, ty, CS.z1 - e));
    rail(V3(CS.x0 + e, ty, CS.z0 + e), V3(CS.x1 - e, ty, CS.z0 + e));
    // bulwarks on the deck's outer edges, open at the gangplank, the castle ramp and the bridge end
    const bul = (x0, x1, z0, z1, hgt) => sw.box(Math.max(0.07, x1 - x0), hgt, Math.max(0.07, z1 - z0), (x0 + x1) / 2, H.y1 + hgt / 2, (z0 + z1) / 2, '#6f4426', 0.04);
    const cap = (x0, x1, z0, z1, hgt) => sw.box(Math.max(0.09, x1 - x0 + 0.02), 0.04, Math.max(0.09, z1 - z0 + 0.02), (x0 + x1) / 2, H.y1 + hgt + 0.02, (z0 + z1) / 2, '#d9a441');
    const BW = [[SH.castleRamp.a0 + 0.02, H.x1, H.z0, H.z0 + 0.07, 0.34], [CS.x1, PK.x0, H.z1 - 0.07, H.z1, 0.24], [PK.x1, H.x1, H.z1 - 0.07, H.z1, 0.24],
      [H.x1 - 0.07, H.x1, H.z0, -0.55, 0.34], [H.x1 - 0.07, H.x1, 0.62, H.z1, 0.3]];
    for (const b of BW) { bul(...b); cap(...b); }
    // the castle ramp: wedge, planks across it in the ramp plane, a hand-rail along its outer edge
    const CR = SH.castleRamp, RC = rampFrame(CR);
    sw.add(wedgeGeo(CR, 0.05), '#5a3820');
    for (let u = 0; u < RC.len - 0.01; u += 0.2) { const lu = Math.min(0.2, RC.len - u); sw.add(new THREE.BoxGeometry(lu - 0.02, 0.06, RC.W), woodC(), RC.m.clone().multiply(M(u + lu / 2, -0.03, 0)), 0.06); }
    const ra = (u, h, v) => V3(u, h, v).applyMatrix4(RC.m);
    const vOut = (CR.z0 + 0.03 - (CR.z0 + CR.z1) / 2) * Math.sign(RC.ev.z), sgn = 1;
    const posts = [0.25, 0.9, 1.5];
    posts.forEach((u, i) => { const p = ra(u, 0, sgn * vOut); sw.box(0.05, 0.36, 0.05, p.x, p.y + 0.18, p.z, '#6a4226'); if (i) { const q = ra(posts[i - 1], 0, sgn * vOut); sw.rod(q.setY(q.y + 0.36), p.clone().setY(p.y + 0.36), 0.03, '#7a4b2a', 6); } });
    // the gangplank: three boards in the plank's plane, two battens under it
    const RG = rampFrame(PK), bw = (RG.W - 0.05) / 3;
    for (let k = 0; k < 3; k++) sw.add(new THREE.BoxGeometry(RG.len, PK.thick, bw), woodC(), RG.m.clone().multiply(M(RG.len / 2, -PK.thick / 2, -RG.W / 2 + bw / 2 + k * (bw + 0.025))), 0.05);
    for (const u of [0.5, RG.len - 0.5]) sw.add(new THREE.BoxGeometry(0.1, 0.05, RG.W + 0.06), '#5c3a21', RG.m.clone().multiply(M(u, -PK.thick - 0.025, 0)));
    // the broken mast, its yard, the crow's nest, rigging
    const ma = SH.mast, top = H.y1 + ma.h;
    sw.add(new THREE.CylinderGeometry(ma.r * 0.82, ma.r, top - 0.45 - (H.y1 - 0.1), 10), '#7a512e', M(ma.x, (top - 0.45 + H.y1 - 0.1) / 2, ma.z), 0.03);
    {
      const g = new THREE.CylinderGeometry(ma.r * 0.45, ma.r * 0.82, 0.45, 10, 1, false); const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.2) { p.setY(i, p.getY(i) + 0.22 * Math.abs(Math.sin(i * 1.9))); }
      sw.add(g, '#a77d4c', M(ma.x, top - 0.225, ma.z), 0.03);
    }
    for (const y of [1.6, 2.9]) sw.add(new THREE.CylinderGeometry(ma.r * 1.08, ma.r * 1.08, 0.08, 10), '#3a2a1c', M(ma.x, y, ma.z));
    const nestY = top - 1.45;
    sw.add(new THREE.CylinderGeometry(0.5, 0.42, 0.42, 12, 1, true), (x, y, z) => (y > 0.12 ? '#d9a441' : '#7a4b2a'), M(ma.x, nestY + 0.21, ma.z), 0.04);
    sw.add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 12), '#5a3820', M(ma.x, nestY + 0.03, ma.z));
    const yardY = nestY - 0.45;
    sw.add(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), '#6a4528', M(ma.x, yardY, ma.z, 0, RIG, 0).multiply(M(0.2, 0, 0, PI / 2, 0, 0)));
    sw.add(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6), '#6a4528', M(ma.x + 0.18, nestY + 0.95, ma.z - 0.45, 0.75, 0, 0));    // the broken upper yard, hanging askew
    for (const [x, z] of [[-0.35, H.z0 - 0.04], [0.55, H.z0 - 0.04], [1.25, H.z0 - 0.04]]) sw.rod(V3(ma.x, nestY, ma.z), V3(x, H.y1 - 0.1, z), 0.014, '#d2b77f', 4);
    sw.rod(V3(ma.x, nestY, ma.z), V3(CS.x0 + 0.05, CS.y1 + 0.36, CS.z0 + 0.05), 0.014, '#d2b77f', 4);
    // a hole in the hull side facing the camera, splintered planks around it
    {
      const hx = -1.15, hyc = 0.42, shp = new THREE.Shape();
      const pts = 13; for (let k = 0; k < pts; k++) { const a = k / pts * PI * 2, rad = (k % 2 ? 0.17 : 0.26) * (1 + 0.15 * Math.sin(k * 3.1)); const px = Math.cos(a) * rad * 1.25, py = Math.sin(a) * rad * 0.85; if (k) shp.lineTo(px, py); else shp.moveTo(px, py); }
      sw.add(new THREE.ShapeGeometry(shp), '#1d130b', M(hx, hyc, H.z1 + 0.006));
      for (const [dx, dy, rz, ry] of [[-0.3, 0.08, 0.5, -0.4], [0.3, -0.06, -0.4, 0.5], [0.05, 0.24, 0.1, 0.3], [-0.1, -0.22, -0.2, -0.3]]) sw.add(new THREE.BoxGeometry(0.28, 0.05, 0.03), '#a7794a', M(hx + dx, hyc + dy, H.z1 + 0.04, 0, ry, rz));
    }
    // an anchor hanging on the bow side
    {
      const ax = 1.75, az = H.z1 + 0.08;
      sw.add(new THREE.BoxGeometry(0.06, 0.55, 0.05), '#3a3d42', M(ax, 0.35, az));
      sw.add(new THREE.TorusGeometry(0.2, 0.035, 6, 12, PI), '#3a3d42', M(ax, 0.16, az, 0, 0, PI));
      sw.add(new THREE.TorusGeometry(0.07, 0.02, 6, 10), '#3a3d42', M(ax, 0.67, az));
      sw.box(0.3, 0.05, 0.05, ax, 0.55, az, '#3a3d42');
    }
    // lantern on the castle's back corner post
    sw.box(0.12, 0.16, 0.12, CS.x0 + 0.05, CS.y1 + 0.47, CS.z1 - 0.05, '#2f2a24');
    sw.box(0.09, 0.11, 0.13, CS.x0 + 0.05, CS.y1 + 0.47, CS.z1 - 0.05, '#ffcf6a');
  }
  const shipWood = sw.mesh(mats.vc); shipWood.name = 'shipHull'; ship.add(shipWood);

  // ------------------------------------------------------------------ cloth: canvas textures + CPU-animated planes
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t;
  }
  const sailTex = canvasTex(256, 256, (g, w, h) => {
    const Rs = mulberry(5);
    g.clearRect(0, 0, w, h);
    g.beginPath(); g.moveTo(4, 2); g.lineTo(w - 4, 2); g.lineTo(w - 8, h * 0.62);
    for (let x = w - 8; x > 8; x -= 12) g.lineTo(x - 6, h * (0.62 + 0.36 * Rs()) * (x > w * 0.3 && x < w * 0.55 ? 1.12 : 1));
    g.lineTo(6, h * 0.8); g.closePath(); g.fillStyle = '#efe3c6'; g.fill();
    g.strokeStyle = 'rgba(150,120,80,0.45)'; g.lineWidth = 2;
    for (let x = 40; x < w; x += 44) { g.beginPath(); g.moveTo(x, 2); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = '#d8c39b'; g.fillRect(150, 60, 46, 40); g.strokeRect(150, 60, 46, 40);
    g.fillStyle = '#c8b089'; g.fillRect(40, 120, 30, 28);
    g.globalCompositeOperation = 'destination-out';
    for (const [x, y, r] of [[88, 92, 18], [190, 150, 24], [60, 175, 12]]) { g.beginPath(); for (let k = 0; k < 9; k++) { const a = k / 9 * PI * 2, rad = r * (0.6 + 0.6 * Rs()); g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); } g.fill(); }
  });
  const skullTex = canvasTex(128, 96, (g, w, h) => {
    g.fillStyle = '#16161a'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w - 6, 0); for (let y = 0; y <= h; y += 12) g.lineTo(w - 4 - 14 * ((y / 12) % 2), y); g.lineTo(0, h); g.fill();
    g.fillStyle = '#f2ece0'; g.strokeStyle = '#f2ece0'; g.lineCap = 'round'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(32, 70); g.lineTo(88, 30); g.moveTo(32, 30); g.lineTo(88, 70); g.stroke();
    for (const [x, y] of [[32, 70], [88, 30], [32, 30], [88, 70]]) { g.beginPath(); g.arc(x, y, 6, 0, PI * 2); g.fill(); }
    g.beginPath(); g.arc(60, 42, 19, 0, PI * 2); g.fill(); g.fillRect(49, 50, 22, 16);
    g.fillStyle = '#16161a'; g.beginPath(); g.arc(53, 43, 5, 0, PI * 2); g.arc(67, 43, 5, 0, PI * 2); g.fill();
    g.fillRect(52, 60, 3, 6); g.fillRect(58, 60, 3, 6); g.fillRect(64, 60, 3, 6);
  });
  const pennantTex = canvasTex(128, 64, (g, w, h) => {
    g.fillStyle = '#d2413a'; g.beginPath(); g.moveTo(0, 0); g.lineTo(w, 0); g.lineTo(w * 0.78, h / 2); g.lineTo(w, h); g.lineTo(0, h); g.fill();
    g.fillStyle = '#f2c335'; g.fillRect(0, h * 0.4, w * 0.84, h * 0.2);
  });
  const cloth = [];
  function flag(tex, w, h, nx, ny, parent, pos, kind) {
    const g = new THREE.PlaneGeometry(w, h, nx, ny); g.translate(w / 2, 0, 0);
    if (kind === 'sail') g.rotateY(-PI / 2);
    const mat = matte({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5, roughness: 0.9 });
    const m = new THREE.Mesh(g, mat); m.position.copy(pos); m.castShadow = true; m.receiveShadow = true; parent.add(m);
    cloth.push({ m, base: Float32Array.from(g.attributes.position.array), w, h, kind, ph: rr(0, 6) });
    return m;
  }
  // the torn sail hangs under the yard, in front of the mast (wind blows toward +x)
  {
    const ma = SH.mast, nestY = H.y1 + ma.h - 1.45, yardY = nestY - 0.45;
    const rig = new THREE.Group(); rig.position.set(ma.x, 0, ma.z); rig.rotation.y = RIG; ship.add(rig);
    const s = flag(sailTex, 2.3, 1.45, 8, 6, rig, V3(0.27, yardY - 0.72, -1.15), 'sail'); s.name = 'sail';
    const f = flag(skullTex, 0.8, 0.55, 8, 4, ship, V3(ma.x + 0.1, H.y1 + ma.h - 0.75, ma.z), 'flag'); f.name = 'shipFlag';
    const p = flag(pennantTex, 1.0, 0.5, 8, 4, root, V3(F.x1 - 0.12, F.y + 2.95, F.z0 + 0.17), 'flag'); p.name = 'fortFlag';
  }

  // ------------------------------------------------------------------ board spaces
  const spaces = [], spaceInfo = [];
  const sphereFlat = (r, sy) => { const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, sy, 1); return g; };
  function emblem(b, y) {           // a small treasure chest, picture-up toward -z (reads upright from the camera)
    const sh = (pts) => new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, z)));
    const flat = (yy) => M(0, yy, 0, -PI / 2);
    b.add(new THREE.ShapeGeometry(sh([[-0.2, -0.13], [0.2, -0.13], [0.2, 0.03], [-0.2, 0.03]])), '#8a5426', flat(y));
    const lid = new THREE.Shape(); lid.moveTo(-0.2, 0.03); lid.lineTo(0.2, 0.03); lid.absellipse(0, 0.03, 0.2, 0.12, 0, PI, false); lid.lineTo(-0.2, 0.03);
    b.add(new THREE.ShapeGeometry(lid, 8), '#a36a33', flat(y));
    b.add(new THREE.ShapeGeometry(sh([[-0.215, 0.015], [0.215, 0.015], [0.215, 0.05], [-0.215, 0.05]])), '#4a2a12', flat(y + 0.002));
    for (const x of [-0.13, 0.13]) b.add(new THREE.ShapeGeometry(sh([[x - 0.018, -0.13], [x + 0.018, -0.13], [x + 0.018, 0.13], [x - 0.018, 0.13]])), '#4a2a12', flat(y + 0.002));
    b.add(new THREE.ShapeGeometry(sh([[-0.035, -0.03], [0.035, -0.03], [0.035, 0.06], [-0.035, 0.06]])), '#fff0b0', flat(y + 0.004));
    b.add(new THREE.CircleGeometry(0.012, 6), '#3a2410', flat(y + 0.005).multiply(M(0, 0.005, 0)));
  }
  function buildSpace(s) {
    const b = new Batch(), kc = KIND[s.kind] || KIND.blue, top = 0.02;
    const paint = (geo, shade, m) => { const g = b.add(geo, kc, m, 0, shade); return g; };
    let style = s.tag;
    const onRamp = !style && L.rampHeight(FR, s.x, s.z) != null;
    if (style === 'sand' || !style) style = 'sand';
    if (style === 'sand') {
      const stoneRim = onRamp;
      b.add(new THREE.CylinderGeometry(0.57, 0.58, 0.05, 28), stoneRim ? '#b9ab8c' : '#efe2c2', M(0, top - 0.005 - 0.025, 0));
      paint(new THREE.CylinderGeometry(0.46, 0.46, 0.05, 28), 1, M(0, top - 0.025, 0));
      paint(new THREE.RingGeometry(0.29, 0.34, 28), 0.8, M(0, top + 0.003, 0, -PI / 2));
      const n = 16;
      for (let k = 0; k < n; k++) {
        const a = k / n * PI * 2 + 0.1;
        const c = stoneRim ? (k % 2 ? '#8f8577' : '#a9a091') : (k % 4 === 1 ? '#f2b9a4' : k % 2 ? '#fbf3e3' : '#d9cbb0');
        if (!stoneRim && k % 4 === 1) b.add(new THREE.ConeGeometry(0.055, 0.03, 7), c, M(Math.cos(a) * 0.515, top, Math.sin(a) * 0.515, 0, a, 0, 1, 1, 0.8));
        else b.add(sphereFlat(0.058, 0.35), c, M(Math.cos(a) * 0.515, top - 0.01, Math.sin(a) * 0.515, 0, a, 0), 0.06);
      }
    } else if (style === 'stone') {
      paint(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 26), 1, M(0, top - 0.015, 0));
      b.add(new THREE.RingGeometry(0.42, 0.47, 26), '#f6efe0', M(0, top - 0.004, 0, -PI / 2));
      paint(new THREE.RingGeometry(0.25, 0.29, 26), 0.8, M(0, top + 0.003, 0, -PI / 2));
    } else if (style === 'bridge') {
      for (let k = 0; k < 4; k++) paint(new THREE.BoxGeometry(0.2, 0.05, 0.86), k % 2 ? 0.88 : 1, M(-0.33 + k * 0.22, top - 0.025, 0));
      for (let k = 0; k < 4; k++) for (const z of [-0.36, 0.36]) b.add(new THREE.CylinderGeometry(0.016, 0.016, 0.01, 6), '#2b2420', M(-0.33 + k * 0.22, top + 0.004, z));
    } else if (style === 'ship') {
      for (const [w, d, x, z] of [[1.0, 0.1, 0, -0.45], [1.0, 0.1, 0, 0.45], [0.1, 0.8, -0.45, 0], [0.1, 0.8, 0.45, 0]]) b.box(w, 0.06, d, x, top + 0.008 - 0.03, z, '#5a3820', 0.05);
      paint(new THREE.BoxGeometry(0.8, 0.05, 0.8), 1, M(0, top - 0.025, 0));
      for (const z of [-0.27, 0.27]) paint(new THREE.BoxGeometry(0.8, 0.004, 0.035), 0.75, M(0, top + 0.002, z));
    } else if (style === 'fort') {
      b.add(new THREE.BoxGeometry(1.05, 0.05, 1.05), '#ddd2b8', M(0, top - 0.03, 0), 0.03);
      paint(new THREE.BoxGeometry(0.86, 0.05, 0.86), 1, M(0, top - 0.025, 0));
      paint(new THREE.BoxGeometry(0.7, 0.004, 0.7), 0.85, M(0, top + 0.001, 0));
    }
    if (s.kind === 'chest') emblem(b, top + 0.006);
    const geo = b.geometry();
    const shade = Float32Array.from(b.paint);
    const mesh = new THREE.Mesh(geo, mats.space); mesh.receiveShadow = true; mesh.name = 'spaceTop';
    const o = new THREE.Group(); o.name = 'space' + s.id; o.add(mesh); o.userData.spaceId = s.id;
    // orientation: tilted to the slope on ramps and the bridge, flat elsewhere
    let n = V3(0, 1, 0);
    if (onRamp) n = rampFrame(FR).n.clone();
    else if (s.tag === 'bridge') n = rampFrame(BR).n.clone();
    o.quaternion.setFromUnitVectors(V3(0, 1, 0), n);
    if (s.tag === 'ship') { o.position.set(s.x - ox, s.y - SH.origin[1], s.z - oz); ship.add(o); }
    else { o.position.set(s.x, s.y, s.z); root.add(o); }
    spaces[s.id] = o; spaceInfo[s.id] = { mesh, shade, kind: s.kind };
  }
  for (const s of L.SPACES) buildSpace(s);
  function setSpaceColor(id, color) {
    const info = spaceInfo[id]; if (!info) return;
    const c = col(color == null ? KIND[info.kind] || KIND.blue : color), a = info.mesh.geometry.attributes.color;
    for (let i = 0; i < info.shade.length; i++) { const k = info.shade[i]; if (k < 0) continue; a.setXYZ(i, c.r * k, c.g * k, c.b * k); }
    a.needsUpdate = true;
  }

  // ------------------------------------------------------------------ decor around the island
  // palms: on the beach rim, leaning out to sea
  const palmSpots = [];
  for (const [x, z] of [[-6.5, -1.8], [-6.75, -0.2], [6.6, 0.5], [6.25, 2.2], [-1.6, -5.0], [0.2, -5.1]]) {
    const p = spot(x, z, 0.3, (px, pz, h) => h > -0.95 && h < 0.02 && isl(px, pz) > 0.78, { path: 1.25, reach: 0.5, sep: 0.9, kind: 'palm' });
    if (p) palmSpots.push(p);
  }
  // two rocky islets offshore, each with a palm on top (framing the island)
  const islets = [];
  for (const [x, z] of [[8.6, -0.6], [-8.5, 3.4]]) { const p = spot(x, z, 0.9, (px, pz, h) => h < -2.0, { reach: 0.8, sep: 0.5, kind: 'islet' }); if (p) { islets.push(p); palmSpots.push({ kind: 'palm', x: p.x + 0.1, z: p.z, r: 0.3, h: 0.1 }); } }
  const palms = (() => {
    const tg = new Batch(), Ht = 3.1, bend = 0.85, segN = 7;
    const curve = (t) => V3(bend * t * t, Ht * t, 0);
    for (let i = 0; i < segN; i++) {
      const a = curve(i / segN), b = curve((i + 1) / segN), r0 = 0.15 - 0.055 * i / segN, r1 = 0.15 - 0.055 * (i + 1) / segN;
      const d = b.clone().sub(a), q = new THREE.Quaternion().setFromUnitVectors(V3(0, 1, 0), d.clone().normalize());
      tg.add(new THREE.CylinderGeometry(r1, r0 * 1.12, d.length() * 1.04, 7, 1), i % 2 ? '#9a7550' : '#86633f', new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V3(1, 1, 1)));
    }
    const topP = curve(1);
    const cg = new Batch(), fronds = 8;
    for (let k = 0; k < fronds; k++) {
      const phi = k / fronds * PI * 2 + rr(-0.2, 0.2), Lf = rr(1.35, 1.65), dir = V3(Math.cos(phi), 0, Math.sin(phi)), perp = V3(-dir.z, 0, dir.x);
      const W = [0.03, 0.2, 0.27, 0.24, 0.15, 0.0], pos = [], cols = [], cE = col('#7fb64c'), cC = col('#4f8a35');
      const P = (s) => { const t = s / 5; return dir.clone().multiplyScalar(Lf * t).setY(0.42 * Math.sin(PI * t * 0.75) - 0.75 * t * t); };
      for (let s = 0; s < 5; s++) {
        const c0 = P(s), c1 = P(s + 1);
        const l0 = c0.clone().addScaledVector(perp, W[s]).setY(c0.y - 0.07 * W[s] / 0.27), r0 = c0.clone().addScaledVector(perp, -W[s]).setY(c0.y - 0.07 * W[s] / 0.27);
        const l1 = c1.clone().addScaledVector(perp, W[s + 1]).setY(c1.y - 0.07 * W[s + 1] / 0.27), r1 = c1.clone().addScaledVector(perp, -W[s + 1]).setY(c1.y - 0.07 * W[s + 1] / 0.27);
        for (const tri of [[c0, l0, l1], [c0, l1, c1], [c0, c1, r1], [c0, r1, r0]]) for (const v of tri) { pos.push(v.x, v.y, v.z); const cc = v === c0 || v === c1 ? cC : cE; cols.push(cc.r, cc.g, cc.b); }
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); cg.geos.push(g); for (let i = 0; i < pos.length / 3; i++) cg.paint.push(-1);
    }
    for (const [x, z] of [[0.1, 0.05], [-0.08, 0.09], [0.0, -0.11]]) cg.add(new THREE.SphereGeometry(0.085, 7, 5), '#6b4a2a', M(x, -0.1, z));
    const tMesh = new THREE.InstancedMesh(tg.geometry(), mats.vc, Math.max(1, palmSpots.length));
    const cMesh = new THREE.InstancedMesh(cg.geometry(), mats.foliage, Math.max(1, palmSpots.length));
    const list = palmSpots.map((p, i) => {
      const dx = p.x - 0, dz = p.z - L.ISLAND.cz, yaw = Math.atan2(-dz, dx) + rr(-0.35, 0.35), sc = rr(0.85, 1.15);
      const m = M(p.x, p.h - 0.15, p.z, 0, yaw, 0, sc);
      tMesh.setMatrixAt(i, m);
      return { m, crownBase: m.clone().multiply(M(topP.x, topP.y, topP.z, 0, rr(0, 6), 0)), ph: rr(0, 6) };
    });
    tMesh.count = cMesh.count = palmSpots.length;
    for (const im of [tMesh, cMesh]) { im.castShadow = true; im.receiveShadow = true; root.add(im); }
    tMesh.name = 'palmTrunks'; cMesh.name = 'palmCrowns';
    const tmp = new THREE.Matrix4();
    const sway = (t) => { list.forEach((p, i) => { tmp.copy(p.crownBase).multiply(M(0, 0, 0, 0.045 * Math.sin(t * 1.1 + p.ph), 0, 0.06 * Math.sin(t * 0.8 + p.ph * 1.7))); cMesh.setMatrixAt(i, tmp); }); cMesh.instanceMatrix.needsUpdate = true; };
    sway(0);
    return { sway };
  })();

  // campfire ring, treasure chest, barrels, crates
  const fire = spot(-5.9, -1.0, 0.45, (x, z, h) => h > -0.1, { path: 1.2, reach: 1.6, kind: 'campfire' }) || spot(6.6, 1.3, 0.45, (x, z, h) => h > -0.2, { reach: 1.5, kind: 'campfire' });
  if (fire) {
    const { x, z } = fire, y = L.terrainH(x, z);
    for (let k = 0; k < 9; k++) { const a = k / 9 * PI * 2; stone.add(sphereFlat(0.1, 0.65), rockC(), M(x + Math.cos(a) * 0.36, y + 0.03, z + Math.sin(a) * 0.36, 0, a, 0), 0.05); }
    for (let k = 0; k < 3; k++) { const a = k / 3 * PI * 2 + 0.3; wood.add(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), '#6b4426', M(x + Math.cos(a) * 0.08, y + 0.1, z + Math.sin(a) * 0.08, 0, -a, PI / 2 - 0.35)); }
    wood.add(new THREE.ConeGeometry(0.14, 0.38, 6), '#ff9a3a', M(x, y + 0.22, z));
    wood.add(new THREE.ConeGeometry(0.08, 0.26, 6), '#ffd25a', M(x + 0.04, y + 0.2, z + 0.03));
    wood.add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 5), '#5c3a21', M(x, y + 0.42, z, 0, 0, PI / 2));       // spit
    for (const s of [-1, 1]) wood.add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), '#5c3a21', M(x + s * 0.33, y + 0.22, z));
  }
  let chestP = null;
  for (const [x, z] of [[6.3, 1.35], [-6.1, 0.1], [-5.6, -1.9], [0.4, -4.9]]) if (!chestP) chestP = spot(x, z, 0.35, (px, pz, h) => h > -0.3, { reach: 0.8, kind: 'chest' });
  if (chestP) {
    const { x, z } = chestP, y = L.terrainH(x, z) - 0.02, ry = rr(-0.6, 0.6), m = M(x, y, z, 0, ry, 0);
    const at = (px, py, pz, rx = 0) => m.clone().multiply(M(px, py, pz, rx));
    wood.add(new THREE.BoxGeometry(0.6, 0.32, 0.4), '#8a5426', at(0, 0.16, 0));
    wood.add(new THREE.BoxGeometry(0.5, 0.05, 0.3), '#f2c335', at(0, 0.33, 0), 0.08);
    for (let k = 0; k < 7; k++) wood.add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8), '#f6cf4a', at(rr(-0.2, 0.2), 0.36 + rr(0, 0.04), rr(-0.1, 0.1), rr(-0.4, 0.4)));
    const lidM = at(0, 0.32, -0.2, -1.1);
    wood.add(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 10, 1, false, 0, PI), '#a36a33', lidM.clone().multiply(M(0, 0, 0.2, 0, 0, PI / 2)).multiply(M(0, 0, 0, 0, PI / 2, 0)));
    for (const sx of [-0.2, 0.2]) wood.add(new THREE.BoxGeometry(0.05, 0.33, 0.42), '#4a2a12', at(sx, 0.16, 0));
    wood.add(new THREE.BoxGeometry(0.07, 0.09, 0.03), '#f2d36a', at(0, 0.25, 0.21));
  }
  {
    const barrelGeo = new THREE.LatheGeometry([[0, 0], [0.2, 0], [0.214, 0.07], [0.222, 0.1], [0.232, 0.14], [0.25, 0.3], [0.232, 0.46], [0.222, 0.5], [0.214, 0.53], [0.2, 0.6], [0, 0.6]].map(([r, y]) => new THREE.Vector2(r, y)), 10);
    const barrelCol = (x, y) => ((y > 0.07 && y < 0.14) || (y > 0.46 && y < 0.53) ? '#3d3a36' : y > 0.595 || y < 0.005 ? '#6b4426' : '#94603a');
    const bs = [];
    for (const [x, z] of [[-6.7, -0.3], [-5.5, -1.9], [-6.6, 1.6], [6.9, 0.6], [0.9, -4.9]]) {
      const p = spot(x, z, 0.28, (px, pz, h) => h > -0.45, { reach: 1.0, kind: 'barrel' });
      if (p) bs.push(p);
    }
    for (const p of bs) {
      const y = L.terrainH(p.x, p.z);
      if (R() < 0.3) wood.add(barrelGeo.clone(), barrelCol, M(p.x, y + 0.23, p.z, PI / 2, rr(0, 6), 0, 0.95).multiply(M(0, -0.3, 0)));   // lying on its side
      else wood.add(barrelGeo.clone(), barrelCol, M(p.x, y - 0.02, p.z, 0, rr(0, 6), 0, rr(0.9, 1.05)));
    }
    barrelGeo.dispose();
    for (const [x, z] of [[-7.0, 1.3], [6.4, 2.2]]) {
      const p = spot(x, z, 0.3, (px, pz, h) => h > -0.45, { reach: 1.0, kind: 'crate' });
      if (p) { const y = L.terrainH(p.x, p.z), ry = rr(0, 1.5); wood.add(new THREE.BoxGeometry(0.42, 0.42, 0.42), '#a4733f', M(p.x, y + 0.19, p.z, 0, ry, 0), 0.05); wood.add(new THREE.BoxGeometry(0.44, 0.06, 0.44), '#6b4426', M(p.x, y + 0.3, p.z, 0, ry, 0)); }
    }
  }
  // rocks: shoreline boulders and the fort's cliff foot (instanced, flat shaded)
  const rockSpots = [];
  for (const [x, z, s] of [[2.6, -5.5, 0.8], [3.8, -5.6, 1.0], [5.2, -5.6, 0.9], [6.5, -5.5, 1.1], [7.0, -4.4, 0.9], [7.1, -3.1, 0.85], [6.95, -2.0, 0.6], [-7.2, -3.9, 0.7], [-6.9, -5.0, 0.6]]) {
    const p = spot(x, z, 0.4 * s, (px, pz, h) => h < -0.3, { path: 1.2, reach: 0.6, sep: -0.3, kind: 'rock' });
    if (p) { p.s = s; rockSpots.push(p); }
  }
  for (const p of scatter(16, 0.35, (x, z, h) => h < -0.25 && h > -1.6 && isl(x, z) > 0.85, { path: 1.2, sep: 0.4, kind: 'rock', area: { x0: -8.5, x1: 8.5, z0: -6.5, z1: 5.8 } })) { p.s = rr(0.45, 0.85); rockSpots.push(p); }
  for (const p of scatter(4, 0.25, (x, z, h) => h > -0.6 && h < 0.05, { path: 1.2, sep: 0.5, kind: 'rock' })) { p.s = rr(0.3, 0.5); rockSpots.push(p); }
  for (const il of islets) for (let k = 0; k < 6; k++) {                       // islet: a heap of boulders breaking the surface
    const a = k / 6 * PI * 2 + rr(-0.3, 0.3), d = k ? rr(0.55, 0.9) : 0;
    rockSpots.push({ kind: 'isletRock', x: il.x + Math.cos(a) * d, z: il.z + Math.sin(a) * d, h: L.SEABED_Y, s: k ? rr(0.8, 1.15) : 1.3, top: k ? L.WATER_Y + rr(0.15, 0.45) : 0.05 });
  }
  {
    const g = new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position, key = (i) => `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`, off = {};
    for (let i = 0; i < p.count; i++) { const k = key(i); off[k] ??= 0.8 + 0.35 * mulberry(k.length * 131 + i)(); }
    for (let i = 0; i < p.count; i++) { const f = off[key(i)]; p.setXYZ(i, p.getX(i) * f, p.getY(i) * f * 0.75, p.getZ(i) * f); }
    g.computeVertexNormals();
    const im = new THREE.InstancedMesh(g, matte({ color: '#ffffff', flatShading: true, roughness: 0.95 }), rockSpots.length);
    rockSpots.forEach((r, i) => {
      // sit on the ground, or (in deeper water) ride up so the top breaks the surface; the deep sea hides what is under it
      const sy = r.s * rr(0.7, 1.0), y = Math.max(Math.max(r.h, L.SEABED_Y), (r.top ?? L.WATER_Y + 0.3 * r.s) - sy * 0.8);
      im.setMatrixAt(i, M(r.x, y, r.z, rr(-0.15, 0.15), rr(0, 6), rr(-0.15, 0.15), r.s * rr(0.9, 1.2), sy, r.s * rr(0.9, 1.2)));
      im.setColorAt(i, col(rockC()));
    });
    im.castShadow = true; im.receiveShadow = true; im.name = 'rocks'; root.add(im);
  }

  // shells and grass tufts (tiny, walk-through: kept off the spaces and the middle of the paths)
  for (const p of scatter(34, 0.06, (x, z, h) => h > -0.48 && h < 0.02 && L.lagoonR(x, z) > 1.12, { path: 0.55, sep: 0.25, kind: 'shell' })) {
    const y = L.terrainH(p.x, p.z), c = ['#fbefe0', '#f4c8b6', '#ead7b2', '#f7dfe8'][Math.floor(R() * 4)];
    if (R() < 0.6) wood.add(new THREE.ConeGeometry(0.07, 0.035, 8), c, M(p.x, y + 0.012, p.z, 0, rr(0, 6), 0, 1, 1, 0.85));
    else wood.add(new THREE.ConeGeometry(0.035, 0.11, 6), c, M(p.x, y + 0.03, p.z, PI / 2 - 0.2, rr(0, 6), 0));
  }
  for (const p of scatter(40, 0.18, (x, z, h) => h > -0.08 && L.lagoonR(x, z) > 1.15, { path: 0.5, sep: 0.3, kind: 'tuft' })) {
    const y = L.terrainH(p.x, p.z), n = 5 + Math.floor(R() * 3), hgt = rr(0.22, 0.4);
    for (let k = 0; k < n; k++) {
      const a = k / n * PI * 2 + rr(-0.3, 0.3), g = new THREE.BufferGeometry();
      const lean = rr(0.25, 0.6), tx = Math.cos(a) * hgt * lean, tz = Math.sin(a) * hgt * lean, w = 0.035;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-Math.sin(a) * w, 0, Math.cos(a) * w, Math.sin(a) * w, 0, -Math.cos(a) * w, tx, hgt * rr(0.75, 1.1), tz], 3));
      g.computeVertexNormals();
      plants.add(g, (x, yy) => (yy > hgt * 0.4 ? '#8fbf52' : '#5f9440'), M(p.x, y - 0.01, p.z));
    }
  }

  // ------------------------------------------------------------------ crabs and seagulls (instanced, animated)
  const crabGeo = (() => {
    const b = new Batch();
    b.add(sphereFlat(0.09, 0.45), '#e0583a', M(0, 0.05, 0, 0, 0, 0, 1.2, 1, 1));
    for (const s of [-1, 1]) {
      for (let k = 0; k < 3; k++) b.rod(V3(s * 0.06, 0.04, -0.04 + k * 0.04), V3(s * 0.16, 0.0, -0.06 + k * 0.06), 0.012, '#c94a30', 4);
      b.add(sphereFlat(0.04, 0.6), '#e0583a', M(s * 0.09, 0.06, 0.12));
      b.rod(V3(s * 0.04, 0.06, 0.05), V3(s * 0.09, 0.06, 0.12), 0.014, '#c94a30', 4);
      b.rod(V3(s * 0.03, 0.08, 0.05), V3(s * 0.035, 0.13, 0.07), 0.008, '#2a1d18', 4);
    }
    return b.geometry();
  })();
  const crabSpots = scatter(3, 0.15, (x, z, h) => h < -0.05 && h > -0.47, { path: 0.5, sep: 1.5, kind: 'crab' });
  const crabs = new THREE.InstancedMesh(crabGeo, mats.vc, Math.max(1, crabSpots.length));
  crabs.count = crabSpots.length; crabs.castShadow = true; crabs.name = 'crabs'; root.add(crabs);
  crabSpots.forEach((c) => { c.yaw = rr(0, 6); c.ph = rr(0, 6); });
  const gullGeo = (() => {
    const b = new Batch();
    b.add(sphereFlat(0.09, 0.8), '#f5f5f2', M(0, 0, 0, 0, 0, 0, 1, 1, 2.2));
    for (const s of [-1, 1]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.02, 0.1, 0, 0.02, -0.08, s * 0.35, 0.12, -0.02, s * 0.35, 0.12, -0.02, 0, 0.02, -0.08, s * 0.65, 0.02, -0.12].map((v, i) => v), 3));
      g.computeVertexNormals(); b.add(g, (x) => (Math.abs(x) > 0.45 ? '#3d3f45' : '#e9eae6'));
    }
    b.add(new THREE.ConeGeometry(0.025, 0.08, 5), '#f2b53a', M(0, 0, 0.23, PI / 2));
    return b.geometry();
  })();
  const gullMat = matte({ vertexColors: true, side: THREE.DoubleSide });
  const gulls = new THREE.InstancedMesh(gullGeo, gullMat, 3); gulls.name = 'gulls'; root.add(gulls);
  const gullPaths = [{ cx: -9, cz: -3, r: 4, y: 7.5, w: 0.35, ph: 0 }, { cx: -8.2, cz: -2.2, r: 3.2, y: 8.2, w: 0.42, ph: 2 }, { cx: 10, cz: -6, r: 4.5, y: 9, w: -0.3, ph: 4 }];

  // ------------------------------------------------------------------ a pirate ship far offshore (out of play)
  const farShip = (() => {
    const b = new Batch();
    b.box(5, 1.2, 1.4, 0, 0.3, 0, '#3e2c22'); b.box(1.6, 0.8, 1.4, -2.0, 1.3, 0, '#3e2c22'); b.box(4.8, 0.12, 1.45, 0, 0.75, 0, '#c79a3c');
    b.add(new THREE.ConeGeometry(0.72, 1.6, 4), '#3e2c22', M(3.2, 0.35, 0, 0, PI / 4, -PI / 2, 1, 1, 0.98));
    for (const [x, hgt] of [[-1.0, 4.4], [0.6, 5.2], [2.0, 4.0]]) {
      b.box(0.14, hgt, 0.14, x, 0.9 + hgt / 2, 0, '#3e2c22');
      for (const [y, w] of [[0.9 + hgt * 0.45, 1.9], [0.9 + hgt * 0.78, 1.4]]) b.box(0.08, hgt * 0.28, w, x + 0.12, y, 0, '#e7dcc3');
    }
    b.box(0.02, 0.45, 0.7, 0.62, 0.9 + 5.2 + 0.2, 0.35, '#18181b');
    b.rod(V3(3.8, 0.9, 0), V3(2.0, 4.9, 0), 0.03, '#3e2c22'); b.rod(V3(-2.8, 1.7, 0), V3(-1.0, 5.3, 0), 0.03, '#3e2c22');
    const m = b.mesh(mats.vc, false, false); m.name = 'farShip';
    m.position.set(-19, L.WATER_Y - 0.25, -25); m.rotation.y = 0.35; m.scale.setScalar(1.3); root.add(m);
    return m;
  })();

  // ------------------------------------------------------------------ assemble the static batches
  for (const [b, mat, name, cast] of [[wood, mats.vc, 'coveWood', true], [stone, mats.vcFlat, 'coveStone', true], [plants, mats.foliage, 'coveTufts', false]]) {
    const m = b.mesh(mat, cast, true); if (!m) continue; m.name = name; m.matrixAutoUpdate = false; m.updateMatrix(); root.add(m);
  }
  terrain.matrixAutoUpdate = false; terrain.updateMatrix();
  root.userData.decor = placed;

  // ------------------------------------------------------------------ ambient animation
  const tmpM = new THREE.Matrix4();
  function update(dt, t) {
    palms.sway(t);
    for (const c of cloth) {
      const p = c.m.geometry.attributes.position, b = c.base;
      for (let i = 0; i < p.count; i++) {
        const x = b[i * 3], y = b[i * 3 + 1], z = b[i * 3 + 2];
        if (c.kind === 'sail') {
          const u = z / c.w, v = 0.5 - y / c.h, belly = 0.2 * Math.sin(PI * clamp(u, 0, 1)) * (0.35 + 0.65 * v);
          p.setX(i, x + belly + 0.045 * v * Math.sin(t * 2.1 + u * 5 + c.ph));
        } else {
          const d = x / c.w;
          p.setZ(i, z + d * (0.09 * Math.sin(t * 6.5 - d * 5 + c.ph) + 0.03 * Math.sin(t * 11 - d * 9 + y * 4)));
          p.setY(i, y - d * d * 0.05);
        }
      }
      p.needsUpdate = true; c.m.geometry.computeVertexNormals();
    }
    crabSpots.forEach((c, i) => {
      const s = Math.sin(t * 0.6 + c.ph), wob = Math.sin(t * 14 + c.ph) * 0.015;
      const dx = Math.cos(c.yaw) * s * 0.25, dz = -Math.sin(c.yaw) * s * 0.25;
      tmpM.copy(M(c.x + dx, L.terrainH(c.x + dx, c.z + dz) + Math.abs(wob), c.z + dz, 0, c.yaw + wob * 3, 0));
      crabs.setMatrixAt(i, tmpM);
    });
    if (crabSpots.length) crabs.instanceMatrix.needsUpdate = true;
    gullPaths.forEach((g, i) => {
      const a = t * g.w + g.ph, x = g.cx + Math.cos(a) * g.r, z = g.cz + Math.sin(a) * g.r, yaw = Math.atan2(-Math.sin(a) * g.w, Math.cos(a) * g.w);
      tmpM.copy(M(x, g.y + 0.3 * Math.sin(t * 0.9 + g.ph), z, 0, yaw, -Math.sign(g.w) * 0.35 + 0.15 * Math.sin(t * 3 + g.ph)));
      gulls.setMatrixAt(i, tmpM);
    });
    gulls.instanceMatrix.needsUpdate = true;
    farShip.position.y = L.WATER_Y - 0.25 + 0.06 * Math.sin(t * 0.7);
    farShip.rotation.z = 0.025 * Math.sin(t * 0.55);
  }
  update(0, 0);

  return { root, terrain, ship, water, spaces, setSpaceColor, cannon, update };
}
