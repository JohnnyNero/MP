// Arm stutter check: steps the game like a 60 Hz display (one tick + one view update per frame) and counts frames
// where an upper arm turns more than 25 degrees (snaps), ignoring knocked-out or long-airborne beans.
//   node tools/probes/arms.mjs [arena=kitchen]
import { openArena } from './common.mjs';
const A = await openArena(process.argv[2] || 'kitchen');
const res = await A.page.evaluate(() => {
  const THREE = window.__ctx.THREE; window.__skip(7);
  const ps = window.__players(), snaps = ps.map(() => 0), last = ps.map(() => null);
  for (let f = 0; f < 600; f++) {
    window.__tick(1 / 60, 16.7); window.__ctx.players.group.render(1 / 60);
    ps.forEach((p, i) => {
      if (p.isOut || p.bean.ko > 0 || p.bean.airT > 0.6) { last[i] = null; return; }
      const q = p.bean.armBones[0][0].getWorldQuaternion(new THREE.Quaternion());
      if (last[i] && last[i].angleTo(q) * 57.3 > 25) snaps[i]++; last[i] = q;
    });
  }
  return snaps;
});
console.log('arm snaps per bean in 10 s:', res.join(', '), A.errors.length ? 'ERRORS ' + A.errors.slice(0, 2) : '');
await A.close();
