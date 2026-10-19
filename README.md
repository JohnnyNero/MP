# TABLETOP

A local 2–4 player party game for the browser, built for a Steam Deck docked to a TV. Wobbly bean characters
grab, throw, hang and climb through a board game set in a real place, with a Mario Party-style minigame after
every turn.

**Play:** https://johnnynero.github.io/MP/ (deployed by GitHub Actions; the menu is at `/arenas/`)

## Pirate Cove (the board game)

A board game played inside a pirate island: walk your spaces around the lagoon, across the stepping stones, or over
the fort and the bridge onto the shipwreck.

1. **Roll:** a die hovers over your head. Jump to hit it. It tumbles for real; if it splashes into the sea it counts
   as a 1.
2. **Walk:** your coloured pegs light up the spaces you can reach, and an arrow marks where your roll ends.
   Everyone walks at once for 8 seconds.
3. **Land:** where you are standing when time is up is where you land. Blue +3 coins, red −3, a treasure chest +6.
   Stop on the star with 10 coins to buy it.
4. **Minigame:** after every turn one is called, and you react from wherever you stand. 1st / 2nd / 3rd earn
   6 / 3 / 1 coins.
   - **Flood!** Get aboard the wreck before the sea takes the island, then survive the waves.
   - **Cannon Fire!** Dodge the shadows; a hit is out.
   - **Captain's Deck:** stay on the wreck's stern deck.
5. Fall in the water and you wash back to your space, minus 3 coins.

Most stars after the last turn wins, then coins. `?turns=N` sets the length (default 10), `?game=flood` always
plays one minigame. **The Playset** is the first test board (a tabletop), kept for practice.

## The disaster arenas

The earlier game, still playable from the menu (it may come back as minigames).

1. **Play a match** from the menu: six rounds that rotate through the arenas.
2. Each round deals a disaster with a warning (glowing circles, lanes, shadows, alarms). About halfway through, a
   second disaster joins.
3. Fall off, drown or drift out of the door and you're out. Everyone still standing at the end ties for first.
4. Points by place: 3 / 2 / 1 / 0. The standings show after every round, and the most points after six wins.

You can also play single rounds of one arena from the menu.

**Arenas:** Sinking Ship, Giant Kitchen, Space Station (Cargo Bay).
**Disasters:** lightning (power surge), meteors (food fight, micrometeors), flood (rogue wave, sink overflow),
stampede (barrels, fruit, runaway cargo), giant stomp (kraken, loader arm), decompression.

## Controls

| | Move | Jump | Grab | Aim (look up/down) | Play dead |
|---|---|---|---|---|---|
| Gamepad | Left stick | A | LT / RT = left / right hand (analog), RB = both | Right stick or D-pad | Hold Y |
| Keyboard P1 | WASD | Space | F or Left Shift | R / V | Q |
| Keyboard P2 | Arrows | `/` or Right Shift | `.` or Right Ctrl | L / , | K |

- Any gamepad button joins. Empty seats are bots.
- To throw, hold something, look up and let go.
- Fell off? Grab the edge, look up and climb back.
- Start or H opens help in the arena.
- Sound starts after a click or keypress (browsers don't count gamepad presses).

## Development

```
npm install
npm run dev        # local dev server (open /arenas/)
npm test           # unit tests: board rules, match scoring, arena layouts, and the parked 2D rules engine
npm run typecheck
npm run build      # dist/ (relative base, works on Pages)
```

- **The game:** `public/arenas/` is plain ES modules with no build step: Three.js and Rapier from a CDN importmap. `kit/` is the shared runtime (`engine.js` runs a mode: the board or the disaster round); `board/` is the board game and its minigames, `cove/` the Pirate Cove map; each arena is a folder plus a page. See `public/arenas/kit/KIT.md`.
- **Tools:** `tools/` (destruction bake, Blender character pipeline, headless bot probes). See `tools/README.md`.
- **CI:** one job runs typecheck, unit tests, build, a headless arena smoke test (`tools/probes/smoke.mjs`), then deploy.
- **Parked:** `src/` and `legacy.html` are the earlier 2D board game, kept for reference.

### Debug URL parameters (arena and board pages)

| Parameter | Effect |
|---|---|
| `?bots=all` | Every seat is a bot |
| `?disaster=decompress` | Force the disaster |
| `?seed=N` | Fixed seed |
| `?quality=high` | Never lower quality automatically |
| `?bench=1` | Benchmark round (also on the menu) |
| `?shake=off` | No camera shake |
| `?turns=N` | Board: game length in turns |
| `?game=flood` | Board: always this minigame (`games=0` for none) |

Design docs live in `docs/`. Project conventions are in `CLAUDE.md`.
