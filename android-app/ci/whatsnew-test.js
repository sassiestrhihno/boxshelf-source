// Device test pass "whatsnew" (beta.7), run by web-device-test.js: the demo page as Windows on a 1920x1080 TV.
//   The first start of a new version shows its highlights once (a card over the dimmed shelf: left / right move between
//   its buttons, the shelf doesn't move behind it, Esc closes, the version is remembered); a fresh install shows nothing.
//   A newer version on GitHub: a card with the release's highlights as plain text (no Markdown or HTML), shown once;
//   See what's new opens Settings → System → What's new with its notes, its download and this version's notes.
//   Screenshots: whatsnew-*.png.
'use strict';
const path = require('path');

module.exports = async function whatsNewPass({ browser, base, check, OUT }) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(90000);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const pause = ms => page.waitForTimeout(ms);
  const ready = async q => { await page.goto(base + q); await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup, null, { timeout: 90000, polling: 250 }); };
  const card = () => page.evaluate(() => { const c = document.querySelector('.note-card'); if (!c) return null;
    const bd = c.querySelector('.nc-body'), r = c.getBoundingClientRect();
    return { pn: c.classList.contains('pnotes'), btns: [...c.querySelectorAll('.nc-btns .btn')].map(b => (b.querySelector('.nc-bl') || b).textContent), keys: [...c.querySelectorAll('.nc-btns .nc-k')].map(k => k.textContent), fits: r.top >= 0 && r.bottom <= innerHeight, opaque: getComputedStyle(c).zIndex === '400',
      body: bd ? { li: bd.querySelectorAll('li').length, vers: [...bd.querySelectorAll('.pn-ver')].map(x => x.textContent), heads: [...bd.querySelectorAll('.pn-h')].map(x => x.textContent), st: bd.scrollTop, more: bd.scrollHeight > bd.clientHeight } : null,
      wide: c.classList.contains('wide'), h: Math.round(r.height), title: (c.querySelector('.nc-title') || {}).textContent || '', items: [...c.querySelectorAll('.nc-list li')].map(l => l.textContent), html: c.innerHTML,
      lit: [...c.querySelectorAll('.nc-btns .btn')].findIndex(b => b.classList.contains('pad-focus')), mode: Shelf.getMode(), sel: (Shelf._lib.cur() || {}).id }; });
  try {
    // What's new after updating
    await ready('?platform=windows&shelf=1&ver=1.82.0-beta.8');
    let c = null; for (let i = 0; i < 40 && !c; i++) { await pause(300); c = await card(); }
    await pause(400); await page.screenshot({ path: path.join(OUT, 'whatsnew-card.png') });
    await page.keyboard.press('ArrowRight'); await pause(250); const c2 = await card();
    await page.keyboard.press('Escape'); await pause(600);
    const after = await page.evaluate(async () => ({ gone: !document.querySelector('.note-card'), mode: Shelf.getMode(), seen: (await window.boxshelf.getConfig()).config.ui.lastSeenVersion }));
    check('What\'s new (beta.14): the first start of a new version shows a small card: Read the patch notes, and Close',
      !!c && c.wide && /^Boxshelf 1\.82\.0-beta\.8$/.test(c.title) && !c.items.length && c.btns.join() === 'Read the patch notes,Close' && c.h < 260 && c.mode === 'note', JSON.stringify(c && { title: c.title, btns: c.btns, items: c.items.length, h: c.h, mode: c.mode }));
    check('What\'s new: right lights Close (the shelf behind stays put), Esc closes it and the version is remembered',
      !!c2 && c2.lit === 1 && c2.sel === c.sel && after.gone && after.mode === 'browse' && after.seen === '1.82.0-beta.8', JSON.stringify({ lit: c2 && c2.lit, same: c2 && c2.sel === c.sel, ...after }));
    check('What\'s new: once a key is pressed the card shows its keys (Enter to read, Esc to close)', !!c2 && c2.keys.join() === 'Enter,Esc', JSON.stringify(c2 && c2.keys));

    // (beta.14) a test build gets its release's notes; an update that skipped versions gets theirs too, newest first;
    // the next test build of the same release shows them again once; Settings calls the test build's release "This version"
    // (A on the card opens the notes in the same card; they scroll with Down; Esc closes them)
    const cardFor = async q => { await ready(q); let k = null; for (let i = 0; i < 40 && !k; i++) { await pause(300); k = await card(); }
      if (k) { await page.keyboard.press('Enter'); let n = null; for (let i = 0; i < 20 && !(n && n.pn); i++) { await pause(250); n = await card(); }
        k.notes = n; if (n && n.pn) { await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await pause(300); k.scrolled = (await card()).body.st; }
        await page.screenshot({ path: path.join(OUT, 'whatsnew-notes.png') }); await page.keyboard.press('Escape'); await pause(500); k.closed = await page.evaluate(() => !document.querySelector('.note-card') && Shelf.getMode()); } return k; };
    const t1 = await cardFor('?platform=windows&shelf=1&ver=1.82.0-beta.14-test.4&seen=1.82.0-beta.12');
    const t2 = await cardFor('?platform=windows&shelf=1&ver=1.82.0-beta.14-test.4&seen=1.82.0-beta.8');
    const t3 = await cardFor('?platform=windows&shelf=1&ver=1.82.0-beta.14-test.5&seen=1.82.0-beta.14-test.4');
    await ready('?platform=windows&shelf=1&ver=1.82.0-beta.14-test.4&seen=1.82.0-beta.14-test.4'); await pause(7000); const t4 = await card();
    // (beta.14) Settings → What's new: a row per version (yours marked), and choosing one opens its changes
    await page.evaluate(() => Setup.open({ page: 'whatsnew' })); await pause(1800); const wst = await page.evaluate(() => document.body.innerText);
    const wv = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), rows = () => [...document.querySelectorAll('#bss .bss-row')];
      const vers = rows().map(r => r.innerText.replace(/\n+/g, ' | ')).filter(t => /^Boxshelf \d/.test(t));
      const r = rows().find(e => /^Boxshelf 1\.82\.0-beta\.9\b/.test(e.innerText)); if (r) r.click(); await w(1200);
      return { vers, opened: rows().map(e => e.innerText.split('\n')[0]).slice(0, 4), heads: [...document.querySelectorAll('#bss')].map(e => e.innerText).join(' ').match(/\b(NEW|BETTER|FIXED)\b/gi) || [] }; });
    await page.screenshot({ path: path.join(OUT, 'whatsnew-version.png') });
    await page.evaluate(() => window.Settings && Settings.close && Settings.close()); await pause(600);
    check('What\'s new in Settings: a row per version, newest first, this one marked; choosing one opens its changes',
      wv.vers.length >= 4 && /^Boxshelf 1\.82\.0-beta\.14 \| This version/.test(wv.vers[0]) && /changes/.test(wv.vers[1]) && wv.opened.length >= 3 && wv.heads.length >= 1, JSON.stringify(wv));
    const n1 = t1 && t1.notes, n2 = t2 && t2.notes;
    check('What\'s new (beta.14): a test build gets its release\'s card; A opens the patch notes in the same card, on screen and solid, with this platform\'s changes only; Down scrolls; Esc closes',
      !!t1 && /^Boxshelf 1\.82\.0-beta\.14$/.test(t1.title) && !!n1 && n1.pn && n1.fits && n1.opaque && n1.btns.join() === 'Close' && n1.body && n1.body.li >= 10 && n1.body.more
        && n1.body.heads.every(h => /^Windows/.test(h)) && t1.scrolled > 0 && t1.closed === 'browse', JSON.stringify(t1 && { title: t1.title, notes: n1 && { fits: n1.fits, opaque: n1.opaque, btns: n1.btns, body: n1.body }, scrolled: t1.scrolled, closed: t1.closed }));
    check('What\'s new: an update that skipped versions lists each of them in the notes, newest first',
      !!n2 && /and 2 earlier/.test(n2.title) && n2.body && n2.body.vers.length === 3 && /beta\.14/.test(n2.body.vers[0]) && /beta\.12/.test(n2.body.vers[1]) && /beta\.9/.test(n2.body.vers[2]), JSON.stringify(n2 && { title: n2.title, vers: n2.body && n2.body.vers }));
    check('What\'s new: the next test build of the same release shows its notes once more; the same build never twice',
      !!t3 && /beta\.14/.test(t3.title) && !t4, JSON.stringify({ t3: t3 && t3.title, t4: t4 && t4.title }));
    check('What\'s new in Settings: a test build\'s release is "This version"', /Boxshelf 1\.82\.0-beta\.14\s+This version/i.test(wst), wst.split('\n').filter(l => /version|Boxshelf 1\./i.test(l)).slice(0, 4).join(' | '));

    // a fresh install (the first run): no card, the version is just remembered
    await page.goto(base + '?platform=windows&ver=1.82.0-beta.8'); await page.waitForSelector('#setup.on', { timeout: 90000 }); await pause(7000);
    const fresh = await page.evaluate(async () => ({ card: !!document.querySelector('.note-card'), seen: (await window.boxshelf.getConfig()).config.ui.lastSeenVersion }));
    check('What\'s new: a fresh install shows no card (it remembers the version for next time)', !fresh.card && fresh.seen === '1.82.0-beta.8', JSON.stringify(fresh));

    // a newer version out
    await ready('?platform=windows&shelf=1&update=1');
    let u = null; for (let i = 0; i < 60 && !u; i++) { await pause(300); u = await card(); }
    await page.screenshot({ path: path.join(OUT, 'whatsnew-update.png') });
    check('Update: a newer version shows a card with its highlights as plain text (no Markdown or HTML from the release)',
      !!u && !u.wide && /1\.82\.0-beta\.2 is out/.test(u.title) && u.items.length === 3 && u.items[0] === 'Video previews in Details' && u.items[1] === 'A new Details page' && !/\*\*|&lt;b|<b>/.test(u.html),
      JSON.stringify(u && { title: u.title, items: u.items }));
    await page.keyboard.press('Enter'); await pause(1800);
    const st = await page.evaluate(() => document.body.innerText);
    await page.screenshot({ path: path.join(OUT, 'whatsnew-settings.png') });
    check('Update: See what\'s new opens Settings → System → What\'s new with the new version\'s notes, its download and this version\'s notes',
      /What.s new/.test(st) && /New: Boxshelf 1\.82\.0-beta\.2/i.test(st) && /Get Boxshelf 1\.82\.0-beta\.2/i.test(st) && /Video previews in Details/.test(st), st.split('\n').filter(l => /new|Boxshelf|Video/i.test(l)).slice(0, 6).join(' | '));
    await page.evaluate(() => window.Settings && Settings.close && Settings.close()); await pause(600);
    await ready('?platform=windows&shelf=1&update=1'); await pause(7500);
    check('Update: the same version\'s card isn\'t shown twice', !(await card()));
    // (beta.8) a Steam Deck in Desktop Mode, Boxshelf not started by Steam: a card says once how to get the controller in
    // games (start from Steam), and its button adds Boxshelf to Steam. Started by Steam: no card
    // (beta.11) each page here is a separate pretend install, but they share the browser's storage: the shelf tour owed by
    // an earlier first run (tour.js, bs-tour-pending) isn't this one's
    await page.evaluate(() => { try { localStorage.removeItem('bs-tour-pending'); } catch (e) {} });
    await ready('?platform=windows&shelf=1&deck=desktop'); let dk = null; for (let w = 0; w < 40 && !dk; w++) { await pause(400); dk = await card(); }
    if (dk) { await page.screenshot({ path: path.join(OUT, 'whatsnew-deck.png') }); await page.keyboard.press('Enter'); await pause(900); }
    const added = await page.evaluate(() => window.__added || 0);
    await ready('?platform=windows&shelf=1&deck=steam'); await pause(13000); const dk2 = await card();
    check('Steam Deck: in Desktop Mode outside Steam a card explains the controller and adds Boxshelf to Steam; started by Steam, no card',
      !!dk && /Steam Deck/i.test(dk.html) && /from Steam/i.test(dk.title) && added === 1 && !dk2, JSON.stringify({ dk: dk && dk.title, added, dk2: dk2 && dk2.title }));
    check('What\'s new pass: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('What\'s new pass ran to the end', false, e.message.split('\n')[0]); try { await page.screenshot({ path: path.join(OUT, 'whatsnew-fail.png') }); } catch {} }
  await ctx.close();
};
