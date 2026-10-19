// Shared setup for the headless arena probes. They drive the real pages through the window.__* test hooks
// (see public/arenas/kit/KIT.md), with physics stepped by __skip and rendering off unless a screenshot is wanted.
//   serve the site:  python3 -m http.server -d public 4180     (or npm run build && npx vite preview)
//   env: ARENAS_URL (default http://localhost:4180/arenas/), PLAYWRIGHT_MODULE (default 'playwright'),
//        CHROMIUM (optional executable path)
const base = process.env.ARENAS_URL || 'http://localhost:4180/arenas/';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

export async function openArena(arena, query = '', { width = 640, height = 360 } = {}) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`${base}${arena}.html?bots=all${query}`);
  await page.waitForFunction(() => window.__players && window.__players().length, null, { timeout: 90000 });
  await page.evaluate(() => window.__render(false));
  return { browser, page, errors, close: () => browser.close() };
}
// play one round to the results (or maxSec of sim time) and summarise it
export const playRound = (page, disaster = null, maxSec = 90) => page.evaluate(([d, maxSec]) => {
  if (d) window.__disaster(d);
  for (let k = 0; k < maxSec * 10; k++) { window.__skip(0.1); if (window.__ctx.round?.phase === 'results') break; }
  const R = window.__results, st = window.__round, sum = (f) => st.players.reduce((a, p) => a + (p[f] || 0), 0);
  return { disaster: st.disaster, elims: R?.eliminationOrder || [], survivors: R?.survivors?.length ?? null, kos: sum('kos'), mantles: sum('mantles'), throws: sum('throws'), grabs: sum('grabs') };
}, [disaster, maxSec]);
export const ARENAS = { kitchen: ['stampede', 'stomp', 'flood', 'meteor'], ship: ['lightning', 'meteor', 'flood', 'stampede', 'stomp'], station: ['decompress', 'meteor', 'lightning', 'stampede', 'stomp'] };
