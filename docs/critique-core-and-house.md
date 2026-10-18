# Critique: the core game and the house

Each mechanic is checked against shipped precedents, given a one-sentence rule, and checked for whether it creates a real decision.

---

## Part 1: The core game

### The skeleton

A **Mario Party board race** in which every danger space you land on drops a hazard into the real house you're standing in. The **minigame is played inside that wrecked house**.

The novelty slot is already spent: *the board game physically changes the arena* (Jumanji/Zathura). Everything else should be proven and boring.

### Mechanic review

| Mechanic | Rule (1 sentence) | Precedent | Decision it creates | Verdict |
|---|---|---|---|---|
| Board race with forks, tolls and a shortcut gate | Roll, move, pick a fork; pay to take faster routes. | Mario Party, Snakes & Ladders, Monopoly (paying for position) | Coins vs. tempo at forks | **KEEP** |
| Danger card → roulette → hazard minigame | Danger spaces add cards, and one becomes this round's hazard. | Mario Party event spaces; Smash Bros stage hazards and item toggles | Little: drawing a card is luck | **KEEP** (this is the twist) |
| Hazard × goal mix | Any hazard can combine with any goal. | Smash rule sets, Fall Guys round variants | None for players; it's variety | **SIMPLIFY**: curate a whitelist of pairs |
| Lingering hazards (full strength) | Uncontained hazards stay in the house until repaired. | Pandemic outbreaks, Forbidden Island flooding | Spend on repair or on yourself | **KEEP** |
| Repair (+2 spaces reward) | Pay at a Repair space to clear a hazard and fix the room. | Pandemic "treat disease", Mario Party lucky spaces | Public good vs. tempo | **KEEP** |
| Group score / containment | Play well as a group or the hazard lingers. | Dead of Winter (shared goal inside competition), Overcooked | Help the group vs. sabotage a rival | **KEEP**, but it's invisible during play (see risks) |
| Regroup race → turn order | Arrival order at the board is turn order. | Musical-chairs races (Mario Party 1st-to-arrive minigames, Fall Guys race rounds) | Route choice through a wrecked house | **KEEP** |
| Space colours → FFA / 1v3 / 2v2 | Landing colours set the minigame teams. | Mario Party | None (pure luck) | **KEEP** (players expect it) |
| Coins → items, perks, tolls, gate, repair | Coins buy everything. | Mario Party, Monopoly | Many small spends | **SIMPLIFY**: 5 sinks is too many |
| Perks (Head Start, Spring Boots) | One-shot boost for the next minigame. | Mario Party Superstars Lucky Spaces (loosely) | Barely: minigame type is unknown when you buy | **CUT** (blind decision) |
| Catch-up: +1 roll for a lone last place, arrival bonus to the trailer | Last place gets small boosts. | Mario Kart items, Mario Party bonus stars | None (automatic) | **KEEP** |
| Round cap: the house wins | Nobody finishes by round 15 and everyone loses. | Forbidden Island (shared loss) | None. In sims the house wins about 1 game in 300 | **SIMPLIFY or CUT**: the threat isn't real |

### The top three cuts or fixes

1. **The minigame barely decides the race.**
   - The winner is whoever reaches the end, and the minigame only pays coins that buy indirect things.
   - In Mario Party, minigame coins buy stars, which *are* the score. Here dice and forks dominate, so a player can win the minigames and lose the game.
   - **Fix (proven):** let minigame placement grant **movement**. 1st place moves +3 at the start of next round, 2nd +1, as in Mario Kart's position-based items run in reverse. Or sell dice upgrades in the shop as the main coin sink. Either way, winning a minigame should *feel* like progress on the board.
2. **Cut the perks.** You buy them before you know the next minigame, which is a blind decision. Fold Spring Boots into the item list as a board item, or delete both.
3. **Make the shared loss real, or remove it.**
   - "The house wins" almost never happens, so it adds rules without tension.
   - **Option A (recommended): tie it to destruction.** The house wins if **N rooms are wrecked at once** (shown by the house itself, not a meter). That gives repair real urgency and uses the damage system you're building.
   - **Option B:** delete the round cap and accept that the game always has a winner.

### Smaller issues

- **Hazard × goal duds.** Some pairs are poor, e.g. Blackout + Pennant Race (you can't see the pennant), and Stampede on the top floor + King of the Hill on the ground floor (the hazard is irrelevant).
  - Replace the free mix with a **hand-picked compatibility list** per hazard.
  - The data already supports `incompatibleGoals`, but it's unused.
- **Containment is invisible while you play.**
  - The group score appears only on the results screen, so a player can't steer toward "help the group" mid-game.
  - Show a live "CONTAINMENT" meter during the minigame. Overcooked shows the shared score live, and this is the same idea.
- **Space colours are pure luck.** That's fine (it's Mario Party), but they could double as information. Show which colour you'll be *before* you pick a fork, so routes have a team-play angle.

### Code critique (`src/core`)

**Good:**
- Pure, deterministic and serializable.
- `takeTurn` as a generator is the right pattern (MP4's coroutines, done cleanly).
- `deriveHouse` keeps the house a pure function of the effects.

**Problems:**
- **`game.ts` is 600 lines** covering setup, turns, items, the house turn, settle and catch-up. Split it into `turn.ts`, `houseTurn.ts`, `settle.ts` and `items.ts` before more rules land.
- **The balance sim lies.** `sim.ts` `fakeMinigame()` uses random scores and a random group score, so tuning containment, catch-up or coin flow in the headless sim tells you nothing about skill.
  - Model it simply: each bot's score is its difficulty plus noise, and the group score is the mean difficulty plus noise.
  - Then the 300-game sims mean something.
- **Some view geometry has leaked into the game layer and some rules into the view.**
  - The meteor hole's x-position is decided in `houseView.ts` (room centre + 28).
  - Gravity's "exit zone" lives in `GameScene`.
  - Room damage is derived in core but has no rules yet.
  - As destruction becomes real, **room geometry needs to move into content data** (see Part 2). Otherwise the core can't reason about holes, chunks or routes.
- **`MinigamePlan` carries presentation data** (`rouletteOptions`, `vetoedIndex`). That's acceptable, but keep new UI-only fields out of core types.
- **No save/load yet.** It's cheap to add because `GameState` is plain JSON, and it would help testing (load a mid-game state from a URL).

---

## Part 2: The house

### What's wrong with the house now

1. **It's a 3×3 grid of identical boxes.** Every room is the same size and shape, so no room *plays* differently except through hazards. Wallpaper is the only difference.
2. **Vertical travel is fixed.** There are one staircase, three ladders and a vent, and the routes are learned in one game.
3. **Everything converges on one spot.** The board sits ground-centre, so the top floor only matters during minigames, and the regroup is the same short race every round.
4. **There's no inside/outside.** The house never opens to a yard or roof, so there's nowhere to *go* when it's wrecked.

### Make it more interesting: room tiles

**The proven move: build the house from room tiles of different shapes, and lay out a different house each game.**

**Precedent:**
- **Betrayal at House on the Hill:** the house is assembled from room tiles as you explore.
- **Castles of Mad King Ludwig:** rooms of different shapes and sizes snap together.
- **Spelunky:** levels are stitched from authored room templates.

In all three, the authored pieces stay hand-made and only the assembly varies.

**Rule (1 sentence):** each game the house is assembled from a deck of hand-made room tiles that come in a few sizes.

**Tile shapes, all on a grid** (one cell = today's room, 160×80):

| Tile | Footprint | Why it plays differently | Example |
|---|---|---|---|
| Standard | 1×1 | Baseline | Bathroom, kids' room |
| Wide | 2×1 | Long open floor: stampedes and races shine | Living room, garage |
| Tall (double-height) | 1×2 | Has a **balcony/mezzanine** halfway up; vertical fights, falls | Entry hall with a grand staircase |
| Stairwell | 1×2, narrow | The main vertical artery; when it's blocked, routes change dramatically | Stairwell |
| Attic | 2×1 under the roof slope | **A sloped ceiling**: low headroom at the edges, so you can't jump there | Attic |
| Basement | full-width −1 floor | Floods first, dark by default | Basement |
| Outside | Yard and roof | Out of the house: a safe-ish detour, rain, a long way round | Yard, roof |

**Connectors with distinct behaviours.** Keep each one to a one-line rule:
- **Laundry chute:** a fast drop only.
- **Dumbwaiter:** a small 2-stop lift. You stand in it and it moves, the same as a vent but slower.
- **Fireman's pole:** slide down quickly; you can't go up.
- **Window ledge:** step outside onto the roof or yard and walk round the outside.
- **Trapdoor:** a hole you can open or close by pressing action.

**What it costs:** the house layout must become data with geometry: each tile defines its platforms, door sockets and connector sockets. The engine already has most of the pieces (rooms, connections, nav graph, climbables). The work is:
1. Content: tile definitions with geometry.
2. A layout assembler (a fixed template per game is fine at first, randomize later).
3. `houseView` and `houseArt` reading geometry instead of the 3×3 constants.
4. Bots: the nav graph already generalizes.

That is a **medium–large** refactor, and it is also exactly what *Finals-style* destruction needs. Breakable chunks must belong to tile geometry, not hard-coded constants.

**Smaller first step:** keep the 3×3 grid but replace three rooms with special tiles:
1. A **double-height entry hall** with a balcony, replacing living room + bathroom.
2. A **sloped attic**.
3. A **basement** under the ground floor.

That gets 70% of the variety at 30% of the cost.

---

## Part 3: A personal twist, "Your Room"

Players should care about one room. Here are three candidates, filtered, then one recommendation.

| Idea | Rule | Precedent | Decision | Verdict |
|---|---|---|---|---|
| **Aim your cards** | When you draw a danger card, you choose which rival's bedroom it hits. | Catan robber placement, Mario Party Bowser/Boo steal | Who to hurt | **PARK**: strong, but adds kingmaking |
| **Home perk** | Your bedroom intact gives you a passive bonus, e.g. respawn there. | Tower-defence home base, Overcooked's kitchen as a "base" (loosely) | Weak: a passive bonus isn't a decision | **CUT** |
| **The stash** | Bank coins in your bedroom; they're safe until your room is wrecked, then they burst out for anyone to grab. | **Rust/Clash of Clans** (raid stored loot), **Lethal Company/Hunt: Showdown** (bring loot back to base), **Sonic** (rings spill when hit) | Bank (safe, but a detour) vs. carry (spendable, stealable) | **KEEP (recommended)** |

### Recommended: "The Stash" (one sentence)

> **Coins you drop off in your bedroom are safe from monkeys and red spaces, but if your bedroom gets wrecked, your stash bursts out across the floor for anyone to grab.**

**How it plays:**
- **Each player owns one bedroom.** It's a room tile in their colour, with their name on the door. Their avatar respawns or starts there.
- **Banking happens during the regroup race.** Detour through your bedroom to drop off coins: banking is automatic when you pass through. You can only spend coins you **carry**, so to spend banked coins you walk back and pick them up.
- **The trade-off is a real decision every round:**
  - Detour home to bank: your coins are safe, but you arrive at the board later, so you go later in turn order.
  - Run straight to the board: you go early, but carried coins can be stolen or lost on red spaces.
- **Destruction gets a purpose.** When a hazard or (later) a *Finals-style* attack wrecks someone's bedroom, their stash spills as coins that anyone can grab in the next minigame. That gives players a reason to **destroy rival rooms**, and that is your deferred "what causes damage" question, answered.
- **Repair becomes personal.** You'll pay to repair *your* bedroom even when you wouldn't fix the kitchen.

**Why it's the right twist:**
- It uses **existing systems only**: coins, rooms, damage, regroup, minigame pickups. There's no new currency; it's the same coins held in a different place.
- It creates a decision in a phase that currently has none (the regroup is just "run to the board").
- Its feedback loop is deliberate. Banking protects leaders (snowball), but spilled stashes are a big catch-up swing (stabilizing), because the trailing player can raid the leader's room.

**Risks:**
- **Turtling.** Players might always bank. Counter: banked coins can't buy anything until they're carried back out, so hoarding has an opportunity cost.
- **Bedroom placement fairness.** A room far from the board is a handicap. Put all bedrooms on the same floor, or roughly the same distance from the board, or let the board move.
- **2–3 player games** leave empty bedrooms. Those rooms become neutral rooms.

---

## What I'd do next (in order)

1. **Minigame → movement** (Part 1, fix 1). Small, and it fixes the biggest design hole.
2. **The Stash**, using today's 3×3 house: assign 4 rooms as bedrooms. Medium, and it delivers the personal attachment now.
3. **Destruction causes**, built on the Stash: wrecking a bedroom spills its stash.
4. **Room tiles**, starting with the "smaller first step" three special tiles, then the full tile system.
5. Cut perks, curate hazard × goal pairs, and show a live containment meter.
