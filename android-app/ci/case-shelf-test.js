// Device test pass "case shelf" (beta.14): the shelf's cases have each console's real shape and material.
//   1. STYLE (app.js + systems-extra.js): ratio (width / height) and depth (thickness / width) of a few consoles match the
//      case research (Genesis family 0.19 deep, Saturn / Sega CD long case, 3DS, DS, SNES / N64, Game Boy family).
//   2. Every case says what it is made of (pack): card box, jewel case, keep case or long case, explicit in systems-extra.js.
//   3. The shelf's material cues, static CSS on the slot that's already there (no extra element per case):
//      a card box prints edge to edge and is matte (no plastic rim, no glare band, no shine sweep); a jewel case has a
//      hinge strip down the spine side, the cover set in beside it; a keep case has a thin clear-sleeve lip at the spine.
//   4. Every shelf's selected case is the same handful of elements, whatever it's made of.
//   Screenshots (1920x1080 Windows page and the Thor-like 853x480 @2.25 Android page): case-<size>-<console>.png.
'use strict';
const path = require('path');

const WANT = { // research numbers (case-research.md, section 2): [ratio, depth]
  megadrive: [.72, .19], mastersystem: [.72, .19], sega32x: [.72, .19], saturn: [.696, .146], segacd: [.696, .146],
  n3ds: [1.107, .089], nds: [1.107, .111], snes: [1.40, .185], n64: [1.40, .185], nes: [.71, .21],
  gb: [1.0, .2], gbc: [1.0, .2], gba: [1.0, .2], gc: [.712, .105], psx: [1.136, .073], sw: [.612, .096]
};
const PACK = { snes: 'box', n64: 'box', nes: 'box', gba: 'box', gb: 'box', psx: 'jewel', dreamcast: 'jewel', pcengine: 'jewel',
  saturn: 'long', segacd: 'long', megadrive: 'keep', gc: 'keep', sw: 'keep', nds: 'keep', n3ds: 'keep' };
const SHOTS = ['gc', 'psx', 'snes', 'n64', 'megadrive', 'saturn', 'nds', 'n3ds', 'sw', 'gba'];
const Q = 'shelf=1&retro=1&wave2=1&cases=1';
// CASE_SHOTS_PLAIN=1 (a dev helper): the shots without the material cues, for a before / after of consoles whose size didn't change
const PLAIN = !!process.env.CASE_SHOTS_PLAIN;
const plain = page => PLAIN ? page.evaluate(() => document.querySelectorAll('#track .slot').forEach(s => s.classList.remove('pk-box', 'pk-jewel', 'pk-keep', 'pk-long'))).then(() => page.waitForTimeout(300)) : Promise.resolve();

module.exports = async function caseShelfPass({ browser, base, check, newPage, OUT }) {
  const errors = [];
  // walks the shelves (down) once round, calling at(id) on each one it lands on
  const walk = async (page, at) => {
    const cur = () => page.evaluate(() => { const f = Shelf.artFocus && Shelf.artFocus(); return f ? f.sys : null; });
    const first = await cur(), seen = new Set();
    for (let i = 0; i < 40; i++) {
      const id = await cur();
      if (id && !seen.has(id)) { seen.add(id); await page.waitForTimeout(900); await at(id); }
      await page.keyboard.press('ArrowDown');
      for (let t = 0; t < 30; t++) { await page.waitForTimeout(150); const n = await cur(); if (n !== id && !(await page.evaluate(() => window.BS_BUSY && BS_BUSY()))) break; }
      if (i > 0 && (await cur()) === first) break;
    }
    return seen;
  };
  // what the selected case is made of and how it's drawn
  const look = page => page.evaluate(() => {
    const s = document.querySelector('#track .slot.sel'); if (!s) return null;
    const f = s.querySelector('.f-front'), cf = getComputedStyle(f), ca = getComputedStyle(f, '::after');
    const pk = [...s.classList].find(c => /^pk-/.test(c)) || '';
    return { pk: pk.replace(/^pk-/, ''), els: s.querySelectorAll('*').length - s.querySelectorAll('.spine-img').length, faces: s.querySelectorAll('.face').length,
      padL: parseFloat(cf.paddingLeft), padR: parseFloat(cf.paddingRight), padT: parseFloat(cf.paddingTop), w: f.getBoundingClientRect().width,
      after: ca.backgroundImage, glare: getComputedStyle(s.querySelector('.glare')).display, sheen: getComputedStyle(s.querySelector('.sheen'), '::after').display };
  });

  // 1 + 2: the numbers
  let page, ctx;
  try {
    ({ ctx, page } = await (async () => { const c = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }); const p = await c.newPage();
      p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 200)); }); return { ctx: c, page: p }; })());
    await page.goto(base + '?platform=windows&' + Q);
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !document.querySelector('#splash') || getComputedStyle(document.querySelector('#splash')).opacity === '0' || document.querySelector('#splash').hidden, null, { timeout: 20000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(2500);
    const st = await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, Shelf.caseShape ? Shelf.caseShape(id) : null])), Object.keys(Object.assign({}, WANT, PACK)));
    const off = Object.entries(WANT).filter(([id, [r, d]]) => !st[id] || Math.abs(st[id].ratio - r) > .0015 || Math.abs(st[id].depth - d) > .0015).map(([id]) => id + ' ' + JSON.stringify(st[id]));
    check('Cases: each console\'s ratio and thickness match the case research (Genesis family 0.19 deep, Saturn / Sega CD long case 0.696 / 0.146, 3DS 1.107 / 0.089, DS 0.111, SNES / N64 1.40 / 0.185, Game Boy boxes square)', !off.length, off.join('; '));
    const wrongPack = Object.entries(PACK).filter(([id, p]) => !st[id] || st[id].pack !== p).map(([id, p]) => `${id}: ${st[id] && st[id].pack} (want ${p})`);
    // the bottom screen and the Art Studio get the same shape through bottomInfo (bottom.js draws a long case as a keep case)
    const bInfo = await page.evaluate(async () => { const i = Shelf.bottomInfo && await Shelf.bottomInfo(); return i && i.style ? { sys: i.system && i.system.id, ratio: i.style.ratio, depth: i.style.depth, pack: i.style.pack } : null; });
    check('Cases: the bottom screen\'s facts carry the same case shape as the shelf', bInfo && bInfo.ratio > 0 && bInfo.depth > 0 && !!bInfo.pack, JSON.stringify(bInfo));
    check('Cases: every case is a card box, jewel case, keep case or long case (explicit in systems-extra, so a thicker Saturn case stays a case, not a box)', !wrongPack.length, wrongPack.join('; '));

    // 3 + 4: the shelf, at TV size, with screenshots
    const seen = {};
    await walk(page, async id => { seen[id] = await look(page); if (SHOTS.includes(id)) { await plain(page); await page.screenshot({ path: path.join(OUT, `case-1920-${id}.png`) }).catch(() => {}); }
      if (id === 'snes' || id === 'gba') { await page.keyboard.press('f'); await page.waitForTimeout(1600); await page.screenshot({ path: path.join(OUT, `case-1920-${id}-back.png`) }).catch(() => {}); await page.keyboard.press('f'); await page.waitForTimeout(1000); } });
    const L = id => seen[id] || {};
    const box = L('snes'), jw = L('psx'), kp = L('gc'), lg = L('saturn'), md = L('megadrive');
    check('Shelf: a card box (SNES, N64, GBA) prints edge to edge and is matte: no border, no glare band, no shine sweep, no plastic rim',
      ['snes', 'n64', 'gba'].every(id => L(id).pk === 'box' && L(id).padL === 0 && L(id).padT === 0 && L(id).glare === 'none' && L(id).sheen === 'none' && !/255, 255, 255, 0\.16/.test(L(id).after)),
      JSON.stringify({ snes: box, n64: L('n64'), gba: L('gba') }).slice(0, 600));
    check('Shelf: a jewel case (PlayStation, Dreamcast) has the hinge strip on the spine side and its cover set in beside it',
      ['psx', 'dreamcast'].every(id => L(id).pk === 'jewel' && L(id).padL > L(id).padR * 2 && L(id).padL >= L(id).w * .05 && (L(id).after.match(/gradient/g) || []).length >= 4), JSON.stringify({ psx: jw, dc: L('dreamcast') }).slice(0, 600));
    check('Shelf: a keep case (GameCube, Switch, Genesis) and a long case (Saturn) keep their plastic and get the clear sleeve\'s lip at the spine',
      [kp, L('sw'), md, lg].every(x => (x.pk === 'keep' || x.pk === 'long') && x.glare !== 'none' && (x.after.match(/gradient/g) || []).length >= 3) && lg.pk === 'long', JSON.stringify({ gc: kp, sw: L('sw'), md, saturn: lg }).slice(0, 700));
    const sizes = [...new Set(Object.values(seen).filter(Boolean).map(x => x.els + '/' + x.faces))];
    check('Shelf: every case is the same few elements whatever it is made of (the cues are styles, not extra layers)', sizes.length === 1 && /\/8$/.test(sizes[0]), sizes.join(', '));
    check('Shelf: the walk reached every console with a shot', SHOTS.every(id => seen[id]), SHOTS.filter(id => !seen[id]).join(', '));
    await ctx.close();
  } catch (e) { check('Case shelf pass (TV size) ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e); try { await ctx.close(); } catch {} }

  // the Thor-sized Android page: same cues, screenshots
  try {
    const np = await newPage(browser, null); page = np.page; ctx = np.ctx;
    await page.goto(base + '?platform=android&' + Q);
    await page.waitForFunction(() => window.Shelf && Shelf._qs && Shelf._qs().g && Shelf.getMode() === 'browse', null, { timeout: 90000, polling: 250 });
    await page.waitForTimeout(2000);
    await page.waitForFunction(() => !document.querySelector('#splash') || getComputedStyle(document.querySelector('#splash')).opacity === '0' || document.querySelector('#splash').hidden, null, { timeout: 20000, polling: 250 }).catch(() => {});
    await page.waitForTimeout(2500);
    const seen = {};
    await walk(page, async id => { seen[id] = await look(page); if (SHOTS.includes(id)) { await plain(page); await page.screenshot({ path: path.join(OUT, `case-thor-${id}.png`) }).catch(() => {}); } });
    check('Shelf (Thor size, Android): card box, jewel and keep cues on their consoles', (seen.snes || {}).pk === 'box' && (seen.psx || {}).pk === 'jewel' && (seen.gc || {}).pk === 'keep' && (seen.snes || {}).glare === 'none',
      JSON.stringify({ snes: seen.snes, psx: seen.psx, gc: seen.gc }).slice(0, 500));
    check('Case shelf pass (Android page): no script errors', !np.errors.length, np.errors.slice(0, 3).join(' | '));
    await ctx.close();
  } catch (e) { check('Case shelf pass (Thor size) ran to the end', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e); try { await ctx.close(); } catch {} }
  check('Case shelf pass (Windows page): no script errors', !errors.length, errors.slice(0, 3).join(' | '));
};
