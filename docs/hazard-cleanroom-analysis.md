# TABLETOP hazard and survival-round behaviour spec (clean room)

Based on how stage hazards behave in two platform fighters (N64 and GameCube) and how survival minigames behave in a GameCube party game. Everything is described in our own words; no code, identifiers or comments were copied. All numbers assume 60 fps and should be **tuned by feel**.

## 1. Hazard lifecycle

Every hazard we studied runs through the same phases:

- **Dormant.** The wait is *base + random jitter*. Players learn the rhythm but can't time it exactly. Stage hazards wait about 25–45 s; inside a short survival round, about 2–8 s.
- **Telegraph.** There are three kinds:
  - A short quake and rumble (about 0.3 s) followed by a *slow* visible change, such as liquid rising over about 4 s. The motion is itself the warning.
  - The hazard appears in full but cannot hurt anyone for about 1.3 s.
  - An in-world screen announces the change several seconds ahead, then a quake runs through the whole transition.
- **Active.** The lifetime is random within a range (a roaming hazard lasted about 9–19 s). Speed changes are rare and short.
- **Subside.** The hitbox turns off first, then a short exit animation plays (about 0.5 s). The hazard only despawns after it has let go of anyone it captured.
- **Cooldown.** The hazard rolls a new wait.

**Telegraph length grows with the danger:**

| Danger | Warning |
|---|---|
| Chip damage | 0.3–0.5 s |
| Capture or big knockback | 1–1.5 s |
| Terrain change or lethal | 2–5 s, with sound and camera |

**Per-player immunity.** After a hazard hits someone, it ignores that player for about 0.5–2 s, so nobody gets hit in a loop.

## 2. Targeting and placement

- **Hand-placed spawn points.** Hazards spawn only from a hand-placed list of valid spots, then snap to the floor height. They never pick a free random coordinate.
- **They go after the crowd, not one player.** A roaming hazard sometimes heads toward the side of its floor where more players are standing. It checks about once every 3–5 s, acts on roughly 1 check in 5, and then moves at about 5× speed for 5–8 s. A tie is decided by coin flip.
- **Aimed shots use a snapshot.** An aimed shot locks onto a random player's position *at that moment*; if that player slot is empty, it moves to the next one that isn't. The shot never follows the player, so moving always dodges it.
- **No repeats.** A random pick is re-rolled if it matches the previous pick.
- **Bounded randomness.** Every random value is a base plus a random fraction of a set range. Target heights get a small offset.
- **Caps.** Each hazard type has one instance or a small fixed pool (surface patches used a pool of 4). If the pool is full, the spawn is skipped rather than forced.
- **Edges.** At the end of its floor, a roamer pauses for about 2 s and then reverses.

## 3. Fairness

- **Every lethal effect has a way out:** jump, move across, climb, or take cover. Rising liquid stops below the highest platform. A falling piece always leaves its neighbours standing.
- **Players can change hazards.** A stage cannon could be destroyed by hitting it enough. Paired weighted platforms collapsed only when players overloaded one side.
- **Warnings use two senses:** sight plus sound, or sight plus rumble.
- **Restore guarantees.** Broken pieces come back after about 3 s. They only become solid once fully back in place. Transforming stages return to the neutral layout between variants.
- **Timing.** Hazards stay asleep during the intro and countdown, and stop the moment the finish banner appears.
- **Escalation is scripted.** One liquid hazard looped through about 10 authored target heights with mixed waits, so its peaks are designed. Survival effects ease in over about 1 s instead of starting at full strength.

## 4. Pieces that transform, sink or break

- **Collision groups.** A piece's collision belongs to a group that can be turned on, turned off, or moved every frame to follow the piece's animated model. Anyone standing on the group moves with it.
- **Vanishing order:**
  1. Cue.
  2. The piece falls, speeding up to a capped speed.
  3. Collision turns off only after the piece has fallen well out of the play space.

  Players fall *with* the piece, not through it.
- **Transform order:**
  1. The old layout flattens over 1–2 s while the camera shakes.
  2. Collision switches over at the moment the old layout is lowest.
  3. The new layout rises in its place.
- **Load checks.** Anything that depends on load counts only grounded players on that specific floor segment.

## 5. Surface attributes over time

- **Patches.** An attribute (slippery, burning, sticky) is a temporary circular patch fixed to a floor segment. It has a centre, a radius, a type and a frame countdown, and comes from a small pool.
- **How a touch is checked.** The patch applies if the player's floor connects to the patch's floor and the player is within its radius. The first match wins; otherwise the base material applies.
- **Expiry.** When the countdown runs out, the patch is removed.
- **Stage-wide changes.** Lighting or background colour blends toward a new target over about 60 s, then picks a different target.

## 6. Survival-round structure (party game)

| Phase | Duration | Notes |
|---|---|---|
| Wipe in | 0.5–1 s | No control |
| Intro camera | 1–3 s | Wide shot settling into the play view; players frozen |
| Ready / Go | about 1.5–2 s | Music starts on Go |
| Play | 30 s or 60 s countdown, or untimed for last-one-standing | Ends early when the outcome is decided |
| Finish banner | about 1–1.5 s | Music fades; hazards stop |
| Winner display | about 3.5 s | Fanfare; if nobody won, a draw banner and jingle |
| Wipe out | 0.5–1 s | Back to the board |

- **What the minigame reports.** It reports only who won. Each winner gets a flat award (for example 10 coins).
- **Placings.** In last-one-standing, the order of elimination gives the placings. Players eliminated on the same frame tie. If everyone is out at once, the result is a draw.
- **Ramp.** The spawn rate and speed rise over the round. Random visual effects are cosmetic only.
- **Board state.** The minigame never edits the board itself; the caller applies its results.

## 7. Adaptation for TABLETOP

### Round timeline (about 60 s of play)

1. **Pull-in (1 s):** wipe to the arena; players drop in with control locked.
2. **Reveal (2–3 s):** the camera pulls back to show the whole arena. A title card and a signature sound announce the disaster, and safe zones are highlighted.
3. **Prep (3–5 s):** players can move. Nothing can hurt them yet, but the first telegraph is already visible.
4. **Active (to about 35 s):** base intensity, with long gaps between attacks.
5. **Escalation (35–55 s):** one or two scripted steps up, each announced by a music layer or a quake. Gaps get shorter, but the safe-spot rule still holds.
6. **Finish (60 s, or early once 0–1 players are left):** a banner appears and hitboxes turn off immediately.
7. **Results (3–4 s):** placings are shown, then sent to `settle`.

### Per-disaster rows

| Disaster | Telegraph | Active | Safe-spot rule | Escalation |
|---|---|---|---|---|
| Flood | Rumble and foam 1 s ahead | Water rises in steps toward scripted levels, 3–5 s per step | Top floor always stays dry (water level is capped) | Higher steps and shorter pauses, but never past the cap |
| Tornado | Harmless funnel for 1.3 s | Roams one floor and sometimes leans toward the crowd | Other floors; heavy anchor objects | Longer lifetime and more dashes; at most 2 at once |
| Lightning | Glowing ground circle and crackle, 1–1.5 s | Strikes a snapshot of a player's position or a spawn point | Under a roof, or off the circle | Faster, up to 2 at once; 2 s immunity after a hit |
| Acid rain | Sky darkens, 2 s | Ongoing damage under open sky; leaves corrosion patches | Under roofs | Roofs corrode one by one, but at least one stays |
| Meteors | Shadow that grows, 1.5–2 s | Spaced apart; never lands on a player's position at the moment it spawns | Gaps between shadows | More meteors per wave; every shadow lasts at least 1 s |
| Earthquake | Rumble and dust, 1 s | Cracked pieces drop, using the vanishing order from section 4 | Pieces that aren't cracked; dropped pieces return after about 3 s | More cracks, but there is always a connected path |
| Stampede | Horn and dust from one side, 2 s | Herd runs across one floor in lanes | Empty lane, higher floor, or a jump | More lanes, but at least one is always empty |
| Giant stomp | Big shadow and footstep beats, 2–3 s | Foot breaks the piece below and sends out a shockwave you can jump over | Outside the shadow | Faster stomps, but the shadow always shows for at least 1.5 s |
| Fire | Smoke and glow on the tile it will spread to, 1–2 s | Spreads to neighbouring tiles on a timer; leaves burning patches | Fireproof tiles; water patches | Spreads faster, but capped at a share of the arena |
| Gravity flip | Everything starts to float, plus an alarm, 2 s | Gravity flips; ceilings become floors | Marked ceiling floors | More frequent flips, at least 3 s apart |
| Blackout | Lights flicker 3 times, 1.5 s | Darkness; players and hazards keep a glowing outline; audio cues continue | Pools of lamp light | The lit pools shrink, but at least one stays |
| Termites | Gnawing and sawdust on the target, 2–3 s | Wooden pieces weaken, then collapse | Stone and metal pieces | More infested pieces, but always a path to stone |

### Fairness checklist

- [ ] Every telegraph lasts at least 1 s (at least 1.5 s for lethal hazards) and uses two senses.
- [ ] Hitboxes are off during the intro, prep, finish and results.
- [ ] Hazards spawn from hand-placed points, keep their spacing, respect per-type caps, and never spawn on top of a player.
- [ ] Aimed shots use a position snapshot and never home in.
- [ ] Each player gets brief immunity after a hazard hits them.
- [ ] A reachable safe zone exists at every moment. A seeded headless test checks this for every disaster.
- [ ] Moving collision carries riders. Collision turns off only after a piece has left, and turns back on only when the piece is fully back in place.
- [ ] Each disaster follows its escalation script; randomness only fills in within the script.
- [ ] Random picks never repeat the previous pick, and all randomness comes from named seeded RNG streams.
- [ ] Elimination order sets placings, a same-frame elimination is a tie, and if everyone is out at once nobody scores.
- [ ] The minigame returns results; `settle` applies them.
