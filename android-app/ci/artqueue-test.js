// (beta.14) main/artstudio.js: the picker's downloads never wait behind a site that stopped answering. Pretend sources and a
// pretend network: addresses with /hang/ never answer (as a site that hangs), the rest answer at once.
//  1. a part opened after another whose previews hang: its previews still all arrive (the old part's no longer hold the slots,
//     and its previews not started yet are dropped instead of queued ahead)
//  2. ScreenScraper's previews (one at a time on its account) hanging don't hold up the other sites' previews of the same part
//  3. a cached preview the cache clean-up removed is downloaded again when the part is opened again (its card waited for ever)
//  4. Use on a picture while three previews hang: it downloads and goes in place at once
//  5. covers.downloadEx: a picture cut off half-way is tried again; every picture put in place gets a new address (env.placed)
// Plain Node: node ci/artqueue-test.js (registered in ci/setup-test.js)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
// a stand-in 'electron' (the test job has no Electron): its net.fetch is swapped per check below
const stubNet = { fetch: async () => { throw new Error('offline (test)'); }, request: () => { throw new Error('offline (test)'); } };
{ const Module = require('module'), real = Module._resolveFilename, ID = path.join(os.tmpdir(), 'bs-electron-stub-q.js');
  Module._resolveFilename = function (req, ...a) { return req === 'electron' ? ID : real.call(this, req, ...a); };
  require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: { net: stubNet, shell: { openPath: async () => '' }, app: { getPath: () => os.tmpdir(), whenReady: () => new Promise(() => {}) }, BrowserWindow: function () {}, screen: { getAllDisplays: () => [] }, powerMonitor: { on() {} } } }; }
const repo = path.join(__dirname, '..', '..'), M = p => require(path.join(repo, 'main', p));
const covers = M('covers'), steamgrid = M('steamgrid'), screenscraper = M('screenscraper'), A = M('artstudio');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-artq-')), roms = path.join(tmp, 'roms'), art = path.join(tmp, 'art'); fs.mkdirSync(roms); fs.mkdirSync(art);
const G = n => { const f = path.join(roms, n + '.iso'); fs.writeFileSync(f, 'x'); return f; };
const G1 = G('Game One'), G2 = G('Game Two'), G3 = G('Game Three'), G4 = G('Game Four');
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await wait(20); } return !!fn(); };
// a PNG header (sizeOf reads only that), padded past the 1 KB a real picture has at least
const png = (w, h) => { const b = Buffer.alloc(2048); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const lb = (name, region = 'usa') => ({ url: `https://lb.invalid/${name}.png`, ext: '.png', source: 'launchbox', type: 'Box - Front', region, edition: 'original', kind: 'scan', label: name });
const ssMedia = n => `https://api.screenscraper.fr/api2/mediaJeu.php?media=box-2D&n=${n}`;
const ss = n => ({ url: ssMedia(n), thumbUrl: ssMedia(n) + '&maxwidth=420&maxheight=420', ext: '.png', source: 'screenscraper', type: 'box-2D', region: 'usa', edition: 'original', kind: 'scan', label: 'ss' + n });

// the sources: one list per game + part
const table = {
  'Game One|front': ['hang/f1', 'hang/f2', 'hang/f3', 'hang/f4', 'hang/f5', 'hang/f6'].map(n => lb(n)),
  'Game One|back': ['ok/b1', 'ok/b2', 'ok/b3'].map(n => lb(n)),
  'Game Two|front': [lb('ok/t1', 'jpn'), lb('ok/t2', 'jpn')], // ranked below ScreenScraper's USA scans
  'Game Three|front': [lb('hang/u1'), lb('hang/u2'), lb('hang/u3'), lb('ok/u4', 'jpn')],
  'Game Four|front': [lb('ok/p1')]
};
const realDownloadEx = covers.downloadEx;
covers.candidates = async (sysId, game, part) => (table[path.basename(game.file, '.iso') + '|' + part] || []).map(c => ({ ...c }));
steamgrid.enabled = () => false;
screenscraper.init({ dataDir: tmp, creds: () => ({ user: 'u', pass: 'p' }), log: () => {}, fetch: (u) => { ssAsked.push(u); return new Promise(() => {}); } }); // ScreenScraper never answers
const ssAsked = [];
screenscraper.candidates = async (sysId, game, part) => path.basename(game.file, '.iso') === 'Game Two' && part === 'front' ? [ss(1), ss(2), ss(3), ss(4)] : [];
const dlCalls = [];
covers.downloadEx = (url, dest) => { dlCalls.push(url); if (/\/hang\//.test(url)) return new Promise(() => {}); return fs.promises.writeFile(dest, png(600, 900)).then(() => 'ok'); };

const sent = [], placedSeen = [], cfg = {};
const def = { id: 'gc', name: 'GameCube' }, sc = { romDirs: [roms], artDir: art };
A.init({ dataDir: tmp, log: () => {}, send: (ch, d) => { if (ch === 'art:cand') sent.push(d); }, getCfg: () => cfg, setArt: a => { cfg.art = a; }, consoles: () => [{ def, sc }],
  scan: async () => [G1, G2, G3, G4].map(f => ({ file: f, title: path.basename(f, '.iso'), kind: 'game', art: {} })), gameFile: (id, f) => ({ file: f }), fileUrl: f => 'bsfile://local/' + encodeURIComponent(f),
  placed: f => placedSeen.push(f), changed: () => {}, pruneDelay: 1e9, migrateDelay: 1e9 });
const thumbsOf = (file, part) => new Set(sent.filter(d => d.file === file && d.part === part && d.thumb && !d.failed).map(d => d.key));
const keysBy = (r, re) => r.list.filter(c => re.test(c.label)).map(c => c.key);

(async () => {
  let bad = 0; const ok = (n, c, info) => { if (!c) bad++; console.log(c ? '✅' : '❌', n, c ? '' : JSON.stringify(info).slice(0, 400)); };

  // 1. the front's previews hang; the back opened next still gets all of its own
  await A.cands({ systemId: 'gc', file: G1, part: 'front' });
  await until(() => dlCalls.filter(u => /\/hang\/f/.test(u)).length === 3);
  const rb = await A.cands({ systemId: 'gc', file: G1, part: 'back' }), bk = keysBy(rb, /ok\/b/);
  const got1 = await until(() => bk.every(k => thumbsOf(G1, 'back').has(k)));
  ok('a part opened after one whose previews hang still gets all its previews', got1 && bk.length === 3, { bk, have: [...thumbsOf(G1, 'back')] });
  ok("the hanging part's previews not started yet are dropped (not queued ahead of the part on screen)", !dlCalls.some(u => /\/hang\/f[456]/.test(u)), dlCalls);

  // 2. ScreenScraper's previews hang (ranked first): the other sites' previews of the same part still arrive
  const r2 = await A.cands({ systemId: 'gc', file: G2, part: 'front' }), lk = keysBy(r2, /ok\/t/);
  const got2 = await until(() => lk.length === 2 && lk.every(k => thumbsOf(G2, 'front').has(k)));
  ok("ScreenScraper's previews waiting for its account's turn don't hold up the other sites' previews", got2 && ssAsked.length >= 1, { lk, have: [...thumbsOf(G2, 'front')], ss: ssAsked.length });

  // 3. a cached preview removed by the cache clean-up comes back when the part is opened again
  const r3 = await A.cands({ systemId: 'gc', file: G4, part: 'front' }), pk = keysBy(r3, /ok\/p1/)[0];
  const first3 = await until(() => thumbsOf(G4, 'front').has(pk));
  if (!first3) ok('a cached preview the clean-up removed is downloaded again (its card no longer waits for ever)', false, 'its first preview never arrived');
  else {
    const t3 = sent.find(d => d.file === G4 && d.key === pk && d.thumb).thumb, cached = decodeURIComponent(t3.replace(/^bsfile:\/\/local\//, '').replace(/\?.*$/, ''));
    fs.unlinkSync(cached); const n3 = sent.length;
    await A.cands({ systemId: 'gc', file: G4, part: 'front' }); // within 5 min: the same list, its card marked cached
    const got3 = await until(() => sent.slice(n3).some(d => d.key === pk && d.thumb) && fs.existsSync(cached));
    ok('a cached preview the clean-up removed is downloaded again (its card no longer waits for ever)', got3 && dlCalls.filter(u => /ok\/p1/.test(u)).length === 2, { got3, calls: dlCalls.filter(u => /ok\/p1/.test(u)).length });
  }

  // 4. Use while the part's three previews hang: the pick downloads and goes in place at once
  const r4 = await A.cands({ systemId: 'gc', file: G3, part: 'front' }), uk = keysBy(r4, /ok\/u4/)[0];
  await until(() => dlCalls.filter(u => /\/hang\/u/.test(u)).length === 3);
  const used = await Promise.race([A.use({ systemId: 'gc', file: G3, part: 'front', key: uk }), wait(8000).then(() => 'stuck')]);
  ok('Use on a picture while three previews hang puts it in place at once', used !== 'stuck' && used && used.art && used.art.front, used);
  ok('the picture put in place got a new address (env.placed: the shelf sees the change)', placedSeen.some(f => /Game Three/.test(f)), placedSeen);

  // 5. covers.downloadEx: the picture's bytes cut off half-way (the abort a dropped connection gives) is tried again
  let n5 = 0; const pic = png(600, 900);
  stubNet.fetch = async () => { n5++; return n5 === 1 ? { ok: true, status: 200, arrayBuffer: async () => { throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }); } } : { ok: true, status: 200, arrayBuffer: async () => pic.buffer.slice(pic.byteOffset, pic.byteOffset + pic.length) }; };
  const dest5 = path.join(tmp, 'five.png'); let r5 = null; try { r5 = await realDownloadEx('https://lb.invalid/cut.png', dest5); } catch (e) { r5 = 'threw: ' + e.message; }
  ok('a picture cut off half-way is downloaded again (it threw "The operation was aborted")', r5 === 'ok' && n5 === 2 && fs.existsSync(dest5), { r5, n5 });
  // a cover download putting a picture in place (covers.placeArt, the same name as the one before) reports it too
  const inc = path.join(art, 'Game Four.incoming.png'); fs.writeFileSync(inc, png(700, 1000)); const p0 = placedSeen.length;
  await covers.placeArt(art, 'Game Four', '', inc, '.png', 'auto');
  ok('a cover download putting a picture in place gives it a new address too', placedSeen.length > p0 && /Game Four\.png$/.test(placedSeen[placedSeen.length - 1]), placedSeen.slice(p0));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(bad ? `${bad} failed` : 'all passed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('❌', e && e.stack || e); process.exit(1); });
