// Generic arena bots: score the arena's walkable points (floor present, away from edges and hole rims, away from
// hazard dangers, dry and high when water is a threat), walk there, route around obstacles, hop small gaps, never
// walk off a drop. Between dodges they play: grab a nearby prop and throw it at someone, grab a nearby player and
// drag them to a drop (or into a telegraph) and throw them, and climb back up when they end up hanging off a ledge.
// Survival comes first: any telegraph on or near them cancels the mischief (they drop what they hold and flee).
// Knocked or blasted past an edge, they reach for the lip on the way down and climb back.
// They write the same { x, y, jump, grab, aim } controller a human does.
//
// ctx (built by run.js each step): { points, hints, dangers, toLocal, toWorld, dirToWorld, cameraBasis, waterHeight,
//   hasFloor(worldPos), blocked(pos, dir), others: [[x, z], ...], grabbables() -> [{ rb, x, z, y, mass, held }], players() }
// points: arena walkable points [x, z, y, tag] in the arena's local frame.
// hints (arena.botHints): { edgeDist(x, z), route(from, to) -> [x, z, y] | null, obstacles: [{ x0, x1, z0, z1 }], prefer(pt, ctx) -> bonus }
// dangers (pushed by hazards): { kind: 'circle', x, z, r } | { kind: 'lane', axis: 'x'|'z', c, hw } |
//   { kind: 'water', level } (stay where the floor is no deeper than ~0.1 under level) | { kind: 'high', bonus } (prefer height) |
//   { kind: 'prefer', tag, bonus } (e.g. lightning: shelter points) |
//   { kind: 'wind', dir: [dx, dz], holdTag, active } (decompression: stay away from the opening, hold on at holdTag
//   points; hints.holdDir(pt) -> [dx, dz] says which way the handhold is from such a point)
// player (kit player interface + ragdoll extras when present): position, grounded, stun, hanging, holding, heldBy, hangDir()
const segRect = (ax, az, bx, bz, r) => {
  // does segment a->b cross the rect (Liang-Barsky)?
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, q] of [[-dx, ax - r.x0], [dx, r.x1 - ax], [-dz, az - r.z0], [dz, r.z1 - az]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 < t1;
};
export function inDangerAt(d, x, z, pad = 0) {
  if (d.kind === 'circle') return Math.hypot(x - d.x, z - d.z) < d.r + pad;
  if (d.kind === 'lane') return Math.abs((d.axis === 'x' ? z : x) - d.c) < d.hw + pad;
  return false;
}
const NONE = () => ({ x: 0, y: 0, jump: false, grab: false, aim: 0 });

export function createBot(rng, { mischief = 1 } = {}) {
  let target = null, retarget = 0, jumpHold = 0, stuckT = 0, lastPos = null, lastDangerKey = '', airT = 0;
  // play state: roam (dodge + reposition) | fetch (walk to a prop) | carry (take it to someone, throw) | attack (grab a player) | drag (to a drop, throw)
  let mode = 'roam', modeT = 0, actionCd = 5 + rng() * 5, prop = null, prey = null, dropGoal = null, throwT = -1, lastMode = 'roam';
  const stats = { fetch: 0, carry: 0, attack: 0, drag: 0, throws: 0, climbs: 0 };
  function setMode(m) { if (m !== mode) { lastMode = mode; mode = m; modeT = 0; throwT = -1; if (m in stats) stats[m]++; } }
  function route(from, to, ctx) {
    const h = ctx.hints || {};
    const r = h.route?.(from, to); if (r) return r;
    for (const ob of h.obstacles || []) {
      const m = 0.55, e = { x0: ob.x0 - m, x1: ob.x1 + m, z0: ob.z0 - m, z1: ob.z1 + m };
      if (!segRect(from[0], from[1], to[0], to[1], e)) continue;
      let best = null, bd = 1e9;
      for (const [cx, cz] of [[e.x0 - 0.05, e.z0 - 0.05], [e.x1 + 0.05, e.z0 - 0.05], [e.x0 - 0.05, e.z1 + 0.05], [e.x1 + 0.05, e.z1 + 0.05]]) {
        if ((h.edgeDist?.(cx, cz) ?? 9) < 0.6) continue;
        if (segRect(from[0], from[1], cx, cz, { x0: e.x0 + 0.1, x1: e.x1 - 0.1, z0: e.z0 + 0.1, z1: e.z1 - 0.1 })) continue;
        const d = Math.hypot(cx - from[0], cz - from[1]) + Math.hypot(to[0] - cx, to[1] - cz); if (d < bd) { bd = d; best = [cx, cz, to[2]]; }
      }
      if (best) return best;
    }
    return to;
  }
  function score(pt, me, ctx) {
    const [x, z, y] = pt;
    const w = ctx.toWorld(x, y, z);
    if (!ctx.hasFloor(w)) return -100;
    let s = 0;
    for (const [ox, oz] of [[0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) if (!ctx.hasFloor(ctx.toWorld(x + ox, y, z + oz))) s -= 3;   // clear of hole rims
    const e = ctx.hints?.edgeDist?.(x, z) ?? 9; if (e < 1.8) s -= (1.8 - e) * 7;                                                     // and of drops
    s += Math.min(1.6, w.y - ctx.waterHeight(w.x, w.z)) * 3;                                                                       // dry and high
    for (const d of ctx.dangers) {
      if (d.kind === 'circle') { const dd = Math.hypot(x - d.x, z - d.z); if (dd < d.r + 0.9) s -= 12 * (1 - dd / (d.r + 0.9)) + 4; }
      else if (d.kind === 'lane') {
        const a = (d.axis === 'x' ? z : x) - d.c, b = (d.axis === 'x' ? me[1] : me[0]) - d.c; const dd = Math.abs(a);
        if (dd < d.hw + 0.8) s -= 14 - dd * 3;
        else if (Math.sign(a) !== Math.sign(b) && Math.abs(b) > d.hw) s -= 6;                // don't cross a live lane to get there
      }
      else if (d.kind === 'water') { if (y < d.level - 0.12) s -= 10; s += Math.min(1, Math.max(0, y)) * 2; }   // drowning starts 0.3 deep: keep a margin
      else if (d.kind === 'high') s += Math.min(1.2, y) * (d.bonus ?? 3);
      else if (d.kind === 'prefer' && pt[3] === d.tag) s += d.bonus ?? 3;
      else if (d.kind === 'wind') { s -= (x * d.dir[0] + z * d.dir[1]) * 0.7; if (pt[3] === d.holdTag) s += d.active ? 9 : 1.5; }
    }
    s += ctx.hints?.prefer?.(pt, ctx) ?? 0;
    for (const o of ctx.others) if (o !== me && Math.hypot(x - o[0], z - o[1]) < 1.3) s -= 1.5;
    s -= Math.hypot(x - me[0], z - me[1]) * 0.12 + rng() * 0.8;
    return s;
  }
  const dangerAt = (ctx, x, z, pad) => ctx.dangers.some((d) => inDangerAt(d, x, z, pad));
  // walk toward a local goal: camera-relative stick, never off a drop, hop gaps and low obstacles
  function steer(goal, player, me, ctx, stopD = 0.35, speed = 1) {
    const inp = NONE();
    const dx = goal[0] - me.x, dz = goal[1] - me.z, d = Math.hypot(dx, dz);
    let edgeStop = false;
    if (d > stopD) {
      const wd = ctx.dirToWorld(dx / d, dz / d); const cb = ctx.cameraBasis();
      let k = Math.min(1, d / 0.8) * speed;
      const P = player.position;
      const at = (s) => ({ x: P.x + wd.x * s, y: P.y, z: P.z + wd.z * s });
      const loc = (s) => ctx.toLocal(at(s));
      const a1 = at(0.75), far = at(2.0);
      const edgeAhead = (ctx.hints?.edgeDist?.(loc(0.55).x, loc(0.55).z) ?? 9) < 0.3;
      nearEdge = (ctx.hints?.edgeDist?.(me.x, me.z) ?? 9) < 1.1;                                 // no hopping next to a rail: a ragdoll's hop clears it
      if (edgeAhead) { k = 0; edgeStop = true; }                                              // never step off a drop
      else if (player.grounded && (!ctx.hasFloor(a1) || ctx.blocked(P, wd))) {
        if ((ctx.hasFloor(far) || ctx.blocked(P, wd)) && !nearEdge) jumpHold = 0.2;            // hop a gap or a low obstacle
        else { k = 0; retarget = Math.min(retarget, 0.2); }                                     // a gap with nothing beyond: pick another spot
      } else if (player.grounded && !ctx.hasFloor(at(1.3))) k *= 0.6;                           // slow before a gap so the hop lands
      inp.x = (wd.x * cb.rx + wd.z * cb.rz) * k; inp.y = (wd.x * cb.fx + wd.z * cb.fz) * k;
    }
    if (lastPos && player.grounded && d > 0.6 && !edgeStop) { stuckT = Math.hypot(player.position.x - lastPos.x, player.position.z - lastPos.z) < dt0 * 0.6 ? stuckT + dt0 : 0; if (stuckT > 0.8) { if (!nearEdge) jumpHold = 0.2; stuckT = 0; retarget = 0; } }
    lastPos = { x: player.position.x, z: player.position.z };
    return { inp, d, edgeStop };
  }
  let dt0 = 1 / 60, nearEdge = false;
  const localOf = (ctx, p) => ctx.toLocal(p.position);
  // where to throw a captive: the nearest drop (just past the edge-safe points) or a live telegraph
  function pickDrop(me, ctx) {
    const circles = ctx.dangers.filter((d) => d.kind === 'circle' && Math.hypot(d.x - me.x, d.z - me.z) < 5);
    if (circles.length && rng() < 0.4) { const c = circles[Math.floor(rng() * circles.length)]; return { goal: [c.x, c.z, me.y], kind: 'danger' }; }
    const ed = ctx.hints?.edgeDist; if (!ed) return null;
    let best = null, bs = 1e9;
    for (const pt of ctx.points) { const dd = Math.hypot(pt[0] - me.x, pt[1] - me.z); if (dd > 6 || Math.abs(pt[2] - me.y) > 0.6) continue; const s = ed(pt[0], pt[1]) + dd * 0.3; if (s < bs) { bs = s; best = pt; } }
    if (!best) return null;
    const e = 0.2, gx = (ed(best[0] + e, best[1]) - ed(best[0] - e, best[1])) / (2 * e), gz = (ed(best[0], best[1] + e) - ed(best[0], best[1] - e)) / (2 * e);
    const gl = Math.hypot(gx, gz) || 1;
    return { goal: [best[0] - gx / gl * 1.6, best[1] - gz / gl * 1.6, best[2]], kind: 'edge' };
  }
  function nearestPlayer(player, me, ctx, maxD) {
    let best = null, bd = maxD;
    for (const o of ctx.players?.() || []) {
      if (o === player || o.isOut) continue; const l = localOf(ctx, o); const dd = Math.hypot(l.x - me.x, l.z - me.z);
      if (dd < bd && Math.abs(l.y - me.y) < 0.8) { bd = dd; best = o; }
    }
    return best;
  }
  return {
    get target() { return target; }, get mode() { return mode; }, stats,
    think(dt, player, ctx) {
      dt0 = dt;
      const me = ctx.toLocal(player.position); const mePt = [me.x, me.z, me.y];
      retarget -= dt; modeT += dt; actionCd -= dt; airT = player.grounded ? 0 : airT + dt;
      // hanging off a ledge: look up, keep the grip, pull toward the ledge -> the character mantles over
      if (player.hanging) {
        const dir = player.hangDir?.(); const out = NONE(); out.grab = true; out.aim = 1;
        if (dir) { const cb = ctx.cameraBasis(); out.x = (dir.x * cb.rx + dir.z * cb.rz) * 0.8; out.y = (dir.x * cb.fx + dir.z * cb.fz) * 0.8; }
        if (mode !== 'climb') { setMode('climb'); stats.climbs++; }
        return out;
      }
      if (mode === 'climb') setMode('roam');
      if (player.stun > 0) { if (mode !== 'roam') setMode('roam'); return NONE(); }
      // falling with nothing below to land on: reach up for the lip, steering back toward the nearest floor
      if (!player.grounded && airT > 0.15 && (player.velocity?.y ?? 0) < -1 && ctx.floorBelow && !ctx.floorBelow(player.position, 2.0)) {
        let best = null, bd = 1e9;
        for (const pt of ctx.points) { if (pt[2] < me.y - 2.5) continue; const dd = Math.hypot(pt[0] - me.x, pt[1] - me.z); if (dd < bd) { bd = dd; best = pt; } }
        const out = NONE(); out.grab = true; out.aim = 0.9;
        if (best && bd > 0.05) { const wd = ctx.dirToWorld((best[0] - me.x) / bd, (best[1] - me.z) / bd), cb = ctx.cameraBasis(); out.x = wd.x * cb.rx + wd.z * cb.rz; out.y = wd.x * cb.fx + wd.z * cb.fz; }
        if (mode !== 'roam') setMode('roam');
        if (!stats.catches) stats.catches = 0; if (airT < 0.17 + dt) stats.catches++;
        return out;
      }
      const key = ctx.dangers.map((d) => d.kind + (d.x ?? d.c ?? d.level ?? '')).join('|'); const changed = key !== lastDangerKey; lastDangerKey = key;
      const inDanger = dangerAt(ctx, me.x, me.z, 0.6);
      // decompression: at a handhold, face it and grip until the surge has passed
      const wind = ctx.dangers.find((d) => d.kind === 'wind' && d.active);
      if (wind) {
        if (mode !== 'roam') setMode('roam');
        if (player.grounded && target && target[3] === wind.holdTag && Math.hypot(target[0] - me.x, target[1] - me.z) < 1.1) {
          const hd = ctx.hints?.holdDir?.(target) || [-wind.dir[0], -wind.dir[1]];
          const wd = ctx.dirToWorld(hd[0], hd[1]), cb = ctx.cameraBasis(), out = NONE();
          out.x = (wd.x * cb.rx + wd.z * cb.rz) * 0.35; out.y = (wd.x * cb.fx + wd.z * cb.fz) * 0.35; out.grab = true; out.aim = 0.15;
          return out;
        }
      }
      // survival first: drop everything and flee
      if (inDanger && mode !== 'roam') { setMode('roam'); actionCd = Math.max(actionCd, 1.5); }
      const holding = player.holding || null;
      // ---- mischief
      if (mode === 'roam' && !inDanger && !wind && actionCd <= 0 && player.grounded && !holding && mischief > 0 && (ctx.phase?.() ?? 'active') === 'active') {   // no mischief before GO
        actionCd = 2.5 + rng() * 3;
        const roll = rng();
        if (roll < 0.4 * mischief) {
          let best = null, bd = 4.5;
          for (const g of ctx.grabbables?.() || []) { if (g.held || Math.abs(g.y - me.y) > 1.0 || dangerAt(ctx, g.x, g.z, 0.5) || (ctx.hints?.edgeDist?.(g.x, g.z) ?? 9) < 0.6) continue; const dd = Math.hypot(g.x - me.x, g.z - me.z); if (dd < bd) { bd = dd; best = g; } }
          if (best) { prop = best.rb; setMode('fetch'); }
        } else if (roll < 0.6 * mischief) {
          const o = nearestPlayer(player, me, ctx, 3.0);
          if (o && !o.hanging && o.stun <= 0) { prey = o; setMode('attack'); }
        }
      }
      if (mode === 'fetch') {
        const g = (ctx.grabbables?.() || []).find((q) => q.rb === prop);
        if (holding === 'prop') setMode('carry');
        else if (!g || g.held || modeT > 5) { setMode('roam'); actionCd = 3 + rng() * 3; }
        else {
          const { inp, d } = steer([g.x, g.z, g.y], player, me, ctx, 0.42, 0.8);
          const dy = g.y - me.y; inp.aim = dy < 0.4 ? -0.85 : dy > 0.9 ? 0.6 : -0.2; inp.grab = d < 1.15;
          return finish(inp);
        }
      }
      if (mode === 'carry' || mode === 'drag') {
        const want = mode === 'carry' ? 'prop' : 'bean';
        if (holding !== want && throwT < 0) { setMode('roam'); actionCd = 4 + rng() * 4; }
        else if (throwT >= 0) {                                   // wind-up: look up, then let go = throw along the facing
          throwT += dt; const inp = NONE(); inp.aim = 1; inp.grab = throwT < 0.42;
          if (!inp.grab) { stats.throws++; setMode('roam'); actionCd = 8 + rng() * 6; }
          return finish(inp);
        } else if (mode === 'carry') {
          const o = nearestPlayer(player, me, ctx, 8);
          if (!o || modeT > 6) { throwT = 0; return finish({ ...NONE(), grab: true, aim: 1 }); }
          const l = localOf(ctx, o); const dd = Math.hypot(l.x - me.x, l.z - me.z);
          const { inp } = steer([l.x, l.z, l.y], player, me, ctx, 0.3, dd > 3 ? 0.9 : 0.4);
          inp.grab = true; inp.aim = 0.2;
          if (dd < 3 && modeT > 0.5) throwT = 0;
          return finish(inp);
        } else {
          if (!dropGoal) dropGoal = pickDrop(me, ctx);
          if (!dropGoal || modeT > 4) { throwT = 0; return finish({ ...NONE(), grab: true, aim: 1 }); }
          const { inp, d, edgeStop } = steer(dropGoal.goal, player, me, ctx, 0.4, 0.85);
          inp.grab = true; inp.aim = 0.15;
          const ed = ctx.hints?.edgeDist?.(me.x, me.z) ?? 9;
          if (edgeStop || d < 0.5 || (dropGoal.kind === 'edge' && ed < 0.9)) throwT = 0;
          return finish(inp);
        }
      }
      if (mode === 'attack') {
        if (holding === 'bean') { dropGoal = null; setMode('drag'); return finish({ ...NONE(), grab: true, aim: 0.15 }); }
        if (!prey || prey.isOut || prey.hanging || modeT > 4 || dangerAt(ctx, me.x, me.z, 0.6)) { setMode('roam'); actionCd = 3 + rng() * 3; }
        else {
          const l = localOf(ctx, prey);
          const { inp, d } = steer([l.x, l.z, l.y], player, me, ctx, 0.3, 1);
          inp.grab = d < 1.0; inp.aim = 0.05;
          return finish(inp);
        }
      }
      // ---- roam: pick the best safe spot and go there
      if (!target || retarget <= 0 || changed || (inDanger && retarget < 0.6) || (wind && target[3] !== wind.holdTag && retarget > 0.3)) {
        let best = null, bs = -1e9;
        for (const pt of ctx.points) { const s = score(pt, mePt, ctx); if (s > bs) { bs = s; best = pt; } }
        target = best; retarget = 1.2 + rng() * 1.8;
      }
      if (!target) return NONE();
      const goal = route(mePt, target, ctx);
      const { inp } = steer(goal, player, me, ctx);
      // held by someone: wriggle and hop
      if (player.heldBy > 0 && rng() < dt * 3) jumpHold = 0.2;
      return finish(inp);
    },
  };
  function finish(inp) {
    if (jumpHold > 0) { jumpHold -= dt0; inp.jump = jumpHold > 0.08; }
    return inp;
  }
}
