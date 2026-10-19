// CI smoke test: load every arena in headless Chrome, let four bots play 30 s, and fail on any page error or if the
// round never gets going; then play a turn and a minigame on each board. Runs after `npm run build` against the built site
// (see .github/workflows/deploy.yml).
//   python3 -m http.server -d dist 4180 &   CHROMIUM=$(command -v google-chrome) node tools/probes/smoke.mjs
import { openArena, ARENAS } from './common.mjs';
let failed = false;
for (const arena of Object.keys(ARENAS)) {
  const t0 = Date.now();
  let A;
  try { A = await openArena(arena); } catch (e) { console.log(`${arena}: FAILED TO LOAD ${e.message}`); failed = true; continue; }
  const r = await A.page.evaluate(() => { window.__skip(30); const R = window.__round; return { phase: R.phase, disaster: R.disaster, alive: R.alive.length }; });
  const ok = !A.errors.length && ['active', 'finish', 'results'].includes(r.phase);
  console.log(`${arena}: ${ok ? 'ok' : 'FAILED'} (${r.disaster}, ${r.phase}, ${r.alive} alive, ${((Date.now() - t0) / 1000).toFixed(0)} s)${A.errors.length ? ' ' + JSON.stringify(A.errors.slice(0, 3)) : ''}`);
  failed ||= !ok; await A.close();
}
// the boards: a turn and a minigame each, with four bots
for (const map of ['cove', 'board']) {
  const t0 = Date.now(); let A;
  try { A = await openArena(map, '&turns=2'); } catch (e) { console.log(`${map}: FAILED TO LOAD ${e.message}`); failed = true; continue; }
  const r = await A.page.evaluate(() => { const seen = new Set(); for (let k = 0; k < 120; k++) { window.__skip(0.5); seen.add(window.__round.phase); } const R = window.__round; return { phase: R.phase, turn: R.turn, coins: R.coins, phases: [...seen] }; });
  const ok = !A.errors.length && r.turn >= 2 && r.phases.includes('game');
  console.log(`${map}: ${ok ? 'ok' : 'FAILED'} (turn ${r.turn}, ${r.phase}, coins ${r.coins.join('/')}, ${((Date.now() - t0) / 1000).toFixed(0)} s)${A.errors.length ? ' ' + JSON.stringify(A.errors.slice(0, 3)) : ''}`);
  failed ||= !ok; await A.close();
}
process.exit(failed ? 1 : 0);
