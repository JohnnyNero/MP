// TABLETOP destruction engine (ES module, no build step).
// Pre-fractured chunks + support graph (bonds), fixed compound bodies while intact,
// flood-fill island splitting, a load-flow stress pass, contact-force damage,
// optional runtime refracture (three-pinata in a Web Worker), and three debris tiers.
// Deterministic for a given rng and input sequence (no Math.random in this file).
// See API.md for integration notes.
import { MATERIALS } from './materials.js';

export { MATERIALS };

const PINATA_ESM = 'https://cdn.jsdelivr.net/npm/@dgreenheck/three-pinata@2.0.1/+esm';
// three version that jsDelivr's +esm bundle of pinata 2.0.1 imports; worker uses the same module record.
const THREE_FOR_PINATA = 'https://cdn.jsdelivr.net/npm/three@0.181.1/+esm';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function b64ToBuffer(b64) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

// ---------------------------------------------------------------------------
// Library: baked GLB (one node per chunk) + support JSON -> ready-to-spawn piece defs
// ---------------------------------------------------------------------------
export async function loadLibrary({ THREE, GLTFLoader, glb, support, materials = MATERIALS }) {
  const buf = typeof glb === 'string' ? b64ToBuffer(glb) : glb;
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf, '', res, rej));
  const byName = new Map();
  gltf.scene.traverse((o) => { if (o.isMesh) byName.set(o.name, o); });
  const mats = {};
  for (const [k, m] of Object.entries(materials)) {
    mats[k] = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: m.roughness, metalness: m.metalness, transparent: m.opacity != null, opacity: m.opacity ?? 1, depthWrite: m.opacity == null });
  }
  const pieces = {};
  for (const [pname, p] of Object.entries(support.pieces)) {
    const chunks = p.chunks.map((c) => {
      const mesh = byName.get(c.id) || byName.get(c.id.replace('/', ''));
      if (!mesh) throw new Error('chunk mesh missing in GLB: ' + c.id);
      const g = mesh.geometry;
      colorize(THREE, g, materials[c.mat]);
      g.computeBoundingSphere();
      return { ...c, geometry: g, hull: uniquePositions(g) };
    });
    pieces[pname] = { name: pname, size: p.size, min: p.min, chunks, bonds: p.bonds };
  }
  return { pieces, materials, renderMaterials: mats };
}

function colorize(THREE, g, mat) {
  const outer = new THREE.Color(mat.color), inner = new THREE.Color(mat.inner);
  const n = g.attributes.position.count; const src = g.attributes.color; const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const isInner = src ? src.getX(i) < 0.85 : false; const c = isInner ? inner : outer;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function uniquePositions(g) {
  const p = g.attributes.position.array; const seen = new Set(); const out = [];
  for (let i = 0; i < p.length; i += 3) {
    const k = `${Math.round(p[i] * 1e4)},${Math.round(p[i + 1] * 1e4)},${Math.round(p[i + 2] * 1e4)}`;
    if (!seen.has(k)) { seen.add(k); out.push(p[i], p[i + 1], p[i + 2]); }
  }
  return new Float32Array(out);
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export function createDestruction({ THREE, RAPIER, scene, world, rng, library, options = {} }) {
  if (typeof rng !== 'function') throw new Error('createDestruction needs an rng() function');
  const O = {
    maxDebris: 150, minDebris: 60, adaptiveCap: true, targetFrameMs: 16.7,
    grabMaxMass: 120, debrisLife: 25, killY: -40,
    stressInterval: 0.1, maxBondFailsPerTick: 2, leverRef: 1.5, bendDepth: 2,
    fatigueRate: 0.22, impactDamageScale: 0.5, contactEventThreshold: 1e9, minImpactForce: 1200, maxDebrisSpeed: 22, maxDebrisRise: 9, breakThrough: true, creepRate: 3, quakeRattle: 5,
    crumbMax: 2500, dustMax: 1500, groundHeight: () => 0,
    refracture: true, refractureCells: 10, refractureMinVolume: 0.012, refracturePerSecond: 4, refractureDelaySteps: 2,
    crumbVolume: 0.0012, collisionGroups: null, onEvent: null,
    pinataURL: PINATA_ESM, workerThreeURL: THREE_FOR_PINATA, mainPinata: null,
    ...options,
  };
  const g = Math.abs(world.gravity.y) || 9.81;
  const fxRng = mulberry32(Math.floor(rng() * 4294967296));
  const eventQueue = new RAPIER.EventQueue(true);
  const colliderChunk = new Map(); // collider handle -> chunk
  const pieces = []; const bodies = []; // BodyRec list (deterministic order)
  const damageQueue = []; const refractJobs = []; const workerResults = new Map();
  let stressStamp = 1, step = 0, time = 0, shakeNow = 0, stressClock = 0, refractTokens = O.refracturePerSecond, jobId = 1, bodySeq = 1;
  let cap = O.maxDebris, frameEMA = O.targetFrameMs, lastMaxUtil = 0;
  const counters = { chunksBroken: 0, bondsBroken: 0, islands: 0, refractures: 0, workerFractures: 0, syncFractures: 0, evicted: 0 };
  const emit = (type, data) => { if (O.onEvent) O.onEvent(type, data); };

  // temp math
  const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), Q1 = new THREE.Quaternion();

  // ---- render resources ----
  const renderMats = library?.renderMaterials || {};
  const group = new THREE.Group(); group.name = 'destruction'; scene.add(group);

  // ---- body helpers ----
  function makeBody(type, pos, rot, piece) {
    let desc = type === 'fixed' ? RAPIER.RigidBodyDesc.fixed() : type === 'kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
    desc = desc.setTranslation(pos.x, pos.y, pos.z).setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    if (type === 'dynamic') desc = desc.setLinearDamping(0.05).setAngularDamping(0.15);
    const rb = world.createRigidBody(desc);
    const rec = { id: bodySeq++, rb, type, piece, chunks: [], born: time, sleepT: 0, fade: 0, fading: false, mass: 0, needsSync: true };
    rb.userData = { destruct: true, rec, grabbable: false, piece: piece?.name };
    bodies.push(rec);
    return rec;
  }
  function attach(ch, rec) {
    const m = ch.mat;
    let desc = RAPIER.ColliderDesc.convexHull(ch.hull);
    if (!desc) { const r = Math.max(0.02, ch.r * 0.5); desc = RAPIER.ColliderDesc.cuboid(r, r, r); }
    desc.setTranslation(ch.local.x, ch.local.y, ch.local.z)
      .setDensity(m.density).setFriction(0.8).setRestitution(0.05)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(O.contactEventThreshold);
    if (O.collisionGroups != null) desc.setCollisionGroups(O.collisionGroups);
    ch.collider = world.createCollider(desc, rec.rb);
    colliderChunk.set(ch.collider.handle, ch);
    ch.body = rec; rec.chunks.push(ch); rec.mass += ch.mass; rec.needsSync = true;
  }
  function detach(ch) {
    const rec = ch.body; if (!rec) return;
    if (ch.collider) { colliderChunk.delete(ch.collider.handle); world.removeCollider(ch.collider, true); ch.collider = null; }
    const i = rec.chunks.indexOf(ch); if (i >= 0) rec.chunks.splice(i, 1);
    rec.mass -= ch.mass; ch.body = null; rec.dirty = true;
  }
  function removeBody(rec) {
    for (const ch of rec.chunks.slice()) { detach(ch); hideChunk(ch); }
    world.removeRigidBody(rec.rb);
    const i = bodies.indexOf(rec); if (i >= 0) bodies.splice(i, 1);
  }
  function hideChunk(ch) {
    if (ch.mesh) { group.remove(ch.mesh); if (ch.ownGeometry) ch.mesh.geometry.dispose(); ch.mesh = null; }
  }
  function chunkWorld(ch, out) {
    const rb = ch.body.rb; const t = rb.translation(), r = rb.rotation();
    Q1.set(r.x, r.y, r.z, r.w); return out.copy(ch.local).applyQuaternion(Q1).add(V3.set(t.x, t.y, t.z));
  }
  function pointVel(rb, p, out) {
    const lv = rb.linvel(), av = rb.angvel(); const c = rb.worldCom ? rb.worldCom() : rb.translation();
    const rx = p.x - c.x, ry = p.y - c.y, rz = p.z - c.z;
    return out.set(lv.x + av.y * rz - av.z * ry, lv.y + av.z * rx - av.x * rz, lv.z + av.x * ry - av.y * rx);
  }
  const dynCount = () => { let n = 0; for (const b of bodies) if (b.type === 'dynamic' && !b.fading) n++; return n; };

  // ---- pieces ----
  function addPiece(def, transform = {}) {
    if (typeof def === 'string') def = library.pieces[def];
    const pos = new THREE.Vector3().copy(transform.position || V1.set(0, 0, 0));
    const rot = new THREE.Quaternion();
    if (transform.quaternion) rot.copy(transform.quaternion); else if (transform.rotationY) rot.setFromAxisAngle(V1.set(0, 1, 0), transform.rotationY);
    const piece = { name: transform.name || def.name, def, chunks: [], bonds: [], kinematic: !!transform.kinematic, materialOverride: transform.material };
    piece.chunks = def.chunks.map((c, i) => {
      const mat = (O.materials || library?.materials || MATERIALS)[transform.material || c.mat];
      const vol = c.vol; const mass = vol * mat.density;
      const ch = { piece, idx: i, id: c.id, matName: transform.material || c.mat, mat, local: new THREE.Vector3(...c.c), vol, mass, r: c.r,
        anchor: !!c.anchor && transform.anchored !== false, health: mat.health, maxHealth: mat.health, alive: true, bonds: [], hull: c.hull, body: null, collider: null, mesh: null, impulse: null, impulsePt: null };
      const mesh = new THREE.Mesh(c.geometry, renderMats[ch.matName] || new THREE.MeshStandardMaterial({ vertexColors: true }));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.userData.chunk = ch;
      ch.mesh = mesh; group.add(mesh);
      return ch;
    });
    piece.bonds = def.bonds.map((b) => {
      const A = piece.chunks[b.a], B = piece.chunks[b.b];
      const strength = Math.min(A.mat.bondStrength, B.mat.bondStrength) * (b.scale ?? 1);
      const bond = { a: A, b: B, cap: Math.max(50, b.area * strength), health: 1, alive: true, util: 0, p: new THREE.Vector3(...b.p), n: new THREE.Vector3(...(b.n || [0, 1, 0])), cost: 1 + 2000 / Math.max(50, b.area * strength), h: Math.max(0.03, b.h ?? 0.2), weak: 0.5 + rng() };
      A.bonds.push(bond); B.bonds.push(bond); return bond;
    });
    const anchored = piece.chunks.some((c) => c.anchor);
    const type = piece.kinematic ? 'kinematic' : anchored ? 'fixed' : 'dynamic';
    const rec = makeBody(type, pos, rot, piece);
    for (const ch of piece.chunks) attach(ch, rec);
    if (type === 'dynamic') setDebrisFlags(rec);
    piece.root = rec;
    pieces.push(piece);
    syncBody(rec, true);
    return piece;
  }
  function removePiece(piece) {
    for (const rec of bodies.slice()) if (rec.piece === piece) removeBody(rec);
    for (const ch of piece.chunks) hideChunk(ch);
    const i = pieces.indexOf(piece); if (i >= 0) pieces.splice(i, 1);
  }
  function setPieceTransform(piece, position, quaternion) {
    const rb = piece.root.rb; if (!rb.isKinematic()) return;
    rb.setNextKinematicTranslation(position); if (quaternion) rb.setNextKinematicRotation(quaternion);
    piece.root.needsSync = true;
  }
  function setDebrisFlags(rec) {
    rec.rb.userData.grabbable = rec.mass <= O.grabMaxMass;
    rec.rb.userData.mass = rec.mass;
    if (rec.mass < 40) rec.rb.enableCcd(true);
  }

  // ---- damage API (queued, applied at the start of the next step) ----
  function damageSphere(center, radius, amount, impulse = 0, opts = {}) {
    damageQueue.push({ kind: 'sphere', c: new THREE.Vector3().copy(center), r: radius, amount, impulse, opts });
  }
  function damageBox(center, halfExtents, amount, impulseVec = null, opts = {}) {
    damageQueue.push({ kind: 'box', c: new THREE.Vector3().copy(center), h: new THREE.Vector3().copy(halfExtents), amount, iv: impulseVec ? new THREE.Vector3().copy(impulseVec) : null, opts });
  }
  function damageChunk(ch, amount, impulseVec = null, point = null, opts = {}) {
    damageQueue.push({ kind: 'chunk', ch, amount, iv: impulseVec, pt: point, opts });
  }
  function shake(intensity) { shakeNow = Math.max(shakeNow, intensity); }

  function hit(ch, dmg, iv, pt, opts) {
    if (!ch.alive || dmg <= 0) return;
    ch.health -= dmg;
    if (iv) {
      if (!ch.impulse) { ch.impulse = new THREE.Vector3(); ch.impulsePt = new THREE.Vector3(); }
      ch.impulse.add(iv); ch.impulsePt.copy(pt || chunkWorld(ch, V2));
    }
    if (ch.health <= 0) kill(ch, dmg, opts);
  }

  function kill(ch, dmg, opts = {}) {
    ch.alive = false; counters.chunksBroken++;
    for (const b of ch.bonds) if (b.alive) { b.alive = false; counters.bondsBroken++; }
    const rec = ch.body; const wp = chunkWorld(ch, new THREE.Vector3());
    const r = rec.rb.rotation(); const rot = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const vel = rec.type === 'dynamic' ? pointVel(rec.rb, wp, new THREE.Vector3()) : new THREE.Vector3();
    const iv = ch.impulse ? ch.impulse.clone() : new THREE.Vector3();
    detach(ch);
    emit('chunkBroken', { piece: ch.piece.name, chunk: ch.id, material: ch.matName, position: wp.clone() });
    burst(wp, ch.mat, ch.vol, 0.6 + Math.min(2, iv.length() / Math.max(1, ch.mass)));
    // runtime refracture for big hits on big chunks
    const big = dmg >= ch.maxHealth * 1.2 || opts.refracture === true;
    if (O.refracture && opts.refracture !== false && big && ch.vol >= O.refractureMinVolume && refractTokens >= 1 && (worker || O.mainPinata)) {
      refractTokens -= 1;
      const job = { id: jobId++, ch, due: step + O.refractureDelaySteps, wp, rot, vel, iv, seed: Math.floor(rng() * 2147483646) + 1, impact: ch.impulsePt ? ch.impulsePt.clone() : wp.clone() };
      refractJobs.push(job); postJob(job); hideChunk(ch);
      return;
    }
    // otherwise the dead chunk becomes loose debris (or crumbs when over the cap / tiny)
    if (ch.vol >= O.crumbVolume && dynCount() < cap) {
      const d = makeBody('dynamic', wp.clone().sub(V1.copy(ch.local).applyQuaternion(rot)), rot, ch.piece);
      ch.alive = true; ch.health = 1e9; attach(ch, d); ch.alive = false; ch.debris = true;
      setDebrisFlags(d);
      d.rb.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      if (iv.lengthSq() > 0) d.rb.applyImpulse({ x: iv.x, y: iv.y, z: iv.z }, true);
    } else {
      crumbsFrom(wp, ch.mat, ch.vol, vel, iv.length() / Math.max(1, ch.mass));
      hideChunk(ch);
    }
  }

  function processDamage() {
    const q = damageQueue.splice(0);
    for (const d of q) {
      if (d.kind === 'chunk') { hit(d.ch, d.amount, d.iv, d.pt, d.opts); continue; }
      const victims = [];
      for (const rec of bodies) for (const ch of rec.chunks) {
        if (!ch.alive) continue;
        const wp = chunkWorld(ch, V1);
        if (d.kind === 'sphere') {
          const dist = Math.max(0, wp.distanceTo(d.c) - ch.r * 0.5);
          if (dist < d.r) victims.push([ch, 1 - dist / d.r, wp.clone()]);
        } else {
          const e = ch.r * 0.3;
          if (Math.abs(wp.x - d.c.x) < d.h.x + e && Math.abs(wp.y - d.c.y) < d.h.y + e && Math.abs(wp.z - d.c.z) < d.h.z + e) victims.push([ch, 1, wp.clone()]);
        }
      }
      for (const [ch, f, wp] of victims) {
        let iv = null;
        if (d.kind === 'sphere' && d.impulse) { iv = wp.clone().sub(d.c); if (iv.lengthSq() < 1e-6) iv.set(0, 1, 0); iv.normalize().multiplyScalar(d.impulse * f * Math.sqrt(ch.mass)); }
        if (d.kind === 'box' && d.iv) iv = d.iv.clone().multiplyScalar(Math.sqrt(ch.mass));
        hit(ch, d.amount * f, iv, wp, d.opts);
      }
    }
  }

  // ---- impact damage ----
  // Rapier's soft contacts spread a hit over several steps and its contact-force events
  // under-read (or miss) hard impacts, so we measure impacts directly: every awake dynamic
  // body's velocity is recorded before the step; after the step, a body whose velocity jumped
  // (J = m * dv) damages the chunks it is touching, and its own chunks if it is debris.
  const preVel = new Map();
  function recordVelocities() {
    preVel.clear();
    world.bodies.forEach((rb) => { if (rb.isDynamic() && !rb.isSleeping()) { const v = rb.linvel(); preVel.set(rb.handle, [v.x, v.y, v.z, rb]); } });
  }
  function processContacts(dt) {
    eventQueue.drainContactForceEvents(() => {}); // keep the queue empty; impacts are measured below
    const restore = [];
    for (const [h, b] of preVel) {
      const rb = b[3]; if (!world.bodies.contains(h)) continue;
      const v = rb.linvel(); const dv = Math.hypot(v.x - b[0], v.y - b[1], v.z - b[2]);
      const J = dv * rb.mass(); const Ftot = J / dt;
      if (Ftot < O.minImpactForce) continue;
      const hits = [];
      for (let i = 0, n = rb.numColliders(); i < n; i++) {
        const co = rb.collider(i);
        world.contactPairsWith(co, (other) => {
          const ob = other.parent(); if (ob && ob.handle === h) return;
          let touching = false; world.contactPair(co, other, (m) => { if (m.numContacts() > 0) touching = true; });
          if (touching) hits.push([colliderChunk.get(co.handle), colliderChunk.get(other.handle), ob]);
        });
      }
      if (!hits.length) continue;
      const F = Ftot / hits.length; let killedMass = 0;
      for (const [own, oth] of hits) for (const ch of [own, oth]) {
        if (!ch || !ch.alive) continue;
        const thr = ch.mat.impactForce; if (F <= thr) continue;
        const dmg = ch.maxHealth * O.impactDamageScale * (F / thr - 1);
        if (dmg < ch.maxHealth * 0.05) continue;
        damageQueue.push({ kind: 'chunk', ch, amount: dmg, iv: null, pt: null, opts: {} });
        emit('impact', { piece: ch.piece.name, chunk: ch.id, force: F, impulse: J });
        if (ch === oth && dmg >= ch.health) killedMass += ch.mass;
      }
      // break-through: smashing a chunk hands most of the impactor's speed back so it carries on
      if (O.breakThrough && killedMass > 0) restore.push([rb, b, Math.min(0.9, rb.mass() / (rb.mass() + killedMass * 2))]);
    }
    for (const [rb, b, k] of restore) { const v = rb.linvel(); rb.setLinvel({ x: v.x + (b[0] - v.x) * k, y: v.y + (b[1] - v.y) * k, z: v.z + (b[2] - v.z) * k }, true); }
  }

  // ---- stress pass (load flow toward anchors, Blast-style idea, simplified) ----
  function stressPass(dt) {
    let maxU = 0;
    for (const rec of bodies) {
      if (rec.type === 'dynamic') continue;
      const chs = rec.chunks; if (!chs.length) continue;
      const r = rec.rb.rotation(); Q1.set(r.x, r.y, r.z, r.w);
      // support potential: Dijkstra from anchors, weak bonds are "long" so load prefers strong paths
      const dist = new Map(); const queue = [];
      const open = [];
      for (const ch of chs) if (ch.anchor) { dist.set(ch, 0); open.push(ch); }
      while (open.length) {
        let bi = 0; for (let k = 1; k < open.length; k++) if (dist.get(open[k]) < dist.get(open[bi])) bi = k;
        const c = open[bi]; open[bi] = open[open.length - 1]; open.pop();
        if (c._done === stressStamp) continue; c._done = stressStamp; queue.push(c);
        const d = dist.get(c);
        for (const b of c.bonds) {
          if (!b.alive) continue; const n = b.a === c ? b.b : b.a; if (n.body !== rec) continue;
          const nd = d + b.cost; if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); open.push(n); }
        }
      }
      stressStamp++;
      // world-space positions (rotation matters for "down")
      const wp = new Map(); for (const ch of chs) wp.set(ch, ch.local.clone().applyQuaternion(Q1));
      const load = new Map(), com = new Map();
      for (const ch of chs) { load.set(ch, ch.mass * g); com.set(ch, wp.get(ch).clone().multiplyScalar(ch.mass * g)); }
      const order = queue.slice().reverse();
      const shaking = shakeNow > 0;
      const fails = [];
      for (const c of order) {
        const d = dist.get(c); if (d === 0) continue;
        const L = load.get(c); const cm = com.get(c).clone().multiplyScalar(1 / L);
        const sup = [];
        let W = 0;
        for (const b of c.bonds) {
          if (!b.alive) continue; const n = b.a === c ? b.b : b.a;
          if (n.body !== rec || !(dist.get(n) < d)) continue;
          const ny = V1.copy(b.n).applyQuaternion(Q1).y * (b.a === c ? 1 : -1); // contact normal from c toward n
          const w = b.cap * (ny < -0.7 ? 3 : 1); sup.push([b, n, ny, w]); W += w;
        }
        for (const [b, n, dy, w] of sup) {
          const flow = L * w / W;
          load.set(n, load.get(n) + flow); com.get(n).addScaledVector(cm, flow);
          const bp = V2.copy(b.p).applyQuaternion(Q1);
          const arm = Math.hypot(cm.x - bp.x, cm.z - bp.z);
          const hf = Math.min(b.a.health / b.a.maxHealth, b.b.health / b.b.maxHealth);
          const capEff = b.cap * b.health * (0.3 + 0.7 * Math.max(0, hf));
          let u;
          if (dy < -0.7) u = flow * (1 + arm / (4 * O.leverRef)) / (capEff * 3);      // compression
          else if (dy > 0.7) u = flow / (capEff * 0.6);                                // hanging (tension)
          else u = flow * (1 + arm / (O.bendDepth * b.h)) / (capEff * 0.8);         // shear + bending (deeper joints resist more)
          b.util = u; b.comp = dy < -0.7; if (u > maxU) maxU = u;
          if (u > 1) { b.strain = (b.strain || 0) + (u - 0.8) * O.stressInterval * O.creepRate; if (b.strain >= 1) fails.push(b); }
          else if (b.strain) b.strain = Math.max(0, b.strain - O.stressInterval * 0.5);
        }
      }
      // unreachable chunks get no stress; the splitter drops them next pass
      fails.sort((x, y) => y.util - x.util);
      for (const b of fails.slice(0, O.maxBondFailsPerTick)) {
        b.alive = false; counters.bondsBroken++; rec.dirty = true; emit('bondFailed', { piece: rec.piece?.name, util: b.util });
        // an overloaded compression joint crushes the chunk ends (so a cut post doesn't keep standing)
        if (b.comp) for (const ch of [b.a, b.b]) damageQueue.push({ kind: 'chunk', ch, amount: ch.maxHealth * Math.min(1.5, 0.35 + (b.util - 1) * 0.7), iv: null, pt: null, opts: { refracture: false } });
      }
      void shaking; void dt;
    }
    lastMaxUtil = maxU;
  }

  let joltClock = 0; const joltDir = new THREE.Vector3();
  function fatigue(dt) {
    if (shakeNow <= 0) return;
    joltClock += dt; const jolt = joltClock >= 0.32;
    if (jolt) { joltClock = 0; const a = rng() * Math.PI * 2; joltDir.set(Math.cos(a), 0, Math.sin(a)); }
    for (const rec of bodies) {
      if (rec.type === 'dynamic') {
        // rattle loose debris and props
        if (jolt && rec.chunks.length) {
          // ground jolts make loose things hop and slide; off-centre so stacks tip
          const m = rec.rb.mass(), k = shakeNow * (0.7 + 0.6 * rng());
          const p = chunkWorld(rec.chunks[Math.floor(rng() * rec.chunks.length)], V2);
          rec.rb.applyImpulseAtPoint({ x: joltDir.x * m * k * O.quakeRattle * 0.25, y: m * k * O.quakeRattle * 0.28, z: joltDir.z * m * k * O.quakeRattle * 0.25 }, { x: p.x, y: p.y, z: p.z }, true);
        }
        continue;
      }
      for (const ch of rec.chunks) for (const b of ch.bonds) {
        if (!b.alive || b.a !== ch) continue;
        // bonds with horizontal contact planes (posts, joints) take lateral racking; loaded bonds wear faster
        const ny = Math.abs(b.a.local.y - b.b.local.y) / Math.max(1e-3, b.a.local.distanceTo(b.b.local));
        const wear = dt * shakeNow * O.fatigueRate * ch.mat.fatigue * (0.25 + ny) * (0.3 + Math.min(1.5, b.util)) * b.weak * (0.6 + 0.8 * rng());
        b.health -= wear;
        if (b.health <= 0) { b.alive = false; counters.bondsBroken++; rec.dirty = true; }
      }
    }
  }

  // ---- island splitting (flood fill from anchors) ----
  function splitDirty() {
    const dirty = bodies.filter((b) => b.dirty);
    for (const rec of dirty) {
      rec.dirty = false;
      if (!rec.chunks.length) { removeBody(rec); continue; }
      const seen = new Set(); const comps = [];
      for (const s of rec.chunks) {
        if (seen.has(s)) continue;
        const comp = [s]; seen.add(s);
        for (let i = 0; i < comp.length; i++) for (const b of comp[i].bonds) {
          if (!b.alive) continue; const n = b.a === comp[i] ? b.b : b.a;
          if (n.body === rec && !seen.has(n)) { seen.add(n); comp.push(n); }
        }
        comps.push(comp);
      }
      let keep;
      if (rec.type !== 'dynamic') keep = (c) => c.some((ch) => ch.anchor);
      else {
        if (comps.length < 2) continue;
        let best = comps[0], bm = -1; for (const c of comps) { const m = c.reduce((a, ch) => a + ch.mass, 0); if (m > bm) { bm = m; best = c; } }
        keep = (c) => c === best;
      }
      const t = rec.rb.translation(), r = rec.rb.rotation();
      const pos = new THREE.Vector3(t.x, t.y, t.z), rot = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      for (const comp of comps) {
        if (keep(comp)) continue;
        const vels = comp.map((ch) => (rec.type === 'dynamic' ? pointVel(rec.rb, chunkWorld(ch, V1), new THREE.Vector3()) : new THREE.Vector3()));
        const av = rec.type === 'dynamic' ? rec.rb.angvel() : { x: 0, y: 0, z: 0 };
        const mass = comp.reduce((a, ch) => a + ch.mass, 0);
        const small = comp.length === 1 && comp[0].vol < O.crumbVolume;
        if (small || (comp.length === 1 && dynCount() >= cap)) {
          const ch = comp[0]; const wp = chunkWorld(ch, new THREE.Vector3()); detach(ch); ch.alive = false;
          crumbsFrom(wp, ch.mat, ch.vol, vels[0], 1); hideChunk(ch); continue;
        }
        for (const ch of comp) detach(ch);
        const nb = makeBody('dynamic', pos, rot, rec.piece);
        for (const ch of comp) attach(ch, nb);
        const v = vels.reduce((a, x) => a.add(x), new THREE.Vector3()).multiplyScalar(1 / comp.length);
        nb.rb.setLinvel({ x: v.x, y: v.y, z: v.z }, true); nb.rb.setAngvel(av, true);
        setDebrisFlags(nb);
        if (comp.length > 1) { counters.islands++; emit('islandDetached', { piece: rec.piece?.name, chunks: comp.length, mass, body: nb.rb }); }
      }
      if (!rec.chunks.length) removeBody(rec);
    }
  }

  function applyPendingImpulses() {
    for (const rec of bodies) {
      for (const ch of rec.chunks) {
        if (!ch.impulse) continue;
        if (rec.type === 'dynamic') rec.rb.applyImpulseAtPoint({ x: ch.impulse.x, y: ch.impulse.y, z: ch.impulse.z }, { x: ch.impulsePt.x, y: ch.impulsePt.y, z: ch.impulsePt.z }, true);
        ch.impulse = null;
      }
    }
  }

  // ---- fields (flood buoyancy, tornado, wind...) ----
  // fn(p: Vector3 world chunk centre, v: Vector3 point velocity, info) -> Vector3 force (N) or null
  function applyField(fn, dt) {
    const p = new THREE.Vector3(), v = new THREE.Vector3();
    const info = { volume: 0, mass: 0, radius: 0, material: '', body: null, chunk: null };
    for (const rec of bodies) {
      if (rec.type !== 'dynamic' || rec.fading) continue;
      for (const ch of rec.chunks) {
        chunkWorld(ch, p); pointVel(rec.rb, p, v);
        info.volume = ch.vol; info.mass = ch.mass; info.radius = ch.r; info.material = ch.matName; info.body = rec.rb; info.chunk = ch;
        const f = fn(p, v, info);
        if (f && (f.x || f.y || f.z)) rec.rb.applyImpulseAtPoint({ x: f.x * dt, y: f.y * dt, z: f.z * dt }, { x: p.x, y: p.y, z: p.z }, true);
      }
    }
  }

  // ---- runtime refracture (three-pinata in a Web Worker) ----
  let worker = null;
  if (O.refracture && typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && O.pinataURL) {
    try {
      const src = `import * as THREE from '${O.workerThreeURL}';
import { DestructibleMesh, FractureOptions } from '${O.pinataURL}';
const mA = new THREE.MeshBasicMaterial(), mB = new THREE.MeshBasicMaterial();
self.onmessage = (e) => {
  const j = e.data;
  try {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(j.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(j.nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(j.pos.length / 3 * 2), 2));
    g.setIndex(new THREE.BufferAttribute(j.idx, 1));
    const frags = new DestructibleMesh(g, mA, mB).fracture(new FractureOptions({ fragmentCount: j.cells, seed: j.seed,
      voronoiOptions: { mode: '3D', impactPoint: new THREE.Vector3(...j.impact), impactRadius: j.radius } }));
    const out = [], tr = [];
    for (const f of frags) {
      const fg = f.geometry; const ig = fg.groups.find((q) => q.materialIndex === 1);
      const o = { c: f.position.toArray(), pos: fg.attributes.position.array.slice(), nrm: fg.attributes.normal.array.slice(), idx: Uint32Array.from(fg.index.array), innerStart: ig ? ig.start : 1e9 };
      out.push(o); tr.push(o.pos.buffer, o.nrm.buffer, o.idx.buffer);
    }
    self.postMessage({ id: j.id, frags: out }, tr);
  } catch (err) { self.postMessage({ id: j.id, error: String(err) }); }
};
self.postMessage({ ready: true });`;
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
      worker.onmessage = (e) => { if (e.data.ready) worker.ready = true; else workerResults.set(e.data.id, e.data); };
      worker.onerror = () => { worker = null; };
    } catch { worker = null; }
  }
  function jobPayload(job) {
    const geo = job.ch.mesh ? job.ch.mesh.geometry : job.ch.piece.def.chunks[job.ch.idx].geometry;
    const idx = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: geo.attributes.position.count }, (_, i) => i);
    const inv = job.rot.clone().invert();
    const imp = job.impact.clone().sub(job.wp).applyQuaternion(inv);
    return { id: job.id, seed: job.seed, cells: O.refractureCells, pos: geo.attributes.position.array.slice(), nrm: geo.attributes.normal.array.slice(), idx, impact: imp.toArray(), radius: job.ch.r * 0.8 };
  }
  function postJob(job) { job.payload = jobPayload(job); if (worker) { const p = job.payload; worker.postMessage({ ...p, pos: p.pos.slice(), nrm: p.nrm.slice(), idx: p.idx.slice() }); } }
  function fractureSync(job) {
    const P = O.mainPinata; if (!P) return null;
    const j = job.payload; const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(j.pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(j.nrm, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((j.pos.length / 3) * 2), 2)); geo.setIndex(new THREE.BufferAttribute(j.idx, 1));
    const m = new THREE.MeshBasicMaterial();
    const frags = new P.DestructibleMesh(geo, m, m).fracture(new P.FractureOptions({ fragmentCount: j.cells, seed: j.seed, voronoiOptions: { mode: '3D', impactPoint: new THREE.Vector3(...j.impact), impactRadius: j.radius } }));
    return { frags: frags.map((f) => { const ig = f.geometry.groups.find((q) => q.materialIndex === 1); return { c: f.position.toArray(), pos: f.geometry.attributes.position.array, nrm: f.geometry.attributes.normal.array, idx: f.geometry.index.array, innerStart: ig ? ig.start : 1e9 }; }) };
  }
  function processRefractures() {
    for (let i = 0; i < refractJobs.length; i++) {
      const job = refractJobs[i]; if (job.due > step) continue;
      refractJobs.splice(i--, 1);
      let res = workerResults.get(job.id); workerResults.delete(job.id);
      if (res && !res.error) counters.workerFractures++;
      else { try { res = fractureSync(job); if (res) counters.syncFractures++; } catch { res = null; } }
      const ch = job.ch;
      if (!res || !res.frags?.length) { crumbsFrom(job.wp, ch.mat, ch.vol, job.vel, 2); continue; }
      counters.refractures++;
      emit('refracture', { piece: ch.piece.name, chunk: ch.id, fragments: res.frags.length, position: job.wp.clone() });
      burst(job.wp, ch.mat, ch.vol * 2, 2);
      // larger fragments become physical debris, the rest become crumbs
      const frs = res.frags.map((f, k) => ({ f, k, vol: fragVolume(f) })).sort((a, b) => b.vol - a.vol || a.k - b.k);
      const iv = job.iv; const mat = ch.mat;
      for (const { f, vol } of frs) {
        const lc = new THREE.Vector3(...f.c);
        const wpos = lc.clone().applyQuaternion(job.rot).add(job.wp);
        const out = wpos.clone().sub(job.impact).normalize();
        if (vol < O.crumbVolume || dynCount() >= cap) { crumbsFrom(wpos, mat, vol, job.vel.clone().addScaledVector(out, 3), 2); continue; }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(f.pos), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(f.nrm), 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(f.idx), 1));
        colorFragment(geo, f.innerStart, mat);
        const fch = { piece: ch.piece, idx: -1, id: ch.id + '/f', matName: ch.matName, mat, local: new THREE.Vector3(), vol, mass: vol * mat.density, r: 0, anchor: false,
          health: 1e9, maxHealth: mat.health, alive: true, bonds: [], hull: uniquePositions(geo), body: null, collider: null, mesh: null, impulse: null, ownGeometry: true, debris: true };
        geo.computeBoundingSphere(); fch.r = geo.boundingSphere.radius;
        const mesh = new THREE.Mesh(geo, renderMats[ch.matName]); mesh.castShadow = true; mesh.matrixAutoUpdate = false; fch.mesh = mesh; group.add(mesh);
        const d = makeBody('dynamic', wpos, job.rot, ch.piece);
        attach(fch, d); fch.alive = false; setDebrisFlags(d);
        const kick = out.multiplyScalar((iv.length() / Math.max(1, ch.mass)) * 0.6 + 1.5);
        d.rb.setLinvel({ x: job.vel.x + kick.x, y: job.vel.y + kick.y, z: job.vel.z + kick.z }, true);
        d.rb.setAngvel({ x: (fxRng() - 0.5) * 6, y: (fxRng() - 0.5) * 6, z: (fxRng() - 0.5) * 6 }, true);
      }
    }
  }
  function fragVolume(f) {
    let V = 0; const p = f.pos, ix = f.idx;
    for (let i = 0; i < ix.length; i += 3) {
      const a = ix[i] * 3, b = ix[i + 1] * 3, c = ix[i + 2] * 3;
      V += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
    }
    return Math.abs(V);
  }
  function colorFragment(geo, innerStart, mat) {
    const n = geo.attributes.position.count; const col = new Float32Array(n * 3);
    const o = new THREE.Color(mat.color), inn = new THREE.Color(mat.inner); const ix = geo.index.array;
    for (let i = 0; i < n; i++) { col[i * 3] = o.r; col[i * 3 + 1] = o.g; col[i * 3 + 2] = o.b; }
    for (let k = innerStart; k < ix.length; k++) { const v = ix[k]; col[v * 3] = inn.r; col[v * 3 + 1] = inn.g; col[v * 3 + 2] = inn.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }

  // ---- tier 2: instanced crumbs (no colliders) ----
  const crumbGeo = new THREE.TetrahedronGeometry(1, 0);
  const crumbMesh = new THREE.InstancedMesh(crumbGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), O.crumbMax);
  crumbMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); crumbMesh.count = 0; crumbMesh.frustumCulled = false; crumbMesh.castShadow = false;
  crumbMesh.setColorAt(0, new THREE.Color(1, 1, 1));
  group.add(crumbMesh);
  const crumbs = []; let crumbHead = 0;
  const M4 = new THREE.Matrix4(), S3 = new THREE.Vector3(), E1 = new THREE.Euler(), CC = new THREE.Color();
  function crumbsFrom(pos, mat, vol, vel, energy = 1) {
    const n = Math.max(3, Math.min(40, Math.round(vol * 900)));
    for (let i = 0; i < n; i++) {
      const c = { p: pos.clone().add(V1.set(fxRng() - 0.5, fxRng() - 0.5, fxRng() - 0.5).multiplyScalar(Math.cbrt(vol) * 1.2)),
        v: new THREE.Vector3((fxRng() - 0.5) * 3 * energy, fxRng() * 2.5 * energy, (fxRng() - 0.5) * 3 * energy).add(vel || V2.set(0, 0, 0)),
        s: 0.025 + fxRng() * Math.min(0.09, Math.cbrt(vol) * 0.3), life: 3 + fxRng() * 3, age: 0, rx: fxRng() * 6, ry: fxRng() * 6, spin: (fxRng() - 0.5) * 12, color: fxRng() < 0.5 ? mat.inner : mat.color };
      if (crumbs.length < O.crumbMax) crumbs.push(c); else { crumbs[crumbHead] = c; crumbHead = (crumbHead + 1) % O.crumbMax; }
    }
  }
  function updateCrumbs(dt) {
    let w = 0;
    for (let i = 0; i < crumbs.length; i++) {
      const c = crumbs[i]; c.age += dt; if (c.age >= c.life) continue;
      c.v.y -= g * dt; c.p.addScaledVector(c.v, dt);
      const gy = O.groundHeight(c.p.x, c.p.z) + c.s * 0.5;
      if (c.p.y < gy) { c.p.y = gy; c.v.y *= -0.25; c.v.x *= 0.6; c.v.z *= 0.6; c.spin *= 0.5; }
      c.rx += c.spin * dt;
      const s = c.s * Math.min(1, (c.life - c.age) / 0.8);
      M4.compose(c.p, Q1.setFromEuler(E1.set(c.rx, c.ry, 0)), S3.set(s, s, s));
      crumbMesh.setMatrixAt(w, M4); crumbMesh.setColorAt(w, CC.setHex(c.color)); w++;
    }
    // compact dead crumbs occasionally
    if (crumbs.length > 200 && step % 30 === 0) { const alive = crumbs.filter((c) => c.age < c.life); crumbs.length = 0; crumbs.push(...alive); crumbHead = 0; }
    crumbMesh.count = w; crumbMesh.instanceMatrix.needsUpdate = true; if (crumbMesh.instanceColor) crumbMesh.instanceColor.needsUpdate = true;
  }

  // ---- tier 3: dust particles ----
  const dustGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(O.dustMax * 3), dCol = new Float32Array(O.dustMax * 3), dSize = new Float32Array(O.dustMax), dAlpha = new Float32Array(O.dustMax);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3).setUsage(THREE.DynamicDrawUsage));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(dCol, 3).setUsage(THREE.DynamicDrawUsage));
  dustGeo.setAttribute('aSize', new THREE.BufferAttribute(dSize, 1).setUsage(THREE.DynamicDrawUsage));
  dustGeo.setAttribute('aAlpha', new THREE.BufferAttribute(dAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, vertexColors: true,
    uniforms: { uScale: { value: 600 } },
    vertexShader: `attribute float aSize; attribute float aAlpha; varying vec3 vC; varying float vA; uniform float uScale;
      void main(){ vC = color; vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vC, vA * (1.0 - r * 4.0)); }`,
  });
  const dust = new THREE.Points(dustGeo, dustMat); dust.frustumCulled = false; group.add(dust);
  const puffs = []; let puffHead = 0;
  function burst(pos, mat, vol, energy = 1) {
    const n = Math.max(4, Math.min(30, Math.round(6 + vol * 120)));
    const col = new THREE.Color(mat.inner).lerp(new THREE.Color(0xd8d2c8), 0.5);
    for (let i = 0; i < n; i++) {
      const p = { p: pos.clone(), v: new THREE.Vector3((fxRng() - 0.5) * 2.4 * energy, fxRng() * 1.6 * energy + 0.3, (fxRng() - 0.5) * 2.4 * energy), s: 0.25 + fxRng() * 0.4, age: 0, life: 1.2 + fxRng() * 1.4, c: col };
      if (puffs.length < O.dustMax) puffs.push(p); else { puffs[puffHead] = p; puffHead = (puffHead + 1) % O.dustMax; }
    }
  }
  function updateDust(dt) {
    let w = 0;
    for (const p of puffs) {
      p.age += dt; if (p.age >= p.life) continue;
      p.v.multiplyScalar(1 - 1.8 * dt); p.v.y += 0.3 * dt; p.p.addScaledVector(p.v, dt);
      const k = p.age / p.life;
      dPos[w * 3] = p.p.x; dPos[w * 3 + 1] = p.p.y; dPos[w * 3 + 2] = p.p.z;
      dCol[w * 3] = p.c.r; dCol[w * 3 + 1] = p.c.g; dCol[w * 3 + 2] = p.c.b;
      dSize[w] = p.s * (1 + k * 2.5); dAlpha[w] = 0.55 * (1 - k) * Math.min(1, p.age * 8); w++;
    }
    if (puffs.length > 200 && step % 30 === 0) { const alive = puffs.filter((p) => p.age < p.life); puffs.length = 0; puffs.push(...alive); puffHead = 0; }
    dustGeo.setDrawRange(0, w);
    for (const n of ['position', 'color', 'aSize', 'aAlpha']) dustGeo.attributes[n].needsUpdate = true;
  }

  // ---- debris lifecycle, cap, fades ----
  function manageDebris(dt, frameMs) {
    if (O.adaptiveCap && frameMs) {
      frameEMA = frameEMA * 0.95 + frameMs * 0.05;
      if (frameEMA > O.targetFrameMs * 1.3) cap = Math.max(O.minDebris, cap - 30 * dt);
      else if (frameEMA < O.targetFrameMs * 1.05) cap = Math.min(O.maxDebris, cap + 10 * dt);
    }
    const capI = Math.floor(cap);
    const dyn = [];
    for (const rec of bodies) {
      if (rec.type !== 'dynamic') continue;
      const t = rec.rb.translation();
      if (t.y < O.killY) { rec.dead = true; continue; }
      if (rec.rb.isSleeping()) rec.sleepT += dt; else rec.sleepT = 0;
      if (!rec.rb.isSleeping()) { // squeezed debris can be ejected by penetration recovery; keep it sane
        const v = rec.rb.linvel(); const sp = Math.hypot(v.x, v.y, v.z);
        if (sp > O.maxDebrisSpeed) { const k = O.maxDebrisSpeed / sp; rec.rb.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true); }
        if (v.y > O.maxDebrisRise) rec.rb.setLinvel({ x: v.x, y: O.maxDebrisRise, z: v.z }, true);
      }
      if (rec.fading) { rec.fade += dt / 0.6; if (rec.fade >= 1) rec.dead = true; continue; }
      if (rec.chunks.length <= 2 && rec.mass < 60 && rec.sleepT > O.debrisLife) startFade(rec);
      dyn.push(rec);
    }
    // over cap: fade oldest small debris first (never whole islands unless desperate)
    let over = dyn.length - capI;
    if (over > 20) { const old = dyn.filter((r) => r.chunks.length <= 2).sort((a, b) => (a.born - b.born) || (a.id - b.id)); for (const r of old.slice(0, over - 20)) { r.dead = true; counters.evicted++; } over = 20; }
    if (over > 0) {
      const cand = dyn.filter((r) => !r.fading && !r.dead).sort((a, b) => (a.chunks.length - b.chunks.length) || (a.born - b.born) || (a.id - b.id));
      for (const r of cand) { if (over <= 0) break; startFade(r); counters.evicted++; over--; }
    }
    for (const rec of bodies.slice()) if (rec.dead) {
      for (const ch of rec.chunks) if (ch.mesh) crumbsFrom(chunkWorld(ch, new THREE.Vector3()), ch.mat, ch.vol * 0.5, null, 0.3);
      removeBody(rec);
    }
  }
  function startFade(rec) { if (rec.fading) return; rec.fading = true; rec.fade = 0; rec.rb.userData.grabbable = false; }

  // ---- mesh sync ----
  function syncBody(rec, force = false) {
    const rb = rec.rb;
    if (!force && !rec.needsSync && rec.type !== 'kinematic' && (rec.type === 'fixed' || rb.isSleeping()) && !rec.fading) return;
    rec.needsSync = false;
    const t = rb.translation(), r = rb.rotation(); Q1.set(r.x, r.y, r.z, r.w); V3.set(t.x, t.y, t.z);
    const s = rec.fading ? Math.max(0.001, 1 - rec.fade) : 1;
    for (const ch of rec.chunks) {
      if (!ch.mesh) continue;
      V1.copy(ch.local).applyQuaternion(Q1).add(V3);
      ch.mesh.matrix.compose(V1, Q1, S3.set(s, s, s)); ch.mesh.matrixWorldNeedsUpdate = true;
    }
  }

  // ---- per-frame entry points ----
  function preStep(dt) {
    step++; time += dt;
    refractTokens = Math.min(O.refracturePerSecond, refractTokens + O.refracturePerSecond * dt);
    processRefractures();
    processDamage();
    fatigue(dt);
    stressClock += dt;
    if (stressClock >= O.stressInterval) { stressClock = 0; stressPass(dt); }
    splitDirty();
    applyPendingImpulses();
    recordVelocities();
    shakeNow = 0;
  }
  function postStep(dt, frameMs) {
    processContacts(dt);
    manageDebris(dt, frameMs);
    for (const rec of bodies) syncBody(rec);
    updateCrumbs(dt); updateDust(dt);
  }
  function update(dt, { frameMs } = {}) {
    world.timestep = dt;
    preStep(dt); world.step(eventQueue); postStep(dt, frameMs);
  }

  function stats() {
    let fading = 0, fixed = 0, dynamic = 0, chunksAlive = 0, intact = 0, bondsAlive = 0, grabbable = 0, sleeping = 0, chunksTotal = 0;
    for (const rec of bodies) {
      if (rec.type === 'dynamic') { if (rec.fading) { fading++; continue; } dynamic++; if (rec.rb.userData.grabbable) grabbable++; if (rec.rb.isSleeping()) sleeping++; } else { fixed++; intact += rec.chunks.length; }
    }
    for (const p of pieces) { chunksTotal += p.chunks.length; for (const c of p.chunks) if (c.alive) chunksAlive++; for (const b of p.bonds) if (b.alive) bondsAlive++; }
    return { pieces: pieces.length, bodies: bodies.length, fixedBodies: fixed, debris: dynamic, fading, debrisCap: Math.floor(cap), grabbable, sleeping, chunksTotal, chunksAlive, chunksIntact: intact, bondsAlive,
      crumbs: crumbMesh.count, dust: dustGeo.drawRange.count, pendingRefractures: refractJobs.length, workerReady: !!(worker && worker.ready), maxUtil: +lastMaxUtil.toFixed(3), ...counters };
  }
  // per-piece view for tests and gameplay (e.g. "is this floor still standing?")
  function pieceState(piece) {
    if (typeof piece === 'string') piece = pieces.find((p) => p.name === piece);
    if (!piece) return null;
    const bs = bodies.filter((b) => b.piece === piece);
    return {
      name: piece.name, alive: piece.chunks.filter((c) => c.alive).length, total: piece.chunks.length,
      anchoredChunks: bs.filter((b) => b.type !== 'dynamic').reduce((a, b) => a + b.chunks.length, 0),
      islands: bs.filter((b) => b.type === 'dynamic' && b.chunks.length > 1).map((b) => ({ chunks: b.chunks.length, mass: Math.round(b.mass), y: +(b.chunks.reduce((a, ch) => a + chunkWorld(ch, V1).y, 0) / b.chunks.length).toFixed(2), sleeping: b.rb.isSleeping() })),
      looseDebris: bs.filter((b) => b.type === 'dynamic' && b.chunks.length === 1).length,
      bondsAlive: piece.bonds.filter((b) => b.alive).length, maxUtil: +Math.max(0, ...piece.bonds.filter((b) => b.alive).map((b) => b.util)).toFixed(3),
    };
  }
  function clear() {
    for (const p of pieces.slice()) removePiece(p);
    for (const rec of bodies.slice()) removeBody(rec);
    crumbs.length = 0; puffs.length = 0; refractJobs.length = 0; workerResults.clear(); damageQueue.length = 0;
    crumbMesh.count = 0; dustGeo.setDrawRange(0, 0);
  }
  function dispose() { clear(); scene.remove(group); if (worker) worker.terminate(); eventQueue.free(); }

  return {
    addPiece, removePiece, setPieceTransform, damageSphere, damageBox, damageChunk, shake, applyField,
    preStep, postStep, update, stats, pieceState, clear, dispose,
    eventQueue, group, pieces, get bodies() { return bodies; }, options: O,
    isDestructBody: (rb) => !!rb?.userData?.destruct,
  };
}
