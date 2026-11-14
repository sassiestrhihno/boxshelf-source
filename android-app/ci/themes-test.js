// Device test pass "shelf themes" (0.3.5; themes-extra.js since 1.75), run by web-device-test.js. Checks results, never speed:
// every wait polls with a generous timeout (the build machine draws in software).
//   Android (the pretend Thor): the ten extra themes are offered in the quick menu (Customize → Theme) and in Settings'
//   theme tiles; each one applies (one theme-<id> body class, a backdrop painted, the theme layer running the right
//   drawing or none), the bottom screen is sent the same backdrop and its page wears it; at the Handheld level the
//   animated ones hold a still frame (no frame loop), at Balanced they move, and they stop once the shelf goes idle.
//   Windows (the demo page as Windows, 1.75): the same ones are offered, and a new one applies (its body class, its moving layer);
//   (beta.14) the CSS-only themes (the six, then five more) apply, move, hold and stand still as they should.
'use strict';
const path = require('path');
// counts the animation frames the theme layer asks for (the stack names themefx.js)
const RAF = `(() => { const r = window.requestAnimationFrame.bind(window); window.__fxRaf = 0;
  window.requestAnimationFrame = function (fn) { if (/themefx\\.js/.test(new Error().stack || '')) window.__fxRaf++; return r(fn); }; })();`;
const IDS = ['cube', 'blueshift', 'swirl', 'oled', 'forest', 'synth', 'starfield', 'rain', 'sakura', 'snow', 'eventhorizon', 'glasslake',
  'neoncity', 'deepsea', 'storm', 'fireflies', 'desertnight']; // (beta.14: Pocket and Walnut retired; the last eleven are CSS-only)
const NEW6 = ['starfield', 'rain', 'sakura', 'snow', 'eventhorizon', 'glasslake'];
const NEW5 = ['neoncity', 'deepsea', 'storm', 'fireflies', 'desertnight'];
const ANIM = ['blueshift', 'swirl', 'forest', 'synth']; // (beta.14: CRT and VHS retired)
const OLD = ['spectrum', 'classic', 'keys', 'arcade', 'aurora', 'midnight', 'artwork', 'blur']; // (1.76: Artwork and Blur, the old Background setting, after the original six)

// what the page offers: the quick menu's theme chips and Settings' theme tiles (both closed again afterwards)
const OFFERED = async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  Shelf.quickMenu(); for (let i = 0; i < 30 && !Shelf._qs().open; i++) await w(150); await w(400);
  const row = [...document.querySelectorAll('#quickMenu .qm-row')].find(e => /Customize|Look & sound/.test(e.textContent)); if (row) row.click(); // (beta.14: "Look & sound" on Windows)
  for (let i = 0; i < 30 && !document.querySelector('#quickMenu .qm-opt[data-k="theme"]'); i++) await w(150);
  out.qm = [...document.querySelectorAll('#quickMenu .qm-opt[data-k="theme"]')].map(b => b.dataset.v);
  for (let i = 0; i < 4 && Shelf._qs().open; i++) { esc(); await w(500); }
  Setup.open({ page: 'display' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-tiles'); i++) await w(150); await w(500);
  out.tiles = [...document.querySelectorAll('#bss .bss-tiles .bss-tile span')].map(s => s.textContent);
  // (1.78) the tiles really show: one tile box (it was once drawn inside itself, squeezing every tile to nothing), each tile
  // a sensible size, and a custom tile wears its picture (its swatch's url("…") used to end the style attribute)
  const box = document.querySelector('#bss .bss-row.theme > .bss-tiles'), ts = box ? [...box.querySelectorAll('.bss-tile')] : [];
  out.vis = { nested: !!(box && box.querySelector('.bss-tiles')), minW: ts.length ? Math.min(...ts.map(t => t.getBoundingClientRect().width)) : 0,
    customPic: ts.filter(t => /Test Sky/.test(t.textContent)).every(t => /url\(/.test(t.querySelector('.sw2').style.background)) };
  if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(800); }
  return out; };

module.exports = async function themesPass({ browser, base, check, newPage, OUT }) {
  // ---------- Android: the pretend Thor ----------
  { const { ctx, page, errors } = await newPage(browser, RAF);
    try {
      const url = base + '?fakeNative=1';
      await page.goto(url); await page.waitForTimeout(4000);
      await page.evaluate(async () => { const api = window.boxshelf, c = (await api.getConfig()).config, det = await api.detect();
        const d = [await api.pick({ kind: 'folder' }), await api.pick({ kind: 'folder' })];
        c.systems.gc.romDirs = [d[0]]; c.systems.gc.emulator = det.systems.gc.emulator; c.systems.psx.romDirs = [d[1]]; c.systems.psx.emulator = det.systems.psx.emulator;
        c.setupDone = true; await api.saveConfig(c); await api.scan(); });
      await page.goto(url + '&bottomPreview=1');
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && window.ThemeFx, null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(2500);
      await page.addStyleTag({ content: '#thorHud{visibility:hidden!important}' }); // (the test meter off the screenshots)

      const off = await page.evaluate(OFFERED);
      const names = ['Cube', 'Blue Shift', 'Swirl', 'OLED', 'Forest', 'Synthwave', 'Starfield', 'Rainy Night', 'Cherry Blossom', 'Snowfall', 'Event Horizon', 'Glass Lake',
        'Neon City', 'Deep Sea', 'Thunderstorm', 'Fireflies', 'Desert Night'];
      // (beta.14: every theme in the quick menu too) all of them, in Settings' order (the original eight first)
      check('Themes (Android): the quick menu (Customize → Theme) offers every theme Settings does, the original eight first',
        off.qm.length === off.tiles.length && off.qm.length >= 31 && OLD.every((id, i) => off.qm[i] === id) && !off.qm.some(id => id === 'pocket' || id === 'walnut'), off.qm.join(','));
      check('Themes (Android): Settings shows a tile for each of the thirty-one (no Pocket, Walnut, CRT or VHS)', off.tiles.length >= 31 && names.every(n => off.tiles.includes(n)) && ['Nebula', 'Prism', 'Hologram'].every(n => off.tiles.includes(n)) && !off.tiles.some(n => n === 'Pocket' || n === 'Walnut'), off.tiles.join(','));
      check('Themes (Android): the Settings theme tiles are really visible (one tile box, every tile at least 30 px wide)', !off.vis.nested && off.vis.minW >= 30, JSON.stringify(off.vis));

      // each one applies: its body class (alone), a backdrop painted behind the shelf, the right moving layer, the same
      // backdrop described for the bottom screen
      const applied = await page.evaluate(async ({ IDS, ANIM }) => { const w = ms => new Promise(r => setTimeout(r, ms)), out = []; let prevBg = '';
        for (const id of IDS) {
          Shelf.setTheme(id); let bg = '', cls = [];
          // (Android paints the backdrop once the shelf has rested, 620 ms, then fades it in)
          for (let i = 0; i < 60; i++) { await w(150); cls = [...document.body.classList].filter(c => /^theme-/.test(c)); const t = document.querySelector('.bg-layer.on .tint'); bg = t ? getComputedStyle(t).backgroundImage : '';
            if (cls.length === 1 && cls[0] === 'theme-' + id && bg && bg !== 'none' && bg !== prevBg) break; }
          const fx = ThemeFx._state().id, bi = await Shelf.bottomInfo(), th = bi && bi.theme;
          out.push({ id, cls: cls.join(' '), painted: !!bg && bg !== 'none' && bg !== prevBg, fx, fxOk: fx === (ANIM.includes(id) ? id : null),
            bottom: !!th && th.id === id && typeof th.bg === 'string' && th.bg.length > 20 && th.bg.length < 4000 });
          prevBg = bg;
        }
        return out; }, { IDS, ANIM });
      const bad = applied.filter(a => a.cls !== 'theme-' + a.id || !a.painted || !a.fxOk);
      check('Themes (Android): each new theme applies (its body class alone, its own backdrop painted, the right moving layer)', applied.length === IDS.length && !bad.length,
        bad.length ? JSON.stringify(bad).slice(0, 300) : applied.map(a => a.id + (a.fx ? '*' : '')).join(' '));
      const nb = applied.filter(a => !a.bottom);
      check('Themes (Android): the bottom screen is sent each theme\'s backdrop (id + the same backdrop, under 4000 chars)', !nb.length, nb.length ? nb.map(a => a.id).join(',') : `all ${applied.length}`);

      // the bottom page itself wears it (its backdrop layer shows the theme's picture)
      const fr = page.frame({ url: /bottom\.html/ });
      let wear = { err: 'no bottom frame' };
      if (fr) {
        await page.evaluate(() => Shelf.setTheme('synth'));
        const ok = await fr.waitForFunction(() => { const s = bsBottom.state(), on = document.querySelector('.tbg.on'); return s.theme === 'synth' && s.themed && on && /svg/.test(getComputedStyle(on).backgroundImage); }, null, { timeout: 30000, polling: 250 }).then(() => true, () => false);
        wear = await fr.evaluate(() => { const on = document.querySelector('.tbg.on'); return { theme: bsBottom.state().theme, themed: bsBottom.state().themed, svg: !!on && /svg/.test(getComputedStyle(on).backgroundImage) }; });
        wear.ok = ok;
      }
      check('Themes (Android): the bottom page wears the new theme\'s backdrop (Synthwave: its sun and grid)', wear.ok, JSON.stringify(wear));

      // Handheld (the Thor's level): every animated theme holds one still frame, so the theme layer asks for no frames
      const hh = await page.evaluate(async ANIM => { const w = ms => new Promise(r => setTimeout(r, ms)), out = [];
        Perf.set('handheld'); await w(400);
        for (const id of ANIM) {
          Shelf.setTheme(id); await w(1500);
          window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); await w(400); // (input: not the idle state)
          const t0 = ThemeFx._state().t; window.__fxRaf = 0; await w(1500);
          out.push({ id, frames: window.__fxRaf, moved: +(ThemeFx._state().t - t0).toFixed(3), still: document.body.classList.contains('bs-still'), fx: ThemeFx._state().id });
        }
        return out; }, ANIM);
      const hb = hh.filter(x => x.frames > 2 || x.moved > 0 || x.fx !== x.id);
      check('Themes (Handheld): the animated themes hold a still frame (no frame loop: ≤ 2 frames asked for in 1.5 s, no motion)', hh.length === ANIM.length && !hb.length, JSON.stringify(hb.length ? hb : hh).slice(0, 300));

      // at Balanced they move (drawn at the capped rate), and once the shelf goes idle (bs-still) they stop altogether
      const bal = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
        Perf.set('balanced'); Shelf.setTheme('synth'); await w(1200);
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); await w(300);
        const t0 = ThemeFx._state().t; let moved = 0; for (let i = 0; i < 20 && !(moved > 0); i++) { await w(200); moved = ThemeFx._state().t - t0; }
        // idle: no input for a few seconds puts bs-still on (perf-meter.js); then the layer asks for nothing
        let still = false; for (let i = 0; i < 60 && !still; i++) { await w(250); still = document.body.classList.contains('bs-still'); }
        await w(400); window.__fxRaf = 0; const t1 = ThemeFx._state().t; await w(1500);
        const r = { moved: +moved.toFixed(3), still, idleFrames: window.__fxRaf, idleMoved: +(ThemeFx._state().t - t1).toFixed(3) };
        Perf.set('auto'); return r; });
      check('Themes (Balanced): an animated theme moves, and stops once the shelf is idle (no frames asked for)', bal.moved > 0 && bal.still && bal.idleFrames === 0 && bal.idleMoved === 0, JSON.stringify(bal));

      // a look at each (Thor-like screen; Handheld, so the still frames)
      await page.evaluate(() => Perf.set('handheld'));
      for (const id of IDS) { await page.evaluate(id => Shelf.setTheme(id), id); await page.waitForTimeout(1600); await page.screenshot({ path: path.join(OUT, `theme-${id}.png`) }); }
      await page.evaluate(() => { Perf.set('auto'); Shelf.setTheme(null); });
      check('Themes pass (Android): no script errors', !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check('Themes pass (Android) ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close(); }

  // ---------- Windows: the demo page as Windows (no Android adapter) ----------
  { const { ctx, page, errors } = await newPage(browser, null);
    try {
      await page.goto(base + '?platform=windows&shelf=1'); // (the demo's filled shelf)
      await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g, null, { timeout: 90000, polling: 250 });
      await page.waitForTimeout(2000);
      const os = await page.evaluate(() => window.bsPlatform && bsPlatform.os);
      const off = await page.evaluate(OFFERED);
      const tried = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); Shelf.setTheme('synth'); let c = '';
        for (let i = 0; i < 40; i++) { await w(150); c = [...document.body.classList].filter(x => /^theme-/.test(x)).join(' '); if (c === 'theme-synth' && ThemeFx._state().id === 'synth') break; }
        const r = c + ' fx=' + ThemeFx._state().id; Shelf.setTheme(null); return r; });
      check('Themes (Windows): the quick menu and Settings both offer all thirty-one and your own (the original eight first); a new one applies with its moving layer',
        os === 'windows' && off.qm.length === off.tiles.length && OLD.every((id, i) => off.qm[i] === id) && off.tiles.filter(n => n !== 'Test Sky').length === 31 && tried === 'theme-synth fx=synth', `${os}: ${off.qm.length} chips · ${off.tiles.length} tiles · synth → ${tried}`);
      // (beta.14) Keep themes moving while you scroll (ui.themeKeepMoving, on by default on Windows): a slide puts no hold on a
      // CSS theme, its layers keep running
      const keep = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), f = document.getElementById('themeFx');
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        Shelf.setPerformance('high'); Shelf.setTheme('rain'); for (let i = 0; i < 40 && !document.body.classList.contains('theme-rain'); i++) await w(150); await w(800);
        key('ArrowRight'); await w(60); const r = { keep: !!(window.BS_FX_KEEP && BS_FX_KEEP()), hold: f.classList.contains('hold'), state: getComputedStyle(f.children[0]).animationPlayState };
        await w(400); r.holdLater = f.classList.contains('hold'); await w(1800); key('ArrowLeft'); await w(1800);
        Shelf.setPerformance('auto'); Shelf.setTheme(null); await w(300); return r; });
      check('Themes (Windows): with Keep themes moving on (the default here) a CSS theme keeps moving while the shelf slides (no hold)',
        keep.keep && !keep.hold && !keep.holdLater && keep.state === 'running', JSON.stringify(keep));
      // (beta.14) the second six (Starfield, Rainy Night, Cherry Blossom, Snowfall, Event Horizon, Glass Lake): CSS only. Each
      // applies (its class alone, #themeFx shown, no canvas drawing), its layers move at High and are all still at Low, its
      // backdrop fits the bottom screen (under 4000 characters); they hold while the shelf slides and carry on after (with Keep
      // themes moving off); Glass Lake's mountains follow the place along the shelf; Pocket and Walnut are gone and a saved one
      // falls back cleanly
      const six = await page.evaluate(async NEW6 => { const w = ms => new Promise(r => setTimeout(r, ms)), out = { each: [] };
        const cls = () => [...document.body.classList].filter(c => /^theme-/.test(c)).join(' '), f = document.getElementById('themeFx');
        const anims = () => [...f.children].map(i => getComputedStyle(i).animationName).filter(a => a && a !== 'none').length;
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        Shelf.applyUi({ themeKeepMoving: false }); Shelf.setPerformance('high'); await w(300);
        for (const id of NEW6) { Shelf.setTheme(id); let c = '';
          for (let i = 0; i < 40; i++) { await w(150); c = cls(); if (c === 'theme-' + id) break; }
          await w(300);
          const x = BS_EXTRA_THEMES.find(t => t.id === id), raw = x ? x.tint(200, { hue: 200 }, .5) : '';
          out.each.push({ id, cls: c === 'theme-' + id, shown: getComputedStyle(f).display === 'block', moving: anims(), canvas: ThemeFx._state().id, len: raw.length, isNew: !!(x && x.isNew && x.css) });
        }
        Shelf.setTheme('rain'); await w(800); key('ArrowRight'); await w(60);
        out.hold = { during: f.classList.contains('hold') && getComputedStyle(f.children[0]).animationPlayState === 'paused' };
        await w(2200); out.hold.after = !f.classList.contains('hold') && getComputedStyle(f.children[0]).animationPlayState === 'running'; key('ArrowLeft'); await w(400);
        Shelf.setPerformance('low'); await w(300); out.low = anims(); Shelf.setPerformance('auto'); await w(300);
        const gl = BS_EXTRA_THEMES.find(t => t.id === 'glasslake'), a = gl.tint(200, { hue: 200 }, 0), b = gl.tint(200, { hue: 200 }, 1);
        const nearAt = s => { const m = /\) ([\d.]+)% 0\/112%/.exec(s); return m ? +m[1] : null; };
        out.parallax = nearAt(a) != null && nearAt(b) != null && nearAt(a) < nearAt(b) && b.length < 4000;
        out.gone = !Shelf._themes.list().some(t => t.id === 'pocket' || t.id === 'walnut') && (window.BS_THEME_RETIRED || {}).pocket === 'forest';
        Shelf.setTheme('pocket'); let c = ''; for (let i = 0; i < 20; i++) { await w(150); c = cls(); if (c === 'theme-spectrum' || c === 'theme-forest') break; } out.pocket = c;
        Shelf.applyUi({ themeKeepMoving: undefined }); Shelf.setTheme(null); await w(300); return out; }, NEW6);
      const sb = six.each.filter(e => !e.cls || !e.shown || e.moving < 2 || e.canvas || !(e.len > 200 && e.len < 4000) || !e.isNew);
      check('Themes (Windows): the second six apply (class, CSS layers moving at High, no canvas, backdrop under 4000 chars), hold while sliding, still at Low; Glass Lake follows the shelf; Pocket / Walnut gone and a saved one falls back',
        six.each.length === 6 && !sb.length && six.hold.during && six.hold.after && six.low === 0 && six.parallax && six.gone && /^theme-(spectrum|forest)$/.test(six.pocket),
        JSON.stringify(sb.length ? sb : { hold: six.hold, low: six.low, parallax: six.parallax, gone: six.gone, pocket: six.pocket, each: six.each.map(e => e.id + ':' + e.moving + ':' + e.len) }).slice(0, 500));
      // (beta.14) the five more (Neon City, Deep Sea, Thunderstorm, Fireflies, Desert Night), checked like the six: class, CSS
      // layers moving at High, no canvas, backdrop under 4000 chars, isNew; with Keep themes moving off they hold while the
      // shelf slides and carry on after; all still at Low, where the lightning and the shooting star stay dark. The lightning
      // is gentle and rare (its brightest ≤ .8 of a soft glow, once in ≥ 10 s, moving on only while dark: its place changes
      // every three flashes' time); Desert Night's second layer lays the dunes back over the turning stars
      const five = await page.evaluate(async NEW5 => { const w = ms => new Promise(r => setTimeout(r, ms)), out = { each: [] };
        const cls = () => [...document.body.classList].filter(c => /^theme-/.test(c)).join(' '), f = document.getElementById('themeFx');
        const anims = () => [...f.children].map(i => getComputedStyle(i).animationName).filter(a => a && a !== 'none').length;
        const states = () => [...f.children].filter(i => getComputedStyle(i).animationName !== 'none').map(i => getComputedStyle(i).animationPlayState);
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        const set = async id => { Shelf.setTheme(id); for (let i = 0; i < 40 && cls() !== 'theme-' + id; i++) await w(150); await w(300); };
        Shelf.applyUi({ themeKeepMoving: false }); Shelf.setPerformance('high'); await w(300);
        for (const id of NEW5) { await set(id);
          const x = BS_EXTRA_THEMES.find(t => t.id === id); let len = 0; for (const h of [0, 120, 240]) len = Math.max(len, x ? x.tint(h, { hue: h }, .5).length : 0);
          out.each.push({ id, cls: cls() === 'theme-' + id, shown: getComputedStyle(f).display === 'block', moving: anims(), canvas: ThemeFx._state().id, len, isNew: !!(x && x.isNew && x.css) });
          if (id === 'storm') { const fl = document.getAnimations().find(a => a.animationName === 'bsTxFlash'), at = document.getAnimations().find(a => a.animationName === 'bsTxFlashAt');
            out.flash = fl ? { peak: Math.max(...fl.effect.getKeyframes().map(k => +k.opacity || 0)), ms: fl.effect.getTiming().duration, atMs: at ? at.effect.getTiming().duration : 0 } : null; }
          if (id === 'desertnight') out.cover = /svg/.test(getComputedStyle(f.children[1]).backgroundImage) && getComputedStyle(f.children[1]).animationName === 'none'; }
        await set('storm'); await w(500); key('ArrowRight'); await w(60);
        out.hold = { during: f.classList.contains('hold') && states().every(s => s.split(',').every(p => p.trim() === 'paused')) };
        await w(2200); out.hold.after = !f.classList.contains('hold') && states().every(s => s.split(',').every(p => p.trim() === 'running')); key('ArrowLeft'); await w(400);
        Shelf.setPerformance('low'); await w(300); out.low = {};
        for (const id of NEW5) { await set(id); out.low[id] = anims(); }
        await set('storm'); out.darkStill = getComputedStyle(f.children[0]).opacity === '0'; await set('desertnight'); out.darkStill = out.darkStill && getComputedStyle(f.children[2]).opacity === '0';
        Shelf.setPerformance('auto'); Shelf.applyUi({ themeKeepMoving: undefined }); Shelf.setTheme(null); await w(300); return out; }, NEW5);
      const fb = five.each.filter(e => !e.cls || !e.shown || e.moving < 2 || e.canvas || !(e.len > 200 && e.len < 4000) || !e.isNew);
      const fl = five.flash;
      check('Themes (Windows): the five more apply (class, CSS layers moving at High, no canvas, backdrop under 4000 chars), hold while sliding, still at Low (lightning / shooting star dark); the lightning is gentle and rare; Desert Night re-covers its dunes',
        five.each.length === 5 && !fb.length && five.hold.during && five.hold.after && Object.values(five.low).every(n => n === 0) && five.darkStill && five.cover
          && !!fl && fl.peak <= .8 && fl.ms >= 10000 && fl.atMs === fl.ms * 3,
        JSON.stringify(fb.length ? fb : { hold: five.hold, low: five.low, darkStill: five.darkStill, cover: five.cover, flash: fl, each: five.each.map(e => e.id + ':' + e.moving + ':' + e.len) }).slice(0, 500));
      // (1.76) the old Background setting as themes: Artwork turns on the game-art backdrop, Blur shows the softened cover
      const bgT = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), app = document.getElementById('app'), out = {};
        Shelf.setTheme('artwork'); for (let i = 0; i < 30 && !app.classList.contains('bg-art'); i++) await w(150); out.artwork = app.classList.contains('bg-art') && Shelf._qs().bg === 'art';
        Shelf.setTheme('blur'); let op = 0; for (let i = 0; i < 30; i++) { await w(150); const im = document.querySelector('.bg-layer.on img'); op = im && im.getAttribute('src') ? +getComputedStyle(im).opacity : 0; if (!app.classList.contains('bg-art') && op > .5) break; }
        out.blur = !app.classList.contains('bg-art') && op > .5; out.op = op; Shelf.setTheme(null); await w(300);
        out.noBgLine = !document.querySelector('#quickMenu .qm-opt[data-k="bg"]'); return out; });
      check('Themes (Windows): Artwork shows the game\'s art backdrop, Blur the softened cover at full strength; no Background line left',
        bgT.artwork && bgT.blur && bgT.noBgLine, JSON.stringify(bgT));
      // (1.76) custom themes (the mock's "Test Sky", an SVG picture): offered after the built-in ones, applies (its body
      // classes, the backdrop wearing its picture, no blurred cover, no moving layer), and a theme whose folder is gone
      // falls back to Spectrum; "Make a theme from a picture" adds one and selects it
      check('Themes (Windows): a custom theme is offered last in the quick menu and last in Settings', off.qm[off.qm.length - 1] === 'custom-test-sky' && off.tiles[off.tiles.length - 1] === 'Test Sky', `${off.qm.slice(-2).join(',')} · ${off.tiles.slice(-2).join(',')}`);
      const cu = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
        Shelf.setTheme('custom-test-sky'); let bg = '';
        for (let i = 0; i < 40; i++) { await w(150); const t = document.querySelector('.bg-layer.on .tint'); bg = t ? getComputedStyle(t).backgroundImage : ''; if (/svg/.test(bg) && document.body.classList.contains('theme-custom')) break; }
        const im = document.querySelector('.bg-layer.on img');
        out.applied = document.body.classList.contains('theme-custom-test-sky') && document.body.classList.contains('theme-custom') && /svg/.test(bg);
        out.coverHidden = !im || +getComputedStyle(im).opacity === 0; out.fx = ThemeFx._state().id;
        // the folder gone: the list comes back without it, the shelf falls back to Spectrum
        const keep = window.__mockCustom; window.__mockCustom = []; await Shelf.reloadCustomThemes(); await w(400);
        out.fallback = [...document.body.classList].filter(c => /^theme-/.test(c)).join(' ');
        window.__mockCustom = keep; await Shelf.reloadCustomThemes(); Shelf.setTheme(null); await w(300); return out; });
      check('Themes (Windows): a custom theme applies (its picture as the backdrop, no cover, nothing moving); gone, it falls back to Spectrum',
        cu.applied && cu.coverHidden && !cu.fx && cu.fallback === 'theme-spectrum', JSON.stringify(cu));
      check('Themes (Windows): the Settings theme tiles are really visible (one tile box, every tile at least 30 px wide) and a custom tile wears its picture',
        !off.vis.nested && off.vis.minW >= 30 && off.vis.customPic, JSON.stringify(off.vis));
      // (1.78) the theme row's feel: changing theme never fades the page (no peek); the shelf behind takes the theme once you stop
      // on one, not on every step; down moves to the tile line below (same row) before leaving it; a click on a tile picks it
      const feel = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        const shelfTheme = () => [...document.body.classList].filter(c => /^theme-/.test(c)).join(' '), on = () => { const t = document.querySelector('#bss .bss-tile.on span'); return t ? t.textContent : ''; };
        const cur = () => { const r = document.querySelector('#bss .bss-row.cur .nm'); return r ? r.textContent : ''; };
        Setup.open({ page: 'display' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-tiles'); i++) await w(150); await w(600);
        for (let i = 0; i < 6 && cur() !== 'Theme'; i++) { key('ArrowDown'); await w(200); } // (Settings opens on the page's first row)
        out.row = cur(); const before = shelfTheme(); let peeked = false;
        const mo = new MutationObserver(() => { if (document.querySelector('.bss-stage.peek') || document.body.classList.contains('bss-peek')) peeked = true; });
        mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['class'] });
        key('ArrowRight'); await w(40); key('ArrowRight'); await w(40); out.during = shelfTheme(); out.picked = on();
        await w(700); out.after = shelfTheme(); mo.disconnect(); out.peeked = peeked; out.before = before;
        /* (beta.14) the grid opens with Enter (A) first; then down moves a tile line; Esc (B) closes it again */
        const t0 = on(); key('Enter'); await w(300); key('ArrowDown'); await w(300); out.down = { from: t0, to: on(), row: cur() }; key('Escape'); await w(300);
        const clickTile = async name => { const tile = [...document.querySelectorAll('#bss .bss-tile')].find(t => t.querySelector('span').textContent === name), r = tile.getBoundingClientRect();
          tile.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })); await w(700); };
        await clickTile('Snowfall'); out.click = { on: on(), shelf: shelfTheme() };
        await clickTile('Snowfall'); out.again = on(); // (clicking the chosen one again keeps it)
        if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(800); }
        const c = (await window.boxshelf.getConfig()).config; c.ui.theme = 'spectrum'; await window.boxshelf.saveConfig(c); Shelf.setTheme(null); await w(300);
        return out; });
      check('Themes (Windows): changing theme in Settings never fades the page; the shelf takes it once you stop (not on every step); down moves a tile line; a click picks a tile (again: keeps it)',
        feel.row === 'Theme' && !feel.peeked && feel.during === feel.before && feel.after !== feel.before && feel.down.row === 'Theme' && feel.down.to !== feel.down.from
          && feel.click.on === 'Snowfall' && feel.click.shelf === 'theme-snow' && feel.again === 'Snowfall', JSON.stringify(feel).slice(0, 500));
      const mk = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), rows = () => [...document.querySelectorAll('#bss .bss-row')];
        Setup.open({ page: 'display' }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(600);
        // (1.78) the three actions live on their own page, Display → Custom themes
        const sub = rows().find(r => r.textContent.trim().startsWith('Custom themes')); if (sub) sub.click(); await w(600);
        const has = ['Make a theme from a picture', 'Open custom themes folder', 'Find themes again'].map(l => rows().some(r => r.textContent.trim().startsWith(l)));
        const row = rows().find(r => r.textContent.trim().startsWith('Make a theme from a picture'));
        if (row) row.click(); await w(300); if (row) row.click(); let saved = ''; for (let i = 0; i < 30; i++) { await w(200); saved = (await window.boxshelf.getConfig()).config.ui.theme; if (/^custom-picked/.test(saved)) break; }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); for (let i = 0; i < 20 && !document.querySelector('#bss .bss-tiles'); i++) await w(150);
        const tiles = [...document.querySelectorAll('#bss .bss-tiles .bss-tile span')].map(s => s.textContent);
        if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(800); }
        const body = [...document.body.classList].some(c => /^theme-custom-picked/.test(c));
        const c = (await window.boxshelf.getConfig()).config; c.ui.theme = 'spectrum'; await window.boxshelf.saveConfig(c); Shelf.setTheme(null);
        return { has, saved, newTile: tiles.some(n => /^Picked/.test(n)), body }; });
      check('Themes (Windows): Settings → Display → Custom themes has the three actions; Make a theme from a picture adds a tile and selects it',
        mk.has.every(Boolean) && /^custom-picked/.test(mk.saved) && mk.newTile && mk.body, JSON.stringify(mk));
      // (1.78) shorter Settings pages: Apps is one row per app (its own page holds the rest), the Wii remote has its own page,
      // and a row that only matters while its switch is on hides with it (Quit combo → Buttons to hold)
      const pages = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
        const names = () => [...document.querySelectorAll('#bss .bss-row .nm')].map(e => e.textContent), row = n => [...document.querySelectorAll('#bss .bss-row')].find(r => r.querySelector('.nm').textContent === n);
        const open = async p => { if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(800); } Setup.open({ page: p }); for (let i = 0; i < 40 && !document.querySelector('#bss.on .bss-row'); i++) await w(150); await w(600); };
        await open('apps'); out.apps = names(); const st = row('Stremio'); if (st) st.click(); await w(600); out.stremio = names();
        /* (beta.14, the Settings regroup) Controls keeps the Wii remote's page under More options */
        await open('pad'); out.pad = names(); const mo = row('More options'); if (mo) { mo.click(); await w(600); } out.more = names(); const wm = row('Wii remote'); if (wm) wm.click(); await w(600); out.wii = names();
        await open('pad'); const qc = row('Quit combo'); if (qc) qc.click(); await w(500); out.qcOff = names().includes('Buttons to hold');
        const qc2 = row('Quit combo'); if (qc2) qc2.click(); await w(500); out.qcOn = names().includes('Buttons to hold');
        if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(800); } return out; });
      check('Settings (Windows): Apps is a row per app with its own page; the Wii remote has its own page (Controls → More options); Quit combo off hides Buttons to hold',
        pages.apps.join() === 'Stremio,Nuvio' && pages.stremio.includes('Show Stremio') && pages.stremio.includes('Program') && pages.more.includes('Wii remote') && !pages.pad.includes('Pointer speed')
          && pages.wii.includes('Pointer speed') && pages.qcOff === false && pages.qcOn === true, JSON.stringify(pages).slice(0, 500));
      // (1.81) Quick menu → Customize → Theme feels like Settings' grid: named tiles five to a row; down moves a row within the
      // grid and leaves it only from the bottom row (to Sounds); a step recolours at once but the whole theme waits until you
      // stop; Back puts the saved theme back
      const qmg = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
        const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        const theme = () => [...document.body.classList].filter(c => /^theme-/.test(c)).join(' '), on = () => document.querySelector('#quickMenu .qm-opt.on');
        if (window.Settings && Settings.isOpen && Settings.isOpen()) { await Settings.close(); await w(800); }
        /* (beta.14) the shelf wears the saved theme first: the picked theme an earlier check made is gone from the list by now,
           and opening Look & sound no longer re-applies the theme you're on (it only previews a different one) */
        Shelf.setTheme(null); await w(600);
        document.getElementById('menuBtn').click(); await w(800);
        for (let i = 0; i < 12 && !/Customize|Look & sound/.test((document.querySelector('#quickMenu .qm-row.on') || {}).textContent || ''); i++) { key('ArrowDown'); await w(150); }
        key('Enter'); await w(700);
        const tiles = [...document.querySelectorAll('#quickMenu .qm-opt.sw')];
        out.tiles = tiles.length; out.named = tiles.filter(t => ((t.querySelector('.qm-swl') || {}).textContent || '') === t.title).length;
        out.cols = tiles.length ? getComputedStyle(tiles[0].parentElement).gridTemplateColumns.split(' ').length : 0;
        out.rows = new Set(tiles.map(t => t.offsetTop)).size;
        const s = on(); out.start = s && s.title; const top0 = s ? s.offsetTop : 0, before = theme(); out.before = before;
        key('ArrowDown'); await w(40); const d = on(); out.down = { k: d && d.dataset.k, lower: !!d && d.offsetTop > top0, name: d && d.title }; out.during = theme();
        await w(400); out.after = theme();
        let k = 'theme'; for (let i = 0; i < 14 && k === 'theme'; i++) { key('ArrowDown'); await w(60); k = (on() || {}).dataset ? on().dataset.k : ''; } out.leftTo = k;
        key('ArrowUp'); await w(60); out.backIn = (on() || {}).dataset ? on().dataset.k : '';
        key('Escape'); await w(400); out.restored = theme();
        key('Escape'); await w(500); return out; });
      check('Themes (Windows): Quick menu → Look & sound → Theme has every theme as named tiles four to a row; down moves a row (then on to Sound); the theme waits until you stop; Back restores it',
        qmg.tiles >= off.qm.length && qmg.named === qmg.tiles /* (≥: Make a theme from a picture above added its own) */ && qmg.cols === 4 && qmg.rows === Math.ceil(qmg.tiles / 4) && qmg.down.k === 'theme' && qmg.down.lower && qmg.during === qmg.before
          && qmg.after !== qmg.before && (qmg.leftTo === 'snd' || qmg.leftTo === 'fxkeep') /* (beta.14: Keep themes moving, Windows, may come next) */ && qmg.backIn === 'theme' && qmg.restored === qmg.before, JSON.stringify(qmg).slice(0, 500));
      check('Themes pass (Windows page): no script errors', !errors.length, errors.slice(0, 3).join(' | '));
    } catch (e) { check('Themes pass (Windows page) ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
    await ctx.close(); }
};
