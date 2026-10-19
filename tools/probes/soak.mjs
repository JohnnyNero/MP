// Smoke/soak: play N random rounds per arena with four bots and fail on any page error.
//   node tools/probes/soak.mjs [arena,...] [rounds=4]
import { openArena, playRound, ARENAS } from './common.mjs';
const arenas = (process.argv[2] || Object.keys(ARENAS).join(',')).split(','), n = +(process.argv[3] || 4);
let failed = false;
for (const arena of arenas) {
  const A = await openArena(arena); let outs = 0, surv = 0, mantles = 0;
  for (let r = 0; r < n; r++) { const res = await playRound(A.page); outs += res.elims.length; surv += res.survivors ?? 0; mantles += res.mantles; await A.page.evaluate(() => window.__playAgain()); }
  console.log(`${arena.padEnd(8)} ${n} rounds: ${outs} out, ${surv} survived, ${mantles} climbs back${A.errors.length ? '  ERRORS ' + JSON.stringify(A.errors.slice(0, 3)) : ''}`);
  failed ||= A.errors.length > 0; await A.close();
}
process.exit(failed ? 1 : 0);
