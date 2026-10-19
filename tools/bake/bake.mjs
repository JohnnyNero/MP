// TABLETOP destruction bake: intact parts -> pre-fractured chunks + support graph.
// Usage:
//   node bake.mjs                      bake the built-in test pieces
//   node bake.mjs --in house.glb       bake every mesh in a GLB (see API.md for naming)
//   options: --out <dir> (default ..), --name <bundle name> (default "pieces"), --seed N
// Writes <out>/<name>.glb (one node per chunk), <out>/<name>.support.json and
// <out>/<name>.js (ES module: GLB as base64 + support data; the artifact host can serve .js).
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DestructibleMesh, FractureOptions } from '@dgreenheck/three-pinata';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIALS } from '../../public/arenas/kit/materials.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// --defs <file.mjs> bakes that module's pieces({ box, cyl, prism }) (see defs/ and ../README.md)
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? a.concat([[v.slice(2), arr[i + 1]]]) : a), []));
const OUT = path.resolve(args.out || path.join(here, '..'));
const NAME = args.name || 'pieces';
const SEED = +(args.seed || 1234);

// ---------- deterministic rng ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

// ---------- part helpers ----------
// A part = intact convex-ish watertight solid in piece-local coords (y up, y=0 is the ground).
// fracture: { count, mode: '2.5D'|'3D'|'slices', axis } ; anchor: chunks touching y<=0.02 are anchored unless anchor:false.
function box(name, mat, min, max, fracture, extra = {}) {
  const s = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const g = new THREE.BoxGeometry(...s);
  g.translate((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  return { name, mat, geom: g, fracture, ...extra, box: { min, max } };
}
function cyl(name, mat, center, r, h, fracture, extra = {}) {
  const g = new THREE.CylinderGeometry(r, r, h, 18, 1);
  g.translate(center[0], center[1] + h / 2, center[2]);
  return { name, mat, geom: g, fracture, ...extra };
}

// convex polygon (xz points, counter-clockwise seen from +y) extruded from y0 to y1
function prism(name, mat, pts, y0, y1, fracture, extra = {}) {
  const sh = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? sh.lineTo(x, -z) : sh.moveTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0); g.computeBoundingBox();
  return { name, mat, geom: g, fracture, ...extra, box: { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() } };
}

// ---------- built-in test pieces ----------
function testPieces() {
  const P = {};
  // 1. Stone wall with a glass window (4 x 3 x 0.3)
  const T = 0.15;
  P.wall_window = [
    box('left', 'stone', [-2, 0, -T], [-0.7, 3, T], { count: 9, mode: '2.5D', axis: 'z' }),
    box('right', 'stone', [0.7, 0, -T], [2, 3, T], { count: 9, mode: '2.5D', axis: 'z' }),
    box('sill', 'stone', [-0.7, 0, -T], [0.7, 1, T], { count: 4, mode: '2.5D', axis: 'z' }),
    box('lintel', 'stone', [-0.7, 2.1, -T], [0.7, 3, T], { count: 4, mode: '2.5D', axis: 'z' }),
    box('pane', 'glass', [-0.7, 1, -0.015], [0.7, 2.1, 0.015], { count: 8, mode: '2.5D', axis: 'z' }),
  ];
  // 2. Two-storey timber frame with floor slabs (4 x 5.2 x 3)
  const tf = [];
  const posts = [[-1.9, -1.4], [1.9, -1.4], [-1.9, 1.4], [1.9, 1.4]];
  posts.forEach(([x, z], i) => tf.push(box('post1_' + i, 'wood', [x - 0.1, 0, z - 0.1], [x + 0.1, 2.4, z + 0.1], { count: 2, mode: 'slices', axis: 'y' })));
  tf.push(box('floor', 'wood', [-2, 2.4, -1.5], [2, 2.6, 1.5], { count: 10, mode: '2.5D', axis: 'y' }));
  posts.forEach(([x, z], i) => tf.push(box('post2_' + i, 'wood', [x - 0.1, 2.6, z - 0.1], [x + 0.1, 5.0, z + 0.1], { count: 2, mode: 'slices', axis: 'y' })));
  tf.push(box('roof', 'wood', [-2, 5.0, -1.5], [2, 5.2, 1.5], { count: 8, mode: '2.5D', axis: 'y' }));
  P.timber_frame = tf;
  // 3. Glass tower section: steel columns, concrete slabs, glass curtain front (3 x 5.6 x 3)
  const gt = [];
  const cols = [[-1.375, -1.375], [1.375, -1.375], [-1.375, 1.375], [1.375, 1.375]];
  const H = 2.8, ST = 0.2;
  for (let s = 0; s < 2; s++) {
    const y0 = s * H, y1 = y0 + H - ST;
    cols.forEach(([x, z], i) => gt.push(box(`col${s}_${i}`, 'metal', [x - 0.125, y0, z - 0.125], [x + 0.125, y1, z + 0.125], { count: 2, mode: 'slices', axis: 'y' })));
    gt.push(box('slab' + s, 'stone', [-1.5, y1, -1.5], [1.5, y1 + ST, 1.5], { count: 6, mode: '2.5D', axis: 'y' }));
    gt.push(box('glass' + s, 'glass', [-1.25, y0, 1.355], [1.25, y1, 1.395], { count: 6, mode: '2.5D', axis: 'z' }));
  }
  P.glass_tower = gt;
  // 4. Ship deck: two hull bulkheads with a 6.3 m plank run on top
  const sd = [
    box('bulkL', 'hull', [-3.15, 0, -1.5], [-2.85, 1.6, 1.5], { count: 4, mode: '2.5D', axis: 'x' }),
    box('bulkR', 'hull', [2.85, 0, -1.5], [3.15, 1.6, 1.5], { count: 4, mode: '2.5D', axis: 'x' }),
  ];
  for (let i = 0; i < 5; i++) {
    const z0 = -1.5 + i * 0.6;
    sd.push(box('plank' + i, 'wood', [-3.15, 1.6, z0 + 0.01], [3.15, 1.68, z0 + 0.59], { count: 4, mode: 'slices', axis: 'x' }));
  }
  P.ship_deck = sd;
  // 5. Stack of 8 ceramic plates (unanchored prop: becomes one dynamic body)
  const ps = [];
  for (let i = 0; i < 8; i++) ps.push(cyl('plate' + i, 'ceramic', [0, i * 0.035, 0], 0.28, 0.035, { count: 4, mode: '2.5D', axis: 'y' }, { anchor: false, interBond: 0.15 }));
  P.plate_stack = ps;
  return P;
}

// ---------- fracturing ----------
function volumeCentroid(pos, idx) {
  let V = 0; const c = new THREE.Vector3(); const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromArray(pos, idx[i] * 3); b.fromArray(pos, idx[i + 1] * 3); d.fromArray(pos, idx[i + 2] * 3);
    const v = a.dot(b.clone().cross(d)) / 6; V += v;
    c.addScaledVector(a.clone().add(b).add(d), v / 4);
  }
  if (Math.abs(V) < 1e-9) return { V: 0, c: new THREE.Vector3() };
  return { V: Math.abs(V), c: c.multiplyScalar(1 / V) };
}

// returns [{ positions(Float32 piece-local), normals, colors, index(Uint32), inner flag groups }]
function fracturePart(part, rng) {
  const f = part.fracture || { count: 1 };
  let geos = [];
  if (!f.count || f.count <= 1) {
    geos = [{ g: part.geom.toNonIndexed(), innerFrom: Infinity }];
  } else if (f.mode === 'slices') {
    // straight cuts across the long axis with jittered spacing (wood splits like this)
    const ax = { x: 0, y: 1, z: 2 }[f.axis];
    const { min, max } = part.box;
    let cuts = [];
    for (let i = 1; i < f.count; i++) cuts.push(min[ax] + (max[ax] - min[ax]) * (i + (rng() - 0.5) * 0.5) / f.count);
    const edges = [min[ax], ...cuts, max[ax]];
    for (let i = 0; i < f.count; i++) {
      const mn = [...min], mx = [...max]; mn[ax] = edges[i]; mx[ax] = edges[i + 1];
      const s = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      const g = new THREE.BoxGeometry(...s); g.translate((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
      // the two faces normal to the cut axis are "inner" except at the part ends
      const gi = g.toNonIndexed();
      const inner = new Uint8Array(gi.attributes.position.count);
      const nrm = gi.attributes.normal.array;
      for (let v = 0; v < inner.length; v++) {
        const n = nrm[v * 3 + ax];
        if ((n < -0.5 && i > 0) || (n > 0.5 && i < f.count - 1)) inner[v] = 1;
      }
      geos.push({ g: gi, innerMask: inner });
    }
  } else {
    let src = part.geom.clone();
    src.deleteAttribute('uv'); src.deleteAttribute('normal');
    src = mergeVertices(src); src.computeVertexNormals();
    // pinata wants uv; give it a planar one
    const p = src.attributes.position; const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i); uv[i * 2 + 1] = p.getY(i); }
    src.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new DestructibleMesh(src, new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial());
    const seed = Math.floor(rng() * 2147483646) + 1;
    const frags = m.fracture(new FractureOptions({ fragmentCount: f.count, seed, voronoiOptions: { mode: f.mode || '3D', projectionAxis: f.axis || 'auto' } }));
    for (const fr of frags) {
      const g = fr.geometry.clone(); g.translate(fr.position.x, fr.position.y, fr.position.z);
      const innerStart = (g.groups.find((q) => q.materialIndex === 1) || { start: Infinity }).start;
      const gi = g.toNonIndexed();
      const inner = new Uint8Array(gi.attributes.position.count);
      for (let v = 0; v < inner.length; v++) inner[v] = v >= innerStart ? 1 : 0;
      geos.push({ g: gi, innerMask: inner });
    }
  }
  const chunks = [];
  for (const { g, innerMask } of geos) {
    // weld for compactness, keep flat normals by welding on position+normal
    const pos = g.attributes.position.array, nrm = g.attributes.normal.array;
    const map = new Map(); const P = [], N = [], C = [], I = [];
    for (let v = 0; v < g.attributes.position.count; v++) {
      const k = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2], nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]].map((x) => Math.round(x * 1e4)).join(',') + (innerMask ? innerMask[v] : 0);
      let id = map.get(k);
      if (id === undefined) {
        id = P.length / 3; map.set(k, id);
        P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); N.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
        C.push(innerMask && innerMask[v] ? 1 : 0);
      }
      I.push(id);
    }
    const { V, c } = volumeCentroid(P, I);
    if (V < 1e-6) continue;
    chunks.push({ pos: new Float32Array(P), nrm: new Float32Array(N), inner: C, idx: I, vol: V, c, part: part.name, mat: part.mat });
  }
  return chunks;
}

// ---------- bonds from shared face area ----------
function triList(ch) {
  const out = []; const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < ch.idx.length; i += 3) {
    a.fromArray(ch.pos, ch.idx[i] * 3); b.fromArray(ch.pos, ch.idx[i + 1] * 3); d.fromArray(ch.pos, ch.idx[i + 2] * 3);
    const n = b.clone().sub(a).cross(d.clone().sub(a)); const area = n.length() / 2; if (area < 1e-7) continue;
    n.normalize(); out.push({ a: a.clone(), b: b.clone(), c: d.clone(), n, d: n.dot(a), area });
  }
  return out;
}
function inTri(p, t) {
  const v0 = t.c.clone().sub(t.a), v1 = t.b.clone().sub(t.a), v2 = p.clone().sub(t.a);
  const d00 = v0.dot(v0), d01 = v0.dot(v1), d02 = v0.dot(v2), d11 = v1.dot(v1), d12 = v1.dot(v2);
  const inv = 1 / (d00 * d11 - d01 * d01); const u = (d11 * d02 - d01 * d12) * inv, v = (d00 * d12 - d01 * d02) * inv;
  return u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4;
}
// subdivide a triangle until pieces are under ~2x2 cm and return [centroid, area] samples
function triSamples(t, out = [], a = t.a, b = t.b, c = t.c, depth = 0) {
  const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  if (area < 4e-4 || depth >= 6) { out.push([a.clone().add(b).add(c).multiplyScalar(1 / 3), area]); return out; }
  const ab = a.clone().add(b).multiplyScalar(0.5), bc = b.clone().add(c).multiplyScalar(0.5), ca = c.clone().add(a).multiplyScalar(0.5);
  triSamples(t, out, a, ab, ca, depth + 1); triSamples(t, out, ab, b, bc, depth + 1); triSamples(t, out, ca, bc, c, depth + 1); triSamples(t, out, ab, bc, ca, depth + 1);
  return out;
}
function contact(trisA, trisB) {
  let area = 0; const pc = new THREE.Vector3(); const nAcc = new THREE.Vector3(); let ylo = Infinity, yhi = -Infinity;
  for (const ta of trisA) {
    const cand = trisB.filter((tb) => ta.n.dot(tb.n) < -0.985 && Math.abs(ta.d + tb.d) < 0.004);
    if (!cand.length) continue;
    for (const [p, ar] of (ta.samples ||= triSamples(ta))) if (cand.some((tb) => inTri(p, tb))) { area += ar; pc.addScaledVector(p, ar); nAcc.addScaledVector(ta.n, ar); ylo = Math.min(ylo, p.y - Math.sqrt(ar)); yhi = Math.max(yhi, p.y + Math.sqrt(ar)); }
  }
  return { area, pc, nAcc, h: yhi > ylo ? yhi - ylo : 0 };
}
function computeBonds(chunks, parts) {
  const tris = chunks.map(triList);
  const boxes = chunks.map((ch) => new THREE.Box3().setFromArray(ch.pos).expandByScalar(0.01));
  const bonds = [];
  for (let i = 0; i < chunks.length; i++) for (let j = i + 1; j < chunks.length; j++) {
    if (!boxes[i].intersectsBox(boxes[j])) continue;
    const ab = contact(tris[i], tris[j]), ba = contact(tris[j], tris[i]);
    const area = (ab.area + ba.area) / 2;
    if (area < 2e-4) continue;
    const pc = ab.pc.add(ba.pc).multiplyScalar(1 / (ab.area + ba.area)); const nAcc = ab.nAcc.sub(ba.nAcc).normalize();
    const pa = parts[chunks[i].part], pb = parts[chunks[j].part];
    let scale = 1; if (chunks[i].part !== chunks[j].part) scale = Math.min(pa.interBond ?? 1, pb.interBond ?? 1);
    bonds.push({ a: i, b: j, area: +area.toFixed(5), h: +Math.max(ab.h, ba.h).toFixed(3), scale, p: pc.toArray().map((x) => +x.toFixed(4)), n: nAcc.toArray().map((x) => +x.toFixed(4)) });
  }
  return bonds;
}

// ---------- GLB writer (one node per chunk, COLOR_0 marks inner faces) ----------
function writeGLB(pieces, matNames) {
  const bin = []; let off = 0; const bufferViews = [], accessors = [], meshes = [], nodes = [], sceneNodes = [];
  const pushBuf = (typed, target) => {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4; bin.push(bytes); if (pad) bin.push(new Uint8Array(pad));
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: bytes.length, ...(target ? { target } : {}) }); off += bytes.length + pad; return bufferViews.length - 1;
  };
  const materials = matNames.map((m) => ({ name: m, pbrMetallicRoughness: { baseColorFactor: [...new THREE.Color(MATERIALS[m].color).toArray(), 1], metallicFactor: MATERIALS[m].metalness, roughnessFactor: MATERIALS[m].roughness } }));
  for (const [pname, piece] of Object.entries(pieces)) {
    const children = [];
    piece.chunks.forEach((ch, i) => {
      const n = ch.pos.length / 3; const pos = new Float32Array(ch.pos.length);
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) { const x = ch.pos[v * 3 + k] - ch.c.getComponent(k); pos[v * 3 + k] = x; mn[k] = Math.min(mn[k], x); mx[k] = Math.max(mx[k], x); }
      const col = new Float32Array(n * 3); for (let v = 0; v < n; v++) { const s = ch.inner[v] ? 0.7 : 1.0; col[v * 3] = col[v * 3 + 1] = col[v * 3 + 2] = s; }
      const idx = n < 65536 ? new Uint16Array(ch.idx) : new Uint32Array(ch.idx);
      const aP = accessors.push({ bufferView: pushBuf(pos, 34962), componentType: 5126, count: n, type: 'VEC3', min: mn, max: mx }) - 1;
      const aN = accessors.push({ bufferView: pushBuf(ch.nrm, 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1;
      const aC = accessors.push({ bufferView: pushBuf(col, 34962), componentType: 5126, count: n, type: 'VEC3' }) - 1;
      const aI = accessors.push({ bufferView: pushBuf(idx, 34963), componentType: n < 65536 ? 5123 : 5125, count: idx.length, type: 'SCALAR' }) - 1;
      meshes.push({ name: `${pname}/${i}`, primitives: [{ attributes: { POSITION: aP, NORMAL: aN, COLOR_0: aC }, indices: aI, material: matNames.indexOf(ch.mat) }] });
      nodes.push({ name: `${pname}/${i}`, mesh: meshes.length - 1, translation: ch.c.toArray() });
      children.push(nodes.length - 1);
    });
    nodes.push({ name: pname, children }); sceneNodes.push(nodes.length - 1);
  }
  const binBuf = Buffer.concat(bin.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength)));
  const json = { asset: { version: '2.0', generator: 'tabletop-destruct-bake' }, scene: 0, scenes: [{ nodes: sceneNodes }], nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength: binBuf.length }] };
  let js = Buffer.from(JSON.stringify(json)); const jpad = (4 - (js.length % 4)) % 4; js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
  const total = 12 + 8 + js.length + 8 + binBuf.length;
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, jh, js, bh, binBuf]);
}

// ---------- input GLB (intact model) ----------
async function piecesFromGLB(file) {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const buf = fs.readFileSync(file);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  // Convention: each top-level node is a piece; each mesh under it is a part.
  // Part material from mesh.userData.mat (glTF extras) or name prefix "<mat>_"; chunk count from extras.count (default 12).
  const P = {};
  gltf.scene.updateMatrixWorld(true);
  for (const top of gltf.scene.children) {
    const parts = []; const inv = top.matrixWorld.clone().invert();
    top.traverse((o) => {
      if (!o.isMesh) return;
      const ex = o.userData || {}; const mat = ex.mat || (o.name.split('_')[0] in MATERIALS ? o.name.split('_')[0] : 'wood');
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld.clone().premultiply(inv));
      g.computeBoundingBox();
      parts.push({ name: o.name || 'part' + parts.length, mat, geom: g, fracture: { count: ex.count ?? 12, mode: ex.mode || '3D', axis: ex.axis || 'auto' }, anchor: ex.anchor !== false, interBond: ex.interBond, box: { min: g.boundingBox.min.toArray(), max: g.boundingBox.max.toArray() } });
    });
    if (parts.length) P[top.name || 'piece' + Object.keys(P).length] = parts;
  }
  return P;
}

// ---------- main ----------
const defs = args.in ? await piecesFromGLB(args.in) : args.defs ? (await import(path.resolve(args.defs))).pieces({ box, cyl, prism }) : testPieces();
const out = {}; const support = { version: 1, materials: MATERIALS, pieces: {} };
for (const [pname, parts] of Object.entries(defs)) {
  const rng = mulberry32(hashStr(pname) ^ SEED);
  const partMap = Object.fromEntries(parts.map((p) => [p.name, p]));
  const chunks = parts.flatMap((p) => fracturePart(p, rng));
  const bonds = computeBonds(chunks, partMap);
  let minY = Infinity; for (const ch of chunks) for (let v = 1; v < ch.pos.length; v += 3) minY = Math.min(minY, ch.pos[v]);
  const bb = new THREE.Box3(); chunks.forEach((ch) => bb.union(new THREE.Box3().setFromArray(ch.pos)));
  const sChunks = chunks.map((ch, i) => {
    let lo = Infinity, r = 0;
    for (let v = 0; v < ch.pos.length; v += 3) { lo = Math.min(lo, ch.pos[v + 1]); r = Math.max(r, Math.hypot(ch.pos[v] - ch.c.x, ch.pos[v + 1] - ch.c.y, ch.pos[v + 2] - ch.c.z)); }
    const anchor = partMap[ch.part].anchor !== false && lo <= minY + 0.02 && minY <= 0.02;
    return { id: `${pname}/${i}`, part: ch.part, mat: ch.mat, c: ch.c.toArray().map((x) => +x.toFixed(4)), vol: +ch.vol.toFixed(6), r: +r.toFixed(4), anchor };
  });
  out[pname] = { chunks };
  support.pieces[pname] = { size: bb.getSize(new THREE.Vector3()).toArray().map((x) => +x.toFixed(3)), min: bb.min.toArray().map((x) => +x.toFixed(3)), chunks: sChunks, bonds };
  console.log(`${pname}: ${chunks.length} chunks, ${bonds.length} bonds, ${sChunks.filter((c) => c.anchor).length} anchored`);
}
const glb = writeGLB(out, Object.keys(MATERIALS));
fs.writeFileSync(path.join(OUT, NAME + '.glb'), glb);
fs.writeFileSync(path.join(OUT, NAME + '.support.json'), JSON.stringify(support));
fs.writeFileSync(path.join(OUT, NAME + '.js'), `// generated by bake/bake.mjs - do not edit\nexport const GLB_BASE64 = "${glb.toString('base64')}";\nexport const SUPPORT = ${JSON.stringify(support)};\n`);
console.log(`wrote ${NAME}.glb (${(glb.length / 1024).toFixed(0)} KB), ${NAME}.support.json, ${NAME}.js`);
