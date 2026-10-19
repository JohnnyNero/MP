// Decompression (new): the hull is open on one side. A warning (klaxon, strobing lights, floor arrows toward the
// opening; at least 1.8 s), then the air rushes out in a surge: players, props and debris are dragged toward the
// opening, harder the nearer they are. Holding something fixed (rails, ledges) keeps you in; a standing bean's feet
// grip a little; jumping mid-surge is a bad idea. Escalates to stronger, longer surges with shorter breaks.
// Config (arena.hazardConfig.decompress):
//   { title, hint, safe, dir: [dx, dz] local direction toward the opening, near(x, z) -> 0..1 (1 at the opening),
//     arrows: [[x, z], ...] floor arrow spots, holdTag (point tag where bots hang on), levels, onPhase(phase, ctx) }
import { dropDanger, disposeObj } from './common.js';

const LEVELS = [{ gap: 7.5, tele: 2.2, dur: 2.4, acc: 16 }, { gap: 6.5, tele: 2.0, dur: 2.8, acc: 19 }, { gap: 5.5, tele: 1.8, dur: 3.2, acc: 22 }];

class Decompress {
  constructor(lvl, ctx) {
    this.name = 'decompress'; this.lvl = lvl; this.ctx = ctx; this.items = []; this.log = [];
    this.cfg = { dir: [0, 1], near: () => 0.5, arrows: [], holdTag: 'rail', levels: LEVELS, ...ctx.cfg('decompress') };
    this.phase = 'idle'; this.t = 0; this.next = 0; this.started = false; this.k = 0; this.beat = 0;
    const THREE = ctx.THREE, [dx, dz] = this.cfg.dir;
    this.dirW = ctx.frame.dirToWorld(dx, dz);
    // floor chevrons pointing at the opening (hidden until a warning)
    const shape = new THREE.Shape(); shape.moveTo(-0.55, -0.35); shape.lineTo(0, 0.25); shape.lineTo(0.55, -0.35); shape.lineTo(0.55, 0.05); shape.lineTo(0, 0.65); shape.lineTo(-0.55, 0.05); shape.closePath();
    this.arrowGeo = new THREE.ShapeGeometry(shape);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.arrows = new THREE.Group(); ctx.group.add(this.arrows);
    for (const [x, z] of this.cfg.arrows) {
      const m = new THREE.Mesh(this.arrowGeo, this.arrowMat); m.rotation.x = -Math.PI / 2; m.rotation.z = -Math.atan2(dx, dz) + Math.PI;
      m.position.set(x, (ctx.surface.heightAt?.(x, z) ?? 0) + 0.04, z); m.renderOrder = 3; this.arrows.add(m);
    }
    this.arrows.visible = false;
    ctx.dangers.push(this.danger = { kind: 'wind', dir: [dx, dz], holdTag: this.cfg.holdTag, active: false });
  }
  params() { return this.cfg.levels[Math.min(2, this.lvl)]; }
  setPhase(p, now) { this.phase = p; this.t = 0; this.cfg.onPhase?.(p, this.ctx); this.log.push([+now.toFixed(2), p]); }
  update(dt, now, armed) {
    const { ctx } = this; const P = this.params();
    if (!this.started) { this.started = true; this.next = now + 0.8; }
    this.t += dt;
    if (this.phase === 'idle') {
      this.k = 0;
      if (now >= this.next) { this.setPhase('warn', now); this.danger.active = true; this.arrows.visible = true; this.beat = 0; ctx.fx.sfx('horn'); ctx.rumbleAll(0.3, 200); }
    } else if (this.phase === 'warn') {
      this.arrowMat.opacity = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.t * 14));
      this.beat += dt; if (this.beat > 0.7) { this.beat = 0; ctx.fx.sfx('horn'); }
      if (this.t >= P.tele) {
        if (!armed) { this.end(now); return; }                         // a warning that ends unarmed does nothing
        this.setPhase('surge', now); ctx.fx.sfx('whoosh', { vol: 1.4 }); ctx.fx.sfx('rumble'); ctx.cam.shake(0.45); ctx.rumbleAll(0.7, 400);
      }
    } else if (this.phase === 'surge') {
      // ease in over 0.3 s and out over the last 0.4 s
      this.k = Math.min(1, this.t / 0.3, Math.max(0, (P.dur - this.t) / 0.4));
      this.arrowMat.opacity = 0.8;
      for (const p of ctx.living()) {
        const l = ctx.frame.toLocal(p.position); const a = P.acc * this.k * (0.55 + 0.45 * this.cfg.near(l.x, l.z));
        p.body?.applyImpulse({ x: this.dirW.x * p.mass * a * dt, y: 0, z: this.dirW.z * p.mass * a * dt }, true);
      }
      // air streaming out: puffs carried toward the opening
      if (ctx.R.fx() < 0.9) {
        const pts = ctx.surface.points; const pt = pts[Math.floor(ctx.R.fx() * pts.length)];
        const w = ctx.frame.toWorld(pt[0], pt[2] + 0.3 + ctx.R.fx() * 1.2, pt[1]);
        ctx.fx.puff(w, { color: '#dfe8ff', v: [this.dirW.x * 9, 0.2, this.dirW.z * 9], size: 0.25, grow: 2.5, life: 0.7, a: 0.45 });
      }
      if (Math.floor(this.t * 3) !== Math.floor((this.t - dt) * 3)) ctx.cam.shake(0.12);
      if (this.t >= P.dur) this.end(now);
    }
  }
  end(now) { this.danger.active = false; this.arrows.visible = false; this.arrowMat.opacity = 0; this.k = 0; this.next = now + this.params().gap; this.setPhase('idle', now); }
  // debris and props get dragged too (lighter things fly; world-frame force)
  field(p, v, info) {
    if (this.phase !== 'surge' || !this.k) return [0, 0];
    const l = this.ctx.frame.toLocal(new this.ctx.THREE.Vector3(p.x, p.y, p.z));
    const a = this.params().acc * this.k * (0.55 + 0.45 * this.cfg.near(l.x, l.z)) * 0.8;
    return [this.dirW.x * info.mass * a, this.dirW.z * info.mass * a];
  }
  dispose() {
    dropDanger(this.ctx, this.danger); disposeObj(this.ctx.group, this.arrows); this.arrowGeo.dispose(); this.arrowMat.dispose();
    if (this.phase !== 'idle') this.cfg.onPhase?.('idle', this.ctx);
  }
}

export default {
  name: 'decompress', title: 'DECOMPRESSION', hint: 'Air rushes out of the open door · grab a rail and hold on',
  safeZones: (arena) => arena.hazardConfig?.decompress?.safe || [],
  create: (level, ctx) => new Decompress(level, ctx),
};
