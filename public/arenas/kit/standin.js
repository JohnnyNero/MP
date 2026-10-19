// Stand-in character module for TABLETOP arenas (kit copy of ship/standin.js, adds options.slideK). Swap for proto3d/character.js later: same interface.
// See README.md ("Character interface"). No device code here: whoever owns a player writes player.input.
//
//   const players = createPlayers({ THREE, RAPIER, world, scene, hero, SkeletonUtils, slots, options });
//   each frame (fixed 60 Hz):  p.update(dt)  -> world.step -> p.sync(dt)
//   p.input = { x, y, jump }   stick in [-1,1] (y = up/away from camera), jump held
//   p.knock(impulseNs, { stun })   p.eliminate()   p.isOut   p.position (feet, world)
export const HATS = ['acc_sprout', 'acc_bow', 'acc_crown', 'acc_propeller'];
const HALF_H = 0.28, RADIUS = 0.3, FOOT = HALF_H + RADIUS;   // capsule: 1.16 tall, centre 0.58 above the feet
const SPEED = 5.2, JUMP_V = 7.2, EXTRA_G = 12, SLIDE_K = 0.5;

export function createPlayers({ THREE, RAPIER, world, scene, hero, SkeletonUtils, slots, options = {} }) {
  const O = {
    groundVelocity: null,        // (rigidBody, point, outVec3) -> outVec3 | null : velocity of a moving floor at point
    waterHeight: () => -1e9,     // (x, z) -> sea surface height
    cameraBasis: () => ({ fx: 0, fz: -1, rx: 1, rz: 0 }),   // horizontal camera forward / right
    onSplash: null, onOut: null, onKnock: null,
    drownTime: 1.5, modelScale: 0.66, slideK: SLIDE_K,   // slideK: downhill push on slopes (ship deck lists; toy ramps barely slide)
    ...options,
  };
  const WHITE = new THREE.Color('#ffffff');
  const outlineMat = new THREE.MeshBasicMaterial({ color: '#241c30', side: THREE.BackSide });
  outlineMat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <skinning_vertex>', '#include <skinning_vertex>\n\ttransformed += normalize( objectNormal ) * 0.03;'); };
  const V = new THREE.Vector3(), V2 = new THREE.Vector3(), GV = new THREE.Vector3();
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const OFFS = [[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]];

  function makeVisual(slot) {
    const root = new THREE.Group(); root.name = 'player' + slot.index;
    const tilt = new THREE.Group(); root.add(tilt);
    const model = SkeletonUtils.clone(hero.scene); model.scale.setScalar(O.modelScale); tilt.add(model);
    const col = new THREE.Color(slot.color); const mats = {}; const outlines = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false;
      const n = o.material.name;
      if (n === 'body' || n === 'body_tint') {
        mats[n] ||= Object.assign(o.material.clone(), { name: n });
        mats[n].color.copy(n === 'body' ? col : col.clone().lerp(WHITE, 0.4)); o.material = mats[n];
        if (o.isSkinnedMesh && n === 'body') outlines.push(o);
      }
    });
    for (const m of outlines) {
      const o = new THREE.SkinnedMesh(m.geometry, outlineMat); o.bind(m.skeleton, m.bindMatrix);
      o.castShadow = false; o.frustumCulled = false; o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale); m.parent.add(o);
    }
    for (const h of HATS) { const o = model.getObjectByName(h); if (o) o.visible = h === HATS[slot.hat ?? slot.index % 4]; }
    const mixer = new THREE.AnimationMixer(model); const acts = {};
    for (const clip of hero.animations) acts[clip.name] = mixer.clipAction(clip);
    acts.idle?.play();
    // colour ring under the feet + name tag: readable at couch distance
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.5, 28), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 2;
    const ringG = new THREE.Group(); ringG.add(ring); scene.add(ringG);
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = slot.color; g.beginPath(); g.roundRect(6, 6, 116, 52, 20); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#1a1220'; g.stroke();
    g.fillStyle = '#fff'; g.font = '900 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(slot.name, 64, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    tag.scale.set(0.9, 0.45, 1); tag.position.y = 1.65; tag.renderOrder = 10; root.add(tag);
    scene.add(root);
    return { root, tilt, model, mixer, acts, anim: 'idle', ring: ringG, tag, mats };
  }

  class Player {
    constructor(slot) {
      this.index = slot.index; this.color = slot.color; this.name = slot.name; this.slot = slot;
      this.input = { x: 0, y: 0, jump: false };
      this.position = new THREE.Vector3(); this.velocity = new THREE.Vector3();
      this.facing = 0; this.grounded = false; this.groundBody = null; this.groundNormal = new THREE.Vector3(0, 1, 0); this.groundPoint = new THREE.Vector3();
      this.isOut = false; this.outTime = null; this.inWater = false; this.waterT = 0; this.stun = 0; this.locked = false;
      this.slide = new THREE.Vector3(); this.coyote = 0; this.jumpHeld = false; this.knockT = 0; this.airT = 0;
      this.vis = makeVisual(slot);
      const s = slot.spawn;
      this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(s.x, s.y + FOOT, s.z).lockRotations().setLinearDamping(0.1).setCcdEnabled(true));
      this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_H, RADIUS).setDensity(220).setFriction(0.0).setRestitution(0.0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), this.body);
      this.body.userData = { player: this };
      this.mass = this.body.mass();
      this.position.set(s.x, s.y, s.z); this.facing = slot.facing ?? 0;
    }
    get alive() { return !this.isOut; }
    knock(impulse, opts = {}) {
      if (this.isOut) return;
      this.stun = Math.max(this.stun, opts.stun ?? 1.1); this.knockT = 0.18; this.grounded = false;
      this.body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      O.onKnock?.(this, impulse);
    }
    eliminate() {
      if (this.isOut) return;
      this.isOut = true; this.inWater = false;
      world.removeRigidBody(this.body); this.body = null; this.collider = null;
      this.vis.root.visible = false; this.vis.ring.visible = false;
      O.onOut?.(this);
    }
    _probeGround() {
      const t = this.body.translation(); let best = null;
      for (const [ox, oz] of OFFS) {
        ray.origin.x = t.x + ox; ray.origin.y = t.y; ray.origin.z = t.z + oz;
        const h = world.castRayAndGetNormal(ray, FOOT + 0.3, true, undefined, undefined, undefined, this.body);
        if (h) { const toi = h.toi ?? h.timeOfImpact; if (h.normal.y > 0.5 && (!best || toi < best.toi)) best = { toi, n: h.normal, c: h.collider, ox, oz }; }
      }
      return best;
    }
    update(dt) {
      if (this.isOut) return;
      const rb = this.body; const t = rb.translation(); const v = rb.linvel();
      this.knockT = Math.max(0, this.knockT - dt); this.stun = Math.max(0, this.stun - dt);
      // ground
      const hit = this.knockT > 0 ? null : this._probeGround();
      const wasGrounded = this.grounded;
      this.grounded = !!hit && hit.toi <= FOOT + 0.09 && v.y < 4;
      GV.set(0, 0, 0);
      if (hit) {
        this.groundNormal.set(hit.n.x, hit.n.y, hit.n.z);
        this.groundPoint.set(t.x + hit.ox, t.y - hit.toi, t.z + hit.oz);
        const gb = hit.c.parent(); this.groundBody = gb;
        if (gb && this.grounded) {
          if (gb.isDynamic()) { const lv = gb.linvel(); GV.set(lv.x, lv.y, lv.z); }
          else if (O.groundVelocity) O.groundVelocity(gb, this.groundPoint, GV);
        }
      } else this.groundBody = null;
      if (this.grounded) { this.coyote = 0.12; this.airT = 0; this.lastGV = (this.lastGV || new THREE.Vector3()).copy(GV); }
      else { this.coyote -= dt; this.airT += dt; }
      // water
      const wh = O.waterHeight(t.x, t.z); const depth = wh - (t.y - FOOT);
      const wet = depth > 0.25;
      if (wet && !this.inWater) O.onSplash?.(this, depth);
      this.inWater = wet;
      if (depth > 0.3 && !this.invulnerable) { this.waterT += dt; if (this.waterT >= O.drownTime) { this.eliminate(); return; } }
      else this.waterT = Math.max(0, this.waterT - dt * 2);
      // stick -> camera-relative world direction
      const cb = O.cameraBasis(); const inp = this.locked ? { x: 0, y: 0, jump: false } : this.input;
      let dx = cb.rx * inp.x + cb.fx * inp.y, dz = cb.rz * inp.x + cb.fz * inp.y;
      const m = Math.hypot(dx, dz); if (m > 1) { dx /= m; dz /= m; }
      const stunned = this.stun > 0;
      const base = this.grounded ? GV : (this.lastGV && this.airT < 0.5 ? this.lastGV : V2.set(0, 0, 0));
      let rx = v.x - base.x - this.slide.x, rz = v.z - base.z - this.slide.z;   // own velocity relative to the floor, minus last step's slide
      const tx = stunned ? 0 : dx * SPEED * (wet ? 0.35 : 1), tz = stunned ? 0 : dz * SPEED * (wet ? 0.35 : 1);
      const acc = (this.grounded ? (stunned ? 5 : 45) : (stunned ? 0.6 : 14)) * dt;
      const ex = tx - rx, ez = tz - rz, el = Math.hypot(ex, ez);
      if (el > acc) { rx += ex / el * acc; rz += ez / el * acc; } else { rx = tx; rz = tz; }
      // slopes push you downhill (listing deck): a slide velocity the stick can fight but not cancel
      if (this.grounded) {
        const n = this.groundNormal; V.set(n.x * n.y, 0, n.z * n.y);   // horizontal part of gravity along the surface (downhill)
        this.slide.addScaledVector(V, 9.81 * O.slideK * dt);
      }
      this.slide.multiplyScalar(Math.max(0, 1 - (this.grounded ? 1.6 : 0.4) * dt));
      let vy = v.y;
      if (this.grounded && !stunned && this.knockT <= 0) vy = base.y - 0.6;              // stick to (moving) floors
      else vy -= EXTRA_G * dt;
      if (inp.jump && !this.jumpHeld && this.coyote > 0 && !stunned && !wet) { vy = base.y + JUMP_V; this.coyote = 0; this.grounded = false; this.knockT = 0.1; this.vis.jumpT = 0.4; }
      this.jumpHeld = !!inp.jump;
      if (wet) { vy += (Math.min(depth, 1.2) * 20 - vy * 4) * dt; rx *= 1 - 2 * dt; rz *= 1 - 2 * dt; }   // floats ~0.5 deep
      rb.setLinvel({ x: base.x + rx + this.slide.x, y: vy, z: base.z + rz + this.slide.z }, true);
      if (m > 0.2 && !stunned) this.wantFacing = Math.atan2(dx, dz);
      this.moveMag = stunned ? 0 : m;
    }
    sync(dt) {
      const vis = this.vis;
      if (this.isOut) return;
      const t = this.body.translation(), v = this.body.linvel();
      this.position.set(t.x, t.y - FOOT, t.z); this.velocity.set(v.x, v.y, v.z);
      vis.root.position.copy(this.position);
      if (this.wantFacing != null) { let d = this.wantFacing - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d)); this.facing += d * Math.min(1, dt * 14); }
      vis.root.rotation.y = this.facing;
      // tumble: spin the model while stunned (ragdoll-lite)
      if (this.stun > 0) { vis.tilt.rotation.x += dt * 9; vis.tilt.position.y = 0.45; }
      else { vis.tilt.rotation.x *= Math.max(0, 1 - dt * 12); vis.tilt.position.y *= Math.max(0, 1 - dt * 12); }
      // feet ring follows the floor under the player
      if (this.grounded || this.airT < 1) { vis.ring.visible = true; vis.ring.position.copy(this.groundPoint).addScaledVector(this.groundNormal, 0.03); vis.ring.quaternion.setFromUnitVectors(V.set(0, 1, 0), this.groundNormal); }
      else vis.ring.visible = false;
      vis.jumpT = Math.max(0, (vis.jumpT || 0) - dt);
      const anim = this.stun > 0 ? 'tumble' : this.inWater ? 'tumble' : (!this.grounded && (vis.jumpT > 0 || this.airT > 0.15)) ? 'jump' : this.moveMag > 0.2 ? 'run' : 'idle';
      if (anim !== vis.anim && vis.acts[anim]) {
        const a = vis.acts[anim], b = vis.acts[vis.anim];
        a.reset().play(); if (anim === 'jump') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        if (b) a.crossFadeFrom(b, 0.15, false); vis.anim = anim;
      }
      if (vis.acts.run) vis.acts.run.timeScale = 0.6 + this.moveMag * 0.8;
      vis.mixer.update(dt);
    }
    teleport(p) { if (this.body) { this.body.setTranslation({ x: p.x, y: p.y + FOOT, z: p.z }, true); this.body.setLinvel({ x: 0, y: 0, z: 0 }, true); } }
    dispose() {
      scene.remove(this.vis.root); scene.remove(this.vis.ring);
      this.vis.tag.material.map.dispose(); this.vis.tag.material.dispose();
      if (this.body) { try { world.removeRigidBody(this.body); } catch { /* world already freed */ } this.body = null; }
    }
  }
  return slots.map((s) => new Player(s));
}
