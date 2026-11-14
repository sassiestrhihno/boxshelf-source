// Device test (beta.14, Windows): Details rebuilt to the approved mockup. A solid panel beside the case; the header
// ("<console> › Details", a title at about half its old size, one line of facts, the chips: Status, rating, achievements,
// age rating); only Play, ♡ and ··· in the button row (More opens a row of pills with every other action); tabs in
// Settings' pills (LB / RB, Q / E, a click, a tap): Overview (trailer box, description in three lines with More / Less,
// an achievements card; the facts as label / value rows), Achievements (the list with All / Unlocked / Locked, the
// summary), Media (screenshots, the box art, Change in Art Studio), Your copy (file, size, version, emulator, Set up for
// me, manual, box art, rename, My shelves, hide, the launch command). A small window keeps the tab you're on in view.
'use strict';
const path = require('path');
module.exports = async function detailsTabsPass({ browser, base, check, OUT }) {
  const errors = [], o = {};
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const open = async (pg, q) => {
    await pg.goto(base + q);
    await pg.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._lib, null, { timeout: 90000, polling: 250 }); await pg.waitForTimeout(1500);
    await pg.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 12 && Shelf.getMode() !== 'note'; i++) await w(250); if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } }); // (the "Updated" card, if it came)
    for (let i = 0; i < 8; i++) { if (await pg.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(450); }
    await pg.evaluate(() => { const g = Shelf._lib.cur(), now = Date.now() / 1000; Shelf._mus.hist({ [g.id]: { count: 3, ms: 12600000, last: (now - 3600) * 1000, s: [[Math.round(now - 3600), 3600]] } }); });
    await pg.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let t = 0; t < 3 && Shelf.getMode() !== 'details'; t++) { if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } key('i'); for (let i = 0; i < 20 && Shelf.getMode() !== 'details'; i++) await w(150); } });
    await pg.waitForTimeout(1600);
  };
  try {
    await open(p, '?platform=windows&shelf=1&ra=1&shots=1&desc=1');
    if (OUT) await p.screenshot({ path: path.join(OUT, 'details-tabs-overview.png') });
    // the header, the panel, the buttons
    Object.assign(o, await p.evaluate(() => { const $ = id => document.getElementById(id), d = $('details'), cs = getComputedStyle(d);
      const chips = [...$('dChips').children].filter(c => !c.hidden).map(c => c.textContent.trim());
      return { mode: Shelf.getMode(), kicker: $('dKicker').textContent, title: parseFloat(getComputedStyle($('dTitle')).fontSize), facts: $('dvFacts').textContent, chips, statusFirst: !!$('dChips').firstElementChild && $('dChips').firstElementChild.id === 'dvStatus',
        bg: cs.backgroundColor, panelLeft: d.getBoundingClientRect().left, caseRight: (document.querySelector('.slot.sel .f-front') || d).getBoundingClientRect().right,
        bar: [...d.querySelectorAll('.d-actions > button')].filter(b => !b.hidden).map(b => b.id), oldTabs: getComputedStyle($('dTabs')).display,
        tabs: [...document.querySelectorAll('#dvNav .dv-t')].filter(t => !t.hidden).map(t => t.dataset.s), placard: !!$('dvPl') || !!$('dvPh') }; }));
    check('Details tabs (beta.14, Windows): the header is "<console> › Details", a ~44 px title (was ~80), one line of facts (year · developer · genre · players · time played)',
      o.mode === 'details' && /›\s+Details$/.test(o.kicker) && o.title > 30 && o.title < 62 && /\d{4}/.test(o.facts) && /Moonbeam|Hollow|Kite/.test(o.facts) && /player/.test(o.facts) && /played/.test(o.facts),
      JSON.stringify({ mode: o.mode, kicker: o.kicker, title: o.title, facts: o.facts }));
    check('Details tabs: the chips are Status first, then the rating, achievements (x of y) and the age rating; the old "Game info" placard is gone',
      o.statusFirst && /Not started|Playing|Finished|Abandoned/.test(o.chips[0]) && o.chips.some(c => /★/.test(c)) && o.chips.some(c => /^\d+ of \d+$/.test(c)) && o.chips.some(c => /^Rated /.test(c)) && !o.placard,
      JSON.stringify({ chips: o.chips, placard: o.placard }));
    check('Details tabs: the panel is solid (nothing behind shows through) and starts right of the case; the button row is only Play, ♡ and ···; the tabs are Overview, Achievements, Media, Your copy',
      /^rgb\(/.test(o.bg) && o.panelLeft >= o.caseRight - 2 && JSON.stringify(o.bar) === '["dPlay","dFav","dMoreBtn"]' && o.oldTabs === 'none' && o.tabs.join() === 'overview,ach,media,copy',
      JSON.stringify({ bg: o.bg, left: o.panelLeft, caseRight: o.caseRight, bar: o.bar, tabs: o.tabs }));

    // Overview: the facts as rows, the description in three lines with More / Less, the achievements card
    o.ov = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), out = {};
      const rows = [...document.querySelectorAll('#dGrid > div')].map(r => [r.querySelector('dt').textContent, r.querySelector('dd').textContent]);
      out.keys = rows.map(r => r[0]); out.empty = rows.filter(r => !String(r[1]).trim()).length; out.gridRight = $('dGrid').getBoundingClientRect().left > $('dvVid').getBoundingClientRect().right;
      const dd = $('dDesc'), m = $('dMore'); out.clamp = dd.classList.contains('clamp'); out.h0 = dd.clientHeight; out.lh = parseFloat(getComputedStyle(dd).lineHeight); out.more = !m.hidden && m.textContent;
      m.click(); await w(300); out.less = m.textContent; out.h1 = dd.clientHeight; m.click(); await w(300); out.back = m.textContent;
      const am = $('dvAchSum'); out.card = !am.hidden && am.textContent; am.click(); await w(500); out.cardTab = (document.querySelector('#dvNav .dv-t.cur') || { dataset: {} }).dataset.s;
      document.querySelector('#dvNav .dv-t[data-s="overview"]').click(); await w(400); return out; });
    check('Details tabs: Overview\'s facts are label / value rows beside the trailer (Developer, Publisher, Released, Genre, Players, Region, Last / Time played), none empty',
      ['Developer', 'Publisher', 'Released', 'Genre', 'Players', 'Region', 'Last played', 'Time played'].every(k => o.ov.keys.includes(k)) && o.ov.empty === 0 && o.ov.gridRight, JSON.stringify(o.ov));
    check('Details tabs: the description shows three lines with More; More opens it all (Less), Less folds it again; the achievements card opens the Achievements tab',
      o.ov.clamp && o.ov.h0 <= o.ov.lh * 3 + 2 && o.ov.more === 'More' && o.ov.less === 'Less' && o.ov.h1 > o.ov.h0 && o.ov.back === 'More' && /6 of 40/.test(o.ov.card || '') && o.ov.cardTab === 'ach',
      JSON.stringify(o.ov));

    // the tabs: RB / LB (a pretend controller), a click, E / Q; only the tab you're on shows
    o.tabsRun = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {}, key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      const cur = () => (document.querySelector('#dvNav .dv-t.cur') || { dataset: {} }).dataset.s, shown = () => [...document.querySelectorAll('#details .dv-sec')].filter(e => e.getBoundingClientRect().height > 0).map(e => e.dataset.s).join();
      const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      await w(1800); // (a pad just seen: its buttons wait 1.5 s)
      const press = async b => { if (window.__padHold) { await __padHold(pad, b, 250); await w(450); return; } pad.buttons[b] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(250); pad.buttons[b] = { pressed: false, touched: false, value: 0 }; pad.timestamp++; await w(450); };
      out.start = [cur(), shown()];
      for (let i = 0; i < 3 && cur() === 'overview'; i++) await press(5); out.rb = [cur(), shown()];
      for (let i = 0; i < 3 && cur() !== 'overview'; i++) await press(4); out.lb = [cur(), shown(), (document.querySelector('#details .pad-focus') || {}).id];
      try { delete navigator.getGamepads; } catch (e) {}
      document.querySelector('#dvNav .dv-t[data-s="media"]').click(); await w(400); out.click = [cur(), shown()];
      key('e'); await w(500); out.e = [cur(), shown()]; key('q'); await w(500); out.q = [cur(), shown()];
      out.hint = [...document.querySelectorAll('#hints .lab')].map(x => x.textContent).includes('Sections');
      return out; });
    const one = (r, k) => !!r && r[0] === k && r[1] === k;
    check('Details tabs: RB / LB (controller), a click and E / Q switch tabs, only the one you\'re on shows; LB back to Overview keeps Play; the hint bar says Sections',
      one(o.tabsRun.start, 'overview') && one(o.tabsRun.rb, 'ach') && one(o.tabsRun.lb, 'overview') && o.tabsRun.lb[2] === 'dPlay' && one(o.tabsRun.click, 'media') && one(o.tabsRun.e, 'copy') && one(o.tabsRun.q, 'media') && o.tabsRun.hint,
      JSON.stringify(o.tabsRun));
    if (OUT) await p.screenshot({ path: path.join(OUT, 'details-tabs-media.png') });

    // Media: the screenshots, the box art, Change in Art Studio
    o.media = await p.evaluate(() => ({ shots: document.querySelectorAll('#dShots .d-shot').length, objs: [...document.querySelectorAll('#dvTray .dv-obj')].map(x => x.dataset.o), change: !document.getElementById('dvArtBtn').hidden && document.getElementById('dvArtBtn').getBoundingClientRect().width > 0 }));
    check('Details tabs: Media has the screenshots, then the box art (front, back, spine, disc, manual) with Change in Art Studio',
      o.media.shots === 8 && o.media.objs.join() === 'front,back,spine,disc,manual' && o.media.change, JSON.stringify(o.media));

    // Achievements: the list and its filters, the summary
    o.ach = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), out = {};
      document.querySelector('#dvNav .dv-t[data-s="ach"]').click(); await w(500);
      const n = () => document.querySelectorAll('#dvAchList .dv-arow').length, got = () => [...document.querySelectorAll('#dvAchList .dv-arow')].every(r => r.classList.contains('got'));
      const pill = f => document.querySelector(`#dvAchF .dv-pill[data-f="${f}"]`);
      out.all = n(); pill('got').click(); await w(300); out.got = [n(), got()]; pill('locked').click(); await w(300); out.locked = [n(), !document.querySelector('#dvAchList .dv-arow.got')]; pill('all').click(); await w(300);
      out.summary = !$('dAch').hidden && $('dAch').getBoundingClientRect().width > 0 && $('dAchSub').textContent; out.kv = [...document.querySelectorAll('#dvAchKv .k')].map(k => k.textContent);
      out.chip = (document.querySelector('#dChips .dv-achc') || {}).textContent; return out; });
    check('Details tabs: Achievements lists them (All 40, Unlocked 6, Locked 34) beside the summary (6 of 40, where they unlock, the rarest you have); the chip says 6 of 40',
      o.ach.all === 40 && o.ach.got[0] === 6 && o.ach.got[1] && o.ach.locked[0] === 34 && o.ach.locked[1] && /6 of 40/.test(o.ach.summary || '') && o.ach.kv.includes('Unlocks in') && o.ach.kv.includes('Rarest you have') && /6 of 40/.test(o.ach.chip || ''),
      JSON.stringify(o.ach));
    if (OUT) await p.screenshot({ path: path.join(OUT, 'details-tabs-achievements.png') });

    // Your copy: the rows and their buttons, the actions, the launch command (folded)
    o.copy = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), out = {};
      document.querySelector('#dvNav .dv-t[data-s="copy"]').click(); await w(900);
      const vis = e => !!e && !e.hidden && e.getBoundingClientRect().width > 0;
      out.rows = [...document.querySelectorAll('#dvCopyRows .dv-kv')].filter(vis).map(r => [r.dataset.k, r.querySelector('.t').textContent]);
      out.btns = ['dvC-emu', 'dvC-man', 'dvC-art', 'dvC-setup'].filter(id => vis($(id)));
      out.acts = ['dvRen', 'dvAdd', 'dvCol', 'dvHide'].filter(id => vis($(id))); /* (beta.14: Add to another shelf… in place of My shelves on Windows / Linux) */
      const adv = document.querySelector('#details .d-adv'); out.adv = vis(adv) && !adv.open && !!$('dCmd').textContent;
      return out; });
    const row = k => (o.copy.rows.find(r => r[0] === k) || [])[1] || '';
    check('Details tabs: Your copy has the file, size, version, emulator (Change), Set up for me, manual and box art (with their buttons), rename / My shelves / hide, and the launch command folded',
      /\.rvz$/.test(row('file')) && /MB|GB/.test(row('size')) && /USA/.test(row('ver')) && !!row('emu') && !!row('setup') && !!row('man') && !!row('art') &&
      ['dvC-emu', 'dvC-man', 'dvC-art', 'dvC-setup'].every(id => o.copy.btns.includes(id)) && o.copy.acts.length === 3 && o.copy.adv, JSON.stringify(o.copy));
    if (OUT) await p.screenshot({ path: path.join(OUT, 'details-tabs-copy.png') });

    // ··· (More): a row of pills in the mockup's order; the arrows walk it; Esc closes it first
    o.more = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), out = {}, key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      document.querySelector('#dvNav .dv-t[data-s="overview"]').click(); await w(300);
      $('dMoreBtn').click(); await w(500); const L = [...document.querySelectorAll('#dMenu button')].filter(b => !b.hidden && b.offsetParent);
      out.open = !$('dMenu').hidden; out.ids = L.map(b => b.id); out.labels = L.map(b => b.textContent.trim()); out.expanded = $('dMoreBtn').getAttribute('aria-expanded');
      const f0 = (document.querySelector('#dMenu .pad-focus') || {}).id; key('ArrowRight'); await w(200); const f1 = (document.querySelector('#dMenu .pad-focus') || {}).id; out.walk = [f0, f1];
      key('Escape'); await w(400); out.shut = $('dMenu').hidden && Shelf.getMode() === 'details'; return out; });
    check('Details tabs: ··· opens More as a row of pills (Read the manual / booklet, Inspect the case, Choose emulator, Box art, Rename, Add to… (beta.14: it covers My shelves), Hide, …); → walks it; Esc closes it, Details stays',
      o.more.open && o.more.ids.slice(0, 7).join() === 'dManual,dInspect,dGameEmu,dBoxArt,dRename,dAddTo,dHide' && /^Read the (manual|booklet)$/.test(o.more.labels[0]) &&
      o.more.labels.slice(1, 7).join('|') === 'Inspect the case|Choose emulator|Box art|Rename|Add to…|Hide' && o.more.walk[0] === 'dManual' && o.more.walk[1] === 'dInspect' && o.more.shut,
      JSON.stringify(o.more));

    // ♡: on, then off again (the shelf's own favourites); Status: the chip steps on
    o.fav = await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), $ = id => document.getElementById(id), g = Shelf._lib.cur();
      const favs = async () => (((await window.boxshelf.getConfig()).config.ui || {}).favorites || []).includes(g.id);
      const f0 = await favs(); $('dFav').click(); await w(700); const on = [await favs(), $('dFav').getAttribute('aria-pressed'), $('dFav').classList.contains('set')]; $('dFav').click(); await w(700);
      const st = $('dvStatus'), t0 = st.textContent; st.click(); await w(400); const t1 = st.textContent; st.click(); await w(400); st.click(); await w(400); st.click(); await w(400);
      return { f0, on, off: [await favs(), $('dFav').getAttribute('aria-pressed')], st: [t0, t1, st.textContent] }; });
    check('Details tabs: ♡ adds the game to the favourites (filled) and takes it off again; the Status chip steps Not started → Playing … → Not started',
      o.fav.on[0] !== o.fav.f0 && o.fav.on[1] === String(!o.fav.f0) && o.fav.on[2] === !o.fav.f0 && o.fav.off[0] === o.fav.f0 && o.fav.st[0] === 'Not started' && o.fav.st[1] === 'Playing' && o.fav.st[2] === 'Not started',
      JSON.stringify(o.fav));
    await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  } catch (e) { o.err = e.message; errors.push('test: ' + e.message); }
  await ctx.close();

  // touch (a tap on a tab) and a small window (853 x 480 at 2.25: the tab you're on stays in view, nothing spills sideways)
  const tctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, hasTouch: true });
  const tp = await tctx.newPage(); tp.on('pageerror', e => errors.push(e.message));
  try {
    await open(tp, '?platform=windows&shelf=1&ra=1&shots=1&desc=1');
    const box = await tp.evaluate(() => { const r = document.querySelector('#dvNav .dv-t[data-s="ach"]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    await tp.touchscreen.tap(box[0], box[1]); await tp.waitForTimeout(600);
    o.touch = await tp.evaluate(() => (document.querySelector('#dvNav .dv-t.cur') || { dataset: {} }).dataset.s);
    await tp.keyboard.press('e'); await tp.waitForTimeout(400); await tp.keyboard.press('e'); await tp.waitForTimeout(600);
    o.small = await tp.evaluate(() => { const d = document.getElementById('details'), n = document.querySelector('#dvNav .dv-navt'), t = document.querySelector('#dvNav .dv-t.cur'), a = n.getBoundingClientRect(), b = t.getBoundingClientRect();
      return { tab: t.dataset.s, inBar: b.left >= a.left - 1 && b.right <= a.right + 1, spill: d.scrollWidth - d.clientWidth, cols: getComputedStyle(document.querySelector('#details .dv-sec.on')).gridTemplateColumns.split(' ').length }; });
    if (OUT) await tp.screenshot({ path: path.join(OUT, 'details-tabs-small.png') });
  } catch (e) { o.terr = e.message; errors.push('touch test: ' + e.message); }
  await tctx.close();
  check('Details tabs: a tap on a tab shows it (touch); in a small window (853 x 480) the tab you\'re on stays in its bar, the panel never spills sideways and a tab is one column',
    o.touch === 'ach' && !!o.small && o.small.tab === 'copy' && o.small.inBar && o.small.spill <= 1 && o.small.cols === 1, JSON.stringify({ touch: o.touch, small: o.small, err: o.terr }));
  check('Details tabs pass: no script errors', !errors.length, errors.slice(0, 4).join(' | '));
  return o;
};
// run on its own: node ci/details-tabs-test.js <www folder> [out folder]
if (require.main === module) {
  (async () => {
    const { chromium } = require('playwright'), http = require('http'), fs = require('fs');
    const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'www')), OUT = process.argv[3] ? path.resolve(process.argv[3]) : null; if (OUT) fs.mkdirSync(OUT, { recursive: true });
    const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.webm': 'video/webm' };
    const srv = http.createServer((q, s) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep) || f === root) f = path.join(root, 'index.html');
      fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(b); }); });
    await new Promise(r => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/index.html`;
    const browser = await chromium.launch(); let fails = 0;
    const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : '\n     ' + String(detail).slice(0, 900))); if (!ok) fails++; };
    try { await module.exports({ browser, base, check, OUT }); } finally { await browser.close(); srv.close(); }
    process.exit(fails ? 1 : 0);
  })();
}
