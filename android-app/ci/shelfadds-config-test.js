// (beta.14) The settings file keeps + Add to…'s games on other shelves (ui.shelfAdds { "<shelf id>": ["<game id>", ...] })
// and an automatic My shelf's rule (ui.collections[].rule { kind, value }) through a restart; junk is dropped, a sane
// number of each is kept. node ci/shelfadds-config-test.js   (no Electron)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0, n = 0; const ok = (c, m, d) => { n++; console.log((c ? '✅ ' : '❌ ') + m + (c || d === undefined ? '' : ' :: ' + String(d).slice(0, 400))); if (!c) fails++; };
try {
  const config = require(path.join(ROOT, 'main', 'config.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-shelfadds-'));
  config.init(dir, () => {});
  const start = ui => { const c = config.defaults(); c.setupDone = true; Object.assign(c.ui, ui); fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c)); return config.load().ui; };

  // ---- ui.shelfAdds ----
  const big = Array.from({ length: 2100 }, (_, i) => 'g' + i);
  const u = start({ shelfAdds: { wii: ['gc:Aether Drift (USA).rvz', 'steam-400', 'gc:Aether Drift (USA).rvz'], pc: ['custom-moon-kart'], 'Not ok!': ['x'], ['x'.repeat(25)]: ['y'], custom: [], n64: [1, null, '', 'x'.repeat(1025), 'ok'], ps2: 'nope', snes: big } });
  const a = u.shelfAdds || {};
  ok(JSON.stringify(a.wii) === JSON.stringify(['gc:Aether Drift (USA).rvz', 'steam-400']) && JSON.stringify(a.pc) === '["custom-moon-kart"]', 'shelfAdds: a shelf\'s added games survive a restart, duplicates dropped', JSON.stringify(a));
  ok(!('Not ok!' in a) && !(('x'.repeat(25)) in a) && !('custom' in a) && !('ps2' in a), 'shelfAdds: a shelf id that isn\'t one (or too long), an empty list and a list that isn\'t one are dropped', Object.keys(a).join());
  ok(JSON.stringify(a.n64) === '["ok"]', 'shelfAdds: game ids that aren\'t strings, are empty or too long are dropped', JSON.stringify(a.n64));
  ok(Array.isArray(a.snes) && a.snes.length === 2000, 'shelfAdds: at most 2000 games a shelf', a.snes && a.snes.length);
  { const many = {}; for (let i = 0; i < 120; i++) many['s' + i] = ['g']; ok(Object.keys(start({ shelfAdds: many }).shelfAdds).length === 100, 'shelfAdds: at most 100 shelves'); }
  for (const bad of [null, 'wii', ['wii'], 42]) { const s = start({ shelfAdds: bad }).shelfAdds; ok(s && typeof s === 'object' && !Array.isArray(s) && !Object.keys(s).length, `shelfAdds: ${JSON.stringify(bad)} becomes {}`, JSON.stringify(s)); }
  ok(JSON.stringify(config.defaults().ui.shelfAdds || {}) === '{}' && JSON.stringify(start({}).shelfAdds) === '{}', 'shelfAdds: a settings file without it starts with none');

  // ---- an automatic My shelf's rule ----
  const cols = start({ collections: [
    { id: 'c1', name: 'Finished', ids: [], rule: { kind: 'status', value: 'finished' } },
    { id: 'c2', name: 'Racing', ids: ['a'], rule: { kind: 'genre', value: 'Racing' } },
    { id: 'c3', name: 'GameCube', ids: [], rule: { kind: 'console', value: 'gc' } },
    { id: 'c4', name: 'Never', ids: [], rule: { kind: 'never', value: 'junk' } },
    { id: 'c5', name: 'Picked', ids: ['b', 'c'] },
    { id: 'c6', name: 'Odd', ids: ['d'], rule: { kind: '<script>', value: 'x' } },
    { id: 'c7', name: 'Long', ids: [], rule: { kind: 'genre', value: 'y'.repeat(200) } },
    { id: 'c8', name: 'Shape', ids: [], rule: 'status' }] }).collections;
  const by = id => cols.find(c => c.id === id) || {};
  ok(JSON.stringify(by('c1').rule) === '{"kind":"status","value":"finished"}' && JSON.stringify(by('c2').rule) === '{"kind":"genre","value":"Racing"}' && JSON.stringify(by('c3').rule) === '{"kind":"console","value":"gc"}',
    'My shelves: an automatic shelf\'s rule (status, genre, console) survives a restart', JSON.stringify(cols.slice(0, 3)));
  ok(JSON.stringify(by('c4').rule) === '{"kind":"never","value":""}', 'My shelves: a Never played rule survives (it has no value)', JSON.stringify(by('c4')));
  ok(!('rule' in by('c5')) && JSON.stringify(by('c5').ids) === '["b","c"]', 'My shelves: a shelf you pick games for stays one (no rule), its games kept', JSON.stringify(by('c5')));
  ok(!('rule' in by('c6')) && !('rule' in by('c8')) && JSON.stringify(by('c6').ids) === '["d"]', 'My shelves: a rule of an unknown kind or shape is dropped (the shelf and its games stay)', JSON.stringify([by('c6'), by('c8')]));
  ok(by('c7').rule && by('c7').rule.value.length === 80, 'My shelves: a rule\'s value is kept short', by('c7').rule && by('c7').rule.value.length);
  { const nu = config.normalize(JSON.parse(JSON.stringify({ ...config.defaults(), ui: { ...config.defaults().ui, collections: [{ id: 'c1', name: 'Fin', ids: [], rule: { kind: 'status', value: 'finished' } }], shelfAdds: { wii: ['g1'] } } }))).ui;
    ok(JSON.stringify(nu.collections[0].rule) === '{"kind":"status","value":"finished"}' && JSON.stringify(nu.shelfAdds) === '{"wii":["g1"]}', 'Settings saved from the screen (normalize) keep the rule and the added games too', JSON.stringify([nu.collections, nu.shelfAdds])); }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
} catch (e) { ok(false, 'shelfadds-config-test ran', e && e.stack); }
console.log(fails ? `${fails} of ${n} failed` : `all ${n} passed`);
process.exit(fails ? 1 : 0);
