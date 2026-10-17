# Mario Party 4 decompile — clean-room analysis

Source studied: https://github.com/mariopartyrd/marioparty4 (decompile, USA rev 0/1 matching).

**Clean-room note.** This document describes *behavior, data models and design
patterns* in our own words. No code, struct layouts, or data tables from the
decompile are reproduced. Nothing here should be copied into our codebase as
implementation; it is a reference for *how the game is structured*, which we
re-implement independently. Do not paste decompile code into this repo.

---

## 1. Big picture

MP4 is three layers stacked on a small runtime:

| Layer | What it is | Lives where |
|---|---|---|
| Runtime | Cooperative coroutines ("processes"), an object manager, an overlay (scene) loader | main executable |
| Persistent game state | One global struct of per-player + global fields + bit flags | main executable — survives every scene change |
| Shared board engine | Space graph, turn loop, dice, movement, shared events (shop, Boo, Bowser, star…) | main executable |
| Per-board module | Board-specific gimmicks, registered as hooks into the engine | one loadable module per board |
| Minigames | Self-contained scenes that write results into persistent state and return | one module per minigame |

The key architectural fact: **when you leave the board for a minigame, the
board is completely destroyed**, and later rebuilt from the persistent state.
Every piece of board state that matters must be either in the global state or
re-derivable from it.

## 2. Runtime: coroutines everywhere

- Every scripted sequence (a turn, a dice roll, a cutscene, a shop visit) is a
  **cooperative coroutine** with its own small stack. There is no preemption;
  a coroutine yields by "sleeping" N frames (0 = just yield this frame,
  negative = park forever until killed).
- Coroutines form a **parent/child tree**. Killing a parent kills all
  descendants. Kills are deferred to the next time the coroutine is scheduled.
- Each coroutine can carry a **destructor**. The universal "call a sub-sequence
  and wait" idiom is: spawn a child, give it a destructor that clears a handle,
  and have the parent loop "sleep one frame while handle is set".
- Each coroutine owns a mini-heap; its allocations die with it.
- In parallel there is an **object manager**: a priority-sorted list of objects,
  each with a per-frame update function plus transform/model slots. Objects
  become state machines by swapping their own update function. Coroutines
  script; objects animate.
- Two pause bits (system / user) with per-coroutine exemptions implement pause
  menus without special-casing every sequence.

Takeaway: game flow reads like straight-line script ("show message, wait,
move camera, wait, give coins") because of coroutines. This is the single
most useful idea to carry over — in a modern engine, use async/await,
generators, or engine coroutines.

## 3. The board: a directed space graph

- Spaces are nodes in a fixed array, loaded from a data file authored alongside
  the 3D map. Each has a transform, a **type**, a **flag bitfield**, and up to
  four **outgoing** links. Backward traversal is done by scanning for
  predecessors, never stored.
- **Types** = what happens on landing (blue/red coins, event "?" space,
  Bowser, battle, item, fortune, warp, star, and a blank "path only" type that
  costs no step).
- **Flags** = everything else, and split into two ranges:
  - High bits the engine understands: shop/Boo/lottery stops, pipe (size-gated)
    links, "hidden / event-only" (not offered at junctions), star-slot index.
  - Low bits each board defines for itself — including **parameters packed into
    flags** (e.g. "this is destination #3", "this space is in fire zone B").
    Designers can reconfigure events in the data file without code changes.
- A second space layer holds non-walkable paths for vehicles (e.g. a coaster track).
- A junction is any space with >1 *eligible* link. Eligibility depends on
  flags, a **global junction mask** boards flip at runtime, and the **player's
  current state** (only small players can use pipes). So the effective graph is
  per-player and per-moment.

### Pass vs land
- **Passing** a space (every step): the board's "walk" hook runs first; if it
  returns *handled*, the step is free and movement continues from wherever the
  hook left the player. This lets a vehicle grab someone mid-roll and drop them
  elsewhere. Then engine pass-events (star, shop, Boo, lottery, pipe).
- **Landing** (roll hits 0): hidden-block check, then a switch on type. The
  "?" type calls the board's "land" hook. Landing also stamps a **colour** on
  the player that later decides the minigame format.

## 4. Turn flow

1. **Build the board** (models, camera, UI, player placement), call the board
   module's create hook, re-apply any persistent world changes.
2. **Resume dispatch** — persistent "why am I being re-entered?" flags route
   into: after a minigame (advance turn / maybe end game), after a battle,
   after a Bowser minigame, or *mid-event for a board gimmick*.
3. **Last-5-turns** twist once, at round start, with fewer than 5 turns
   left: a roulette sets a global rule change (double coins, all reds
   become Bowser spaces, cheaper star, …). It is re-applied on every reload.
4. **Per player:** pre-turn hook (one-shot unless it asks to persist) → roll
   menu (dice / item / map) → step loop (junction choice → tween → pass events
   → maybe decrement) → land → post-turn hook.
5. **End of round:** derive minigame format from colours, pick a minigame
   (roulette, with a "recently played" exclusion buffer), push the minigame
   scene. Board is torn down.
6. Minigame writes per-player results into global state → a results scene
   pays out → board scene is re-entered → step 2.

## 5. How the world changes during play

This is the part most relevant to us. MP4 has eight distinct mechanisms:

| # | Mechanism | Example (described) |
|---|---|---|
| 1 | Toggle "event-only" on specific spaces | Jungle statue raises the water: river crossings close for N turns |
| 2 | Global junction mask | Close/open a whole class of paths at once |
| 3 | Re-type spaces (one, or global from→to) | Star host space; last-5 turns red→Bowser |
| 4 | Relocate a feature by saved index | Star moves among 8 authored slots; hidden block moves |
| 5 | Teleport players (`current space` reassignment) | Vehicles, shuffle, warp, lamp, ghost ride that scoops up bystanders |
| 6 | Player-placed overlays on spaces | A trap sticker charges whoever passes |
| 7 | Player-state gating | Size/suit change which links & events apply |
| 8 | Region tags for area effects | Volcano hits everyone standing on zone-flagged spaces |

Plus visible persistent change:
- **Escalating counters** with visible model state: a lock with N bands (at
  N, a boss releases), a hotel that upgrades by investment tier and is wiped
  by a tsunami event.
- **Timed effects**: the effect's owner gets a pre-turn hook that counts down;
  at zero it reverses the animation and re-derives topology.
- **Animation scrubbing as state display**: on reload, props are scrubbed
  straight to the frame matching saved state (bridge raised, water high).

### Persistence pattern (important)
Runtime edits to the space array are **never saved**. Each board keeps a
tiny (32-byte) private save area plus a few global indices (star slot, block
slot, last-5 effect). On create the board **re-derives** flags, masks, model
frames and hooks from that save. *Store intent, rebuild the world.*

## 6. Event presentation template

Nearly every event follows the same five beats, which is why the game
feels consistent:

1. **Enter** — spawn a child coroutine, turn loop blocks on it.
2. **Frame** — player turns to camera; camera eases to a preset or to a
   target model over N frames; script waits on the camera.
3. **Talk/choose** — dialog window / choice (CPU feeds scripted button presses).
4. **Mutate** — coins/stars/items/positions/space types/save state, with
   animation (mount the player on a named node of a vehicle model, play a
   motion, quake the camera).
5. **Restore** — destructor frees props; camera returns to player; loop resumes.

Camera: an orbit camera (target, rotation, zoom, FOV) with linear "move
from A to B over N frames", quake, preset views, and a pluggable position
function for rides. Scene cuts use wipe-out → snap → wipe-in.

## 7. AI

- Difficulty is mostly a **mistake chance** (roll under it → don't act) plus
  **distance thresholds**.
- Each character has a ranked item preference list → buying and using items
  have a personality.
- Item-use rules are per-item predicates ("use the swap if an opponent is
  closer to the star than me").
- Pathfinding is a **bounded DFS over path segments** (split at forks,
  ~30-space budget), tagging segments by what they contain. Good enough for
  boards with a handful of forks.
- **CPU acts by synthesizing controller input** — junction choice becomes a
  fake stick angle, menus get fake button presses. All code paths are
  shared between humans and CPUs. Same trick inside minigames.

## 8. Minigames

- Format comes from landing colours: 4-player, 1-vs-3, 2-vs-2; neutral
  colours are assigned with weighted randomness toward balance.
- Minigames are isolated scenes: setup → global phase number (intro, play,
  finish, results) that every object reads → write `win`/`collected` per
  player into global state → return. They never touch board state directly.
- A separate results scene owns payouts.

## 9. Things MP4 does that we should *not* copy

- RNGs seeded from wall clock, shared between gameplay and cosmetics → no
  replays, no reproducible bugs. Use seeded, per-subsystem RNG streams.
- Hook signatures take no arguments and read globals (current player etc.).
  Pass an explicit context.
- Board-specific hooks gated by "if board id == Bowser board" inside the
  engine. Use a general hook registry instead.
- Fixed-size arrays (256 spaces, 4 links, 16-deep overlay stack) — fine on
  GameCube, unnecessary now.
