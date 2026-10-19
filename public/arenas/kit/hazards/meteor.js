// Meteor shower (ported from the ship): growing shadows on the arena's walkable points (never on a player right
// now, spaced apart, no repeats), the rock falls along its path, then impact: crater damage, blast, embers.
// Re-skinnable per arena via arena.hazardConfig.meteor:
//   { title, hint, safe, filter(pt), makeRock(ctx, rng) -> Object3D, from(target: Vector3 world, rng) -> Vector3 world,
//     arc: height of a parabolic arc (0 = straight line), impactColors: [..], embers: bool, ringColor, sfx, onImpact(wp, ctx), damage: { r, amount, impulse } }
import { dropDanger, freePoints, createEmbers, blast } from './common.js';

class Meteors {
  constructor(lvl, ctx) {
    this.name = 'meteor'; this.lvl = lvl; this.ctx = ctx; this.cfg = ctx.cfg('meteor'); this.items = []; this.next = 0; this.last = null; this.started = false; this.embers = createEmbers(ctx);
    const THREE = ctx.THREE;
    if (!this.cfg.makeRock) {
      const geo = new THREE.IcosahedronGeometry(0.5, 0);
      const mat = new THREE.MeshStandardMaterial({ color: '#5a3a2a', emissive: '#ff6a1a', emissiveIntensity: 1.6, flatShading: true, roughness: 0.8 });
      const trailMat = new THREE.MeshBasicMaterial({ color: '#ffb050', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.own = [geo, mat, trailMat];
      this.makeRock = () => { const rock = new THREE.Mesh(geo, mat); rock.castShadow = true; const tr = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.2, 10, 1, true), trailMat); tr.geometry.translate(0, -1.6, 0); rock.add(tr); rock.userData.alignToPath = true; return rock; };
    } else this.makeRock = (rng) => this.cfg.makeRock(ctx, rng);
  }
  params() { return [{ gap: 3.5, n: 1, tele: 1.9 }, { gap: 3.0, n: 2, tele: 1.7 }, { gap: 2.4, n: 3, tele: 1.5 }][Math.min(2, this.lvl)]; }
  spawn() {
    const { ctx, cfg } = this; const THREE = ctx.THREE; const R = ctx.R; const P = this.params();
    for (let k = 0; k < P.n && this.items.length < 4; k++) {
      const ok = freePoints(ctx, { awayFromPlayers: 1.3, busy: this.items.map((it) => it.local), spacing: 2.6, last: this.last, filter: cfg.filter });
      if (!ok.length) return;
      const pt = ok[Math.floor(R.hazard() * ok.length)]; this.last = pt;
      const local = new THREE.Vector3(pt[0] + (R.hazard() - 0.5) * 0.4, pt[2], pt[1] + (R.hazard() - 0.5) * 0.4);
      const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), new THREE.MeshBasicMaterial({ color: cfg.shadowColor || '#12060a', transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.copy(local).setY(local.y + 0.05); shadow.renderOrder = 3; ctx.group.add(shadow);
      const tele = ctx.fx.circleTele(ctx.group, local, 1.3, cfg.ringColor || '#ff7a2a');
      const rock = this.makeRock(R.fx); ctx.scene.add(rock);
      const target = ctx.frame.toWorld(local.x, local.y, local.z);
      const from = cfg.from ? cfg.from(target, R.hazard) : new THREE.Vector3(6 + R.hazard() * 4, 26, -8 - R.hazard() * 4).add(target);
      const it = { local, shadow, tele, rock, from, t: 0, T: Math.max(1.0, P.tele), spin: (R.fx() - 0.5) * 8 };
      ctx.dangers.push(it.danger = { kind: 'circle', x: local.x, z: local.z, r: 1.4 });
      this.items.push(it);
    }
    ctx.fx.sfx(cfg.sfx || 'whoosh');
  }
  update(dt, now, armed) {
    const { ctx, cfg } = this; const THREE = ctx.THREE;
    if (!this.started) { this.started = true; this.next = now; }
    if (now >= this.next) { const P = this.params(); this.spawn(); this.next = now + P.gap * (0.8 + ctx.R.hazard() * 0.4); }
    this.embers.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt; const k = Math.min(1, it.t / it.T);
      it.shadow.scale.setScalar(0.25 + 0.75 * k); it.shadow.material.opacity = 0.2 + 0.55 * k;
      it.tele.ring.material.opacity = 0.4 + 0.5 * k; it.tele.disc.material.opacity = 0.05;
      const target = ctx.frame.toWorld(it.local.x, it.local.y, it.local.z);
      // ship: linear fall; cfg.easeIn: slow at first so the shadow reads, fast at the end
      const e = cfg.easeIn ? k * k : k;
      const pos = it.from.clone().lerp(target, e); if (cfg.arc) pos.y += cfg.arc * 4 * e * (1 - e);
      it.rock.position.copy(pos);
      if (it.rock.userData.alignToPath) { it.rock.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), it.from.clone().sub(target).normalize()); it.rock.rotateY(it.t * 4); }
      else it.rock.rotation.set(it.t * it.spin, it.t * it.spin * 0.7, 0);
      if (!cfg.makeRock && ctx.R.fx() < dt * 30) ctx.fx.puff(pos, { color: '#ffa040', v: [0, 0, 0], size: 0.5, grow: 1.5, life: 0.5, a: 0.6, add: true });
      if (k < 1) continue;
      if (armed) this.impact(target);
      this.remove(it); this.items.splice(i, 1);
    }
  }
  impact(wp) {
    const { ctx, cfg } = this; const R = ctx.R; const dmg = cfg.damage || { r: 1.25, amount: 340, impulse: 5 };
    ctx.fx.sfx(cfg.impactSfx || 'boom'); ctx.cam.shake(0.7);
    ctx.D.damageSphere(wp, dmg.r, dmg.amount, dmg.impulse);
    const cols = cfg.impactColors || ['#ff8a2a', '#4a3a36'];
    for (let i = 0; i < 14; i++) { const a = R.fx() * 6.28; ctx.fx.puff(wp, { color: cols[i % cols.length], v: [Math.cos(a) * 3, 2 + R.fx() * 4, Math.sin(a) * 3], size: 0.5, grow: 2.5, life: 1.1, a: 0.8, g: 3, add: !cfg.makeRock && i % 2 === 1 }); }
    ctx.fx.ring(wp, cfg.ringColor || '#ffb060', 3);
    if (cfg.embers !== false) this.embers.add(wp, 0.9, 2.5);
    blast(ctx, wp, 2.3, { out: 260, up: 300, stun: 1.0, immune: 1.5, src: 'meteor' });
    cfg.onImpact?.(wp, ctx);
  }
  remove(it) { this.ctx.group.remove(it.shadow); it.shadow.geometry.dispose(); it.shadow.material.dispose(); it.tele.dispose(); this.ctx.scene.remove(it.rock); dropDanger(this.ctx, it.danger); }
  dispose() { for (const it of this.items) this.remove(it); this.items = []; this.embers.clear(); }
}

export default {
  name: 'meteor', title: 'METEOR SHOWER', hint: 'Watch for growing shadows · keep moving',
  safeZones: (arena) => arena.hazardConfig?.meteor?.safe || [],
  create: (level, ctx) => new Meteors(level, ctx),
};
