// DOM HUD for arenas (styles in hud.css): timer, disaster tag, banners, player chips, results card, help, wipe.
//   const hud = createHUD({ title, helpHTML, wipeText, theme: { '--accent': '#ffb547', ... } });
const ORD = ['', '1st', '2nd', '3rd', '4th'];
export function createHUD({ title = 'Arena', helpHTML = '', wipeText = 'TABLETOP', theme = {}, loadingText = 'Loading…' } = {}) {
  for (const [k, v] of Object.entries(theme)) document.documentElement.style.setProperty(k, v);
  const el = (id, cls, html = '') => { const d = document.createElement('div'); d.id = id; d.className = cls; d.innerHTML = html; document.body.appendChild(d); return d; };
  if (!document.getElementById('stage')) el('stage', '');
  const loading = el('loading', 'ov', loadingText);
  const timer = el('timer', 'ov'), tag = el('tag', 'ov');
  const banner = el('banner', 'ov', '<div class="big"></div><div class="sub"></div>');
  const chips = el('chips', 'ov');
  const wipeEl = el('wipe', 'ov', `<span>${wipeText}</span>`);
  const results = el('results', 'ov', '<div class="card"><h1></h1><div class="rows"></div><div class="match"></div><button id="again" type="button">Play again <kbd>A</kbd> / <kbd>Enter</kbd></button></div>');
  const help = el('help', 'ov', `<div class="card"><h2>${title}</h2>${helpHTML}<p><kbd>H</kbd> / <kbd>Start</kbd> close</p></div>`);
  el('hint', 'ov', 'H / Start: help');
  const fpsEl = el('fps', 'ov');
  const sndEl = el('snd', 'ov', 'Sound is off: click or press any key');
  const benchEl = el('bench', 'ov', '<div class="card"><h1>Deck benchmark</h1><div class="rows"></div><p class="go"></p></div>');
  const bigEl = banner.querySelector('.big'), subEl = banner.querySelector('.sub');
  let bannerUntil = 0, helpOn = false, againFn = null;
  results.querySelector('#again').addEventListener('click', () => againFn?.());
  return {
    stage: document.getElementById('stage'),
    loaded() { loading.remove(); },
    timer(text, warn = false) { timer.textContent = text; timer.classList.toggle('warn', warn); },
    tag(html) { if (html == null) { tag.style.display = 'none'; return; } tag.style.display = 'block'; tag.innerHTML = html; },
    banner(big, sub = '', dur = 2, now = 0) { bigEl.textContent = big; subEl.textContent = sub; subEl.classList.toggle('has', !!sub); banner.classList.remove('on'); void banner.offsetWidth; banner.classList.add('on'); bannerUntil = now + dur; },
    clearBanner() { banner.classList.remove('on'); bannerUntil = 0; },
    update(now) { if (now > bannerUntil) banner.classList.remove('on'); },
    chips(list) { chips.innerHTML = list.map((p) => `<div class="chip ${p.out ? 'out' : ''}" style="background:${p.color}">${p.name}<small>${p.sub ?? (p.out ? 'OUT' : p.human ? 'PLAYER' : 'CPU')}</small></div>`).join(''); },
    // match (optional): { label, final, nextName, table: [{ i, pts, delta, rank }] } adds the running standings
    showResults(res, { colors, isHuman, match = null }) {
      results.style.display = 'flex';
      results.querySelector('h1').textContent = res.title ? res.title : res.draw ? 'DRAW!' : res.survivors.length === 1 ? `P${res.survivors[0] + 1} WINS!` : res.survivors.length ? `${res.survivors.length} SURVIVORS!` : `P${res.winners[0] + 1} LASTED LONGEST!`;
      const mEl = results.querySelector('.match'), btn = results.querySelector('#again');
      if (match) {
        const top = match.table.filter((r) => r.rank === 1).map((r) => 'P' + (r.i + 1));
        if (match.final) results.querySelector('h1').textContent = top.length === 1 ? `${top[0]} WINS THE MATCH!` : `${top.join(' & ')} SHARE THE MATCH!`;
        mEl.innerHTML = `<div class="mh">${match.final ? 'Final standings' : 'Match standings'} <small>${match.label}</small></div><div class="mrow">${match.table.map((r) => `<span class="mchip ${r.rank === 1 ? 'lead' : ''}"><span class="dot" style="background:${colors[r.i]}"></span>P${r.i + 1}<b>${r.pts}</b><small>${r.delta ? '+' + r.delta : ''}</small></span>`).join('')}</div>`;
        btn.innerHTML = match.final ? 'Back to menu <kbd>A</kbd> / <kbd>Enter</kbd>' : `Next: ${match.nextName} <kbd>A</kbd> / <kbd>Enter</kbd>`;
      } else { mEl.innerHTML = ''; btn.innerHTML = 'Play again <kbd>A</kbd> / <kbd>Enter</kbd>'; }
      results.querySelector('.rows').innerHTML = res.placements.map((r) => `<div class="row ${r.place === 1 && !res.draw ? 'win' : ''}"><span class="pl">${res.draw ? '–' : ORD[r.place]}</span>
        <span class="nm"><span class="dot" style="background:${colors[r.i]}"></span>P${r.i + 1} <span class="st" style="margin-left:.4em">${isHuman(r.i) ? '' : 'CPU'}</span></span><span class="st">${r.status}</span></div>`).join('');
      results.querySelector('#again').focus();
    },
    hideResults() { results.style.display = 'none'; },
    onAgain(fn) { againFn = fn; },
    wipe(cover) {
      wipeEl.style.transition = 'none'; wipeEl.style.clipPath = cover ? 'circle(0% at 50% 50%)' : 'circle(75% at 50% 50%)'; void wipeEl.offsetWidth;
      wipeEl.style.transition = 'clip-path 0.55s cubic-bezier(.6,0,.3,1)'; wipeEl.style.clipPath = cover ? 'circle(75% at 50% 50%)' : 'circle(0% at 50% 50%)';
    },
    toggleHelp() { helpOn = !helpOn; help.style.display = helpOn ? 'flex' : 'none'; return helpOn; },
    get helpOn() { return helpOn; },
    fps(text) { fpsEl.textContent = text; },
    sound(on) { sndEl.style.display = on ? 'none' : 'block'; },
    // rows: [{ arena, fps, low, worst, sim, phys, chr, res, secs, gpu }] (text only: values may come from the URL)
    bench(rows, goText) {
      const box = benchEl.querySelector('.rows'); box.textContent = '';
      for (const r of rows) {
        const d = document.createElement('div'); d.className = 'brow';
        const h = document.createElement('b'); h.textContent = `${r.arena}: ${r.fps} fps average, ${r.low} fps in the worst 1% of frames`; d.append(h);
        const m = document.createElement('span'); m.textContent = `worst frame ${r.worst} ms · simulation ${r.sim} ms per step (physics ${r.phys}, characters ${r.chr}) · ${r.res} · ${r.secs} s sampled`; d.append(m);
        box.append(d);
      }
      const g = document.createElement('span'); g.className = 'gpu'; g.textContent = rows.length ? 'GPU: ' + rows[rows.length - 1].gpu : ''; box.append(g);
      benchEl.querySelector('.go').textContent = goText; benchEl.style.display = 'flex';
    },
  };
}
