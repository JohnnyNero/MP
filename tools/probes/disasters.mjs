// How deadly is each disaster? Four bots, N rounds per disaster per arena; prints eliminations and causes.
//   node tools/probes/disasters.mjs [arena,...] [rounds=2]
import { openArena, playRound, ARENAS } from './common.mjs';
const arenas = (process.argv[2] || Object.keys(ARENAS).join(',')).split(','), reps = +(process.argv[3] || 2);
let failed = false;
for (const arena of arenas) {
  const A = await openArena(arena);
  for (const d of ARENAS[arena]) {
    let outs = 0; const causes = {}, first = [];
    for (let r = 0; r < reps; r++) { const res = await playRound(A.page, d); outs += res.elims.length; for (const e of res.elims) causes[e.cause] = (causes[e.cause] || 0) + 1; if (res.elims[0]) first.push(res.elims[0].time.toFixed(0)); }
    console.log(`${arena.padEnd(8)} ${d.padEnd(11)} out ${outs}/${4 * reps}  ${JSON.stringify(causes)}  first out at ${first.join(', ') || '-'} s`);
  }
  if (A.errors.length) { failed = true; console.log(arena, 'ERRORS', A.errors.slice(0, 3)); }
  await A.close();
}
process.exit(failed ? 1 : 0);
