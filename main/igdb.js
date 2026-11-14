// (beta.14) IGDB, shared. One question per game gives both its screenshots (main/moreshots.js igdbSource) and the game info
// LaunchBox's database is missing (Details: description, genres, developer, publisher, release date, score, series).
// Needs a Twitch developer app's Client ID + Secret (o.keys() → { id, secret }). The app token is asked of Twitch with them
// and kept in memory only; neither the secret nor the token is ever logged or put in an address.
// IGDB allows 4 requests a second: they go one at a time, GAP apart. A game asked about twice within half an hour (Details'
// screenshots and its info, opened together; the background pass after Details) shares one answer.
// The info found is kept in <userData>\igdb-info\index.json and asked for again after RETRY (30 days). It only ever fills
// gaps: a value LaunchBox has is never replaced. Nothing here knows about Electron: main.js passes fetch (tests pass a pretend one).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GAP = 300, MEMO = 30 * 60e3, MEMO_N = 200, RETRY = 30 * 864e5;
// IGDB's platform ids for Boxshelf's consoles (the search is narrowed to the game's console)
const PLAT = { gc: 21, wii: 5, wiiu: 41, sw: 130, psx: 7, ps2: 8, ps3: 9, ps4: 48, psp: 38, psvita: 46, n64: 4, snes: 19, nes: 18, gba: 24, gb: 33, gbc: 22, nds: 20, n3ds: 37,
  megadrive: 29, saturn: 32, dreamcast: 23, mastersystem: 64, gamegear: 35, pcengine: 86, x360: 12, xbox: 11, segacd: 78, sega32x: 30, atari2600: 59, atarilynx: 61, wonderswan: 57, neogeo: 80, dos: 13 };
const FIELDS = 'name,summary,first_release_date,total_rating,genres.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,franchise.name,franchises.name,screenshots.image_id';
const titleOf = g => String((g && g.title) || '').replace(/\s*[([].*?[)\]]/g, '').replace(/["\\]/g, '').trim();

// ---------- the client: the token, the queue, one lookup per game ----------
// (the queue is the module's: every client made here, the screenshots', the info's and the trailers', shares IGDB's limit)
let last = 0, chain = Promise.resolve();
// Keys Twitch or IGDB turn down (wrong, revoked, an expired secret) throw like a busy answer, so nothing is kept as "IGDB has
// nothing" and the game is asked again later; the refusal is remembered for REFUSED (per pair of keys, as a hash), so a
// background pass doesn't ask Twitch for a token once per game. New keys are tried at once.
const REFUSED = 10 * 60e3;
const refusedErr = () => { const e = new Error('IGDB: Twitch didn\'t accept the Client ID and Secret'); e.refused = true; return e; };
function client(o) {
  let tok = null, tokFor = '', until = 0, badFor = '', badAt = 0;
  const memo = new Map();
  const keys = () => { const k = (o.keys && o.keys()) || {}; return { id: String(k.id || '').trim(), secret: String(k.secret || '').trim() }; };
  const ready = () => { const k = keys(); return !!(k.id && k.secret); };
  const pairOf = k => crypto.createHash('sha1').update(k.id + '\n' + k.secret).digest('hex');
  const refused = () => !!badAt && Date.now() - badAt < REFUSED && badFor === pairOf(keys());
  const refuse = () => { tok = null; badFor = pairOf(keys()); badAt = Date.now(); return refusedErr(); };
  async function token(fresh) {
    const k = keys(), pair = pairOf(k); if (!fresh && tok && tokFor === pair && Date.now() < until) return tok;
    if (refused()) throw refusedErr();
    const body = new URLSearchParams({ client_id: k.id, client_secret: k.secret, grant_type: 'client_credentials' }).toString();
    const r = await o.fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15000) });
    if (r.status >= 500 || r.status === 429) throw new Error('Twitch busy');
    if (!r.ok) throw refuse();
    const j = await r.json().catch(() => null); tok = j && j.access_token || null; if (!tok) throw new Error('Twitch gave no token');
    tokFor = pair; badAt = 0; until = Date.now() + Math.max(60, (+(j && j.expires_in) || 3600) - 300) * 1000; return tok;
  }
  // one request at a time, at least GAP apart
  function turn(fn) {
    const p = chain.then(async () => { const w = last + GAP - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); try { return await fn(); } finally { last = Date.now(); } });
    chain = p.catch(() => {}); return p;
  }
  // → IGDB's answer (a list). Throws when IGDB or Twitch is busy, or the keys are turned down (err.refused): asked again later
  function query(endpoint, body) {
    if (refused()) return Promise.reject(refusedErr());
    return turn(async () => {
      let r = null;
      for (let i = 0; i < 2; i++) { const tk = await token(i > 0);
        r = await o.fetch('https://api.igdb.com/v4/' + endpoint, { method: 'POST', headers: { 'Client-ID': keys().id, Authorization: 'Bearer ' + tk, Accept: 'application/json' }, body, signal: AbortSignal.timeout(15000) });
        if (r.status !== 401) break; }
      if (r.status === 429 || r.status >= 500) throw new Error('IGDB busy');
      if (r.status === 401 || r.status === 403) throw refuse();
      if (!r.ok) return [];
      let L = []; try { L = await r.json(); } catch {} return Array.isArray(L) ? L : [];
    });
  }
  // a game → { hit: the best match, shotHit: the best match that has screenshots } (either may be null); null without
  // keys or a title. Throws when busy or the keys are turned down (asked again next time).
  function lookup(sysId, game) {
    const t = titleOf(game); if (!t || !ready()) return Promise.resolve(null);
    const now = Date.now(), mk = sysId + '|' + t.toLowerCase();
    for (const [k, v] of memo) if (now - v.at >= MEMO) memo.delete(k);
    const m = memo.get(mk); if (m) return m.p;
    const p = PLAT[sysId], q = `search "${t}"; fields ${FIELDS}; ${p ? `where platforms = (${p}); ` : ''}limit 15;`;
    const pr = query('games', q).then(L => {
      if (!L) return null; const named = L.filter(x => x && typeof x.name === 'string' && x.name);
      const pick = list => { if (!list.length) return null; try { return o.match(list, game) || null; } catch { return null; } };
      return { hit: pick(named), shotHit: pick(named.filter(x => Array.isArray(x.screenshots) && x.screenshots.length)) };
    });
    memo.set(mk, { at: now, p: pr }); while (memo.size > MEMO_N) memo.delete(memo.keys().next().value);
    pr.then(v => { if (!v) memo.delete(mk); }, () => memo.delete(mk));
    return pr;
  }
  return { ready, lookup, query, refused };
}

// ---------- what an answer holds ----------
const SHOT_ID = /^[a-z0-9]+$/i;
function shotsOf(hit) { return (hit && Array.isArray(hit.screenshots) ? hit.screenshots : []).filter(s => s && SHOT_ID.test(String(s.image_id || ''))).map(s => `https://images.igdb.com/igdb/image/upload/t_screenshot_huge/${s.image_id}.jpg`); }
const str = v => (typeof v === 'string' ? v.trim() : '');
const uniq = L => [...new Set(L.filter(Boolean))];
// the fields Details shows, in LaunchBox's shapes: genres "A; B", release "YYYY-MM-DD", year a number, rating out of 5
function infoOf(h) {
  if (!h || typeof h !== 'object') return null; const o = {};
  const s = str(h.summary); if (s) o.overview = s.length > 1500 ? s.slice(0, 1499).replace(/\s+\S*$/, '') + '…' : s; // (plenty for Details; keeps the index small)
  const gs = uniq((Array.isArray(h.genres) ? h.genres : []).map(x => str(x && x.name))); if (gs.length) o.genres = gs.slice(0, 6).join('; ');
  const ic = Array.isArray(h.involved_companies) ? h.involved_companies.filter(x => x && x.company && str(x.company.name)) : [];
  const dev = uniq(ic.filter(x => x.developer).map(x => str(x.company.name))), pub = uniq(ic.filter(x => x.publisher).map(x => str(x.company.name)));
  if (dev.length) o.dev = dev.slice(0, 3).join(', '); if (pub.length) o.pub = pub.slice(0, 3).join(', ');
  const t = +h.first_release_date; if (Number.isFinite(t) && t > 0) { const d = new Date(t * 1000); if (!isNaN(d)) { o.release = d.toISOString().slice(0, 10); o.year = d.getUTCFullYear(); } }
  const r = +h.total_rating; if (Number.isFinite(r) && r > 0) o.rating = Math.round(r / 20 * 10) / 10;
  const fr = str(h.franchise && h.franchise.name) || str(((Array.isArray(h.franchises) ? h.franchises : []).find(x => str(x && x.name)) || {}).name); if (fr) o.series = fr;
  return Object.keys(o).length ? o : null;
}
// info + IGDB's x: only the gaps filled (a value already there is never replaced). The same object back when nothing changes.
const empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
function fill(info, x) {
  if (!x) return info; const i = info || {}, add = {};
  for (const k of ['overview', 'genres', 'dev', 'pub', 'rating', 'series']) if (!empty(x[k]) && empty(i[k])) add[k] = x[k];
  // the release date only when it doesn't disagree with the year LaunchBox gives
  if (x.release && empty(i.release) && (empty(i.year) || String(i.year).slice(0, 4) === String(x.year))) add.release = x.release;
  if (x.year && empty(i.year) && empty(i.release)) add.year = x.year;
  return Object.keys(add).length ? Object.assign({}, i, add) : info;
}

// ---------- the store: <userData>\igdb-info\index.json, { v: 1, games: { key: { at, i } } } ----------
let dir = null, log = () => {}, idx = null, saveT = null;
function init(o = {}) { dir = o.dataDir ? path.join(o.dataDir, 'igdb-info') : null; log = o.log || log; idx = null; clearTimeout(saveT); saveT = null; }
const keyOf = require('./gamekey').gameKey; // (a generic file name, default.xex / EBOOT.BIN / game.iso, has its folder in the key)
const idxFile = () => path.join(dir, 'index.json');
function load() {
  if (idx) return idx;
  try { const j = JSON.parse(fs.readFileSync(idxFile(), 'utf8')); if (j && j.v === 1 && j.games && typeof j.games === 'object') idx = j; } catch {}
  return idx || (idx = { v: 1, games: {} });
}
// writes one after another, each through its own temporary file (an overlapping save and flush must not share one)
let wChain = Promise.resolve(), wN = 0;
function write() {
  const file = idxFile(), data = idx, d = dir; if (!data || !d) return Promise.resolve();
  const p = wChain.catch(() => {}).then(async () => { const tmp = file + '.' + process.pid + '.' + (++wN) + '.tmp';
    try { await fs.promises.mkdir(d, { recursive: true }); await fs.promises.writeFile(tmp, JSON.stringify(data)); await fs.promises.rename(tmp, file); } catch (e) { await fs.promises.unlink(tmp).catch(() => {}); throw e; } });
  wChain = p; return p;
}
function save() { if (!dir) return; clearTimeout(saveT); saveT = setTimeout(() => { saveT = null; write().catch(e => log('IGDB info: list not saved', e.code || '')); }, 1500); if (saveT.unref) saveT.unref(); }
function flush() { if (!saveT || !idx) return wChain.catch(() => {}); clearTimeout(saveT); saveT = null; return write(); }
const get = (sysId, game) => { if (!dir || !game) return null; const e = load().games[keyOf(sysId, game)]; return (e && e.i) || null; };
// not asked yet, or asked more than RETRY ago
function due(sysId, game, now = Date.now()) { if (!dir || !game) return false; const e = load().games[keyOf(sysId, game)]; return !e || !(now - (e.at || 0) < RETRY); }
// an answer for this game (its matched IGDB entry, or null: IGDB has nothing for it); kept either way, so it isn't asked again
function put(sysId, game, hit) { if (!dir || !game) return; const i = infoOf(hit); load().games[keyOf(sysId, game)] = i ? { at: Date.now(), i } : { at: Date.now() }; save(); }
// the scan: a game's info with what IGDB gave filling its gaps (no network)
function merge(sysId, game, info) { try { return fill(info, get(sysId, game)); } catch { return info; } }
// worth a lookup: some of what Details shows is missing
const gaps = info => { const i = info || {}; return empty(i.overview) || empty(i.genres) || empty(i.dev) || (empty(i.release) && empty(i.year)); };
// Details opened (or the background pass): the game's IGDB info, looked up first when it's due. Never throws.
async function lookupInfo(c, sysId, game) {
  if (!c || !game) return get(sysId, game);
  if (due(sysId, game) && c.ready() && !(c.refused && c.refused())) { try { const r = await c.lookup(sysId, game); if (r) put(sysId, game, r.hit); } catch (e) { log('IGDB info:', (e && e.message) || ''); } }
  return get(sysId, game);
}

module.exports = { client, shotsOf, infoOf, fill, init, get, due, put, merge, gaps, lookupInfo, flush, PLAT, RETRY, _t: { keyOf, load: () => load() } };
