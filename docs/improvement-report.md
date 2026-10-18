# TABLETOP improvement report

Scope: rules engine (`src/core`), content, goals/hazards, GameScene/TitleScene and touch input. This report assumes the parallel work already under way: full-strength lingering hazards, normal doorways in Gravity Flip, the 16-bit art pass and `DerivedHouse.damage`. Numbers marked *(est.)* come from reading the code, not from playtests.

## Top 10 recommendations

| # | Change | Why | Effort | Files touched |
|---|---|---|---|---|
| 1 | Score containment per hazard. Blackout, Gravity and Monkeys count "exposure" instead of hits, and Tag gets a real group score | Today 3 of 8 hazards and all of Tag are contained almost automatically | S | `GameScene.ts` (minigame groupScore), `hazards.ts`, `goals.ts` (Tag) |
| 2 | Repair pays the repairer: +2 board spaces or +5 coins back, and the price scales with the effect's age | Repair is a pure public good at 10c, so nobody pays and full-strength lingering hazards snowball | S | `game.ts` (passOrLandService), `content/board.ts`, `bots.ts` |
| 3 | Cap fire spread: at most 1 spread per settle, and 0.4 drops to 0.25 | n fires each roll 40%, which grows exponentially now that every fire runs at full strength | S | `content/cards.ts`, `game.ts` (settle) |
| 4 | Make rounds longer and give players more to do: press-to-roll, a 12–14 round board | Est. 90–100 s per round × 10 rounds ≈ 16 min, about half the 30–45 min target | M | `content/board.ts`, `game.ts`, `GameScene.ts` |
| 5 | Add red spaces, from 10% to about 25% | 1v3 comes up about 48% of the time in 4-player games and 2v2 only about 24% *(est.)* | S | `content/board.ts` |
| 6 | Price and item fixes: toll 5→8, Re-spin lets you veto a card, Warp Swap targets the leader | The toll is the best buy in the game, and Re-spin is close to useless | S | `content/board.ts`, `content/cards.ts`, `game.ts` |
| 7 | Catch-up: last place rolls d6+1, and the first-arrival bonus goes to whoever is furthest behind | There is no catch-up now. FFA 10/6/3/1 payouts and the arrival bonus all feed the leader | S | `game.ts` (startRound, rollDie) |
| 8 | Destructible rooms using the "Wear → Collapse eats the clock" rule set (§4) | Makes damage matter with a single loss condition | M | `types.ts`, `house.ts`, `game.ts`, `houseView.ts` |
| 9 | A guided first round plus control glyphs in the world | The rules are explained once, in 6–7 px text, on a 1.8 s banner | M | `GameScene.ts`, `TitleScene.ts`, `ui.ts` |
| 10 | Readability: minimum font of 8 px, icon-based HUD, results that show the board delta | 6 px HUD and help text can't be read at 480x270 on a TV | M | `GameScene.ts` (buildHud/updateHud), `TitleScene.ts:62` |

## 1. Gameplay and balance

### Pacing
- **Rounds are too short.** Estimated round cost *(est.)*:
  - regroup ≤18 s (`REGROUP_SECONDS`, `config.ts:26`)
  - board turns ≈3 s each: 0.5 s intro + 1 s roll + about 3.5 × 170 ms steps (`boardPanel.moveToken`) + about 0.6 s landing
  - house turn about 7 s
  - minigame 1.8 + 40 + 0.9 s
  - results ≤5 s

  That totals roughly 90–100 s per round. With an average of 10.1 rounds a game runs about 16 min.
- **Fix with agency, not filler.**
  1. Press-to-roll for humans: a stop-the-die timing beat, as in MP. `takeTurn` already yields `preRoll`, so always yield it for humans.
  2. Raise the board length so games average 12–13 rounds. The short route is 41 spaces (A10+T5+B10+X4+C12, `content/board.ts:67-75`) and the long route is 52. Add about 8 spaces, mostly to C.
  3. Vary minigame length by goal: Potato 30 s, King 45 s.

  Target about 150 s per round × 12 rounds ≈ 30 min.
- **About 41% of rounds have no hazard** *(est.)*. About 20% of spaces are danger spaces, so P(no draw with 4 players) ≈ 0.8⁴. In 2-player games it is about 64%. Scale danger draws with player count: with 2–3 players, also draw a card when a red space is hit.

### Coin economy and prices
- **Income.** FFA pays 20 coins per round across 4 players (`game.ts:418`). Blue spaces add +3. Each player earns about 6–7c per round, against a 10c start.
- **Toll (5c) saves 6 spaces** (T5 vs L11). That beats Double Die (8c for +3.5 avg). The toll route also skips the only repair space on the first fork (L7). Raise the toll to 8c, or move a repair space onto T.
- **Gate (15c, opens for everyone)** saves 5 spaces (N9 vs X4) and also skips repair space N6. Whoever opens it pays to help everyone behind them. Proposal: the opener collects 2c from each later user. Store this in `state.openGates` as `{space, owner}`.
- **Re-spin (6c)** draws another uniformly random index (`game.ts:400`), so it isn't really steering. Change it to "veto one card from the pool". Bots then have a real decision to make.
- **Warp Swap (12c)** swaps with a *random* rival (`game.ts:236`). Too random to buy on purpose. Target the leader, or let the player choose at 15c.

### Repair incentives (full-strength lingering)
- **Current state:**
  - flat `REPAIR_COST = 10` (`content/board.ts:100`) for any effect
  - only 3 repair spaces: L7, N6, C6
  - the cheap routes skip two of them
  - bots repair only at ≥3 effects (`bots.ts:68`)

  With full-strength lingering effects, this is a snowball with no brake.
- **Proposals, in priority order:**
  1. **Repair reward.** The repairer moves +2 spaces, or gets 5c back. This turns repair from charity into a tempo play. One line in `passOrLandService`.
  2. **Containment bounty.** When a group contains a hazard, the top placer gets +3c. This rewards playing for the group.
  3. **"House tax".** Each red space also pays 1c into a shared repair pot. Land on repair and the pot pays for the fix. Add this as `state.repairPot`.
- **Bots** should repair when an effect touches the board room or their route (`reachable()`), or when `effects.length × 2 ≥ roundsLeft`.

### Minigame variety and repetition
- **There are 6 goals, and all of them are "move around the same 9 rooms for 40 s".** The goal is chosen uniformly (`planHouseTurn`) with no memory. Add a no-repeat window: exclude the last 2 goals.
- **`incompatibleGoals` is never set by any card** (`content/cards.ts`). Use it, or better, make goals *use* the hazard:
  - Collect, King and Race should place objectives in `plan.rooms` 50% of the time
  - `randomRoomPoint` (`goals.ts:19`) ignores hazard rooms entirely, so Meteor (always floor 2) is irrelevant whenever the objective is on floors 0–1

### Hazard × goal duds
- **Tag**: `groupScore()` returns a constant 0.6 (`goals.ts:399`). Containment then depends only on hazard hits. Use tags per runner.
- **Blackout, Gravity and Monkeys record no `hazardHits`** (`hazards.ts:290,325-327`). The 40% hazard term (`GameScene` minigame, `0.6*goal + 0.4*(1-hits/(n*4))`) is a free 0.4, so containment only needs a goal score of ≥0.42. Count "seconds spent in the hazard room" (or coins stolen) as exposure.
- **Flood ignores `rooms`** and floods the whole ground floor (`hazards.ts:18`). The board starts in `living`, on the ground floor. A lingering flood therefore taxes every regroup, and two lingering floods stack water overlays. Make flood idempotent per floor in `LingeringSystem`.
- **Survive**: lingering hits use `lingerCtx.hazardHits` (`hazards.ts:360`), so they also don't count toward Survive's *individual* score. A player standing in lingering fire loses nothing. Count them for the individual score only.

### Bots and catch-up
- **No rubber-banding.** First-arrival +2 (`game.ts:106`) and the FFA payouts both reward the leader.
- **Proposals:**
  - last place on the board rolls d6+1
  - 1v3 solo payout 15/0 becomes 15/3, so the solo isn't wiped out
  - a "Comeback" space type (§3)
- **One `difficulty` for every bot** (`TitleScene.ts:100`). Allow it per seat.
- The 30 s menu timeout (`GameScene.ts:529`) should drop to 15 s, with a visible countdown.

## 2. UX and onboarding

- **First-time understanding.** The premise sits in one 1.8 s banner (`runGame`). Add a scripted **round 0**, about 60 s:
  1. walk to the board (teaches movement, ladders and the vent)
  2. one roll
  3. a 15 s Apple Rain with no hazard
  4. a results card that explains containment with an arrow to the lingering room

  Make it skippable, and on by default for new seats. Store the flag in `localStorage`, wrapped in try/catch.
- **Learning the controls.** Show glyphs in the world ("▲ climb" at ladders, "▼ vent", "A" at the board) instead of 6 px title help (`TitleScene.ts:56-62`).
- **Readability at 480x270.**
  - The HUD is 6 px (`buildHud`), with item letters "DRPW".
  - Use 8 px minimum, coin icons, and item icons from the art pass.
  - Move the minigame scoreboard out of `centerText` into per-player corner chips.
  - The roulette's card names wrap at 7 px in boxes up to 90 px wide (`GameScene.ts:570-574`). Show icon plus name.
- **Feedback and juice:** the results card is a text list. Animate coins flying to the HUD, tween a group-score bar up to the 0.65 line, and flash the room that was CONTAINED or LINGERS (`GameScene.ts:688-691`). Add a 60 ms hit-stop on stun.
- **Menus.** The repair label should say what fixing it does ("unblocks stairs").
- **Mobile single-player.**
  - Only one `touch` source exists (`touch.ts:39`). Default to 1 human + 3 bots, and skip the join step when on touch.
  - Make menus tappable: `Menu` items need pointer handlers.
  - Add `navigator.vibrate(20)` on hits and buttons.
  - The vertical dead zone of 0.35 (`touch.ts:96`) makes ladder grabs sticky. Use 0.25, and auto-climb when the stick is held up within 6 px of a ladder.
- **Controller feel.** Add coyote time (80 ms), jump buffering (100 ms) *(speculative: not checked in `avatar.ts`)* and `gamepad.vibrationActuator` rumble on stun.

## 3. New content (grounded, reuses existing systems)

- **Hazards:**
  - **Termites:** random room; dust telegraph, then floor sections drop. Lingers as a hole (reuse `makesHole`) and +1 damage.
  - **Gale:** a floor-wide sideways push. Reuses `knockX` and `slow`.
  - **Bees:** chase like Monkeys but stun instead of steal. Reuses the `Monkeys` class with a flag.
  - **Earthquake:** whole house, brief; adds +1 damage to the 2 most damaged rooms. Pairs with §4.
- **Goals:**
  - **Bucket Brigade:** carry water from the bathroom to fires. The group score is fires put out, which links containment directly to play.
  - **Fetch:** carry items back to the board prop. Uses the board as a prop, as the design promises.
  - **Patch-Up:** hammer damaged rooms (see §4).
- **Items:**
  - **Toolkit** (8c): next repair costs half.
  - **Insurance** (4c): blocks one red-space loss or monkey theft.
  - **Golden Die** (14c): choose 1–6.
- **Space types:**
  - **Event** (`?`): MP-style chance, e.g. swap coins with last, move the board prop, or contain one effect for free.
  - **Comeback:** +5c for last place only.
  - **House space:** the lander picks the room the next hazard targets.
- **Houses and boards:**
  - A **Mansion** (4 columns × 3 floors, with an elevator connection that has a timer) as house 2.
  - A **Cabin** (2 × 2) for 2-player games, to keep the regroup short. Both are data changes in `content/house.ts` and `content/board.ts`.

## 4. Destructible rooms

`deriveHouse` currently sets damage = min(3, number of effects in the room) (`house.ts:41`). This is cosmetic, and it heals the moment an effect is repaired.

### A. "Intensity" (derived only, cheapest)
- **Cause:** as now, effects in the room.
- **Effect:** hazard spawn rate × (1 + 0.25·damage), and run speed −5% per level.
- **Repair:** removing the effect clears its damage.
- **Collapse:** none.
- **Verdict:** almost free to build, but it's a second snowball on top of full-strength lingering effects. **No.**

### B. "The house eats the board"
- **Cause:** a room reaches 3 damage.
- **Effect:** one blue space on the board turns red (MP4's global retype) for each wrecked room.
- **Repair:** lowering the room below 3 restores the space.
- **Collapse:** all 9 rooms wrecked = the house wins.
- **Verdict:** a clear link between the house and the board. Collapse is unreachable in practice, and the room itself plays the same. **Maybe later.**

### C. "Wear → Collapse eats the clock" (recommended)
- **Cause:** persistent scars, kept separate from effects so repairing an effect doesn't erase them.
  - +1 to each target room when a hazard is **not contained**
  - +1 at settle to each room that has hosted a lingering effect for ≥2 rounds
  - Stored as `GameState.scars: {room, round}[]`. Damage = min(3, scars in the room + 1 if any effect is active there), still derived in `deriveHouse`.
- **Effects by level:**
  - **1, Cluttered:** `cluttered` tag, speed ×0.9.
  - **2, Shaky:** on floors 1–2, a hole opens to the room below (reuse the `lingerEffect` hole logic). Ground-floor rooms instead get one connection blocked.
  - **3, Collapsed:** every connection into the room is blocked, and goals and spawns skip it (`randomRoomPoint`, `safeRoomGoal`). If it is the board room, the board moves (reuse `boardTo`). **Each collapsed room lowers `roundCap` by 1.**
- **Repair:** the repair menu gains "Patch a room: −1 damage, 5c" next to "Fix effect, 10c". A contained hazard also heals 1 damage in its target rooms.
- **Collapse guard:** never collapse a room if `reachable()` from the board room would drop below 6 rooms. Hold it at 2 instead.
- **Why:** it reuses holes, blocked connections, `boardTo` and the round cap; keeps one loss condition (the clock), which damage visibly shortens; gives repair a cheap option; and never makes the house unplayable.
- **Tuning target** *(speculative)*: about 1–2 collapses per game.
