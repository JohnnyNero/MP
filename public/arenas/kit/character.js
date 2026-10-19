// character.js: wobbly active-ragdoll players for TABLETOP arenas (Three.js 0.160 + Rapier compat 0.12, no build step).
// See CHARACTER_API.md. One call builds N players; the page owns the world, the loop, the camera and the arena.
// KIT COPY of proto3d/character.js, adapted for the arena kit (kit/ragdoll.js wraps it in the kit player interface):
//   options.massScale (uniform mass scale, so the toy matches arena prop masses), options.respawn (false = never respawn;
//   the kit eliminates instead), options.ledges may be a function and holds generic segments { a, b, body } in any
//   direction (legacy [x, y, z0, z1] still works), options.groundVelocity (moving kinematic floors carry the ball),
//   options.hitMassRef, grabs on kinematic colliders, removed-body guards, kill() and dispose(), no DOM chips.
//
// Physics per player: 6 rigid bodies (locomotion ball, pelvis, chest, head, two hands). The ball rolls under the
// pelvis on a hand-made soft suspension; the torso is held up by an under-strength lift budget, a soft centring
// spring and orientation springs, so it wobbles. Only point joints are used (Rapier 0.12's spring / rope / angular
// joints proved unstable for this); cone limits, tethers and springs are applied as impulses before world.step().

const NO_INPUT = Object.freeze({ mx: 0, my: 0, aim: 0, jump: false, grab: false });

export function createPlayers({ THREE, RAPIER, SkeletonUtils, scene, world, models, rng = Math.random, spawnPoints, options = {} }) {
  const CH = options.scale ?? 0.75;
  const COLORS = options.colors ?? ['#ef5a4f', '#3f86e8', '#43b65a', '#f2b51c'];
  const HATS = options.hats ?? ['acc_sprout', 'acc_bow', 'acc_crown', 'acc_propeller'];
  const MS = options.massScale ?? 1;                   // uniform mass scale (all forces are mass-relative)
  const LEDGE_SRC = options.ledges ?? [];              // [x, y, z0, z1] along z, or { a: [x,y,z], b: [x,y,z], body } in any direction; or a function returning them (world space)
  let LEDGES = [];
  const normLedge = l => Array.isArray(l) ? { ax: l[0], ay: l[1], az: l[2], bx: l[0], by: l[1], bz: l[3], body: null } : { ax: l.a[0], ay: l.a[1], az: l.a[2], bx: l.b[0], by: l.b[1], bz: l.b[2], body: l.body || null };
  const refreshLedges = () => { const src = typeof LEDGE_SRC === 'function' ? LEDGE_SRC() : LEDGE_SRC; LEDGES = (src || []).map(normLedge); };
  const RESPAWN = options.respawn ?? true;
  const groundVel = options.groundVelocity ?? null;     // (rb, point, out) -> velocity of a moving kinematic floor at point
  const HIT_MREF = options.hitMassRef ?? 1;            // impact dv uses mh / (mh + M_TOTAL * HIT_MREF)
  const chipParent = options.chipParent ?? null;       // element for name chips (optional)
  const bounds = options.bounds ?? { min: [-50, -4, -50], max: [50, 60, 50] };
  const count = options.count ?? spawnPoints.length;
  const controllers = options.controllers ?? [];
  const GRAV = world.gravity.y;
  const partOf = new Map();                            // collider handle -> { bean, part, p }
  const danger = new Map();                            // body handle -> { body, until, v0 }
  const listeners = [];
  const stats = { maxHit: 0 };
  const emit = (type, ...args) => { for (const fn of listeners) fn(type, ...args); };
  const outOfBounds = p => !Number.isFinite(p.x) || p.x < bounds.min[0] || p.y < bounds.min[1] || p.z < bounds.min[2] || p.x > bounds.max[0] || p.y > bounds.max[1] || p.z > bounds.max[2];
  const anchorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());   // grip anchor for static ledges
  let simTime = 0;
  function markDangerous(body, seconds = Infinity) {
    const e = danger.get(body.handle);
    if (e) e.until = Math.max(e.until, simTime + seconds); else danger.set(body.handle, { body, until: simTime + seconds, v0: body.linvel() });
    // impacts are measured from contact-force events: make sure this body reports them
    for (let k = 0; k < body.numColliders(); k++) { const c = body.collider(k); if (!c) continue; try { c.setActiveEvents(c.activeEvents() | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS); c.setContactForceEventThreshold?.(0); } catch (err) { /* collider gone */ } }
  }

  // ---------------------------------------------------------------- dust puffs (cheap sprite pool)
  const puffTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.55, 'rgba(255,255,255,0.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; })();
  const owned = [];   // scene objects to remove on dispose()
  const puffs = [];
  for (let k = 0; k < 32; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: '#eadbc0', transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; scene.add(s); owned.push(s); puffs.push({ s, life: 0, vx: 0, vy: 0, vz: 0, size: 0.3 });
  }
  let puffIx = 0;
  function puff(x, y, z, n = 5, size = 0.32, col = '#eadbc0') {
    for (let k = 0; k < n; k++) {
      const p = puffs[puffIx++ % puffs.length], a = k / n * Math.PI * 2 + rng();
      p.s.position.set(x + Math.cos(a) * 0.1, y + 0.06, z + Math.sin(a) * 0.1);
      p.vx = Math.cos(a) * 1.2; p.vz = Math.sin(a) * 1.2; p.vy = 0.3 + rng() * 0.3; p.life = 0.5; p.size = size * (0.8 + rng() * 0.4);
      p.s.material.color.set(col); p.s.visible = true;
    }
  }
  function tickPuffs(dt) {
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
      p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt; p.vx *= 0.9; p.vz *= 0.9;
      const t = 1 - p.life / 0.5; p.s.scale.setScalar(p.size * (0.6 + t * 1.2)); p.s.material.opacity = 0.75 * (1 - t);
    }
  }

  // ---------------------------------------------------------------- blobs: look
  const BLOB_SCALE = 1.08 * CH;
  const WHITE = new THREE.Color('#ffffff');
  const outlineMat = new THREE.MeshBasicMaterial({ color: '#2b2238', side: THREE.BackSide });
  outlineMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <skinning_vertex>',
      '#include <skinning_vertex>\n\ttransformed += normalize( objectNormal ) * 0.024;');
  };
  function makeBlobMesh(i) {
    const root = new THREE.Group();                                         // follows the pelvis body (position + full rotation)
    const leanG = new THREE.Group(); root.add(leanG);                       // offset so the feet sit under the pelvis
    const squashG = new THREE.Group(); leanG.add(squashG);
    const model = SkeletonUtils.clone(models.blob.scene); model.scale.setScalar(BLOB_SCALE); squashG.add(model);
    const col = new THREE.Color(COLORS[i % COLORS.length]);
    const mats = { body: null, body_tint: null };
    const outlines = [];
    let blade = null;
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      const n = o.material.name;
      if (n in mats) {
        mats[n] ||= Object.assign(o.material.clone(), { name: n });
        mats[n].color.copy(n === 'body' ? col : col.clone().lerp(WHITE, 0.4));
        o.material = mats[n];
      }
      if (n === 'acc_blade') blade = o;
      if (options.outline && o.isSkinnedMesh && (n === 'body' || n === 'sole')) outlines.push(o);   // no outline by default
    });
    // silhouette: the body drawn again only where scenery stands in front of it, so a hidden bean still shows.
    // Draw order does the work: scenery (renderOrder 0), then the silhouette (1, passes only behind scenery depth),
    // then the bean itself (2) on top wherever it is visible, so the silhouette never tints the bean's own parts.
    const silMat = new THREE.MeshBasicMaterial({ color: col.clone().lerp(WHITE, 0.35), depthWrite: false, depthFunc: THREE.GreaterDepth, toneMapped: false });
    const sil = [];
    model.traverse(o => { if (o.isMesh) o.renderOrder = 2; if (o.isSkinnedMesh && (o.material.name === 'body' || o.material.name === 'body_tint')) sil.push(o); });
    for (const m of sil) {
      const o = new THREE.SkinnedMesh(m.geometry, silMat);
      o.bind(m.skeleton, m.bindMatrix); o.castShadow = false; o.frustumCulled = false; o.renderOrder = 1;
      o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
      m.parent.add(o);
    }
    for (const m of outlines) {
      const o = new THREE.SkinnedMesh(m.geometry, outlineMat);
      o.bind(m.skeleton, m.bindMatrix); o.castShadow = false; o.frustumCulled = false;
      o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
      m.parent.add(o);
    }
    for (const h of HATS) { const o = model.getObjectByName(h); if (o) o.visible = h === HATS[i % HATS.length]; }
    const mixer = new THREE.AnimationMixer(model);
    const acts = {};
    for (const clip of models.blob.animations) acts[clip.name] = mixer.clipAction(clip);
    acts.idle.play();
    const bone = n => model.getObjectByName(n) || model.getObjectByName(n.replace(/[.\[\]:\/]/g, ''));
    // each arm bone's rest roll (its +Z axis in the character frame), so posing never depends on the animated pose
    root.updateMatrixWorld(true);
    const restZ = n => { const b = bone(n); return b ? V(0, 0, 1).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())) : V(0, 0, 1); };
    const armRestZ = [['upperarm.L', 'forearm.L'], ['upperarm.R', 'forearm.R']].map(ns => ns.map(restZ));
    const key = bone('windkey');
    return { root, leanG, squashG, model, mixer, acts, anim: 'idle', headBone: bone('head'), spineBone: bone('spine'),
             armBones: [[bone('upperarm.L'), bone('forearm.L'), bone('hand.L')], [bone('upperarm.R'), bone('forearm.R'), bone('hand.R')]], armRestZ, armPole: [null, null], armElbow: [null, null], armZ: [null, null], armHand: [null, null],
             key, keyRest: key ? key.quaternion.clone() : null, blade: HATS[i % HATS.length] === 'acc_propeller' ? blade : null };
  }

  // bone helpers: rotate a bone by a WORLD-space rotation, and point a bone's +Y at a world point
  const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qz = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _vS = new THREE.Vector3(), _vE = new THREE.Vector3(), _vT = new THREE.Vector3(), _vP = new THREE.Vector3();
  const YAXIS = new THREE.Vector3(0, 1, 0), ZAXIS = new THREE.Vector3(0, 0, 1), XAXIS = new THREE.Vector3(1, 0, 0);
  function rotateBoneWorld(bone, qWorld) {
    bone.parent.getWorldQuaternion(_q1);
    _q2.copy(_q1).invert().multiply(qWorld).multiply(_q1);
    bone.quaternion.premultiply(_q2);
    bone.updateMatrixWorld(true);
  }
  // pose a bone so its +Y points at a world point and its +Z stays as close as possible to refZ (a fully defined
  // orientation: no shortest-arc spin from whatever the animation left, which flipped arms near 180 degrees)
  const _m = new THREE.Matrix4(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _qw = new THREE.Quaternion();
  function poseBone(bone, target, refZ) {
    bone.getWorldPosition(_v1);
    _by.copy(target).sub(_v1); if (_by.lengthSq() < 1e-10) return; _by.normalize();
    _bz.copy(refZ).addScaledVector(_by, -refZ.dot(_by)); if (_bz.lengthSq() < 1e-6) return; _bz.normalize();
    _bx.crossVectors(_by, _bz);
    _qw.setFromRotationMatrix(_m.makeBasis(_bx, _by, _bz));
    bone.parent.getWorldQuaternion(_q1); bone.quaternion.copy(_q1.invert().multiply(_qw)); bone.updateMatrixWorld(true);
  }
  function aimBone(bone, target) {
    bone.getWorldPosition(_v1);
    _v2.copy(target).sub(_v1); if (_v2.lengthSq() < 1e-8) return; _v2.normalize();
    bone.getWorldQuaternion(_q1); _v3.copy(YAXIS).applyQuaternion(_q1);
    _qz.setFromUnitVectors(_v3, _v2);
    rotateBoneWorld(bone, _qz);
  }

  // ---------------------------------------------------------------- blobs: active-ragdoll body (full 3D)
  // 6 rigid bodies per player: locomotion ball, pelvis, chest, head, two hands. The ball rolls under the
  // pelvis on a hand-made soft suspension; the torso is held up by an under-strength lift budget, a soft
  // centring spring and orientation springs, so it wobbles. Only point joints are used (Rapier 0.12's
  // spring / rope / angular joints proved unstable here); cone limits, tethers and springs are hand-made.
  const K = CH / 0.75;          // all lengths scale with the character size option
  const R = { ball: 0.15 * K, pelvis: 0.21 * K, chest: 0.24 * K, head: 0.23 * K, hand: 0.075 * K };
  const Y = { ball: 0.15 * K, pelvis: 0.40 * K, chest: 0.62 * K, head: 0.86 * K, waist: 0.51 * K, neck: 0.75 * K, shoulder: 0.745 * K };
  const SHOULDER_X = 0.2 * K;
  const MASS = Object.fromEntries(Object.entries({ ball: 0.7, pelvis: 1.2, chest: 1.3, head: 0.6, hand: 0.12 }).map(([k, m]) => [k, m * MS]));
  const M_TOTAL = MASS.ball + MASS.pelvis + MASS.chest + MASS.head + 2 * MASS.hand;
  const M_UPPER = M_TOTAL - MASS.ball;
  const WEIGHT = M_TOTAL * -GRAV;
  const ARM = 0.34 * K;                               // matches the drawn arm, so hands don't sit past the mitten
  // visible bean volume in the chest frame (height above the feet, half-width; depth = 0.84 x width), so hands and their
  // reach targets stay outside the body even though the hand colliders ignore their own torso
  const BODY_PROF = [[0.16, 0.15], [0.3, 0.25], [0.5, 0.267], [0.77, 0.25], [0.96, 0.2], [1.07, 0.11], [1.1, 0]].map(([y, r]) => [y * K, r * K]);
  const BODY_DEPTH = 0.84, HAND_GAP = 0.085 * K;
  const WALK = 4.5;                                   // top ground speed (m/s)
  const JUMP_V = Math.sqrt(2 * -GRAV * 1.6 * K);      // fixed apex
  const SENS = { head: 2, chest: 1, pelvis: 1, ball: 0.6, handL: 0, handR: 0 };   // knockdown sensitivity per part
  const KO_DV = 4.0;                                  // summed delivered velocity change (2 frames) that knocks you out
  const FALL_KO_V = 13.2;                             // landing speed that knocks you out (a full-storey drop or a throw)
  const clamp = THREE.MathUtils.clamp;
  const IDQ = { x: 0, y: 0, z: 0, w: 1 };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const toV = (o, v = V()) => v.set(o.x, o.y, o.z);
  const toQ = (o, q = new THREE.Quaternion()) => q.set(o.x, o.y, o.z, o.w);
  const _qB = new THREE.Quaternion(), _vB = new THREE.Vector3();
  const rapV = v => ({ x: v.x, y: v.y, z: v.z });
  // quaternion error -> rotation vector (axis * angle), shortest way
  function rotVec(qErr, out) {
    if (qErr.w < 0) qErr.set(-qErr.x, -qErr.y, -qErr.z, -qErr.w);
    const s = Math.sqrt(qErr.x * qErr.x + qErr.y * qErr.y + qErr.z * qErr.z);
    if (s < 1e-6) return out.set(0, 0, 0);
    const ang = 2 * Math.atan2(s, qErr.w);
    return out.set(qErr.x / s * ang, qErr.y / s * ang, qErr.z / s * ang);
  }
  const tiltOf = q => Math.acos(clamp(YAXIS.clone().applyQuaternion(toQ(q)).y, -1, 1));   // angle from upright

  class Bean {
    constructor(i, x, y, z, controller) {
      this.i = i; this.color = COLORS[i % COLORS.length]; this.controller = controller;
      Object.assign(this, makeBlobMesh(i)); scene.add(this.root);
      this.leanG.position.y = -Y.pelvis;
      this.spawn = [x, y, z];
      const bit = 1 << (2 + i);
      this.grp = (bit << 16) | (0xffff & ~bit);        // collide with everything except my own parts
      const mk = (part, dx, dy, r, m, fric, extra) => {
        const rb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x + dx, y + dy, z)
          .setLinearDamping(0.05).setAngularDamping(part === 'ball' ? 0 : 0.6));
        let cd = RAPIER.ColliderDesc.ball(r).setMass(m).setFriction(fric).setRestitution(0.02).setCollisionGroups(this.grp);
        if (extra) cd = extra(cd);
        const col = world.createCollider(cd, rb);
        const p = { rb, col, r, m, I: 0.4 * m * r * r, part, x0: dx, y0: dy, w: part.startsWith('hand') ? 1 : 2, v0: V() };
        partOf.set(col.handle, { bean: this, part, p });
        return p;
      };
      this.ball = mk('ball', 0, Y.ball, R.ball, MASS.ball, 1.2, cd => cd.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max));
      this.pelvis = mk('pelvis', 0, Y.pelvis, R.pelvis, MASS.pelvis, 0.3);
      this.chest = mk('chest', 0, Y.chest, R.chest, MASS.chest, 0.3);
      this.head = mk('head', 0, Y.head, R.head, MASS.head, 0.3);
      // hands[0] = left (+x of the model when it faces +z), hands[1] = right
      this.hands = [1, -1].map(side => Object.assign(mk(side > 0 ? 'handL' : 'handR', side * SHOULDER_X, Y.shoulder - ARM * 0.9, R.hand, MASS.hand, 0.9),
        { side, joint: null, kind: null, other: null, local: null, prop: null, victim: null, objMass: 0, objR: 0, t: V(), sh: V(), handle: null, want: false, ext: 1, grabT: 0, longAxis: undefined }));
      this.parts = [this.ball, this.pelvis, this.chest, this.head, ...this.hands];
      const jt = (a, b, wy) => world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: wy - a.y0, z: 0 }, { x: 0, y: wy - b.y0, z: 0 }), a.rb, b.rb, true);
      jt(this.pelvis, this.chest, Y.waist); jt(this.chest, this.head, Y.neck);
      this.hinges = [[this.pelvis, this.chest, 0.45], [this.chest, this.head, 0.55]];
      this.grabShape = new RAPIER.Ball(R.hand + 0.05 * K);
      this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
      // state
      this.yaw = 0; this.dir = V(0, 0, 1); this.mag = 0; this.pitch = -0.12; this.ko = 0; this.wake = 5; this.invuln = 0; this.kos = 0;
      this.grounded = false; this.coyote = 0; this.airT = 0; this.landT = 1; this.noGround = 0; this.jumpCd = 0; this.jumpBuf = 0; this.prevJump = false;
      this.airMinVy = 0; this.groundBody = null; this.grabT = 0; this.grabBlock = 0; this.mantleCd = 0; this.heldBy = 0;
      this.hitDv = 0; this.prevHitDv = 0; this.jumpFrame = false; this.walkPh = 0; this.sT = 1; this.sL = 1; this.hanging = false;
      this.sq = 0; this.sqV = 0; this.keyA = 0; this.c = { mx: 0, my: 0, aim: 0, jump: false, grab: false };
      this.chip = null;
      if (chipParent) { this.chip = document.createElement('div'); this.chip.className = 'chip'; this.chip.style.background = this.color; chipParent.appendChild(this.chip); }
      this.gv = V(); this.groundRb = null; this.dead = false;
    }
    get face() { return V(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
    pos() { return this.pelvis.rb.translation(); }
    holdingAny() { return this.hands.some(h => h.joint); }
    isHolding(prop) { return this.hands.some(h => h.prop === prop); }
    teleport(x, y, z = 0) {
      this.releaseAll(0);
      const q = new THREE.Quaternion().setFromAxisAngle(YAXIS, this.yaw);
      for (const p of this.parts) {
        const o = V(p.x0, p.y0, 0).applyQuaternion(q);
        p.rb.setTranslation({ x: x + o.x, y: y + o.y, z: z + o.z }, true); p.rb.setRotation(rapV(q).w === undefined ? { x: q.x, y: q.y, z: q.z, w: q.w } : { x: q.x, y: q.y, z: q.z, w: q.w }, true);
        p.rb.setLinvel({ x: 0, y: 0, z: 0 }, true); p.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
    castDown(x, y, z, len) {
      this.ray.origin = { x, y, z }; this.ray.dir = { x: 0, y: -1, z: 0 };
      return world.castRayAndGetNormal(this.ray, len, true, undefined, this.grp);
    }
    cast(o, d, len) { this.ray.origin = rapV(o); this.ray.dir = rapV(d); return world.castRayAndGetNormal(this.ray, len, true, undefined, this.grp); }
    groundCheck() {
      this.grounded = false; this.groundBody = null; this.groundRb = null;
      if (this.noGround > 0) return;
      const bp = this.ball.rb.translation(), o = 0.6 * R.ball;
      for (const [dx, dz2] of [[0, 0], [o, 0], [-o, 0], [0, o], [0, -o]]) {
        const h = this.castDown(bp.x + dx, bp.y, bp.z + dz2, R.ball * 1.4);
        const lim = (dx || dz2 ? 0.8 : 1.0) * R.ball * 1.25 + 0.03 * K;
        if (h && h.toi < lim && (h.toi === 0 || h.normal.y > 0.5)) {
          this.grounded = true; this.groundN = V(h.normal.x, h.normal.y, h.normal.z);
          const pb = h.collider.parent();
          this.groundBody = pb && pb.isDynamic() ? pb : null; this.groundRb = pb || null;
          return;
        }
      }
    }
    onLand() {
      const bp = this.ball.rb.translation();
      if (this.airT > 0.12) {
        puff(bp.x, bp.y - R.ball, bp.z, this.airMinVy < -8 ? 7 : 5, this.airMinVy < -8 ? 0.42 : 0.3);
        this.sqV += Math.min(8, -this.airMinVy * 0.5);
        if (this.airMinVy < -FALL_KO_V && this.ko <= 0) this.knockOut(1.5, 'fall');
        emit('land', this, -this.airMinVy);
      }
      this.airMinVy = 0;
    }
    knockOut(dur, why = 'hit') {
      if (this.ko > 0) { this.ko = Math.max(this.ko, dur * 0.6); return; }
      if (this.invuln > 0) return;
      emit('knockout', this, why, dur);
      this.ko = dur; this.kos++; this.lastKo = why; this.mag = 0;
      this.grabBlock = Math.max(this.grabBlock, dur + 0.5);
      this.releaseAll(0);
      const hp = this.head.rb.translation(); puff(hp.x, hp.y, hp.z, 6, 0.3, '#fff3c4');
    }
    imp(rb, f, dt) { rb.applyImpulse({ x: f.x * dt, y: f.y * dt, z: f.z * dt }, true); }
    impXYZ(rb, x, y, z, dt) { rb.applyImpulse({ x: x * dt, y: y * dt, z: z * dt }, true); }
    // orientation spring toward a target quaternion, applied as an acceleration (mass-independent), reaction on the parent
    spring(part, qT, kp, kd, s, parent, dt) {
      const q = toQ(part.rb.rotation(), _q3), w = toV(part.rb.angvel(), _v1);
      const e = rotVec(_q2.copy(qT).multiply(q.invert()), _v2);
      const tau = e.multiplyScalar(kp).sub(w.multiplyScalar(kd)).multiplyScalar(part.I * s * dt);
      part.rb.applyTorqueImpulse(rapV(tau), true);
      if (parent) parent.rb.applyTorqueImpulse({ x: -tau.x, y: -tau.y, z: -tau.z }, true);
    }
    // max-distance link (a rope) solved as a velocity impulse before the physics step, equal and opposite
    // push a world point out of the visible body (in place); returns the outward normal and depth, or null if outside
    outside(p) {
      const cp = this.chest.rb.translation(), q = toQ(this.chest.rb.rotation(), _qB);
      const l = _vB.set(p.x - cp.x, p.y - cp.y, p.z - cp.z).applyQuaternion(q.invert());   // q now holds the inverse
      const y = l.y + Y.chest; if (y <= BODY_PROF[0][0] || y >= BODY_PROF[BODY_PROF.length - 1][0]) return null;
      let k = 1; while (BODY_PROF[k][0] < y) k++;
      const [y0, r0] = BODY_PROF[k - 1], [y1, r1] = BODY_PROF[k], rx = r0 + (r1 - r0) * (y - y0) / (y1 - y0) + HAND_GAP, rz = rx * BODY_DEPTH;
      const e = Math.hypot(l.x / rx, l.z / rz); if (e >= 1) return null;
      const s = e > 1e-3 ? 1 / e : 1; if (e <= 1e-3) l.x = rx * 0.5;           // dead centre: out to the side
      const depth = Math.hypot(l.x, l.z) * (s - 1);
      l.x *= s; l.z *= s; l.y = y - Y.chest; l.applyQuaternion(q.invert()).add(cp);       // back to world
      const n = V(l.x - p.x, l.y - p.y, l.z - p.z); p.copy(l);
      return depth > 1e-5 ? { n: n.normalize(), depth } : null;
    }
    // hands ignore their own torso in the physics, so a soft contact keeps them on the skin
    keepOut(h, dt) {
      const hp = toV(h.rb.translation()), hit = this.outside(hp); if (!hit) return;
      const { n, depth } = hit, va = this.chest.rb.linvel(), vb = h.rb.linvel();
      const rv = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y + (vb.z - va.z) * n.z;
      const dv = Math.min(4, depth * 0.8 / dt) - rv; if (dv <= 0) return;
      const mb = h.joint ? (h.kind === 'static' ? Infinity : MASS.hand + Math.min(h.objMass, 4 * MS)) : MASS.hand, ma = 2.5 * MS;
      const j = dv / (1 / ma + 1 / mb);
      if (Number.isFinite(mb)) h.rb.applyImpulse({ x: n.x * j, y: n.y * j, z: n.z * j }, true);
      this.chest.rb.applyImpulse({ x: -n.x * j, y: -n.y * j, z: -n.z * j }, true);
    }
    tether(a, aw, b, mb, maxLen, dt) {
      const bp = b.rb.translation(), d = V(bp.x - aw.x, bp.y - aw.y, bp.z - aw.z), len = d.length();
      if (len <= maxLen) return;
      const n = d.divideScalar(len), va = a.rb.linvel(), vb = b.rb.linvel();
      const rv = (vb.x - va.x) * n.x + (vb.y - va.y) * n.y + (vb.z - va.z) * n.z;
      const want = -Math.min(4, (len - maxLen) * 0.35 / dt);
      const dv = want - rv; if (dv >= 0) return;
      const ma = a === this.chest ? 2.5 * MS : a.m;
      const j = dv / (1 / ma + 1 / mb);
      if (Number.isFinite(mb)) b.rb.applyImpulse({ x: n.x * j, y: n.y * j, z: n.z * j }, true);
      a.rb.applyImpulseAtPoint({ x: -n.x * j, y: -n.y * j, z: -n.z * j }, rapV(aw), true);
    }
    launch(vy, vh, k = 1) {     // vh: desired horizontal velocity vector (or null)
      let P = V(), Ws = 0;
      for (const p of this.parts) { const v = p.rb.linvel(); P.x += p.m * v.x; P.y += p.m * v.y; P.z += p.m * v.z; Ws += p.w * p.m; }
      const Jy = Math.max(0, M_TOTAL * vy - P.y) * k;           // subtract the momentum we already have: no stacking
      let Jx = 0, Jz = 0;
      if (vh && vh.lengthSq() > 1e-4) {
        const n = vh.clone().normalize(), want = M_TOTAL * vh.length() - (P.x * n.x + P.z * n.z);
        if (want > 0) { Jx = n.x * want * k; Jz = n.z * want * k; }
      }
      for (const p of this.parts) { const sh = p.w * p.m / Ws; p.rb.applyImpulse({ x: Jx * sh, y: Jy * sh, z: Jz * sh }, true); }
      if (this.groundBody) this.groundBody.applyImpulse({ x: -Jx * 0.5, y: -Jy * 0.5, z: -Jz * 0.5 }, true);
      this.jumpBuf = 0; this.jumpCd = 0.42; this.noGround = 0.2; this.coyote = 0; this.grounded = false; this.jumpFrame = true; this.sqV -= 4;
    }
    step(dt, input) {
      if (this.dead) return;
      const c = input || (this.controller ? this.controller.read(this, dt) : NO_INPUT);
      this.c = c;
      for (const p of this.parts) toV(p.rb.linvel(), p.v0);
      if (this.ko > 0) { this.ko -= dt; if (this.ko <= 0) { this.ko = 0; this.wake = 0; this.invuln = 1.6; } }
      else this.wake += dt;
      this.invuln = Math.max(0, this.invuln - dt); this.grabBlock -= dt; this.jumpCd -= dt; this.noGround -= dt; this.mantleCd -= dt;
      const limp = !!c.limp && this.ko <= 0;              // play dead: muscles off while held, wobbly get-up after
      if (limp && !this.limp) this.releaseAll(0.3);
      if (!limp && this.limp) this.wake = Math.min(this.wake, 0.3);
      this.limp = limp;
      const awake = this.ko <= 0 && !limp;
      // knocked out = limp: every part is a sphere, so a lying body would roll away like a log; roll resistance while limp
      if (!awake !== !!this.limpDamp) { this.limpDamp = !awake; for (const p of this.parts) p.rb.setAngularDamping(!awake ? 5 : (p === this.ball ? 0 : 0.6)); }
      const P = this.pelvis.rb, B = this.ball.rb, C = this.chest.rb, H = this.head.rb;
      const pp = toV(P.translation()), pv = toV(P.linvel()), bp = toV(B.translation()), bv = toV(B.linvel());
      const W = WEIGHT;
      const qP = toQ(P.rotation());
      // --- suspension: the ball slides along the pelvis' up axis on a soft spring, held under it laterally
      {
        const u = V(0, 1, 0).applyQuaternion(qP), rest = Y.pelvis - Y.ball;
        const d = bp.clone().sub(pp), rv = bv.clone().sub(pv);
        const down = -d.dot(u), vDown = -rv.dot(u);
        const lat = d.clone().addScaledVector(u, down), vLat = rv.clone().addScaledVector(u, vDown);
        const soft = (Cm, Cdot, m, hz, zeta) => { const w = 2 * Math.PI * hz, k = m * w * w, cc = 2 * m * zeta * w, g = 1 / (dt * (cc + dt * k));
          return -(Cdot + Cm * dt * k * g) / (1 / m + g) / dt; };
        const mAx = 1 / (1 / MASS.ball + 1 / M_UPPER), mLat = 1 / (1 / MASS.ball + 1 / MASS.pelvis + rest * rest / this.pelvis.I);
        let fa = soft(down - rest, vDown, mAx, 5.5, 0.3);
        if (down > rest + 0.045 * K && vDown > 0) fa = Math.min(fa, -vDown * mAx / dt);          // travel stop
        if (down < rest - 0.09 * K && vDown < 0) fa = Math.max(fa, -vDown * mAx / dt);
        const wl = 2 * Math.PI * 7, kl = mLat * wl * wl, cl = 2 * mLat * 0.8 * wl, gl = 1 / (dt * (cl + dt * kl));
        const fl = vLat.clone().addScaledVector(lat, dt * kl * gl).multiplyScalar(-1 / (1 / mLat + gl) / dt);
        const f = u.clone().multiplyScalar(-fa).add(fl);
        this.imp(B, f, dt);
        P.applyImpulseAtPoint({ x: -f.x * dt, y: -f.y * dt, z: -f.z * dt }, rapV(pp.clone().addScaledVector(u, -rest)), true);
      }
      // --- torso cone limits (stiff torque past the limit)
      for (const [ha, hb, lim] of this.hinges) {
        const qa = toQ(ha.rb.rotation()), qb = toQ(hb.rb.rotation());
        const rel = rotVec(qa.clone().invert().multiply(qb), V()), ang = rel.length(), ex = ang - lim;
        if (ex > 0) {
          const axis = rel.divideScalar(ang).applyQuaternion(qa);
          const wr = toV(hb.rb.angvel()).sub(toV(ha.rb.angvel())).dot(axis), Ie = 1 / (1 / ha.I + 1 / hb.I);
          let tau = -Ie * 900 * ex; if (wr > 0) tau -= Ie * wr * 30;
          hb.rb.applyTorqueImpulse(rapV(axis.clone().multiplyScalar(tau * dt)), true); ha.rb.applyTorqueImpulse(rapV(axis.clone().multiplyScalar(-tau * dt)), true);
        }
      }
      // --- ground / air bookkeeping
      const wasGround = this.grounded;
      this.groundCheck();
      if (!this.grounded) this.airMinVy = Math.min(this.airMinVy, pv.y);
      if (this.grounded) { if (!wasGround) this.onLand(); this.coyote = 0.2; this.airT = 0; this.landT += dt; }
      const gv = this.gv.set(0, 0, 0);
      if (this.grounded && groundVel && this.groundRb && this.groundRb.isKinematic()) groundVel(this.groundRb, _vP.set(bp.x, bp.y - R.ball, bp.z), gv);
      else { this.coyote -= dt; this.airT += dt; this.landT = 0; }
      // --- input: camera-relative move (camera looks down -z), quick jump-start, short ramp, instant zero on reversal
      let ix = awake ? clamp(c.mx || 0, -1, 1) : 0, iz = awake ? -clamp(c.my || 0, -1, 1) : 0;
      let im = Math.hypot(ix, iz); if (im > 1) { ix /= im; iz /= im; im = 1; }
      if (im < 0.05) this.mag = 0;
      else {
        const nd = V(ix / im, 0, iz / im);
        if (this.mag > 0 && nd.dot(this.dir) < -0.3) this.mag = 0;
        this.dir.copy(nd);
        this.mag = Math.min(im, Math.max(0.25, this.mag + dt * 2.6));
        // turn to face the way we walk (no rotational momentum: the torso is simply torqued toward this yaw)
        const ty = Math.atan2(nd.x, nd.z), dy = Math.atan2(Math.sin(ty - this.yaw), Math.cos(ty - this.yaw));
        this.yaw += clamp(dy, -7.5 * dt, 7.5 * dt);
      }
      const f = this.face, right = V(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(-1);   // model's right (-x when facing +z)
      if (this.grounded) this.walkPh += dt * Math.PI * 2 * (1.2 + 1.6 * Math.hypot(bv.x, bv.z) / WALK);
      // --- aim pitch (rate limited so the posture leans smoothly)
      const aimIn = awake ? clamp(c.aim || 0, -1, 1) : 0;
      const pT = aimIn > 0 ? aimIn * 1.35 : aimIn < 0 ? aimIn * 1.0 : -0.12;
      this.pitch += clamp(pT - this.pitch, -4.5 * dt, 4.5 * dt);
      const aim = f.clone().multiplyScalar(Math.cos(this.pitch)).add(V(0, Math.sin(this.pitch), 0));
      this.aimDir = aim;
      const carrying = this.hands.some(h => h.joint && h.kind !== 'static');
      // --- muscle strength by state
      const holding = this.holdingAny();
      const hanging = !this.grounded && this.hands.some(h => h.joint && h.kind === 'static');
      let sT = 0, sL = 0;
      if (awake) {
        sT = Math.min(1, this.wake / 1.0); sL = Math.min(1, this.wake / 2.2);
        if (this.wake < 1.5) sT = Math.max(sT, 0.35);          // get-up: enough to roll upright, still wobbly
        if (this.grounded) sL *= Math.min(1, 0.8 + 0.2 * this.landT);
        if (!this.grounded && !holding && !this.heldBy) { if (this.airT > 3) { sT = 0; sL = 0; } else if (this.airT > 1) { sT *= 0.5; sL *= 0.3; } }
      }
      const tiltP = tiltOf(P.rotation());
      if (awake && this.grounded && tiltP > 1.0) { this.fallenT = (this.fallenT || 0) + dt; if (this.fallenT > 0.7 && this.wake > 2) { this.wake = 0.3; this.fallenT = 0; } }
      else this.fallenT = 0;
      this.sT = sT; this.sL = sL; this.hanging = hanging; if (hanging) this.hangT = (this.hangT || 0) + dt; this.hangCont = hanging ? (this.hangCont || 0) + dt : 0;
      // --- 1. lift budget: ~80% of the upper body's weight, reaction pushed down through the ball
      if (sL > 0) {
        const up = carrying ? 0 : clamp(this.pitch, 0, 1.35) / 1.35 * 0.5 * (holding && this.grounded ? 1.4 : 1);
        const lift = 0.8 * M_UPPER * -GRAV * sL;
        const fh = lift * 0.2 * (1 - up), fc = lift * 0.6 * (1 - up * 0.5), fp = lift - fh - fc;
        this.impXYZ(H, 0, fh, 0, dt); this.impXYZ(C, 0, fc, 0, dt); this.impXYZ(P, 0, fp, 0, dt); this.impXYZ(B, 0, -lift, 0, dt);
      }
      // --- 2. horizontal centring over the ball (predictive, soft) + 3. orientation springs
      if (sT > 0) {
        const cg = carrying ? 1.6 : 1;
        const ex = (bp.x + bv.x * dt) - (pp.x + pv.x * dt), ez = (bp.z + bv.z * dt) - (pp.z + pv.z * dt);
        const fx = MASS.pelvis * (240 * cg * ex + 20 * cg * (bv.x - pv.x)) * sT, fz = MASS.pelvis * (240 * cg * ez + 20 * cg * (bv.z - pv.z)) * sT;
        this.impXYZ(P, fx, 0, fz, dt); this.impXYZ(B, -fx, 0, -fz, dt);
        const hp = H.translation(), hv = H.linvel();
        const hx = MASS.head * (40 * ((bp.x + bv.x * dt) - (hp.x + hv.x * dt)) + 4 * (bv.x - hv.x)) * sT;
        const hz = MASS.head * (40 * ((bp.z + bv.z * dt) - (hp.z + hv.z * dt)) + 4 * (bv.z - hv.z)) * sT;
        this.impXYZ(H, hx, 0, hz, dt); this.impXYZ(B, -hx, 0, -hz, dt);
        if (this.wake < 2 && tiltP > 0.5 && this.grounded) { this.impXYZ(C, 0, M_UPPER * -GRAV * 0.6, 0, dt); this.impXYZ(B, 0, -M_UPPER * -GRAV * 0.6, 0, dt); }
        const walkF = this.mag * (this.grounded ? 1 : 0.3);
        const breathe = this.mag === 0 && this.grounded ? 0.05 * Math.sin(simTime * 2.1 + this.i * 1.3) : 0;
        const upA = carrying ? Math.min(this.pitch, 0) : this.pitch;
        const qYaw = _qz.setFromAxisAngle(YAXIS, this.yaw).clone();
        const qLean = a => qYaw.clone().multiply(new THREE.Quaternion().setFromAxisAngle(XAXIS, a));   // +a leans forward
        this.spring(this.pelvis, qLean(-0.05 * upA + 0.06 * walkF), this.wake < 2 ? 140 : 70, 16, sT, null, dt);
        this.spring(this.chest, qLean(-0.22 * upA + 0.15 * walkF + breathe), 170, 15, sT, this.pelvis, dt);
        this.spring(this.head, qLean(-0.32 * upA + 0.05 * walkF + breathe * 0.5), 150, 12, sT, this.chest, dt);
      }
      // --- 4. locomotion: the ball is a wheel whose spin is set directly, plus a push (reaction on the ground)
      // brake = the wheel stops turning: lock its rotation (a spin of zero set before the step would still roll during the solve)
      const brake = awake && this.grounded && !hanging && this.mag === 0;
      if (brake !== this.braked) { B.setEnabledRotations(!brake, !brake, !brake, true); this.braked = brake; }
      if (brake) {    // planted feet: kill the ball's slide and cancel gravity's pull along a slope, so stairs hold
        const F = V(gv.x - bv.x, Math.min(0, gv.y - bv.y), gv.z - bv.z).multiplyScalar(MASS.ball * 0.5 / dt);
        const cap = 0.8 * W; if (F.length() > cap) F.setLength(cap);
        this.imp(B, F, dt);
        if (this.groundN && this.groundN.y < 0.97) {
          const n = this.groundN, gt = V(0, GRAV, 0).addScaledVector(n, -GRAV * n.y);   // tangential gravity per unit mass
          this.imp(B, gt.multiplyScalar(-M_TOTAL), dt);      // the foot grips: the whole body's slope pull is held at the ball
        }
      }
      if (awake && this.grounded && !hanging) {
        if (this.mag > 0) {
          const vT = this.dir.clone().multiplyScalar(this.mag * WALK);
          const wall = this.cast(V(bp.x, bp.y + R.ball * 0.15, bp.z), this.dir, R.ball + 0.06 * K);
          const blocked = wall && Math.abs(wall.normal.y) < 0.6;              // a wheel spinning against a wall would climb it
          const slip = V(vT.x + gv.x - bv.x, 0, vT.z + gv.z - bv.z); if (slip.length() > 2.5) slip.setLength(2.5);
          const wheel = V(bv.x - gv.x + slip.x, 0, bv.z - gv.z + slip.z);   // wheel spin relative to the floor
          const w = blocked ? V() : YAXIS.clone().cross(wheel).divideScalar(R.ball);
          B.setAngvel(rapV(w), true);
          const along = (bv.x - gv.x) * this.dir.x + (bv.z - gv.z) * this.dir.z;
          if (!blocked && along < this.mag * WALK) {
            const F = this.dir.clone().multiplyScalar(0.5 * W * this.mag);
            this.imp(B, F, dt);
            if (this.groundBody) this.groundBody.applyImpulse({ x: -F.x * dt, y: 0, z: -F.z * dt }, true);
          }
          this.stepUp(dt, bp, bv);
        }
      }
      // --- 5. jump: coyote time, cooldown, momentum-aware impulse
      const jp = !!c.jump && !this.prevJump; this.prevJump = !!c.jump;
      if (jp) this.jumpBuf = 0.12; else this.jumpBuf -= dt;
      if (awake && this.jumpBuf > 0 && this.jumpCd <= 0) {
        if (hanging) { this.releaseAll(0.35); this.launch(JUMP_V * 0.8, (this.mag ? this.dir : f).clone().multiplyScalar(WALK * 0.5)); emit('jump', this); }
        else if (this.grounded || this.coyote > 0) { this.launch(JUMP_V, this.dir.clone().multiplyScalar(this.mag * WALK), holding ? 0.75 : 1); emit('jump', this); }
      }
      // --- 6. air control / swinging while hanging
      if (awake && !this.grounded && !hanging && this.mag > 0 && this.airT < 3) {
        const F = V((this.dir.x * this.mag * WALK - pv.x) * M_TOTAL * 5, 0, (this.dir.z * this.mag * WALK - pv.z) * M_TOTAL * 5);
        if (F.length() > 0.8 * W) F.setLength(0.8 * W);
        this.imp(C, F.clone().multiplyScalar(0.6), dt); this.imp(P, F.multiplyScalar(0.4), dt);
      }
      if (awake && hanging && this.mag) this.imp(P, this.dir.clone().multiplyScalar(0.45 * W * this.mag), dt);
      // --- 7. arms: reach, grip, carry, climb
      this.arms(dt, c, awake, aim, f, right);
      for (const h of this.hands) {
        const mb = h.joint ? (h.kind === 'static' ? Infinity : MASS.hand + Math.min(h.objMass, 4 * MS)) : MASS.hand;
        this.tether(this.chest, h.sh, h, mb, ARM, dt);
        this.keepOut(h, dt);
      }
      if (this.mantle) {
        const m = this.mantle; m.t -= dt;
        if (m.t <= 0 || this.ko > 0) this.mantle = null;
        else if (bp.y - R.ball > m.y - 0.05 * K) {
          for (const p of this.parts) { const v = p.rb.linvel(), along = v.x * m.dir.x + v.z * m.dir.z; if (along < 3) p.rb.applyImpulse({ x: m.dir.x * p.m * (3 - along) * 0.5, y: 0, z: m.dir.z * p.m * (3 - along) * 0.5 }, true); }
          if (this.grounded && m.t < 0.6) this.mantle = null;
        }
      }
      // --- 8. ledge mantle: hanging, looking up, pulled high enough -> kick up and over
      if (awake && this.hanging && this.hangCont > 0.35 && this.pitch > 0.8 && this.mantleCd <= 0) {
        const hs = this.hands.filter(h => h.joint && h.kind === 'static');
        if (hs.length) {
          const hc = V(); let hy = -1e9; for (const h of hs) { const t = h.rb.translation(); hc.x += t.x / hs.length; hc.z += t.z / hs.length; hy = Math.max(hy, t.y); }
          const p2 = P.translation();
          if (p2.y > hy - 0.62 * K) {
            const into = hs.find(h => h.intoLedge);
          const side = into ? into.intoLedge.clone() : V(hc.x - p2.x, 0, hc.z - p2.z); if (side.lengthSq() < 1e-4) side.copy(f); side.normalize();
            const rise = Math.max(0.2, hy + Y.pelvis + 0.25 * K - p2.y);
            this.releaseAll(0.9);
            this.launch(Math.sqrt(2 * -GRAV * (rise + 0.15 * K)), side.clone().multiplyScalar(0.5));
            this.mantle = { dir: side, y: hy, t: 0.8 };      // phase 2: once the feet clear the lip, scoot over it
            this.mantleCd = 1.0; this.mantles = (this.mantles || 0) + 1; emit('mantle', this);
          }
        }
      }
      // --- 9. ledge scramble: both hands on the lip and walking into it -> the feet kick up the wall
      if (awake && this.hanging && this.mag > 0.3 && this.mantleCd <= 0) {
        const hs = this.hands.filter(h => h.joint && h.kind === 'static');
        if (hs.length === 2) {
          let hx = 0, hz = 0, hy = -1e9; for (const h of hs) { const t = h.rb.translation(); hx += t.x / 2; hz += t.z / 2; hy = Math.max(hy, t.y); }
          const into = (hs[0].intoLedge || hs[1].intoLedge || V(hx - bp.x, 0, hz - bp.z)).clone().setY(0);
          if (into.lengthSq() > 1e-6 && this.dir.dot(into.normalize()) > 0.3 && bp.y < hy) {
            const ahead = clamp(((hx - bp.x) * into.x + (hz - bp.z) * into.z) / (0.3 * K), 0, 1), F = 0.9 * W * this.mag * ahead;
            this.impXYZ(B, 0, F * 0.6, 0, dt); this.impXYZ(P, 0, F * 0.4, 0, dt);
          }
        }
      }
    }
    stepUp(dt, bp, bv) {
      // walkable ground slightly ahead and up, with a near-vertical face just ahead: convert the blocked push into a hop
      if (Math.hypot(bv.x, bv.z) > WALK * 0.5 || this.jumpCd > 0.2) return;
      const face = this.cast(V(bp.x, bp.y - R.ball * 0.6, bp.z), this.dir, R.ball + 0.1 * K);
      if (!face || Math.abs(face.normal.y) > 0.5) return;
      const ahead = bp.clone().addScaledVector(this.dir, R.ball + 0.12 * K);
      const top = this.castDown(ahead.x, bp.y + 0.3 * K, ahead.z, 0.6 * K);
      if (!top || top.normal.y < 0.7) return;
      const h = (bp.y + 0.3 * K - top.toi) - (bp.y - R.ball);
      if (h < 0.03 * K || h > 0.3 * K) return;
      const vy = Math.sqrt(2 * -GRAV * (h + 0.06 * K));
      for (const p of [this.ball, this.pelvis]) { const v = p.rb.linvel(); if (v.y < vy) p.rb.applyImpulse({ x: this.dir.x * p.m * 0.6, y: p.m * (vy - v.y), z: this.dir.z * p.m * 0.6 }, true); }
      this.jumpCd = Math.max(this.jumpCd, 0.25); this.steps = (this.steps || 0) + 1;
    }
    arms(dt, c, awake, aim, f, right) {
      const W = WEIGHT, P = this.pelvis.rb, C = this.chest.rb, B = this.ball.rb;
      const cp = toV(C.translation()), qC = toQ(C.rotation());
      const ref = toV(B.linvel());
      // per hand: grab = both, grabL / grabR = one trigger each, analog (a light press reaches about half way)
      const blocked = !awake || this.grabBlock > 0;
      for (const h of this.hands) {
        const g = c.grab ? 1 : (h.side > 0 ? c.grabL : c.grabR) || 0;
        h.want = !blocked && g > 0.08; h.ext = c.grab ? 1 : 0.55 + 0.45 * Math.min(1, g);
        if (h.want) h.grabT += dt; else { h.grabT = 0; if (h.joint) this.release(h, true); }
      }
      const nStatic = this.hands.filter(h => h.joint && h.kind === 'static').length;
      const cpitch = Math.min(this.pitch, 0.95), carryDir = f.clone().multiplyScalar(Math.cos(cpitch)).add(V(0, Math.sin(cpitch), 0));
      for (const h of this.hands) {
        const sh = h.sh.copy(V(h.side * SHOULDER_X, Y.shoulder - Y.chest, 0).applyQuaternion(qC).add(cp));
        if (!awake) continue;                              // limp
        const hp = toV(h.rb.translation()), hv = toV(h.rb.linvel());
        let tgt, aMax = 70, mEff = MASS.hand, split = false, antiG = true, onHand = true, vCap = Infinity;
        h.handle = null;
        if (h.joint && h.other !== anchorBody && !world.getRigidBody(h.other.handle)) { this.forget(h); continue; }
        if (h.joint) {
          // grip break: arm stretched too far, or the anchor tore away under load
          const o = h.other, wp = toV(h.local).applyQuaternion(toQ(o.rotation())).add(toV(o.translation()));
          if (hp.distanceTo(sh) > ARM * 1.7 || wp.distanceTo(hp) > 0.22 * K) { this.release(h, false); this.gripBreaks = (this.gripBreaks || 0) + 1; continue; }
          if (h.kind === 'static') {
            if (this.grounded && hp.y < sh.y - 0.1 * K && this.pos().y > hp.y) { this.release(h, false); this.grabBlock = 0.3; continue; }
            const climb = clamp((this.pitch - 0.75) / 0.5, 0, 1);
            mEff = M_TOTAL; onHand = false; antiG = false; split = true;
            aMax = 0.42 * W * (1.5 + 1.5 * climb) * (this.heldBy ? 1.7 : 1) / mEff;     // someone holding us helps us up
            vCap = 1.15 * W / Math.max(1, nStatic);
            if (this.grounded) tgt = sh.clone().addScaledVector(aim, ARM * 0.9);
            else if (climb > 0) tgt = sh.clone().add(V(0, ARM * 0.25, 0)).addScaledVector(h.intoLedge || f, 0.34 * K);   // pull up, staying on the open side of the wall
            else { tgt = hp.clone(); aMax = 0.12 * W / mEff; }          // just hang and swing
            if (!this.grounded && h.intoLedge) {      // keep the body out from under the lip (head would catch on it)
              const pp2 = this.pelvis.rb.translation(), gap = (hp.x - pp2.x) * h.intoLedge.x + (hp.z - pp2.z) * h.intoLedge.z;
              if (gap < 0.32 * K) this.imp(P, h.intoLedge.clone().multiplyScalar(-0.35 * W * (0.32 * K - gap) / (0.32 * K) / Math.max(1, nStatic)), dt);
            }
          } else {
            mEff = MASS.hand + 0.5 * h.objMass; aMax = Math.min(140, 0.22 * W / mEff); split = true;
            tgt = sh.clone().addScaledVector(carryDir, ARM * 0.95);
            this.carry(h, sh, carryDir, dt);
          }
        } else if (h.want) {
          tgt = sh.clone().addScaledVector(aim, ARM * h.ext).addScaledVector(right, -h.side * 0.06 * K);     // a little out to this hand's side
          aMax = 140;
          // grab magnetism: ledge handles near the aim line pull the reach target onto them
          for (const Lg of LEDGES) {
            // closest point on the segment to the reach target (segments may run in any direction)
            const ex = Lg.bx - Lg.ax, ey = Lg.by - Lg.ay, ez = Lg.bz - Lg.az, ll = ex * ex + ey * ey + ez * ez;
            const s = ll > 1e-9 ? clamp(((tgt.x - Lg.ax) * ex + (tgt.y - Lg.ay) * ey + (tgt.z - Lg.az) * ez) / ll, 0, 1) : 0;
            const hpnt = V(Lg.ax + ex * s, Lg.ay + ey * s, Lg.az + ez * s), dv = hpnt.clone().sub(sh), d = dv.length();
            const ahead = dv.x * f.x + dv.z * f.z;      // ledge in front of us (reaching up next to a ledge catches it)
            if (d < ARM + 0.55 * K && d > 0.05 && (dv.dot(aim) / d > 0.7 || (this.pitch > 0.8 && !this.grounded && ahead > -0.05 && dv.y > -0.6 * K))) {
              let nx = -ez, nz = ex; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;           // horizontal normal, from our side into the ledge
              if (dv.x * nx + dv.z * nz < 0) { nx = -nx; nz = -nz; }
              tgt = hpnt.add(V(-nx * 0.03 * K, R.hand * 0.2, -nz * 0.03 * K)); h.handle = [tgt.x, tgt.y, tgt.z, nx, nz, Lg.body]; break;
            }
          }
          if (!h.handle) { const m = this.magnet(h, hp, tgt, aim); if (m) tgt = m; }
        } else {
          let dir, reach = ARM * 0.9;
          if (!this.grounded && this.airT > 0.08 && !this.hanging) {            // flail
            const a = 1.0 * Math.sin(simTime * 13 + h.side * 1.9);
            dir = V(0, Math.cos(a), 0).addScaledVector(f, Math.sin(a) * 0.8).addScaledVector(right, -h.side * 0.5).normalize();
            aMax = this.airT > 3 ? 20 : 90; reach = ARM * 0.85;
          } else if (this.mag > 0.05) {                                          // counter-swing while walking
            const a = 0.8 * Math.sin(this.walkPh + (h.side > 0 ? 0 : Math.PI)) * this.mag + 0.15;
            dir = V(0, -Math.cos(a), 0).addScaledVector(f, Math.sin(a)).addScaledVector(right, -h.side * 0.25).normalize(); aMax = 70;
          } else {                                                              // loose zombie-down
            dir = V(0, -0.88, 0).addScaledVector(f, 0.42).addScaledVector(right, -h.side * 0.22).normalize(); aMax = 45; reach = ARM * 0.85;
          }
          tgt = sh.clone().addScaledVector(dir, reach);
        }
        if (!(h.joint && h.kind === 'static')) this.outside(tgt);      // never aim a hand into our own body
        h.t.copy(tgt);
        // time-optimal constant-acceleration drive, relative to the ball: arrives and stops, no ringing
        const d = tgt.clone().sub(hp), dist = d.length();
        const rv = hv.clone().sub(ref);
        const vd = dist > 1e-4 ? d.clone().multiplyScalar(Math.sqrt(2 * aMax * dist) * Math.min(1, dist / (0.06 * K)) / dist) : V();
        const acc = vd.sub(rv).divideScalar(dt); if (acc.length() > aMax) acc.setLength(aMax);
        const F = acc.multiplyScalar(mEff); F.y = clamp(F.y, -vCap, vCap);
        const g = antiG ? MASS.hand * -GRAV : 0;
        if (onHand) this.impXYZ(h.rb, F.x, F.y + g, F.z, dt);
        const r = V(-F.x, -F.y - g, -F.z);
        if (!split) this.imp(P, r, dt);
        else { const k = hp.y > sh.y ? 0.8 : 0.4; this.imp(C, r.clone().multiplyScalar(k), dt); this.imp(B, r.multiplyScalar(1 - k), dt); }
        // touch -> latch
        // arming delay: longer after a big change of aim since the last grip, so re-grabs can't be spammed
        const arm = 0.1 + 0.15 * clamp(Math.abs(this.pitch - (this.lastGrabPitch ?? this.pitch)) / 1.2, 0, 1);
        if (h.want && !h.joint && h.grabT > arm && tgt.distanceTo(hp) < 0.5 * K) this.tryAttach(h);
      }
    }
    carry(h, sh, dir, dt) {
      const W = WEIGHT, m = h.objMass;
      const tb = h.kind === 'bean' ? h.victim.pelvis.rb : h.other;
      const op = toV(tb.translation()), ov = toV(tb.linvel()), bv = toV(this.chest.rb.linvel()), hp = toV(h.rb.translation());
      const t = sh.clone().addScaledVector(dir, ARM + h.objR);
      const sc = clamp(m / M_TOTAL, 0.5, 1), fall = clamp(1.3 - op.distanceTo(hp) / (0.8 * K), 0.3, 1);
      const F = t.sub(op).multiplyScalar(36).add(bv.sub(ov).multiplyScalar(8)).multiplyScalar(m); F.y += m * -GRAV;
      const pull = h.kind === 'bean' && this.pitch > 0.75 ? 1.7 : 1;            // looking up while holding someone hauls them up
      const hc = 0.4 * W * sc * fall * 2.2 * pull, hl = Math.hypot(F.x, F.z); if (hl > hc) { F.x *= hc / hl; F.z *= hc / hl; }
      F.y = clamp(F.y, -0.5 * W * sc, 1.0 * W * sc * fall * pull);
      if (h.kind === 'bean') { for (const p of h.victim.parts) this.imp(p.rb, F.clone().multiplyScalar(p.m / M_TOTAL), dt); }
      else { this.imp(tb, F, dt); if (!this.aimLong(h, tb, hp, dt)) { const w = tb.angvel(); tb.setAngvel({ x: w.x * 0.9, y: w.y * 0.9, z: w.z * 0.9 }, true); } }
      this.imp(h.rb, F.clone().multiplyScalar(-0.5), dt); this.imp(this.chest.rb, F.multiplyScalar(-0.5), dt);
    }
    // long things (poles, ladles, oars) point along the aim from the gripping hand, so turning swings them like a bat
    aimLong(h, tb, hp, dt) {
      if (h.longAxis === undefined) {
        h.longAxis = null;
        const I = tb.principalInertia(), m = tb.mass(), a = [I.x, I.y, I.z], lo = a.indexOf(Math.min(...a)), hi = Math.max(...a);
        if (m > 0 && hi > 3 * a[lo] && Math.sqrt(12 * hi / m) > 0.6 * K) {
          const ax = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)][lo].applyQuaternion(toQ(tb.principalInertiaLocalFrame()));
          const w = ax.clone().applyQuaternion(toQ(tb.rotation())), c = toV(tb.translation()).sub(hp);
          h.longAxis = w.dot(c) < 0 ? ax.negate() : ax;      // body-local, signed so the end beyond the hand leads
        }
      }
      if (!h.longAxis) return false;
      const ax = h.longAxis.clone().applyQuaternion(toQ(tb.rotation())), goal = this.aimDir;
      const e = ax.clone().cross(goal), s = e.length(), ang = Math.atan2(s, ax.dot(goal));
      const w = toV(tb.angvel()), want = s > 1e-4 ? e.multiplyScalar(Math.min(12, ang * 9) / s) : V();
      want.addScaledVector(ax, w.dot(ax) * 0.5);                   // spin about the long axis just dies down
      w.lerp(want, Math.min(1, dt * 14)); tb.setAngvel(rapV(w), true);
      return true;
    }
    // grab magnetism: probe points along the reach with growing radii and snap the target onto the nearest grabbable
    // surface close to the aim line (props, other players; static edges only at or above the shoulder while reaching up)
    magnet(h, hp, tgt, aim) {
      const d = tgt.clone().sub(hp); if (d.lengthSq() < 1e-6) return null;
      const staticOk = !this.grounded || this.pitch > 0.5;
      const pred = col => {
        const pi = partOf.get(col.handle); if (pi) return pi.bean !== this;
        const pb = col.parent(); if (pb && pb.userData && pb.userData.grabbable) return true;
        return staticOk && (!pb || pb.isFixed() || pb.isKinematic());
      };
      let best = null, bestScore = Infinity;
      for (const t of [0.35, 0.7, 1]) {
        const s = hp.clone().addScaledVector(d, t), r = R.hand + (0.06 + 0.12 * t) * K;
        const pr = world.projectPoint(rapV(s), true, undefined, this.grp, undefined, undefined, pred); if (!pr) continue;
        const q = toV(pr.point), dist = pr.isInside ? 0 : q.distanceTo(s); if (dist > r) continue;
        const pb = pr.collider.parent();
        if ((!pb || pb.isFixed() || pb.isKinematic()) && !partOf.get(pr.collider.handle) && !(pb && pb.userData && pb.userData.grabbable) && q.y < h.sh.y - 0.1 * K) continue;
        const rel = q.clone().sub(h.sh), off = rel.clone().addScaledVector(aim, -rel.dot(aim)).length();
        const score = off + 0.3 * dist; if (score < bestScore) { bestScore = score; best = { q, s, inside: pr.isInside }; }
      }
      if (!best) return null;
      const n = (best.inside ? hp.clone() : best.s).sub(best.q); if (n.lengthSq() < 1e-8) return best.q;
      return best.q.addScaledVector(n.normalize(), R.hand * 0.7);
    }
    tryAttach(h) {
      let hp = h.rb.translation();
      let found = null;
      // designer ledge handles snap strongly: within reach of the edge, the hand is placed on the lip and latches
      if (h.handle && !this.grounded && Math.hypot(hp.x - h.handle[0], hp.y - h.handle[1], hp.z - h.handle[2]) < 0.4 * K) {
        const lip = { x: h.handle[0] - h.handle[3] * R.hand * 0.6, y: h.handle[1] + R.hand * 0.6, z: h.handle[2] - h.handle[4] * R.hand * 0.6 };
        h.rb.setTranslation(lip, true); h.rb.setLinvel(this.chest.rb.linvel(), true); hp = lip;
        h.intoLedge = V(h.handle[3], 0, h.handle[4]);                 // from the open side toward the ledge
        found = { kind: 'static', body: h.handle[5] || null };
      }
      if (!found)
      world.intersectionsWithShape(hp, IDQ, this.grabShape, col => {
        const pi = partOf.get(col.handle);
        if (pi) { if (pi.bean === this) return true; found = { col, kind: 'bean', bean: pi.bean }; return false; }
        const pb = col.parent();
        if (pb && pb.userData && pb.userData.grabbable) { found = { col, kind: 'prop', prop: pb.userData }; return false; }
        if (!pb || pb.isFixed() || pb.isKinematic()) {      // kinematic = moving scenery (a ship's deck): grip it, not the world
          // static world: only when reaching for it (airborne, aiming up above the shoulder, or at a ledge) so walls don't get sticky
          const near = h.handle && Math.hypot(hp.x - h.handle[0], hp.y - h.handle[1], hp.z - h.handle[2]) < R.hand + 0.2 * K;
          if (near || !this.grounded || (this.pitch > 0.5 && hp.y > h.sh.y + 0.05)) { found = { col, kind: 'static', body: pb && pb.isKinematic() ? pb : null }; return false; }
        }
        return true;
      }, undefined, this.grp);
      if (!found) return;
      const other = found.kind === 'static' ? (found.body || anchorBody) : found.col.parent();
      if (found.kind === 'static' && !this.grounded && !h.handle) {       // hand-over-hand: no ladder-spamming a flat wall
        const o = this.hands.find(x => x !== h && x.joint && x.kind === 'static' && x.other === other);
        if (o && hp.y > o.rb.translation().y + 0.15 * K) return;
      }
      this.lastGrabPitch = this.pitch; h.longAxis = undefined;
      const op = toV(other.translation()), oq = toQ(other.rotation());
      const lp = toV(hp).sub(op).applyQuaternion(oq.invert());
      h.joint = world.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: 0, z: 0 }, rapV(lp)), h.rb, other, true);
      h.kind = found.kind; h.other = other; h.local = { x: lp.x, y: lp.y, z: lp.z };
      h.prop = found.prop || null; h.victim = found.bean || null;
      if (h.kind === 'prop') { h.objMass = other.mass(); h.objR = clamp(toV(hp).distanceTo(op), 0.1, 0.6); h.prop.holders = (h.prop.holders || 0) + 1; }
      else if (h.kind === 'bean') { h.objMass = M_TOTAL; h.objR = 0.35 * K; h.victim.heldBy++; }
      else { h.objMass = Infinity; h.objR = 0; }
      this.grabs = (this.grabs || 0) + 1; emit('grab', this, h.kind, h.victim || h.other);
    }
    release(h, throwIt) {
      if (!h.joint) return;
      try { world.removeImpulseJoint(h.joint, true); } catch (e) { /* body already gone */ }
      const f = this.face, pv = this.pelvis.rb.linvel();
      const ta = clamp(this.pitch, 0.35, 0.8);
      if (h.kind === 'prop') {
        h.prop.holders = Math.max(0, (h.prop.holders || 1) - 1);
        // release while aiming up = toss along the aim, keeping our momentum (two-handed grips throw once, on the last hand)
        if (throwIt && this.pitch > 0.1 && !this.hands.some(x => x !== h && x.joint && x.other === h.other)) {
          const m = h.other.mass(), v = h.other.linvel();
          const tv = V(f.x * Math.cos(ta) * 7 + pv.x * 0.6, Math.sin(ta) * 6 + 1, f.z * Math.cos(ta) * 7 + pv.z * 0.6);
          h.other.applyImpulse({ x: m * (tv.x - v.x * 0.3), y: m * Math.max(0, tv.y - v.y), z: m * (tv.z - v.z * 0.3) }, true);
          markDangerous(h.other, 1.2); this.throws = (this.throws || 0) + 1; emit('throw', this, h.other);
        }
      } else if (h.kind === 'bean') {
        const vb = h.victim; vb.heldBy--;
        if (throwIt && this.pitch > 0.1 && !vb.hands.some(x => x.joint) && vb.ko <= 0 && !this.hands.some(x => x !== h && x.joint && x.victim === vb)) {
          for (const p of vb.parts) p.rb.applyImpulse({ x: p.m * (f.x * Math.cos(ta) * 5.5 + pv.x * 0.5), y: p.m * (Math.sin(ta) * 5 + 1.5), z: p.m * (f.z * Math.cos(ta) * 5.5 + pv.z * 0.5) }, true);
          vb.knockOut(1.8, 'thrown'); this.throws = (this.throws || 0) + 1; emit('throw', this, vb);
        }
      }
      h.joint = null; h.kind = null; h.other = null; h.prop = null; h.victim = null; h.objMass = 0; h.intoLedge = null;
    }
    forget(h) {      // the gripped body is gone (Rapier already dropped the joint)
      if (h.kind === 'prop' && h.prop) h.prop.holders = Math.max(0, (h.prop.holders || 1) - 1);
      if (h.kind === 'bean' && h.victim) h.victim.heldBy--;
      h.joint = null; h.kind = null; h.other = null; h.prop = null; h.victim = null; h.objMass = 0; h.intoLedge = null;
    }
    /** Remove this player from the world for good: drop grips (both ways), bodies, colliders, mesh. */
    kill() {
      if (this.dead) return;
      this.releaseAll(0);
      for (const o of players) if (o !== this && !o.dead) for (const h of o.hands) if (h.joint && h.victim === this) o.release(h, false);
      for (const p of this.parts) { partOf.delete(p.col.handle); try { world.removeRigidBody(p.rb); } catch (e) { /* world freed */ } }
      this.dead = true; this.ko = 0; this.root.visible = false; scene.remove(this.root);
      if (this.chip) this.chip.remove();
    }
    releaseAll(block = 0, throwIt = false) {
      for (const h of this.hands) this.release(h, throwIt);
      if (block) this.grabBlock = Math.max(this.grabBlock, block);
    }
    postStep(dt) {
      if (this.dead) return;
      // global safety limiter: clamp per-step velocity gains (not losses), cap spin and speed
      const lim = 900 * dt;
      for (const p of this.parts) {
        const v = toV(p.rb.linvel()), dv = v.clone().sub(p.v0), dl = dv.length();
        if (!this.jumpFrame && dl > lim && v.lengthSq() > p.v0.lengthSq()) { v.copy(p.v0).addScaledVector(dv, lim / dl); p.rb.setLinvel(rapV(v), true); }
        if (v.length() > 28) { v.setLength(28); p.rb.setLinvel(rapV(v), true); }
        if (p !== this.ball) { const w = toV(p.rb.angvel()); if (w.length() > 11) p.rb.setAngvel(rapV(w.setLength(11)), true); }
      }
      this.jumpFrame = false;
      // re-seat the ball / hands if a link ever tears apart (should not happen; cheap insurance)
      const pp = toV(this.pelvis.rb.translation()), bp = toV(this.ball.rb.translation());
      if (pp.distanceTo(bp) > 0.6 * K) {
        const u = V(0, 1, 0).applyQuaternion(toQ(this.pelvis.rb.rotation()));
        this.ball.rb.setTranslation(rapV(pp.clone().addScaledVector(u, -(Y.pelvis - Y.ball))), true); this.ball.rb.setLinvel(this.pelvis.rb.linvel(), true);
      }
      for (const h of this.hands) { const hp = toV(h.rb.translation()); if (h.sh.lengthSq() && hp.distanceTo(h.sh) > ARM * 2.5) { this.release(h, false); h.rb.setTranslation(rapV(h.sh.clone().add(V(0, -ARM * 0.8, 0))), true); h.rb.setLinvel(this.chest.rb.linvel(), true); } }
      // Rapier spreads one impact over a few steps, so the delivered velocity change is summed over a short decaying window
      this.hitAcc = (this.hitAcc || 0) * Math.exp(-dt / 0.1) + this.hitDv; this.hitDv = 0;
      stats.maxHit = Math.max(stats.maxHit, this.hitAcc);
      if (this.hitAcc > KO_DV) { this.hitAcc = 0; this.knockOut(2.6, 'hit'); }
      if (RESPAWN && outOfBounds(pp)) { emit('respawn', this, pp.x, pp.y, pp.z); this.teleport(this.spawn[0], this.spawn[1] + 1, this.spawn[2]); }
    }
    setAnim(name, fade = 0.15) {
      if (this.anim === name) return;
      const prev = this.acts[this.anim], next = this.acts[name];
      if (!next.isRunning() || next.getEffectiveWeight() < 0.05) next.reset();   // a clip still fading out resumes where it is
      next.setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
      prev.fadeOut(fade);
      this.anim = name;
    }
    render(dt) {
      if (this.dead) return;
      const P = this.pelvis.rb, pp = P.translation(), v = P.linvel();
      const qP = toQ(P.rotation()), qC = toQ(this.chest.rb.rotation()), qH = toQ(this.head.rb.rotation());
      const speed = Math.hypot(v.x, v.z), ko = this.ko > 0;
      this.root.position.set(pp.x, pp.y, pp.z); this.root.quaternion.copy(qP);
      const n = dt > 0.03 ? 3 : 1, hh = dt / n;
      for (let k = 0; k < n; k++) { this.sqV += (-170 * this.sq - 11 * this.sqV) * hh; this.sq += this.sqV * hh; }
      const sq = clamp(this.sq, -0.25, 0.3);
      this.squashG.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
      // hysteresis so the clip doesn't flicker (and restart) when speed or ground contact hovers at a threshold
      const air = !this.grounded && this.airT > (this.anim === 'jump' ? 0.05 : 0.2);
      if (ko || this.limp) this.setAnim('tumble', 0.1);
      else if (air || this.hanging) this.setAnim('jump', 0.15);
      else if (speed > (this.anim === 'run' ? 0.35 : 0.9)) this.setAnim('run', 0.15);
      else this.setAnim('idle', 0.25);
      if (this.anim === 'run') {                 // cadence follows ground speed (relative to a moving deck), kept calm
        const gs = Math.hypot(v.x - this.gv.x, v.z - this.gv.z);
        this.acts.run.setEffectiveTimeScale(clamp(0.55 + gs * 0.17, 0.6, 1.4));
      }
      this.mixer.update(dt);
      this.root.updateMatrixWorld(true);
      // torso and head come from the bodies: world-space delta rotations on the spine and head bones
      rotateBoneWorld(this.spineBone, qC.clone().multiply(qP.clone().invert()));
      rotateBoneWorld(this.headBone, qH.clone().multiply(qC.clone().invert()));
      // arms: two-bone aim toward the hand bodies, elbows out, down and back
      const f = this.face, right = V(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
      for (let k = 0; k < 2; k++) {
        const [up, fo, ha] = this.armBones[k], hb = toV(this.hands[k].rb.translation(), _vT);
        up.getWorldPosition(_vS);
        if (!this.L1) { fo.getWorldPosition(_v1); ha.getWorldPosition(_v2); this.L1 = _vS.distanceTo(_v1); this.L2 = _v1.distanceTo(_v2) + 0.05 * K; }
        const L1 = this.L1, L2 = this.L2;
        // the arm aims at the hand eased relative to the shoulder (hides hand-body jitter; a grip stays within ~1 frame)
        const ho = hb.clone().sub(_vS), hs = this.armHand[k] || (this.armHand[k] = ho.clone());
        hs.lerp(ho, 1 - Math.exp(-dt * (this.hands[k].joint ? 40 : 24)));
        const dvec = hs.clone(); let d = dvec.length(); if (d < 1e-4) continue;
        const dirn = dvec.divideScalar(d);
        // soft reach: near full extension the bend angle is hypersensitive to distance (millimetres of hand jitter flicked
        // the elbow), so the solved distance eases toward the limit and a little stretch (up to 1.15x) makes up the rest
        const Lm = L1 + L2 - 1e-3, ds = 0.85 * Lm;
        const dSoft = d > ds ? ds + (Lm - ds) * (1 - Math.exp(-(d - ds) / (Lm - ds))) : d;
        const st = clamp(d / dSoft, 1, 1.15); up.scale.set(1, st, 1); ha.scale.set(1, 1 / st, 1);
        d = clamp(dSoft, Math.abs(L1 - L2) + 1e-3, Lm);
        const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
        // elbow direction: out, down and back, eased over time so it never jumps from one side to the other
        const want = V(0, -0.6, 0).addScaledVector(f, -0.4).addScaledVector(right, -this.hands[k].side * 0.7).normalize();
        const pl = this.armPole[k] || (this.armPole[k] = want.clone()); pl.lerp(want, 1 - Math.exp(-dt * 10)).normalize();
        const pole = pl.clone().addScaledVector(dirn, -pl.dot(dirn));
        if (pole.lengthSq() < 1e-4) pole.copy(want).addScaledVector(dirn, -want.dot(dirn));
        if (pole.lengthSq() < 1e-6) pole.set(0, -1, 0); pole.normalize();
        _vE.copy(_vS).addScaledVector(dirn, cosA * L1 * st).addScaledVector(pole, sinA * L1 * st);
        const e2 = _vE.clone();
        if (this.outside(e2)) {                  // the elbow would sit inside the bean: swing it out around the shoulder-hand line
          e2.sub(_vS).addScaledVector(dirn, -e2.dot(dirn));
          if (e2.lengthSq() > 1e-8) { e2.normalize(); _vE.copy(_vS).addScaledVector(dirn, cosA * L1 * st).addScaledVector(e2, sinA * L1 * st); }
        }
        // ease the elbow (relative to the shoulder, so it never trails a moving body) to hide physics jitter
        const eo = _vE.clone().sub(_vS), es = this.armElbow[k] || (this.armElbow[k] = eo.clone());
        es.lerp(eo, 1 - Math.exp(-dt * 22)); _vE.copy(_vS).add(es);
        _vP.copy(_vS).addScaledVector(dirn, d * st);
        // twist: carry last frame's roll forward, nudged toward the rest roll (any fixed reference degenerates when
        // the arm points along it, e.g. reaching straight ahead)
        const [rzU, rzF] = this.armRestZ[k], pz = this.armZ[k] || (this.armZ[k] = [rzU.clone().applyQuaternion(qC), rzF.clone().applyQuaternion(qC)]);
        pz[0].lerp(rzU.clone().applyQuaternion(qC), 0.12).normalize(); poseBone(up, _vE, pz[0]);
        pz[0].set(0, 0, 1).applyQuaternion(up.getWorldQuaternion(_q3));
        pz[1].copy(pz[0]).lerp(rzF.clone().applyQuaternion(qC), 0.12).normalize(); poseBone(fo, _vP, pz[1]);
        pz[1].set(0, 0, 1).applyQuaternion(fo.getWorldQuaternion(_q3));
      }
      if (this.key) { this.keyA += dt * (ko ? 1 : 2.5 + speed * 3.5 + (air ? 6 : 0)); this.key.quaternion.copy(this.keyRest).multiply(_q1.setFromAxisAngle(ZAXIS, this.keyA)); }
      if (this.blade) this.blade.rotation.y += dt * (air ? 30 : 6 + speed * 2);
    }
  }


  // ------------------------------------------------------------------ knockdown measure from contact events
  // Rapier's soft contacts spread an impact over several steps, so the delivered velocity change is estimated
  // from the pre-step closing speed at first touch (momentum exchange with the whole body), scaled by part sensitivity.
  const hitSeen = new Map();
  function drainImpacts(dt, eventQueue) {
    if (!eventQueue) return;
    eventQueue.drainContactForceEvents(e => {
      const h1 = e.collider1(), h2 = e.collider2(), f = e.totalForceMagnitude();
      for (const [ph, oh] of [[h1, h2], [h2, h1]]) {
        const pi = partOf.get(ph); if (!pi || pi.bean.dead) continue;
        const oc = world.getCollider(oh), ob = oc && oc.parent(); if (!ob) continue;
        const d = danger.get(ob.handle); if (!d || d.until < simTime) continue;
        if (pi.bean.hands.some(h => h.other === ob)) continue;                 // what you hold can't knock you out
        const key = pi.bean.i + ':' + h1 + ':' + h2;
        if ((hitSeen.get(key) ?? -1) > simTime - 0.35) { hitSeen.set(key, simTime); continue; }
        hitSeen.set(key, simTime);
        const pp = pi.p.rb.translation(), op = ob.translation(), pv = pi.p.v0, ov = d.v0;
        const n = V(pp.x - op.x, pp.y - op.y, pp.z - op.z).normalize();
        const closing = Math.max(0, (ov.x - pv.x) * n.x + (ov.y - pv.y) * n.y + (ov.z - pv.z) * n.z), mh = ob.mass();
        const dv = Math.max(closing * 1.5 * mh / (mh + M_TOTAL * HIT_MREF), f * dt / pi.p.m) * SENS[pi.part];
        if (pi.bean.invuln <= 0) pi.bean.hitDv = Math.max(pi.bean.hitDv, dv);
      }
    });
  }

  // ------------------------------------------------------------------ build and API
  const players = [];
  for (let i = 0; i < count; i++) {
    const s = spawnPoints[i % spawnPoints.length];
    players.push(new Bean(i, s[0], s[1], s[2], controllers[i] || null));
  }
  const api = {
    players,
    constants: { K, R, Y, MASS, M_TOTAL, ARM, WALK, JUMP_V, KO_DV },
    stats,
    /** Call once per fixed physics step BEFORE world.step(). inputs[i] overrides player i's controller. */
    update(dt, inputs = []) {
      api.beginStep();
      for (const p of players) p.step(dt, inputs[p.i]);
    },
    /** Per-step bookkeeping (danger list, ledges) when the caller steps players one by one with p.step(dt, input). */
    beginStep() {
      for (const [hnd, d] of danger) { if (!world.getRigidBody(hnd) || d.until < simTime) danger.delete(hnd); else d.v0 = d.body.linvel(); }
      refreshLedges();
    },
    /** Call once per fixed physics step AFTER world.step(eventQueue). */
    afterStep(dt, eventQueue) {
      drainImpacts(dt, eventQueue);
      for (const p of players) p.postStep(dt);
      simTime += dt;
    },
    /** Call once per rendered frame: bones, juice. */
    render(dt) { for (const p of players) p.render(dt); tickPuffs(dt); },
    /** Bounding box of the players worth framing (conscious ones first) for a shared camera. */
    getFocus() {
      const alive = players.filter(p => !p.dead), live = alive.filter(p => p.ko <= 0), use = live.length ? live : alive;
      const min = V(Infinity, Infinity, Infinity), max = V(-Infinity, -Infinity, -Infinity);
      for (const p of use) { const t = p.pos(); min.min(V(t.x, t.y - Y.pelvis, t.z)); max.max(V(t.x, t.y + 0.9 * K, t.z)); }
      return { min, max, center: min.clone().add(max).multiplyScalar(0.5), points: use.map(p => toV(p.head.rb.translation())) };
    },
    /** Knock a player out: dv = delivered velocity change in m/s (>= KO_DV knocks out), optional impulse vector. */
    knock(player, dv = KO_DV + 1, impulse = null, why = 'script') {
      if (impulse) for (const q of player.parts) q.rb.applyImpulse({ x: impulse.x * q.m / M_TOTAL, y: impulse.y * q.m / M_TOTAL, z: impulse.z * q.m / M_TOTAL }, true);
      if (dv >= KO_DV) player.knockOut(2.6, why);
    },
    isOut: player => player.ko > 0,
    onEvent(fn) { listeners.push(fn); return () => listeners.splice(listeners.indexOf(fn), 1); },
    markDangerous,
    /** Position the DOM name chips over the heads. */
    placeChips(camera, w, h, label = p => 'P' + (p.i + 1)) {
      const t = new THREE.Vector3();
      for (const p of players) {
        if (p.dead || !p.chip) continue;
        const hp = p.head.rb.translation();
        t.set(hp.x, hp.y + R.head + 0.32 * K, hp.z).project(camera);
        const x = clamp((t.x + 1) / 2 * w, 40, w - 40), y = clamp((1 - t.y) / 2 * h, 40, h - 8);
        p.chip.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
        p.chip.style.opacity = p.ko > 0 ? 0.7 : 1;
        const s = label(p); if (p.chip.textContent !== s) p.chip.textContent = s;
      }
    },
    time: () => simTime,
    /** Remove everything this module added to the scene (the world itself belongs to the caller). */
    dispose() {
      for (const p of players) scene.remove(p.root);
      for (const o of owned) { scene.remove(o); o.material.dispose(); }
      puffTex.dispose(); outlineMat.dispose();
      for (const p of players) if (p.chip) p.chip.remove();
    },
    tiltOf: body => tiltOf(body.rotation()),
  };
  return api;
}
