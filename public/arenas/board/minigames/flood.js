// Flood: the sea comes in over the whole map. Get aboard the thing that floats (the place's place.flood: the cove's
// wreck) before the water reaches you; then waves roll over it trying to wash everyone off. In the water too long and
// you're out. The place supplies: place.flood = { level, deckSpot(i) -> [x, z, y] (world, current pose), focus() },
// hazardConfig.flood (the waves), and its own floating (it watches ctx.water).
export default {
  id: 'flood', title: 'FLOOD!', hint: 'Get on the ship before the water reaches you', kind: 'survive', time: 26,
  create(api) {
    const { ctx, place } = api, F = place.flood, W = ctx.water;
    const RISE = { start: 0, end: 8 }, WAVES = 6.5;
    let waves = null;
    W.rate = 1.2;
    return {
      wet: 2.0,
      goal: (p) => F.deckSpot(p.index),
      update(dt, t) {
        if (t >= RISE.start) W.setTarget(place.water.base + (F.level - place.water.base) * Math.min(1, (t - RISE.start) / (RISE.end - RISE.start)));
        if (t >= WAVES && !waves) { waves = api.hazards.flood.create(0, ctx); ctx.hazards.push(waves); api.fx.sfx('horn'); }
        if (waves) { waves.cfg.baseY = W.level; waves.lvl = t < 14 ? 0 : t < 20 ? 1 : 2; }
        if (t >= 0 && Math.floor(t * 2) !== Math.floor((t - dt) * 2) && t < RISE.end) api.fx.sfx('roll', { vol: 0.6 });
      },
      focus: () => F.focus(),
      dispose() { W.rate = place.water.rate ?? 0.6; if (waves) { const j = ctx.hazards.indexOf(waves); if (j >= 0) ctx.hazards.splice(j, 1); waves.dispose(); } },
    };
  },
};
