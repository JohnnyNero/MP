// Embed the exported character GLB into the arena kit as a base64 ES module (the artifact host and GitHub Pages
// serve .js reliably; .glb needs no extra MIME setup this way).
//   node tools/character/embed.mjs <outdir>/bean.glb    -> public/arenas/kit/hero.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const src = process.argv[2];
if (!src) { console.error('usage: node tools/character/embed.mjs path/to/bean.glb'); process.exit(1); }
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/arenas/kit/hero.js');
const b64 = fs.readFileSync(src).toString('base64');
fs.writeFileSync(out, `// bean.glb player model (tools/character/bean.py: plain soft jellybean, one smooth body+arms mesh)\nexport const HERO_GLB = '${b64}';\n`);
console.log('wrote', out, Math.round(b64.length / 1024), 'KB');
