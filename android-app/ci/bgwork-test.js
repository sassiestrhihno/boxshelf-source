// Node check (perf pass): background work in the main process (main.js autoManuals: manuals.autoFetch / recheck, the
// spreads check in fixSpreads; GameTDB's refresh; the preview lookups) never holds Boxshelf up, with the same answers.
//   A made-up library (300 Game Boy games, each with a scanned manual) on a "slow disk": every sync fs call busy-waits (a
//   round trip on the main process), every fs.promises call waits a moment without blocking.
//   1. main/dircache.js prime(): a folder read ahead with fs.promises; names() then answers without a sync call; a forget()
//      while it reads keeps that (older) listing out;
//   2. main/spreads.js splitManual: checking a manual that has no spreads makes no sync fs call (page headers read with
//      fs.promises); a booklet scanned open is still cut, front cover first;
//   3. main/manuals.js autoFetch over a library where every game has a manual: nothing to search, no sync fs call (the
//      sync scan it used made one per folder and game);
//   4. main/manuals.js recheck: the same games checked, the one with thumbnail pages set aside, and no sync fs call except
//      that move and the memo's save;
//   5. main/gametdb.js: the weekly database zip read and unpacked off the main thread gives the same XML;
//   6. main/previews.js findFile: the folders a console's videos may be in are looked up once a minute (no sync fs call
//      on the next asks), and forget() looks again.
// Run:  node android-app/ci/bgwork-test.js            (exit code 1 on a failure)
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const fsp = fs.promises, { performance } = require('perf_hooks');
const MAIN = path.resolve(__dirname, '..', '..', 'main');

const SYNC_MS = 0.6, ASYNC_MS = 1;
let slow = false, syncCalls = 0; const syncWhat = [];
const spin = ms => { const t = process.hrtime.bigint() + BigInt(Math.round(ms * 1e6)); while (process.hrtime.bigint() < t); };
for (const k of ['statSync', 'lstatSync', 'readdirSync', 'readFileSync', 'openSync', 'readSync', 'existsSync', 'writeFileSync', 'renameSync', 'mkdirSync', 'unlinkSync', 'accessSync', 'rmdirSync']) {
  const o = fs[k]; fs[k] = function (...a) { if (slow) { syncCalls++; syncWhat.push(k); spin(SYNC_MS); } return o.apply(this, a); }; }
for (const k of ['stat', 'lstat', 'readdir', 'readFile', 'writeFile', 'rename', 'mkdir', 'unlink', 'access', 'open']) {
  const o = fsp[k]; fsp[k] = async function (...a) { if (slow) await new Promise(r => setTimeout(r, ASYNC_MS)); return o.apply(this, a); }; }

let bad = 0; const ok = (n, c, info) => { if (!c) bad++; console.log(c ? '✅' : '❌', n, c ? '' : JSON.stringify(info).slice(0, 500)); };
function watchLoop() { let last = performance.now(), max = 0; const t = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last - 10); last = n; }, 10);
  return () => { clearInterval(t); max = Math.max(max, performance.now() - last - 10); return Math.round(max); }; }
const mk = (p, body = '') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
const png = (w, h) => { const b = Buffer.alloc(2048, 1); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const pad = i => String(i).padStart(4, '0');
const take = () => { const n = syncCalls, w = syncWhat.splice(0); syncCalls = 0; return { n, w }; };
// The pass / fail checks are deterministic: sync fs calls counted on the slow disk (each one would hold the app up) and the
// results. How long the event loop was held is only reported (ℹ): a busy PC or CI runner stalls now and then on its own.
const info = (n, held) => console.log('ℹ', n, `(event loop held at most ${held} ms)`);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-manualpass-')), roms = path.join(tmp, 'gb'), art = path.join(roms, 'covers');
  const N = 300, TINY = 1, roms2 = path.join(tmp, 'gb2'), art2 = path.join(roms2, 'covers');
  for (let i = 0; i < N; i++) { const name = `Manual Game ${pad(i)} (USA)`; mk(path.join(roms, name + '.gb'), 'rom'); mk(path.join(art, name + '.png'), png(1000, 1400));
    for (let p = 1; p <= 3; p++) mk(path.join(art, `${name}-manual-0${p}.png`), png(1000, 1400)); }
  for (let i = 0; i < 3; i++) { const name = `Other Game ${pad(i)} (USA)`; mk(path.join(roms2, name + '.gb'), 'rom');
    for (let p = 1; p <= 3; p++) mk(path.join(art2, `${name}-manual-0${p}.png`), i === TINY ? png(200, 280) : png(1000, 1400)); }
  const scanner = require(path.join(MAIN, 'scanner.js')), { CONSOLES } = require(path.join(MAIN, 'systems.js'));
  const dircache = require(path.join(MAIN, 'dircache.js')), spreads = require(path.join(MAIN, 'spreads.js')), manuals = require(path.join(MAIN, 'manuals.js'));
  const def = CONSOLES.find(c => c.id === 'gb'), cfg = { enabled: true, romDirs: [roms] }, systems = [{ def, cfg }];

  // 1. dircache prime
  { const ls = dircache.lister(); slow = true; take(); await ls.prime(art); const names = ls.names(art), c = take(); slow = false;
    ok('dircache: a folder read ahead with prime() answers names() without a sync fs call', c.n === 0 && names.length === N * 4, { calls: c, n: names.length });
    const ls2 = dircache.lister(), p = ls2.prime(art); ls2.forget(art); mk(path.join(art, 'zz-new.txt'), 'x'); await p;
    ok('dircache: a forget() while prime() reads keeps that older listing out (the next look sees the new file)', ls2.names(art).includes('zz-new.txt'));
    fs.unlinkSync(path.join(art, 'zz-new.txt')); }

  // 2. spreads: the check of a manual without spreads, and a booklet scanned open
  { const ls = dircache.lister(); await ls.prime(art); slow = true; take(); const stop = watchLoop();
    let cut = 0; for (let i = 0; i < 40; i++) cut += await spreads.splitManual(art, `Manual Game ${pad(i)} (USA)`, async () => Buffer.from('x'), { ls });
    const held = stop(), c = take(); slow = false;
    ok('spreads: checking 40 manuals without spreads cuts nothing and makes no sync fs call', cut === 0 && c.n === 0, { cut, calls: c.n, what: c.w.slice(0, 5) });
    info('spreads: checking 40 manuals', held);
    const bk = path.join(tmp, 'booklet'), base = 'Booklet Game (USA)';
    mk(path.join(bk, base + '-manual-01.png'), png(2400, 1600)); mk(path.join(bk, base + '-manual-02.png'), png(2400, 1600));
    const crop = async (f, side) => Buffer.from(path.basename(f) + ':' + side);
    const n = await spreads.splitManual(bk, base, crop, {});
    const pages = fs.readdirSync(bk).filter(f => f.includes('-manual-')).sort(), first = fs.readFileSync(path.join(bk, pages[0]), 'utf8'), last = fs.readFileSync(path.join(bk, pages[pages.length - 1]), 'utf8');
    ok('spreads: a booklet scanned open is still cut into pages, front cover first and back cover last, originals kept aside', n === 4 && pages.length === 4 && first === base + '-manual-01.png:right' && last === base + '-manual-01.png:left' && fs.existsSync(path.join(bk, '.manual-originals', base)), { n, pages, first, last }); }

  // 3. autoFetch: every game has a manual, so nothing to search
  { manuals.setStore(path.join(tmp, 'manual-auto.json')); manuals.autoInfo('warm'); scanner.forget();
    slow = true; take(); const stop = watchLoop(), t = performance.now();
    const r = await manuals.autoFetch(systems, {}); const held = stop(), ms = Math.round(performance.now() - t), c = take(); slow = false;
    scanner.forget(); slow = true; take(); const t2 = performance.now(); scanner.scanSystem(def, cfg); const syncMs = Math.round(performance.now() - t2), sc = take(); slow = false;
    ok('autoFetch: every game already has a manual, nothing is searched', r && r.searched === 0 && r.got === 0, r);
    ok(`autoFetch: no sync fs call over ${N} games (the sync scan it used made ${sc.n}, holding the app ${syncMs} ms)`, c.n === 0, { calls: c.n, what: c.w.slice(0, 8) });
    info(`autoFetch over ${N} games, took ${ms} ms`, held); }

  // 4. recheck (forced, as Settings > Get manuals > Check my manuals does): every manual checked without holding the app
  //    up; a game with thumbnail pages is still set aside (that move itself is sync, and rare)
  { scanner.forget(); slow = true; take(); const stop = watchLoop();
    const r = await manuals.recheck(systems, { force: true }); const held = stop(), c = take(); slow = false;
    ok(`recheck: all ${N} manuals checked, none set aside`, r && r.checked === N && r.moved === 0, r);
    ok('recheck: no sync fs call except saving the memo', c.w.every(k => k === 'writeFileSync' || k === 'renameSync') && c.n <= 2, { calls: c.n, what: c.w });
    info(`recheck over ${N} manuals`, held);
    scanner.forget(); const r2 = await manuals.recheck([{ def, cfg: { enabled: true, romDirs: [roms2] } }], { force: true });
    const tiny = `Other Game ${pad(TINY)} (USA)`, aside = path.join(art2, '.manual-originals', tiny);
    ok('recheck: the manual with thumbnail pages is set aside in .manual-originals, the others stay', r2 && r2.checked === 3 && r2.moved === 1 && r2.list.length === 1 && path.basename(r2.list[0].file) === tiny + '.gb' && fs.existsSync(aside) && !fs.readdirSync(art2).some(f => f.startsWith(tiny + '-manual-')) && fs.readdirSync(art2).filter(f => f.includes('-manual-')).length === 6, r2); }

  // 5. GameTDB's weekly database: the zip read and unpacked off the main thread gives the same XML as before
  { const zlib = require('zlib'), gametdb = require(path.join(MAIN, 'gametdb.js'));
    const xml = '<datafile>' + Array.from({ length: 2000 }, (_, i) => `<game name="g${i}"><id>A${String(i).padStart(4, '0')}</id><type>3DS</type><region>NTSC-U</region><locale lang="EN"><title>Game ${i}</title></locale></game>`).join('') + '</datafile>';
    const data = zlib.deflateRawSync(Buffer.from(xml)), name = Buffer.from('3dstdb.xml'), loc = Buffer.alloc(30), cen = Buffer.alloc(46), end = Buffer.alloc(22);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(data.length, 18); loc.writeUInt16LE(name.length, 26);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(data.length, 20); cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(0, 42);
    const cenAt = loc.length + name.length + data.length; end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(cenAt, 16);
    const zip = Buffer.concat([loc, name, data, cen, name, end]), zf = path.join(tmp, 'tdb.zip'); fs.writeFileSync(zf, zip);
    const a = gametdb._t.xmlOf(zip); slow = true; take(); const b = await gametdb._t.xmlOfFile(zf); const c = take(); slow = false;
    ok('GameTDB: the database read and unpacked with no sync fs call gives the same XML (and the same games)', a === xml && b === xml && c.n === 0 && gametdb._t.parse(b, /^(3DS|New3DS)$/).n === 2000, { a: a && a.length, b: b && b.length, calls: c.n }); }

  // 6. previews: the folders a console's videos may be in are looked up once a minute, not on every preview:find / :warm
  { const previews = require(path.join(MAIN, 'previews.js')), vids = path.join(roms, 'videos'); mk(path.join(vids, 'Manual Game 0003 (USA).mp4'), 'v');
    const g = { file: path.join(roms, 'Manual Game 0003 (USA).gb'), title: 'Manual Game 0003' }, opts = { dirs: [], artDirs: [art] };
    previews.forget(); const first = previews.findFile(def, cfg, g, opts);
    slow = true; take(); const again = [0, 1, 2].map(() => previews.findFile(def, cfg, g, opts)), c = take(); slow = false;
    ok('previews: the same video found again with no sync fs call (the folder list kept for a minute)', first === path.join(vids, 'Manual Game 0003 (USA).mp4') && again.every(f => f === first) && c.n === 0, { first, again, calls: c.n });
    mk(path.join(roms, 'media', 'videos', 'Manual Game 0004 (USA).mp4'), 'v'); previews.forget();
    ok('previews: forget() looks at the folders again (a videos folder added since is found)', previews.findFile(def, cfg, { file: path.join(roms, 'Manual Game 0004 (USA).gb'), title: 'Manual Game 0004' }, opts) === path.join(roms, 'media', 'videos', 'Manual Game 0004 (USA).mp4')); }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(bad ? `${bad} failed` : 'all passed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error('❌', e && e.stack || e); process.exit(1); });
