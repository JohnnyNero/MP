// Stampede (new): a lane lights up across the arena with arrows, dust, a horn and rumble (telegraph >= 1.5 s), then a
// charge of runners (rolling giant fruit, wind-up toys...) barrels along it: kinematic bodies that shove anything
// loose, chip fragile chunks, and knock players out of the lane. Escalates with more lanes at once (never all of
// them, so an empty lane always exists) and faster charges. Lanes never repeat back to back.
// Config (arena.hazardConfig.stampede):
//   { title, hint, safe, axis: 'x'|'z', lanes: [{ c, hw }], span: [min, max] along the axis (runners enter/leave beyond it),
//     makeRunner(ctx, rng, laneIndex) -> { obj: Object3D, r }, heightAt(x, z) (defaults to ctx.surface.heightAt), levels,
//     knockSide(laneC, playerC) -> +1|-1 (which way a hit player is thrown across the lane; default: away from the lane centre),
//     alongPush (scale of the shove along the lane, default 1) }
import { dropDanger } from './common.js';

const RUNNER_GROUPS = 0x8000ffff, PLAYER_GROUPS = 0xffff7fff;   // (membership << 16) | filter
const LEVELS = [{ gap: 5.2, lanes: 1, speed: 6.5, tele: 2.0, n: 3 }, { gap: 4.4, lanes: 2, speed: 8.0, tele: 1.8, n: 3 }, { gap: 3.8, lanes: 3, speed: 9.5, tele: 1.6, n: 4 }];

class Stampede {
  constructor(lvl, ctx) {
    this.name = 'stampede'; this.lvl = lvl; this.ctx = ctx; this.cfg = { axis: 'x', span: [-9, 9], levels: LEVELS, ...ctx.cfg('stampede') };
    this.items = []; this.next = 0; this.started = false; this.lastLanes = []; this.log = [];
    const THREE = ctx.THREE;
    this.stripMat = new THREE.MeshBasicMaterial({ color: '#ff4a2a', transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.arrowGeo = new THREE.ConeGeometry(0.32, 0.8, 3); this.arrowGeo.rotateZ(-Math.PI / 2);   // points along +x
  }
  params() { return this.cfg.levels[Math.min(2, this.lvl)]; }
  local(s, c, y) { return this.cfg.axis === 'x' ? new this.ctx.THREE.Vector3(s, y, c) : new this.ctx.THREE.Vector3(c, y, s); }
  heightAt(x, z) { return (this.cfg.heightAt || this.ctx.surface.heightAt)(x, z); }
  spawn(now) {
    const { ctx, cfg } = this; const THREE = ctx.THREE; const R = ctx.R; const P = this.params();
    const busy = new Set(this.items.map((it) => it.lane));
    const nLanes = Math.max(1, Math.min(P.lanes, cfg.lanes.length - 1 - busy.size));
    // candidates: not running now, not used in the previous charge (no repeats)
    let cand = cfg.lanes.map((_, i) => i).filter((i) => !busy.has(i) && !this.lastLanes.includes(i));
    if (!cand.length) cand = cfg.lanes.map((_, i) => i).filter((i) => !busy.has(i));
    const chosen = [];
    while (chosen.length < nLanes && cand.length) { const j = Math.floor(R.hazard() * cand.length); chosen.push(cand[j]); cand.splice(j, 1); }
    if (busy.size + chosen.length >= cfg.lanes.length) chosen.length = Math.max(0, cfg.lanes.length - 1 - busy.size);   // an empty lane always exists
    if (!chosen.length) return;
    this.lastLanes = chosen;
    for (const li of chosen) {
      const lane = cfg.lanes[li]; const dir = R.hazard() < 0.5 ? 1 : -1;
      const len = cfg.span[1] - cfg.span[0] + 2, mid = (cfg.span[0] + cfg.span[1]) / 2;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, lane.hw * 2), this.stripMat.clone());
      strip.rotation.x = -Math.PI / 2; if (cfg.axis === 'z') strip.rotation.z = Math.PI / 2;
      strip.position.copy(this.local(mid, lane.c, (lane.y ?? 0) + 0.04)); strip.renderOrder = 3; ctx.group.add(strip);
      const arrows = [];
      for (let s = cfg.span[0]; s <= cfg.span[1]; s += 1.6) {
        const a = new THREE.Mesh(this.arrowGeo, new THREE.MeshBasicMaterial({ color: '#ffe14a', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
        a.rotation.y = cfg.axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2); a.renderOrder = 4; a.userData.s = s;
        ctx.group.add(a); arrows.push(a);
      }
      const it = { lane: li, c: lane.c, hw: lane.hw, dir, strip, arrows, t: 0, T: Math.max(1.5, P.tele), phase: 'tele', runners: [], speed: P.speed, n: P.n, hitSet: new Set(), dmgClock: 0, born: now };
      ctx.dangers.push(it.danger = { kind: 'lane', axis: cfg.axis, c: lane.c, hw: lane.hw + 0.2 });
      this.items.push(it); this.log.push({ t: now, kind: 'tele', lane: li, dir, T: it.T });
    }
    ctx.fx.sfx('horn'); ctx.fx.sfx('rumble'); ctx.rumbleAll(0.45, 900); ctx.cam.shake(0.15);
  }
  startCharge(it) {
    const { ctx, cfg } = this; const RAPIER = ctx.RAPIER;
    it.phase = 'run'; it.t = 0; this.log.push({ t: ctx.now(), kind: 'charge', lane: it.lane });
    for (const p of ctx.players) p.collider?.setCollisionGroups(PLAYER_GROUPS);
    const entry = it.dir > 0 ? cfg.span[0] - 1.5 : cfg.span[1] + 1.5;
    for (let k = 0; k < it.n; k++) {
      const sk = cfg.makeRunner ? cfg.makeRunner(ctx, ctx.R.fx, it.lane, k) : this.defaultRunner();
      const s = entry - it.dir * k * (sk.r * 2 + 0.9);
      const off = (ctx.R.fx() - 0.5) * Math.max(0, it.hw - sk.r) * 1.2;
      const y = this.heightAt(...this.xz(s, it.c + off)) + sk.r;
      const w = ctx.frame.toWorld(...this.local(s, it.c + off, y).toArray());
      const body = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(w.x, w.y, w.z));
      // runners shove objects physically, but players only through the scripted knock (a kinematic shove on a stunned
      // player carries them metres): runners are in group bit 15, players stop colliding with that bit
      ctx.world.createCollider(RAPIER.ColliderDesc.ball(sk.r).setFriction(0.4).setRestitution(0.2).setCollisionGroups(RUNNER_GROUPS), body);
      ctx.scene.add(sk.obj);
      it.runners.push({ obj: sk.obj, r: sk.r, s, off, y, body, roll: 0 });
    }
    ctx.fx.sfx('roll'); ctx.cam.shake(0.3);
  }
  xz(s, c) { return this.cfg.axis === 'x' ? [s, c] : [c, s]; }
  defaultRunner() {
    const THREE = this.ctx.THREE; const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), new THREE.MeshStandardMaterial({ color: '#f08a24', roughness: 0.6 }));
    m.castShadow = true; return { obj: m, r: 0.7 };
  }
  update(dt, now, armed) {
    const { ctx, cfg } = this; const THREE = ctx.THREE; const P = this.params();
    if (!this.started) { this.started = true; this.next = now; }
    if (now >= this.next) { this.spawn(now); this.next = now + P.gap * (0.85 + ctx.R.hazard() * 0.3); }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt;
      if (it.phase === 'tele') {
        const k = it.t / it.T; const pulse = 0.5 + 0.5 * Math.sin(it.t * (8 + 14 * k));
        it.strip.material.opacity = 0.14 + 0.22 * pulse + 0.12 * k;
        for (const a of it.arrows) {
          const s = cfg.span[0] + (((a.userData.s - cfg.span[0]) + it.dir * it.t * 3.2) % (cfg.span[1] - cfg.span[0]) + (cfg.span[1] - cfg.span[0])) % (cfg.span[1] - cfg.span[0]);
          const [x, z] = this.xz(s, it.c); a.position.copy(this.local(s, it.c, this.heightAt(x, z) + 0.14)); a.material.opacity = 0.55 + 0.45 * pulse;
        }
        // dust kicked up at the entry side
        if (ctx.R.fx() < dt * 14) { const se = it.dir > 0 ? cfg.span[0] - 0.5 : cfg.span[1] + 0.5; ctx.fx.puff(ctx.frame.toWorld(...this.local(se, it.c + (ctx.R.fx() - 0.5) * it.hw * 2, 0.3).toArray()), { color: '#d8c4a0', v: [it.dir * 1.2, 1.2, 0], size: 0.6, grow: 2.5, life: 1.0, a: 0.6 }); }
        if (it.t >= it.T) {
          if (!armed) { this.remove(it); this.items.splice(i, 1); continue; }
          for (const a of it.arrows) { ctx.group.remove(a); a.material.dispose(); } it.arrows = [];
          this.startCharge(it);
        }
        continue;
      }
      // charge
      it.strip.material.opacity = 0.18;
      let allGone = true; it.dmgClock += dt; const doDmg = it.dmgClock >= 0.1; if (doDmg) it.dmgClock = 0;
      for (const rn of it.runners) {
        rn.s += it.dir * it.speed * dt;
        const [x, z] = this.xz(rn.s, it.c + rn.off);
        const onArena = rn.s > cfg.span[0] - 1 && rn.s < cfg.span[1] + 1;
        const want = onArena ? this.heightAt(x, z) + rn.r : rn.y - 9 * dt * 2;   // roll over raised parts, drop off the ends
        rn.y += (want - rn.y) * Math.min(1, dt * (want > rn.y ? 14 : 8));
        const w = ctx.frame.toWorld(...this.local(rn.s, it.c + rn.off, rn.y).toArray());
        rn.body.setNextKinematicTranslation({ x: w.x, y: w.y, z: w.z });
        rn.obj.position.copy(w); rn.roll += it.speed * dt / rn.r;
        if (cfg.axis === 'x') rn.obj.rotation.set(0, 0, -it.dir * rn.roll); else rn.obj.rotation.set(it.dir * rn.roll, 0, 0);
        if (it.dir > 0 ? rn.s < cfg.span[1] + 3 : rn.s > cfg.span[0] - 3) allGone = false;
        if (!armed || !onArena) continue;
        if (doDmg) ctx.D.damageSphere(w, rn.r + 0.2, 7, 2.5);
        if (ctx.R.fx() < dt * 10) ctx.fx.puff(ctx.frame.toWorld(...this.local(rn.s - it.dir * rn.r, it.c + rn.off, rn.y - rn.r + 0.1).toArray()), { color: '#e6d6b8', v: [-it.dir * 0.8, 0.8, 0], size: 0.4, grow: 2, life: 0.7, a: 0.5 });
        for (const p of ctx.living()) {
          const l = ctx.frame.toLocal(p.position);
          const [la, lc] = cfg.axis === 'x' ? [l.x, l.z] : [l.z, l.x];
          if (Math.hypot(la - rn.s, lc - (it.c + rn.off)) > rn.r + 0.4 || l.y > rn.y + rn.r || l.y < rn.y - rn.r - 1.2) continue;
          const side = cfg.knockSide ? cfg.knockSide(it.c, lc) : (Math.sign(lc - it.c) || 1);   // out of the lane (arenas can pick the safe side)
          const ak = cfg.alongPush ?? 1;                                                     // arenas with a drop at the lane ends can soften the shove along it
          const dl = cfg.axis === 'x' ? [it.dir * 150 * ak, side * 110] : [side * 110, it.dir * 150 * ak];
          const dw = ctx.frame.dirToWorld(dl[0], dl[1]).multiplyScalar(Math.hypot(dl[0], dl[1]));
          if (ctx.hitPlayer(p, new THREE.Vector3(dw.x, 280, dw.z), 1.0, 1.2, 'stampede')) { ctx.rumble(p.index, 1, 350); it.hitSet.add(p.index); this.log.push({ t: now, kind: 'hit', player: p.index }); ctx.fx.sfx('crash'); }
        }
      }
      if (allGone) { this.remove(it); this.items.splice(i, 1); }
    }
  }
  remove(it) {
    const { ctx } = this;
    ctx.group.remove(it.strip); it.strip.geometry.dispose(); it.strip.material.dispose();
    for (const a of it.arrows) { ctx.group.remove(a); a.material.dispose(); }
    for (const rn of it.runners) { ctx.scene.remove(rn.obj); try { ctx.world.removeRigidBody(rn.body); } catch { /* world freed */ } }
    it.runners = []; dropDanger(ctx, it.danger);
  }
  dispose() { for (const it of this.items) this.remove(it); this.items = []; this.stripMat.dispose(); this.arrowGeo.dispose(); }
}

export default {
  name: 'stampede', title: 'STAMPEDE', hint: 'Watch the glowing lane · get out of the way',
  safeZones: (arena) => arena.hazardConfig?.stampede?.safe || [],
  create: (level, ctx) => new Stampede(level, ctx),
};
