# Game design proposal (v2)

Working title: **TABLETOP** (placeholder).

A local, competitive party game for 2–4 players in the browser. Players race
along a cursed board game while the board unleashes effects into the house
they are physically in. The house is a 2D side-cutaway diorama. Each round
ends with a Mario Party-style minigame, played inside the house as it
currently stands. First to the end of the board wins. If the house falls
apart first, **everyone loses**.

Structural reference: [`mp4-cleanroom-analysis.md`](mp4-cleanroom-analysis.md).

> **How to read this doc.** Section 1 records decisions you've made.
> Anything marked **(proposal)** is my suggestion and needs your sign-off.
> Anything marked **(tune)** is a number we deliberately won't decide until
> playtesting. Section 13 lists what's still open.

---

## 1. Locked decisions

| Topic | Decision |
|---|---|
| Platform | Web (browser) |
| Stack | TypeScript + Phaser |
| Play | Local, shared screen |
| Input | Gamepads primary (browser Gamepad API, up to 4); keyboard fallback |
| Players | 2–4; CPU bots fill empty seats from day one |
| Mode | Competitive race, with a shared loss condition (doom meter) |
| Win | First piece to reach the board's final space |
| Shared loss | Doom meter fills, so all players lose. Always visible |
| Length | 30–45 min, about 10–12 rounds |
| View | 2D side cutaway (dollhouse cross-section), pixel art |
| House | Medium: about 9 rooms over 3 floors; one house for v1 |
| Avatar movement | Platformer: run, jump, gravity, stairs/ladders |
| Board as prop | The board is a physical object in the house. Every round starts with everyone walking back to it, and minigame goals can use it |
| Turn order | Set by arrival order at the board during the regroup walk |
| Card trigger | Only dedicated **danger spaces** draw effect cards |
| Which card plays | Roulette picks one of this round's drawn cards. The others are **discarded** |
| No card drawn | Generic minigame in the house as it currently stands |
| Minigame form | **Hazard × goal mix**: the card supplies the hazard, and a goal (survive, collect, hold the flag…) is drawn separately |
| Minigame teams | MP-style formats (4-player FFA / 1v3 / 2v2), decided by the space each player landed on |
| Minigame reward | Currency (coins) |
| Effect targeting | Some cards name their room or area; others pick a random room |
| Effect persistence | Stays until paid off (repair) or **contained** by a good group result. Auto-expiry after X rounds is deferred until playtesting |
| Doom sources | Poor group minigame performance **and** lingering effects |
| Coin sinks | Items, house repair, minigame perks, toll gates and shortcuts |
| Agency | Mainly from winning minigames, which earns coins to spend |

---

## 2. The round

```
┌────────────────────────── ROUND n ───────────────────────────────┐
│ 1. REGROUP  (real-time, house)                                   │
│    Everyone walks/jumps back to the board from wherever the last │
│    minigame left them. Arrival order = turn order this round.    │
│                                                                  │
│ 2. BOARD TURNS  (turn-based, at the board, in arrival order)     │
│    roll → move piece → resolve space (coins, shop, toll, danger) │
│    Danger space → draw an effect card into this round's pool.    │
│                                                                  │
│ 3. HOUSE TURN  (cutscene)                                        │
│    pool empty   → generic minigame                               │
│    pool ≥1 card → roulette picks one card; the rest are discarded│
│    picked card's hazard lands in its room (named or random)      │
│    goal drawn; format (FFA/1v3/2v2) from landed-space colours    │
│                                                                  │
│ 4. MINIGAME  (real-time, house, ~30–60s (tune))                  │
│    hazard + goal + every lingering effect already in the house   │
│                                                                  │
│ 5. SETTLE                                                        │
│    coins paid by placement                                       │
│    group score ≥ containment bar → new effect contained (gone)   │
│    otherwise it lingers                                          │
│    doom += f(group score, lingering effects)                     │
│    doom full → everyone loses                                    │
└──────────────────────────────────────────────────────────────────┘
```

**Pacing check (proposal):** at 30–45 minutes over 10–12 rounds, a round
lasts about 3–4 minutes. A rough budget:
- regroup: 15–20 s
- board turns: about 4 × 25 s
- house-turn cutscene: 15 s
- minigame: 45 s
- settle: 15 s

This budget is the main constraint on how long every animation is allowed to run.

---

## 3. The board

A directed space graph, MP4-style: spaces with a type, tags and outgoing
links, plus forks.

**Space types**

| Type | Status | Effect |
|---|---|---|
| Danger | locked | Draws an effect card into the round's pool |
| Blue (+coins) / Red (−coins) | proposal | MP4's coin spaces. Also gives each player a "colour" for picking the minigame format (see §5.3) |
| Shop | proposal | Buy items |
| Repair | proposal | Pay to clear a lingering effect or reduce doom. Or should repair happen anywhere, at any time? (open, §13) |
| Toll gate | locked as a sink | Pay to pass, or take the long way |
| Shortcut | locked as a sink | Pay to open a faster branch |
| Final space | locked | Reaching it wins |

**Movement (proposal):** one standard d6 per turn. Items change dice. Passing
a shop or toll triggers its event during movement (MP4's "passing" hook);
landing resolves the space.

**Finish rule:** does a player need an exact roll to land on the final space,
or is passing it enough? (open, §13)

**Length:** tune the path length and forks so a typical game ends in 10–12
rounds.

---

## 4. The house

- **Layout:** a side cutaway with 3 floors and about 9 rooms, connected by
  doors, stairs/ladders and maybe vents (open, §13).
- **The board** sits on a table in one room. Where that room is decides how
  long the regroup walk takes from each part of the house. Can effects move
  the board? (open, §13)
- **Room tags** carry state, e.g. `wet`, `dark`, `overgrown`, `burning`,
  `zero_g`. Lingering effects set tags, and both minigames and the regroup
  walk read them.
- **Connections** can be blocked (vines on the stairs, a collapsed floor).
  A blocked connection reshapes routes for the regroup walk and for minigames.

The house is a **platformer level that changes over the whole game**. Every
lingering effect makes it a little more hostile, which is the Jumanji feel,
and it is also why repair spending matters.

---

## 5. Effects and minigames

### 5.1 Effect cards (hazards)

Each card defines:
- a **hazard**: what physically happens during the minigame
- **targeting**: either a named room or area, or "random room"
- a **lingering state**: the tags or blocked connections it leaves behind if
  it isn't contained
- a **doom weight**: how much pressure it adds each round while it lingers
- **compatible goals** (optional): goals this hazard shouldn't be paired with.
  This reduces dud combinations in the hazard × goal mix

**Proposed starter hazards (mixed themes, proposal):**

| Hazard | Targeting | Minigame behaviour | If it lingers |
|---|---|---|---|
| Flood | Ground floor | Water rises, slows movement, eventually drowns | Ground floor `wet` (slippery) |
| Meteor shower | Top floor | Telegraphed impacts; a hit means stun | A hole in the floor: new drop connection |
| Vine growth | Random room | Vines spread and entangle | Blocks one connection |
| Stampede | Random floor | A herd runs across the floor; knockback | Furniture debris on the floor |
| Blackout | Random room | Vision radius only | Room `dark` |
| Gravity flip | Random room | Gravity inverts inside the room | Room `zero_g` |
| Fire | Random room | Spreads to neighbours | Room `burning`: spreads each round unless repaired |
| Monkey thieves | Random room | Monkeys steal coins from players they touch | Monkeys stay and steal from anyone who passes through during the regroup walk |

### 5.2 Goals

**Proposed starter goals (proposal):**

| Goal | Scoring |
|---|---|
| Survive | Last standing, or least time stunned |
| Collect | Most items caught (apples, coins, gems) |
| King of the hill | Most time holding a zone or the flag |
| Race | First to reach a target (e.g. the board itself) |
| Hot potato | Don't be holding the thing when the timer ends |
| Tag | 1v3 friendly: "it" vs the rest |

**Combining them:** a goal is drawn at random, and incompatible pairings are
filtered out. Every goal must work with every format (FFA, 1v3, 2v2), or say
which formats it supports.

### 5.3 Format (FFA / 1v3 / 2v2)

MP4 uses the colour of the space each player landed on. **Proposal:**
- blue = team A, red = team B
- danger, shop and other spaces are "neutral" and get filled in randomly,
  weighted toward balance
- the result is 4 matching → FFA, 3+1 → 1v3, 2+2 → 2v2
- with 2 or 3 players: always FFA, or a 1v2 format for 3 players? (open, §13)

### 5.4 Containment and the group score

Each minigame produces:
- an **individual placement**, which pays coins
- a **group score**, e.g. total apples caught or total survivors, normalized 0–1

If the group score clears the card's **containment bar** (tune), the effect
disappears instead of lingering. This is the shared-stake beat inside a
competitive game: sabotaging a rival can also sink the group score.

---

## 6. Economy (coins)

**Sources (proposal):**
- minigame placement payout (main source)
- blue spaces
- small bonuses, e.g. first to arrive at the regroup

**Sinks (locked list; specifics proposed):**

| Sink | Examples (proposal) |
|---|---|
| Items | Double die; reroll; "steer the roulette" (re-spin once); push a rival's piece back 2; shield from one effect |
| Repair | Clear one lingering effect; lower doom by N |
| Minigame perks | Buy a head start, a better spawn point, or a one-use tool for the next minigame |
| Tolls / shortcuts | Pay to pass a gate; pay to open a shortcut branch |

**Core tension:** repair is a public good. Every coin spent on repair is a
coin not spent getting ahead. If nobody repairs, everyone loses. That
tragedy-of-the-commons pull is the heart of the competitive-but-shared design.

---

## 7. Doom meter

- Always on screen, and a full meter means everyone loses.
- **Each round:** doom goes up by the sum of the doom weights of lingering
  effects, plus a penalty when the group score is poor (both tune).
- **Goes down:** through repair (coins) and containment (a good group score
  stops an effect from adding doom in future rounds).
- **Visible feedback in the house as it climbs (proposal):** cracks, light
  flicker, background shake. Purely cosmetic and driven by the doom value.

---

## 8. CPU bots

Bots ship from day one, following MP4's pattern:
- **Bots produce virtual controller input.** The board, the regroup walk and
  every minigame run the same code for bots and humans.
- **Difficulty** is a mistake chance plus reaction delay (tune).
- **Board decisions** at forks, shops, tolls and repair use simple scored
  heuristics, e.g. "path length to finish versus coins". Repair behaviour
  needs a rule. Proposal: bots repair when doom is above a threshold, more
  readily at higher difficulty.
- **Minigames:** each goal type ships with a bot behaviour, so a new goal
  isn't done until its bot works. Hazards only need avoidance hints (danger
  zones for bots to steer around).

---

## 9. Win / lose

- **Win:** first piece onto the final space. The house "reverses" for the
  winner. (Ending cinematic: the world rebuilds from an empty effect list and
  rewinds.)
- **Lose (everyone):** the doom meter fills.
- **Round cap:** none decided. What if nobody finishes but doom never fills?
  Proposal: a hard cap where the house wins. (open, §13)

---

## 10. Architecture (TypeScript + Phaser)

```
src/
  core/          pure TS, no Phaser: rules, deterministic, unit-tested
    state.ts       GameState: seed, round, doom, players, board, house, active effects
    board.ts       space graph, movement, junctions, space resolution
    house.ts       rooms, tags, connections; derive(house, effects)
    effects.ts     effect cards: data plus pure apply/derive rules
    goals.ts       goal definitions and scoring
    format.ts      FFA/1v3/2v2 assignment
    economy.ts     payouts, shop, repair, tolls
    doom.ts
    rng.ts         seeded, named streams: board, cards, minigame, cosmetic
    flow.ts        round state machine (regroup → turns → house → minigame → settle)
  input/         Gamepad API + keyboard → per-seat virtual controller
  bots/          virtual-controller producers (board AI, per-goal minigame AI)
  game/          Phaser scenes
    HouseScene      one scene for the house: regroup, minigames and the board prop
    BoardOverlay    board UI and piece movement, drawn over the house
    HudScene        doom meter, coins, turn order
  content/       data: house layout, board layout, cards, goals, items
```

**Rules carried over from the MP4 analysis:**
1. **Only `GameState` is the truth.** The house's effective layout (tags,
   blocked connections) is rebuilt from the base layout plus the active
   effects, never edited in place. This makes save/load, debugging and the
   "reverse" ending simple.
2. **Flow as async scripts** (MP4's coroutines). Each cutscene, board turn and
   event is an `async` function, e.g. "move camera, wait, show dialog, wait,
   apply effect".
3. **Hooks get an explicit context** (`ctx.player`, `ctx.space`,
   `ctx.state`), not globals.
4. **Separate seeded RNG streams**, so a game can be replayed from its seed
   and an input log, unlike MP4.
5. **Virtual controllers for everyone**, so bots and humans share the same code.
6. **Minigames don't edit the board.** They return results (placements and a
   group score), and settle applies them, as MP4's results screen does.

---

## 11. What we take from MP4 (summary)

| MP4 | Here |
|---|---|
| Space graph with types, flags and pass/land hooks | Board, as is |
| End-of-round minigame, format from space colours | Kept, but played **in the house** with the round's hazard |
| Results written back to persistent state | Settle step |
| Board gimmicks that change the world (water level, bridges, global last-5 retype) | Effect cards: lingering tags and blocked connections in the house |
| Rebuild the world from a small save | `derive()` from GameState |
| Coroutine cutscenes in five beats | async scripts |
| CPU uses synthesized input | Virtual controllers |
| Item and shop economy | Coins with four sinks, including the shared repair sink |

---

## 12. v1 scope and build order (proposal)

v1 = one house, one board, 8 hazards, 6 goals, about 6 items, bots on.

1. **Core rules, headless:** GameState, the board graph, the house plus
   `derive`, the flow state machine, RNG, economy, doom. Simulate full games
   with bot stubs in tests and check that games run about 10–12 rounds.
2. **Input layer:** gamepads, keyboard and virtual controllers; a seat-join screen.
3. **House greybox in Phaser:** 3 floors, about 9 rooms, platformer movement,
   the regroup walk, the board prop.
4. **First minigame end to end:** one hazard (Flood) and one goal (Collect),
   FFA only, with settle and doom. **First playable.**
5. Board overlay and turn UI, shops, tolls and repair.
6. Formats (1v3, 2v2), the remaining goals and hazards, and bot behaviour per goal.
7. Pixel-art pass, the roulette and cutscenes, the ending.

---

## 13. Open questions

**Rules**
1. **Finish:** exact roll to land on the final space, or is passing it enough?
2. **Round cap:** a hard cap where the house wins, or none?
3. **Repair:** only on Repair spaces, at the board on your turn, or anytime?
4. **Formats with 2–3 players:** always FFA, or a 1v2 format for 3 players?
5. **Regroup ties and stragglers:** a time limit on the walk? What happens to
   someone stuck behind a blocked route?
6. **The board prop:** can effects move it, block it or damage it?
7. **Doom hit from a minigame:** scaled smoothly with the group score, or only
   below a threshold?
8. **Coins and stars:** are coins the only currency, or is there a second
   score (e.g. stars) for tiebreaks?

**Content**

9. **House connections:** stairs and ladders only, or vents and holes too?
10. **The starter lists** of hazards, goals and items in §5–6: keep, cut or
    swap?
11. **Theme of the first house:** the cards mix themes, but is the house
    itself a normal suburban home, a mansion, or something else?

**Presentation**

12. **Base pixel resolution** (e.g. 320×180 or 480×270)? This decides tile
    and sprite scale.
