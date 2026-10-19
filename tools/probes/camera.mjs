// Camera quality: steps the game like a 60 Hz TV (one tick + one view update per frame, no drawing) for a stretch
// of active play and reports how the shared camera behaves:
//   jitter    mean frame-to-frame change in camera velocity (mm/frame^2) outside screen shake: wobble the eye notices
//   cutoff    % of frames where a player on the arena (or hanging on its edge) is off screen; cutAny counts everyone
//   tight     % of frames where some player is inside the outer 7% of the screen
//   danger    % of telegraph-frames whose telegraph centre is off screen
//   bean      average on-screen bean height in px at 1080p (readability on a TV)
//   node tools/probes/camera.mjs [arena,...] [seconds=45]
import { openArena, ARENAS } from './common.mjs';
const arenas = (process.argv[2] || Object.keys(ARENAS).join(',')).split(','), secs = +(process.argv[3] || 45);
for (const arena of arenas) {
  const A = await openArena(arena, '&seed=7', { width: 1920, height: 1080 });
  const r = await A.page.evaluate((secs) => {
    const THREE = window.__ctx.THREE, cam = window.__ctx.camera;
    while (window.__ctx.round.phase !== 'active') { window.__tick(1 / 60, 16.7); window.__view(1 / 60); }
    const P = [], v = new THREE.Vector3();
    let jit = 0, jn = 0, cut = 0, cutAny = 0, tight = 0, dTot = 0, dOff = 0, bean = 0, bn = 0, frames = 0;
    for (let f = 0; f < secs * 60 && window.__ctx.round.phase === 'active'; f++) {
      window.__tick(1 / 60, 16.7); window.__view(1 / 60); frames++;
      P.push(cam.position.clone()); if (P.length > 3) P.shift();
      if (P.length === 3 && window.__cam.trauma <= 0) { jit += P[2].clone().sub(P[1]).sub(P[1].clone().sub(P[0])).length() * 1000; jn++; }
      let c = false, ca = false, t = false;
      for (const p of window.__ctx.living()) {
        const l = window.__ctx.frame.toLocal(p.position.clone()), main = p.hanging || window.__ctx.surface.inBounds(l.x, l.z);
        const feet = v.copy(p.position).project(cam), fx = feet.x, fy = feet.y;
        const head = v.copy(p.position).setY(p.position.y + 1.15).project(cam);
        for (const [x, y] of [[fx, fy], [head.x, head.y]]) { if (Math.abs(x) > 1 || Math.abs(y) > 1) { ca = true; if (main) { c = true; } } else if (main && (Math.abs(x) > 0.86 || Math.abs(y) > 0.86)) t = true; }
        bean += Math.abs(head.y - fy) * 540; bn++;
      }
      cut += c; cutAny += ca; tight += t;
      for (const d of window.__ctx.dangers) {
        if (d.kind !== 'circle') continue; dTot++;
        const q = window.__ctx.frame.toWorld(d.x, 0, d.z).project(cam); if (Math.abs(q.x) > 0.97 || Math.abs(q.y) > 0.97) dOff++;
      }
    }
    return { frames, jitter: +(jit / jn).toFixed(2), cutoff: +(100 * cut / frames).toFixed(1), cutAny: +(100 * cutAny / frames).toFixed(1), tight: +(100 * tight / frames).toFixed(1), danger: dTot ? +(100 * dOff / dTot).toFixed(1) : null, bean: +(bean / bn).toFixed(0), disaster: window.__round.disaster };
  }, secs);
  console.log(`${arena.padEnd(8)} ${JSON.stringify(r)}${A.errors.length ? ' ERRORS ' + A.errors.slice(0, 2) : ''}`);
  await A.close();
}
