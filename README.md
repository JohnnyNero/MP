# TABLETOP

A local 2–4 player party game for the browser, built for a Steam Deck docked to a TV. A cursed board game pulls
everyone into a small destructible 3D arena and deals a disaster. Wobbly bean characters grab, throw, hang and
climb. Survive the round, score points, and win the match.

**Play:** https://johnnynero.github.io/MP/ (deployed by GitHub Actions; the menu is at `/arenas/`)

## How a match works

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
npm test           # unit tests: match scoring, arena layouts, and the parked 2D rules engine
npm run typecheck
npm run build      # dist/ (relative base, works on Pages)
```

- **The game:** `public/arenas/` is plain ES modules with no build step: Three.js and Rapier from a CDN importmap. `kit/` is the shared runtime; each arena is a folder plus a page. See `public/arenas/kit/KIT.md`.
- **Tools:** `tools/` (destruction bake, Blender character pipeline, headless bot probes). See `tools/README.md`.
- **CI:** one job runs typecheck, unit tests, build, a headless arena smoke test (`tools/probes/smoke.mjs`), then deploy.
- **Parked:** `src/` and `legacy.html` are the earlier 2D board game, kept for reference.

### Debug URL parameters (arena pages)

| Parameter | Effect |
|---|---|
| `?bots=all` | Every seat is a bot |
| `?disaster=decompress` | Force the disaster |
| `?seed=N` | Fixed seed |
| `?quality=high` | Never lower quality automatically |
| `?bench=1` | Benchmark round (also on the menu) |

Design docs live in `docs/`. Project conventions are in `CLAUDE.md`.
