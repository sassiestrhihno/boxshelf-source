// (beta.14) Better trailers: where a console game's trailer (Details' box, the shelf's video preview) comes from once it has
// no video file of your own (main.js checks those first; Steam games keep their store trailer). First found wins:
//   1. ScreenScraper's gameplay clip (only with the user's ScreenScraper account): a short real capture of the game, its
//      "video-normalized" copy first. Fetched once (the same lookup as its box art and screenshots, through its limiter and
//      pauses), kept in data\previews\ss\<console>\<hash>.mp4 (one 400 MB limit with the other clips: previews.trim).
//   2. IGDB's trailers (only with a Twitch Client ID + Secret): the game's videos (YouTube ids), a trailer or gameplay one first,
//      clipped like any console trailer (main/ytclips.js).
//   3. The LaunchBox database's trailer link, 4. a YouTube search (ytclips): both only when the video's title names the game
//      (ytclips.looksRight: a GameCube demo disc menu isn't Billy Hatcher's trailer). A rejected link falls through to the
//      next source, and the verdict is remembered per game.
// Details' Change trailer (Windows / Linux) picks one of these, a pasted YouTube link or no trailer; that choice
// (cfg.games[<console>:<file>].trailer: 'ss' | 'none' | 'yt:<id>') wins over the order above.
// Nothing is fetched in bulk: only for the game whose preview is asked for (or the games beside it, preview:warm).
// Nothing here knows about Electron: main.js passes the modules (tests pass fakes).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NONE_TTL = 30 * 864e5, FAIL_WAIT = 10 * 60e3, IG_RETRY = 30 * 864e5;
const NEED = Object.freeze({ need: true });
let dataDir = '', log = () => {}, ss = null, yt = null, igdb = null, igMatch = null, plat = {}, match = null, discId = null, trim = () => {};
let memo = null, saveT = null; const ssFlights = new Map(), ssFailAt = new Map(), igFlights = new Map(), igFailAt = new Map(), runs = new Map();
function init(o = {}) {
  dataDir = o.dataDir || ''; log = o.log || log; ss = o.ss || null; yt = o.yt || null; igdb = o.igdb || null; igMatch = o.igMatch || null; plat = o.plat || {};
  match = o.match || null; discId = o.discId || null; trim = o.trim || (() => {}); memo = null; clearTimeout(saveT); saveT = null;
  ssFlights.clear(); ssFailAt.clear(); igFlights.clear(); igFailAt.clear(); runs.clear(); igBadAt = 0;
}
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const keyOf = g => require('./gamekey').gameKey(String(g.sysId), g); // (beta.14: a generic file name, default.xex / EBOOT.BIN / game.iso, has its folder in the key; others as before)
const hashOf = g => crypto.createHash('sha1').update(keyOf(g)).digest('hex').slice(0, 16);
const okId = id => /^[\w-]{6,20}$/.test(String(id || ''));

// ---------- what's remembered per game: data\previews\trailers.json { v: 1, games: { key: { ig: [[id, name]], igAt, ok: [ids], bad: [ids] } } } ----------
const memoFile = () => path.join(dataDir, 'previews', 'trailers.json');
function load() {
  if (memo) return memo;
  try { const j = JSON.parse(fs.readFileSync(memoFile(), 'utf8')); if (j && j.v === 1 && j.games && typeof j.games === 'object') memo = j; } catch {}
  return memo || (memo = { v: 1, games: {} });
}
function save() {
  if (!dataDir) return; clearTimeout(saveT);
  saveT = setTimeout(() => { saveT = null; const m = load(), ks = Object.keys(m.games); if (ks.length > 5000) ks.slice(0, ks.length - 5000).forEach(k => delete m.games[k]);
    try { fs.mkdirSync(path.dirname(memoFile()), { recursive: true }); const t = memoFile() + '.tmp'; fs.writeFileSync(t, JSON.stringify(m)); fs.renameSync(t, memoFile()); } catch (e) { log('Trailers: list not saved', e.code || ''); } }, 1000);
  if (saveT.unref) saveT.unref();
}
const entry = g => { const G = load().games, k = keyOf(g); return G[k] || (G[k] = {}); };
const peek = g => load().games[keyOf(g)] || {};

// ---------- 1. ScreenScraper's gameplay clip ----------
const ssDir = g => path.join(dataDir, 'previews', 'ss', String(g.sysId).replace(/[^a-z0-9_-]/gi, '_'));
const ssOut = g => path.join(ssDir(g), hashOf(g) + '.mp4');
const ssNoneFile = g => path.join(ssDir(g), hashOf(g) + '.none');
const ssOn = () => { try { return !!(ss && ss.enabled()); } catch { return false; } };
function ssCached(g) { const f = ssOut(g); if (!isFile(f)) return null; try { const t = new Date(); fs.utimesSync(f, t, t); } catch {} return f; }
function ssNone(g) { try { return Date.now() - fs.statSync(ssNoneFile(g)).mtimeMs < NONE_TTL; } catch { return false; } }
// worth asking ScreenScraper now: an account, Console trailers on (g.ssClips), no "has none" mark, no failure in the last ten minutes
const ssCan = g => g.ssClips !== false && ssOn() && !ssNone(g) && Date.now() - (ssFailAt.get(keyOf(g)) || 0) >= FAIL_WAIT;
const gameArg = g => ({ file: g.file, title: g.title });
// "no clip" is written only while the account is still taken: a refused sign-in mid-way marks nothing
function ssMarkNone(g) { if (!ssOn()) return; try { fs.mkdirSync(ssDir(g), { recursive: true }); fs.writeFileSync(ssNoneFile(g), ''); } catch {} }
// a game beside the one you're on (low): its lookup only, no video download: 'has' | 'none' | 'busy'
async function ssLook(g) {
  let v; try { v = await ss.video(g.sysId, gameArg(g), { match, discId }); } catch (e) { ssFailAt.set(keyOf(g), Date.now()); return 'busy'; }
  if (!v) { ssMarkNone(g); return 'none'; }
  return 'has';
}
function ssClip(g) {
  const f = ssCached(g); if (f) return Promise.resolve(f);
  if (!ssCan(g)) return Promise.resolve(null);
  const k = keyOf(g); if (ssFlights.has(k)) return ssFlights.get(k);
  const p = (async () => {
    let v; try { v = await ss.video(g.sysId, gameArg(g), { match, discId }); } catch (e) { ssFailAt.set(k, Date.now()); log('Trailers: ScreenScraper busy:', (e && e.message) || ''); return null; }
    if (!v) { ssMarkNone(g); return null; }
    const out = ssOut(g); let r;
    try { fs.mkdirSync(ssDir(g), { recursive: true }); r = await ss.downloadVideo(v.url, out); } catch (e) { r = 'busy'; log('Trailers: ScreenScraper clip failed:', (e && e.message) || ''); }
    if (r === 'ok' && isFile(out)) { trim(); log('Trailers: ScreenScraper gameplay clip kept for', g.sysId, Math.round(fs.statSync(out).size / 1024) + ' KB'); return out; }
    try { fs.unlinkSync(out + '.part'); } catch {}
    if (r === 'missing') ssMarkNone(g); else ssFailAt.set(k, Date.now());
    return null;
  })().finally(() => ssFlights.delete(k));
  ssFlights.set(k, p); return p;
}

// ---------- 2. IGDB's trailers ----------
const igOn = () => { try { return !!(igdb && igdb.ready()); } catch { return false; } };
// the game's IGDB videos [{ id, name }] as remembered (undefined: not asked yet, or a miss asked long ago)
function igKnown(g) { const e = peek(g); if (!Array.isArray(e.ig)) return undefined; if (!e.ig.length && Date.now() - (e.igAt || 0) >= IG_RETRY) return undefined; return e.ig.map(([id, name]) => ({ id, name })); }
let igBadAt = 0; // (keys Twitch won't take: no game asks again for ten minutes)
const igCan = g => igOn() && Date.now() - igBadAt >= FAIL_WAIT && Date.now() - (igFailAt.get(keyOf(g)) || 0) >= FAIL_WAIT;
// a trailer or gameplay video first (not a teaser, an interview or a review), then IGDB's own order
function rankVideos(list) {
  const L = (Array.isArray(list) ? list : []).filter(v => v && okId(v.video_id)).map(v => ({ id: String(v.video_id), name: String(v.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) }));
  const score = v => /\b(trailer|gameplay)\b/i.test(v.name) && !/\b(teaser|interview|review|commercial|diary)\b/i.test(v.name) ? 0 : /\b(teaser|trailer|gameplay)\b/i.test(v.name) ? 1 : 2;
  const seen = new Set(); return L.map((v, i) => ({ v, i })).sort((a, b) => score(a.v) - score(b.v) || a.i - b.i).map(x => x.v).filter(v => !seen.has(v.id) && seen.add(v.id)).slice(0, 8);
}
function igList(g) {
  const known = igKnown(g); if (known) return Promise.resolve(known);
  if (!igCan(g)) return Promise.resolve([]);
  const k = keyOf(g); if (igFlights.has(k)) return igFlights.get(k);
  const p = (async () => {
    const t = String(g.title || '').replace(/\s*[([].*?[)\]]/g, '').replace(/["\\]/g, '').trim(), pl = plat[g.sysId]; if (!t) return [];
    let L; try { L = await igdb.query('games', `search "${t}"; fields name,videos.video_id,videos.name; where videos != null${pl ? ` & platforms = (${pl})` : ''}; limit 10;`); }
    catch (e) { igFailAt.set(k, Date.now()); log('Trailers: IGDB busy:', (e && e.message) || ''); return []; }
    if (!Array.isArray(L)) { igBadAt = Date.now(); return []; } // (keys Twitch won't take: nothing, and nothing remembered)
    let hit = null; try { hit = igMatch ? igMatch(L.filter(x => x && typeof x.name === 'string' && x.name && Array.isArray(x.videos)), gameArg(g)) : null; } catch {}
    const vids = rankVideos(hit && hit.videos), e = entry(g); e.ig = vids.map(v => [v.id, v.name]); e.igAt = Date.now(); save();
    if (vids.length) log('Trailers: IGDB has', vids.length, 'videos for', g.sysId);
    return vids;
  })().finally(() => igFlights.delete(k));
  igFlights.set(k, p); return p;
}

// ---------- 3 / 4. the wrong-video guard ----------
// true / false as remembered or worked out from a title already known; undefined: the title has to be asked for.
// ok: [ids]; bad: [[id, when]], a rejection looked at again after BAD_TTL (the guard may have learnt better since)
const BAD_TTL = 30 * 864e5;
function verdictKnown(g, id) {
  const e = peek(g); if ((e.ok || []).includes(id)) return true;
  if ((e.bad || []).some(x => Array.isArray(x) && x[0] === id && Date.now() - (+x[1] || 0) < BAD_TTL)) return false;
  const t = yt && yt.titleKnown ? yt.titleKnown(id) : undefined; if (t === undefined) return undefined;
  return remember(g, id, yt.looksRight(t, g.title), t);
}
function remember(g, id, ok, t) {
  const e = entry(g); e.ok = (e.ok || []).filter(x => x !== id); e.bad = (e.bad || []).filter(x => Array.isArray(x) && x[0] !== id);
  if (ok) e.ok = [id, ...e.ok].slice(0, 10); else e.bad = [[id, Date.now()], ...e.bad].slice(0, 10);
  save();
  if (!ok) log('Trailers: skipped a video that looks like another one:', JSON.stringify(String(t || '').slice(0, 80)));
  return ok;
}
// → true / false, or null when its title can't be had now (no helper, offline): it's tried then, as before
async function verdict(g, id) {
  const k = verdictKnown(g, id); if (k !== undefined) return k;
  const t = await yt.titleOf(id); if (t == null) return null;
  return remember(g, id, yt.looksRight(t, g.title), t);
}

// ---------- the order ----------
// g: { sysId, file, title, sysName, lb (the LaunchBox link's YouTube id, or null), clips (YouTube clips can be made: the
// helper is there and Console trailers is on), choice ('', 'ss', 'none', 'yt:<id>') }. o.quick: no network, only what's
// known: { file, src, id? } | { none } | { yt: id } (YouTube's own player, clips off) | { make: id } (that YouTube video is
// the one: its clip is being made) | NEED (something has to be asked first) | null. Without quick, the same but every step
// is taken (never make / NEED). o.low: made ahead for the games beside the one you're on: ScreenScraper is only looked up
// (its video is downloaded for the game on screen), YouTube clips wait behind every other ask. o is read as it goes: a
// normal ask that joins a low run turns low off (run below).
const fileOf = (f, src, id) => ({ file: f, src, ...(id ? { id } : {}) });
async function ytStep(id, g, o, src) {
  if (!okId(id)) return null;
  if (!g.clips) return { yt: id, src };
  const f = yt.cached(id); if (f) return fileOf(f, src, id);
  if (yt.gone(id)) return null;
  if (o.quick) return { make: id, src };
  o.ytWait = id; const c = await yt.clip(id, { low: !!o.low }); o.ytWait = null; return c ? fileOf(c, src, id) : null;
}
// ScreenScraper's step: the clip, or (low) the lookup only. null: on to the next source (or, low with a clip to come, stop)
async function ssStep(g, o) {
  if (o.low) { const s = await ssLook(g); if (o.low) return s === 'none' ? null : STOP; if (s !== 'has') return null; }
  const c = await ssClip(g); return c ? fileOf(c, 'ss') : null;
}
const STOP = Object.freeze({ stop: true });
async function find(g, o = {}) {
  const q = !!o.quick, ch = String(g.choice || '');
  // your own choice (Change trailer) first
  if (ch === 'none') return { none: true };
  if (ch === 'ss') { const f = ssCached(g); if (f) return fileOf(f, 'ss'); if (!ssCan(g)) return null; if (q) return NEED; const r = await ssStep(g, o); return r === STOP ? null : r; }
  if (ch.startsWith('yt:')) return ytStep(ch.slice(3), g, o, 'yours');
  // 1. ScreenScraper
  { const f = ssCached(g); if (f) return fileOf(f, 'ss'); }
  if (ssCan(g)) { if (q) return NEED; const r = await ssStep(g, o); if (r === STOP) return null; if (r) return r; }
  // 2. IGDB
  let L = igKnown(g); if (L === undefined && igCan(g)) { if (q) return NEED; L = await igList(g); }
  for (const v of (L || []).slice(0, 2)) { if (g.clips && yt.gone(v.id)) continue; const r = await ytStep(v.id, g, o, 'igdb'); if (r) return r; }
  // 3. LaunchBox's link, if it's this game's
  if (g.lb && okId(g.lb)) {
    if (!g.clips) { if (verdictKnown(g, g.lb) !== false) return { yt: g.lb, src: 'lb' }; }
    else if (!yt.gone(g.lb)) {
      const ok = verdictKnown(g, g.lb);
      if (ok === true) { const r = await ytStep(g.lb, g, o, 'lb'); if (r) return r; }
      else if (ok === undefined) {
        // a clip kept from before its title was known plays now; the title is checked in the background (a wrong one isn't
        // played again). A new link: the clip's own helper run tells its title, checked before it's played
        const f = yt.cached(g.lb); if (f) { verdict(g, g.lb).catch(() => {}); return fileOf(f, 'lb', g.lb); }
        if (q) return NEED;
        const r = await ytStep(g.lb, g, o, 'lb'); let v = verdictKnown(g, g.lb); if (r && v === undefined) v = await verdict(g, g.lb);
        if (r && v !== false) return r;
      }
    }
  }
  // 4. a YouTube search (its results pass the same guard: ytclips.rankResults)
  if (g.clips && g.title) {
    const known = yt.searchKnown(g.title, g.sysId); if (known === null) return null;
    if (known) { const f = yt.cached(known); if (f) return fileOf(f, 'search', known); if (q && !yt.gone(known)) return { make: known, src: 'search' }; }
    if (q) return NEED;
    const x = await yt.clipFromSearch(g.title, g.sysId, g.sysName, { low: !!o.low }); return x ? fileOf(x.file, 'search', x.id) : null;
  }
  return null;
}
// the whole order for a game, once at a time (the shelf, Details and the warm-up ask together). A normal ask that finds a
// low one running turns it normal (the clip it waits for is asked for again at once, which raises it in ytclips' queue), and
// if that run still ends with nothing (it stopped short as a low one), the order is run again as a normal ask
function run(g, o = {}) {
  const k = keyOf(g) + '|' + (g.choice || ''), cur = runs.get(k);
  if (cur) {
    if (o.low || (!cur.o.low && !cur.joined)) return cur.p;
    if (!cur.joined) { cur.o.low = false; if (cur.o.ytWait && g.clips) yt.clip(cur.o.ytWait).catch(() => {}); cur.joined = cur.p.then(r => (r && (r.file || r.none || r.yt) ? r : run(g, {}))); }
    return cur.joined;
  }
  const ro = { low: !!o.low }, p = find(g, ro).catch(e => { log('Trailers:', (e && e.message) || e); return null; }).finally(() => runs.delete(k));
  runs.set(k, { p, o: ro }); return p;
}

// ---------- Change trailer: what there is to pick from ----------
// [{ key: 'ss' | 'yt:<id>', label, from }] (ScreenScraper, IGDB, LaunchBox, YouTube search), each asked for now if need be
async function choices(g) {
  const out = [], add = c => { if (!out.some(x => x.key === c.key)) out.push(c); };
  if (ss && ssOn()) { let has = !!ssCached(g);
    if (!has && !ssNone(g)) { try { const v = await ss.video(g.sysId, gameArg(g), { match, discId }); has = !!v; if (!v) ssMarkNone(g); } catch (e) { log('Trailers: ScreenScraper busy:', (e && e.message) || ''); } }
    if (has) add({ key: 'ss', label: 'Gameplay clip', from: 'ScreenScraper' }); }
  if (igOn() || igKnown(g)) { for (const v of (await igList(g)).slice(0, 4)) add({ key: 'yt:' + v.id, label: v.name || 'Trailer', from: 'IGDB' }); }
  if (g.lb && okId(g.lb)) { let t = yt.titleKnown(g.lb); if (t === undefined && g.clips) t = await yt.titleOf(g.lb);
    const bad = typeof t === 'string' && !yt.looksRight(t, g.title);
    add({ key: 'yt:' + g.lb, label: t || 'Trailer link', from: 'LaunchBox', note: yt.gone(g.lb) ? 'No longer on YouTube' : bad ? 'Looks like another video' : '' }); }
  if (g.clips && g.title) { try { const ids = await yt.searchList(g.title, g.sysId, g.sysName); if (ids[0]) add({ key: 'yt:' + ids[0], label: yt.titleKnown(ids[0]) || 'Trailer', from: 'YouTube search' }); } catch {} }
  return { cur: String(g.choice || ''), list: out };
}
// the choice as it's saved: '', 'ss', 'none' or 'yt:<id>' (a YouTube link or id pasted is made into 'yt:<id>'); null: not one
function parseChoice(v, youtubeId) {
  const s = String(v == null ? '' : v).trim(); if (s === '' || s === 'ss' || s === 'none') return s;
  if (/^yt:[\w-]{6,20}$/.test(s)) return s;
  const id = youtubeId ? youtubeId(s) : null; if (id) return 'yt:' + id;
  return /^[\w-]{11}$/.test(s) ? 'yt:' + s : null; // (a bare video id: YouTube's are 11 characters)
}

module.exports = { init, find, run, choices, parseChoice, ssClip, igList, verdict, rankVideos, NEED, _t: { keyOf, hashOf, ssOut, load: () => load(), reset: () => { memo = null; igBadAt = 0; ssFlights.clear(); ssFailAt.clear(); igFlights.clear(); igFailAt.clear(); runs.clear(); } } };
