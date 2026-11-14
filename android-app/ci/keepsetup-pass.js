// Device test pass "keepsetup" (beta.14), run by web-device-test.js: the demo page as Windows on a 1920x1080 TV, with
// renderer/mock.js standing in for main/updateflow.js (no network, nothing installed).
//   - The update card: a Boxshelf that can update itself offers Update now (then What's new); A downloads it, and once it's
//     in a card offers Restart to update. One that can't (?updnow absent) keeps See what's new / Later.
//   - Settings → System → Beta updates: Update now, Downloading N% · cancel (pressing cancels), Restart to update.
//   - Undo the update's settings changes: only with a safety copy from an older version; pressed twice.
//   - Back up settings with Include keys and passwords ticked asks for the keys.
//   - First run with another Boxshelf's setup on this PC: the "Use your setup" card, its folder, Copy it over / Start fresh
//     and the extras tick with its size; a controller (d-pad + A) ticks extras and copies; a mouse picks Start fresh.
//   Screenshots: keepsetup-*.png.
'use strict';
const path = require('path');

module.exports = async function keepSetupPass({ browser, check, base, OUT }) {
  const errors = [];
  const open = async q => {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }); ctx.setDefaultTimeout(90000);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
    await page.goto(base + q); return { ctx, page, pause: ms => page.waitForTimeout(ms) };
  };
  const shelfReady = page => page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup, null, { timeout: 90000, polling: 250 });
  const card = page => page.evaluate(() => { const c = document.querySelector('.note-card'); if (!c) return null;
    return { title: (c.querySelector('.nc-title') || {}).textContent || '', sub: (c.querySelector('.nc-sub') || {}).textContent || '', btns: [...c.querySelectorAll('.nc-btns .btn')].map(b => (b.querySelector('.nc-bl') || b).textContent) }; });
  const waitCard = async (page, re, n = 60) => { for (let i = 0; i < n; i++) { const c = await card(page); if (c && (!re || re.test(c.title))) return c; await page.waitForTimeout(300); } return null; };
  // a Settings row's text ("label | button …") by its label
  const row = (page, label) => page.evaluate(l => { const r = [...document.querySelectorAll('#bss .bss-row')].find(e => e.innerText.split('\n')[0].trim() === l); return r ? r.innerText.replace(/\n+/g, ' | ') : null; }, label);
  const clickRow = (page, label) => page.evaluate(l => { const r = [...document.querySelectorAll('#bss .bss-row')].find(e => e.innerText.split('\n')[0].trim() === l); if (r) r.click(); return !!r; }, label);
  const sysPage = async page => { await page.evaluate(() => Setup.open({ page: 'sys' })); await page.waitForTimeout(1500); };

  try {
    // ---------- the update card ----------
    { const { ctx, page, pause } = await open('?platform=windows&shelf=1&update=1&updnow=1'); await shelfReady(page);
      const c = await waitCard(page, /is out/);
      await page.screenshot({ path: path.join(OUT, 'keepsetup-card.png') });
      check('Update card (beta.14): a Boxshelf that can update itself offers Update now first, then What\'s new',
        !!c && /1\.82\.0-beta\.2 is out/.test(c.title) && c.btns.join() === 'Update now,What\'s new', JSON.stringify(c));
      await page.keyboard.press('Enter');
      const r = await waitCard(page, /is ready/, 40);
      const starts = await page.evaluate(() => (window.__upd || {}).starts || 0);
      await page.screenshot({ path: path.join(OUT, 'keepsetup-ready.png') });
      check('Update card: A downloads it in the background; when it\'s in, a card offers Restart to update (or Later)',
        starts === 1 && !!r && /Boxshelf 1\.82\.0-beta\.2 is ready/.test(r.title) && r.btns.join() === 'Restart to update,Later' && /settings and games stay/i.test(r.sub), JSON.stringify({ starts, r }));
      await page.keyboard.press('Enter'); await pause(600);
      const inst = await page.evaluate(() => (window.__upd || {}).installs || 0);
      check('Update card: Restart to update hands over to the updater', inst === 1, inst);
      await ctx.close(); }
    { const { ctx, page } = await open('?platform=windows&shelf=1&update=1'); await shelfReady(page);
      const c = await waitCard(page, /is out/);
      check('Update card: a Boxshelf that can\'t update itself (a development copy) keeps See what\'s new / Later', !!c && c.btns.join() === 'See what\'s new,Later', JSON.stringify(c));
      await ctx.close(); }

    // ---------- Settings → System ----------
    { const { ctx, page, pause } = await open('?platform=windows&shelf=1&updnow=1&updslow=1&ver=1.82.0-beta.14&keepundo=1'); await shelfReady(page); await sysPage(page);
      let r0 = null; for (let i = 0; i < 20 && !(r0 && /Update now/.test(r0)); i++) { await pause(300); r0 = await row(page, 'Beta updates'); }
      await clickRow(page, 'Beta updates'); let r1 = null; for (let i = 0; i < 20 && !(r1 && /40%/.test(r1)); i++) { await pause(300); r1 = await row(page, 'Beta updates'); }
      await page.screenshot({ path: path.join(OUT, 'keepsetup-settings.png') });
      await clickRow(page, 'Beta updates'); await pause(700); const r2 = await row(page, 'Beta updates'), cancels = await page.evaluate(() => (window.__upd || {}).cancels || 0);
      check('Settings → Beta updates: Update now; while it downloads the row shows how far and pressing it cancels',
        /Update now/.test(r0 || '') && /Downloading 40% · cancel/.test(r1 || '') && /Update now/.test(r2 || '') && cancels === 1, JSON.stringify({ r0, r1, r2, cancels }));
      const u1 = await row(page, 'Undo the update\'s settings changes');
      await clickRow(page, 'Undo the update\'s settings changes'); await pause(400); const u2 = await row(page, 'Undo the update\'s settings changes');
      await clickRow(page, 'Undo the update\'s settings changes'); await pause(600); const undone = await page.evaluate(() => window.__keepUndo || 0);
      check('Settings → Undo the update\'s settings changes: there after an update, asks once more, then puts the safety copy back',
        /Restore/.test(u1 || '') && /Press again/.test(u2 || '') && undone === 1, JSON.stringify({ u1, u2, undone }));
      const k0 = await row(page, 'Include keys and passwords'); await clickRow(page, 'Include keys and passwords'); await pause(300);
      await clickRow(page, 'Back up settings'); await pause(800); const arg = await page.evaluate(() => window.__backupArg);
      check('Settings → Back up settings with Include keys and passwords ticked asks for the keys (off by default)', !!k0 && arg && arg.keys === true, JSON.stringify({ k0, arg }));
      await ctx.close(); }
    { const { ctx, page, pause } = await open('?platform=windows&shelf=1&updnow=1&ver=1.82.0-beta.14'); await shelfReady(page); await sysPage(page);
      let r0 = null; for (let i = 0; i < 20 && !(r0 && /Update now/.test(r0)); i++) { await pause(300); r0 = await row(page, 'Beta updates'); }
      await clickRow(page, 'Beta updates'); let r1 = null; for (let i = 0; i < 30 && !(r1 && /Restart to update/.test(r1)); i++) { await pause(300); r1 = await row(page, 'Beta updates'); }
      await clickRow(page, 'Beta updates'); await pause(600); const inst = await page.evaluate(() => (window.__upd || {}).installs || 0);
      const undoRow = await row(page, 'Undo the update\'s settings changes');
      check('Settings → Beta updates: when it\'s in, Restart to update; pressing it hands over to the updater. No Undo row without a safety copy',
        /Restart to update/.test(r1 || '') && inst === 1 && undoRow === null, JSON.stringify({ r1, inst, undoRow }));
      await ctx.close(); }
    { const { ctx, page, pause } = await open('?platform=windows&shelf=1&ver=1.82.0-beta.14'); await shelfReady(page); await sysPage(page);
      let r0 = null; for (let i = 0; i < 20 && !(r0 && /Get 1\.82/.test(r0)); i++) { await pause(300); r0 = await row(page, 'Beta updates'); }
      check('Settings → Beta updates on a Boxshelf that can\'t update itself: Get <version> (its download page), as before', /Get 1\.82\.0-beta\.2/.test(r0 || ''), r0);
      await ctx.close(); }

    // ---------- first run: Use your setup ----------
    { const { ctx, page, pause } = await open('?platform=windows&bring=1'); await page.waitForSelector('#setup.on', { timeout: 90000 });
      let t = ''; for (let i = 0; i < 30 && !/Use your setup from Boxshelf/.test(t); i++) { await pause(300); t = await page.evaluate(() => document.getElementById('suBody').innerText); }
      for (let i = 0; i < 20 && !/\(700 MB\)/.test(t); i++) { await pause(200); t = await page.evaluate(() => document.getElementById('suBody').innerText); }
      await pause(4000); await page.screenshot({ path: path.join(OUT, 'keepsetup-bring.png') }); /* (after the start-up intro) */
      check('First run: another Boxshelf\'s setup on this PC shows "Use your setup from Boxshelf <version>", its folder, Copy it over / Start fresh and the extras tick with its size',
        /Use your setup from Boxshelf 1\.82\.0-beta\.13/.test(t) && /D:\\Games\\Boxshelf\\data/.test(t) && /Copy it over/.test(t) && /Start fresh/.test(t) && /Also copy downloaded extras \(700 MB\)/.test(t), t.split('\n').slice(0, 12).join(' | '));
      // a controller: d-pad down to the extras tick, A ticks it, d-pad up to Copy it over, A copies (and "restarts" into the shelf)
      const nav = await page.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms)), btn = () => ({ pressed: false, touched: false, value: 0 });
        const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn) };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
        const press = async i => { if (window.__padHold) { await __padHold(pad, i, 160); await w(350); return; } pad.buttons[i] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(160); pad.buttons[i] = btn(); pad.timestamp++; await w(350); };
        await w(600);
        const where = () => { const a = document.activeElement; return a ? (a.id || (a.dataset && a.dataset.choice) || a.textContent.trim().slice(0, 30)) : ''; };
        const seen = [];
        for (let i = 0; i < 6 && where() !== 'bringExtras'; i++) { await press(13); seen.push(where()); }
        const onTick = where() === 'bringExtras'; await press(0); const ticked = document.getElementById('bringExtras') && document.getElementById('bringExtras').checked;
        for (let i = 0; i < 6 && where() !== 'bring'; i++) { await press(12); seen.push(where()); }
        const onCopy = where() === 'bring'; await press(0);
        return { seen, onTick, ticked, onCopy };
      });
      await pause(400); const copying = await page.evaluate(() => document.getElementById('suBody') ? document.getElementById('suBody').innerText : '');
      let landed = null; for (let i = 0; i < 40 && !landed; i++) { await pause(400); landed = await page.evaluate(() => (/shelf=1/.test(location.search) && window.Shelf && Shelf._qs && Shelf._qs().g && !document.querySelector('#setup.on')) ? location.search : null).catch(() => null); }
      check('First run, controller: the d-pad reaches the extras tick and Copy it over, A ticks and copies (with extras), then Boxshelf opens straight to the shelf',
        nav.onTick && nav.ticked && nav.onCopy && /Copying|Restarting/.test(copying) && !!landed, JSON.stringify({ nav, landed, copying: copying.slice(0, 120) }));
      await ctx.close(); }
    { const { ctx, page, pause } = await open('?platform=windows&bring=1'); await page.waitForSelector('#setup.on', { timeout: 90000 });
      let ok = false; for (let i = 0; i < 30 && !ok; i++) { await pause(300); ok = await page.evaluate(() => !!document.querySelector('#suBody [data-choice="fresh"]')); }
      await page.click('#suBody [data-choice="fresh"]'); await pause(800);
      const after = await page.evaluate(() => ({ t: document.getElementById('suBody').innerText, skip: window.__bringSkip || 0, find: !!document.querySelector('#suBody [data-choice="find"]') }));
      check('First run, mouse: Start fresh goes on to the usual first page (Find my emulators and games) and isn\'t asked again',
        ok && after.skip === 1 && after.find && !/Use your setup/.test(after.t), JSON.stringify({ skip: after.skip, find: after.find }));
      await ctx.close(); }
    { const { ctx, page, pause } = await open('?platform=windows'); await page.waitForSelector('#setup.on', { timeout: 90000 }); await pause(2500);
      const t = await page.evaluate(() => document.getElementById('suBody').innerText);
      check('First run with no other Boxshelf on this PC: the usual welcome, no card', !/Use your setup/.test(t) && /Find my emulators and games/.test(t), t.slice(0, 120));
      await ctx.close(); }
    // ---------- (beta.14) nothing found: "I've used Boxshelf before" chooses the old folder ----------
    { const { ctx, page, pause } = await open('?platform=windows&bringpick=bad'); await page.waitForSelector('#setup.on', { timeout: 90000 });
      let ok = false; for (let i = 0; i < 30 && !ok; i++) { await pause(300); ok = await page.evaluate(() => !!document.querySelector('#suBody [data-choice="old"]')); }
      await page.click('#suBody [data-choice="old"]'); await pause(900);
      const r = await page.evaluate(() => ({ t: document.getElementById('suBody').innerText, toast: (document.querySelector('.toast, #toast') || {}).textContent || '', chose: window.__bringChose || 0 }));
      check('First run, nothing found: "I\'ve used Boxshelf before" is on the welcome; a folder without a finished setup is refused with a reason and the welcome stays',
        ok && r.chose === 1 && /I've used Boxshelf before/.test(r.t) && /Find my emulators and games/.test(r.t) && !/Use your setup/.test(r.t), JSON.stringify({ ok, chose: r.chose, toast: r.toast.slice(0, 120) }));
      await ctx.close(); }
    { const { ctx, page, pause } = await open('?platform=windows&bringpick=1'); await page.waitForSelector('#setup.on', { timeout: 90000 });
      let ok = false; for (let i = 0; i < 30 && !ok; i++) { await pause(300); ok = await page.evaluate(() => !!document.querySelector('#suBody [data-choice="old"]')); }
      // a controller: d-pad down to the row, A chooses
      const nav = await page.evaluate(async () => {
        const w = ms => new Promise(r => setTimeout(r, ms)), btn = () => ({ pressed: false, touched: false, value: 0 });
        const pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, btn) };
        Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
        const press = async i => { if (window.__padHold) { await __padHold(pad, i, 160); await w(350); return; } pad.buttons[i] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(160); pad.buttons[i] = btn(); pad.timestamp++; await w(350); };
        await w(600);
        const where = () => { const a = document.activeElement; return a ? ((a.dataset && a.dataset.choice) || a.id || '') : ''; };
        for (let i = 0; i < 6 && where() !== 'old'; i++) await press(13);
        const onOld = where() === 'old'; await press(0);
        return { onOld };
      });
      let t = ''; for (let i = 0; i < 20 && !/Use your setup from Boxshelf/.test(t); i++) { await pause(300); t = await page.evaluate(() => document.getElementById('suBody').innerText); }
      check('First run, controller: the d-pad reaches "I\'ve used Boxshelf before", A chooses the old folder, and its setup is offered (Use your setup from Boxshelf 1.82.0-beta.12, Copy it over)',
        ok && nav.onOld && /Use your setup from Boxshelf 1\.82\.0-beta\.12/.test(t) && /That folder has a Boxshelf/.test(t) && /Boxshelf-1\.82\.0-beta\.12-windows/.test(t) && /Copy it over/.test(t), JSON.stringify({ nav, t: t.split('\n').slice(0, 8).join(' | ') }));
      await page.screenshot({ path: path.join(OUT, 'keepsetup-chosen.png') });
      await ctx.close(); }
    check('Keep setup pass: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('Keep setup pass ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e); }
};
