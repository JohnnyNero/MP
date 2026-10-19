// Disaster registry. Each module: { name, title, hint, safeZones(arena), create(level, ctx) -> instance }.
// instance: { name, lvl, items, update(dt, now, armed), field?(p, v, info) -> [fx, fz], dispose(), log? }
import lightning from './lightning.js';
import meteor from './meteor.js';
import flood from './flood.js';
import stampede from './stampede.js';
import stomp from './stomp.js';
export const HAZARDS = { lightning, meteor, flood, stampede, stomp };
