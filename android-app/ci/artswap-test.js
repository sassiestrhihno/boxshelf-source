// Device test (beta.14): box art arriving for games already on the shelf (library:changed while you rest on it) swaps
// just those pictures on the cases in place: no case is taken down or built again, and only the changed covers load.
// It used to rebuild the whole shelf (every case and every cover again). A picture taken away still rebuilds.
// The scan is wrapped so chosen games come back with art, and the shelf hears library:changed as it does from main.
// Windows 1440x810 and the Android build (853x480 @2.25, touch).
'use strict';
module.exports = async function artSwapPass({ browser, base, check }) {
  const INIT = () => {
    const svg = (c, t) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${c}"/><text x="10" y="150">${t}</text></svg>`);
    window.__libFns = []; window.__art = {}; let real;
    Object.defineProperty(window, 'boxshelf', { configurable: true, get() { return real; }, set(v) { real = v;
      const scan = v.scan; v.scan = async (...a) => { const out = await scan(...a);
        for (const s of out) for (const g of (s.games || [])) { const k = window.__art[g.id]; if (k) g.art = Object.assign({}, g.art, { front: svg('#0a0', 'ART-' + k.t) }, k.spine ? { spine: svg('#222', 'SP-' + k.t) } : {}); }
        return out; };
      v.scanIfChanged = () => v.scan();
      const on = v.onLibraryChanged; v.onLibraryChanged = fn => { window.__libFns.push(fn); on && on(fn); };
    } });
  };
  for (const plat of ['windows', 'android']) {
    const and = plat === 'android', errors = [];
    const ctx = await browser.newContext(and ? { viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 810 } });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); let o = {};
    try {
      await page.goto(base + `?platform=${plat}&shelf=1`);
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(2500);
      o = await page.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms)), key = k => dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        key('ArrowRight'); await w(400); key('ArrowRight'); await w(2500);
        const titleOf = el => (el.querySelector('.spine-title') || {}).textContent, slotEls = () => [...document.querySelectorAll('#track .slot')];
        const selT = Shelf._qs().g, gs = (await window.boxshelf.scan()).find(s => (s.games || []).some(g => g.title === selT)).games, si = gs.findIndex(g => g.title === selT);
        const pick = gs.slice(si, si + 3);
        // the selected game and the two after it get a cover; the second also a spine
        pick.forEach((g, k) => { window.__art[g.id] = { t: g.title.replace(/\W/g, ''), spine: k === 1 }; });
        const run = async () => { const before = slotEls(); let adds = 0, rems = 0, srcs = 0;
          const mo = new MutationObserver(l => { for (const m of l) { if (m.type === 'childList' && m.target.id === 'track') { adds += m.addedNodes.length; rems += m.removedNodes.length; } if (m.type === 'attributes' && m.target.matches('.f-front img')) srcs++; } });
          mo.observe(document.getElementById('track'), { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
          window.__libFns.forEach(f => f({ covers: 3 }));
          // (Android: each swap waits for its picture's decode and a frame of its own)
          await w(3500); mo.disconnect();
          return { kept: before.filter(e => e.isConnected).length, of: before.length, adds, rems, srcs }; };
        const shown = t => { const el = slotEls().find(e => titleOf(e) === t), im = el && el.querySelector('.f-front img'); const m = im && /ART-\w+/.exec(decodeURIComponent(im.getAttribute('src') || '')); return m ? m[0] : 'none'; };
        const swap = await run();
        const fronts = pick.map(g => shown(g.title)), want = pick.map(g => 'ART-' + g.title.replace(/\W/g, ''));
        const spEl = slotEls().find(e => titleOf(e) === pick[1].title), spines = spEl ? [...spEl.querySelectorAll('.spine-img')].filter(i => /SP-/.test(decodeURIComponent(i.getAttribute('src') || ''))).length : -1;
        const selAfter = Shelf._qs().g;
        // a picture taken away: that still rebuilds the shelf (a case can't go back to a made-up cover in place)
        delete window.__art[pick[2].id];
        const gone = await run();
        return { sel: selT, selAfter, swap, fronts, want, spines, gone, goneFront: shown(pick[2].title) };
      });
    } catch (e) { o.err = e.message; }
    await ctx.close();
    const s = o.swap || {}, g = o.gone || {};
    check(`Box art arriving (${plat}, beta.14): the cases stay and only the new pictures swap in (no case rebuilt, only the changed covers load)`,
      s.of > 0 && s.kept === s.of && s.adds === 0 && s.rems === 0 && s.srcs >= 3 && s.srcs < s.of && o.sel === o.selAfter, JSON.stringify(o).slice(0, 600));
    check(`Box art arriving (${plat}): the new covers and spine show on their cases`,
      JSON.stringify(o.fronts) === JSON.stringify(o.want) && o.spines === 2, JSON.stringify({ fronts: o.fronts, want: o.want, spines: o.spines }));
    check(`Box art arriving (${plat}): a picture taken away still rebuilds the shelf and the case goes back to its made-up cover`,
      g.rems > 0 && g.adds > 0 && o.goneFront === 'none', JSON.stringify({ gone: g, goneFront: o.goneFront }));
    check(`Box art arriving pass (${plat}): no script errors`, !errors.length, errors.slice(0, 3).join(' | '));
  }
};
