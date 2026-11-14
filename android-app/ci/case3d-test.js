// Device test pass "case 3D" (beta.14): Inspect's WebGL case and the museum peek are built by one shared builder
// (Inspect3D.kit.buildCase) with three case types: a moulded keep case, a CD jewel case and a printed card box.
//   1. The case type per console: keep (GameCube, PS2, Switch, 3DS, Genesis), jewel (PS1), card box (N64, SNES).
//   2. The manual sits like a real one: about 0.89 x 0.95 of a DVD case's panel, a few mm thick (a thin box, not a plane),
//      two tabs grip its edges; Switch / PS4 / PS5 cases have no manual at all.
//   3. Media at real size: a 120 mm disc is 0.89 of a DVD case's width (0.845 of a PS1 jewel case), a GameCube disc 0.59,
//      a Switch card 21 x 31 mm, a 3DS card 33 x 35 mm, an N64 cartridge landscape 116 x 75 mm.
//   4. Same or fewer draw calls than before (the hub rosette is one mesh of fingers, not ten).
//   5. The museum peek uses the same builder (its test hook reports the same case type).
// Screenshots: case3d-<console>-closed.png / -open.png (Inspect opened straight from the test, art drawn on a canvas).
'use strict';
const path = require('path');
module.exports = async function case3dPass({ browser, base, check, OUT }) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); });
  const out = {};
  try {
    await page.goto(base + '?shelf=1');
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse' && window.Inspect3D && window.BS3D, null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1200);
    // a case for a console, the way app.js openInspect() hands it over (the main consoles' STYLE / MEDIA copied here;
    // the extra shelves read from systems-extra.js, so a ratio change there is picked up)
    await page.evaluate(() => {
      const MAIN = {
        gc: { rc: .03, ratio: .712, depth: .105, edge: .022, caseColor: '#16161b', caseSide: '#0b0b0e', spineInk: '#e8e8f0', m: { kind: 'disc', size: .59 } },
        ps2: { rc: .035, ratio: .711, depth: .104, edge: .03, caseColor: '#0f1d55', caseSide: '#0a1440', spineInk: '#ffffff', m: { kind: 'disc', size: .889 } },
        ps4: { rc: .065, ratio: .787, depth: .089, edge: .03, caseColor: '#1d4ed8', caseSide: '#153a9e', spineInk: '#ffffff', m: { kind: 'disc', size: .889 } },
        sw: { rc: .06, ratio: .612, depth: .096, edge: .035, caseColor: '#d8101f', caseSide: '#a30a16', spineInk: '#ffffff', m: { kind: 'cart', size: .5 } },
        n3ds: { rc: .05, ratio: 1.127, depth: .1, edge: .03, caseColor: '#f4f4f6', caseSide: '#dcdde2', spineInk: '#3a3d45', m: { kind: 'cart', size: .5 } }
      };
      const art = (title, hue, w, h, page) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
        if (page) { x.fillStyle = '#f3efe6'; x.fillRect(0, 0, w, h); x.fillStyle = `hsl(${hue},60%,40%)`; x.fillRect(0, 0, w, h * .45); x.fillStyle = '#222'; x.font = `700 ${Math.round(w * .09)}px sans-serif`; x.textAlign = 'center'; x.fillText('INSTRUCTION', w / 2, h * .6); x.fillText('BOOKLET', w / 2, h * .7); }
        else { const g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, `hsl(${hue},70%,55%)`); g.addColorStop(1, `hsl(${hue + 60},60%,22%)`); x.fillStyle = g; x.fillRect(0, 0, w, h);
          x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `800 ${Math.round(Math.min(w, h) * .12)}px sans-serif`; x.textAlign = 'center'; x.fillText(title, w / 2, h * .5); }
        return c.toDataURL('image/jpeg', .85); };
      window.__case3d = { open(sys) {
        const ex = (window.BS_SYSTEMS_EXTRA || {}), s = MAIN[sys] || ex.style[sys], m = MAIN[sys] ? MAIN[sys].m : ex.media[sys];
        const hue = [...sys].reduce((a, ch) => a + ch.charCodeAt(0) * 7, 0) % 360, W = 300, H = Math.round(300 / s.ratio);
        const o = { sys, rc: s.rc || .04, ratio: s.ratio, depth: s.depth, caseColor: s.caseColor, caseSide: s.caseSide, spineInk: s.spineInk || '#fff', edge: s.edge || 0, wrap: !!s.wrap, pack: s.pack,
          title: sys.toUpperCase() + ' GAME', kind: m.kind, form: m.form || '', size: m.size, front: art(sys.toUpperCase(), hue, W, H), back: art('BACK', hue + 120, W, H), spine: null, disc: null,
          manual: art('', hue, 240, 340, true), from: null };
        const el = document.getElementById('inspect'); el.classList.add('gl', 'on'); document.getElementById('app').classList.add('inspecting');
        const ok = Inspect3D.open(o); Inspect3D.setPose(-10, -28, .9, 0, 0, false); return ok; } };
    });
    const SYS = ['gc', 'ps2', 'psx', 'n64', 'snes', 'nds', 'n3ds', 'sw', 'megadrive', 'ps4'];
    const shown = () => page.waitForFunction(() => Inspect3D._st().phase === 'shown', null, { timeout: 60000, polling: 200 }).catch(() => {});
    const settle = async () => { for (let i = 0; i < 80; i++) { const s = await page.evaluate(() => Inspect3D._st()); if (s.lid == null) { await page.waitForTimeout(4000); break; } if (Math.abs(s.lid - s.lidT) < .003) break; await page.waitForTimeout(250); } await page.waitForTimeout(400); };
    for (const sys of SYS) {
      const ok = await page.evaluate(s => window.__case3d.open(s), sys); if (!ok) { out[sys] = { err: 'no WebGL' }; continue; }
      await shown(); await page.evaluate(() => Inspect3D.setPose(-10, -28, .9, 0, 0, false)); await settle();
      out[sys] = { closed: await page.evaluate(() => Inspect3D._st()) };
      await page.screenshot({ path: path.join(OUT, `case3d-${sys}-closed.png`) });
      await page.evaluate(() => { Inspect3D.setState(1); Inspect3D.setPose(-6, -18, .9, 0, 0, false); }); await page.waitForTimeout(300); await settle();
      out[sys].open = await page.evaluate(() => Inspect3D._st());
      await page.screenshot({ path: path.join(OUT, `case3d-${sys}-open.png`) });
      // Y: the manual slides out from under its tabs (Inspect pauses once it has)
      await page.evaluate(() => Inspect3D.setPaused(true)); await page.waitForTimeout(900);
      await page.waitForFunction(() => (Inspect3D._st().manSlide || 0) > .95, null, { timeout: 10000, polling: 250 }).catch(() => {}); /* (GitHub draws in software, as slowly as a frame a second: wait for the slide to finish) */
      out[sys].slid = await page.evaluate(() => Inspect3D._st()); await page.evaluate(() => Inspect3D.setPaused(false)); await page.waitForTimeout(300);
      await page.evaluate(() => { Inspect3D.setState(0); Inspect3D.close(); }); await page.waitForTimeout(300);
    }
    // the museum: pick the GameCube case up (X opens it in your hands): the shared builder's keep case, its booklet and disc
    out.mus = await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)), o = {};
      document.getElementById('inspect').classList.remove('gl', 'on'); document.getElementById('app').classList.remove('inspecting');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true })); for (let i = 0; i < 80 && Shelf.getMode() !== 'museum'; i++) await w(250); await w(3000);
      for (let i = 0; i < 6 && Museum._dv && Museum._dv(); i++) { Museum.skipDelivery(); await w(800); }
      Museum.setRow(0); await w(800); const c = Museum.current() || {}; o.game = !!c.game; o.title = c.game && c.game.title;
      // (the room fills its shelves first, and may open on the wide view: skip the fill, step into the row)
      for (let i = 0; i < 8 && !o.x; i++) { if (Museum.isFilling && Museum.isFilling()) { Museum.skipFill(); await w(1200); continue; } if (Museum.isWide && Museum.isWide()) { Museum.activate(); await w(1500); continue; } o.x = Museum.handX(); if (!o.x) await w(1000); }
      if (o.x && o.x.wrapped) { Museum.unwrapHeld(); await w(2600); o.x2 = Museum.handX(); } // a sealed game: unwrap it first
      o.state = { filling: Museum.isFilling && Museum.isFilling(), wide: Museum.isWide && Museum.isWide(), holding: Museum.isHolding() }; for (let i = 0; i < 40 && !(Museum._peek() && Museum._peek().k > .95); i++) await w(250);
      o.peek = Museum._peek(); return o; }).catch(e => ({ err: e.message }));
    await page.waitForTimeout(800); await page.screenshot({ path: path.join(OUT, 'case3d-museum-gc-open.png') });
    await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms)); for (let i = 0; i < 4 && Museum.isHolding(); i++) { Museum.back(); await w(900); } }).catch(() => {});
    // the shared builder: the case type per console as the museum asks for it
    out.kit =await page.evaluate(() => !!(Inspect3D.kit && Inspect3D.kit.buildCase && Inspect3D.kit.caseSpec));
    out.specs = await page.evaluate(() => Inspect3D.kit.caseSpec ? ['gc', 'psx', 'n64', 'sw', 'ps5', 'snes', 'nes', 'dreamcast', 'megadrive', 'gba'].map(s => { const c = Inspect3D.kit.caseSpec(s); return { s, pack: c.pack, man: !!c.man }; }) : null).catch(() => null);
  } catch (e) { out.err = e.message; }
  await ctx.close();
  const cs = s => ((out[s] || {}).open || {}).cs || {};
  const near = (a, b, t) => a != null && Math.abs(a - b) <= t;
  check('Case 3D: the case type per console (keep: GameCube, PS2, Switch, 3DS, Genesis; jewel: PS1; card box: N64, SNES)',
    ['gc', 'ps2', 'sw', 'n3ds', 'megadrive', 'nds'].every(s => cs(s).pack === 'keep') && cs('psx').pack === 'jewel' && cs('n64').pack === 'box' && cs('snes').pack === 'box',
    JSON.stringify(Object.fromEntries(Object.keys(out).filter(k => out[k] && out[k].open).map(k => [k, cs(k).pack]))) + (out.err || ''));
  check('Case 3D: a DVD-size manual is about 0.89 x 0.95 of the panel and a few mm thick (a box, not a plane), held by two tabs',
    near(cs('gc').manW, .89, .03) && near(cs('gc').manH, .95, .03) && cs('gc').manT > .005 && cs('gc').manT < .02 && cs('gc').tabs === 2 && near(cs('ps2').manW, .89, .03),
    JSON.stringify({ gc: cs('gc'), ps2: cs('ps2') }));
  check('Case 3D: no manual in a Switch or PS4 case', cs('sw').man === false && cs('ps4').man === false && cs('gc').man === true, JSON.stringify({ sw: cs('sw'), ps4: cs('ps4') }));
  check('Case 3D: media at real size (120 mm disc 0.889 of a DVD case, 0.845 of a PS1 jewel case; GameCube 0.593; Switch card 21 x 31 mm; 3DS card 33 x 35 mm; N64 cart landscape 116 x 75 mm)',
    near(cs('ps2').discW, .889, .01) && near(cs('psx').discW, .845, .01) && near(cs('gc').discW, .593, .01) && near(cs('sw').mediaMm && cs('sw').mediaMm[0], 21, 1) && near(cs('sw').mediaMm && cs('sw').mediaMm[1], 31, 1)
      && near(cs('n3ds').mediaMm && cs('n3ds').mediaMm[0], 33, 1) && near(cs('n64').mediaMm && cs('n64').mediaMm[0], 116, 2) && near(cs('n64').mediaMm && cs('n64').mediaMm[1], 75, 2),
    JSON.stringify({ ps2: cs('ps2').discW, psx: cs('psx').discW, gc: cs('gc').discW, sw: cs('sw').mediaMm, n3ds: cs('n3ds').mediaMm, n64: cs('n64').mediaMm }));
  // (before: every case was 25 meshes, 26 draws: the hub rosette alone was 13 meshes)
  check('Case 3D: fewer draw calls than before (a keep case at most 18 meshes / 20 draws, was 25 / 26; a card box and a jewel case no more)',
    ['gc', 'ps2', 'sw', 'n3ds', 'megadrive', 'n64', 'snes', 'psx', 'ps4'].every(s => cs(s).meshes > 0 && cs(s).meshes <= 18 && cs(s).draws <= 20),
    JSON.stringify(Object.fromEntries(['gc', 'ps2', 'sw', 'n3ds', 'megadrive', 'n64', 'snes', 'psx', 'ps4'].map(s => [s, [cs(s).meshes, cs(s).draws]]))));
  check('Case 3D: Y slides the manual out from under its tabs before Inspect pauses (a card box slides its manual out too)',
    ((out.gc || {}).slid || {}).manSlide > .9 && ((out.n64 || {}).slid || {}).manSlide > .9, JSON.stringify({ gc: (out.gc || {}).slid && out.gc.slid.manSlide, n64: (out.n64 || {}).slid && out.n64.slid.manSlide }));
  check('Case 3D: the museum builds its case with the same kit (case types match)', out.kit && Array.isArray(out.specs) && out.specs.find(x => x.s === 'n64').pack === 'box' && out.specs.find(x => x.s === 'psx').pack === 'jewel' && !out.specs.find(x => x.s === 'ps5').man,
    JSON.stringify(out.specs));
  const mp = (out.mus || {}).peek || {};
  check('Case 3D: the museum opens the GameCube case in your hands from the shared builder (keep case, real-size booklet held by two tabs, 8 cm disc)',
    mp.pack === 'keep' && mp.info && mp.info.man && Math.abs(mp.info.manW - .889) < .03 && mp.info.tabs === 2 && Math.abs(mp.discW - .593) < .02 && mp.k > .9, JSON.stringify(out.mus));
  check('Case 3D pass: no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
