// Giant stomp (new): a giant hand's shadow grows on a walkable spot that is clear of every player at spawn time
// (telegraph 1.5-2 s, with a red rim and accelerating thump beats; the hand is visible lowering overhead), then it
// slams: crushes chunks under it, shoves loose objects and players, and sends out a shockwave ring you can jump.
// Escalates to faster stomps, then two at once (spaced apart, the shadow always shows for >= 1.5 s).
// Config (arena.hazardConfig.stomp): { title, hint, safe, filter(pt), radius, makeHand(ctx) -> Object3D (palm-down,
//   origin at the palm's underside), skinColor, levels, onSlam(wp, ctx), crush: amount }
import { dropDanger, freePoints, blast, disposeObj } from './common.js';

const LEVELS = [{ gap: 4.4, n: 1, tele: 2.0 }, { gap: 3.6, n: 1, tele: 1.8 }, { gap: 3.8, n: 2, tele: 1.6 }];

export function makeHandMesh(THREE, color = '#f2b48c', scale = 1) {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75 });
  const palm = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 2.2, 2, 1, 2), m); palm.position.set(0, 0.35, -0.1); g.add(palm);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.1, 3.2, 14), new THREE.MeshStandardMaterial({ color: '#5a7fc8', roughness: 0.8 })); cuff.position.set(0, 2.0, -1.9); cuff.rotation.x = -0.9; g.add(cuff);
  for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.2, 4, 8), m); f.rotation.x = Math.PI / 2; f.position.set(-0.84 + i * 0.56, 0.3, 1.55 + (i === 1 || i === 2 ? 0.15 : 0)); g.add(f); }
  const th = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.9, 4, 8), m); th.rotation.set(Math.PI / 2, 0, 0.9); th.position.set(1.5, 0.32, 0.2); g.add(th);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  g.scale.setScalar(scale);
  return g;
}

class Stomp {
  constructor(lvl, ctx) {
    this.name = 'stomp'; this.lvl = lvl; this.ctx = ctx; this.cfg = { radius: 1.8, levels: LEVELS, crush: 45, ...ctx.cfg('stomp') };
    this.items = []; this.next = 0; this.started = false; this.last = null; this.log = [];
  }
  params() { return this.cfg.levels[Math.min(2, this.lvl)]; }
  spawn(now) {
    const { ctx, cfg } = this; const THREE = ctx.THREE; const R = ctx.R; const P = this.params(); const r = cfg.radius;
    for (let k = 0; k < P.n && this.items.length < 3; k++) {
      const ok = freePoints(ctx, { awayFromPlayers: r + 0.6, busy: this.items.map((it) => it.local), spacing: 2 * r + 1.4, last: this.last, filter: cfg.filter });
      if (!ok.length) return;
      const pt = ok[Math.floor(R.hazard() * ok.length)]; this.last = pt;
      const local = new THREE.Vector3(pt[0], pt[2], pt[1]);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(r, 36), new THREE.MeshBasicMaterial({ color: '#1a0c14', transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide }));
      shadow.rotation.x = -Math.PI / 2; shadow.scale.set(1, 1.1, 1); shadow.position.copy(local).setY(local.y + 0.04); shadow.renderOrder = 3; ctx.group.add(shadow);
      const tele = ctx.fx.circleTele(ctx.group, local, r, '#ff3a2a');
      const hand = cfg.makeHand ? cfg.makeHand(ctx) : makeHandMesh(THREE, cfg.skinColor);
      hand.rotation.y = (R.fx() - 0.5) * 0.8; ctx.group.add(hand);
      // the snapshot: who was near this spot when it was chosen (for tests / fairness checks)
      const nearest = Math.min(99, ...ctx.living().map((p) => { const l = ctx.frame.toLocal(p.position); return Math.hypot(l.x - local.x, l.z - local.z); }));
      const it = { local, shadow, tele, hand, t: 0, T: Math.max(1.5, P.tele), phase: 'tele', wave: 0, waveHit: new Set() };
      ctx.dangers.push(it.danger = { kind: 'circle', x: local.x, z: local.z, r: r + 0.5 });
      this.items.push(it); this.log.push({ t: now, kind: 'tele', x: +local.x.toFixed(2), z: +local.z.toFixed(2), T: it.T, nearestPlayer: +nearest.toFixed(2) });
    }
    ctx.fx.sfx('rumble');
  }
  update(dt, now, armed) {
    const { ctx, cfg } = this; const r = cfg.radius;
    if (!this.started) { this.started = true; this.next = now + 0.2; }
    if (now >= this.next) { const P = this.params(); this.spawn(now); this.next = now + P.gap * (0.85 + ctx.R.hazard() * 0.3); }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt; const L = it.local;
      if (it.phase === 'tele') {
        const k = Math.min(1, it.t / it.T);
        it.shadow.scale.set(0.35 + 0.65 * k, (0.35 + 0.65 * k) * 1.1, 1); it.shadow.material.opacity = 0.15 + 0.6 * k;
        const beat = Math.floor(k * k * 7); if (beat !== it.beat) { it.beat = beat; ctx.fx.sfx('tick'); it.tele.ring.material.opacity = 1; }
        it.tele.ring.material.opacity = Math.max(0.45, it.tele.ring.material.opacity - dt * 3); it.tele.disc.material.opacity = 0.08 + 0.2 * k;
        it.hand.position.set(L.x, L.y + 13 - 7.5 * k, L.z);   // lowering overhead: visible, readable, not yet down
        if (k >= 1) { it.phase = 'slam'; it.t = 0; }
        continue;
      }
      if (it.phase === 'slam') {
        const k = Math.min(1, it.t / 0.12); it.hand.position.y = L.y + 5.5 * (1 - k);
        if (k >= 1) { if (armed) this.slam(it); else { this.remove(it); this.items.splice(i, 1); continue; } it.phase = 'lift'; it.t = 0; }
        continue;
      }
      // lift + shockwave
      if (it.wave >= 0) {
        it.wave += dt; const front = r + (it.wave / 0.38) * 1.9;
        if (armed && it.wave < 0.38) for (const p of ctx.living()) {
          if (it.waveHit.has(p.index) || !p.grounded) continue;                           // jump the ring and it passes under you
          const l = ctx.frame.toLocal(p.position); const d = Math.hypot(l.x - L.x, l.z - L.z);
          if (d < r || Math.abs(d - front) > 0.45 || Math.abs(l.y - L.y) > 0.6) continue;
          it.waveHit.add(p.index);
          const out = ctx.frame.dirToWorld((l.x - L.x) / d, (l.z - L.z) / d);
          if (ctx.hitPlayer(p, new ctx.THREE.Vector3(out.x * 140, 210, out.z * 140), 0.5, 0.8, 'shockwave')) ctx.rumble(p.index, 0.6, 200);
        }
        if (it.wave >= 0.38) it.wave = -1;
      }
      const k = it.t / 0.9;
      if (it.t > 0.35) it.hand.position.y = L.y + (it.t - 0.35) * (it.t - 0.35) * 30;
      it.shadow.material.opacity = Math.max(0, 0.75 * (1 - k));
      if (k >= 1) { this.remove(it); this.items.splice(i, 1); }
    }
  }
  slam(it) {
    const { ctx, cfg } = this; const THREE = ctx.THREE; const r = cfg.radius; const L = it.local;
    const wp = ctx.frame.toWorld(L.x, L.y, L.z);
    ctx.fx.sfx('stomp'); ctx.fx.sfx('crash'); ctx.cam.shake(0.85); ctx.rumbleAll(0.7, 300);
    ctx.D.damageBox(new THREE.Vector3(wp.x, wp.y + 1.2, wp.z), new THREE.Vector3(r * 0.8, 1.4, r * 0.85), cfg.crush, new THREE.Vector3(0, -3, 0));
    // shove loose objects (props, debris) outward and up: big things topple into their neighbours
    for (const rec of ctx.D.bodies) {
      if (rec.type !== 'dynamic' || rec.fading) continue; const t = rec.rb.translation();
      const dx = t.x - wp.x, dz = t.z - wp.z, d = Math.hypot(dx, dz); if (d > r + 1.6 || t.y - wp.y > 4) continue;
      const m = rec.rb.mass(); const f = 1.1 - d / (r + 1.6); const nx = d > 0.05 ? dx / d : 1, nz = d > 0.05 ? dz / d : 0;
      rec.rb.applyImpulseAtPoint({ x: nx * m * 4.5 * f, y: m * 2.2 * f, z: nz * m * 4.5 * f }, { x: t.x, y: t.y + 0.8, z: t.z }, true);
    }
    const n = blast(ctx, wp, r + 0.2, { out: 240, up: 340, stun: 1.2, immune: 1.5, src: 'stomp', falloff: false });
    for (let i = 0; i < 18; i++) { const a = ctx.R.fx() * 6.28; ctx.fx.puff(new THREE.Vector3(wp.x + Math.cos(a) * r, wp.y + 0.2, wp.z + Math.sin(a) * r), { color: '#e8dcc8', v: [Math.cos(a) * 3.5, 1.2 + ctx.R.fx(), Math.sin(a) * 3.5], size: 0.6, grow: 2.2, life: 0.9, a: 0.7 }); }
    ctx.fx.ring(wp, '#fff2d8', r + 1.9, 0.38);
    it.shadow.material.color.set('#000000');
    this.log.push({ t: ctx.now(), kind: 'slam', x: +L.x.toFixed(2), z: +L.z.toFixed(2), hits: n });
    cfg.onSlam?.(wp, ctx);
  }
  remove(it) { const g = this.ctx.group; g.remove(it.shadow); it.shadow.geometry.dispose(); it.shadow.material.dispose(); it.tele.dispose(); if (this.cfg.makeHand) g.remove(it.hand); else disposeObj(g, it.hand); dropDanger(this.ctx, it.danger); }
  dispose() { for (const it of this.items) this.remove(it); this.items = []; }
}

export default {
  name: 'stomp', title: 'GIANT STOMP', hint: 'Get out of the growing shadow · jump the shockwave',
  safeZones: (arena) => arena.hazardConfig?.stomp?.safe || [],
  create: (level, ctx) => new Stomp(level, ctx),
};
