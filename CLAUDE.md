# CLAUDE.md

TABLETOP: a local 2–4 player competitive party game in the browser
(TypeScript + Phaser 3 + Vite). A cursed board game unleashes effects into
the 2D side-cutaway house the players are standing in. Design:
`docs/design-proposal.md`. Reference analysis: `docs/mp4-cleanroom-analysis.md`.

## Layout

- `src/core/`: pure TypeScript rules engine. **No Phaser imports.**
  Deterministic given a seed. All game rules live here.
- `src/content/`: data (board layout, house layout, cards, goals, items).
- `src/game/`: Phaser scenes, rendering, physics, input, bots for real-time play.
- `tests/`: Vitest tests for `src/core` (simulate whole games headless).

## Commands

- `npm run dev`: local dev server
- `npm test`: unit tests (fast, run before every push)
- `npm run typecheck`
- `npm run build`: production build into `dist/` (relative base, works on Pages)

## Rules for the code

- `GameState` (src/core) is the only source of truth. Derive house tags and
  blocked connections from base layout + active effects; never mutate layout data.
- Randomness goes through the named seeded RNG streams in `src/core/rng.ts`.
  Never use `Math.random()` in `src/core`.
- Bots drive the same virtual controller interface as humans.
- Minigames return results (placements + group score). They never edit
  `GameState` directly; `settle` in the core applies them.
- Clean room: never paste code from the Mario Party 4 decompile into this repo.

## Keep token usage down: use the right agent for the job

Delegate so that big file dumps land in a subagent's context, not the main
conversation. Pick the cheapest agent that can do the job:

| Job | Agent |
|---|---|
| Single known file or symbol | Do it directly (Read/Grep). No agent |
| "Where is X / how is Y wired" across many files | `Explore` (read-only, returns conclusions not dumps) |
| Designing a multi-file change before writing it | `Plan` |
| Independent implementation chunk (e.g. one minigame, one hazard) | `general-purpose`, run in background; several in parallel when the chunks don't touch the same files |
| Claude Code / API questions | `claude-code-guide` |

Habits:
- Read only the line ranges you need; search before reading whole files.
- Give subagents a precise brief (files, interfaces, done-criteria) and ask
  for a short report, so their answer stays small.
- Don't re-run a search a subagent already did; wait for its result.
- Don't re-read files you just wrote or edited.
- Keep test output terse (`npm test -- --reporter=dot`) unless debugging.

## Keep GitHub Actions minutes down

- One workflow (`.github/workflows/deploy.yml`) runs typecheck, tests, build and
  deploy in a **single job**. Don't add separate jobs that each reinstall deps.
- It only runs on pushes to the default branch that touch code, config or the
  workflow (`paths` filter: docs-only pushes don't trigger it), plus manual dispatch.
- `concurrency` cancels superseded runs. npm cache is on (`setup-node` cache).
- Run `npm test`, `npm run typecheck` and `npm run build` **locally before
  pushing**. CI is a safety net, not a test runner.
- Batch commits and push once per finished chunk of work, not after every edit.
- No scheduled (cron) workflows, no matrix builds, no re-runs to "kick" CI.
