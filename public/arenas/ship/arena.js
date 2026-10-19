// TABLETOP arena: Sinking Ship, on the arena kit (../kit/KIT.md). A destructible toy galleon in a storm that lists
// and sinks while a disaster plays out. The ship is a moving arena frame: everything aboard lives in ship space and
// rides the kinematic hull (list + sink); the kit's hazards, bots, camera and characters work in that frame.
// Port of ship/main.js (kept as the published fallback): same pose, hull, sea, rain, sails, masts-as-lightning-rods.
import * as THREE from 'three';
import { GLB_BASE64, SUPPORT } from './shippieces.js';
import * as L from './layout.js';

const DT = 1 / 60;
const WAVE = (x, z, t) => 0.10 * Math.sin(0.35 * x + 1.1 * t) + 0.07 * Math.sin(0.5 * z - 0.9 * t + 0.3 * x) + 0.04 * Math.sin(1.3 * x + 0.8 * z + 2.1 * t);
const WAVE_GLSL = `uniform float uTime; uniform float uAmp; uniform float uLevel; varying float vH;
float waveH(vec2 p){ return uAmp*(0.10*sin(0.35*p.x+1.1*uTime)+0.07*sin(0.5*p.y-0.9*uTime+0.3*p.x)+0.04*sin(1.3*p.x+0.8*p.y+2.1*uTime)); }
`;

// ---------------------------------------------------------------- ship pose: the arena frame (list + sink + bob)
const cur = { pos: new THREE.Vector3(0, 1.7, 0), quat: new THREE.Quaternion(), inv: new THREE.Quaternion() };
const nxt = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const dQ = new THREE.Quaternion(); const EUL = new THREE.Euler();
const ship = { sink: 0, listSign: 1 };
function poseAt(t, sink, out) {
  const d = Math.PI / 180;
  EUL.set(ship.listSign * (17 * sink + 1.5 * Math.sin(0.7 * t)) * d, 0, -(7 * sink + 0.8 * Math.sin(0.53 * t + 1)) * d, 'XYZ');
  out.quat.setFromEuler(EUL); out.pos.set(0, 1.7 - 0.75 * sink + 0.06 * Math.sin(1.1 * t), 0);
}
const _tw = new THREE.Vector3();
const frame = {
  toWorld: (x, y, z, out = new THREE.Vector3()) => out.set(x, y, z).applyQuaternion(cur.quat).add(cur.pos),
  toLocal: (v, out = new THREE.Vector3()) => out.copy(v).sub(cur.pos).applyQuaternion(cur.inv),
  dirToWorld: (x, z) => { const v = new THREE.Vector3(x, 0, z).applyQuaternion(cur.quat); v.y = 0; return v.normalize(); },
  // every kinematic body here is part of the ship: velocity of point p moving from the current to the next pose
  groundVelocity: (rb, p, out) => {
    if (!rb.isKinematic()) return out.set(0, 0, 0);
    _tw.copy(p).sub(cur.pos).applyQuaternion(dQ).add(nxt.pos);
    return out.copy(_tw).sub(p).multiplyScalar(1 / DT);
  },
  object: null,
};

// ---------------------------------------------------------------- visuals (persist across rounds)
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...o });
function addBox(parent, [x0, y0, z0], [x1, y1, z1], mat, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
const hullW = (x) => (x >= L.BOW_X ? 3.24 - 0.2 * Math.max(0, (x - 4.5) / 2.94) ** 2 : 3.24 * Math.pow(Math.max(0, (x - L.BOW_TIP) / (L.BOW_X - L.BOW_TIP)), 0.55));
function buildHull(shipGroup) {
  const occ = [];
  const N = 48, K = 28, x0 = L.BOW_TIP, x1 = 7.44; const P = [], C = [], I = [];
  const cBody = new THREE.Color('#8a4630'), cDark = new THREE.Color('#6e3524'), cStripe = new THREE.Color('#f2d9a2'), cCopper = new THREE.Color('#2f7466'), cTrim = new THREE.Color('#e3b25a');
  for (let i = 0; i <= N; i++) {
    const xx = x0 + (x1 - x0) * i / N;
    const W = hullW(xx), Dp = 2.45 - 0.9 * Math.max(0, (L.BOW_X - xx) / 3.6), top = 0.14 + (xx < L.BOW_X ? 0.62 * ((L.BOW_X - xx) / 3.6) ** 1.4 : 0);
    for (let k = 0; k <= K; k++) {
      const ph = Math.PI * k / K, c = Math.cos(ph), s = Math.sin(ph);
      const z = W * Math.sign(c) * Math.abs(c) ** 0.42, y = top - (top + Dp) * s ** 1.7;
      P.push(xx, y, z);
      const col = y > top - 0.08 ? cTrim : y > -0.42 && y < -0.2 ? cStripe : y < -1.15 ? cCopper : (Math.floor((y + 4) / 0.3) % 2 ? cBody : cDark);
      C.push(col.r, col.g, col.b);
    }
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < K; k++) { const a = i * (K + 1) + k, b = a + K + 1; I.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setIndex(I); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; shipGroup.add(m);
  const hullMat = std('#8a4630'), trim = std('#e3b25a', { roughness: 0.5, metalness: 0.3 }), wood = std('#a87a4f'), plank = std('#5c3d2e');
  // stern castle sides, transom with glowing windows (the near side fades when it hides someone in the cabin)
  for (const s of [-1, 1]) {
    const side = addBox(shipGroup, [3.43, 0.1, s > 0 ? 3.0 : -3.26], [7.44, 1.93, s > 0 ? 3.26 : -3.0], hullMat);
    const tr = addBox(shipGroup, [3.4, 1.93, s > 0 ? 2.98 : -3.3], [7.48, 2.05, s > 0 ? 3.3 : -2.98], trim);
    const wins = [];
    for (const wx of [4.4, 5.6, 6.7]) wins.push(addBox(shipGroup, [wx - 0.25, 0.75, s > 0 ? 3.25 : -3.29], [wx + 0.25, 1.25, s > 0 ? 3.29 : -3.25], std('#ffcf7a', { emissive: '#ffb04a', emissiveIntensity: 1.4 }), false));
    if (s > 0) occ.push(side, tr, ...wins);
  }
  addBox(shipGroup, [7.3, -2.2, -3.3], [7.56, 1.95, 3.3], hullMat);
  addBox(shipGroup, [7.28, 1.93, -3.34], [7.6, 2.05, 3.34], trim);
  for (const wz of [-1.8, -0.6, 0.6, 1.8]) addBox(shipGroup, [7.55, 0.5, wz - 0.3], [7.6, 1.2, wz + 0.3], std('#ffcf7a', { emissive: '#ffb04a', emissiveIntensity: 1.4 }), false);
  // foredeck: a solid extruded slab (a one-sided plane once faced down and showed the sea through the bow)
  const fd = new THREE.Shape(); fd.moveTo(L.BOW_X + 0.02, -3.24); fd.lineTo(L.BOW_TIP + 0.15, 0); fd.lineTo(L.BOW_X + 0.02, 3.24); fd.closePath();
  const fdg = new THREE.ExtrudeGeometry(fd, { depth: 0.25, bevelEnabled: false }); fdg.rotateX(-Math.PI / 2); fdg.translate(0, -0.249, 0);
  const fdm = new THREE.Mesh(fdg, plank); fdm.receiveShadow = true; fdm.castShadow = true; shipGroup.add(fdm);
  for (const s of [-1, 1]) {
    const a = new THREE.Vector2(L.BOW_X, s * 3.12), b = new THREE.Vector2(L.BOW_TIP + 0.1, 0); const len = a.distanceTo(b);
    const w = addBox(shipGroup, [-len / 2, 0, -0.1], [len / 2, 0.9, 0.1], hullMat); w.position.set((a.x + b.x) / 2, 0.45, (a.y + b.y) / 2); w.rotation.y = Math.atan2(-(b.y - a.y), b.x - a.x);
    const t = addBox(shipGroup, [-len / 2, 0.9, -0.13], [len / 2, 1.0, 0.13], trim); t.position.copy(w.position).setY(0.95); t.rotation.y = w.rotation.y;
    if (s > 0) occ.push(w, t);
  }
  const bs = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 3.6, 10), wood); bs.position.set(L.BOW_TIP - 0.9, 0.95, 0); bs.rotation.z = Math.PI / 2 - 0.35; bs.castShadow = true; shipGroup.add(bs);
  // ramp (steps) and its raised side bulwark
  const rx0 = L.RAMP.x0, rx1 = L.RAMP.x1, rl = Math.hypot(rx1 - rx0, L.STERN_Y), ang = Math.atan2(L.STERN_Y, rx1 - rx0);
  for (let i = 0; i < 9; i++) { const xa = rx0 + (rx1 - rx0) * i / 9, xb = rx0 + (rx1 - rx0) * (i + 1) / 9, h = L.STERN_Y * (i + 1) / 9; addBox(shipGroup, [xa, 0, L.RAMP.z0], [xb + 0.02, h, 2.9], i % 2 ? wood : std('#b98a5c')); }
  const side = addBox(shipGroup, [-rl / 2, -0.05, -0.1], [rl / 2, 1.0, 0.1], hullMat); side.position.set((rx0 + rx1) / 2, L.STERN_Y / 2 + 0.55, 3.05); side.rotation.z = ang; occ.push(side);
  const lantern = new THREE.PointLight(0xffb060, 5, 7, 2); lantern.position.set(5.4, 1.1, 0); shipGroup.add(lantern);
  for (const z of [-2.9, 2.9]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), std('#ffd27a', { emissive: '#ffb04a', emissiveIntensity: 2 })); l.position.set(7.15, 2.95, z); shipGroup.add(l); addBox(shipGroup, [7.1, 1.8, z - 0.04], [7.2, 2.85, z + 0.04], wood); }
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.06, 8, 18), wood); wheel.position.set(6.3, 2.75, 0); wheel.rotation.y = Math.PI / 2; wheel.castShadow = true; shipGroup.add(wheel);
  addBox(shipGroup, [6.25, 1.8, -0.08], [6.4, 2.7, 0.08], wood);
  return occ;
}

const state = { V: null, hullBody: null, kinPieces: [], masts: [], props: [], sails: [], flags: [], rods: [], lastFlash: 0 };

function buildStatic(ctx) {
  const { scene, renderer } = ctx;
  {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, '#191a38'); gr.addColorStop(0.45, '#3d3466'); gr.addColorStop(0.8, '#9a5a6e'); gr.addColorStop(1, '#e89a6a');
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; scene.background = t;
  }
  scene.fog = new THREE.Fog(0x4e4068, 38, 110);
  renderer.toneMappingExposure = 1.05;
  const hemi = new THREE.HemisphereLight(0xffe2c8, 0x2a3552, 1.25); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc48a, 1.9);
  sun.position.set(-9, 16, 10); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 11, bottom: -11, near: 1, far: 50 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x8fa0ff, 0.8); rim.position.set(6, 10, -14); scene.add(rim);
  // sea: shader waves, mirrored in JS for gameplay (water.height)
  const seaU = { uTime: { value: 0 }, uAmp: { value: 1 }, uLevel: { value: 0 } };
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x1d6474, roughness: 0.5, metalness: 0.05, transparent: true, opacity: 0.9 });
  seaMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, seaU);
    sh.vertexShader = WAVE_GLSL + sh.vertexShader
      .replace('#include <beginnormal_vertex>', `float e = 0.15; vec2 p0 = position.xz;
        vec3 objectNormal = normalize(vec3(-(waveH(p0+vec2(e,0.))-waveH(p0-vec2(e,0.)))/(2.*e), 1.0, -(waveH(p0+vec2(0.,e))-waveH(p0-vec2(0.,e)))/(2.*e)));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); vH = waveH(position.xz) / max(uAmp, 0.01); transformed.y += vH * uAmp + uLevel;');
    sh.fragmentShader = 'varying float vH;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.62, diffuseColor.rgb, smoothstep(-0.18, 0.08, vH));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.95, 0.96), smoothstep(0.17, 0.2, vH) * 0.25);   // faint whitecaps (at 35 deg strong ones read as floating paper)`);
  };
  const seaGeo = new THREE.PlaneGeometry(240, 240, 140, 140); seaGeo.rotateX(-Math.PI / 2);
  const sea = new THREE.Mesh(seaGeo, seaMat); sea.receiveShadow = true; sea.frustumCulled = false; scene.add(sea);
  // rain (stormy look, cheap; fixed pattern)
  const RAIN = 700; const rainPos = new Float32Array(RAIN * 6);
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3).setUsage(THREE.DynamicDrawUsage));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbcc8ff, transparent: true, opacity: 0.35 })); rain.frustumCulled = false; scene.add(rain);
  let rs = 99; const rr = () => { rs = (rs * 16807) % 2147483647; return rs / 2147483647; };
  const rainDrops = Array.from({ length: RAIN }, () => [rr() * 50 - 25, rr() * 22, rr() * 40 - 20]);
  const shipGroup = new THREE.Group(); shipGroup.name = 'ship'; scene.add(shipGroup); frame.object = shipGroup;
  const occ = buildHull(shipGroup);
  const sailMat = new THREE.MeshStandardMaterial({ color: '#f3e6c8', roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const sailStripe = new THREE.MeshStandardMaterial({ color: '#c8503c', roughness: 0.9, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  return { hemi, sun, rim, seaU, sea, rain, rainGeo, rainPos, rainDrops, RAIN, shipGroup, occ, sailMat, sailStripe };
}

// sails/yards/flags hang on mast chunk meshes, so they fall with the mast
function sailGeo(w, h, belly) {
  const g = new THREE.PlaneGeometry(w, h, 10, 6); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2); p.setZ(i, belly * (1 - x * x) * (1 - 0.5 * y * y)); }
  g.computeVertexNormals(); return g;
}
function rigMast(piece, spec) {
  const V = state.V;
  const chunks = piece.chunks.filter((c) => piece.def.chunks[c.idx].part === 'mast').sort((a, b) => a.local.y - b.local.y);
  const at = (y) => chunks.find((c, i) => i === chunks.length - 1 || chunks[i + 1].local.y - (chunks[i + 1].local.y - c.local.y) / 2 > y) || chunks[0];
  const hang = (y, obj) => { const ch = at(y); if (!ch.mesh) return; obj.position.sub(ch.local); ch.mesh.add(obj); };
  const yard = std('#7a5232');
  for (const [y0, y1, w] of spec.sails) {
    const g = new THREE.Group(); g.position.set(0, (y0 + y1) / 2, 0); g.rotation.y = Math.PI / 2 - 0.5;
    const s = new THREE.Mesh(sailGeo(w, y1 - y0, 0.45), V.sailMat); s.castShadow = true; g.add(s);
    const st = new THREE.Mesh(sailGeo(w * 0.98, (y1 - y0) * 0.22, 0.46), V.sailStripe); st.position.y = 0.05; st.position.z = 0.01; g.add(st);
    const yd = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, w + 0.6, 8), yard); yd.rotation.z = Math.PI / 2; yd.position.set(0, (y1 - y0) / 2 + 0.05, 0); yd.castShadow = true; g.add(yd);
    hang((y0 + y1) / 2, g); state.sails.push(s, st);
  }
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ color: '#7a3cc8', side: THREE.DoubleSide, emissive: '#3a1060', emissiveIntensity: 0.6 }));
  flag.geometry.translate(0.45, 0, 0); flag.position.set(0, spec.top - 0.2, 0); hang(spec.top - 0.2, flag); state.flags.push(flag);
}

function buildHullColliders(ctx) {
  const { world, RAPIER } = ctx;
  const hullBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cur.pos.x, cur.pos.y, cur.pos.z).setRotation(cur.quat));
  const add = (d) => world.createCollider(d.setFriction(0.6), hullBody);
  const cub = (cx, cy, cz, hx, hy, hz, q) => { const d = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz); if (q) d.setRotation(q); return add(d); };
  for (const s of [-1, 1]) { cub(1.12, -1.18, s * 3.12, 6.24, 1.3, 0.12); cub(5.4, 1.0, s * 3.13, 1.98, 0.95, 0.13); }
  cub(7.44, -0.3, 0, 0.12, 2.2, 3.3);
  add(RAPIER.ColliderDesc.convexHull(new Float32Array([L.BOW_X + 0.02, 0, -3.24, L.BOW_X + 0.02, 0, 3.24, L.BOW_TIP, 0, 0, L.BOW_X + 0.02, -2.4, -3.0, L.BOW_X + 0.02, -2.4, 3.0, L.BOW_TIP + 0.4, -1.4, 0])));
  for (const s of [-1, 1]) {
    const ax = L.BOW_X, az = s * 3.12, bx = L.BOW_TIP + 0.1, bz = 0; const len = Math.hypot(bx - ax, bz - az);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-(bz - az), bx - ax));
    cub((ax + bx) / 2, 0.45, (az + bz) / 2, len / 2, 0.5, 0.1, q);
  }
  const { x0, x1, z0 } = L.RAMP, z1 = 2.86, H = L.STERN_Y;
  add(RAPIER.ColliderDesc.convexHull(new Float32Array([x0, 0, z0, x1, 0, z0, x1, H, z0, x0, 0, z1, x1, 0, z1, x1, H, z1])));
  const rl = Math.hypot(x1 - x0, H), ang = Math.atan2(H, x1 - x0);
  cub((x0 + x1) / 2, H / 2 + 0.55, 3.05, rl / 2, 0.55, 0.1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), ang));
  return hullBody;
}

// mast = lightning rod: the bolt runs down it and splits it just above the deck; the rest falls toward the low side
function mastRod(m) {
  return {
    get x() { return m.x; }, z: 0, get top() { return m.spec.top; }, get fallDir() { return ship.listSign; }, get standing() { return m.standing; },
    strike(ctx) {
      const D = ctx.D; const chunks = m.piece.chunks.filter((c) => m.piece.def.chunks[c.idx].part === 'mast' && c.alive).sort((a, b) => a.local.y - b.local.y);
      if (chunks.length < 3 || chunks[1].body !== m.piece.root) return false;
      D.damageChunk(chunks[1], 1e4, null, null, { refracture: false });
      const iv = frame.toWorld(0, 0, ship.listSign, new THREE.Vector3()).sub(cur.pos).multiplyScalar(900);
      D.damageChunk(chunks[chunks.length - 1], 0.01, iv);
      m.standing = false; return true;
    },
  };
}

// rolling barrel (stampede runner): axis along x so it rolls across the deck (along z)
function makeBarrel(ctx, rng, lane, k) {
  const g = new THREE.Group(); const r = 0.55;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.0, 18).rotateZ(Math.PI / 2), std(k % 2 ? '#9a6a3c' : '#8a5a32', { roughness: 0.8 })); body.castShadow = true; g.add(body);
  for (const x of [-0.36, 0.36]) { const hoop = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.035, 6, 20).rotateY(Math.PI / 2), std('#3a3a40', { metalness: 0.5, roughness: 0.5 })); hoop.position.x = x; g.add(hoop); }
  return { obj: g, r };
}
// kraken tentacle (stomp skin): curls down onto the deck, origin at the underside of the tip
function makeTentacle() {
  const g = new THREE.Group(); const skin = std('#7a3c8c', { roughness: 0.55 }), belly = std('#e6a0b4', { roughness: 0.6 });
  const pts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector3(-1.6 * (1 - Math.cos(t * 1.4)) , 0.5 + t * 7, -0.6 * Math.sin(t * 2.2))); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 40, 1, 12, false); const pos = tube.attributes.position;
  // taper: radius grows from the tip (0.55) to the base (1.3)
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) { const seg = Math.floor(i / 13) / 40; const c = curve.getPoint(seg); tmp.fromBufferAttribute(pos, i).sub(c).multiplyScalar(0.55 + 0.75 * seg).add(c); pos.setXYZ(i, tmp.x, tmp.y, tmp.z); }
  tube.computeVertexNormals();
  const m = new THREE.Mesh(tube, skin); m.castShadow = true; g.add(m);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10).scale(1.3, 0.75, 1.3), skin); tip.position.y = 0.42; tip.castShadow = true; g.add(tip);
  for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 10), belly); s.position.set(0.5 * Math.cos(i), 0.05, 0.5 * Math.sin(i)); g.add(s); }
  return g;
}

const SAFE = {
  lightning: [{ x0: 2.6, x1: 3.4, z0: -0.6, z1: 0.6, y: 0, label: 'SHELTER ›' }],
  flood: [{ x0: 3.7, x1: 7.0, z0: -2.8, z1: 2.8, y: L.STERN_Y, label: 'HIGH GROUND' }],
  meteor: [{ x0: -8, x1: -5.2, z0: -1.2, z1: 1.2, y: 0, label: 'SOLID BOW' }],
  stampede: [{ x0: 3.9, x1: 7.0, z0: -2.6, z1: 2.6, y: L.STERN_Y, label: 'STERN DECK' }],
};

const _gh = new THREE.Vector3(), _gh2 = new THREE.Vector3(), _hf = new THREE.Vector3();
let hasFloorRay = null;
const arena = {
  id: 'ship', name: 'Sinking Ship', wipeText: 'TABLETOP', loadingText: 'Rigging the ship…',
  help: `<p>Stay aboard. The ship lists and sinks; the disaster gets worse. Fall in the sea and you're out. Last ones standing win.</p>
    <p><b>Gamepad:</b> left stick move, <kbd>A</kbd> jump, hold <kbd>RT</kbd>/<kbd>RB</kbd> grab, right stick or D-pad aim (look up + let go = throw), <kbd>Start</kbd> this help. Press any button to join.</p>
    <p><b>Keyboard P1:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, <kbd>Space</kbd> jump, <kbd>F</kbd> grab, <kbd>R</kbd>/<kbd>V</kbd> aim. <b>P2:</b> arrows, <kbd>/</kbd> jump, <kbd>.</kbd> grab, <kbd>L</kbd>/<kbd>,</kbd> aim (press to join).</p>
    <p>Throw crates, barrels and each other overboard. Hanging off the side? Look up and climb back.</p>
    <p>Glowing circle = lightning (hide under the stern deck). Growing shadow = meteor. Foam wall = rogue wave (get high, or jump it). Glowing lane = barrels. Purple shadow = kraken.</p>`,
  theme: { '--bg': '#14111f', '--panel': 'rgba(24, 16, 30, 0.92)', '--accent': '#f0c66e', '--accent-ink': '#2a1a10', '--line': '#8a6a3e', '--edge': '#14111f',
    '--shadow': '#3a1a40', '--glow': 'rgba(240, 198, 110, 0.55)', '--wipe-a': '#3d3466', '--wipe-b': '#9a5a6e', '--wipe-c': '#191a38' },
  assets: { pieces: { GLB_BASE64, SUPPORT } },
  frame,
  // 35 deg: faces and mast heights read; the whole deck and both rails stay in view while the ship lists
  camera: { pitchDeg: 35, fov: 36, minDist: 15, maxDist: 25, padX: 1.7, padZ: 1.0, padY: 0.9, center: [-0.6, 1.4, 0.2], homeSize: [13, 1, 5.6],
    centerPull: 0.4, lift: 0.45, zBias: -0.1, revealFrom: 10, revealTo: 27, revealCenter: [-0.5, 1.8, 0], revealLift: 0.4, yMin: 0.7 },
  spawns: L.SPAWNS,
  overboard: [0, 0.5, 5.5],
  ledges: L.LEDGES,
  ledgeBody: () => state.hullBody,
  props: [
    { name: 'cannonball1', shape: 'sphere', size: 0.2, mass: 18, pos: [-2.6, 0.3, -1.6], bounce: 0.05, mesh: (T) => new T.Mesh(new T.SphereGeometry(0.2, 16, 12), new T.MeshStandardMaterial({ color: '#2a2a30', metalness: 0.6, roughness: 0.4 })) },
    { name: 'cannonball2', shape: 'sphere', size: 0.2, mass: 18, pos: [1.4, 0.3, 1.5], bounce: 0.05, mesh: (T) => new T.Mesh(new T.SphereGeometry(0.2, 16, 12), new T.MeshStandardMaterial({ color: '#2a2a30', metalness: 0.6, roughness: 0.4 })) },
  ],
  surfaces: {
    points: L.POINTS,
    heightAt: (x, z) => L.heightAt(x, z),
    inBounds: L.onShip,
    killY: L.KILL_Y,
    groundHeight: (x, z) => { const l = frame.toLocal(_gh.set(x, 0, z), _gh2); if (l.x > L.BOW_TIP && l.x < 7.4 && Math.abs(l.z) < 3.1) return frame.toWorld(l.x, 0, l.z, _gh).y; return arena._water?.height(x, z) ?? 0; },
    // planks present at this spot? (beams sit 0.12 below the plank top, so only accept hits near the deck surface)
    hasFloor: (w, ctx) => {
      const l = frame.toLocal(w, _hf); const R0 = L.RAMP;
      const onRamp = l.x > R0.x0 - 0.1 && l.x < R0.x1 && l.z > R0.z0 - 0.1;
      const sy = onRamp ? L.STERN_Y * Math.max(0, (l.x - R0.x0) / (R0.x1 - R0.x0)) : l.y > 1.0 && l.x > L.CABIN_X ? L.STERN_Y : 0;
      const e = frame.toWorld(l.x, sy, l.z, _hf);
      return !!ctx.surface.castDown(e.x, e.z, e.y + 0.5, 0.6);
    },
  },
  debrisKnock: { minSpeed: 4.5, minMass: 15 },
  disasters: ['lightning', 'meteor', 'flood', 'stampede', 'stomp'],
  escalation: { sub1: 'The storm gets worse', big2: 'HOLD ON!', sub2: 'She\'s going down' },
  botHints: {
    edgeDist: L.edgeDist,
    // waypoints between regions: main deck <-> stern deck via the ramp, main deck <-> cabin via the door
    route(from, to) {
      const region = (x, y) => (y > 1.0 ? 'stern' : x > L.CABIN_X + 0.1 ? 'cabin' : 'main');
      const RB = [L.RAMP.x0 - 0.5, (L.RAMP.z0 + L.RAMP.z1) / 2, 0], RT = [L.RAMP.x1 + 0.5, (L.RAMP.z0 + L.RAMP.z1) / 2, L.STERN_Y];
      const DO = [L.CABIN_X - 0.7, 0, 0], DI = [L.CABIN_X + 0.8, 0, 0];
      const a = region(from[0], from[2]), b = region(to[0], to[2]);
      if (a === b) return null;
      // in the ramp's corridor (or at its foot): go up; else walk to its foot first (no toggling at the waypoint)
      const inCorridor = from[0] > RB[0] - 0.4 && Math.abs(from[1] - RB[1]) < 0.6;
      if (a === 'main' && b === 'stern') return inCorridor || Math.hypot(from[0] - RB[0], from[1] - RB[1]) < 0.6 ? RT : RB;
      if (a === 'stern') return Math.hypot(from[0] - RT[0], from[1] - RT[1]) < 0.8 ? RB : RT;
      if (a === 'main' && b === 'cabin') return Math.hypot(from[0] - DO[0], from[1] - DO[1]) < 0.5 ? DI : DO;
      if (a === 'cabin') return Math.hypot(from[0] - DI[0], from[1] - DI[1]) < 0.5 ? DO : DI;
      return null;
    },
    prefer: (pt) => (Math.abs(pt[1]) > 2.4 ? -1 : 0),   // keep off the rails
  },
  water: { base: 0, rate: 0.6, buoyancy: 1.05, height: (level, x, z, t) => level + WAVE(x, z, t) },
  hazardConfig: {
    lightning: { hint: 'Dodge the glowing circles · shelter under the stern deck', safe: SAFE.lightning, shelterTag: 'cabin', rods: () => state.rods },
    meteor: { safe: SAFE.meteor, filter: (pt) => pt[0] > L.BOW_X - 0.5 && pt[3] !== 'cabin' },
    flood: { title: 'ROGUE WAVES', hint: 'Climb the stern deck · jump the surge', safe: SAFE.flood,
      shelter: (l) => l.x > L.CABIN_X + 0.1 && l.y < 1.5,   // the cabin is sheltered
      push: 9,                                               // surge shove (m/s^2 while in it): a ragdoll keeps it, unlike the old stand-in
      onSurge(it, ctx) {
        // big surges smash a couple of rail posts on the far side
        if (it.railHit || it.h < 0.7 || it.front * it.side > -2.4) return;
        it.railHit = true;
        for (let j = 0; j < 2; j++) { const x = -4.5 + ctx.R.hazard() * 7.5; ctx.D.damageSphere(frame.toWorld(x, 0.5, -it.side * 2.94), 0.7, 90, 3); }
        ctx.cam.shake(0.3); ctx.fx.sfx('crash');
      } },
    stampede: { title: 'BARREL STAMPEDE', hint: 'Glowing lane = runaway barrels · step out of it', safe: SAFE.stampede,
      axis: 'z', lanes: L.STAMPEDE_LANES, span: [-3.3, 3.3], heightAt: (x, z) => L.heightAt(x, z), makeRunner: makeBarrel, alongPush: 0.3 },   // knocked aside, not overboard
    stomp: { title: 'KRAKEN!', hint: 'A tentacle slams the growing shadow · jump the shockwave', radius: 1.6, crush: 35,
      filter: (pt) => pt[3] !== 'cabin', makeHand: () => makeTentacle() },
  },

  occluders: () => state.V ? state.V.occ.concat(state.sails) : [],
  init(ctx) { state.V = buildStatic(ctx); arena._water = ctx.water; },
  build(ctx) {
    const { D } = ctx;
    ship.sink = 0; ship.listSign = ctx.R.arena() < 0.5 ? 1 : -1; state.lastFlash = 0;
    poseAt(0, 0, cur); cur.inv.copy(cur.quat).invert(); nxt.pos.copy(cur.pos); nxt.quat.copy(cur.quat);
    state.hullBody = buildHullColliders(ctx);
    state.kinPieces = []; state.masts = []; state.props = []; state.sails = []; state.flags = [];
    const Y = new THREE.Vector3(0, 1, 0);
    for (const spec of L.PIECES) {
      const lp = new THREE.Vector3(...spec.pos), lq = new THREE.Quaternion().setFromAxisAngle(Y, spec.rotY || 0);
      const piece = D.addPiece(spec.def, { position: lp.clone().applyQuaternion(cur.quat).add(cur.pos), quaternion: cur.quat.clone().multiply(lq), kinematic: true, name: spec.def + '#' + state.kinPieces.length });
      if (spec.def.startsWith('deck')) for (const c of piece.chunks) c.collider?.setFriction(0.35);
      state.kinPieces.push({ piece, lp, lq });
      if (spec.mast) state.masts.push({ piece, spec, standing: true, x: spec.pos[0] });
    }
    rigMast(state.masts[0].piece, { top: 6.2, sails: [[2.4, 4.6, 3.6], [4.9, 5.9, 2.6]] });
    rigMast(state.masts[1].piece, { top: 7.8, sails: [[2.3, 5.1, 4.2], [6.3, 7.4, 2.8]] });
    state.rods = state.masts.map(mastRod);
    for (const spec of L.PROPS) {
      const lp = new THREE.Vector3(...spec.pos).add(new THREE.Vector3(0, 0.02, 0)), lq = new THREE.Quaternion().setFromAxisAngle(Y, spec.rotY || 0);
      // hollow cargo: the light 'crate' material, so a toy sailor can lift and throw it
      const piece = D.addPiece(spec.def, { position: lp.applyQuaternion(cur.quat).add(cur.pos), quaternion: cur.quat.clone().multiply(lq), name: spec.def + '#' + state.props.length, material: 'crate' });
      for (const c of piece.chunks) c.collider?.setFriction(0.12);
      state.props.push(piece);
    }
    ctx.group.position.copy(cur.pos); ctx.group.quaternion.copy(cur.quat);
  },
  disposeRound() { state.sails = []; state.flags = []; state.rods = []; state.kinPieces = []; state.masts = []; state.props = []; state.hullBody = null; },
  update(dt, ctx) {
    const r = ctx.round;
    if (r.phase === 'active') ship.sink = Math.min(1, Math.pow(r.t / ctx.T.active, 1.15));
    poseAt(ctx.simT, ship.sink, nxt); dQ.copy(nxt.quat).multiply(cur.inv);
    state.hullBody.setNextKinematicTranslation(nxt.pos); state.hullBody.setNextKinematicRotation(nxt.quat);
    for (const k of state.kinPieces) if (k.piece.root.chunks.length) ctx.D.setPieceTransform(k.piece, _tw.copy(k.lp).applyQuaternion(nxt.quat).add(nxt.pos), nxt.quat.clone().multiply(k.lq));
    ctx.cam.setCenter(_gh.set(-0.6, 0, 0.2).applyQuaternion(cur.quat).add(cur.pos).setY(cur.pos.y - 0.3));
  },
  postStep(dt, ctx) {
    cur.pos.copy(nxt.pos); cur.quat.copy(nxt.quat); cur.inv.copy(cur.quat).invert();
    ctx.group.position.copy(cur.pos); ctx.group.quaternion.copy(cur.quat);
  },
  render(dt, ctx) {
    const V = state.V; const t = ctx.now();
    V.shipGroup.position.copy(cur.pos); V.shipGroup.quaternion.copy(cur.quat);
    ctx.group.position.copy(cur.pos); ctx.group.quaternion.copy(cur.quat);
    V.seaU.uTime.value = t; V.seaU.uLevel.value = ctx.water ? ctx.water.level : 0;
    const camT = ctx.cam.target;
    V.sun.target.position.copy(camT); V.sun.position.copy(camT).add(_gh2.set(-9, 16, 10));
    const rp = V.rainPos;
    for (let i = 0; i < V.RAIN; i++) {
      const d = V.rainDrops[i]; d[1] -= dt * 24; if (d[1] < -2) d[1] += 24;
      const x = camT.x + d[0], y = camT.y + d[1], z = camT.z + d[2];
      rp[i * 6] = x; rp[i * 6 + 1] = y; rp[i * 6 + 2] = z; rp[i * 6 + 3] = x + 0.12; rp[i * 6 + 4] = y + 0.7; rp[i * 6 + 5] = z;
    }
    V.rainGeo.attributes.position.needsUpdate = true;
    for (const f of state.flags) f.rotation.y = 0.3 * Math.sin(t * 3 + f.id);
    // lightning weather flicker in storms; the kit's bolt flash also lights the sky
    if (ctx.hazards.some((h) => h.name === 'lightning') && t - state.lastFlash > 2.5 && ctx.R.fx() < dt * 0.4) { state.lastFlash = t; ctx.fx.flashAt(camT, 0.35); }
    const fl = ctx.fx.flash; V.hemi.intensity = 1.25 + fl * 2.4; V.rim.intensity = 0.8 + fl * 2;
  },
  state(ctx) {
    if (!ctx.D) return null;
    const e = new THREE.Euler().setFromQuaternion(cur.quat, 'XYZ');
    return { sink: +ship.sink.toFixed(3), listDeg: +THREE.MathUtils.radToDeg(e.x).toFixed(1), pitchDeg: +THREE.MathUtils.radToDeg(e.z).toFixed(1), shipY: +cur.pos.y.toFixed(3),
      masts: state.masts.map((m) => m.standing), props: state.props.map((p) => { for (const r of ctx.D.bodies) if (r.piece === p) return +r.mass.toFixed(1); return null; }),
      grabbableProps: ctx.D.stats().grabbable };
  },
  hooks(ctx, w) {
    w.__forceMast = () => { const h = ctx.hazards.find((x) => x.name === 'lightning'); if (h) { h.forceRod = true; h.next = ctx.now(); } return !!h; };
    w.__sink = (k) => { ship.sink = k; };
  },
};
void hasFloorRay;
export default arena;
