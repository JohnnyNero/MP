# Wobbly Character Behaviour Spec (clean-room, for TABLETOP)

Written from study of how a well-known wobbly-physics game behaves. Describes mechanisms only. All numbers are approximate starting points: **tune by feel**.

## 1. Body model

- **Full ragdoll, 16 bodies plus a hidden "locomotion ball".** Head, three torso pieces (chest, waist, pelvis), two 3-piece arms (upper arm, forearm, hand), two 3-piece legs (thigh, shin, foot).
- **Locomotion ball.** An invisible sphere sits under the pelvis and does the actual walking. It hangs off the pelvis on a soft spring with a short travel limit, and it rolls. The legs are mostly decoration plus extra ground contact.
- **Anti-stretch tethers.** Each hand has a max-distance link to the chest, and each foot has one to the pelvis. The limit equals the rest distance, so heavy loads can't pull limbs apart.
- **Self-collision is mostly off.** Neighbouring torso pieces don't collide, and neither do each limb's own pieces or the limbs and the torso next to them. This cuts solver jitter.
- **Spin cap.** Every body's angular speed is capped at a moderate value (about 1.5 turns/s), so nothing spins wildly.
- **Light drag.** All bodies get a small linear drag, which caps fall speed.
- **Mass.** Total mass is roughly adult human. The torso carries most of it, and the arms are light, so hands accelerate fast.

## 2. Locomotion

- **Input shaping.** The move stick is turned into a world-space walk direction relative to the camera. Each axis ramps up at about 1 unit/s, with a quick jump-start near zero and a slower ramp near full. Reversing an axis zeroes it instantly. The result is a short "wind-up" when you start, and snappy reversals. Jump and air control read the raw magnitude instead.
- **Walking is a rolled wheel.** While walking:
  - The ball's spin is **set directly** to the rate that would roll it at a target ground speed (slower when idle-adjusting). Its max spin is also clamped to that rate, so it can't exceed it.
  - A constant horizontal push (roughly half of body weight; enough to reach top speed in about 0.3 s) is added to the ball along the walk direction.
  - An equal and opposite force goes to whatever the character stands on, so you can push boats and platforms.
  - When idle, the ball's spin is zeroed, which acts as a brake.
- **Top speed.** Brisk, about 2.5–3 m/s. Heading follows the aim/camera yaw. There is no rotational momentum: the torso is simply torqued toward that yaw.
- **Legs are procedural, physics-driven cycles.** A phase clock runs at about 1.5 cycles/s, with the two legs half a cycle apart. Each quarter of the cycle torques the thigh and shin toward a target direction:
  - lift: knee forward-down, with a small upward pull on the foot;
  - swing: leg forward;
  - plant: down, with the foot taking part of the body's weight;
  - push: back-down.
- **Standing.** Thighs and shins are torqued toward vertical.
- **Turn-in-place.** If the pelvis faces more than about 90° away from the aim (75° while reaching), the character steps briefly to realign.
- **Ground detection.**
  - Any contact on the feet or the ball whose surface normal is within about 60° of up counts as ground. The ground object is remembered for push-back and for its velocity.
  - A rolling average of ground slope over about one second drives **slide**. Above about 45° the character starts sliding: friction on the ball and feet goes to zero, and the legs just brace. It recovers below about 37°, which gives hysteresis.
- **Step-up assist.** The ball checks for a step edge: walkable ground slightly ahead and up, with a near-vertical face just ahead. If it finds one, the horizontal impulse the edge absorbed is converted into an upward impulse of about 1.5× that amount. Small ledges get climbed without jumping.
- **Jump.**
  - The jump is only allowed on the ground, or within about 0.2 s of the ball last getting upward support (coyote time), and it has a cooldown of about 0.5 s.
  - Ground detection is suppressed for about 0.2 s after takeoff.
  - The game computes the impulse needed to reach a fixed apex (about 0.75 m), adds extra if the ground itself is rising, and **subtracts the momentum the body already has** upward. Jump height is therefore consistent and can't be stacked.
  - Forward impulse is computed the same way, toward about 2× stick magnitude in m/s, minus the current forward momentum.
  - Impulses are spread across the torso, ball and limbs (core pieces get about twice a limb's share). The reaction goes into the ground.
  - Jumping off something you are also holding gives only about 75% of the impulse.
- **Air control.** While the jump state lasts, a force on the chest drives toward about 3× stick m/s. The force is capped at roughly one body weight.
- **Landing.** There is no special landing code. Ground contact flips the state back to idle or walk, and full posture strength resumes. Muscle lift ramps from about 80% to 100% over the first second after landing, which gives a slight squash.

## 3. Balance / active ragdoll

- **Upright force, not upright torque.** Each step, upward forces are applied to:
  - head: about 20% of the budget;
  - chest: about 60%;
  - waist: about 20%;
  - pelvis: 0%.
  The budget totals about **80% of body weight × a lift factor**. The **equal and opposite force is pushed down through the feet and ball**, so momentum is conserved and the character presses on what it stands on. Because only about 80% is supported, the character sags and bobs.
- **Looking up or down shifts that budget.** Aiming up moves support from head and chest toward waist and pelvis, so the body leans back. Holding something while on the ground amplifies the shift.
- **Horizontal centring.** The pelvis is pulled horizontally over the ball, and the head is pulled weakly over the ball. The pull uses the positions each body is predicted to reach next step, so it is velocity-damped, and the opposite force is applied to the ball. This is the main "don't tip over" mechanism, and it is a soft spring, so the body sways.
- **Orientation springs.** Head, chest, waist and pelvis are each torqued toward the aim yaw and pitch. The torque is proportional to the angle error, minus damping on angular velocity, applied as an acceleration (independent of mass).
  - Gains: the head and chest are springy; the pelvis is soft and heavily damped.
  - The chest leans with pitch more than the waist, and the waist more than the pelvis.
  - Idle adds a slow (about 3 s) breathing forward/back bend.
- **Strength by state.**

  | State | Torso | Lift |
  |---|---|---|
  | Normal | full | full |
  | Climb | scales with how high you aim; full only if both hands are holding or reaching | scales with aim |
  | Fall (airborne > 1 s) | half | about 30% |
  | Free-fall (airborne > 3 s) | none | none; adds tiny random tumbling torque and an alternating up/down push on pelvis and chest, so the body flails |
  | Unconscious | zero, fully limp | zero |

  - After waking, torso strength ramps back over about 1 s and lift over about 3 s, so the get-up is visibly wobbly.
- **Arms when not reaching.**
  - While walking, arms swing in counter-phase to the legs, with strength scaled by walk speed.
  - Otherwise they are held in a loose "zombie-down" pose, very weak during free-fall.
- **Global safety limiter.** Every step, each body's velocity change is clamped, except changes that reduce its current speed toward zero. The cap is about 1000 m/s² of acceleration. This stops joint explosions and launches from solver glitches. It is skipped on the jump frame.

## 4. Falling, knockdown, unconscious

- **Knockdown only from hazards flagged as dangerous.** Being hit by a flagged object measures the velocity change it delivers: impulse divided by the struck part's mass.
  - The result is scaled by part sensitivity: head about 2×, torso pieces 1×, limbs and feet 0×. Limbs never knock you out.
  - If this frame's peak plus last frame's peak exceeds a threshold (roughly "a solid wallop", about 30 m/s equivalent), the character goes unconscious.
  - Being knocked out drops everything held and blocks grabbing for about 3 s.
  - Objects you are holding can't knock you out.
- **Long falls do not knock you out.** They only change state: Fall after about 1 s airborne, Free-fall after about 3 s. Holding something resets the fall timer.
- **Duration.** About 3 s fully limp, then the state goes to Fall and the muscles ramp up as described in section 3. A separate "waking" timer of about 2 s exists for cosmetics.
- **Manual play-dead.** A button lets the player go limp on purpose.
- **Spawn.** A respawned character drops from above and goes briefly unconscious when it lands.
- **No invulnerability window** exists explicitly. The ramp-up period is the de facto grace.

## 5. Grabbing, carrying, climbing

- **Per hand, analog.** Each hand has its own trigger, so the extend amount is analog. Any press means "reach and grab".
- **Reach target.** The point is about 0.7 m above the ball, offset about 0.2 m sideways toward that hand's side, plus the aim direction times extend times arm length.
  - Aiming low pulls the target down and forward when on the ground.
  - While climbing with a hand attached, the target is pulled slightly back toward the body.
- **Hand drive (key feel).**
  - Each hand is a point mass driven by a **time-optimal constant-acceleration controller**: given the offset and relative velocity (relative to the ball), choose the acceleration that arrives at the target and stops there. Acceleration is capped by max force divided by effective mass, and it fades out inside a small dead-zone (about 10 cm). The result is decisive, non-oscillating reaches.
  - A constant upward "anti-gravity" force is added to the hand.
  - **Reaction forces go to the body**: onto the pelvis when the hand is free, and split between chest and ball when it is holding. Swinging your arms therefore moves you.
- **Attach on touch.**
  - Holding grab and touching any collider within about 0.5 m of the reach target creates a **rigid 6-DOF lock joint** between the hand and the touched body (or the world).
  - Breaking force is very high, effectively unbreakable. A hold breaks when you release, when the hand gets more than about 2.4 m from the chest, when you're knocked out, or by script.
  - On the ground, static walls only accept a grab when the hand approaches roughly head-on, which prevents accidental wall-sticking while walking. Movable objects are more lenient.
  - There is a short arming delay before a grab can attach: about 0.1–0.25 s, longer if the aim pitch changed a lot since the last grab. This stops instant re-grab spam.
- **Grab magnetism.**
  - The hand sweeps short sphere casts (growing radii) from its last position toward the target and snaps to the closest valid hit near the aim line.
  - Designer-placed "handle" targets get strong snapping from up to about 0.3–0.5 m away.
- **Holding with your weight.**
  - When a hand is attached, its effective mass includes up to the whole body (fixed holds) or half the object's mass (loose objects).
  - The force cap rises from "grab" (about 1.5× normal) to "climb" (about 2.5–3× normal) as aim pitch goes from about 50° to 80° upward. This is the climb: **look up while holding = arms pull you up.**
  - Reaction is blended between chest and ball depending on whether the hand is above or below shoulder level. The vertical total is capped at a little over one body weight.
- **Hand-over-hand rule.** While climbing, a hand can't attach to the same object more than about 0.2 m above the other hand. This prevents ladder-spam up flat walls.
- **Ledge scramble.** If both hands hold and you walk forward, the ball gets an upward impulse proportional to how far ahead of it the hands are, so you kick over the edge.
- **Carrying.**
  - A held loose body gets a lift force toward the aim direction:
    - horizontal part: about 0.4× body weight;
    - vertical part: about 1× body weight;
    - scaled by the object's mass (light objects about 50%, heavy about 100%) and falling off with the distance from hand to object's centre of mass.
  - Half the reaction goes to the hand and half to the chest. Angular damping is applied to the object so it doesn't spin.
  - Optional per-object "aim" torque points a long object along the aim (sticks, guns).
- **Throwing.** No special code. You swing by moving the aim or turning, then release, and the hand and object momentum carry it.
- **Grabbing players.**
  - Players are ordinary grab targets: wall-leniency rules are skipped for them and the joint locks to the limb you touch.
  - The victim is flagged "held by X". A held victim that is in the Fall state keeps idle posture, so you can drag them upright. If the holder is climbing, the victim's arm force is boosted (about 1.7×), so players can pull each other up.

## 6. Feel tricks

- Weak, under-supported posture (about 80% lift) and soft centring are what give the constant gentle wobble. Avoid "perfect" PD balance.
- Every muscle force has an equal and opposite partner inside the body or on the ground, so no free energy. Chaos comes from interaction, not from glitches.
- Jump and air targets subtract current momentum, which gives consistent outcomes from chaotic poses.
- The per-body acceleration clamp hides solver explosions.
- Aim pitch is rate-limited, so the posture leans smoothly.
- Coyote time, step-up assist, ledge scramble and grab magnetism do the forgiving work behind the scenes.
- Strength ramps after knockout produce a comedic stagger.

## 7. Adaptation for TABLETOP (Three.js + Rapier, side-on)

**Architecture (recommended hybrid, about 8 bodies per character):**

- **Bodies.** Pelvis (with the locomotion ball or capsule foot below it), chest, head, two arms (single segment each, with a hand collider at the tip), two legs (single segment, mainly visual and contact).
- **Joints.**
  - Spherical joints with cone limits: neck about ±40°, waist about ±30°, hips about ±70°.
  - Shoulders: about ±150°, nearly free.
- **Depth lock.** Use Rapier's per-body translation and rotation locks: lock Z translation and X/Y rotation on all bodies. Arms may still swing visually in Z if you render an offset.
- **Locomotion: "ball under pelvis".** A Rapier ball collider on its own body, joined to the pelvis by a prismatic spring joint. Drive it by setting angular velocity around Z plus a horizontal force, and push back on the ground body. This is cheaper and more robust than a character controller, and it keeps everything physical so collisions with other players stay fun.
- **Posture.** Upward force budget (about 80% of weight) on head and chest, reaction into the ball. A predictive horizontal spring keeps the pelvis and head over the ball. An angle spring (about the Z axis only, in 2D) holds each torso piece upright, leaning toward the aim.
- **Arms.** A constant-acceleration (or critically-damped PD with a force cap) drive pulls each hand toward the aim point, with the reaction applied to the chest or pelvis. Use one shared aim for both hands, or left/right only on gamepad.
- **Grab.** On hand contact (Rapier contact events) within the reach radius, create a fixed joint (or revolute joint, to allow swinging) from the hand to the touched body, or to a fixed world anchor. Break it on release, distance from chest over about 2 m, or knockout.

**Input mapping (identical for humans and bots via the virtual controller):**

| Control | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Move (X axis only; up/down feed aim pitch) | A/D | left stick | left half virtual stick |
| Aim | facing plus W/S pitch; held W while grabbing means climb | right stick | drag on right zone |
| Jump | Space | A | button |
| Grab (both hands; hold to keep) | Shift or J | RT | button |

- On phones, aim defaults to the facing direction, tilted up by the stick's Y.

**States:**

| State | What happens |
|---|---|
| Normal | Walk, idle |
| Airborne | Jump state with air control, then fall-limp after about 1 s |
| Grabbing/reaching | Grab held, hand not attached |
| Carrying | Attached to a loose body; lift force toward aim |
| Hanging | Attached and not on ground. Swing via move input applied as horizontal force on the pelvis; up-aim triggers climb force; jump while hanging = release plus impulse |
| Knocked out | Drops everything; all muscles zero for about 2–3 s |
| Getting up | Muscles ramp over about 1–2 s; no grab during the first part |

**Simplify or skip:**

- Per-leg gait phases: use a cheap two-leg torque cycle, or animate the legs visually only.
- Multi-radius sphere-cast magnetism: one short circle or ray probe toward aim, plus designer "handle" points.
- Analog per-hand triggers.
- Slide-slope averaging: the dollhouse has few slopes.

**Keep:**

- Momentum-relative jump.
- Coyote time.
- Step-up assist (stairs!).
- Hand-over-hand rule.
- The acceleration clamp.
- Knockdown by delivered velocity change, with head sensitivity about 2×.
- Equal and opposite muscle forces.

**Performance.**

- 8 bodies × 4 players is about 32 dynamic bodies plus props, fine for Rapier WASM at 30–60 Hz on phones.
- Use a fixed 60 Hz physics step with interpolation.
- Fall back to 30 Hz with stronger damping if needed.
- Determinism: run Rapier with a fixed step and feed bot inputs through the same controller. Physics results are not part of `src/core`; minigames report placements only.
