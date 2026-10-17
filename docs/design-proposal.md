# Reapproach: a Jumanji/Zathura-style game, informed by MP4's architecture

Working title: **TABLETOP** (placeholder).

Premise: players sit around a cursed board game *inside a physical space* (a
house, a cabin, a spaceship). Every turn on the board unleashes something into
that space — floods, vines, a meteor shower, a gravity flip, a stampede. The
space stays changed. You win by finishing the board before the house finishes you.

The analysis in `mp4-cleanroom-analysis.md` shows MP4 already solved most of
the *structural* problems this needs. It only lacks the second half: the
physical space players live in. Below is what we borrow, what we invert, and
a concrete structure.

---

## 1. The core idea: two coupled graphs

MP4 has one graph (the board) and puts its "world" (vehicles, water, bridges)
*on* that graph. We split it:

```
 BOARD (abstract track on the table)        ROOM (the physical space)
 ┌───────────────────────────────┐          ┌─────────────────────────────┐
 │ spaces, links, types, flags   │──effects▶│ zones, connections, hazards │
 │ player pieces                 │◀─effects─│ player avatars, the board   │
 └───────────────────────────────┘          └─────────────────────────────┘
```

- **Board → Room.** Landing/passing spaces draws an *encounter card*. The card
  spawns a persistent **Room Effect**: water rises in the kitchen, vines block
  the hallway, the living room loses gravity.
- **Room → Board.** Room state changes the board. Directly: the flood
  washes your piece back 3 spaces. Indirectly: you can't roll unless your
  avatar is physically at the board.

**Signature mechanic (Zathura's best trick): the board is a physical object
in the room.** To take your turn your avatar must reach it and touch it. Room
effects can move it, block it, or carry it off (the board floats in zero-G,
gets swept down the hall by flood water). This one rule turns every room
change into a board-game consequence. That's the Jumanji feel.

## 2. What we lift from MP4, mapped

| MP4 pattern | In our game |
|---|---|
| Space graph with types + engine flags + per-board flag params | Same for the board. The **room** is also a graph: zones (rooms/areas) with tags (`wet`, `dark`, `overgrown`, `zero_g`) and connections (door, stairs, vent) that can be open/blocked |
| Walk / land / mini hooks returning "handled = free step" | `on_pass`, `on_land`, plus `on_zone_enter` for the room. Pass an explicit context, not globals |
| Toggle "event-only" flags / junction mask / re-type spaces | Effects that **lock board paths** and **block room connections**: one primitive for both graphs |
| Region tags + area-of-effect (volcano zone) | Room zone tags: "everyone in a `wet` zone takes the eel attack" |
| Player-state gating (mini/mega/suit) | Avatar conditions: shrunk (fits through vents, short dice), stuck (Jumanji floor), frozen, floating |
| Tiny persistent save + **re-derive world on load** | `WorldState = ordered list of active effects + counters`. The room and board are *rebuilt* from it. Save/load, netcode and the reversal ending all come almost for free |
| One-shot pre/post-turn hooks for countdowns | Timed effects ("monsoon: 3 turns") count down on the owner's turn, then expire and re-derive |
| Escalating counters with visible state (lock, hotel tiers) | **House Integrity / Doom meter**: each unresolved effect adds pressure; thresholds unlock nastier card decks and visible decay |
| Last-5-turns global rule change | Endgame "the game notices you're winning" twist: the final stretch of the board rewrites space types |
| Board ↔ minigame scene round-trip with resume flags | **We don't leave the scene.** The "minigame" is a real-time phase that happens *in the room itself* (see §3) |
| Coroutine cutscene template (enter, frame, talk, mutate, restore) | Every encounter card is a coroutine script with the same beats, so cards are cheap to author |
| CPU = synthesized controller input | Same for bots on the board *and* in the room; bots and humans share all code paths |
| Bounded DFS pathfinding over segments | Fine for the board. Room bots use navmesh pathing that respects blocked connections |

## 3. Core loop

```
┌──────────────── ROUND ────────────────────────────────────────┐
│ 1. REACH   active player's avatar must get to the board        │ real-time
│            (others can help or, in versus mode, hinder)        │
│ 2. ROLL    dice → move piece on BOARD (junction choices)       │ turn-based
│ 3. CARD    land/pass triggers an encounter → Room Effect       │ cutscene
│ 4. SURVIVE everyone acts in real time for ~20–60s while the    │ real-time
│            effect manifests (MP4's "minigame", but in-world)   │
│ 5. SETTLE  result writes back: piece moves, effect resolved/   │ turn-based
│            persists, doom meter ticks, board paths lock/open   │
└────────────────────────────────────────────────────────────────┘
```

Phase 4 replaces MP4's minigames, and it is the main departure. In MP4 a
minigame is a separate disposable scene. Here the challenge happens in the
room you already live in, which is shaped by every earlier card. So it is
never the same twice, and you get emergent combinations: vines + flood means
the vines float and block the stairs.

### Win / lose
- **Win:** any piece reaches the final space → **everything reverses**
  (Jumanji ending). Since the world is re-derived from the effect list, the
  reversal is just "clear the list and rebuild", which can play as a
  satisfying rewind animation.
- **Lose:** Doom meter maxes (house collapses / ship breaks up / you all get
  absorbed into the game).
- Recommended default mode is **co-op race against the house**; competitive
  (first to finish escapes, others stay trapped) is the alternative.

## 4. Data model (our own, engine-agnostic sketch)

```text
BoardSpace   { id, pos, type, tags[], links[], params{} }
RoomZone     { id, bounds, tags[], connections[] }
Connection   { from, to, kind(door|stairs|vent|hole), open: bool, requires: condition? }
Effect       { id, card_id, owner, zones[], started_turn, duration?, stacks, params{} }
WorldState   { seed, turn, doom, active_effects[], board_pieces{}, avatars{}, board_object_zone }

derive(WorldState) -> (effective board graph, effective room graph, prop/visual states)
```

Rules that keep it sane (lessons from MP4):
1. **Only `WorldState` is truth.** Graph edits are derived, never saved.
2. **Effects are data + one script.** Card = `{ trigger, targets, derive_rules,
   realtime_script, resolve_rules }`. Designers add cards without engine work.
3. **Explicit context to every hook** (`ctx.player`, `ctx.space`, `ctx.world`)
   instead of globals.
4. **Seeded, separate RNG streams** (`board`, `cards`, `realtime`, `cosmetic`)
   so games can be replayed and bugs reproduced, which MP4 can't do.
5. **Generic hook registry**, not "if board == X" in the engine.

## 5. Starter content (to prove the loop)

One space (a two-floor house, ~8 zones) and ~12 cards that exercise every
coupling type:

| Card | Room effect | Board coupling |
|---|---|---|
| Monsoon | Ground floor zones become `wet`; water level rises each turn | Board pieces on "low" spaces slide back 2; board object floats if its zone floods |
| Overgrowth | Vines block 1–2 connections until cut (real-time task) | Locks a board shortcut while vines live |
| Stampede | Herd crosses a zone route; avatars in path are knocked to another zone | Pieces get shuffled like MP4's Bowser shuffle |
| Gravity Well | One zone becomes `zero_g` | Dice in that zone roll double but you can't steer at junctions |
| Shrink Ray | Hit avatars become small (vents usable) | Small pieces use pipe-only board links (straight from MP4's mini gating) |
| Quicksand Floor | Avatar `stuck` until freed by another player | Their piece can't move; teammates' rolls can carry it |
| Meteor | Random zone gets a hole → new vertical connection | Re-types one board space to "hazard" |
| Robot Sentinel | Patrolling enemy guards the board object | Must be distracted before rolling |
| Monkey Thieves | Steal items from avatars in `dark` zones | Steal board items |
| Time Skip | Next card resolves twice | — |
| Fire | Spreads to adjacent `dry` zones each turn unless doused | Doom +1 per burning zone |
| Endgame: The Game Notices | Final stretch: all neutral spaces become card spaces | MP4 last-5 analogue |

Stacking is the fun part: Fire + Monsoon cancel, Overgrowth + Fire spreads
faster, Gravity Well + Monsoon gives floating water blobs.

## 6. Build order

1. **Headless rules core:** board graph, room graph, WorldState, `derive()`,
   card pipeline, seeded RNG. Unit-testable, no graphics. Play a whole game in text.
2. **Turn flow as coroutines:** reach → roll → card → survive (stubbed) → settle.
3. **Greybox room:** 8 zones, avatars, the board as a carryable object, 3 cards.
4. Real-time phase for those 3 cards, then bots via synthesized input.
5. Content pass, doom meter, reversal ending.

## Open questions for you

- Engine/platform? (Godot / Unity / Unreal / web.) It decides whether
  "coroutines" are GDScript `await`, C# `IEnumerator`, or JS async.
- Local couch play (as in the films) or online?
- Co-op vs competitive as the default?
- First-person avatars in the room, or a third-person/diorama camera (closer to MP4)?
