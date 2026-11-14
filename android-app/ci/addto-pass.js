// Device test pass "addto" (beta.14), run by web-device-test.js (windows group). Checks results, never speed.
//   + Add to… on the Windows page (?platform=windows&shelf=1&pcx=1): the quick menu's game buttons have Add to… in place of
//   ♡; it opens in place with Favourites, My shelves (+ New shelf…) and the console shelves, PC and Custom, the game's own
//   shelf ticked and fixed. A GameCube game added to the Wii shelf shows on both (by title among the Wii games, saved in
//   ui.shelfAdds) and Play from the Wii shelf still starts it as a GameCube game; unticked on the Wii shelf it goes from there.
//   A My shelf and Favourites toggle; New shelf… types a name in Settings and makes the shelf with the game. Details' ··· →
//   Add to… opens the same list (B goes back to Details). Kid mode: no Add to…, the ♡ is back. No script errors.
'use strict';
const path = require('path');

module.exports = async function addToPass({ browser, base, check, newPage, OUT }) {
  const { ctx, page, errors } = await newPage(browser, null);
  try {
    await page.goto(base + '?platform=windows&shelf=1&pcx=1');
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._adds && window.Setup && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1500);
    const H = `
      window.__at = { w: ms => new Promise(r => setTimeout(r, ms)) };
      __at.key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      __at.cfg = async () => (await window.boxshelf.getConfig()).config;
      __at.browse = async () => { for (let i = 0; i < 100 && Shelf.getMode() !== 'browse'; i++) await __at.w(250); };
      __at.lines = () => [...document.querySelectorAll('.qm-sub .qm-line')].filter(l => l.querySelector('.qm-opt[data-k="addto"]')).map(l => ({ l: ((l.querySelector('.qm-ll') || {}).textContent || ''), o: [...l.querySelectorAll('.qm-opt')].map(b => ({ v: b.dataset.v, t: b.textContent, cur: b.classList.contains('cur') })) }));
      __at.opt = v => document.querySelector('.qm-opt[data-k="addto"][data-v="' + v + '"]');
      __at.cur = v => { const b = __at.opt(v); return b ? b.classList.contains('cur') : null; };
      __at.openAdd = async () => { if (!Shelf._tour.qmOn()) { Shelf._tour.qmOpen(); await __at.w(700); } const b = document.querySelector('.qm-act[data-k="add"]'); if (!b) return false; if (Shelf._qs().sub !== 0) { b.click(); await __at.w(600); } return Shelf._qs().sub === 0; };
      __at.pick = async (v, until) => { const b = __at.opt(v); if (!b) return false; b.click(); for (let i = 0; i < 40; i++) { await __at.w(150); if (!until || await until()) break; } await __at.w(500); return true; };
      __at.toast = () => ((document.getElementById('toast') || {}).textContent || '').trim();
      __at.close = async () => { if (Shelf._tour.qmOn()) { Shelf._tour.qmClose(); await __at.w(500); } };`;
    await page.evaluate(H);

    // ---- the list, its own shelf, adding to the Wii shelf ----
    const a = await page.evaluate(async () => { const { w, key, cfg, lines, cur, openAdd, pick, toast, close } = __at, out = {};
      Shelf._find.go('gc0'); await w(900); out.at = Shelf._adds.on();
      Shelf._tour.qmOpen(); await w(700); out.acts = [...document.querySelectorAll('.qm-act')].map(b => b.dataset.k);
      out.btn = ((document.querySelector('.qm-act[data-k="add"]') || {}).textContent || '').trim();
      out.opened = await openAdd(); out.lines = lines();
      // the keyboard: Esc folds it back onto the buttons, Enter opens it again, ↓ goes down its lines
      key('Escape'); await w(400); out.folded = Shelf._qs().sub === null && Shelf._qs().open && Shelf._qs().id === 'acts';
      key('Enter'); await w(500); out.reopened = Shelf._qs().sub === 0; key('ArrowDown'); await w(200); key('ArrowDown'); await w(200); out.down = Shelf._qs().sr;
      // its own shelf can't be unticked
      const before = JSON.stringify((await cfg()).ui.shelfAdds || {}); await pick('sh:gc'); out.ownSame = JSON.stringify((await cfg()).ui.shelfAdds || {}) === before; out.ownCur = cur('sh:gc'); out.ownToast = toast();
      // add it to the Wii shelf
      await pick('sh:wii', async () => (((await cfg()).ui.shelfAdds || {}).wii || []).includes('gc0'));
      out.saved = ((await cfg()).ui.shelfAdds || {}).wii || []; out.menuOpen = Shelf._tour.qmOn(); out.wiiCur = cur('sh:wii'); out.wiiText = ((__at.opt('sh:wii') || {}).textContent || ''); out.addToast = toast();
      out.wii = Shelf._adds.ids('wii'); out.gc = Shelf._adds.ids('gc'); out.stillOn = Shelf._adds.on();
      await close(); return out; });
    const L = a.lines || [], vals = i => ((L[i] || {}).o || []).map(o => o.v), ownOpt = ((L[2] || {}).o || []).find(o => o.v === 'sh:gc') || {};
    check('Add to… (Windows): the quick menu\'s game buttons have Add to… in place of ♡; it opens in place under them',
      a.at.own === 'gc' && a.acts[0] === 'add' && !a.acts.includes('fav') && /Add to/.test(a.btn) && a.opened === true, JSON.stringify({ at: a.at, acts: a.acts, btn: a.btn, opened: a.opened }));
    check('Add to…: Favourites, My shelves (with + New shelf…), then the console shelves, PC and Custom; the game\'s own shelf ticked',
      L.length === 3 && /Favourites/.test(L[0].l) && vals(0).join() === 'fav' && /My shelves/.test(L[1].l) && vals(1).includes('colnew') && /Console shelves/.test(L[2].l)
        && ['sh:gc', 'sh:wii', 'sh:pc', 'sh:custom'].every(v => vals(2).includes(v)) && vals(2).slice(-2).join() === 'sh:pc,sh:custom' && ownOpt.cur && /its own/.test(ownOpt.t) && /^✓/.test(ownOpt.t), JSON.stringify(L).slice(0, 700));
    check('Add to… with the keyboard: Esc folds it onto the buttons, Enter opens it again, ↓ moves down its lines',
      a.folded && a.reopened && a.down === 2, JSON.stringify({ folded: a.folded, reopened: a.reopened, down: a.down }));
    check('Add to…: the game\'s own shelf stays ticked (choosing it changes nothing)', a.ownSame && a.ownCur === true, JSON.stringify({ same: a.ownSame, cur: a.ownCur, toast: a.ownToast }));
    check('Add to… → Wii: saved at once (ui.shelfAdds), the menu stays open with Wii ticked, a toast says so',
      a.saved.includes('gc0') && a.menuOpen && a.wiiCur === true && /^✓/.test(a.wiiText) && (/Added to Wii/.test(a.addToast) || a.addToast === ''), JSON.stringify({ saved: a.saved, menu: a.menuOpen, cur: a.wiiCur, t: a.wiiText, toast: a.addToast }));
    check('Add to… → Wii: the GameCube game shows on the Wii shelf (first by title) and stays on its own; no rescan needed',
      !!a.wii && a.wii.all.includes('gc0') && a.wii.added.join() === 'gc0' && !a.wii.own.includes('gc0') && a.wii.all[0] === 'gc0' && a.gc.own.includes('gc0') && a.stillOn.game === 'gc0' && a.stillOn.shelf === 'gc',
      JSON.stringify({ wii: a.wii, gcOwn: a.gc && a.gc.own.length, on: a.stillOn }).slice(0, 500));

    // ---- on the Wii shelf: Play starts it as a GameCube game; then taken off the Wii shelf ----
    const b = await page.evaluate(async () => { const { w, key, cfg, browse, lines, cur, openAdd, pick, close } = __at, out = {};
      out.went = Shelf._adds.go('wii', 'gc0'); await w(900); out.on = Shelf._adds.on();
      window.__launched = []; key('Enter'); await w(600); if (Shelf.getMode() === 'details') { document.getElementById('dPlay').click(); await w(300); }
      for (let i = 0; i < 60 && !(window.__launched || []).length; i++) await w(200); out.launched = (window.__launched || [])[0] || null;
      await w(4500); await browse(); await w(800);
      if (Shelf._adds.on().game !== 'gc0') { Shelf._adds.go('wii', 'gc0'); await w(900); }
      out.on2 = Shelf._adds.on(); out.opened = await openAdd(); out.wiiCur = cur('sh:wii'); out.gcCur = cur('sh:gc');
      await pick('sh:wii', async () => !(((await cfg()).ui.shelfAdds || {}).wii || []).includes('gc0'));
      out.saved = (await cfg()).ui.shelfAdds || {}; out.menu = Shelf._tour.qmOn(); out.after = Shelf._adds.on(); out.wii = Shelf._adds.ids('wii'); out.gc = Shelf._adds.ids('gc');
      await close(); return out; });
    check('Add to…: on the Wii shelf the GameCube game is still a GameCube game (Play starts it as one)',
      b.went && b.on.shelf === 'wii' && b.on.own === 'gc' && !!b.launched && b.launched.sys === 'gc' && /Aether Drift/.test(b.launched.file || ''), JSON.stringify({ on: b.on, launched: b.launched }));
    check('Add to… on the added copy: Wii ticked (and its own shelf); unticking Wii takes it off there, saved, the shelf lands on a neighbour',
      b.opened && b.wiiCur === true && b.gcCur === true && !('wii' in b.saved) && !b.menu && b.after.shelf === 'wii' && b.after.game !== 'gc0' && !b.wii.all.includes('gc0') && b.gc.own.includes('gc0'),
      JSON.stringify({ on2: b.on2, opened: b.opened, wiiCur: b.wiiCur, saved: b.saved, menu: b.menu, after: b.after, wii: b.wii && b.wii.all.slice(0, 4) }));

    // ---- a My shelf, Favourites ----
    const c = await page.evaluate(async () => { const { w, cfg, cur, openAdd, pick, close } = __at, out = {};
      { const k = await cfg(); k.ui.collections = [{ id: 't1', name: 'Couch', ids: [] }]; await window.boxshelf.saveConfig(k); await Shelf.refresh(true); await w(900); }
      Shelf._find.go('gc0'); await w(900); out.opened = await openAdd(); out.colText = ((__at.opt('col:t1') || {}).textContent || '');
      const ids = async () => (((await cfg()).ui.collections || []).find(x => x.id === 't1') || {}).ids || [];
      await pick('col:t1', async () => (await ids()).includes('gc0')); out.colIn = await ids(); out.colCur = cur('col:t1'); out.colShelf = Shelf._adds.go('col-t1', 'gc0'); await w(900); out.onCol = Shelf._adds.on();
      Shelf._find.go('gc0'); await w(900); await openAdd();
      await pick('col:t1', async () => !(await ids()).includes('gc0')); out.colOut = await ids(); out.colCur2 = cur('col:t1');
      const favs = async () => (await cfg()).ui.favorites || [];
      await pick('fav', async () => (await favs()).includes('gc0')); out.favIn = (await favs()).includes('gc0'); out.favText = ((__at.opt('fav') || {}).textContent || ''); out.favCur = cur('fav');
      await pick('fav', async () => !(await favs()).includes('gc0')); out.favOut = !(await favs()).includes('gc0'); out.favText2 = ((__at.opt('fav') || {}).textContent || '');
      await close(); return out; });
    check('Add to… → a My shelf: on it (saved, ticked, its shelf shows the game), and off again',
      c.opened && c.colText === 'Couch' && c.colIn.includes('gc0') && c.colCur === true && c.colShelf === true && c.onCol.shelf === 'col-t1' && !c.colOut.includes('gc0') && c.colCur2 === false, JSON.stringify(c).slice(0, 500));
    check('Add to… → Favourites toggles (♡ / ✓)', c.favIn && /^✓ Favourites/.test(c.favText) && c.favCur === true && c.favOut && /^♡ Favourites/.test(c.favText2), JSON.stringify({ favIn: c.favIn, t: c.favText, out: c.favOut, t2: c.favText2 }));

    // ---- + New shelf…: Settings' New shelf row, typed into, makes the shelf with the game ----
    const d0 = await page.evaluate(async () => { const { w, openAdd, pick } = __at, out = {};
      Shelf._find.go('gc0'); await w(900); await openAdd(); await pick('colnew');
      for (let i = 0; i < 40 && !(document.activeElement && document.activeElement.classList.contains('bss-edit')); i++) await w(150);
      out.settings = !!(window.Settings && Settings.isOpen && Settings.isOpen()); out.editing = !!(document.activeElement && document.activeElement.classList.contains('bss-edit')); out.menu = Shelf._tour.qmOn(); return out; });
    if (d0.editing) { await page.keyboard.type('Racing'); await page.keyboard.press('Enter'); }
    const d = await page.evaluate(async () => { const { w, cfg, browse } = __at, out = {}; await w(900);
      out.made = ((await cfg()).ui.collections || []).find(x => x.name === 'Racing') || null;
      if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(1500); } await browse(); return out; });
    check('Add to… → + New shelf…: Settings opens typing the new shelf\'s name; Enter makes it with the game on it',
      d0.settings && d0.editing && !d0.menu && !!d.made && JSON.stringify(d.made.ids) === '["gc0"]', JSON.stringify({ d0, made: d.made }));

    // ---- Details' ··· → Add to… ----
    const e = await page.evaluate(async () => { const { w, key, lines, close } = __at, out = {};
      Shelf._find.go('gc0'); await w(900); Shelf._tour.qmOpen(); await w(700); const det = document.querySelector('.qm-act[data-k="det"]'); if (det) det.click(); await w(1200);
      out.mode = Shelf.getMode(); const btn = document.getElementById('dAddTo'); out.btn = !!btn && !btn.hidden && btn.textContent; out.inMenu = !!(btn && btn.closest('#dMenu'));
      if (btn) btn.click(); await w(900); out.qm = Shelf._tour.qmOn(); out.sub = Shelf._qs().sub; out.n = lines().length;
      key('Escape'); await w(400); key('Escape'); await w(1200); out.back = Shelf.getMode();
      if (Shelf.getMode() === 'details') { key('Escape'); await w(900); } await close(); return out; });
    check('Details (Windows): ··· → Add to… opens the quick menu straight at the Add to… list; B goes back to Details',
      e.mode === 'details' && e.btn === 'Add to…' && e.inMenu && e.qm && e.sub === 0 && e.n === 3 && e.back === 'details', JSON.stringify(e));

    // ---- Kid mode: no Add to…, the ♡ instead ----
    const k = await page.evaluate(async () => { const { w, cfg, browse, close } = __at, out = {};
      { const c = await cfg(); c.ui.kid = { on: true, pin: 'pretend', hidden: [] }; await window.boxshelf.saveConfig(c); await Shelf.refresh(true); await w(900); }
      Shelf._find.go('gc0'); await w(900); Shelf._tour.qmOpen(); await w(700); out.acts = [...document.querySelectorAll('.qm-act')].map(b => b.dataset.k); out.subs = document.querySelectorAll('.qm-opt[data-k="addto"]').length;
      const det = document.querySelector('.qm-act[data-k="det"]'); if (det) det.click(); await w(1200); out.detMode = Shelf.getMode();
      const btn = document.getElementById('dAddTo'); out.detHidden = !btn || btn.hidden; if (Shelf.getMode() === 'details') { __at.key('Escape'); await w(900); } await close(); await browse();
      { const c = await cfg(); delete c.ui.kid; c.ui.collections = []; c.ui.shelfAdds = {}; c.ui.favorites = []; await window.boxshelf.saveConfig(c); await Shelf.refresh(true); await w(900); }
      Shelf._tour.qmOpen(); await w(700); out.actsAfter = [...document.querySelectorAll('.qm-act')].map(b => b.dataset.k); await close(); await browse(); return out; });
    check('Add to…: not in Kid mode (the ♡ is back; Details\' Add to… hidden); back once Kid mode is off',
      k.acts.includes('fav') && !k.acts.includes('add') && k.subs === 0 && k.detMode === 'details' && k.detHidden &&k.actsAfter[0] === 'add', JSON.stringify(k));
    await page.screenshot({ path: path.join(OUT, 'addto.png') }).catch(() => {});
    check('Add to… pass (Windows page): no script errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (err) { check('Add to… pass (Windows page) ran to the end', false, err && err.stack ? err.stack.split('\n').slice(0, 2).join(' ') : err); }
  await ctx.close();
};
