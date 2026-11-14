// Device test (beta.14, Windows): connecting IGDB. Settings › Accounts › IGDB says what it brings (more screenshots, missing
// game info, official trailers, free) and walks through the five steps (Twitch's developer console with its address and a
// QR, register the app, copy the Client ID and a New Secret, paste both, Test); Library's Needs attention suggests it only
// while it isn't set up, and opens its page; Details' Media has a quiet "connect IGDB" line for a game short of screenshots,
// only without the keys. With the keys (?igdb=1): the page says Connected, and a game missing its description gets IGDB's
// (LaunchBox's values stay), asked once. The page's mock answers (renderer/mock.js: ?igdb=1, ?moreshots=1 moreInfo).
//   cd android-app; node copy-web.js; node ci/run-pass.js igdb-pass.js
'use strict';
module.exports = async function igdbPass({ browser, base, check, OUT }) {
  const errors = [], ATTN = 'Connect IGDB for more screenshots and game info';
  const open = async q => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } }), p = await ctx.newPage();
    p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    await p.goto(base + q);
    await p.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._lib && window.Setup, null, { timeout: 90000, polling: 250 }); await p.waitForTimeout(1500);
    await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 12 && Shelf.getMode() !== 'note'; i++) await w(250); if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } });
    for (let i = 0; i < 8; i++) { if (await p.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(450); }
    return { ctx, p };
  };
  // Settings at a page: the rows' names, the heads, the lead, the title, a QR card
  const settings = (p, page, row) => p.evaluate(async ({ page, row }) => { const w = ms => new Promise(r => setTimeout(r, ms)), names = () => [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent);
    Setup.open({ page }); for (let i = 0; i < 20 && !names().length; i++) await w(150); await w(900);
    if (row) { const r = [...document.querySelectorAll('#bss .bss-row')].find(x => ((x.querySelector('.nm') || {}).textContent || '') === row); if (r) { r.click(); await w(1200); } }
    const out = { names: names(), heads: [...document.querySelectorAll('#bss .bss-head span')].map(e => e.textContent), lead: (document.querySelector('#bss .bss-lead') || {}).textContent || '',
      title: (document.querySelector('#bss .bss-title') || {}).textContent || '', qr: !!document.querySelector('#bss .bss-pair .qr svg'), subs: [...document.querySelectorAll('#bss .bss-row .sub')].map(e => e.textContent) };
    if (window.Settings && Settings.close) { await Settings.close(); await w(700); } return out; }, { page, row });
  const details = p => p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    for (let t = 0; t < 3 && Shelf.getMode() !== 'details'; t++) { if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } key('i'); for (let i = 0; i < 20 && Shelf.getMode() !== 'details'; i++) await w(150); }
    const tab = document.querySelector('#details .dv-t[data-s="media"]'); if (tab && !tab.hidden) { tab.click(); await w(500); }
    const q = document.getElementById('dvIgdb'); return { mode: Shelf.getMode(), line: !!(q && !q.hidden && q.offsetParent), text: q ? q.textContent : '' }; });
  let a = null, b = null;
  try {
    // ---- no keys ----
    a = await open('?platform=windows&shelf=1&shots=2');
    const pg = await settings(a.p, 'igdb');
    check('IGDB page (beta.14): what you get first (more screenshots up to 10, game info filled in, official trailers, free with a Twitch developer account)',
      pg.title === 'IGDB' && pg.heads.includes('What you get') && ['More screenshots', 'Game info filled in where it\'s missing', 'Official trailers', 'Free'].every(n => pg.names.includes(n))
        && pg.subs.includes('Up to 10 a game') && pg.subs.includes('Description, genres, developer, release date') && /free/i.test(pg.lead), JSON.stringify(pg));
    const steps = ['1. Open Twitch\'s developer console', '2. Register your application', 'OAuth Redirect URL', 'Category', 'Client type', '3. Copy the Client ID and a New Secret', 'Client ID', 'Client Secret', 'Test the key'];
    check('IGDB page: the five steps in order (the console\'s address as text and a QR, register with http://localhost, Application Integration, Confidential, copy the Client ID and a New Secret, paste both, Test); not Connected yet',
      steps.every((n, k) => pg.names.indexOf(n) >= 0 && (k === 0 || pg.names.indexOf(n) > pg.names.indexOf(steps[k - 1]))) && pg.subs.includes('dev.twitch.tv/console') && pg.qr
        && pg.heads.includes('4. Paste both here') && pg.heads.includes('5. Test') && !pg.names.includes('Connected'), JSON.stringify(pg));
    if (OUT) { await a.p.evaluate(async () => { Setup.open({ page: 'igdb' }); await new Promise(r => setTimeout(r, 1500)); });
      await a.p.screenshot({ path: require('path').join(OUT, 'igdb-page.png') }); await a.p.evaluate(async () => { if (window.Settings && Settings.close) await Settings.close(); await new Promise(r => setTimeout(r, 700)); }); }
    const lib0 = await settings(a.p, 'consoles');
    check('Needs attention: "Connect IGDB…" while IGDB isn\'t set up and there are console games', lib0.names.includes(ATTN), JSON.stringify(lib0.names.slice(0, 8)));
    const viaAttn = await settings(a.p, 'consoles', ATTN);
    check('Needs attention: its row opens the IGDB page', viaAttn.title === 'IGDB' && viaAttn.names.includes('Client ID'), JSON.stringify({ title: viaAttn.title, names: viaAttn.names.slice(0, 4) }));
    const d0 = await details(a.p);
    check('Details › Media: a game with 2 screenshots and no IGDB has the quiet "connect IGDB (free)" line', d0.mode === 'details' && d0.line && /connect IGDB \(free\)/.test(d0.text), JSON.stringify(d0));
    const fromLine = await a.p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); document.getElementById('dvIgdb').click(); await w(1800);
      const out = { mode: Shelf.getMode(), title: (document.querySelector('#bss .bss-title') || {}).textContent || '', crumbIGDB: [...document.querySelectorAll('#bss .bss-row .nm')].some(e => e.textContent === 'Client Secret') };
      if (window.Settings && Settings.close) { await Settings.close(); await w(700); } return out; });
    check('Details › Media: the line opens Settings at the IGDB page', fromLine.title === 'IGDB' && fromLine.crumbIGDB, JSON.stringify(fromLine));
    await a.ctx.close(); a = null;

    // ---- with keys (?igdb=1): Connected, no suggestion, IGDB's info fills a gap in Details ----
    b = await open('?platform=windows&shelf=1&igdb=1&moreshots=1');
    const title = await b.p.evaluate(() => Shelf._lib.cur().title);
    const d1 = await details(b.p); await b.p.waitForTimeout(1500);
    const after = await b.p.evaluate(() => { const d = document.getElementById('details'), txt = d.textContent; /* (all tabs: Overview's facts are hidden while Media shows) */ return { asks: (window.__moreInfo || []).map(o => ({ sys: !!o.systemId, file: !!o.file, title: o.title })),
      desc: (document.getElementById('dDesc') || {}).textContent || '', lbDev: /Moonbeam Works|Hollow Pine|Studio Kite/.test(txt), igDev: txt.includes('IGDB Studio'), series: txt.includes('IGDB Series'), line: !document.getElementById('dvIgdb').hidden }; });
    check('With IGDB keys: a game missing its description asks once and Details shows IGDB\'s; LaunchBox\'s developer stays; no "connect IGDB" line',
      d1.mode === 'details' && after.asks.length === 1 && after.asks[0].sys && after.asks[0].file && after.asks[0].title === title && after.desc === `IGDB's description of ${title}.`
        && after.lbDev && !after.igDev && after.series && !after.line && !d1.line, JSON.stringify({ title, d1, after }));
    await b.p.keyboard.press('Escape'); await b.p.waitForTimeout(900); await details(b.p); await b.p.waitForTimeout(900);
    const again = await b.p.evaluate(() => (window.__moreInfo || []).length);
    check('With IGDB keys: opening Details again doesn\'t ask again', again === 1, String(again));
    await b.p.keyboard.press('Escape'); await b.p.waitForTimeout(900);
    const pg1 = await settings(b.p, 'igdb'), lib1 = await settings(b.p, 'consoles');
    check('With IGDB keys: the page says Connected and what it does now; Needs attention has no IGDB item',
      pg1.names[0] === 'Connected' && pg1.subs.some(s => /screenshots and game info/.test(s)) && !lib1.names.includes(ATTN), JSON.stringify({ first: pg1.names[0], attn: lib1.names.includes(ATTN) }));
    check('IGDB: no page errors', !errors.length, errors.slice(0, 5).join(' | '));
  } finally { if (a) await a.ctx.close().catch(() => {}); if (b) await b.ctx.close().catch(() => {}); }
};
