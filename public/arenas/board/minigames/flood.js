// Flood: the sea comes in over the whole map. Get aboard the thing that floats (the place's place.flood: the cove's
// wreck) before the water reaches you; then waves roll over it trying to wash everyone off. In the water too long and
// you're out. The place supplies: place.flood = { level, floatAt, deckSpot(i) -> [x, z, y] (world, current pose), focus() },
// hazardConfig.flood (the waves), and its own floating (it watches ctx.water).
// the level where the floating thing lifts off (place.flood.floatAt), or a little above dry land
const L_KEEL = (place) => place.flood.floatAt ?? 0.15;

export default {
  id: 'flood', title: 'FLOOD!', hint: 'Get on the ship before the water reaches you', kind: 'survive', time: 28,
  create(api) {
    const { ctx, place } = api, F = place.flood, W = ctx.water;
    // the sea creeps up to the wreck's keel (it starts to float), then pours over the island; then the waves
    const KEEL = { t: 6, y: L_KEEL(place) }, TOP = { t: 12, y: F.level }, WAVES = 11;
    let waves = null;
    W.rate = 1.2;
    return {
      wet: 3.0,
      goal: (p) => F.deckSpot(p.index),
      update(dt, t) {
        if (t >= 0) W.setTarget(t < KEEL.t ? place.water.base + (KEEL.y - place.water.base) * t / KEEL.t : KEEL.y + (TOP.y - KEEL.y) * Math.min(1, (t - KEEL.t) / (TOP.t - KEEL.t)));
        if (t >= WAVES && !waves) { waves = api.hazards.flood.create(0, ctx); ctx.hazards.push(waves); api.fx.sfx('horn'); }
        if (waves) { waves.cfg.baseY = W.level; waves.lvl = t < 14 ? 0 : t < 20 ? 1 : 2; }
        if (t >= 0 && Math.floor(t * 2) !== Math.floor((t - dt) * 2) && t < TOP.t) api.fx.sfx('roll', { vol: 0.6 });
      },
      focus: () => F.focus(),
      dispose() { W.rate = place.water.rate ?? 0.6; if (waves) { const j = ctx.hazards.indexOf(waves); if (j >= 0) ctx.hazards.splice(j, 1); waves.dispose(); } },
    };
  },
};
