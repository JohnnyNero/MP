// Match flow: start a match from the menu, play every round with bots, check scoring and page-to-page flow.
//   node tools/probes/match.mjs
const base = process.env.ARENAS_URL || 'http://localhost:4180/arenas/';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + 'index.html');
await page.click('#match');
let rounds = 0;
for (;;) {
  await page.waitForFunction(() => window.__players && window.__players().length, null, { timeout: 90000 });
  const r = await page.evaluate(() => {
    window.__render(false); for (let i = 0; i < 4; i++) window.__inject(i, null);
    for (let k = 0; k < 900 && window.__ctx.round?.phase !== 'results'; k++) window.__skip(0.1);
    const m = window.__match;
    return { arena: window.__round.arena, tag: document.getElementById('tag')?.textContent, h1: document.querySelector('#results h1')?.textContent, standings: document.querySelector('#results .mrow')?.textContent, button: document.getElementById('again')?.textContent, i: m?.i, points: m?.points };
  });
  rounds++; console.log(JSON.stringify(r));
  if (rounds === 3) await page.screenshot({ path: process.env.SHOT || '/tmp/match_results.png' });
  const nav = page.waitForNavigation({ timeout: 30000 });
  await page.evaluate(() => window.__playAgain());
  await nav;
  if (page.url().includes('index.html')) break;
  if (rounds > 8) throw new Error('match did not end');
}
console.log('rounds played', rounds, 'ended at', page.url().replace(base, ''), errors.length ? 'ERRORS ' + errors.slice(0, 3) : 'no errors');
await browser.close();
process.exit(errors.length || rounds !== 6 ? 1 : 0);
