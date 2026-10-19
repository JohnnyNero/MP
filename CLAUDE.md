# CLAUDE.md

TABLETOP: a local 2–4 player competitive party game in the browser, played on a Steam Deck docked to a TV
(1920x1080, gamepad first, keyboard for two). A cursed board game pulls everyone into a small destructible 3D
arena and deals a disaster; wobbly active-ragdoll beans survive it. Matches of six rounds across the arenas.
Design: `docs/design-proposal.md` (section 12e is the current direction). Movement spec:
`docs/hff-cleanroom-analysis.md`. Hazard timing spec: `docs/hazard-cleanroom-analysis.md`.

## Layout

- `public/arenas/`: **the game**. Plain ES modules with no build step (Three.js 0.160 + Rapier compat 0.12 from a
  CDN importmap), copied as-is into `dist/arenas/`.
  - `kit/`: the shared runtime: round loop, match, camera, input, HUD, effects and sound, bots, hazards, the ragdoll
    character, destruction. Read `kit/KIT.md` before changing it.
  - `<arena>/` (`kitchen`, `ship`, `station`) + `<arena>.html`: one arena each (`arena.js`, `layout.js`, baked pieces).
  - `index.html`: the menu (match, single arenas, Deck benchmark).
- `tools/`: everything that generates files under `public/arenas/`, plus headless probes. See `tools/README.md`.
  - `bake/` (destruction pieces), `character/` (Blender bean pipeline + embed), `probes/` (bot rounds via Playwright).
- `tests/`: Vitest. `arenas.test.js` covers match scoring and arena layouts; the `.ts` tests cover the parked engine.
- `src/` + `legacy.html`: the earlier 2D Phaser board game, **parked**. Don't extend it.
- Root `index.html` only redirects to `./arenas/`.

## Commands

- `npm run dev`: local dev server (open `/arenas/`)
- `npm test`: unit tests (fast, run before every push)
- `npm run typecheck`
- `npm run build`: production build into `dist/` (relative base, works on Pages)
- `python3 -m http.server -d public 4180` then `node tools/probes/soak.mjs` (or `disasters.mjs`, `arms.mjs`,
  `match.mjs`): play real rounds headless with bots. `smoke.mjs` is what CI runs against `dist/`.

## Rules for the code

- Arena rules stay data-driven through the kit's hooks (`hazardConfig`, `botHints`, `hitBias`, `secondDisaster`,
  ...). Don't fork kit code into an arena.
- Hazards are fair: telegraph at least 1.5 s before a lethal hit, never target a spot a player stands on at pick
  time, and only hurt while `armed`. Players are hit only through `ctx.hitPlayer`.
- Randomness in the kit goes through the seeded streams (`ctx.R.*`). No `Math.random()` in game logic.
- Bots drive the same controller input as humans.
- Generated files (`*pieces.js`, `kit/hero.js`) come from `tools/`. Change the source there and re-run, never
  hand-edit the output.
- After changing behaviour, play it headless with the probes (and look at a screenshot) before pushing.
- Clean room: never paste code from decompiles. Study behaviour, write a prose spec, implement from the spec.

## Keep token usage down: use the right agent for the job

Delegate so that big file dumps land in a subagent's context, not the main
conversation. Pick the cheapest agent that can do the job:

| Job | Agent |
|---|---|
| Single known file or symbol | Do it directly (Read/Grep). No agent |
| "Where is X / how is Y wired" across many files | `Explore` (read-only, returns conclusions not dumps) |
| Designing a multi-file change before writing it | `Plan` |
| Independent implementation chunk (e.g. one arena, one hazard) | `general-purpose`, run in background; several in parallel when the chunks don't touch the same files |
| Claude Code / API questions | `claude-code-guide` |

Habits:
- Read only the line ranges you need; search before reading whole files.
- Give subagents a precise brief (files, interfaces, done-criteria) and ask
  for a short report, so their answer stays small.
- Don't re-run a search a subagent already did; wait for its result.
- Don't re-read files you just wrote or edited.
- Keep test output terse (`npm test -- --reporter=dot`) unless debugging.

## Keep GitHub Actions minutes down

- One workflow (`.github/workflows/deploy.yml`) runs typecheck, tests, build, the arena smoke test and deploy in a
  **single job**. Don't add separate jobs that each reinstall deps.
- It only runs on pushes to the default branch that touch code, config or the
  workflow (`paths` filter: docs-only pushes don't trigger it), plus manual dispatch.
- `concurrency` cancels superseded runs. npm cache is on (`setup-node` cache). The smoke test uses the runner's
  preinstalled Chrome (no browser download).
- Run `npm test`, `npm run typecheck` and `npm run build` **locally before
  pushing**. CI is a safety net, not a test runner.
- Batch commits and push once per finished chunk of work, not after every edit.
- No scheduled (cron) workflows, no matrix builds, no re-runs to "kick" CI.
