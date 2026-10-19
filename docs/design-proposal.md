# Game design proposal (v3)

Working title: **TABLETOP** (placeholder).

A local, competitive party game for 2–4 players in the browser. Players race
along a cursed board game while the board unleashes effects into the house
they are physically in. The house is a 2D side-cutaway diorama. Each round
ends with a Mario Party-style minigame, played inside the house as it
currently stands. First to the end of the board wins. There is no doom
meter: **the house's chaos is the threat**. Every effect that isn't contained
makes the race slower and harder for everyone, and if nobody finishes by the
round cap, the house wins.

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
| Mode | Competitive race. The only shared loss is the round cap |
| Win | First piece to reach **or pass** the board's final space (no exact roll) |
| Round cap | Hard cap (tune, ~15 rounds). If nobody has finished, the house wins and everyone loses |
| Length | 30–45 min, about 10–12 rounds |
| View | 2D side cutaway (dollhouse cross-section), pixel art |
| House | Medium: about 9 rooms over 3 floors; one house for v1 |
| Avatar movement | Platformer: run, jump, gravity, stairs/ladders |
| Board as prop | The board is a physical object in the house. Every round starts with everyone walking back to it, and minigame goals can use it |
| House connections | Doors, stairs, ladders, and vents/holes (some created by effects, e.g. meteor holes) |
| Base resolution | 480×270 pixel art, scaled up |
| Starter content | The 8 hazards, 6 goals and items in §5–6 are accepted. "Shield from one effect" is cut |
| Turn order | Set by arrival order at the board during the regroup walk |
| Regroup stragglers | After a timer (tune), stragglers are teleported to the board and go last |
| Formats by player count | 4 players: FFA / 1v3 / 2v2. With 2–3 players: always FFA |
| Currency | Coins only. No second score (turns run one at a time, so there are no finish ties) |
| First house | An ordinary suburban home. Cards stay mixed-theme |
| Card trigger | Only dedicated **danger spaces** draw effect cards |
| Which card plays | Roulette picks one of this round's drawn cards. The others are **discarded** |
| No card drawn | Generic minigame in the house as it currently stands |
| Minigame form | **Hazard × goal mix**: the card supplies the hazard, and a goal (survive, collect, hold the flag…) is drawn separately |
| Minigame teams | MP-style formats (4-player FFA / 1v3 / 2v2), decided by the space each player landed on |
| Minigame reward | Currency (coins) |
| Effect targeting | Some cards name their room or area; others pick a random room |
| Effect persistence | Stays until paid off (repair) or **contained** by a good group result. Auto-expiry after X rounds is deferred until playtesting |
| Doom meter | **Removed.** The accumulated chaos in the house plays that role |
| Coin sinks | Items, house repair, minigame perks, toll gates and shortcuts |
| Repair | Only on Repair spaces (land or pass), so it is scarce and depends on board position |
| Board-prop effects | Some cards can move, block or damage the board prop, which changes the regroup route |
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
│    round == cap and nobody finished → house wins, everyone loses │
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
| Repair | locked | Land on or pass it to pay to clear a lingering effect. This is the only place repair can happen |
| Toll gate | locked as a sink | Pay to pass, or take the long way |
| Shortcut | locked as a sink | Pay to open a faster branch |
| Final space | locked | Reaching it wins |

**Movement (proposal):** one standard d6 per turn. Items change dice. Passing
a shop or toll triggers its event during movement (MP4's "passing" hook);
landing resolves the space.

**Finish rule:** reaching or passing the final space wins. No exact roll.

**Length:** tune the path length and forks so a typical game ends in 10–12
rounds.

---

## 4. The house

- **Layout:** a side cutaway with 3 floors and about 9 rooms, connected by
  doors, stairs, ladders and vents/holes. Effects can create new holes.
- **The board** sits on a table in one room. Where that room is decides how
  long the regroup walk takes from each part of the house. **Some cards
  move, block or damage the board** (e.g. a flood carries it to another room,
  vines wrap it so it must be freed). This changes the regroup route.
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
- with 2 or 3 players: always FFA (locked)

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
| Items | Double die; reroll; "steer the roulette" (re-spin once); push a rival's piece back 2 |
| Repair | Clear one lingering effect from the house |
| Minigame perks | Buy a head start, a better spawn point, or a one-use tool for the next minigame |
| Tolls / shortcuts | Pay to pass a gate; pay to open a shortcut branch |

**Core tension:** repair is a public good. Every coin spent on repair is a
coin not spent getting ahead, yet a cleaner house helps every player,
rivals included. If nobody repairs, the house keeps getting harder for
everyone: slower regroups and nastier minigames, which drags the race toward
the round cap. That tragedy-of-the-commons pull is the heart of the
competitive-but-shared design.

---

## 7. The house as the threat (replaces the doom meter)

- There is no meter. The pressure is **the number and placement of lingering
  effects**, which you can see directly in the diorama.
- **It gets worse** whenever a card's effect isn't contained (group score
  below the bar).
- **It gets better** through containment and through repair on Repair spaces.
- **Why it matters:** lingering effects stack into later minigames and
  regroup walks. A chaotic house means slower regroups, more stragglers
  teleported to last place, and harder minigames. That stretches the game
  toward the round cap.
- **HUD (proposal):** a small list of active effects and the room each is in,
  plus the round counter shown as "round n / cap".
- Auto-expiry of lingering effects after X rounds stays deferred until playtesting.

---

## 8. CPU bots

Bots ship from day one, following MP4's pattern:
- **Bots produce virtual controller input.** The board, the regroup walk and
  every minigame run the same code for bots and humans.
- **Difficulty** is a mistake chance plus reaction delay (tune).
- **Board decisions** at forks, shops, tolls and repair use simple scored
  heuristics, e.g. "path length to finish versus coins". Repair behaviour
  needs a rule. Proposal: bots repair when a lingering effect blocks their
  own regroup route, or when the house has N or more lingering effects (tune).
  They do this more readily at higher difficulty and as the round cap nears.
- **Minigames:** each goal type ships with a bot behaviour, so a new goal
  isn't done until its bot works. Hazards only need avoidance hints (danger
  zones for bots to steer around).

---

## 9. Win / lose

- **Win:** first piece onto the final space. The house "reverses" for the
  winner. (Ending cinematic: the world rebuilds from an empty effect list and
  rewinds.)
- **Lose (everyone), round cap:** if nobody has finished by the hard cap (tune, ~15 rounds), the house wins.

---

## 10. Architecture (TypeScript + Phaser)

```
src/
  core/          pure TS, no Phaser: rules, deterministic, unit-tested
    state.ts       GameState: seed, round, players, board, house, active effects
    board.ts       space graph, movement, junctions, space resolution
    house.ts       rooms, tags, connections; derive(house, effects)
    effects.ts     effect cards: data plus pure apply/derive rules
    goals.ts       goal definitions and scoring
    format.ts      FFA/1v3/2v2 assignment
    economy.ts     payouts, shop, repair, tolls
    rng.ts         seeded, named streams: board, cards, minigame, cosmetic
    flow.ts        round state machine (regroup → turns → house → minigame → settle)
  input/         Gamepad API + keyboard → per-seat virtual controller
  bots/          virtual-controller producers (board AI, per-goal minigame AI)
  game/          Phaser scenes
    HouseScene      one scene for the house: regroup, minigames and the board prop
    BoardOverlay    board UI and piece movement, drawn over the house
    HudScene        coins, turn order, round/cap, active effects
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
   `derive`, the flow state machine, RNG, economy, round cap. Simulate full games
   with bot stubs in tests and check that games run about 10–12 rounds.
2. **Input layer:** gamepads, keyboard and virtual controllers; a seat-join screen.
3. **House greybox in Phaser:** 3 floors, about 9 rooms, platformer movement,
   the regroup walk, the board prop.
4. **First minigame end to end:** one hazard (Flood) and one goal (Collect),
   FFA only, with settle and containment. **First playable.**
5. Board overlay and turn UI, shops, tolls and repair.
6. Formats (1v3, 2v2), the remaining goals and hazards, and bot behaviour per goal.
7. Pixel-art pass, the roulette and cutscenes, the ending.

---

## 12g. Maps are places; minigames happen in them (decided, Pirate Cove built)

Builds on 12f.

- **The place comes first.** A map is a fun place to be in, and the board is threaded through it. Spaces are things
  that belong there: shell inlays in the sand, painted stepping stones, bridge planks, a hatch on a ship's deck.
- **Landmarks do jobs.** Each one is a shortcut, a high road, a hill, or a way back up when you fall.
- **Pirate Cove** (`public/arenas/cove/`), an island around a lagoon:
  - the ring of spaces is on the sand;
  - the stepping stones across the lagoon are the shortcut;
  - the high road goes up the cliff fort, over the plank bridge and onto the beached wreck, with treasure-chest
    spaces (+6);
  - the wreck's stern deck is the hill.
- **Minigames after every turn.** One is called by name ("FLOOD!") with a 3 s warning, and everyone reacts from
  wherever they stand.
  - Placements pay 6 / 3 / 1 coins.
  - Afterwards the world resets: broken things are whole again and everyone is back on their space.
  - Minigames are modules (`board/minigames/`). A map lists the ones it supports and can reskin them.
- **The first three:**
  - **Flood!** The sea rises over the island and the wreck floats free. Waves roll over it; climb back aboard if
    you're washed off. In the water for 3 s and you're out.
  - **Cannon Fire!** Balls lobbed from a ship offshore, every landing spot shown first. A hit is out.
  - **Captain's Deck:** king of the hill on the wreck's stern.
- **Water between games.** Fall in the lagoon or the sea and you wash back to your space, minus 3 coins.
- **Measured with four bots** (`tools/probes/board.mjs`): beans about 105 px tall at 1080p, six turns in about
  4 minutes.
- **Next minigames, in the same vein:** barrel roll, treasure grab (coins scatter, grab the most), capture the flag
  between the wreck and the fort, a hot potato with a lit bomb.

## 12f. Direction change: a physical board you walk (decided, grey-box built)

Supersedes 12e as the main game. The arenas stay playable and may return as minigames.

- **Core idea:** where your bean stands is where you are on the board. Board rules become things you do with
  your hands: drag someone back, throw them off a bridge, stand on the star before time runs out.
- **Camera limit:** one TV, one shared camera, no split screen, so the board stays about the kitchen's footprint
  and folds upward instead of spreading out. It is a playset on a table, about 12.8 × 10 m, with a back terrace,
  a tower and ramps. Measured with four bots at 1080p, beans are about 100 px tall (median), 85 px in the
  worst tenth of frames.
- **Turn:** everyone at once, no waiting.
  1. Roll: a die hovers over each head; jump to hit it, and it tumbles for real.
  2. Walk: 8 s, with your pegs on the spaces you can reach and an arrow on your roll's end.
  3. Land: the nearest space you were allowed to reach, on your own level.
- **Spaces:** blue +3, red −3, and the star for 10 coins (it moves after each purchase). The shortcut bridge is
  narrow and red.
- **Penalties:** falling off the table costs 3 coins and puts you back on your space.
- **Games on the board:** every third turn, king of the hill on the tower (15 s; seconds on top, 8 / 4 coins).
  Next: survive (a disaster on the board), capture the flag, races.
- **Win:** most stars, then coins. Ten turns take about four minutes.
- **Code:** `public/arenas/board/` on the shared engine (`kit/engine.js`), which now runs either mode. Rules are
  pure and unit-tested (`board/rules.js`), and `tools/probes/board.mjs` plays whole games headless.
- **Next ideas (from the options page):**
  - physical coins that spill when you're shaken;
  - the star as a heavy trophy you carry home;
  - trap stations;
  - board damage that stays;
  - more board games;
  - the shrink-and-grow transition into minigames.

## 12e. Direction change: 3D destructible arenas (decided)

These decisions supersede the board-walking loop and the 2D side-cutaway presentation above.
The rules engine, hazard deck, house generator and bots carry over.

- **Framing (Option C):** each round the cursed board pulls everyone into one short,
  destructible arena and deals a disaster from a shared deck. Survivors move up the board,
  so the board is the scoreboard and story, not a separate game. Late rounds deal two disasters.
- **Look:** full 3D, low-poly toy style made in Blender by script. Characters are plain soft
  "beans" in the Human: Fall Flat / Fall Guys vein (one smooth jellybean body, a lighter face
  patch, two dot eyes, short thick arms, stubby legs, no outline). This replaced the earlier
  wind-up toy idea. The Old House is still planned, but the kitchen, ship and station came first.
- **Built so far (status):** arenas Sinking Ship, Giant Kitchen, Space Station (Cargo Bay);
  disasters lightning, meteor, flood, stampede, stomp, decompression (the station's breach
  suction); six-round matches with 3/2/1/0 points standing in for the board until it gets a look.
- **Camera:** one shared camera at a raised three-quarter angle that frames all players,
  with a dramatic pull-back for disaster reveals. Walls between the camera and a player fade.
  No split screen.
- **Movement:** wobbly active-ragdoll characters with grab, carry, throw, hang and climb,
  built from the clean-room spec in `docs/hff-cleanroom-analysis.md`.
- **Destruction:** pre-fractured chunks with a support graph and stress pass (Blast-style
  design, written fresh), runtime Voronoi refracture on big impacts in a worker
  (three-pinata, MIT), about 150 grabbable debris bodies plus instanced crumbs.
- **Disaster deck (12):** flood, tornado, lightning storm, acid rain, meteor shower,
  earthquake, stampede, giant stomp, fire, gravity flip, blackout, termites.
- **First arenas (picked):** Old House, Sinking Ship (tilts and sinks), Space Station (breach
  suction), Skyscraper Site (crane wrecking ball), Giant Kitchen (toy scale). Later candidates:
  Jungle Temple, The Game Box, Volcano Village.
- **Platform:** browser on a Steam Deck docked to a TV (1920x1080, couch distance), gamepad
  first, keyboard fallback for two players, target 60 fps. Phones are not a target.
- **Stack:** Three.js + Rapier for the real-time game; `src/core` stays the pure,
  seeded rules engine.

## 12b. Destructible rooms (in progress)

**Decided:**
- **Target feel:** physical destruction like *The Finals*. Walls and floors break into chunks, so the house art is built from small chunks that can be removed one at a time.
- **Effect on play:** damage both **opens routes** (holes in walls and floors become new passages) and **closes routes** (rubble blocks doors, ladders and stairs break).
- **Max damage:** a room at level 3 stays wrecked. It doesn't collapse further, and there is no house-wide loss.
- **Repair:** paying at a Repair space clears the hazard **and** restores the room.
- **Lingering hazards:** uncontained hazards run at full strength every round until repaired.

**Deferred:**
- What causes damage (players, hazards live, cards, lingering).
- Collision rules for broken chunks.

**For now:** `DerivedHouse.damage` (0–3 per room) is derived from lingering effects and drawn as visual wreckage only.

## 12d. Procedural house (exploring)

**Direction:** the house is generated procedurally for each game. It can be goofy, even nonsensical, as long as it's fun to navigate and has unique, interactable features. Owned bedrooms (Landlord) are on hold.

**Prototype algorithm:**
1. A 6×4 cell grid with a lumpy roofline.
2. Cells merge into rooms of mixed sizes with goofy themes.
3. A spanning tree of two-way links guarantees every room can reach the board and get back.
4. Extra links add loops.
5. 3–5 signature features are drawn from a deck: portal paintings, trampoline bed, chute, pole, slide, dumbwaiter, revolving bookcase, light switch, trapdoor rug.

Every house is validated (all reachable, longest trip under a cap) and re-rolled if it fails. In the prototype, 1,500 seeds across all goofiness levels all passed.

## 12c. House plan and bedrooms (superseded by 12d, kept for reference)

**Decided:**
- **Plan A**, the split-level family home: a sloped attic, two upstairs bedrooms around a double-height entry hall with a balcony bridge, kitchen and garage on the ground floor, and a basement with two bedrooms plus the laundry.
- **Laundry chute:** a visible, one-way chute from the attic to the hall. It replaced the hidden vent.
- **Bedroom spin, Landlord (leaning yes):** each player owns a bedroom. Rivals who run through it during the regroup race pay rent: 1/2/3 coins by upgrade level, once per room per round, never during minigames. Coins kept in the room are a safe stash, and they spill out if the room is wrecked.

**Routing rule (from research):** every bedroom guards one shortcut, and every shortcut has a free way around. The free alternatives are:
- the balcony bridge
- windows to the outside drainpipes
- the kitchen stairs and garage ladder
- a slow laundry service ladder
- the attic ladders

The paid route should save about 1.5–2.5 s (about one place in the arrival order).

**Open:**
- Whether the house can still win (keep the round cap, remove it, or a wreck count).
- Room height: about 54 px on a fixed screen, or a slight camera zoom.
- A trellis for climbing back up outside.

## 13. Open questions

All of the first round of open questions are resolved. Remaining work is
tuning (marked **(tune)**) and reviewing the **(proposal)** items above:
the round budget, the space list, the item specifics and bot rules.
