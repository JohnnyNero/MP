# TABLETOP arena kit

Shared runtime for arenas and the board: the engine, the round loop, shared camera, input, HUD, bots, disaster deck, destruction and test hooks, as no-build ES modules. An arena module supplies only the place. `kitchen/` is the reference arena, `ship/` is the moving-frame one, and `station/` adds a new disaster and the hit-bias hooks.

| File | Role |
|---|---|
| `engine.js` | `createEngine(place)`: renderer, fixed 60 Hz step, physics world, players, bots, destruction, water, hazards, shared camera, render interpolation, adaptive quality, generic `window.__*` hooks. Runs a **mode** (the rules) |
| `run.js` | `runArena(arena)`: the disaster-round mode (round flow, results, matches, Deck benchmark) |
| `round.js` | pull → reveal → prep → active (escalation 30 s / 43 s) → finish → results (ties, draw, `settle`-shaped) |
| `match.js` | matches across pages (sessionStorage, `?match=1`): arena order, 3/2/1/0 scoring, standings. Pure, unit-tested |
| `camera.js`, `input.js`, `hud.js`/`hud.css`, `fx.js` | camera, pads/keyboard/rumble, TV HUD, effects/telegraphs/sfx |
| `bots.js` | scores arena points against hazard dangers; never walks off a drop |
| `hazards/` | `lightning`, `meteor`, `flood` (ported from the ship), `stampede`, `stomp`, `decompress` |
| `players.js` | character seam: `ragdoll.js` (default) or `?character=standin` |
| `ragdoll.js`, `character.js` | the real character: kit copy of `proto3d/character.js` (6-body active ragdoll) behind the kit player interface |
| `props.js` | loose grabbable props (`arena.props`) |
| `destruct.js`, `materials.js`, `smash.js` | fracture engine, materials, "fragile things shatter" rule |

## Engine and modes

`engine.js` owns everything physical; a mode owns the rules. `run.js` is the disaster round; `../board/mode.js` is
the board game. A mode is an object of hooks (see the header of `engine.js`): `tick(dt)`, `input(edges)`,
`playerState(p)` → `{ locked, invulnerable, bot }` (required), `botThink(p, dt, botCtx)`, `armed()`, `knocks()`,
`onFall(p)` (default: out; the board puts you back on your space), `onOut`, `view(dt)` (frame the camera, set the
timer), `cutaway()`, `chips()`, `postStep(dt)`, `interpTargets()`, `onFrame`, `lockQuality`. Start with
`eng.buildWorld()` then `eng.start(mode, addHooks)`; `eng.buildWorld()` again rebuilds the world for a new round.

Bots: a mode can steer the arena bot by setting `botCtx.goal = (player) => [x, z, y]` (local); the bot walks there
with `botHints.route(from, to)` instead of picking a safe spot, and keeps its mischief (grab, drag, throw), climbing
and fall catches. Mischief only runs while `ctx.round.phase === 'active'`.

## Making an arena

The page links `../kit/hud.css`, includes the importmap, and runs `runArena(arena)` from `../kit/run.js`. Module fields (local frame):

- `id`, `name`, `help` (HTML), `theme` (CSS vars), `disasters: [...]`, `camera` (options), `spawns` (4 × `[x, y, z]`), `overboard` (a point off the edge).
- `assets.pieces`: baked `{ GLB_BASE64, SUPPORT }` (from `tools/bake`).
- `surfaces`: `{ points: [[x, z, y, tag]], heightAt, inBounds, killY, groundHeight }`. Hazards land and bots stand on `points`. Below `killY` you're out.
- `botHints`: `{ edgeDist(x, z), obstacles: [rects], route(from, to), prefer(pt) }`.
- `water` (optional): `{ base, rate, height(level, x, z, t) }`. The runner then owns `ctx.water` (`level`, `target`, `raise(step, cap)`), buoyancy and drowning.
- `hazardConfig[name]`: per-disaster skin and tuning (titles, lanes, food meshes, flood axis). See each hazard's header.
- `init(ctx)` runs once (visuals). `build(ctx)` runs each round on a fresh `ctx.world`/`ctx.D`. Then `update(dt, ctx)` (pre-physics), `postStep`, and `render` (per frame).
- Optional hooks: `onEscalate`, `onPhase`, `state(ctx)` (feeds `__round.arenaState`), `hooks(ctx, window)`.
- `ledges` (optional): `[[x0, y0, z0, x1, y1, z1], ...]` local segments, any direction, that grabs snap onto (counter edges, deck lips). Players hang off them and climb back. `ledgeBody(ctx)` returns the body they ride on (a moving arena's kinematic hull).
- `props` (optional): loose grabbable things `{ name, shape: 'sphere'|'box'|'cyl', size, mass, pos, mesh(THREE) }`. Destruction debris up to `grabMaxMass` is grabbable too.
- `secondDisaster` (optional): the disaster that always joins at the first escalation (unless it is already the main one).
- `hitBias(p, impulse, src, ctx)` (optional): adjust every hazard knock before it lands (the station tilts knocks toward its open door). Return the new impulse.
- `occluders()` (optional): extra meshes the camera cut-away may fade (destruction chunks are always candidates).
- `camera`: shared camera options. Default pitch 35°. Tune `fov`, `minDist`/`maxDist`, `padX`/`padZ`, `zBias`, `lift`, `centerPull`, `include` (points always kept in frame, e.g. the station's door edge) and the reveal (`revealFrom`/`revealTo`/`revealCenter`/`revealLift`). Feel: `deadZone` (m the group may drift before the shot follows), `zoomDead` (fraction), `outTime`/`inTime` (zoom out fast, in slow), `panTime`, `maxShake`. The runner frames living players (one off the arena and not hanging on counts for less), live telegraphs as soft points (shown only if no player is lost), and the survivors close up on the results screen. Measure changes with `tools/probes/camera.mjs`.
- A moving arena passes `frame: { toWorld, toLocal, dirToWorld, groundVelocity }`. Hazards work in local space and parent telegraphs to `ctx.group`.

Pieces: write `tools/bake/defs/<x>_defs.mjs` exporting `pieces({ box, cyl, prism })`, then run `node tools/bake/bake.mjs --defs <file> --name <bundle> --out public/arenas/<x>` from the repo root (see `tools/README.md`). Colour is baked per material, so make one def per colour.

## Making a disaster

Create `hazards/<name>.js`, then register it in `hazards/index.js`:

```js
export default {
  name: 'quake', title: 'EARTHQUAKE', hint: 'Stay off cracked pieces',
  safeZones: (arena) => arena.hazardConfig?.quake?.safe || [],   // shown during reveal
  create: (level, ctx) => new Quake(level, ctx),
};
// instance: { name, lvl, items, update(dt, now, armed), field?(p, v, info) -> [fx, fz], dispose(), log? }
```

- **Escalation:** the runner raises `lvl` (0–2); read it in `params()`.
- **Arming:** telegraph while `armed` is false and damage only while it is true. A telegraph that ends unarmed does nothing.
- **Fairness:** telegraphs last at least 1.5 s for lethal hits. Pick targets with `freePoints()` (`hazards/common.js`): it excludes spots near players at pick time, keeps spacing and never repeats. Use `ctx.R.hazard` / `ctx.R.fx`, never `Math.random`.
- **Hits:** players only via `ctx.hitPlayer(p, impulse, stun, immunity, src)`; objects via `ctx.D.damageSphere`, `damageBox` or `damageChunk`.
- **Bots:** push dangers into `ctx.dangers` and remove them when done. Kinds: `circle`, `lane`, `water`, `high`, `prefer`, `wind` (`{ dir, holdTag, active }`: bots head for `holdTag` points and grip; `botHints.holdDir(pt)` says which way the handhold is).
- **Forces:** an instance may return `field(p, v, info) -> [fx, fz]` to push debris and props (decompression, flood).
- **`ctx` also has:** `players`, `living()`, `frame`, `water`, `fx`, `cam.shake`, `cfg(name)`, `now()`, `rumbleAll`.

## Characters

`createPlayers({ THREE, RAPIER, world, scene, hero, SkeletonUtils, slots, options })` returns players with `input`, `update`, `sync`, `knock`, `eliminate`, `teleport`, `position`, `isOut` and `grounded` (see `ship/README.md`).

The default (`ragdoll.js`) wraps the active ragdoll and adds `players.group` (`beforeUpdate`, `afterStep(dt, eventQueue)`, `render(dt)`), which the runner calls around the physics step and per frame.

- **Input:** `p.input = { x, y, jump, grab, grabL, grabR, limp, aim }`. `grab` is both hands; `grabL`/`grabR` are one hand each with an analog reach; `limp` is play dead. The adapter maps it to the character's input through the camera basis.
- **Hits:** `knock(impulse, { stun })` spreads the impulse over the parts by mass. `stun >= 0.9` knocks the player out, `0.5..0.9` knocks them down briefly, and anything lower is a stagger.
- **Pushes:** `p.body` is a proxy, so `applyImpulse` pushes every part. `p.collider.setCollisionGroups` keeps the parts' self-exclusion.
- **Elimination:** the kit owns it (falling, drowning). The character never respawns. `eliminate()` removes its bodies and joints and hides it.
- **Water:** per-part buoyancy and drag. A player drowns after `drownTime` with their feet more than 0.3 deep.
- **Mass:** `massScale` 15 (about 60 kg, the stand-in's mass), so hazard impulses and prop masses keep their meaning.
- **Grabbing:** thrown props are marked dangerous and knock players over. Thrown players bowl over whoever they land on.
- **Bots:** use the same controller. They fetch and throw props, grab and throw players toward drops or telegraphs, and climb back when hanging. Dodging telegraphs comes first.

## Controls

- **Gamepad:** left stick moves, A jumps, LT/RT grab with the left/right hand (a light press is a short reach), RB grabs with both, hold Y to play dead, right stick Y or the D-pad aims, Start opens help. Any button joins.
- **Keyboard P1:** WASD moves, Space jumps, F or Left Shift grabs (both hands), Q plays dead, R/V aim.
- **Keyboard P2:** arrows move, `/` or Right Shift jumps, `.` or Right Ctrl grabs, K plays dead, L/, aim. Pressing any of these joins.

To throw, look up and let go. In a match, slots (which device is which player) carry over from page to page.

## Test hooks

`__round`, `__match` (after a match round's results), `__disaster(name)`, `__skip(s)`, `__render(on)`, `__renderFrames(n)`, `__overboard(i)`, `__teleport`, `__botsOff`, `__inject(i, input|null)` (drive slot i like a human), `__players()`, `__playAgain`, `__hazards()`, `__results`. `__round` also reports `physMs` (world.step), `charMs` (character update) and `events` (grab, throw, knockout, mantle). URL parameters: `?disaster= &seed= &bots=all &n= &any=1 &quality=high &character=standin &bench=1 &match=1`. Headless scripts that use these hooks live in `tools/probes/`.
