// The board game on top of the shared engine (kit/engine.js), for any map (a place module with a `layout`, `markers`
// and a list of `minigames`). A game is a number of turns; each turn:
//   roll  — a die hovers over every bean's head; jump to hit it (it tumbles for real, and can be lost off the map)
//   walk  — the spaces each bean can reach light up with its pegs, an arrow marks where its roll ends; everyone walks
//           at once for a few seconds, shoving and grabbing
//   land  — wherever a bean stands when time is up is where it lands (the nearest space it was allowed to reach):
//           blue +3 coins, red −3, a chest +6, the star for 10 coins
//   game  — a minigame is called and played right where everyone stands (board/minigames): react! Coins by placement.
//           Afterwards the world resets (anything broken is whole again) and everyone is back on their space.
// Falling off the map (or staying in the water) between minigames puts you back on your space, minus 3 coins.
// Most stars after the last turn wins, then coins.
//   runBoard(place)   (?turns=N, ?game=<id> to always play one minigame, ?games=0 for none, ?bots=all, ?seed=)
import * as THREE from 'three';
import { createEngine, COLORS } from '../kit/engine.js';
import { nextSeed, mulberry32, hash } from '../kit/round.js';
import { HAZARDS } from '../kit/hazards/index.js';
import { createRouter } from './route.js';
import { MINIGAMES } from './minigames/index.js';
import { RULES, walkWindow, settle, newGame, land, loseCoins, moveStar, standings, faceUp, botGoal, placeByScore, placeBySurvival, gameCoins } from './rules.js';

const T = { intro: 2.4, roll: 6, rollMax: 9.5, walk: 8, land: 2.4, announce: 3.0, gameEnd: 2.8, reset: 1.3, washBack: 1.6 };
const VOICE = [1, 0.86, 1.15, 0.76];

// ---------------------------------------------------------------- dice faces (+x 1, -x 6, +y 2, -y 5, +z 3, -z 4)
const PIPS = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
function dieMaterials(color) {
  return [1, 6, 2, 5, 3, 4].map((v) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, 128, 128); g.fillStyle = '#fffaf0'; g.beginPath(); g.roundRect(10, 10, 108, 108, 22); g.fill();
    g.fillStyle = '#2a1e30'; for (const [x, y] of PIPS[v]) { g.beginPath(); g.arc(64 + x * 30, 64 + y * 30, 12, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 });
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
  const L = place.layout, spaces = L.SPACES;
  const router = createRouter(L);
  place.botHints = { ...(place.botHints || {}), route: router.route };
  const eng = await createEngine(place, { allBots: Q.get('bots') === 'all' });
  const { ctx, hud, cam, fx, input, scene } = eng; const RAPIER = ctx.RAPIER;
  const M = place.markers;
  const spacePos = (id, i = -1) => { const s = spaces[id]; const o = i < 0 ? [0, 0] : [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]][i]; return new THREE.Vector3(s.x + o[0], s.y + 0.9, s.z + o[1]); };
  const gameList = (Q.get('game') && MINIGAMES[Q.get('game')] ? [Q.get('game')] : (place.minigames || [])).filter((id) => MINIGAMES[id]);
  const gamesOn = Q.get('games') !== '0' && gameList.length > 0;
  const skin = (id) => ({ ...MINIGAMES[id], ...(place.minigameSkins?.[id] || {}) });

  let g = null, phase = 'boot', pt = 0, rng = null;            // pt: phase clock; rng: the game's own stream (survives world resets)
  const roundView = { phase: 'idle', t: 0 };                   // what bots see as ctx.round (mischief only while 'active')
  let dice = [], win = [], goals = [], badges = [], botHit = [], lastLand = [], results = null, pendingCard = 0;
  let game = null, lastGame = null;                            // the minigame being played: { def, inst, outs, t }
  const wetT = [0, 0, 0, 0];
  const living = () => ctx.living();

  // ---------------------------------------------------------------- phases
  function setPhase(ph) {
    phase = ph; pt = 0; roundView.phase = ph === 'walk' || ph === 'game' ? 'active' : ph; roundView.t = 0;
    const simT = eng.simT;
    if (ph === 'intro') { hud.wipe(false); hud.banner(place.name.toUpperCase(), `${TURNS} turns · most stars wins`, T.intro, simT); fx.sfx('sting'); }
    if (ph === 'roll') { startRoll(); hud.banner('ROLL!', 'Jump to hit your die', 1.6, simT); fx.sfx('go'); }
    if (ph === 'walk') { startWalk(); hud.banner('GO!', 'Walk to your arrow', 1.0, simT); fx.sfx('go'); }
    if (ph === 'land') doLand();
    if (ph === 'announce') startGame();
    if (ph === 'game') { hud.banner('GO!', '', 0.8, simT); fx.sfx('go'); }
    if (ph === 'gameEnd') endGame();
    if (ph === 'reset') hud.wipe(true);
    if (ph === 'results') showResults();
    tag(); eng.refreshChips();
  }
  function tag() {
    if (!g || phase === 'results') { hud.tag(null); return; }
    if (game) { hud.tag(`${game.def.title}<small>${game.def.hint}</small>`); return; }
    hud.tag(`TURN ${Math.min(g.turn, g.turns)} OF ${g.turns}<small>${place.name}</small>`);
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
    // up and a little toward the middle of the map (a wild hit can still lose it)
    const r = ctx.R.arena, [cx, cz] = place.dieAim || [0, 0.5], c = Math.hypot(pos.x - cx, pos.z - cz) || 1;
    rb.setLinvel({ x: -(pos.x - cx) / c * 0.7 + (r() - 0.5) * 1.0 + p.velocity.x * 0.3, y: 4.4 + r() * 1.0, z: -(pos.z - cz) / c * 0.7 + (r() - 0.5) * 1.0 + p.velocity.z * 0.3 }, true);
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
    if (off) popup(p.position, place.dieLostText || 'Lost it! 1', '#ff8a7a'); else fx.sfx('tick');
  }
  const dieLost = (t) => (place.dieLost ? place.dieLost(t, ctx) : t.y < -1.5);
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
        if (dieLost(t)) readDie(d, true);
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
      if (out.star) { hud.banner(`P${i + 1} GOT A STAR!`, 'The star moves on', 2.4, eng.simT); fx.sfx('fanfare'); fx.burst(p.position, 24, { colors: ['#ffd04a', '#ffffff', p.color], speed: 3.5, up: 5, size: 0.4, life: 1.1, g: 6 }); M.star(moveStar(g, spaces, rng)); }
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
  function placeAll() { ctx.players.forEach((p, i) => { if (!p.isOut) { p.teleport(spacePos(g.at[i], i)); p.body?.setLinvel?.({ x: 0, y: 0, z: 0 }, true); } }); }
  function washBack(p, why) {
    const i = p.index, lost = loseCoins(g, i, RULES.fallCost);
    fx.sfx('yelp', { pitch: VOICE[i] }); fx.sfx(why === 'water' ? 'splash' : 'out'); cam.shake(0.25);
    p.teleport(spacePos(g.at[i], i)); p.body?.setLinvel?.({ x: 0, y: 0, z: 0 }, true); wetT[i] = 0;
    if (lost) popup(p.position, `−${lost} coins`, '#ff8a7a');
    g.log.push({ turn: g.turn, fall: i, phase, why });
    eng.refreshChips();
  }

  // ---- minigames: called where everyone stands
  const api = {
    THREE, ctx, eng, place, L, fx, hud, cam, hazards: HAZARDS, popup, node: router.node,
    get rng() { return rng; },
    out(p, cause = 'out') {
      if (!game || p.isOut || game.outs.some((o) => o.i === p.index)) return;
      game.outs.push({ i: p.index, t: game.t, cause });
      if (cause === 'water') fx.splash(p.position, 1.2);
      p.fellOff = cause === 'fall'; p.eliminate();
      popup(p.position, 'OUT!', '#ff8a7a');
    },
  };
  function pickGame() {
    const ok = gameList.filter((id) => id !== lastGame || gameList.length === 1);
    return ok[Math.floor(rng() * ok.length)];
  }
  function startGame() {
    const id = pickGame(); lastGame = id;
    const def = skin(id);
    game = { id, def, outs: [], t: -T.announce, inst: null };
    game.inst = def.create(api);
    hud.banner(def.title, def.hint, T.announce - 0.2, eng.simT); fx.sfx('sting'); cam.shake(0.25); ctx.rumbleAll(0.4, 250);
  }
  function endGame() {
    const n = ctx.players.length, inst = game.inst;
    const places = game.def.kind === 'score' ? placeByScore(ctx.players.map((p) => inst.score?.(p.index) ?? 0)) : placeBySurvival(n, game.outs);
    const coins = gameCoins(places);
    for (const c of coins) if (c.coins) { g.coins[c.i] += c.coins; const p = ctx.players[c.i]; if (!p.isOut) popup(p.position, `+${c.coins} coins`, '#7cf0a0'); }
    const top = places.filter((r) => r.place === 1 && !r.nothing).map((r) => 'P' + (r.i + 1));
    const verb = game.def.kind === 'survive' ? (top.length === n ? 'EVERYONE SURVIVED!' : top.length ? `${top.join(' & ')} SURVIVED!` : 'NOBODY MADE IT!') : (top.length ? `${top.join(' & ')} ${top.length > 1 ? 'WIN' : 'WINS'}!` : 'NOBODY SCORED');
    hud.banner(verb, top.length ? `+${RULES.gameCoins[0]} coins` : '', T.gameEnd, eng.simT); fx.sfx('fanfare');
    g.log.push({ turn: g.turn, game: game.id, places: places.map((r) => [r.i, r.place]), coins: coins.map((c) => c.coins), outs: game.outs.map((o) => [o.i, +o.t.toFixed(1), o.cause]) });
    inst.dispose?.();
    for (const h of ctx.hazards) h.dispose(); ctx.hazards.length = 0; ctx.dangers.length = 0;
  }
  function resetWorld() {
    // anything broken is whole again, everyone (the out ones too) is back on their space
    game = null;
    eng.seed = nextSeed(eng.seed); eng.buildWorld(); ctx.round = roundView;
    for (const b of badges) if (b) scene.remove(b); badges = [];
    placeAll(); cam.snap(); wetT.fill(0);
  }
  function nextTurn() { g.turn++; if (g.turn > g.turns) setPhase('results'); else setPhase('roll'); }

  // ---- results
  function showResults() {
    const st = standings(g); const top = st.filter((r) => r.place === 1);
    results = { title: top.length === 1 ? `P${top[0].i + 1} WINS!` : `${top.map((r) => 'P' + (r.i + 1)).join(' & ')} SHARE THE WIN!`,
      draw: false, survivors: top.map((r) => r.i), winners: top.map((r) => r.i),
      placements: st.map((r) => ({ i: r.i, place: r.place, status: `★ ${r.stars} · ${r.coins} coins` })), standings: st, log: g.log };
    window.__results = results;
    fx.sfx('fanfare'); M.clear();
    pendingCard = 1.2;
  }

  // ---------------------------------------------------------------- new game
  function newBoardGame() {
    eng.buildWorld();
    ctx.round = roundView;
    rng = mulberry32(hash('board:' + eng.seed));
    g = newGame({ players: ctx.players.length, turns: TURNS });
    g.at.fill(L.START);
    g.starAt = moveStar(g, spaces, rng); M.star(g.starAt); M.clear();
    dice = []; win = []; goals = []; badges = []; results = null; pendingCard = 0; game = null; lastGame = null; wetT.fill(0);
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
      else if (phase === 'land' && pt >= T.land) { if (gamesOn) setPhase('announce'); else nextTurn(); }
      else if (phase === 'announce' || phase === 'game') {
        game.t += dt; game.inst.update?.(dt, game.t);
        if (phase === 'announce' && game.t >= 0) setPhase('game');
        else if (phase === 'game') {
          if (Math.floor(pt * 4) !== Math.floor((pt - dt) * 4)) eng.refreshChips();
          const alive = living().length;
          if (pt >= game.def.time || (game.def.kind === 'survive' && (alive === 0 || (ctx.players.length > 1 && alive <= 1 && game.outs.length >= ctx.players.length - 1 && pt > 3)))) setPhase('gameEnd');
        }
      } else if (phase === 'gameEnd' && pt >= T.gameEnd) setPhase('reset');
      else if (phase === 'reset') {
        if (pt >= 0.6 && !mode._done) { mode._done = true; resetWorld(); hud.wipe(false); eng.refreshChips(); }
        if (pt >= T.reset) { mode._done = false; nextTurn(); }
      }
      if (pendingCard > 0) { pendingCard -= dt; if (pendingCard <= 0) hud.showResults(results, { colors: COLORS, isHuman: (i) => input.isHuman(i) }); }
    },
    input(edges) {
      if (phase !== 'results' || pendingCard > 0) return false;
      if (edges.some((e) => e.button === 0) || OK_KEYS.some((c) => input.keyEdge.has(c))) { playAgain(); return true; }
      return false;
    },
    playerState() {
      const frozen = phase === 'intro' || phase === 'results' || phase === 'reset';
      return { locked: frozen, invulnerable: frozen || phase === 'gameEnd', bot: phase === 'walk' || phase === 'land' || phase === 'roll' || phase === 'announce' || phase === 'game' };
    },
    botThink(p, dt, botCtx) {
      if (phase === 'roll') { const d = dice[p.index]; return { x: 0, y: 0, jump: !!d && d.state === 'hover' && pt > botHit[p.index] && pt < botHit[p.index] + 0.2, grab: false, aim: 0 }; }
      botCtx.goal = (pl) => {
        if (game) return game.inst.goal?.(pl) ?? null;
        const id = goals[pl.index]; if (id == null) return null; const s = spaces[id]; return [s.x, s.z, s.y];
      };
      return undefined;                                  // the arena bot walks there (and shoves people on the way)
    },
    armed: () => !!game && game.t >= 0 && (game.inst.armed?.(game.t) ?? true) && phase === 'game',
    knocks: () => phase === 'game',
    onFall(p) {
      if (game && phase !== 'announce') { if (game.def.kind === 'survive') return api.out(p, 'fall'); }
      washBack(p, 'fall');
    },
    onOut(p, info) { if (game && !game.outs.some((o) => o.i === p.index)) game.outs.push({ i: p.index, t: game.t, cause: info.cause }); },
    postStep(dt) {
      if (phase === 'roll') updateDice(dt);
      const t = eng.simT;
      for (const p of ctx.players) { const b = badges[p.index]; if (b && !p.isOut) { const h = p.head; b.position.set(h.x, h.y + 1.3 + 0.05 * Math.sin(t * 3 + p.index), h.z); } }
      // water: stay in it too long and you're washed back to your space (between games) or out (in a survival game)
      if (ctx.water && phase !== 'results' && phase !== 'reset' && phase !== 'intro') for (const p of living()) {
        const i = p.index; wetT[i] = p.inWater ? wetT[i] + dt : Math.max(0, wetT[i] - dt * 2);
        const limit = game ? (game.inst.wet ?? T.washBack) : T.washBack;
        if (wetT[i] < limit) continue;
        if (game && phase === 'game' && game.def.kind === 'survive') api.out(p, 'water'); else if (phase !== 'gameEnd') washBack(p, 'water');
      }
      // far out of bounds (thrown off the map into the void)
      for (const p of living()) { const q = p.position; if (place.surfaces.inBounds && !place.surfaces.inBounds(q.x, q.z) && !p.hanging && q.y < (ctx.water ? ctx.water.level : 0) + 0.5) mode.onFall(p); }
    },
    interpTargets: () => [...dice.filter((d) => d && d.rb).map((d) => d.mesh), ...(place.moving?.() || [])],
    view(dt) {
      if (phase === 'intro') { cam.reveal(Math.min(1, 1 - pt / T.intro)); return; }
      if (phase === 'results') { const w = (results?.winners || []).map((i) => ctx.players[i]).filter((p) => p && !p.isOut).map((p) => p.position); cam.frame(dt, w, { close: w.length > 0 }); return; }
      const pts = eng.framePoints(phase === 'game').slice();
      if (phase === 'walk') for (const p of living()) for (const id of win[p.index]?.targets || []) pts.push({ p: spacePos(id), w: 0.7, soft: true });
      if (game) for (const v of game.inst.focus?.() || []) pts.push({ p: v, w: 1, soft: true });
      if (phase === 'roll') for (const d of dice) if (d && d.rb) pts.push({ p: d.mesh.position.clone(), w: 0.6, soft: true });
      cam.frame(dt, pts);
    },
    hud() {
      if (phase === 'walk') { const left = T.walk - pt; hud.timer(String(Math.ceil(left)), left < 3); }
      else if (phase === 'game') { const left = game.def.time - pt; hud.timer(String(Math.ceil(left)), left < 5); }
      else if (phase === 'announce') hud.timer('');
      else if (phase === 'roll' && pt < T.roll) hud.timer(String(Math.ceil(T.roll - pt)));
      else hud.timer('');
    },
    chips() {
      return ctx.players.map((p) => {
        const i = p.index, outIn = game?.outs.some((o) => o.i === i);
        const sub = !g ? '' : game && (phase === 'game' || phase === 'gameEnd') ? (outIn ? 'OUT' : game.inst.scoreText?.(i) ?? 'IN') : `★ ${g.stars[i]} · ${g.coins[i]} coins`;
        return { name: 'P' + (i + 1), color: p.color, out: p.isOut || outIn, human: input.isHuman(i), sub };
      });
    },
  };

  newBoardGame();
  eng.start(mode, () => {
    Object.defineProperty(window, '__round', { configurable: true, get: () => ({
      arena: place.id, phase, t: +pt.toFixed(2), turn: g?.turn, turns: g?.turns, at: g?.at.slice(), coins: g?.coins.slice(), stars: g?.stars.slice(), starAt: g?.starAt,
      dice: dice.map((d) => d && { state: d.state, value: d.value, off: !!d.off }), goals: goals.slice(), lastLand, results,
      game: game && { id: game.id, t: +game.t.toFixed(2), outs: game.outs.slice(), scores: ctx.players.map((p) => +(game.inst.score?.(p.index) ?? 0).toFixed(2)) },
      water: ctx.water ? +ctx.water.level.toFixed(2) : null, arenaState: place.state?.(ctx),
      alive: living().map((p) => p.index), ...eng.stats(), events: ctx.events.slice(-20),
      players: ctx.players.map((p) => ({ i: p.index, out: p.isOut, grounded: p.grounded, water: p.inWater, pos: p.position.toArray().map((v) => +v.toFixed(2)), stun: +p.stun.toFixed(2), ...(p.debugState?.() || {}) })),
    }) });
    window.__board = () => g;
    window.__playAgain = () => playAgain();
  });
  return ctx;
}
