# Tools

Everything that produces files under `public/arenas/`, plus the headless probes used to tune the arenas.
Run commands from the repo root.

## Destruction bake (`tools/bake/`)

Turns intact parts into pre-fractured chunks with a support graph, and writes `<name>.glb`, `<name>.support.json`
and `<name>.js` (the GLB as base64 plus the support data, which is what the arenas import).

```
cd tools/bake && npm install && cd ../..
node tools/bake/bake.mjs --defs tools/bake/defs/kitchen_defs.mjs --name kitchenpieces --out public/arenas/kitchen
node tools/bake/bake.mjs --defs tools/bake/defs/ship_defs.mjs    --name shippieces    --out public/arenas/ship
node tools/bake/bake.mjs --defs tools/bake/defs/station_defs.mjs --name stationpieces --out public/arenas/station
```

- A defs module exports `pieces({ box, cyl, prism })` returning `{ pieceName: [parts] }`. Parts are piece-local
  (y up, y = 0 is the base) with a material from `public/arenas/kit/materials.js` and a fracture spec
  (`{ count, mode: '2.5D' | '3D' | 'slices', axis }`). Colour is baked per material, so make one def per colour.
- The bake is seeded (`--seed`, default 1234), so re-running it gives the same chunks.
- Only the `.js` file is used at runtime; the `.glb` and `.support.json` are for inspection.

## Character (`tools/character/`)

The bean is built by script in headless Blender: `bean.py` (shape, rig, poses) on top of `lib.py` (lathes,
capsules, decals, auto-weights, animation export). The body and arms are one smooth surface made with signed
distance fields and marching cubes, then decimated.

Setup (once): a Python 3.13 venv with `pip install bpy==5.2.2 numpy scikit-image`.

```
python -I tools/character/bean.py -- out/ export          # out/bean.glb (+ info json)
python -I tools/character/bean.py -- out/ close action    # preview renders: close-ups, action poses
node tools/character/embed.mjs out/bean.glb               # -> public/arenas/kit/hero.js
```

`-I` keeps Python from importing stray modules from the working directory. Render paths must be absolute or
relative to where you run it.

## Probes (`tools/probes/`)

Headless checks that play the real pages with four bots through the `window.__*` hooks. They need Playwright with
Chromium and the site served locally:

```
python3 -m http.server -d public 4180 &
node tools/probes/soak.mjs [arena,...] [rounds]        # random rounds, fails on any page error
node tools/probes/disasters.mjs [arena,...] [rounds]   # eliminations per disaster per arena
node tools/probes/arms.mjs [arena]                     # arm snap count (stutter check)
```

Env: `ARENAS_URL` (default `http://localhost:4180/arenas/`), `PLAYWRIGHT_MODULE` (path to playwright if it isn't
installed in the repo), `CHROMIUM` (browser executable). Bots dodge better than people at a party, so treat
"weak" results as softer than they will feel in play.
