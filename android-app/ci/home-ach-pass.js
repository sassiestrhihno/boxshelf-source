// Device test pass "home-ach" (beta.14), run by web-device-test.js (windows group). Checks results, never speed.
//   main/homeach.js with pretend sources (plain Node): the item is offered only for a game that has achievements
//   (RetroAchievements set, Xenia / RPCS3 data), RetroAchievements is never asked for an answer older than the game.
//   renderer/achgroup.js: the shelf's grouping (trophy shelf, Story / Missable / Everything else, rarity tiers), shared
//   with app.js.
//   The Home menu page (renderer/home.html) over a game: Achievements sits before Power only when main says the game has
//   some (also when that answer comes after the menu opened); choosing it shows the shelf's layout: tabs, the trophy shelf
//   of unlocked badges first, then the sections; it opens on the first locked badge; the D-pad moves between badges and the
//   card shows the selected one's text; Y sorts by rarity (the selection stays); LB / RB and tapped tabs switch tabs; badges
//   further down wait until they scroll near; B goes back to the menu on Achievements; Home closes; an error offers Try
//   again (A asks again); Xbox 360 (drawn trophies, gamerscore) and PS3 (Trophies, grades) fit.
'use strict';
const path = require('path'), fs = require('fs'), vm = require('vm');

module.exports = async function homeAchPass({ browser, base, check, newPage, OUT }) {
  // ---------- main/homeach.js (plain Node, pretend sources) ----------
  try {
    const homeach = require(path.join(__dirname, '..', '..', 'main', 'homeach.js'));
    const calls = [];
    const P = (n, got) => ({ title: 'Game', total: n, earned: got, points: n * 5, pointsEarned: got * 5, unit: 'G', achievements: Array.from({ length: n }, (_, i) => ({ id: i, title: 'A' + i, desc: 'd', points: 5, badge: i ? 'C:\\no\\path.png' : 'https://media.retroachievements.org/Badge/1.png', earned: i < got, date: i < got ? '2026-01-0' + (i + 1) : null, rarity: i === 0 ? 4 : undefined })) });
    homeach.init({
      ra: { enabled: () => true, CONSOLE_ID: { snes: 3 }, hasSet: async (s, t) => (t === 'Has Set' ? { id: 1, count: 3 } : null), progress: async (s, t, force, maxAge) => { calls.push({ t, force, maxAge }); return Object.assign(P(3, 1), { unit: undefined }); } },
      xeniaach: { progress: async (exe, tid) => (tid === '4D5307E6' ? P(2, 2) : null) }, xeniaExe: () => 'xenia.exe',
      rpcs3troph: { progress: async () => null }, rpcs3Exe: () => null,
      game: (sys, file) => ({ 'a.sfc': { title: 'Has Set', file: 'a.sfc' }, 'b.sfc': { title: 'No Set', file: 'b.sfc' }, 'h.iso': { title: 'Halo', titleId: '4D5307E6', file: 'h.iso' }, 'z.iso': { title: 'Zed', titleId: '41560000', file: 'z.iso' } })[file] || null
    });
    const s = { startedAt: Date.now() - 30000 };
    const a1 = await homeach.available({ systemId: 'snes', file: 'a.sfc' }, s), a2 = await homeach.available({ systemId: 'snes', file: 'b.sfc' }, {});
    const a3 = await homeach.available({ systemId: 'x360', file: 'h.iso' }, {}), a4 = await homeach.available({ systemId: 'x360', file: 'z.iso' }, {});
    const a5 = await homeach.available({ systemId: 'ps3', file: 'p.iso' }, {}), a6 = await homeach.available({ systemId: 'media', file: 'x' }, {});
    check('Home menu Achievements (main): offered for a RetroAchievements game with a set and an Xbox 360 game Xenia has data for; not for one without, nor PS3 without RPCS3, nor an app',
      a1.on === true && a1.src === 'RetroAchievements' && a2.on === false && a3.on === true && a3.src === 'Xenia' && a4.on === false && a5.on === false && a6.on === false, JSON.stringify({ a1, a2, a3, a4, a5, a6 }));
    const l1 = await homeach.list({ systemId: 'snes', file: 'a.sfc' }, false, s), l2 = await homeach.list({ systemId: 'snes', file: 'a.sfc' }, true, s);
    check('Home menu Achievements (main): RetroAchievements is asked for nothing older than the game (at most 2 min), Try again forces it; the list comes back trimmed (rarity kept)',
      calls.length === 2 && calls[0].maxAge > 0 && calls[0].maxAge <= 31000 && calls[0].force === false && calls[1].force === true && l1 && l1.total === 3 && l1.unit === 'points' && l1.achievements[0].badge.startsWith('https:') && l1.achievements[1].badge === '' && l1.achievements[0].rarity === 4 && l1.achievements[1].rarity === null && l2 && l2.src === 'RetroAchievements',
      JSON.stringify({ calls, l1: l1 && { total: l1.total, unit: l1.unit, b: l1.achievements.map(a => a.badge), r: l1.achievements.map(a => a.rarity) } }));
  } catch (e) { check('Home menu Achievements: main/homeach.js ran', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }

  // ---------- renderer/achgroup.js: the shelf's grouping (shared by app.js and home.js) ----------
  try {
    const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'achgroup.js'), 'utf8'), sb);
    const AG = sb.window.AchGroup;
    const L = [{ title: 'old', earned: true, date: '2026-01-01' }, { title: 'new', earned: true, date: '2026-02-01' }, { title: 'story', type: 'progression', rarity: 50 }, { title: 'win', type: 'win_condition', rarity: 5 },
      { title: 'miss', type: 'missable', rarity: 1 }, { title: 'plain', rarity: 20 }, { title: 'none' }].map(a => Object.assign({ points: 5, earned: false }, a));
    const lab = S => S.map(s => s.label + ':' + s.items.map(a => a.title).join('/')).join(' | ');
    const order = lab(AG.sections(L, 'all', 'order')), rare = lab(AG.sections(L, 'all', 'rarity')), got = lab(AG.sections(AG.filtered(L, 'got'), 'got', 'order'));
    const app = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'app.js'), 'utf8'), idx = fs.readFileSync(path.join(__dirname, '..', '..', 'renderer', 'index.html'), 'utf8');
    check('Achievements grouping (achgroup.js): the trophy shelf (newest first), then Story / Missable / Everything else; Rarity in tiers; the shelf\'s screen uses the same functions',
      order === 'Your trophies:new/old | Story:story/win | Missable:miss | Everything else:plain/none' && rare === 'Your trophies:new/old | Ultra rare:miss | Rare:win | Uncommon:plain | Common:story | No rarity yet:none' && got === 'Unlocked:old/new'
      && /achSections=list=>AchGroup\.sections\(list,ach\.filter,ach\.sort\)/.test(app) && idx.indexOf('src="achgroup.js"') > 0 && idx.indexOf('src="achgroup.js"') < idx.indexOf('src="app.js"'), JSON.stringify({ order, rare, got }));
  } catch (e) { check('Achievements grouping: achgroup.js ran', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }

  // ---------- the Home menu page over a game ----------
  const init = 'window.home = { onOpen(f) { window.__hOpen = f; }, onButton(f) { window.__hBtn = f; }, onToast() {}, onPaused() {}, onAch(f) { window.__hAch = f; },'
    + ' achList(force) { (window.__achCalls = window.__achCalls || []).push(!!force); return window.__achNext ? window.__achNext(force) : Promise.resolve(window.__achData || null); },'
    + ' act(a) { (window.__hActs = window.__hActs || []).push(a); } };';
  const { ctx, page, errors } = await newPage(browser, init);
  try {
    await page.setViewportSize({ width: 1280, height: 720 }); // (a TV-sized window: the wall's rows are laid out as over a game)
    await page.goto(base.replace(/index\.html$/, 'home.html'));
    await page.waitForFunction(() => typeof window.__hOpen === 'function' && !!window.AchGroup, null, { timeout: 30000, polling: 200 });
    const r = await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), out = {};
      const names = () => [...document.querySelectorAll('#items .item')].map(e => (e.querySelector('span') || {}).textContent || '');
      const btn = async (b, n = 1) => { for (let i = 0; i < n; i++) { window.__hBtn({ btn: b, down: true }); await w(40); window.__hBtn({ btn: b, down: false }); await w(40); } };
      const show = async extra => { window.__hActs = []; window.__hOpen(Object.assign({ inGame: true, title: 'Pretend Quest', system: 'Super Nintendo', actions: ['resume', 'save', 'load', 'shot', 'power', 'quit'], power: ['sleep', 'restart', 'shutdown'], confirmButton: 'a', startedAt: Date.now() - 60000, reduceMotion: true }, extra || {})); await w(350); };
      const selT = () => document.querySelector('.ach.sel'), selI = () => { const t = selT(); return t ? +t.dataset.i : -1; };
      const cardT = () => (document.querySelector('#achCard .ach-card-t') || {}).textContent || '';
      const secs = () => [...document.querySelectorAll('.ach-sec')].map(e => e.firstChild.textContent);
      const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
      const TYPE = { 1: 'progression', 2: 'progression', 4: 'win_condition', 5: 'missable', 7: 'missable' };
      const list = n => Array.from({ length: n }, (_, i) => ({ id: i, title: 'Badge ' + i, desc: 'Do thing number ' + i, points: 5 + i, badge: GIF, type: TYPE[i] || '', rarity: i * 1.5, earned: i % 3 === 0, date: i % 3 === 0 ? '2026-0' + (1 + (i % 9)) + '-1' + (i % 10) + ' 10:00:00' : null }));
      // a game without achievements: no item; with some, before Power
      await show(); out.none = names();
      await show({ ach: true, achSrc: 'RetroAchievements' }); out.withAch = names();
      // the answer comes after the menu opened: the item joins, the selection stays on what it was on
      await show(); await btn('down', 4); out.selBefore = (document.querySelector('#items .item.sel span') || {}).textContent;
      window.__hAch({ ach: true, achLabel: 'Achievements', achSrc: 'RetroAchievements' }); await w(100); out.late = names(); out.selAfter = (document.querySelector('#items .item.sel span') || {}).textContent;
      // choose it: loading, then the shelf's layout
      const n = 60, data = window.__achData = { src: 'RetroAchievements', unit: 'points', title: 'Pretend Quest', total: n, earned: 20, points: 0, pointsEarned: 0, mastered: null, achievements: list(n) };
      data.points = data.achievements.reduce((s, a) => s + a.points, 0); data.pointsEarned = data.achievements.filter(a => a.earned).reduce((s, a) => s + a.points, 0);
      let release; window.__achNext = () => new Promise(res => { release = () => res(window.__achData); });
      await show({ ach: true, achSrc: 'RetroAchievements' }); window.__achCalls = [];
      await btn('down', names().indexOf('Achievements')); await btn('a'); await w(100);
      out.loading = (document.querySelector('.ach-msg') || {}).textContent || ''; window.__achNext = null; release(); await w(400);
      out.inAch = document.body.classList.contains('in-ach'); out.head = (document.querySelector('#items .subhead') || {}).textContent;
      out.sum = (document.querySelector('.ach-sum') || {}).textContent || '';
      out.tabs = [...document.querySelectorAll('.ach-tab')].map(e => e.textContent); out.tabOn = (document.querySelector('.ach-tab.on') || {}).textContent;
      out.secs = secs(); out.secCounts = [...document.querySelectorAll('.ach-sec em')].map(e => e.textContent);
      const wall = document.getElementById('achWall');
      out.shelfFirst = !!wall.firstElementChild && wall.firstElementChild.classList.contains('ach-sec') && wall.children[1] && wall.children[1].classList.contains('ach-shelf');
      out.shelfAllUnlocked = [...document.querySelectorAll('.ach-shelf .ach')].length === 20 && ![...document.querySelectorAll('.ach-shelf .ach')].some(e => e.classList.contains('locked'));
      { const t0 = document.querySelector('.ach-shelf .ach'); out.shelfNewest = t0 ? t0.getAttribute('aria-label') : ''; }
      out.tiers = document.querySelectorAll('.ach[data-tier]').length; out.miss = document.querySelectorAll('.ach.miss').length;
      // it opens on the first locked badge (the next to go for), with the card
      out.first = { i: selI(), card: cardT(), d: (document.querySelector('#achCard .ach-card-d') || {}).textContent, facts: (document.querySelector('#achCard .ach-facts') || {}).textContent, tag: (document.querySelector('#achCard .ach-tags') || {}).textContent };
      out.lazy = { loaded: [...wall.querySelectorAll('.ach img')].filter(i => i.getAttribute('src')).length, waiting: [...wall.querySelectorAll('.ach img')].filter(i => i.dataset.src).length };
      out.foot = (document.getElementById('foot') || {}).textContent || '';
      // right: the next badge; down: the row below (nearest across); up twice: back on the trophy shelf
      await btn('right'); out.right = { i: selI(), card: cardT() };
      const y0 = selT().offsetTop; await btn('down'); out.down = { i: selI(), lower: selT().offsetTop > y0 + 10, card: cardT() };
      await btn('down', 6); await w(300); const s = selT(), wr = wall.getBoundingClientRect(), sr = s.getBoundingClientRect(); out.scrolled = wall.scrollTop > 0; out.inView = sr.top >= wr.top - 6 && sr.bottom <= wr.bottom + 6;
      out.lazyAfter = [...wall.querySelectorAll('.ach img')].filter(i => i.getAttribute('src')).length;
      await btn('up', 12); await w(200); out.upShelf = { i: selI(), onShelf: !!selT().closest('.ach-shelf'), card: cardT(), when: (document.querySelector('#achCard .ach-when') || {}).textContent };
      // Y: by rarity; the badge you were on stays selected
      await btn('down'); await btn('right', 2); const keep = cardT(); await btn('y'); await w(100);
      out.sort = { secs: secs(), card: cardT(), keep, foot: (document.getElementById('foot') || {}).textContent };
      await btn('y', 2); out.sortBack = secs();
      // RB: the Unlocked tab; a tapped tab: Locked
      await btn('rb'); out.got = { on: (document.querySelector('.ach-tab.on') || {}).textContent, n: document.querySelectorAll('.ach').length, locked: document.querySelectorAll('.ach.locked').length, secs: secs() };
      const lt = document.querySelector('.ach-tab[data-tab="locked"]'); if (lt) lt.click(); await w(100);
      out.locked = { on: (document.querySelector('.ach-tab.on') || {}).textContent, n: document.querySelectorAll('.ach').length, unlocked: document.querySelectorAll('.ach:not(.locked)').length };
      await btn('lb', 2); out.allAgain = (document.querySelector('.ach-tab.on') || {}).textContent;
      // a tap on a badge selects it and the card follows
      const tap = document.querySelectorAll('.ach')[3]; tap.click(); await w(100); out.tap = { i: selI(), card: cardT(), want: (tap.getAttribute('aria-label') || '').split(',')[0] };
      // B: back to the menu's list, on Achievements, nothing closed
      await btn('b'); await w(100); out.back = { inAch: document.body.classList.contains('in-ach'), sel: (document.querySelector('#items .item.sel span') || {}).textContent, acts: (window.__hActs || []).slice() };
      // again: then Home closes as usual
      await btn('a'); await w(300); out.again = document.querySelectorAll('.ach').length; await btn('home'); await w(100); out.homeActs = (window.__hActs || []).slice();
      // an error: Try again (A) asks again, forced
      window.__achNext = () => Promise.reject(new Error('RetroAchievements did not answer.'));
      await show({ ach: true, achSrc: 'RetroAchievements' }); window.__achCalls = []; await btn('down', names().indexOf('Achievements')); await btn('a'); await w(200);
      out.err = (document.querySelector('.ach-msg.err') || {}).textContent || ''; out.errFoot = (document.getElementById('foot') || {}).textContent || '';
      window.__achNext = null; window.__achData = { src: 'Xenia', unit: 'G', title: 'Halo', total: 2, earned: 1, points: 30, pointsEarned: 10, achievements: [{ id: 1, title: 'Got', desc: '', points: 10, badge: '', earned: true, date: '2026-02-01T10:00:00Z' }, { id: 2, title: 'Not yet', desc: '', points: 20, badge: '', earned: false, date: null }] };
      await btn('a'); await w(300); out.calls = (window.__achCalls || []).slice();
      out.x360 = { sum: (document.querySelector('.ach-sum') || {}).textContent || '', card: cardT(), facts: (document.querySelector('#achCard .ach-facts') || {}).textContent, drawn: [...document.querySelectorAll('.ach img')].every(i => /^data:image\/svg/.test(i.getAttribute('src') || '')) };
      // the foot's Back prompt, tapped
      const fb = document.querySelector('#foot [data-b="b"]'); if (fb) fb.click(); await w(100); out.footBack = !document.body.classList.contains('in-ach') && (window.__hActs || []).length === 0;
      // PS3: "Trophies", the grades summary, each trophy's grade on the card
      window.__achData = { src: 'RPCS3', unit: 'trophy', title: 'Pretend', total: 2, earned: 1, points: 105, pointsEarned: 90, grades: 'Gold 1/1 · Silver 0/0 · Bronze 0/1', achievements: [{ id: 1, title: 'Gold one', points: 90, grade: 'Gold', type: 'gold', badge: '', earned: true, date: '2026-03-01T00:00:00Z' }, { id: 2, title: 'Bronze one', points: 15, grade: 'Bronze', type: 'bronze', badge: '', earned: false }] };
      await show({ ach: true, achLabel: 'Trophies', achSrc: 'RPCS3', glyphs: 'ps' }); out.ps3Item = names().includes('Trophies'); await btn('down', names().indexOf('Trophies')); await btn('a'); await w(300);
      out.ps3 = { head: (document.querySelector('#items .subhead') || {}).textContent, sum: (document.querySelector('.ach-sum') || {}).textContent || '', card: cardT(), facts: (document.querySelector('#achCard .ach-facts') || {}).textContent, tag: (document.querySelector('#achCard .ach-tags') || {}).textContent, foot: (document.getElementById('foot') || {}).textContent };
      // the shelf version never has it
      window.__hOpen({ inGame: false, title: 'Home', system: 'Boxshelf', actions: ['shelfhome', 'museum', 'settings', 'power'], power: ['sleep'], ach: true, confirmButton: 'a' }); await w(300); out.shelf = names();
      return out; });
    check('Home menu over a game: no Achievements for a game without any; with some, Achievements sits before Power',
      r.none.join() === 'Resume,Save state,Load state,Screenshot,Power,Quit to shelf' && r.withAch.join() === 'Resume,Save state,Load state,Screenshot,Achievements,Power,Quit to shelf', JSON.stringify({ none: r.none, withAch: r.withAch }));
    check('Home menu: an Achievements answer that comes after the menu opened adds the item, and the selection stays where it was',
      r.late.includes('Achievements') && r.selBefore === 'Power' && r.selAfter === 'Power', JSON.stringify({ late: r.late, b: r.selBefore, a: r.selAfter }));
    check('Home menu Achievements: a loading line, then the shelf\'s layout: tabs with counts, the trophy shelf of unlocked badges first, then Story / Missable / Everything else, rarity rims, the summary',
      /Loading from RetroAchievements/.test(r.loading) && r.inAch && r.head === 'Achievements' && r.tabs.join() === 'All60,Unlocked20,Locked40' && r.tabOn === 'All60'
      && r.secs.join() === 'Your trophies,Story,Missable,Everything else' && r.secCounts.join() === '20,3,2,35' && r.shelfFirst && r.shelfAllUnlocked && /^Badge 6,/.test(r.shelfNewest || '') && r.tiers === 60 && r.miss === 2
      && /20 of 60 unlocked/.test(r.sum) && /points/.test(r.sum) && /RetroAchievements/.test(r.sum),
      JSON.stringify({ loading: r.loading, head: r.head, tabs: r.tabs, secs: r.secs, counts: r.secCounts, shelfFirst: r.shelfFirst, shelfAll: r.shelfAllUnlocked, newest: r.shelfNewest, tiers: r.tiers, miss: r.miss, sum: r.sum }));
    check('Home menu Achievements: it opens on the first locked badge, and the card shows its full title, description, points, players and status',
      r.first.i === 20 && r.first.card === 'Badge 1' && r.first.d === 'Do thing number 1' && /Points6/.test(r.first.facts) && /Players1\.5%/.test(r.first.facts) && /StatusLocked/.test(r.first.facts) && r.first.tag === 'Story', JSON.stringify(r.first));
    check('Home menu Achievements: the D-pad moves between badges (right: the next; down: the row below; up: back to the trophy shelf) and the card follows; the wall scrolls to keep it in view',
      r.right.i === 21 && r.right.card === 'Badge 2' && r.down.lower && r.down.card !== r.right.card && r.scrolled && r.inView && r.upShelf.onShelf && r.upShelf.i < 20 && /^Unlocked /.test(r.upShelf.when || ''),
      JSON.stringify({ right: r.right, down: r.down, scrolled: r.scrolled, inView: r.inView, up: r.upShelf }));
    check('Home menu Achievements: badges further down wait until they scroll near (lazy), and load as the wall scrolls',
      r.lazy.waiting > 0 && r.lazy.loaded > 0 && r.lazyAfter > r.lazy.loaded, JSON.stringify({ lazy: r.lazy, after: r.lazyAfter }));
    check('Home menu Achievements: Y sorts by rarity (tiers as on the shelf), the selected badge stays selected; Y again goes on to Points, then back to Order',
      r.sort.secs[0] === 'Your trophies' && r.sort.secs.includes('Rare') && r.sort.secs.includes('Common') && !r.sort.secs.includes('Story') && r.sort.card === r.sort.keep && /Sort: Rarity/.test(r.sort.foot) && /Y/.test(r.foot) && r.sortBack.join() === 'Your trophies,Story,Missable,Everything else',
      JSON.stringify({ sort: r.sort, back: r.sortBack }));
    check('Home menu Achievements: RB shows the Unlocked tab, a tapped tab shows Locked, LB goes back to All; a tapped badge is selected and on the card',
      /^Unlocked/.test(r.got.on || '') && r.got.n === 20 && r.got.locked === 0 && /^Locked/.test(r.locked.on || '') && r.locked.n === 40 && r.locked.unlocked === 0 && /^All/.test(r.allAgain || '') && r.tap.i === 3 && r.tap.card === r.tap.want,
      JSON.stringify({ got: r.got, locked: r.locked, all: r.allAgain, tap: r.tap }));
    check('Home menu Achievements: B goes back to the menu on Achievements (nothing closed); Home closes as usual (Resume)',
      r.back.inAch === false && r.back.sel === 'Achievements' && r.back.acts.length === 0 && r.again === 60 && r.homeActs.join() === 'resume', JSON.stringify({ back: r.back, again: r.again, home: r.homeActs }));
    check('Home menu Achievements: an error says so and offers Try again; A asks again (forced)',
      /didn't load/.test(r.err) && /did not answer/.test(r.err) && /Try again/.test(r.errFoot) && r.calls.join() === 'false,true', JSON.stringify({ err: r.err, foot: r.errFoot, calls: r.calls }));
    check('Home menu Achievements: Xbox 360 (Xenia) shows gamerscore and the drawn trophies; the Back prompt can be tapped',
      /1 of 2 unlocked/.test(r.x360.sum) && /10 \/ 30 G/.test(r.x360.sum) && r.x360.card === 'Not yet' && /Gamerscore20 G/.test(r.x360.facts) && r.x360.drawn && r.footBack, JSON.stringify({ x: r.x360, fb: r.footBack }));
    check('Home menu Achievements: PS3 (RPCS3) is "Trophies" with the grades summary and each trophy\'s grade; PlayStation prompts',
      r.ps3Item && r.ps3.head === 'Trophies' && /Gold 1\/1/.test(r.ps3.sum) && r.ps3.card === 'Bronze one' && /GradeBronze/.test(r.ps3.facts) && r.ps3.tag === 'Bronze' && /△Sort/.test(r.ps3.foot) && /L1R1Tabs/.test(r.ps3.foot), JSON.stringify(r.ps3));
    check('Home menu on the shelf: never an Achievements item', !r.shelf.includes('Achievements') && r.shelf.length === 4, JSON.stringify(r.shelf));
    check('Home menu Achievements page: no errors', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) { check('Home menu Achievements: the page ran', false, e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e); }
  // a picture of the layout (side panel, then the centred card)
  try {
    await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
      window.__achData = { src: 'RetroAchievements', unit: 'points', total: 12, earned: 4, points: 120, pointsEarned: 40, achievements: Array.from({ length: 12 }, (_, i) => ({ title: 'Achievement ' + i, desc: 'Defeat the boss of world ' + i + ' without taking any damage', points: 10, badge: '', type: i === 5 ? 'missable' : i === 6 ? 'progression' : '', rarity: i * 6, earned: i < 4, date: i < 4 ? '2026-11-0' + (i + 1) : null })) };
      window.__hOpen({ inGame: true, title: 'Pretend Quest', system: 'Super Nintendo', actions: ['resume', 'save', 'load', 'shot', 'power', 'quit'], power: ['sleep'], confirmButton: 'a', ach: true, reduceMotion: true }); await w(300);
      for (let i = 0; i < 4; i++) { window.__hBtn({ btn: 'down', down: true }); await w(30); } window.__hBtn({ btn: 'a', down: true }); await w(500); });
    await page.screenshot({ path: path.join(OUT, 'home-achievements.png') });
    await page.evaluate(async () => { const w = ms => new Promise(r => setTimeout(r, ms));
      window.__hOpen({ inGame: true, title: 'Pretend Quest', system: 'Super Nintendo', layout: 'center', actions: ['resume', 'save', 'load', 'shot', 'power', 'quit'], power: ['sleep'], confirmButton: 'a', ach: true, reduceMotion: true }); await w(300);
      for (let i = 0; i < 4; i++) { window.__hBtn({ btn: 'right', down: true }); await w(30); } window.__hBtn({ btn: 'a', down: true }); await w(500); });
    await page.screenshot({ path: path.join(OUT, 'home-achievements-centre.png') });
  } catch (e) {}
  await ctx.close().catch(() => {});
};
