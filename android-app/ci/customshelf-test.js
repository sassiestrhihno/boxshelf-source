// (beta.14) A game added by hand on any shelf: Custom, PC or a console's. The settings check keeps a console's id (junk is
// dropped), pcgames.customGames passes it on, and pcgames.placeCustom (main.js buildLibrary's split) puts each game on its
// shelf: an existing console shelf gets it at its place by title, a console with no shelf gets one where it sits in the
// consoles' order, an id that isn't a console (and any Quiver game) stays on Custom, 'pc' goes to the PC shelf.
// node ci/customshelf-test.js   (no Electron)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0, n = 0; const ok = (c, m, d) => { n++; console.log((c ? '✅ ' : '❌ ') + m + (c || d === undefined ? '' : ' :: ' + String(d).slice(0, 500))); if (!c) fails++; };
try {
  const config = require(path.join(ROOT, 'main', 'config.js')), pcgames = require(path.join(ROOT, 'main', 'pcgames.js')), { CONSOLES } = require(path.join(ROOT, 'main', 'systems.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-customshelf-')), exe = path.join(tmp, 'Game.exe'); fs.writeFileSync(exe, 'MZ');

  // ---- the settings check ----
  const cfg = config.defaults();
  cfg.pc.custom = [['n64', 'Kart Recomp'], ['pc', 'On PC'], ['custom', 'Plain'], ['Not ok!', 'Shouty'], [123, 'Number'], ['x'.repeat(25), 'Too long'], ['nope', 'Unknown'], [undefined, 'None']]
    .map(([shelf, title], i) => ({ id: 'g' + i, title, exe, args: '', ...(shelf === undefined ? {} : { shelf }) }));
  config.sanitize(cfg);
  const kept = cfg.pc.custom.map(c => c.shelf === undefined ? '-' : c.shelf).join();
  ok(kept === 'n64,pc,-,-,-,-,nope,-', 'Settings check: a console\'s id and "pc" are kept on a custom game; "custom", junk, numbers and long ids are dropped', kept);

  // ---- pcgames.customGames ----
  const games = pcgames.customGames(cfg.pc.custom), by = t => games.find(g => g.title === t) || {};
  ok(by('Kart Recomp').shelf === 'n64' && by('On PC').shelf === 'pc' && by('Unknown').shelf === 'nope' && !by('Plain').shelf && !by('None').shelf && games.every(g => g.source === 'custom'),
    'customGames passes the shelf on (a console\'s id, pc), and none for Custom', JSON.stringify(games.map(g => [g.title, g.shelf || ''])));
  ok(pcgames.customGames([{ id: 'z', title: 'Z', exe, shelf: '<b>' }])[0].shelf === undefined, 'customGames drops a shelf value that isn\'t an id');

  // ---- pcgames.placeCustom ----
  const pcGame = g => ({ kind: 'steam', source: g.source, id: g.id, title: g.title, art: {} });
  const rom = t => ({ kind: 'rom', id: 'r-' + t, title: t, file: t + '.iso', art: {} });
  const mk = () => [{ id: 'gc', kind: 'console', name: 'GameCube', games: [rom('Alpha'), rom('Kilo'), rom('Zulu')] },
    { id: 'psx', kind: 'console', name: 'PlayStation', games: [rom('Bravo')] }, { id: 'snes', kind: 'console', name: 'SNES', games: [] }];
  const g = (title, shelf, source = 'custom') => ({ id: 'custom-' + title.toLowerCase(), source, title, exe, ...(shelf ? { shelf } : {}) });
  // to an existing console's shelf: at its place by title, the rest kept in order; launched by id (kind 'steam')
  { const sh = mk(), r = pcgames.placeCustom(sh, [g('Lima', 'gc'), g('Echo', 'gc')], CONSOLES, pcGame), gc = sh[0];
    ok(gc.games.map(x => x.title).join() === 'Alpha,Echo,Kilo,Lima,Zulu' && gc.games.filter(x => x.kind === 'steam').length === 2 && gc.games.find(x => x.title === 'Echo').source === 'custom' && sh.length === 3 && !r.toPc.length && !r.onCustom.length,
      'Moved to a console with games: on that shelf, in title order, ROMs keep their order, still a custom game (kind steam, starts its own program)', JSON.stringify(gc.games.map(x => x.title + ':' + x.kind))); }
  // to a console with no shelf: one is made where that console sits in the consoles' order (NES between PlayStation and SNES)
  { const sh = mk(), r = pcgames.placeCustom(sh, [g('Kart', 'nes'), g('Banjo', 'nes')], CONSOLES, pcGame), at = sh.findIndex(s => s.id === 'nes'), s = sh[at] || {};
    const def = CONSOLES.find(c => c.id === 'nes');
    ok(at === 2 && sh.map(x => x.id).join() === 'gc,psx,nes,snes' && s.kind === 'console' && s.name === def.name && s.hasEmulator === false && s.games.map(x => x.title).join() === 'Banjo,Kart' && !r.onCustom.length,
      'Moved to a console with no shelf: a shelf is made for it (its name, no emulator tile) in that console\'s place, games by title', JSON.stringify({ ids: sh.map(x => x.id), s })); }
  { const sh = [], r = pcgames.placeCustom(sh, [g('Late', 'dos')], CONSOLES, pcGame);
    ok(sh.length === 1 && sh[0].id === 'dos' && sh[0].games.length === 1 && !r.onCustom.length, 'A console shelf is made even when no console has games', JSON.stringify(sh)); }
  // unknown id, Quiver, no shelf → Custom; pc → PC
  { const sh = mk(), q = g('Quarantine', 'gc', 'quiver'), r = pcgames.placeCustom(sh, [g('Lost', 'nope'), q, g('Home'), g('Desk', 'pc')], CONSOLES, pcGame);
    ok(r.onCustom.map(x => x.title).join() === 'Lost,Quarantine,Home' && r.toPc.map(x => x.title).join() === 'Desk' && sh.length === 3 && sh[0].games.length === 3,
      'An id that isn\'t a console stays on Custom (never lost); Quiver games stay on Custom; no shelf is Custom; "pc" goes to the PC shelf', JSON.stringify({ c: r.onCustom.map(x => x.title), pc: r.toPc.map(x => x.title) })); }
  // back to Custom: nothing left on the console's shelf
  { const sh = mk(), r = pcgames.placeCustom(sh, [g('Lima')], CONSOLES, pcGame);
    ok(sh[0].games.length === 3 && sh[0].games.every(x => x.kind === 'rom') && r.onCustom.length === 1, 'Back to Custom: the console\'s shelf has its ROMs only again', JSON.stringify(sh[0].games.map(x => x.title))); }

  // ---- the callers ----
  const txt = f => fs.readFileSync(path.join(ROOT, f), 'utf8'), main = txt('main.js'), app = txt('renderer/app.js'), set = txt('renderer/settings.js');
  ok(/const \{ toPc, onCustom \} = pcgames\.placeCustom\(shelves, mine, CONSOLES, pcGame\);/.test(main) && main.indexOf('pcgames.placeCustom(') < main.indexOf("shelves.push({ id: 'pc'"),
    'main.js buildLibrary shares the games out with placeCustom before the PC and Custom shelves are made');
  ok(!/Move to shelf…"/.test(app) && /k==="addto"\)\{addPick\(/.test(app) && /function addCan\(g\)\{return !ANDROID&&!kidOn\(\)/.test(app),
    'The quick menu\'s Move to shelf… row is gone: + Add to… does it for every game (not on Android, not in Kid mode; ci/addto-pass.js)');
  ok(/rows\.push\(C\("Shelf","",customShelfOpts,"custom"/.test(set), 'Settings → Custom games → the game → Shelf is a choice of Custom, PC and every console');
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) { ok(false, 'ran to the end', e && e.stack); }
console.log(fails ? `${fails} of ${n} failed` : `all ${n} passed`); process.exit(fails ? 1 : 0);
