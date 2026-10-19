// Small helpers shared by hazard modules.
export const dropDanger = (ctx, d) => { if (!d) return; const j = ctx.dangers.indexOf(d); if (j >= 0) ctx.dangers.splice(j, 1); };
export const disposeObj = (parent, o) => { if (!o) return; parent.remove(o); o.traverse?.((q) => { q.geometry?.dispose(); if (q.material && !q.material.userData?.shared) q.material.dispose(); }); };
export const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
// walkable points the hazard may target: arena points minus those near a living player (snapshot) and near busy spots
export function freePoints(ctx, { awayFromPlayers = 1.3, busy = [], spacing = 2.6, last = null, filter = null } = {}) {
  const pts = ctx.surface.points.filter((pt) => !filter || filter(pt));
  return pts.filter(([x, z, y]) => {
    for (const p of ctx.living()) { const l = ctx.frame.toLocal(p.position); if (Math.hypot(l.x - x, l.z - z) < awayFromPlayers && Math.abs(l.y - y) < 1.2) return false; }
    for (const b of busy) if (Math.hypot(b.x - x, b.z - z) < spacing) return false;
    if (last && last[0] === x && last[1] === z) return false;
    return ctx.surface.hasFloor(ctx.frame.toWorld(x, y, z));
  });
}
// smouldering / crumbling: a few seconds of damage on chunks near a spot, with smoke (lightning, meteors)
export function createEmbers(ctx) {
  const list = [];
  return {
    add(wp, r, dur) { list.push({ chunks: ctx.chunksNear(wp, r), t: 0, dur }); },
    update(dt) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i]; e.t += dt; if (e.t > e.dur) { list.splice(i, 1); continue; }
        for (const ch of e.chunks) {
          if (!ch.alive || !ch.mesh) continue;
          ctx.D.damageChunk(ch, (ch.matName === 'hull' ? 9 : 16) * dt, null, null, { refracture: false });
          if (ctx.R.fx() < dt * 5) { const m = ch.mesh.matrix.elements; ctx.fx.puff(new ctx.THREE.Vector3(m[12], m[13] + 0.1, m[14]), { color: ctx.R.fx() < 0.3 ? '#ff9a3a' : '#5a5560', v: [(ctx.R.fx() - 0.5) * 0.3, 1.2, (ctx.R.fx() - 0.5) * 0.3], size: 0.3, grow: 3, life: 1.6, a: 0.55 }); }
        }
      }
    },
    clear() { list.length = 0; },
  };
}
// knock every living player inside radius r of wp outward (xz) with a falloff; returns how many were hit
export function blast(ctx, wp, r, { out = 260, up = 300, stun = 1.0, immune = 1.5, src = 'blast', rumble = 1, falloff = true } = {}) {
  const V = ctx.THREE.Vector3; let n = 0;
  for (const p of ctx.living()) {
    const d = Math.hypot(p.position.x - wp.x, p.position.z - wp.z); if (d > r || Math.abs(p.position.y - wp.y) > 2.2) continue;
    const dir = new V(p.position.x - wp.x, 0, p.position.z - wp.z); if (dir.lengthSq() < 1e-4) dir.set(ctx.R.fx() - 0.5, 0, ctx.R.fx() - 0.5); dir.normalize();
    const f = falloff ? 1.2 - d / r : 1;
    if (ctx.hitPlayer(p, dir.multiplyScalar(out * f).setY(up), stun, immune, src)) { n++; ctx.rumble(p.index, rumble, 350); }
  }
  return n;
}
