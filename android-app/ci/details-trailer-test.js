// Device test (beta.14, Windows): Details' trailer with a controller and the mouse, and the quick menu's → key.
// The d-pad steps from the buttons above straight onto the trailer box (the small speaker in its corner no longer catches
// the step); ← → there set its volume (turning its sound on first), up / down still leave it; the box says so. The mouse
// wheel over the sound pill and a click on its bar set the volume too. In the quick menu → opens a section in place but
// never runs a row that leaves the menu (Settings): only A does. Video previews wait 5 s by default.
'use strict';
module.exports = async function detailsTrailerPass({ browser, base, check }) {
  const errors = [], o = {};
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
  try {
    await p.goto(base + '?platform=windows&shelf=1&previews=shelf&clips=1&helper=1');
    await p.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._lib, null, { timeout: 90000, polling: 250 }); await p.waitForTimeout(1500);
    for (let i = 0; i < 8; i++) { if (await p.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500); }
    Object.assign(o, await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 30 && Shelf.getMode() !== 'note'; i++) await w(250); if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } // (the "Updated" card, if it came)
      out.before = Shelf.getMode(); out.game = (Shelf._lib.cur() || {}).title;
      for (let t = 0; t < 3 && Shelf.getMode() !== 'details'; t++) { if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } key('i'); for (let i = 0; i < 20 && Shelf.getMode() !== 'details'; i++) await w(150); } // (a card that came late is closed first)
      out.after = Shelf.getMode();
      for (let i = 0; i < 50 && !document.getElementById('dMedia').classList.contains('ready'); i++) await w(300);
      out.ready = document.getElementById('dMedia').classList.contains('ready');
      const pad = { id: 'Test pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
      await w(1800); // (a pad just seen: its menu buttons wait 1.5 s)
      const press = async b => { if (window.__padHold) { await __padHold(pad, b, 150); await w(450); return; } pad.buttons[b] = { pressed: true, touched: true, value: 1 }; pad.timestamp++; await w(150); pad.buttons[b] = { pressed: false, touched: false, value: 0 }; pad.timestamp++; await w(450); };
      const pf = () => (document.querySelector('#details .pad-focus') || {}).id || '';
      const vol = () => ({ on: document.querySelector('#details .dv-snd').classList.contains('on'), lvl: document.querySelector('#details .dv-vk').textContent });
      out.start = pf();
      // from the button row: down lands on the trailer box, wherever along the row you are
      for (let i = 0; i < 3; i++) await press(15); out.row = pf(); await press(13); out.down = pf();
      /* (beta.14) the clip's own sound file was fetched while it played muted: turning the sound on never waits ("Getting the sound…") */
      out.preSrc = !!((document.getElementById('dAudio') || {}).getAttribute && document.getElementById('dAudio').getAttribute('src'));
      const lab = document.getElementById('dvTrL'); out.waited = false; const mo = new MutationObserver(() => { if (lab && /Getting the sound/.test(lab.textContent)) out.waited = true; }); if (lab) mo.observe(lab, { childList: true, characterData: true, subtree: true });
      out.v0 = vol(); await press(15); out.v1 = vol(); mo.disconnect(); await press(15); out.v2 = vol(); await press(14); out.v3 = vol(); out.still = pf();
      out.hint = (document.getElementById('dvTr2') || {}).textContent || '';
      await press(12); out.up = pf(); out.mode = Shelf.getMode();
      try { delete navigator.getGamepads; } catch (e) {}
      return out; }));
    // the mouse: the wheel over the sound pill, a click on its bar
    const bar = await p.evaluate(() => { const b = document.querySelector('#details .dv-vbar').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
    const lvl = () => p.evaluate(() => document.querySelector('#details .dv-vk').textContent);
    o.m0 = await lvl(); await p.mouse.move(bar[0] + bar[2] / 2, bar[1] + bar[3] / 2); await p.mouse.wheel(0, 120); await p.waitForTimeout(300); o.wheel = await lvl();
    await p.mouse.click(bar[0] + bar[2] * 0.2, bar[1] + bar[3] / 2); await p.waitForTimeout(300); o.click = await lvl(); o.barW = Math.round(bar[2]);
    await p.keyboard.press('Escape'); await p.waitForTimeout(800);
    // the quick menu: → on Settings stays in the menu; → on a section (Theme) opens it; A on Settings opens Settings
    Object.assign(o, await p.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 6 && Shelf.getMode() !== 'browse'; i++) { key('Escape'); await w(400); }
      document.getElementById('menuBtn').click(); await w(800);
      const rowOn = () => ((document.querySelector('#quickMenu .qm-row.on') || {}).textContent || '').trim();
      const to = async re => { for (let i = 0; i < 16 && !re.test(rowOn()); i++) { key('ArrowDown'); await w(140); } return re.test(rowOn()); };
      out.rows = [...document.querySelectorAll('#quickMenu .qm-row')].map(r => r.textContent.trim().slice(0, 14));
      out.qmSettingsRow = await to(/^Settings/); key('ArrowRight'); await w(700);
      out.qmAfterRight = { settings: !!(window.Settings && Settings.isOpen && Settings.isOpen()) || !!document.querySelector('#bss.on, #setup.on'), menu: !!document.querySelector('#quickMenu.on, #quickMenu.open') || Shelf.getMode() === 'browse' };
      for (let i = 0; i < 16; i++) { key('ArrowUp'); await w(100); }
      out.qmThemeRow = await to(/^(Customize|Look & sound)/); /* (beta.14: "Look & sound") */ const opts0 = document.querySelectorAll('#quickMenu .qm-opt.sw').length; key('ArrowRight'); await w(700);
      out.qmThemeOpened = document.querySelectorAll('#quickMenu .qm-opt.sw').length > 0 && !!document.querySelector('#quickMenu .qm-opt.on'); out.opts0 = opts0;
      key('Escape'); await w(500); key('Escape'); await w(500);
      return out; }));
  } catch (e) { o.err = e.message; }
  await ctx.close();
  // (beta.14) Change trailer: More → Change trailer opens its page in Settings (renderer/mock.js's pretend finds); a click picks
  // IGDB's trailer, the keys (as a controller moves) pick No trailer, a pasted YouTube link is saved as that video
  const t = {}; const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const p2 = await ctx2.newPage(); p2.on('pageerror', e => errors.push(e.message));
  try {
    await p2.goto(base + '?platform=windows&shelf=1&previews=shelf&clips=1&helper=1');
    await p2.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf._lib, null, { timeout: 90000, polling: 250 }); await p2.waitForTimeout(1500);
    for (let i = 0; i < 8; i++) { if (await p2.evaluate(() => { const g = Shelf._lib.cur(); return !!(g && g.kind === 'rom'); })) break; await p2.keyboard.press('ArrowRight'); await p2.waitForTimeout(500); }
    Object.assign(t, await p2.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      for (let i = 0; i < 30 && Shelf.getMode() !== 'note'; i++) await w(250); if (Shelf.getMode() === 'note') { key('Escape'); await w(800); }
      for (let k = 0; k < 3 && Shelf.getMode() !== 'details'; k++) { if (Shelf.getMode() === 'note') { key('Escape'); await w(800); } key('i'); for (let i = 0; i < 20 && Shelf.getMode() !== 'details'; i++) await w(150); }
      const b = document.getElementById('dTrailerPick'); out.inMore = !!b && !b.hidden && b.parentElement && b.parentElement.id === 'dMenu'; return out; }));
    await p2.click('#dMoreBtn'); await p2.waitForTimeout(600); await p2.click('#dTrailerPick');
    await p2.waitForFunction(() => [...document.querySelectorAll('#bss .bss-row')].some(r => /Launch Trailer/.test(r.textContent)), null, { timeout: 15000 });
    const rows = () => p2.evaluate(() => [...document.querySelectorAll('#bss .bss-row')].map(r => r.textContent.trim()));
    t.rows = await rows(); t.mode = await p2.evaluate(() => Shelf.getMode());
    await p2.click('#bss .bss-row:has-text("Launch Trailer")'); await p2.waitForTimeout(700);
    t.click = await p2.evaluate(() => window.__trailerSet || null); t.inUse = (await rows()).find(r => /Launch Trailer/.test(r)) || '';
    // the keys (a controller's d-pad and A): down to No trailer, then A
    for (let i = 0; i < 12; i++) { const on = await p2.evaluate(() => ((document.querySelector('#bss .bss-row.cur') || {}).textContent || '').trim()); if (/^No trailer/.test(on)) break; await p2.keyboard.press('ArrowDown'); await p2.waitForTimeout(160); }
    await p2.keyboard.press('Enter'); await p2.waitForTimeout(700); t.keys = await p2.evaluate(() => window.__trailerSet || null);
    // a YouTube link of your own: its row, Enter, the link, Enter
    for (let i = 0; i < 12; i++) { const on = await p2.evaluate(() => ((document.querySelector('#bss .bss-row.cur') || {}).textContent || '').trim()); if (/^Paste a YouTube link/.test(on)) break; await p2.keyboard.press('ArrowUp'); await p2.waitForTimeout(160); }
    await p2.keyboard.press('Enter'); await p2.waitForTimeout(400); await p2.keyboard.type('https://youtu.be/abcdefghijk'); await p2.keyboard.press('Enter'); await p2.waitForTimeout(800);
    t.link = await p2.evaluate(() => window.__trailerSet || null); t.rows2 = await rows();
  } catch (e) { t.err = e.message; }
  await ctx2.close();
  check('Details → Change trailer (beta.14, Windows): in ···, it opens a Settings page listing the gameplay clip, IGDB\'s trailer, LaunchBox\'s link (marked as looking wrong), the search result, Paste a YouTube link and No trailer',
    t.inMore && t.mode === 'setup' && (t.rows || []).some(r => /^Automatic/.test(r)) && t.rows.some(r => /Gameplay clip/.test(r) && /ScreenScraper/.test(r)) && t.rows.some(r => /Looks like another video/.test(r)) && t.rows.some(r => /Official Trailer/.test(r)) && t.rows.some(r => /^Paste a YouTube link/.test(r)) && t.rows.some(r => /^No trailer/.test(r)),
    JSON.stringify({ inMore: t.inMore, mode: t.mode, rows: t.rows, err: t.err }));
  check('Change trailer: a click picks IGDB\'s trailer (In use), the keys pick No trailer, a pasted YouTube link is saved as that video',
    t.click && t.click.choice === 'yt:igdbTrail01' && /In use/.test(t.inUse) && t.keys && t.keys.choice === 'none' && t.link && t.link.choice === 'yt:abcdefghijk' && (t.rows2 || []).some(r => /Your YouTube link/.test(r) && /In use/.test(r)),
    JSON.stringify({ click: t.click, inUse: t.inUse, keys: t.keys, link: t.link, rows2: t.rows2, err: t.err }));
  check('Details trailer (beta.14, Windows): the d-pad steps from the button row straight onto the trailer box (not its small speaker)',
    o.ready && o.start === 'dPlay' && !!o.row && o.down === 'dTrailer', JSON.stringify({ ready: o.ready, before: o.before, game: o.game, after: o.after, start: o.start, row: o.row, down: o.down, err: o.err }));
  check('Details trailer: on the box ← → set its volume (→ turns the sound on first), the box shows Volume and Full screen, up leaves it',
    o.v0 && !o.v0.on && o.v1.on && parseInt(o.v2.lvl) === parseInt(o.v1.lvl) + 10 && parseInt(o.v3.lvl) === parseInt(o.v1.lvl) && o.still === 'dTrailer' && /Volume/.test(o.hint) && /Full screen/.test(o.hint) && o.up && o.up !== 'dTrailer' && o.mode === 'details',
    JSON.stringify({ v0: o.v0, v1: o.v1, v2: o.v2, v3: o.v3, still: o.still, hint: o.hint, up: o.up }));
  check('Details trailer (beta.14): the clip\'s sound is loaded while it plays muted, so turning the sound on is instant (no "Getting the sound…")',
    o.preSrc === true && o.waited === false && !!(o.v1 && o.v1.on), JSON.stringify({ preSrc: o.preSrc, waited: o.waited, v1: o.v1 }));
  check('Details trailer: the mouse wheel over the sound pill and a click on its (wider) bar set the volume',
    parseInt(o.wheel) === parseInt(o.m0) - 10 && parseInt(o.click) === 20 && o.barW >= 80, JSON.stringify({ m0: o.m0, wheel: o.wheel, click: o.click, barW: o.barW }));
  check('Quick menu (beta.14): → on Settings stays in the quick menu (only A opens it); → on Customize still opens its theme tiles in place',
    o.qmSettingsRow && o.qmAfterRight && !o.qmAfterRight.settings && o.qmThemeRow && o.qmThemeOpened, JSON.stringify({ row: o.qmSettingsRow, after: o.qmAfterRight, theme: o.qmThemeRow, opened: o.qmThemeOpened, rows: o.rows }));
  check('Details trailer pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
// run on its own: node ci/details-trailer-test.js <www folder>
if (require.main === module) {
  (async () => {
    const path = require('path'), { chromium } = require('playwright'), http = require('http'), fs = require('fs');
    const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'www'));
    const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wasm': 'application/wasm', '.webm': 'video/webm' };
    const srv = http.createServer((q, s) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep) || f === root) f = path.join(root, 'index.html');
      fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(b); }); });
    await new Promise(r => srv.listen(0, r)); const base = `http://127.0.0.1:${srv.address().port}/index.html`;
    const browser = await chromium.launch(); let fails = 0;
    const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : '\n     ' + String(detail).slice(0, 900))); if (!ok) fails++; };
    try { await module.exports({ browser, base, check }); } finally { await browser.close(); srv.close(); }
    process.exit(fails ? 1 : 0);
  })();
}
