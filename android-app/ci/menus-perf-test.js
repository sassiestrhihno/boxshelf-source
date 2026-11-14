// Device test pass (beta.14 perf, Windows): menu work that should not repeat.
//   1. The Art Studio picker doesn't ask main for a part's list again while that part's thumbnails are still on their way
//      (settings.js loadCands / candAsk): going back to the games list and into the same game asks once, not twice.
//      Another part and back still asks again (main stopped the first part's downloads), and every card gets its picture.
//   2. Settings with no controller connected doesn't poll every frame (settings.js slowPoll): while it sits idle, its
//      poll asks for at most a dozen frames a second; a controller turning up is read again every frame.
// Counts only (no timing thresholds): the page draws in software.
'use strict';
module.exports = async function menusPerfPass({ browser, base, check }) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => {
    window.__artThumbMs = 6000;
    const raf = window.requestAnimationFrame.bind(window);
    window.__rafBy = null;
    window.requestAnimationFrame = function (cb) {
      if (window.__rafBy) { const s = (new Error().stack || '').split('\n').slice(2).find(l => !/__rafBy|perf-meter/.test(l)) || ''; if (/settings\.js/.test(s) && /\bpoll\b/.test(s)) window.__rafBy.poll++; }
      return raf(cb);
    };
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  const w = ms => page.waitForTimeout(ms), o = {};
  try {
    await page.goto(base + '?platform=windows&shelf=1');
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._tour && window.Setup, null, { timeout: 90000, polling: 250 });
    await w(1500);
    await page.evaluate(() => { const a = window.boxshelf, f = a.artCandidates; window.__asks = []; a.artCandidates = q => { window.__sys = q.systemId; window.__asks.push(q.part); return f(q); }; });
    for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await w(400); }
    // (the console's id, from the Art Studio opened on the game in front)
    await page.evaluate(() => Shelf._tour.artStudio());
    await page.waitForFunction(() => document.querySelectorAll('#bss .bsa-part').length > 3, null, { timeout: 30000, polling: 200 }); await w(600);
    await page.evaluate(() => Settings.close()); await w(900);

    // 2. idle Settings, no controller: the poll's frames over 2 s
    await page.evaluate(() => Setup.open()); await w(1500);
    o.poll = await page.evaluate(async () => { window.__rafBy = { poll: 0 }; await new Promise(r => setTimeout(r, 2000)); const n = window.__rafBy.poll; window.__rafBy = null; return n; });
    // a controller turns up: read again every frame
    o.padPoll = await page.evaluate(async () => {
      const pad = { id: 'Xbox 360 Controller (XInput STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      /* (on the instance: the phone remote, companion/tv-input.js, wraps navigator.getGamepads there) */
      const own = Object.getOwnPropertyDescriptor(navigator, 'getGamepads');
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
      const ev = new Event('gamepadconnected'); ev.gamepad = pad; window.dispatchEvent(ev);
      window.__rafBy = { poll: 0 }; await new Promise(r => setTimeout(r, 1000)); const n = window.__rafBy.poll; window.__rafBy = null;
      if (own) Object.defineProperty(navigator, 'getGamepads', own); else delete navigator.getGamepads;
      return n; });
    await page.evaluate(() => Settings.close()); await w(900);

    // 1. the console's games, into a game, back, into the same game again; then Back and Front again
    await page.evaluate(() => { window.__asks.length = 0; Setup.open({ page: 'artstudio', systemId: window.__sys }); }); await w(1800);
    await page.keyboard.press('ArrowDown'); await w(300);
    await page.keyboard.press('Enter'); await w(1200); o.first = (await page.evaluate(() => window.__asks.slice()));
    await page.keyboard.press('Escape'); await w(900);
    await page.keyboard.press('Enter'); await w(1200); o.again = (await page.evaluate(() => window.__asks.slice()));
    const part = re => page.evaluate(s => { const b = [...document.querySelectorAll('#bss .bsa-part')].find(e => new RegExp(s, 'i').test(e.textContent)); if (b) b.click(); return !!b; }, re);
    await part('^\\s*back'); await w(600); await part('^\\s*front'); await w(600); o.toggle = await page.evaluate(() => window.__asks.slice());
    /* (a card can show a still placeholder for a moment: the first ask's "stopped" note for it can land after the new list) */
    await page.waitForFunction(() => { const c = document.querySelectorAll('#bss .bsa-card .in:not(.act)').length; return c > 0 && document.querySelectorAll('#bss .bsa-card .in:not(.act) .im img').length === c; }, null, { timeout: 20000, polling: 250 }).catch(() => {});
    o.cards = await page.evaluate(() => ({ cards: document.querySelectorAll('#bss .bsa-card .in:not(.act)').length, img: document.querySelectorAll('#bss .bsa-card .in:not(.act) .im img').length, wait: document.querySelectorAll('#bss .bsa-card .bsa-ph.wait').length }));
    await page.evaluate(() => Settings.close()); await w(600);
  } catch (e) { o.err = e.message; }
  await ctx.close().catch(() => {});
  check('Menus perf (beta.14): the Art Studio asks for a part\'s list once while its thumbnails are on their way (back and into the same game: no second ask)',
    !!o.first && o.first.length === 1 && o.again && o.again.length === 1, JSON.stringify(o));
  check('Menus perf: another part and back asks again (its downloads were stopped), and every card still gets its picture',
    !!o.toggle && o.toggle.join() === 'front,back,front' && o.cards && o.cards.cards > 0 && o.cards.img === o.cards.cards && o.cards.wait === 0, JSON.stringify({ toggle: o.toggle, cards: o.cards, err: o.err }));
  check('Menus perf: Settings with no controller polls at most ~12 times a second while idle (it was every frame); a controller turning up is read every frame',
    typeof o.poll === 'number' && o.poll <= 26 && o.poll >= 6 && o.padPoll > 20, JSON.stringify({ poll: o.poll, padPoll: o.padPoll, err: o.err }));
  check('Menus perf pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
