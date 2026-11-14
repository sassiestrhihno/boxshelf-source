// Device test (beta.14, Windows): Details' extra screenshots (main/moreshots.js through api.moreShots). A game with 2
// screenshots asks main once; the 4 that come back join the end of the strip (the first two stay where they were); opening
// Details again doesn't ask again; a game with 8 never asks. The page's mock answers (?moreshots=1, renderer/mock.js).
//   cd android-app; node copy-web.js; node ci/run-pass.js moreshots-pass.js
'use strict';
module.exports = async function moreShotsPass({ browser, base, check }) {
  const errors = [];
  const open = async q => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }), p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    await p.goto(base + q);
    await p.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._lib, null, { timeout: 90000, polling: 250 }); await p.waitForTimeout(1500);
    await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 12 && Shelf.getMode() !== 'note'; i++) await w(250); if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } });
    for (let i = 0; i < 8; i++) { if (await p.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(450); }
    return { ctx, p };
  };
  const details = p => p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    for (let t = 0; t < 3 && Shelf.getMode() !== 'details'; t++) { if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } key('i'); for (let i = 0; i < 20 && Shelf.getMode() !== 'details'; i++) await w(150); }
    return Shelf.getMode(); });
  const strip = p => p.evaluate(() => [...document.querySelectorAll('#dShots .d-shot img')].map(i => i.getAttribute('src')));
  let a = null, b = null;
  try {
    a = await open('?platform=windows&shelf=1&shots=2&moreshots=1&desc=1');
    const m0 = await details(a.p), first = await strip(a.p);
    await a.p.waitForTimeout(1500);
    const after = await strip(a.p), calls = await a.p.evaluate(() => (window.__moreShots || []).map(o => ({ sys: o.systemId, file: !!o.file, n: (o.shots || []).length })));
    const shown = await a.p.evaluate(() => ({ hidden: document.getElementById('dShots').hidden, none: !document.getElementById('dNoMedia').hidden }));
    check('More screenshots (beta.14): a game with 2 asks main once, with its console, file and the 2 it has',
      m0 === 'details' && first.length === 2 && calls.length === 1 && calls[0].n === 2 && calls[0].file && !!calls[0].sys, JSON.stringify({ m0, first: first.length, calls }));
    check('More screenshots: the 4 that come back join the end of the strip (6 in all), the first two stay where they were',
      after.length === 6 && after[0] === first[0] && after[1] === first[1] && !shown.hidden && !shown.none, JSON.stringify({ n: after.length, shown }));
    // Details closed and opened again: not asked again (the game's list has 6 now)
    await a.p.keyboard.press('Escape'); await a.p.waitForTimeout(900); await details(a.p); await a.p.waitForTimeout(900);
    const again = await a.p.evaluate(() => (window.__moreShots || []).length), n2 = (await strip(a.p)).length;
    check('More screenshots: opening Details again asks nothing more and shows the 6', again === 1 && n2 === 6, JSON.stringify({ again, n2 }));
    b = await open('?platform=windows&shelf=1&shots=1&moreshots=1&desc=1');
    await details(b.p); await b.p.waitForTimeout(1200);
    const full = await b.p.evaluate(() => ({ calls: (window.__moreShots || []).length, n: document.querySelectorAll('#dShots .d-shot').length }));
    check('More screenshots: a game with 8 never asks', full.calls === 0 && full.n === 8, JSON.stringify(full));
    check('More screenshots: no page errors', !errors.length, errors.slice(0, 5).join(' | '));
  } finally { if (a) await a.ctx.close().catch(() => {}); if (b) await b.ctx.close().catch(() => {}); }
};
