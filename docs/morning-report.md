# Morning report: overnight build

**Play it:** https://johnnynero.github.io/MP/

Plug in up to 4 gamepads, or use the keyboard (P1: WASD, F jump, G action;
P2: arrows, K jump, L action). Press jump to join and jump again to start.
Empty seats become bots. Press Enter with nobody joined to watch a bot-only
game. Add `?demo=1` to the URL to start one straight away.

Everything is on branch `ccr-113e1aa1-g9dg5i`, which is also the repo's
default branch.

---

## What got done

### 1. `CLAUDE.md`
- **Token use:** a table of which agent to use for which job: direct
  reads, `Explore`, `Plan`, background `general-purpose` agents for
  independent chunks, and `claude-code-guide`. Plus habits: read line
  ranges, brief subagents tightly, don't re-read files.
- **Actions minutes:**
  - one job in one workflow
  - `paths` filter, so docs-only pushes don't run CI
  - superseded runs are cancelled
  - npm cache
  - run tests/build locally before pushing
  - no cron, no matrix builds, no re-runs

### 2. Rules engine (`src/core/`, pure TypeScript, no Phaser)

| File | What it does |
|---|---|
| `types.ts` | The whole `GameState` as plain JSON |
| `rng.ts` | Seeded RNG with named streams (board, cards, format, bot, house), so a game replays exactly from its seed. Fixes MP4's clock-seeded RNG |
| `game.ts` | `newGame`, `startRound` (arrival order → turn order, first-arrival bonus), `takeTurn`, `planHouseTurn` (roulette, target rooms, format, goal), `settle` (payouts, containment, lingering, fire spread, round cap) |
| `house.ts` | `deriveHouse()` rebuilds room tags, blocked connections, holes and the board's location from the base layout plus active effects. This is the "store intent, rebuild the world" pattern from the MP4 analysis |
| `bots.ts` | Board-phase AI: items, reroll, junctions (distance vs. coins), shop, repair, Push Back targets |
| `sim.ts` | Headless driver that plays whole games with bots |

`takeTurn` is a **generator** that yields animation events and decision
requests. The UI, the bots and the tests all drive the same code; this is
MP4's coroutine idea.

**Tests:** 16 Vitest tests, including 300 simulated games. Bot games
average **10.1 rounds** (range 6–14), which matches the 10–12 round target.

### 3. The game (`src/game/`, Phaser 3)

| Area | What's in it |
|---|---|
| House | 480×270 pixel art drawn at 2× with no image files (all art is generated in code). Side cutaway: 3 floors, 9 rooms, doors, stairs, 3 ladders, a vent, an ordinary suburban home with furniture |
| Avatars | Platformer movement (run, jump, climb stairs and ladders, crawl through vents), stuns, slippery floors, low gravity, flipped gravity |
| Regroup | Everyone races to the board each round. Arrival order sets turn order. After 18 s, stragglers are pulled in. Vines wrapping the board must be cut by standing at it |
| Board turns | Board view drawn over the house. Dice, junction choices, shop, repair, tolls, the shortcut gate, items |
| House turn | Roulette over the round's danger cards, then a card showing hazard, goal and format (FFA / 1v3 / 2v2) |
| Hazards | All 8, in intense and lingering forms: Flood (rising water, drowning), Meteor Shower (telegraphed strikes, then a hole in the floor), Vines (entangle, then block a doorway or ladder), Stampede (herd you jump over; it knocks the board to another room), Blackout (vision circle), Gravity Flip, Fire (spreads between rounds), Monkey Thieves (steal coins) |
| Goals | All 6: Survive, Apple Rain, King of the Hill, Pennant Race, Hot Potato, Tag (team formats only) |
| Bots | Real-time bots use the same virtual controller as humans. Room-level route-finding across doors, stairs, ladders, vents and holes; dodge hazards; escape hazard rooms |
| Results | Placement payouts, group score, contained-or-lingers, fire spread |
| Ending | Escape (the house visibly rewinds to its original state) or "The House Wins" |
| Extras | Synthesized sound effects. Title/join screen for 2–4 seats with bot skill. Esc quits to the title |

### 4. Deployment
- `.github/workflows/deploy.yml` does typecheck, test, build and deploy
  with the official Pages actions, in one job of about 40 s.
- Verified: the live site serves the latest bundle, and a bot game runs on
  it with no console errors.

### 5. Testing done
- Headless Chromium playthroughs of every hazard × goal pairing I forced
  through URL flags, plus a keyboard-driven 2-human game.
- A full bot game ran to its end (about round 10), returned to the title
  and started a new game with no console errors. I also checked every
  lingering effect separately with `?linger=...`.
- A subagent code review found 11 issues, all fixed. Among them: lingering
  hazards hit players during board turns, a holding-Enter double-start,
  overlapping meteor holes, duplicate fire spread, and Push Back being
  wasted on a player at the start.

---

## Decisions I made without you (all easy to change)

These were marked "(proposal)" in the design doc. I went with the proposals:
- **Spaces:** blue +3, red −3, shop, repair, toll (5c), shortcut gate (15c,
  opens for everyone), danger.
- **Dice and money:** one d6, starting coins 10.
- **Items:** Double Die (8), Reroll (5), Push Back 3 spaces (8),
  Warp Swap with a random rival (12), Re-spin (6).
- **Perks:** Head Start (5), Spring Boots (5).
- **Payouts:** FFA 10/6/3/1. 2v2: 10 each to winners, 2 to losers.
  1v3: solo wins 15; the trio wins 6 each.
- **Timings:** minigames 40 s, regroup 18 s, round cap 15.
- **Containment bar:** 0.65 group score. I raised it from 0.5 because
  bots were containing almost everything, which kept the house too calm.
- **Group score:** for non-Survive goals it is 60% goal metric and 40%
  "few hazard hits".

## Known gaps / next steps
1. **Balance is untested with humans.** Bot games are a rough guide. The
   main dials are minigame length, containment bar and payouts.
2. **Bots are decent, not great.** They sometimes dither between targets
   or take long routes. Expert difficulty is mostly faster reactions.
3. **No music.** Short sound effects only, and audio starts after the
   first key press (browser rule).
4. **The art is functional programmer art.** It is readable, but it's a
   placeholder for a real pixel-art pass.
5. **Gamepads** were tested only through the code path (Gamepad API), not
   with a physical pad. Keyboard was tested end to end in headless Chromium.
6. **The bundle is about 1.5 MB, mostly Phaser.** It loads fine; it could be
   trimmed later.
7. **Lingering-effect auto-expiry** is deferred, as you asked.

## Useful debug URLs

| URL suffix | What it does |
|---|---|
| `?demo=1&seed=5` | Bots only, fixed seed |
| `?card=fire&goal=king&mg=15` | Force a hazard and goal, shorter minigame |
| `?linger=fire,vines,meteor,stampede` | Start with a wrecked house |

## Actions minutes used
About six runs of 20–45 s each. The repo is public, so Actions minutes
are free anyway.
