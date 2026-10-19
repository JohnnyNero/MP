// Cannon fire: cannonballs rain down on the map from the place's guns (the meteor hazard, reskinned by the place's
// hazardConfig.meteor). Every landing spot is shown first. Get hit and you're out; it gets faster.
export default {
  id: 'cannon', title: 'CANNON FIRE!', hint: 'Watch for the shadows · get hit and you\'re out', kind: 'survive', time: 22,
  create(api) {
    const { ctx } = api;
    const h = api.hazards.meteor.create(0, ctx); ctx.hazards.push(h);
    let seen = ctx.hits.length; const pending = new Map();
    return {
      wet: 2.5,
      update(dt, t) {
        h.lvl = t < 7 ? 0 : t < 14 ? 1 : 2;
        // a cannonball hit is a knockout: they fly first, then they're out
        for (; seen < ctx.hits.length; seen++) { const e = ctx.hits[seen]; if (!pending.has(e.i)) pending.set(e.i, 0.7); }
        for (const [i, left] of pending) { const p = ctx.players[i]; if (!p || p.isOut) { pending.delete(i); continue; } if (left - dt <= 0) { pending.delete(i); api.out(p, 'hit'); } else pending.set(i, left - dt); }
      },
      dispose() { const j = ctx.hazards.indexOf(h); if (j >= 0) ctx.hazards.splice(j, 1); h.dispose(); },
    };
  },
};
