// Lightning storm (ported from the ship): a glowing circle telegraphs on a snapshot of a player's position
// (never the same player twice in a row), then strikes: damage + knock + embers. Optional "rods" (tall things the
// arena exposes, e.g. ship masts) get struck instead sometimes; the arena's rod.strike() decides what breaks.
// Config (arena.hazardConfig.lightning): { safe: [zones], shelterTag, rods(ctx) -> [{ x, z, top, fallDir, standing, strike(ctx) }], rodChance }
import { dropDanger, createEmbers } from './common.js';

class Lightning {
  constructor(lvl, ctx) { this.name = 'lightning'; this.lvl = lvl; this.ctx = ctx; this.cfg = ctx.cfg('lightning'); this.items = []; this.next = 0; this.lastPick = -1; this.started = false; this.embers = createEmbers(ctx);
    if (this.cfg.shelterTag) ctx.dangers.push(this.prefer = { kind: 'prefer', tag: this.cfg.shelterTag, bonus: 3 }); }
  params() { return [{ gap: 3.3, n: 1, tele: 1.45 }, { gap: 2.5, n: 1, tele: 1.3 }, { gap: 1.8, n: 2, tele: 1.15 }][Math.min(2, this.lvl)]; }
  schedule(now, first) { const P = this.params(); this.next = now + (first ? 0 : P.gap * (0.75 + this.ctx.R.hazard() * 0.5)); }
  spawn() {
    const { ctx } = this; const P = this.params(); const THREE = ctx.THREE; const R = ctx.R;
    for (let k = 0; k < P.n; k++) {
      if (this.items.length >= 3) return;
      const rods = (this.cfg.rods?.(ctx) || []).filter((m) => m.standing && !this.items.some((it) => it.rod === m));
      let it = null;
      if (rods.length && (this.forceRod || R.hazard() < (this.cfg.rodChance ?? 0.38))) {
        this.forceRod = false;
        const m = rods[Math.floor(R.hazard() * rods.length)];
        const base = new THREE.Vector3(m.x, 0, m.z);
        const tele = ctx.fx.circleTele(ctx.group, base, 1.3);
        const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.9, m.top), new THREE.MeshBasicMaterial({ color: '#ff4a2a', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
        strip.rotation.x = -Math.PI / 2; strip.position.set(m.x, 0.06, m.z + m.fallDir * m.top / 2); ctx.group.add(strip);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), new THREE.MeshBasicMaterial({ color: '#bcd4ff', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
        glow.position.set(m.x, m.top, m.z); ctx.group.add(glow);
        it = { rod: m, local: base, tele, extra: [strip, glow], t: 0, T: Math.max(1.5, P.tele), r: 1.3 };
        ctx.dangers.push(it.danger = { kind: 'circle', x: m.x, z: m.z, r: 1.3 }, it.danger2 = { kind: 'circle', x: m.x, z: m.z + m.fallDir * m.top * 0.55, r: m.top * 0.5 });
      } else {
        // snapshot of a player's position (skip empty slots, never the same pick twice in a row)
        const players = ctx.players; const alive = ctx.living(); if (!alive.length) return;
        let i = Math.floor(R.hazard() * players.length);
        for (let tries = 0; tries < players.length * 2 && (players[i].isOut || (i === this.lastPick && alive.length > 1)); tries++) i = (i + 1) % players.length;
        this.lastPick = i; const p = players[i];
        const hit = ctx.surface.castDown(p.position.x + (R.hazard() - 0.5) * 0.4, p.position.z + (R.hazard() - 0.5) * 0.4); if (!hit) continue;
        const local = ctx.frame.toLocal(hit.p);
        it = { local, tele: ctx.fx.circleTele(ctx.group, local, 1.25), extra: [], t: 0, T: P.tele, r: 1.25 };
        ctx.dangers.push(it.danger = { kind: 'circle', x: local.x, z: local.z, r: 1.25 });
      }
      this.items.push(it); ctx.fx.sfx('crackle'); ctx.rumbleAll(0.25, 150);
    }
  }
  update(dt, now, armed) {
    const { ctx } = this;
    if (!this.started) { this.started = true; this.schedule(now, true); }
    if (now >= this.next) { this.spawn(); this.schedule(now); }
    this.embers.update(dt);
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt; const k = it.t / it.T;
      const pulse = 0.55 + 0.45 * Math.sin(it.t * (10 + k * 22));
      it.tele.ring.material.opacity = 0.5 + 0.5 * pulse; it.tele.disc.material.opacity = 0.12 + 0.3 * k; it.tele.g.scale.setScalar(1.15 - 0.15 * k);
      if (it.extra[1]) it.extra[1].scale.setScalar(0.6 + pulse * 0.6);
      if (Math.floor(it.t * 7) !== Math.floor((it.t - dt) * 7)) ctx.fx.puff(ctx.frame.toWorld(it.local.x + (ctx.R.fx() - 0.5), it.local.y + 0.2, it.local.z + (ctx.R.fx() - 0.5)), { color: '#bcd4ff', v: [0, 1.5, 0], size: 0.15, grow: 1, life: 0.3, a: 0.9, add: true });
      if (it.t < it.T) continue;
      if (armed) this.strike(it);
      this.remove(it); this.items.splice(i, 1);
    }
  }
  strike(it) {
    const { ctx } = this; const THREE = ctx.THREE;
    ctx.fx.sfx('thunder'); ctx.cam.shake(0.5);
    if (it.rod) {
      const m = it.rod; const top = ctx.frame.toWorld(m.x, m.top, m.z); ctx.fx.bolt(top);
      if (m.strike?.(ctx)) this.embers.add(top, 1.0, 5);
      const base = ctx.frame.toWorld(m.x, 0, m.z);
      for (const p of ctx.living()) if (p.position.distanceTo(base) < 1.3) ctx.hitPlayer(p, new THREE.Vector3(0, 300, 0), 1.0, 2, 'rod');
      return;
    }
    const wp = ctx.frame.toWorld(it.local.x, it.local.y, it.local.z); ctx.fx.bolt(wp);
    ctx.D.damageSphere(wp, 1.0, 125, 3);
    this.embers.add(wp, 1.1, 4.5);
    for (const p of ctx.living()) {
      const d = p.position.distanceTo(wp); if (d > it.r + 0.25) continue;
      const out = p.position.clone().sub(wp).setY(0); if (out.lengthSq() < 1e-4) out.set(ctx.R.fx() - 0.5, 0, ctx.R.fx() - 0.5); out.normalize();
      if (ctx.hitPlayer(p, out.multiplyScalar(170).setY(300), 1.2, 2, 'bolt')) ctx.rumble(p.index, 1, 400);
    }
  }
  remove(it) { it.tele.dispose(); for (const o of it.extra) { this.ctx.group.remove(o); o.geometry.dispose(); o.material.dispose(); } dropDanger(this.ctx, it.danger); dropDanger(this.ctx, it.danger2); }
  dispose() { for (const it of this.items) this.remove(it); this.items = []; this.embers.clear(); dropDanger(this.ctx, this.prefer); }
}

export default {
  name: 'lightning', title: 'LIGHTNING STORM', hint: 'Dodge the glowing circles · find shelter',
  safeZones: (arena) => arena.hazardConfig?.lightning?.safe || [],
  create: (level, ctx) => new Lightning(level, ctx),
};
