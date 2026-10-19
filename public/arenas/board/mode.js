// The board game on top of the shared engine (kit/engine.js). A game is a number of turns; each turn:
//   roll  — a die hovers over every bean's head; jump to hit it (it tumbles for real, and can fall off the table)
//   walk  — the spaces each bean can reach light up with its pegs, an arrow marks where its roll ends; everyone walks
//           at once for a few seconds, shoving and grabbing
//   land  — wherever a bean stands when time is up is where it lands (the nearest space it was allowed to reach):
//           blue +3 coins, red −3, the star for 10 coins
// Every third turn ends with a game on the board itself (king of the hill: seconds spent on top of the tower). Falling off the table puts
// you back on your space, minus 3 coins. Most stars after the last turn wins, then coins.
//   runBoard(place)   (?turns=N for a shorter game, ?bots=all, ?seed=)
import * as THREE from 'three';
import { createEngine, COLORS } from '../kit/engine.js';
import { nextSeed } from '../kit/round.js';
import * as L from './layout.js';
import { RULES, walkWindow, settle, newGame, land, loseCoins, moveStar, hillAwards, standings, faceUp, botGoal } from './rules.js';

const T = { intro: 2.4, roll: 6, rollMax: 9.5, walk: 8, land: 2.6, hillIntro: 3.0, hill: 15, hillEnd: 2.6, back: 1.4 };
const GAME_EVERY = 3;
const ORD = ['1st', '2nd', '3rd', '4th'];

// ---------------------------------------------------------------- bot routing over the board's waypoint graph
const NODES = L.WAYPOINTS, IDX = new Map(NODES.map((n, k) => [n.id, k]));
const NEXT = (() => {                                     // next-hop table from every node to every node (Dijkstra)
  const adj = NODES.map(() => []);
  for (const [a, b, extra] of L.LINKS) { const i = IDX.get(a), j = IDX.get(b), d = Math.hypot(NODES[i].x - NODES[j].x, NODES[i].z - NODES[j].z, NODES[i].y - NODES[j].y) + extra; adj[i].push([j, d]); adj[j].push([i, d]); }
  return NODES.map((_, s) => {
    const dist = NODES.map(() => Infinity), first = NODES.map(() => -1), done = NODES.map(() => false); dist[s] = 0; first[s] = s;
    for (;;) {
      let u = -1; for (let k = 0; k < NODES.length; k++) if (!done[k] && dist[k] < Infinity && (u < 0 || dist[k] < dist[u])) u = k;
      if (u < 0) break; done[u] = true;
      for (const [v, d] of adj[u]) if (dist[u] + d < dist[v]) { dist[v] = dist[u] + d; first[v] = u === s ? v : first[u]; }
    }
    return first;
  });
})();
const nodeNear = (x, z, y) => { let best = 0, bd = Infinity; NODES.forEach((n, k) => { const d = Math.hypot(n.x - x, n.z - z) + 2 * Math.abs(n.y - y); if (d < bd) { bd = d; best = k; } }); return best; };
function route(from, to) {
  const [fx, fz, fy] = from, [tx, tz, ty] = to;
  if (Math.hypot(tx - fx, tz - fz) < 1.2 && Math.abs(ty - fy) < 0.5) return to;
  const a = nodeNear(fx, fz, fy), b = nodeNear(tx, tz, ty);
  if (a === b) return to;
  const n = NODES[NEXT[a][b]], na = NODES[a];
  // already past the nearest node (between it and the next one): head for the next one
  const toNext = Math.hypot(n.x - fx, n.z - fz), aToNext = Math.hypot(n.x - na.x, n.z - na.z);
  const tgt = toNext < aToNext + 0.3 || Math.hypot(na.x - fx, na.z - fz) < 0.5 ? n : na;
  return [tgt.x, tgt.z, tgt.y];
}

// ---------------------------------------------------------------- dice faces (+x 1, -x 6, +y 2, -y 5, +z 3, -z 4)
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function dieMaterials(color) {
  return [1, 6, 2, 5, 3, 4].map((v) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fffaf0'; g.beginPath(); g.roundRect(10, 10, 108, 108, 22); g.fill();
    g.fillStyle = '#2a1e30'; for (const [x, y] of PIPS[v]) { g.beginPath(); g.arc(64 + x * 30, 64 + y * 30, 12, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 });
  });
}
function badge(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill(); g.lineWidth = 8; g.strokeStyle = '#fffaf0'; g.stroke();
  g.fillStyle = '#fff'; g.font = '900 78px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.scale.setScalar(0.62); s.renderOrder = 12; return s;
}

export async function runBoard(place) {
  const Q = new URLSearchParams(location.search);
  const TURNS = Math.max(1, Math.min(30, +(Q.get('turns') || 10)));
  place.botHints = { ...(place.botHints || {}), route };
  const eng = await createEngine(place, { allBots: Q.get('bots') === 'all' });
  const { ctx, hud, cam, fx, input, scene } = eng; const RAPIER = ctx.RAPIER;
  const M = place.markers;
  const spaces = L.SPACES;
  const spacePos = (id, i = -1) => { const s = spaces[id]; const o = i < 0 ? [0, 0] : [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]][i]; return new THREE.Vector3(s.x + o[0], s.y + 0.9, s.z + o[1]); };

  let g = null, phase = 'boot', pt = 0;          // phase clock
  const roundView = { phase: 'idle', t: 0 };     // what bots see as ctx.round (mischief only while 'active')
  let dice = [], win = [], goals = [], secs = [0, 0, 0, 0], badges = [], botHit = [], lastLand = [], results = null;
  const living = () => ctx.living();
  let hillGames = 0;
  const hillSpawn = (i) => new THREE.Vector3(...L.HILL_SPAWNS[(i + hillGames) % 4]);     // who starts nearest a ramp rotates

  // ---------------------------------------------------------------- phases
  function setPhase(ph) {
    phase = ph; pt = 0; roundView.phase = ph === 'walk' || ph === 'hill' ? 'active' : ph; roundView.t = 0;
    const simT = eng.simT;
    if (ph === 'intro') { hud.wipe(false); hud.banner('THE BOARD', `${TURNS} turns · most stars wins`, T.intro, simT); fx.sfx('sting'); }
    if (ph === 'roll') { startRoll(); hud.banner('ROLL!', 'Jump to hit your die', 1.6, simT); fx.sfx('go'); }
    if (ph === 'walk') { startWalk(); hud.banner('GO!', 'Walk to your arrow', 1.0, simT); fx.sfx('go'); }
    if (ph === 'land') { doLand(); }
    if (ph === 'hillIntro') { hud.wipe(true); }
    if (ph === 'hill') { hud.banner('GO!', '', 0.8, simT); fx.sfx('go'); }
    if (ph === 'hillEnd') endHill();
    if (ph === 'back') { hud.wipe(true); }
    if (ph === 'results') showResults();
    tag(); eng.refreshChips();
  }
  function tag() {
    if (!g || phase === 'results') { hud.tag(null); return; }
    const hill = phase.startsWith('hill');
    const toGame = GAME_EVERY - ((g.turn - 1) % GAME_EVERY) - 1;
    hud.tag((hill ? 'KING OF THE HILL' : `TURN ${Math.min(g.turn, g.turns)} OF ${g.turns}`) + `<small>${hill ? 'Stay on top of the tower to score' : toGame === 0 ? 'King of the Hill after this turn' : `King of the Hill in ${toGame + 1} turns`}</small>`);
  }

  // ---- roll: a die over every head; jump to hit it
  function startRoll() {
    M.clear();
    for (const b of badges) if (b) scene.remove(b); badges = [];
    dice = ctx.players.map((p, i) => {
      if (p.isOut) return null;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), dieMaterials(p.color)); mesh.castShadow = true; scene.add(mesh);
      return { i, mesh, rb: null, state: 'hover', t: 0, still: 0, value: 0 };
    });
    botHit = ctx.players.map(() => 0.5 + ctx.R.bots() * 1.4);
  }
  function hitDie(d) {
    const p = ctx.players[d.i]; const pos = d.mesh.position;
    const rb = ctx.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setRotation(d.mesh.quaternion).setCcdEnabled(true));
    ctx.world.createCollider(RAPIER.ColliderDesc.cuboid(0.25, 0.25, 0.25).setDensity(25).setFriction(0.9).setRestitution(0.2), rb);
    rb.setLinearDamping(0.3); rb.setAngularDamping(0.4);
    // up and a little toward the middle of the board (a wild hit can still send it off the table)
    const r = ctx.R.arena, c = Math.hypot(pos.x, pos.z - 0.5) || 1;
    rb.setLinvel({ x: -pos.x / c * 0.7 + (r() - 0.5) * 1.0 + p.velocity.x * 0.3, y: 4.4 + r() * 1.0, z: -(pos.z - 0.5) / c * 0.7 + (r() - 0.5) * 1.0 + p.velocity.z * 0.3 }, true);
    rb.setAngvel({ x: (r() - 0.5) * 24, y: (r() - 0.5) * 24, z: (r() - 0.5) * 24 }, true);
    d.rb = rb; d.state = 'flying'; d.t = 0;
    fx.sfx('pop', { pitch: 0.8 }); input.rumble(d.i, 0.35, 90);
  }
  function readDie(d, off = false) {
    let v = 1;
    if (!off && d.rb) { const q = d.rb.rotation(); v = faceUp(2 * (q.x * q.y + q.w * q.z), 1 - 2 * (q.x * q.x + q.z * q.z), 2 * (q.y * q.z - q.w * q.x)); }
    d.value = v; d.state = 'done'; d.off = off;
    const p = ctx.players[d.i];
    if (d.rb) { ctx.world.removeRigidBody(d.rb); d.rb = null; }
    scene.remove(d.mesh); d.mesh.geometry.dispose(); for (const m of d.mesh.material) { m.map.dispose(); m.dispose(); }
    const b = badge(String(v), p.color); scene.add(b); badges[d.i] = b;
    if (off) popup(p.position, 'Off the table! 1', '#ff8a7a'); else fx.sfx('tick');
  }
  function updateDice(dt) {
    for (const d of dice) {
      if (!d || d.state === 'done') continue;
      const p = ctx.players[d.i];
      if (p.isOut) { readDie(d, true); continue; }
      d.t += dt;
      if (d.state === 'hover') {
        const h = p.head; d.mesh.position.set(h.x, h.y + 1.35 + 0.06 * Math.sin(eng.simT * 4 + d.i), h.z);
        d.mesh.rotation.y += dt * 2.5; d.mesh.rotation.x = 0.35;
        const jump = !!p.input?.jump, edge = jump && !d.jumpWas; d.jumpWas = jump;            // a jump press hits it
        if ((edge && d.t > 0.25) || pt >= T.roll) hitDie(d);
      } else {
        const t = d.rb.translation(), q = d.rb.rotation(); d.mesh.position.set(t.x, t.y, t.z); d.mesh.quaternion.set(q.x, q.y, q.z, q.w);
        const v = d.rb.linvel(), w = d.rb.angvel();
        d.still = Math.hypot(v.x, v.y, v.z) < 0.12 && Math.hypot(w.x, w.y, w.z) < 0.4 ? d.still + dt : 0;
        if (t.y < -1.5) readDie(d, true);
        else if (d.still > 0.35 || d.t > 4) readDie(d);
      }
    }
  }

  // ---- walk: pegs on reachable spaces, an arrow on the end; everyone walks at once
  function startWalk() {
    for (const p of ctx.players) {
      const i = p.index; const v = dice[i]?.value || 1;
      if (p.isOut) { win[i] = null; continue; }
      win[i] = walkWindow(spaces, g.at[i], v);
      M.show(i, [...win[i].passed, ...win[i].targets], win[i].targets);
      goals[i] = botGoal(g, spaces, i, win[i], ctx.R.bots);
    }
  }
  // ---- land: where you stand is where you are
  function doLand() {
    M.clear(); lastLand = [];
    for (const p of ctx.players) {
      if (p.isOut || !win[p.index]) continue;
      const i = p.index, id = settle(spaces, win[i].window, p.position);
      const out = land(g, i, id, spaces[id].kind); lastLand.push(out);
      if (out.star) { hud.banner(`P${i + 1} GOT A STAR!`, 'The star moves on', 2.4, eng.simT); fx.sfx('fanfare'); fx.burst(p.position, 24, { colors: ['#ffd04a', '#ffffff', p.color], speed: 3.5, up: 5, size: 0.4, life: 1.1, g: 6 }); M.star(moveStar(g, spaces, ctx.R.arena)); }
      else if (out.short) popup(p.position, `Star costs ${RULES.starCost}`, '#ffd04a');
      else if (out.coins) popup(p.position, (out.coins > 0 ? '+' : '') + out.coins + ' coins', out.coins > 0 ? '#7cf0a0' : '#ff8a7a');
      if (badges[i]) { scene.remove(badges[i]); badges[i] = null; }
    }
    if (!lastLand.some((o) => o.star)) fx.sfx(lastLand.some((o) => o.coins > 0) ? 'tick' : 'out');
  }
  function popup(pos, text, color) {
    const s = fx.labelSprite(text, color, 2.4); const y0 = pos.y + 2.1; s.position.set(pos.x, y0, pos.z);
    fx.addTimed([s], 1.6, { onUpdate: (k) => { s.position.y = y0 + k * 0.8; s.material.opacity = Math.min(1, (1 - k) * 3); } });
  }
  // ---- king of the hill
  function placeAll(points) { ctx.players.forEach((p, i) => { if (!p.isOut) { p.teleport(points(i)); p.body?.setLinvel?.({ x: 0, y: 0, z: 0 }, true); } }); cam.snap(); }
  function onHill(p) { const q = p.position, H = L.HILL; return !p.isOut && !p.hanging && q.x > H.x0 && q.x < H.x1 && q.z > H.z0 && q.z < H.z1 && q.y > H.y - 0.3; }
  function endHill() {
    M.hill(false);
    const aw = hillAwards(secs);
    for (const a of aw) { g.coins[a.i] += a.coins; popup(ctx.players[a.i].position, `+${a.coins} coins`, '#7cf0a0'); }
    const w = aw.filter((a) => a.coins === RULES.hillWin).map((a) => 'P' + (a.i + 1));
    hud.banner(w.length ? `${w.join(' & ')} ${w.length > 1 ? 'SHARE' : 'TAKES'} THE HILL!` : 'NOBODY HELD THE HILL', w.length ? `+${RULES.hillWin} coins` : '', T.hillEnd, eng.simT); fx.sfx('fanfare');
    g.log.push({ turn: g.turn, game: 'hill', secs: secs.map((s) => +s.toFixed(1)), awards: aw });
  }
  function nextTurn() { g.turn++; if (g.turn > g.turns) setPhase('results'); else setPhase('roll'); }

  // ---- results
  function showResults() {
    const st = standings(g); const top = st.filter((r) => r.place === 1);
    results = { title: top.length === 1 ? `P${top[0].i + 1} WINS THE BOARD!` : `${top.map((r) => 'P' + (r.i + 1)).join(' & ')} SHARE THE WIN!`,
      draw: false, survivors: top.map((r) => r.i), winners: top.map((r) => r.i),
      placements: st.map((r) => ({ i: r.i, place: r.place, status: `★ ${r.stars} · ${r.coins} coins` })), standings: st, log: g.log };
    window.__results = results;
    fx.sfx('fanfare'); M.clear(); M.hill(false);
    pendingCard = 1.2;
  }
  let pendingCard = 0;

  // ---------------------------------------------------------------- new game
  function newBoardGame() {
    eng.buildWorld();
    ctx.round = roundView;
    g = newGame({ players: ctx.players.length, turns: TURNS });
    g.starAt = moveStar(g, spaces, ctx.R.arena); M.star(g.starAt); M.clear(); M.hill(false);
    dice = []; win = []; goals = []; secs = [0, 0, 0, 0]; badges = []; results = null; pendingCard = 0; hillGames = 0;
    hud.hideResults(); cam.snap(); setPhase('intro');
  }
  function playAgain() { if (phase !== 'results') return; eng.seed = nextSeed(eng.seed); newBoardGame(); }
  hud.onAgain(() => playAgain());

  // ---------------------------------------------------------------- the engine mode
  const OK_KEYS = ['Enter', 'Space', 'NumpadEnter'];
  const mode = {
    tick(dt) {
      pt += dt; roundView.t = pt;
      if (phase === 'intro' && pt >= T.intro) setPhase('roll');
      else if (phase === 'roll') { if ((dice.length && dice.every((d) => !d || d.state === 'done') && pt > 1.2) || pt >= T.rollMax) { for (const d of dice) if (d && d.state !== 'done') readDie(d); setPhase('walk'); } }
      else if (phase === 'walk' && pt >= T.walk) setPhase('land');
      else if (phase === 'land' && pt >= T.land) { if (g.turn % GAME_EVERY === 0) setPhase('hillIntro'); else nextTurn(); }
      else if (phase === 'hillIntro') {
        if (pt >= 0.6 && !mode._placed) { mode._placed = true; secs = [0, 0, 0, 0]; hillGames++; placeAll((i) => hillSpawn(i)); hud.wipe(false); M.hill(true); hud.banner('KING OF THE HILL', 'Stay on top of the tower to score', 2.2, eng.simT); fx.sfx('sting'); }
        if (pt >= T.hillIntro) { mode._placed = false; setPhase('hill'); }
      } else if (phase === 'hill') {
        for (const p of living()) if (onHill(p)) secs[p.index] += dt;
        if (Math.floor(pt * 4) !== Math.floor((pt - dt) * 4)) eng.refreshChips();
        if (pt >= T.hill) setPhase('hillEnd');
      } else if (phase === 'hillEnd' && pt >= T.hillEnd) setPhase('back');
      else if (phase === 'back') {
        if (pt >= 0.6 && !mode._placed) { mode._placed = true; placeAll((i) => spacePos(g.at[i], i)); hud.wipe(false); }
        if (pt >= T.back) { mode._placed = false; nextTurn(); }
      }
      if (pendingCard > 0) { pendingCard -= dt; if (pendingCard <= 0) hud.showResults(results, { colors: COLORS, isHuman: (i) => input.isHuman(i) }); }
    },
    input(edges) {
      if (phase !== 'results' || pendingCard > 0) return false;
      if (edges.some((e) => e.button === 0) || OK_KEYS.some((c) => input.keyEdge.has(c))) { playAgain(); return true; }
      return false;
    },
    playerState() {
      const frozen = phase === 'intro' || phase === 'results' || ((phase === 'hillIntro' || phase === 'back') && pt < 0.9);
      return { locked: frozen, invulnerable: phase === 'results' || phase === 'hillIntro' || phase === 'back', bot: phase === 'walk' || phase === 'hill' || phase === 'land' || phase === 'roll' };
    },
    botThink(p, dt, botCtx) {
      if (phase === 'roll') { const d = dice[p.index]; return { x: 0, y: 0, jump: !!d && d.state === 'hover' && pt > botHit[p.index] && pt < botHit[p.index] + 0.2, grab: false, aim: 0 }; }
      botCtx.goal = (pl) => {
        if (phase === 'hill' || phase === 'hillIntro') { const h = NODES[IDX.get('hill')]; return [h.x, h.z, h.y]; }
        const id = goals[pl.index]; if (id == null) return null; const s = spaces[id]; return [s.x, s.z, s.y];
      };
      return undefined;                                  // the arena bot walks there (and shoves people on the way)
    },
    armed: () => false,
    knocks: () => false,
    onFall(p) {
      const i = p.index, hill = phase.startsWith('hill');
      const lost = hill ? 0 : loseCoins(g, i, RULES.fallCost);
      fx.sfx('yelp', { pitch: [1, 0.86, 1.15, 0.76][i] }); fx.sfx('out'); cam.shake(0.3);
      p.teleport(hill ? hillSpawn(i) : spacePos(g.at[i], i)); p.body?.setLinvel?.({ x: 0, y: 0, z: 0 }, true);
      if (lost) popup(p.position, `−${lost} coins`, '#ff8a7a');
      g.log.push({ turn: g.turn, fall: i, phase });
      eng.refreshChips();
    },
    postStep(dt) {
      if (phase === 'roll') updateDice(dt);
      const t = eng.simT;
      for (const p of ctx.players) { const b = badges[p.index]; if (b && !p.isOut) { const h = p.head; b.position.set(h.x, h.y + 1.3 + 0.05 * Math.sin(t * 3 + p.index), h.z); } }
    },
    interpTargets: () => dice.filter((d) => d && d.rb).map((d) => d.mesh),
    view(dt) {
      if (phase === 'intro') { cam.reveal(Math.min(1, 1 - pt / T.intro)); return; }
      if (phase === 'results') { const w = (results?.winners || []).map((i) => ctx.players[i]).filter((p) => p && !p.isOut).map((p) => p.position); cam.frame(dt, w, { close: w.length > 0 }); return; }
      const pts = eng.framePoints().slice();
      if (phase === 'walk') for (const p of living()) for (const id of win[p.index]?.targets || []) pts.push({ p: spacePos(id), w: 0.7, soft: true });
      if (phase.startsWith('hill')) pts.push({ p: new THREE.Vector3(0, L.HILL_Y, -4.45), w: 1, soft: true });
      if (phase === 'roll') for (const d of dice) if (d && d.rb) pts.push({ p: d.mesh.position.clone(), w: 0.6, soft: true });
      cam.frame(dt, pts);
    },
    hud() {
      if (phase === 'walk') { const left = T.walk - pt; hud.timer(String(Math.ceil(left)), left < 3); }
      else if (phase === 'hill') { const left = T.hill - pt; hud.timer(String(Math.ceil(left)), left < 5); }
      else if (phase === 'roll' && pt < T.roll) hud.timer(String(Math.ceil(T.roll - pt)));
      else hud.timer('');
    },
    chips() {
      return ctx.players.map((p) => ({ name: 'P' + (p.index + 1), color: p.color, out: p.isOut, human: input.isHuman(p.index),
        sub: !g ? '' : phase.startsWith('hill') ? `${secs[p.index].toFixed(1)} s on the hill` : `★ ${g.stars[p.index]} · ${g.coins[p.index]} coins` }));
    },
  };

  newBoardGame();
  eng.start(mode, () => {
    Object.defineProperty(window, '__round', { configurable: true, get: () => ({
      arena: 'board', phase, t: +pt.toFixed(2), turn: g?.turn, turns: g?.turns, at: g?.at.slice(), coins: g?.coins.slice(), stars: g?.stars.slice(), starAt: g?.starAt,
      dice: dice.map((d) => d && { state: d.state, value: d.value, off: !!d.off }), goals: goals.slice(), secs: secs.map((s) => +s.toFixed(2)), lastLand, results,
      alive: living().map((p) => p.index), ...eng.stats(), events: ctx.events.slice(-20),
      players: ctx.players.map((p) => ({ i: p.index, out: p.isOut, grounded: p.grounded, pos: p.position.toArray().map((v) => +v.toFixed(2)), stun: +p.stun.toFixed(2), ...(p.debugState?.() || {}) })),
    }) });
    window.__board = () => g;
    window.__playAgain = () => playAgain();
  });
  return ctx;
}
