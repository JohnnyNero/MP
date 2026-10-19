// Flood (ported from the ship's rogue waves): a foam wall rises on one side (telegraph: wall + arrows + rumble),
// then a surge sweeps across the arena along one axis pushing players and debris; each surge steps the water up,
// capped per level so high ground always stays dry. The arena owns the water itself (ctx.water: level/target/raise).
// Config (arena.hazardConfig.flood), defaults = the ship:
//   { title, hint, safe, axis: 'z'|'x', sides: [1, -1], across: { c, len }, teleFrom, frontStart, frontEnd, baseY,
//     levels: [{ gap, h, speed, cap }] x3, riseStep, firstSurgeRises, hitH, arrows: [across positions], arrowsAt,
//     shelter(local) -> bool (surges skip these players), push (surge shove, default 20), onSurge(it, ctx), colors: { body, foam } }
import { dropDanger } from './common.js';

const SHIP = {
  axis: 'z', sides: [1, -1], across: { c: 0.5, len: 18 }, teleFrom: 12, frontStart: 3.6, frontEnd: 4.4, baseY: 0,
  levels: [{ gap: 7.5, h: 0.55, speed: 5, cap: 0.3 }, { gap: 6.0, h: 0.75, speed: 5.6, cap: 0.42 }, { gap: 4.8, h: 0.9, speed: 6.4, cap: 0.5 }],
  riseStep: 0.1, firstSurgeRises: false, hitH: 0.7, arrows: [-5, -3, -1, 1, 3], arrowsAt: 2.3, colors: { body: '#2a8a9c', foam: '#f2fbff' },
};

class Flood {
  constructor(lvl, ctx) {
    this.name = 'flood'; this.lvl = lvl; this.ctx = ctx; this.cfg = { ...SHIP, ...ctx.cfg('flood') }; this.items = []; this.next = 0; this.started = false; this.count = 0;
    const sides = this.cfg.sides; this.sideIdx = Math.floor(ctx.R.hazard() * sides.length); this.lastSide = sides[this.sideIdx];
    const THREE = ctx.THREE;
    this.bodyMat = new THREE.MeshStandardMaterial({ color: this.cfg.colors.body, transparent: true, opacity: 0.82, roughness: 0.2, depthWrite: false });
    this.foamMat = new THREE.MeshStandardMaterial({ color: this.cfg.colors.foam, roughness: 0.6, transparent: true, opacity: 0.95 });
    ctx.dangers.push(this.waterDanger = { kind: 'water', level: ctx.water ? ctx.water.target : 0 });
  }
  params() { return this.cfg.levels[Math.min(2, this.lvl)]; }
  along(l) { return this.cfg.axis === 'z' ? l.z : l.x; }
  place(o, s, y, acrossOff = 0) { const c = this.cfg.across.c + acrossOff; if (this.cfg.axis === 'z') o.position.set(c, y, s); else o.position.set(s, y, c); }
  spawn() {
    const { ctx, cfg } = this; const THREE = ctx.THREE;
    if (this.items.length >= 2) return;
    const P = this.params();
    // never the same side twice in a row (one-sided arenas always use their single side)
    this.sideIdx = (this.sideIdx + 1) % cfg.sides.length; const side = cfg.sides[this.sideIdx]; this.lastSide = side;
    const g = new THREE.Group(); if (cfg.axis === 'x') g.rotation.y = Math.PI / 2;
    const inner = new THREE.Group(); g.add(inner);
    const body = new THREE.Mesh(new THREE.BoxGeometry(cfg.across.len, 1, 1.4), this.bodyMat); body.position.y = 0.5; inner.add(body);
    const foam = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, cfg.across.len - 1, 4, 10), this.foamMat); foam.rotation.z = Math.PI / 2; foam.position.y = 1.0; inner.add(foam);
    this.place(g, side * cfg.teleFrom, cfg.baseY - 1.5); ctx.group.add(g);
    const arrows = [];
    for (const a of cfg.arrows) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 3), new THREE.MeshBasicMaterial({ color: '#ff5a3c', transparent: true, opacity: 0.9, toneMapped: false }));
      if (cfg.axis === 'z') { m.rotation.x = -side * Math.PI / 2; m.rotation.order = 'XZY'; } else m.rotation.z = side * Math.PI / 2;
      this.place(m, side * cfg.arrowsAt, (cfg.arrowY ?? cfg.baseY) + 0.12, a); ctx.group.add(m); arrows.push(m);
    }
    const it = { side, g, body, foam, arrows, t: 0, tele: cfg.tele ?? 1.6, phase: 'tele', h: P.h, front: side * cfg.frontStart, hitSet: new Set(), railHit: false };
    ctx.dangers.push(it.danger = { kind: 'high', bonus: 3, side, h: P.h });
    this.items.push(it); ctx.fx.sfx('rumble'); ctx.cam.shake(0.2); ctx.rumbleAll(0.5, 600);
  }
  update(dt, now, armed) {
    const { ctx, cfg } = this; const P = this.params();
    if (!this.started) { this.started = true; this.next = now; }
    if (now >= this.next) { this.spawn(); this.next = now + P.gap * (0.85 + ctx.R.hazard() * 0.3); }
    if (ctx.water) this.waterDanger.level = ctx.water.target;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt;
      if (it.phase === 'tele') {
        const k = Math.min(1, it.t / it.tele);
        this.place(it.g, it.side * (cfg.teleFrom - (cfg.teleFrom - cfg.frontStart - 0.2) * k), cfg.baseY - 1.6 + k * 1.6); it.g.scale.set(1, 0.4 + k * (it.h + 0.2), 1);
        for (const a of it.arrows) a.material.opacity = 0.5 + 0.5 * Math.sin(it.t * 18);
        if (k >= 1) {
          if (!armed) { this.remove(it); this.items.splice(i, 1); continue; }
          it.phase = 'run'; ctx.fx.sfx('splash'); ctx.cam.shake(0.35);
          if ((this.count++ >= 1 || cfg.firstSurgeRises) && ctx.water) ctx.water.raise(cfg.riseStep, P.cap);
          for (const a of it.arrows) { ctx.group.remove(a); a.geometry.dispose(); a.material.dispose(); } it.arrows = [];
        }
        continue;
      }
      // surge across the arena, in the local frame (rides a moving arena)
      it.front -= it.side * P.speed * dt;
      this.place(it.g, it.front + it.side * 0.7, cfg.baseY, 0); it.g.scale.set(0.95, it.h, 1);
      if (ctx.R.fx() < dt * 40) {
        const a = (ctx.R.fx() - 0.5) * cfg.across.len * 0.8 + cfg.across.c; const pw = cfg.axis === 'z' ? ctx.frame.toWorld(a, cfg.baseY + it.h, it.front) : ctx.frame.toWorld(it.front, cfg.baseY + it.h, a);
        const pd = cfg.axis === 'z' ? [0, 1.5, -it.side * 2] : [-it.side * 2, 1.5, 0];
        ctx.fx.puff(pw, { color: cfg.colors.foam, v: pd, size: 0.4, grow: 1.5, life: 0.6, a: 0.8, g: 4 });
      }
      if (armed) {
        const dirW = cfg.axis === 'z' ? ctx.frame.dirToWorld(0, -it.side) : ctx.frame.dirToWorld(-it.side, 0);
        for (const p of ctx.living()) {
          const l = ctx.frame.toLocal(p.position);
          if (cfg.shelter?.(l)) continue;
          const behind = (this.along(l) - it.front) * it.side;                 // >0: the surge has reached them
          if (behind < -0.3 || behind > 1.6 || l.y > cfg.baseY + it.h + 0.05) continue;
          const k = cfg.push ?? 20; p.body?.applyImpulse({ x: dirW.x * p.mass * k * dt, y: p.mass * 4 * dt, z: dirW.z * p.mass * k * dt }, true);
          if (!it.hitSet.has(p.index) && it.h >= cfg.hitH) { it.hitSet.add(p.index); ctx.hitPlayer(p, dirW.clone().multiplyScalar(p.mass * 2.5).setY(p.mass * 2), 0.6, 1, 'wave'); }
        }
        cfg.onSurge?.(it, ctx);
      }
      if (it.front * it.side < -cfg.frontEnd) { this.remove(it); this.items.splice(i, 1); }
    }
  }
  field(p, v, info) {
    // extra push on debris inside a surge (called from the runner's water field)
    let fx = 0, fz = 0; const { ctx, cfg } = this;
    for (const it of this.items) {
      if (it.phase !== 'run') continue; const l = ctx.frame.toLocal(p); const behind = (this.along(l) - it.front) * it.side;
      if (behind < -0.3 || behind > 1.6 || l.y > cfg.baseY + it.h + 0.1) continue;
      const d = cfg.axis === 'z' ? ctx.frame.dirToWorld(0, -it.side) : ctx.frame.dirToWorld(-it.side, 0); fx += d.x * info.mass * 14; fz += d.z * info.mass * 14;
    }
    return [fx, fz];
  }
  remove(it) { this.ctx.group.remove(it.g); it.body.geometry.dispose(); it.foam.geometry.dispose(); for (const a of it.arrows) { this.ctx.group.remove(a); a.geometry.dispose(); a.material.dispose(); } dropDanger(this.ctx, it.danger); }
  dispose() { for (const it of this.items) this.remove(it); this.items = []; dropDanger(this.ctx, this.waterDanger); this.bodyMat.dispose(); this.foamMat.dispose(); }
}

export default {
  name: 'flood', title: 'ROGUE WAVES', hint: 'Get to high ground · jump the surge',
  safeZones: (arena) => arena.hazardConfig?.flood?.safe || [],
  create: (level, ctx) => new Flood(level, ctx),
};
