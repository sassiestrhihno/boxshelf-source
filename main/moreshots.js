// (beta.14) More screenshots for Details' Media. LaunchBox's database gives a console game its screenshots (main/covers.js
// gameInfo); many games have only 1-3 there. A game with fewer than WANT is topped up from more sources, in this order:
//   ScreenScraper (only with the user's account): its in-game screenshot, title screen and fan art;
//   libretro's thumbnails (free): Named_Snaps and Named_Titles, under the same name as its Named_Boxarts cover;
//   IGDB (only with the user's Twitch Client ID + Secret): the game's screenshots.
// Gameplay comes before title screens, and title screens before fan art; within each, the sources keep the order above.
// What's added is saved under <userData>\more-shots\<console>\ and listed in more-shots\index.json. It is never downloaded
// again. The LaunchBox shots stay first, as they were; the new ones follow, so the strip never reorders. At most MAX in all.
// Duplicates (the same picture from two sources) are dropped by their bytes and, when a decoder is given, by a small
// difference hash (9x8 grey, adjacent pixels compared), so a re-encoded or resized copy counts as the same picture.
// A source is asked once per game (again after RETRY); a busy one (quota, offline, a 5xx) is asked again next time.
// Nothing here knows about Electron: main.js passes the sources, the downloader and the decoder (tests pass fakes).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WANT = 10, MAX = 12, RETRY = 30 * 864e5, MAX_CANDS = 16, SAME_BITS = 8;
const KIND_RANK = { play: 0, title: 1, fan: 2 };
let dir = null, log = () => {}, sources = [], decode = null, fetchBuf = null, fileUrl = p => p, idx = null, saveT = null, checked = false;
const flight = new Map(), bgUsed = {};

function init(o = {}) {
  dir = o.dataDir ? path.join(o.dataDir, 'more-shots') : null; log = o.log || log; sources = o.sources || []; decode = o.decode || null; fetchBuf = o.fetchBuf || null;
  fileUrl = o.fileUrl || (p => p); idx = null; checked = false; flight.clear(); for (const k of Object.keys(bgUsed)) delete bgUsed[k]; clearTimeout(saveT); saveT = null;
}
const folder = () => dir;
const keyOf = require('./gamekey').gameKey; // (a generic file name, default.xex / EBOOT.BIN / game.iso, has its folder in the key)
const idxFile = () => path.join(dir, 'index.json');

// ---------- the index: { v: 1, games: { key: { s: [[file (relative), source, kind, sha1, dhash]], t: { source: at }, b: { url: [sha1, dhash] } } } } ----------
function load() {
  if (idx) return idx;
  try { const j = JSON.parse(fs.readFileSync(idxFile(), 'utf8')); if (j && j.v === 1 && j.games && typeof j.games === 'object') idx = j; } catch {}
  if (!idx) idx = { v: 1, games: {} };
  if (!checked) { checked = true; setTimeout(prune, 4000).unref?.(); } // (files removed by hand: dropped from the list, off the scan's way)
  return idx;
}
async function prune() {
  if (!idx) return; let gone = 0;
  for (const e of Object.values(idx.games)) { const keep = []; for (const x of e.s || []) { if (await exists(path.join(dir, x[0]))) keep.push(x); else gone++; } e.s = keep; }
  if (gone) save();
}
// writes one after another, each through its own temporary file (an overlapping save and flush used to share one .tmp)
let wChain = Promise.resolve(), wN = 0;
function write() {
  const file = idxFile(), data = idx, d = dir; if (!data || !d) return Promise.resolve();
  const p = wChain.catch(() => {}).then(async () => { const tmp = file + '.' + process.pid + '.' + (++wN) + '.tmp';
    try { await fs.promises.mkdir(d, { recursive: true }); await fs.promises.writeFile(tmp, JSON.stringify(data)); await fs.promises.rename(tmp, file); } catch (e) { await fs.promises.unlink(tmp).catch(() => {}); throw e; } });
  wChain = p; return p;
}
function save() {
  if (!dir) return; clearTimeout(saveT);
  saveT = setTimeout(() => { saveT = null; write().catch(e => log('More screenshots: list not saved', e.code || '')); }, 1500);
  if (saveT.unref) saveT.unref();
}
function flush() { if (!saveT || !idx) return wChain.catch(() => {}); clearTimeout(saveT); saveT = null; return write(); }
const exists = p => fs.promises.stat(p).then(s => s.isFile(), () => false);

// ---------- the lists ----------
const urlsOf = e => (e && e.s ? e.s : []).map(x => fileUrl(path.join(dir, x[0])));
// the LaunchBox shots only: a list from the shelf already has this game's extra ones merged in (merge below)
const baseOf = (e, base) => { const ours = new Set(urlsOf(e)); return (Array.isArray(base) ? base : []).filter(u => typeof u === 'string' && u && !ours.has(u)); };
// the scan: a game's info with the extra screenshots it already has (no disk or network work; nothing new is fetched here)
function merge(sysId, game, info) {
  if (!dir || !game) return info; const e = load().games[keyOf(sysId, game)]; if (!e || !e.s || !e.s.length) return info;
  const base = baseOf(e, info && info.shots); if (base.length >= MAX) return info;
  return Object.assign({}, info || {}, { shots: base.concat(urlsOf(e)).slice(0, MAX) });
}
function list(sysId, game, base) { const e = load().games[keyOf(sysId, game)]; return baseOf(e, base).concat(urlsOf(e)).slice(0, MAX); }
// (a game whose sources were asked when the aim was lower, 6 before test.11, is due again: it stopped at that aim)
const due = (e, src, now) => { const t = e && e.t && e.t[src.id]; return !t || now - t >= RETRY || (e.w || 6) < WANT; };
// worth a look: short of WANT, and a source set up that hasn't been asked (lately) for this game
function need(sysId, game, base, opts = {}) {
  if (!dir) return false; const e = load().games[keyOf(sysId, game)], now = Date.now();
  if (baseOf(e, base).length + (e && e.s ? e.s.length : 0) >= WANT) return false;
  return sources.some(src => ready(src, opts) && due(e, src, now));
}
// (opts.only: just these sources, e.g. ['igdb'] for the background pass IGDB's keys start while box art fetching is off)
const ready = (src, opts) => { try { return (!opts.only || opts.only.includes(src.id)) && !!src.ready() && !(opts.bg && src.bgLimit != null && (bgUsed[src.id] || 0) >= src.bgLimit); } catch { return false; } };

// ---------- pictures ----------
function sniff(b) {
  if (!b || b.length < 64) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b[0] === 0xff && b[1] === 0xd8) return '.jpg';
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}
// a 9x8 BGRA bitmap → 64 bits as 16 hex digits: each pixel brighter than the one to its right
function dhashOf(bmp) {
  if (!bmp || bmp.length < 9 * 8 * 4) return null; let h = '';
  for (let y = 0; y < 8; y++) { let nib = 0; for (let x = 0; x < 8; x++) { const i = (y * 9 + x) * 4, j = i + 4, a = bmp[i] + bmp[i + 1] + bmp[i + 2], b = bmp[j] + bmp[j + 1] + bmp[j + 2]; nib = (nib << 1) | (a > b ? 1 : 0); if (x === 3 || x === 7) { h += nib.toString(16); nib = 0; } } }
  return h;
}
function bitsApart(a, b) { let n = 0; for (let i = 0; i < 16; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { n += x & 1; x >>= 1; } } return n; }
async function marks(buf) {
  const sha = crypto.createHash('sha1').update(buf).digest('hex'); let dh = null;
  if (decode) { try { dh = dhashOf(await decode(buf)); } catch {} }
  return [sha, dh];
}
const same = (a, b) => a[0] === b[0] || (!!a[1] && !!b[1] && /^[0-9a-f]{16}$/.test(a[1]) && /^[0-9a-f]{16}$/.test(b[1]) && bitsApart(a[1], b[1]) <= SAME_BITS);
const breath = () => new Promise(r => setImmediate(r));
const drop = f => fs.promises.unlink(f).catch(() => {}); // (awaited: the next picture is downloaded to the same temporary name)

// ---------- topping up ----------
// → the game's whole list (its LaunchBox shots, then the extra ones), after fetching what's missing. Never throws.
async function topUp(sysId, game, base = [], opts = {}) {
  if (!dir || !game) return (Array.isArray(base) ? base : []).slice(0, MAX);
  const k = keyOf(sysId, game);
  if (flight.has(k)) { await flight.get(k); return list(sysId, game, base); }
  const p = run(sysId, game, k, base, opts).catch(e => log('More screenshots:', e && e.message)); flight.set(k, p);
  try { await p; } finally { flight.delete(k); }
  return list(sysId, game, base);
}
async function run(sysId, game, k, base0, opts) {
  const G = load().games, e = G[k] || { s: [], t: {} }; e.s = e.s || []; e.t = e.t || {};
  const base = baseOf(e, base0), have = () => base.length + e.s.length, now = Date.now();
  if (have() >= WANT) return;
  // every source that's set up and due: what it has for this game (lookups only, no pictures yet)
  const cands = [], asked = [];
  for (const src of sources) {
    if (!ready(src, opts) || !due(e, src, now)) continue;
    if (opts.bg && src.bgLimit != null) bgUsed[src.id] = (bgUsed[src.id] || 0) + 1;
    let got; try { got = await src.find(sysId, game); } catch (err) { log('More screenshots:', src.id, 'busy', (err && err.message) || ''); continue; } // (asked again next time)
    asked.push(src.id);
    for (const c of Array.isArray(got) ? got : []) if (c && typeof c.url === 'string' && KIND_RANK[c.kind] != null) cands.push({ url: c.url, kind: c.kind, src });
  }
  if (!asked.length) return;
  cands.forEach((c, i) => { c.i = i; });
  cands.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.i - b.i); cands.length = Math.min(cands.length, MAX_CANDS);
  const seen = e.s.map(x => [x[3], x[4]]), busy = new Set(), urls = new Set();
  let baseMarked = false;
  for (const c of cands) {
    if (have() >= WANT || e.s.length + base.length >= MAX) break;
    if (urls.has(c.url)) continue; urls.add(c.url);
    // the LaunchBox shots' marks, once, before the first new picture is compared with them
    if (!baseMarked) { baseMarked = true; e.b = e.b || {}; if (fetchBuf) for (const u of base) { if (!e.b[u]) { let b = null; try { b = await fetchBuf(u); } catch {} if (b && sniff(b)) e.b[u] = await marks(b); } if (e.b[u]) seen.push(e.b[u]); } }
    const sub = path.join(dir, String(sysId).replace(/[^a-z0-9_-]/gi, '_')), name = crypto.createHash('sha1').update(k).digest('hex').slice(0, 16);
    const tmp = path.join(sub, name + '.' + process.pid + '.incoming');
    let r; try { await fs.promises.mkdir(sub, { recursive: true }); r = await c.src.get({ url: c.url, kind: c.kind }, tmp); } catch (err) { r = 'busy'; }
    if (r !== 'ok') { if (r === 'busy') busy.add(c.src.id); await drop(tmp); continue; }
    let buf = null; try { buf = await fs.promises.readFile(tmp); } catch {}
    const ext = sniff(buf);
    if (!ext) { await drop(tmp); continue; } // (not a picture: a "no media" text, an error page)
    const m = await marks(buf); await breath();
    if (seen.some(s => same(s, m))) { await drop(tmp); continue; } // the same picture as one there already
    const rel = path.basename(sub) + '/' + name + '-' + m[0].slice(0, 10) + ext;
    try { await fs.promises.rename(tmp, path.join(dir, rel)); } catch { await drop(tmp); continue; }
    seen.push(m); e.s.push([rel, c.src.id, c.kind, m[0], m[1]]);
  }
  for (const id of asked) if (!busy.has(id)) e.t[id] = now;
  if (!busy.size) e.w = WANT;
  G[k] = e; save();
}

// ---------- the background top-up ----------
// items: [{ sysId, game, base }]. One game at a time; before each, opts.wait() (main: no game running, the screen quiet);
// opts.stop() ends it. Games already at WANT, or with every source asked, cost nothing.
let bgRun = null, bgNext = null;
function background(items, opts = {}) {
  bgNext = { items: Array.isArray(items) ? items : [], opts };
  if (bgRun) return bgRun;
  bgRun = (async () => {
    try {
      while (bgNext) { const { items: L, opts: o } = bgNext; bgNext = null; let n = 0;
        for (const it of L) {
          if (bgNext || (o.stop && o.stop())) break;
          const bo = o.only ? { bg: true, only: o.only } : { bg: true };
          if (!it || !it.game || !need(it.sysId, it.game, it.base, bo)) continue;
          if (o.wait) await o.wait(); if (bgNext || (o.stop && o.stop())) break;
          await topUp(it.sysId, it.game, it.base, bo); n++;
          await new Promise(r => setTimeout(r, o.gap != null ? o.gap : 1500));
        }
        if (n) log('More screenshots: looked for', n, 'games');
      }
    } finally { bgRun = null; }
  })();
  return bgRun;
}

// ---------- the sources (main.js builds them from the modules it has) ----------
// ScreenScraper: ss = main/screenscraper.js. Its own limiter and pauses apply; bgLimit caps the background's lookups per run
// (the account's daily quota is shared with the box art).
function ssSource(ss, o = {}) {
  return { id: 'ss', bgLimit: o.bgLimit != null ? o.bgLimit : 150, ready: () => ss.enabled(), find: (sysId, game) => ss.shots(sysId, game, { match: o.match, discId: o.discId }), get: (c, dest) => ss.download(c.url, dest) };
}
// libretro: the game's name in the console's Named_Boxarts list (covers.libretroIndex / libretroMatch, fetched once a week),
// then that name's snap and title screen. A list that can't be had right now: busy.
// (a console's list is kept here for ten minutes: read and parsed once for a whole background pass, not once per game)
function lrSource(o) {
  const memo = new Map();
  const listOf = async sysId => { for (const [k, v] of memo) if (Date.now() - v.at >= 10 * 60e3) memo.delete(k); const m = memo.get(sysId); if (m && Date.now() - m.at < 10 * 60e3) return m.names; const names = await o.index(sysId); if (names) memo.set(sysId, { at: Date.now(), names }); return names; };
  return { id: 'lr', ready: () => true,
    find: async (sysId, game) => { const sys = o.systems[sysId]; if (!sys) return []; const names = await listOf(sysId); if (!names) throw new Error('no list');
      const name = names.length ? o.match(names, game, o.region ? o.region() : undefined) : null; if (!name) return [];
      const u = d => `https://thumbnails.libretro.com/${encodeURIComponent(sys)}/${d}/${encodeURIComponent(name + '.png')}`;
      return [{ url: u('Named_Snaps'), kind: 'play' }, { url: u('Named_Titles'), kind: 'title' }]; },
    get: (c, dest) => o.download(c.url, dest) };
}
// IGDB: needs a Twitch developer app's Client ID + Secret (o.keys() → { id, secret }). The token, the queue and the lookup
// are main/igdb.js's (shared with the game info: o.client, else one of its own). The same answer carries the game's info:
// o.onFound(sysId, game, answer) keeps it, so a game costs IGDB one question for both.
function igdbSource(o) {
  const IG = require('./igdb'), c = o.client || IG.client(o);
  return { id: 'igdb', ready: () => c.ready(),
    find: async (sysId, game) => {
      const r = await c.lookup(sysId, game); if (!r) return []; // (no keys, or a Client ID or Secret Twitch won't take: nothing)
      if (o.onFound) { try { o.onFound(sysId, game, r); } catch {} }
      return IG.shotsOf(r.shotHit).slice(0, MAX).map(url => ({ url, kind: 'play' }));
    },
    get: (c2, dest) => o.download(c2.url, dest) };
}

module.exports = { init, folder, merge, need, topUp, background, flush, ssSource, lrSource, igdbSource, WANT, MAX, _t: { dhashOf, bitsApart, keyOf, load: () => load(), busy: () => !!bgRun } };
