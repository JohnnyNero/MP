# TABLETOP

A local 2–4 player party game for the browser. A cursed board game spills
into the house you're standing in. Race to the end of the board while every
danger card you draw floods, burns or overruns the rooms around you.

**Play:** https://johnnynero.github.io/MP/ (deployed by GitHub Actions)

## How a round works

1. **Regroup.** Everyone runs back to the board through the house. Arrival
   order sets turn order, and stragglers are pulled in after the timer.
2. **Board turns.** Roll, move, buy items, pay tolls, open shortcuts and
   repair the house. Danger spaces add cards to the round's pool.
3. **The house stirs.** A roulette picks one card: its hazard plus a random
   goal makes this round's minigame (free-for-all, 1v3 or 2v2).
4. **Minigame** (40 s), played inside the house as it currently is.
5. **Settle.** Coins are paid by placement. If the group does well, the
   hazard is contained; otherwise it lingers and the house gets worse.

First player to reach the end escapes. If nobody does by round 15, the house wins.

## Controls

| | Move | Jump | Action | Back |
|---|---|---|---|---|
| Gamepad | Stick / D-pad | A | X | B |
| Keyboard P1 | WASD | F | G | Q |
| Keyboard P2 | Arrows | K | L | J |

- Climb ladders and stairs with up/down.
- Press down on a vent to crawl through it.
- On the title screen, press jump to join. Empty seats are filled by bots.
  Press Enter with nobody joined to watch an all-bot game.

## Development

```
npm install
npm run dev        # local dev server
npm test           # rules-engine tests (headless game simulations)
npm run typecheck
npm run build
```

### Debug URL parameters

| Parameter | Effect |
|---|---|
| `?demo=1` | Start an all-bot game immediately |
| `?seed=N` | Fixed seed |
| `?card=fire&goal=king` | Force the hazard and goal |
| `?mg=15` | Shorter minigames |

Design docs live in `docs/`. Project conventions are in `CLAUDE.md`.
