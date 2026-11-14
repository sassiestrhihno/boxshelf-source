// Device test pass (beta.14, Windows), run by web-device-test.js: themes and sounds, kept simple.
//   The quick menu's Look & sound shows every theme (the same list as Settings) and every sound (the built-in ones, your
//   custom sounds, Off). Settings > Sound is plain rows: Sound, Sound per console (a console gets its own), Custom sounds
//   (add from a folder, files or a ZIP). Settings > Look > Theme: up / down go past the row; A (Enter) opens the grid,
//   the D-pad moves a line inside it, B (Esc) closes it. The old Themes and Sound pages are gone.
'use strict';
const path = require('path');

module.exports = async function lookSoundPass({ browser, base, check, newPage, OUT }) {
  const { ctx, page, errors } = await newPage(browser, null);
  try {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(base + '?platform=windows&shelf=1');
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.Setup && window.Sound, null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(2500);
    const w = ms => page.waitForTimeout(ms);

    // ---- the quick menu: every theme, every sound ----
    const qm = await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms));
      Shelf.quickMenu(); await w(800);
      const row = [...document.querySelectorAll('.qm-list > *')].find(e => ((e.querySelector('.qm-lbl') || {}).textContent || '').trim() === 'Look & sound');
      if (row) row.click(); await w(900);
      const out = { tiles: document.querySelectorAll('.qm-opt[data-k="theme"]').length, sounds: [...document.querySelectorAll('.qm-opt[data-k="snd"]')].map(b => b.textContent.trim()),
        oldLink: !!document.querySelector('.qm-opt[data-k="themes"]'), themesPage: typeof window.BS_THEMES, setPages: typeof window.BS_SETPAGES };
      Shelf.quickMenu(); await w(500); return out; });
    await page.evaluate(() => Setup.open({ page: 'display' })); await w(1500);
    const settingsTiles = await page.evaluate(() => document.querySelectorAll('#bss .bss-tile').length);
    check('Quick menu (beta.14): Look & sound has every theme Settings has, and every sound (built-in, custom, Off); no Themes page link',
      qm.tiles > 20 && qm.tiles === settingsTiles && ['Aero', 'Melody', 'Music box', 'Disc-era', 'Handheld', 'Living room', 'Off'].every(s => qm.sounds.includes(s)) && qm.sounds[qm.sounds.length - 1] === 'Off'
        && !qm.oldLink && qm.themesPage === 'undefined' && qm.setPages === 'undefined', JSON.stringify({ ...qm, settingsTiles }));

    // ---- Settings > Look > Theme: the grid opens with A ----
    const st = () => page.evaluate(() => ({ row: ((document.querySelector('#bss .bss-row.cur .nm') || {}).textContent || ''), grid: document.querySelector('.bss-root').classList.contains('tgrid'), theme: ((document.querySelector('#bss .bss-tile.on span') || {}).textContent || '') }));
    const key = async k => { await page.keyboard.press(k); await w(350); };
    for (let i = 0; i < 8 && (await st()).row !== 'Theme'; i++) await key((await st()).row ? 'ArrowDown' : 'ArrowRight');
    const g0 = await st(); await key('ArrowDown'); const g1 = await st(); await key('ArrowUp'); const g2 = await st();
    await key('Enter'); const g3 = await st(); await key('ArrowDown'); const g4 = await st(); await page.screenshot({ path: path.join(OUT, 'look-theme-grid.png') });
    await key('Escape'); const g5 = await st(); await key('ArrowDown'); const g6 = await st();
    check('Settings > Look > Theme: down goes past the row; Enter (A) opens the grid, down moves a line and picks that theme, Esc (B) closes it, then down leaves',
      g0.row === 'Theme' && !g0.grid && g1.row !== 'Theme' && g2.row === 'Theme' && g3.grid && g4.grid && g4.theme !== g3.theme && !g5.grid && g5.row === 'Theme' && g6.row !== 'Theme',
      JSON.stringify({ g0, g1, g2, g3, g4, g5, g6 }));
    await page.evaluate(() => window.Settings && Settings.close && Settings.close()); await w(700);

    // ---- (beta.14) IGDB in Accounts & services: its row, and its page (Client ID, Client Secret, Test, the Twitch link) ----
    const ig = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), names = () => [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent);
      Setup.open({ page: 'acct' }); await w(1500); const out = { acct: names() };
      const row = [...document.querySelectorAll('#bss .bss-row')].find(r => ((r.querySelector('.nm') || {}).textContent || '') === 'IGDB'); if (row) { row.click(); await w(900); }
      out.page = names(); if (window.Settings && Settings.close) { await Settings.close(); await w(600); } return out; });
    check('Settings › Accounts & services: IGDB has its row and page (Client ID, Client Secret, Test, the steps to a free key from Twitch\'s developer console)',
      ig.acct.includes('IGDB') && ['Client ID', 'Client Secret', 'Test the key', '1. Open Twitch\'s developer console'].every(n => ig.page.includes(n)), JSON.stringify(ig));

    // ---- (beta.14) Video previews live in Settings › Look (an old "previews" link lands there too) ----
    const pvl = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
      Setup.open({ page: 'previews' }); await w(1500);
      const out = { title: (document.querySelector('#bss .bss-title') || {}).textContent, rows: [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent) };
      if (window.Settings && Settings.close) { await Settings.close(); await w(600); } return out; });
    check('Settings: Video previews are on the Look tab (Play previews, Previews by console), and the old previews link opens it',
      pvl.title === 'Look' && pvl.rows.includes('Play previews') && pvl.rows.includes('Theme'), JSON.stringify(pvl));

    // ---- Settings > Sound: plain rows; a console gets its own sound; custom sounds ----
    const snd = await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), names = () => [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent);
      const row = n => [...document.querySelectorAll('#bss .bss-row')].find(r => ((r.querySelector('.nm') || {}).textContent || '') === n);
      Setup.open({ page: 'sound' }); for (let i = 0; i < 30 && !row('Sound per console'); i++) await w(150); await w(300);
      const out = { rows: names(), drawn: !!document.querySelector('#bss .bss-root.cpage') };
      row('Sound per console').click(); await w(900); out.consoles = names();
      const gc = [...document.querySelectorAll('#bss .bss-row')].find(r => /^GameCube$/.test(((r.querySelector('.nm') || {}).textContent || '')));
      for (let k = 0; k < 2 && gc; k++) { const b = gc.getBoundingClientRect(); gc.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: b.right - 6, clientY: b.top + b.height / 2 })); await w(700); } /* (Same as everywhere → Aero → Melody) */
      out.byShelf = (await window.boxshelf.getConfig()).config.ui.soundByShelf || {};
      out.gcText = gc ? gc.innerText.replace(/\n+/g, ' | ') : '';
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await w(700);
      const cs = row('Custom sounds'); if (cs) { cs.click(); await w(900); } out.custom = names();
      if (window.Settings && Settings.close) { await Settings.close(); await w(600); }
      return out; });
    await page.screenshot({ path: path.join(OUT, 'look-sound-settings.png') });
    check('Settings > Sound: plain rows (Sound, Sound per console, Custom sounds), not the drawn page',
      !snd.drawn && ['Sound', 'Sound per console', 'Custom sounds', 'Menu music'].every(n => snd.rows.includes(n)) && !snd.rows.includes('Instrument'), JSON.stringify(snd.rows));
    check('Sound per console: each console you have a line; GameCube set to its own sound is kept (ui.soundByShelf)',
      snd.consoles.includes('GameCube') && snd.byShelf.gc === 'melody' && /Melody/.test(snd.gcText), JSON.stringify({ consoles: snd.consoles.slice(0, 6), byShelf: snd.byShelf, gc: snd.gcText }));
    check('Custom sounds: add from a folder, files or a ZIP; the ones you added are listed',
      ['Add from a folder', 'Add from files', 'Add from a ZIP'].every(n => snd.custom.includes(n)), JSON.stringify(snd.custom));
    // ---- (beta.14) Keep themes moving while you scroll: on by default on Windows (no hold while sliding); Pause brings it back ----
    const keep = await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), f = document.getElementById('themeFx'), out = {};
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      const slide = async () => { key('ArrowRight'); await w(80); const h = f.classList.contains('hold'); await w(1900); key('ArrowLeft'); await w(1900); return h; };
      Shelf.setPerformance && Shelf.setPerformance('high'); Shelf.setTheme('rain'); await w(1500);
      out.defaultHold = await slide();
      Shelf.quickMenu(); await w(800);
      const row = [...document.querySelectorAll('.qm-list > *')].find(e => ((e.querySelector('.qm-lbl') || {}).textContent || '').trim() === 'Look & sound'); if (row) row.click(); await w(900);
      out.line = [...document.querySelectorAll('.qm-ll')].some(e => /Moving themes while you scroll/.test(e.textContent));
      const pause = document.querySelector('.qm-opt[data-k="fxkeep"][data-v="off"]'); if (pause) { pause.click(); await w(400); }
      for (let i = 0; i < 4 && Shelf._qs().open; i++) { key('Escape'); await w(600); } out.qmClosed = !Shelf._qs().open; out.mode = Shelf.getMode();
      out.saved = (await window.boxshelf.getConfig()).config.ui.themeKeepMoving;
      Shelf.setTheme('rain'); await w(1500); /* (the menu's Esc put the saved theme back) */
      out.pausedHold = await slide();
      Setup.open({ page: 'display' }); await w(1500);
      out.row = [...document.querySelectorAll('#bss .bss-row .nm')].some(e => e.textContent === 'Keep themes moving while you scroll');
      if (window.Settings && Settings.close) { await Settings.close(); await w(600); }
      Shelf.setTheme(null); Shelf.setPerformance && Shelf.setPerformance('auto'); return out; });
    check('Keep themes moving while you scroll (Windows): on by default, a moving theme keeps going as the shelf slides; Pause in the quick menu holds it again; the row is in Settings › Look',
      keep.defaultHold === false && keep.line && keep.saved === false && keep.pausedHold === true && keep.row, JSON.stringify(keep));
    check('Themes and sounds pass: no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('Themes and sounds pass ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); try { await page.screenshot({ path: path.join(OUT, 'look-sound-fail.png') }); } catch {} }
  await ctx.close().catch(() => {});
};
