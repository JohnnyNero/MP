// Real character for the arena kit: the 6-body active ragdoll (kit/character.js, a copy of proto3d/character.js)
// behind the kit player interface that run.js, the hazards and the bots already use (see standin.js / KIT.md).
//
//   const players = createPlayers({ THREE, RAPIER, world, scene, hero, SkeletonUtils, slots, options });
//   per fixed step:  players.group.beforeUpdate(dt); p.update(dt) each; world.step(eq); players.group.afterStep(dt, eq); p.sync(dt) each
//   per frame:       players.group.render(dt)
//   p.input = { x, y, jump, grab, aim }  (y = away from the camera; aim -1..1 = look down..up)
//
// Mapping: knock(impulse, { stun }) spreads the impulse over the parts by mass and knocks out at stun >= KO_STUN;
// p.body is a proxy whose applyImpulse pushes the whole ragdoll; isOut/eliminate are the kit's (the character never
// respawns); water = per-part buoyancy + drag, drowning when the feet are > 0.3 under for drownTime.
import { createPlayers as createRagdolls } from './character.js';

const HATS = ['acc_sprout', 'acc_bow', 'acc_crown', 'acc_propeller'];
const KO_STUN = 0.9;          // hazard stun at or above this knocks the ragdoll out
const KNOCKDOWN_STUN = 0.5;   // at or above this (waves, the stomp shockwave) it is knocked over for a moment
const BUOY = 1.12;            // buoyancy per part, fraction of its weight when fully under

export function createPlayers({ THREE, RAPIER, world, scene, hero, SkeletonUtils, slots, options = {} }) {
  const O = {
    groundVelocity: null, waterHeight: () => -1e9, cameraBasis: () => ({ fx: 0, fz: -1, rx: 1, rz: 0 }),
    onSplash: null, onOut: null, onKnock: null, onEvent: null,
    drownTime: 1.5, scale: 0.75, massScale: 15, hitMassRef: 0.2, ledges: null,
    ...options,
  };
  let seed = 0x9e3779b9 ^ (slots.length * 7919);
  const rng = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const colors = slots.map((s) => s.color), hats = slots.map((s) => HATS[(s.hat ?? s.index) % 4]);
  const pl = createRagdolls({ THREE, RAPIER, SkeletonUtils, scene, world, models: { blob: hero }, rng,
    spawnPoints: slots.map((s) => [s.spawn.x, s.spawn.y, s.spawn.z]),
    options: { count: slots.length, scale: O.scale, colors, hats, massScale: O.massScale, respawn: false, hitMassRef: O.hitMassRef,
      bounds: { min: [-1e6, -1e6, -1e6], max: [1e6, 1e6, 1e6] }, ledges: O.ledges || [], groundVelocity: O.groundVelocity } });
  const C = pl.constants; const M = C.M_TOTAL;
  const V1 = new THREE.Vector3();

  function nameTag(slot) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
    g.fillStyle = slot.color; g.beginPath(); g.roundRect(6, 6, 116, 52, 20); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#1a1220'; g.stroke();
    g.fillStyle = '#fff'; g.font = '900 38px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(slot.name, 64, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(0.9, 0.45, 1); s.renderOrder = 10; scene.add(s); return s;
  }

  // state markers over the head: circling stars while knocked out, a "!" bubble while hanging off an edge
  // (being held wobbles the name tag instead)
  const spriteTex = (draw) => { const c = document.createElement('canvas'); c.width = c.height = 64; draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const STAR = spriteTex((g) => {
    g.beginPath(); for (let k = 0; k < 10; k++) { const r = k % 2 ? 12 : 28, a = -Math.PI / 2 + k * Math.PI / 5; g.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a)); } g.closePath();
    g.fillStyle = '#ffd84a'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#6a4a10'; g.stroke();
  });
  const BANG = spriteTex((g) => {
    g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 5; g.strokeStyle = '#1a1220'; g.stroke();
    g.fillStyle = '#e8402c'; g.font = '900 44px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 32, 35);
  });
  function markers() {
    const stars = new THREE.Group();
    for (let k = 0; k < 3; k++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: STAR, depthTest: false, transparent: true })); m.scale.setScalar(0.3); m.renderOrder = 11; stars.add(m); }
    const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: BANG, depthTest: false, transparent: true })); bang.scale.setScalar(0.38); bang.renderOrder = 11;
    stars.visible = bang.visible = false; scene.add(stars, bang);
    return { stars, bang };
  }

  class RagdollPlayer {
    constructor(slot, bean) {
      this.index = slot.index; this.color = slot.color; this.name = slot.name; this.slot = slot; this.bean = bean;
      this.input = { x: 0, y: 0, jump: false, grab: false, aim: 0 };
      this.position = new THREE.Vector3(slot.spawn.x, slot.spawn.y, slot.spawn.z); this.velocity = new THREE.Vector3();
      this.isOut = false; this.inWater = false; this.waterT = 0; this.locked = false; this.invulnerable = false; this.lastHit = null;
      this.mass = M; this.tag = nameTag(slot); this.mk = markers();
      const self = this;
      for (const q of bean.parts) q.rb.userData = { player: this, part: q.part };
      this.colliders = bean.parts.map((q) => q.col);
      this.bodyColliders = bean.parts.filter((q) => !q.part.startsWith('hand')).map((q) => q.col);
      this.collider = bean.pelvis.col;   // the real pelvis collider (contact queries); groups go through setGroups()
      // body proxy: hazards push "the player" -> the impulse is shared over every part by mass
      this.body = {
        userData: { player: this }, handle: bean.pelvis.rb.handle,
        applyImpulse(j, wake = true) { self.push(j, wake); },
        applyImpulseAtPoint(j, _pt, wake = true) { self.push(j, wake); },
        linvel: () => bean.pelvis.rb.linvel(), translation: () => bean.pelvis.rb.translation(),
        setLinvel(v, wake = true) { for (const q of bean.parts) q.rb.setLinvel(v, wake); },
        mass: () => M, isDynamic: () => true, isKinematic: () => false, isFixed: () => false,
      };
      // stampede & co. call collider.setCollisionGroups(g): keep my own-parts exclusion, add their filter
      const bit = 1 << (2 + bean.i), own = 0xffff & ~bit;
      this.collider = new Proxy(bean.pelvis.col, { get(t, k) {
        if (k === 'setCollisionGroups') return (g) => { const f = own & (g & 0xffff); for (const q of bean.parts) q.col.setCollisionGroups((bit << 16) | f); };
        const v = t[k]; return typeof v === 'function' ? v.bind(t) : v;
      } });
    }
    get stun() { return this.isOut ? 0 : this.bean.ko; }
    get grounded() { return !this.isOut && this.bean.grounded; }
    get hanging() { return !this.isOut && this.bean.hanging; }
    get holding() { if (this.isOut) return null; const h = this.bean.hands.find((x) => x.joint && x.kind !== 'static'); return h ? h.kind : null; }
    get heldBy() { return this.isOut ? 0 : this.bean.heldBy; }
    holds(rb) { return !this.isOut && this.bean.hands.some((h) => h.joint && h.other === rb); }
    /** world direction from a hanging player into the ledge (null when not hanging) */
    hangDir() { const h = this.bean.hands.find((x) => x.joint && x.kind === 'static' && x.intoLedge); return h ? h.intoLedge : null; }
    get head() { const t = this.bean.head.rb.translation(); return V1.set(t.x, t.y, t.z); }
    push(j, wake = true) { if (this.isOut) return; for (const q of this.bean.parts) q.rb.applyImpulse({ x: j.x * q.m / M, y: j.y * q.m / M, z: j.z * q.m / M }, wake); }
    knock(impulse, opts = {}) {
      if (this.isOut) return;
      const stun = opts.stun ?? 1.1;
      this.push(impulse);
      if (stun >= KO_STUN) this.bean.knockOut(Math.min(3.2, 1.3 + stun), 'hazard');                 // knocked out
      else if (stun >= KNOCKDOWN_STUN) this.bean.knockOut(0.6 + stun, 'knockdown');                 // knocked over, up again quickly
      else this.bean.wake = Math.min(this.bean.wake, 0.45);          // a stagger: balance muscles drop for a moment
      O.onKnock?.(this, impulse);
    }
    eliminate() {
      if (this.isOut) return;
      this.isOut = true;
      this.bean.kill(); this.tag.visible = false; this.body = null; this.collider = null; this.colliders = []; this.bodyColliders = [];
      O.onOut?.(this);
      this.inWater = false;
    }
    update(dt) {
      if (this.isOut) return;
      const b = this.bean;
      // water: buoyancy + drag per part, drowning by feet depth
      const bp = b.ball.rb.translation(); const feet = bp.y - C.R.ball;
      const depth = O.waterHeight(bp.x, bp.z) - feet;
      const wet = depth > 0.25;
      if (wet && !this.inWater) O.onSplash?.(this, depth);
      this.inWater = wet;
      if (depth > 0.3 && !this.invulnerable) { this.waterT += dt; if (this.waterT >= O.drownTime) { this.eliminate(); return; } }
      else this.waterT = Math.max(0, this.waterT - dt * 2);
      if (depth > -1) {
        for (const q of b.parts) {
          const t = q.rb.translation(); const sub = Math.max(0, Math.min(1, (O.waterHeight(t.x, t.z) - t.y) / (2 * q.r) + 0.5));
          if (sub <= 0) continue; const v = q.rb.linvel();
          q.rb.applyImpulse({ x: -v.x * q.m * 1.4 * sub * dt, y: (q.m * 9.81 * BUOY - v.y * q.m * 2.2) * sub * dt, z: -v.z * q.m * 1.4 * sub * dt }, true);
        }
        if (wet) b.airT = Math.min(b.airT, 0.8);     // keep paddling instead of going limp
      }
      // input: stick (camera-relative, y = away) -> world direction -> the character's camera-looks-down-z frame
      const inp = this.locked ? null : this.input;
      let c = { mx: 0, my: 0, aim: 0, jump: false, grab: false };
      if (inp) {
        const cb = O.cameraBasis(); const x = inp.x || 0, y = inp.y || 0;
        const dx = cb.rx * x + cb.fx * y, dz = cb.rz * x + cb.fz * y;
        c = { mx: dx, my: -dz, aim: inp.aim || 0, jump: !!inp.jump, grab: !!inp.grab, grabL: inp.grabL || 0, grabR: inp.grabR || 0, limp: !!inp.limp };
      }
      b.step(dt, c);
    }
    sync() {
      if (this.isOut) return;
      const b = this.bean.ball.rb.translation(), v = this.bean.pelvis.rb.linvel();
      this.position.set(b.x, b.y - C.R.ball, b.z); this.velocity.set(v.x, v.y, v.z);
    }
    teleport(p) { if (this.isOut) return; this.bean.teleport(p.x, p.y, p.z); this.position.copy(p); this.waterT = 0; }
    debugState() {
      const b = this.bean;
      if (this.isOut) return { kos: b.kos || 0, grabs: b.grabs || 0, throws: b.throws || 0, mantles: b.mantles || 0 };
      return { tilt: +pl.tiltOf(b.pelvis.rb).toFixed(2), ko: +b.ko.toFixed(2), kos: b.kos || 0, hang: !!b.hanging, holding: this.holding, heldBy: b.heldBy, grabs: b.grabs || 0, throws: b.throws || 0, mantles: b.mantles || 0, waterT: +this.waterT.toFixed(2) };
    }
    dispose() {
      if (!this.isOut) { try { this.bean.kill(); } catch { /* world freed */ } }
      scene.remove(this.tag); this.tag.material.map.dispose(); this.tag.material.dispose();
      scene.remove(this.mk.stars, this.mk.bang); for (const s of [...this.mk.stars.children, this.mk.bang]) s.material.dispose();
    }
  }

  const players = pl.players.map((bean, i) => new RagdollPlayer(slots[i], bean));
  // thrown players become a projectile for a moment (they bowl over whoever they land on)
  pl.onEvent((type, who, what, extra) => {
    if (type === 'throw' && what && what.parts) { pl.markDangerous(what.chest.rb, 0.9); pl.markDangerous(what.pelvis.rb, 0.9); }
    O.onEvent?.(type, players[who.i], what && what.parts ? players[what.i] : what, extra);
  });
  const tagY = C.Y.head + C.R.head + 0.45;
  players.group = {
    api: pl, isRagdoll: true,
    beforeUpdate() { pl.beginStep(); },
    afterStep(dt, eventQueue) { pl.afterStep(dt, eventQueue); },
    render(dt, alpha = 1) {
      pl.render(dt, alpha);
      const now = performance.now() / 1000;
      for (const p of players) {
        const mk = p.mk;
        if (p.isOut) { mk.stars.visible = mk.bang.visible = false; continue; }
        const b = p.bean, t = b.ipos(b.pelvis, alpha), h = b.ipos(b.head, alpha);
        p.tag.position.set(t.x, t.y - C.Y.pelvis + tagY, t.z); p.tag.material.opacity = b.ko > 0 ? 0.65 : 1;
        p.tag.material.rotation = b.heldBy > 0 ? 0.25 * Math.sin(now * 22) : 0;                       // held: the tag shakes
        mk.stars.visible = b.ko > 0;
        if (mk.stars.visible) mk.stars.children.forEach((s, k) => { const a = now * 5 + k * 2.094; s.position.set(h.x + 0.3 * Math.cos(a), h.y + 0.32 + 0.05 * Math.sin(a * 2), h.z + 0.3 * Math.sin(a)); });
        mk.bang.visible = !!b.hanging && b.ko <= 0;
        if (mk.bang.visible) mk.bang.position.set(p.tag.position.x + 0.55, p.tag.position.y + 0.08 + 0.06 * Math.sin(now * 8), p.tag.position.z);
      }
    },
    markDangerous: (rb, s) => pl.markDangerous(rb, s),
    focus: () => pl.getFocus(),
    dispose() { pl.dispose(); },
  };
  return players;
}
