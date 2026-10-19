// Board probe: four bots play whole games and report what tuning needs: how often a bot ends its walk on the space it
// was going for (the rest were shoved, thrown or fell), falls off the table, seconds on the hill per game, stars
// bought, time spent per phase, and bean height on a 1080p screen during walks and the hill game.
//   python3 -m http.server -d public 4180 &   node tools/probes/board.mjs [seeds e.g. 1,2,3] [turns]
import { openArena } from './common.mjs';
const seeds = (process.argv[2] || '1,2,3').split(',');
const turns = +(process.argv[3] || 9);
let failed = false;
for (const seed of seeds) {
  const A = await openArena('board', `&seed=${seed}&turns=${turns}`, { width: 1920, height: 1080 });
  const out = await A.page.evaluate(() => {
    const st = { hit: 0, miss: 0, px: [], phases: {}, t: 0 };
    let lastPh = '', goals = null;
    const V = new window.__ctx.THREE.Vector3();
    for (let k = 0; k < 9000; k++) {
      window.__skip(0.1); st.t += 0.1;
      const r = window.__round;
      if (r.phase !== lastPh) {
        if (r.phase === 'walk') goals = r.goals.slice();
        if (r.phase === 'land' && goals) r.at.forEach((a, i) => { if (a === goals[i]) st.hit++; else st.miss++; });
        lastPh = r.phase;
      }
      st.phases[r.phase] = (st.phases[r.phase] || 0) + 0.1;
      if ((r.phase === 'walk' || r.phase === 'hill') && k % 10 === 0) {           // bean height: feet to head top, on screen
        window.__view(1 / 60); const cam = window.__ctx.camera;
        for (const p of window.__players()) { if (p.isOut || p.stun > 0) continue; const h = p.head; V.set(h.x, h.y + 0.25, h.z).project(cam); const y1 = V.y; V.copy(p.position).project(cam); st.px.push(Math.round((y1 - V.y) / 2 * 1080)); }
      }
      if (r.phase === 'results') break;
    }
    const g = window.__board(), px = st.px.filter((v) => v > 0).sort((a, b) => a - b), q = (f) => px[Math.floor(px.length * f)];
    return { done: !!window.__round.results, minutes: +(st.t / 60).toFixed(1), onGoal: `${st.hit}/${st.hit + st.miss}`, beanPx: { p10: q(0.1), median: q(0.5), p90: q(0.9) },
      falls: g.log.filter((l) => l.fall != null).length, hillSecs: g.log.filter((l) => l.game).map((l) => l.secs.join('/')), stars: g.stars, coins: g.coins,
      phases: Object.fromEntries(Object.entries(st.phases).map(([k, v]) => [k, Math.round(v)])) };
  });
  console.log(`seed ${seed}: ${JSON.stringify(out)}${A.errors.length ? ' ERRORS ' + JSON.stringify(A.errors.slice(0, 3)) : ''}`);
  failed ||= !out.done || A.errors.length > 0;
  await A.close();
}
process.exit(failed ? 1 : 0);
