// Minigames: called between turns, played where everyone stands, scored by placement (board/rules.js gameCoins).
// A minigame module:
//   { id, title, hint, kind: 'survive' | 'score', time (seconds after GO),
//     create(api) -> { goal?(p) -> [x, z, y] | null   (where bots head; null = the arena bot dodges and roams)
//                      update?(dt, t)                  (t < 0 during the announcement, when players can already move)
//                      armed?(t) -> bool               (hazards may hurt; default t >= 0)
//                      score?(i), scoreText?(i)        (score games)
//                      wet?: seconds in the water before you're out (survive) or washed back (score)
//                      focus?() -> [Vector3]           (extra camera points)
//                      dispose?() } }
// api (from board/mode.js): { THREE, ctx, eng, place, L, fx, hud, cam, rng, out(p, cause), respawn(p), popup(pos, text, color),
//   node(id) -> waypoint, hazards: HAZARDS }
// A place lists the minigames it supports (place.minigames) and may reskin titles (place.minigameSkins[id]).
import hill from './hill.js';
import flood from './flood.js';
import cannon from './cannon.js';

export const MINIGAMES = { hill, flood, cannon };
