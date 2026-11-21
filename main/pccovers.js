// (beta.5) Choosing a PC game's art (front, back, spine, disc): Steam, Epic, GOG, Playnite, Quiver and custom games.
// Chosen art is kept as data\pc-covers\<game id>[-back|-spine|-disc].<ext> and wins over automatic art; Reset clears it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let o = { dataDir: '', log: () => {} };
const EXTS = ['jpg', 'png', 'webp'];
const PARTS = ['front', 'back', 'spine', 'disc'];
const SUFFIX = { front: '', back: '-back', spine: '-spine', disc: '-disc' };
const partOf = p => PARTS.includes(p) ? p : 'front';
const safeId = id => String(id || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 120);
const dir = () => path.join(o.dataDir, 'pc-covers'), cacheDir = () => path.join(o.dataDir, 'pc-cover-cache');
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const sha = s => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 24);
const steamArt = (appid, name) => [`https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/${name}`, `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/${name}`]; // (Steam's public store CDN, as steamart.js)
const { isImageBuf: isImg } = require('./imgcheck'); // (beta.10: PNG / JPEG / WebP / GIF / BMP / AVIF by its first bytes)
const extOf = (u, buf) => { if (buf && buf[0] === 0x89 && buf[1] === 0x50) return 'png'; if (buf && buf.slice(8, 12).toString() === 'WEBP') return 'webp'; const m = /\.(png|webp|jpe?g)(?:$|\?)/i.exec(String(u || '')); return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'; };

function init(opts) { o = Object.assign(o, opts || {}); }

// the chosen art of a game for one part ('front' | 'back' | 'spine' | 'disc'), or null
function cover(id, part = 'front') {
  const b = path.join(dir(), safeId(id) + SUFFIX[partOf(part)]);
  for (const e of EXTS) if (isFile(b + '.' + e)) return b + '.' + e;
  return null;
}
function art(id) {
  return { front: cover(id, 'front'), back: cover(id, 'back'), spine: cover(id, 'spine'), disc: cover(id, 'disc') };
}
function clear(id, part = 'front') {
  const b = path.join(dir(), safeId(id) + SUFFIX[partOf(part)]);
  for (const e of EXTS) { try { fs.unlinkSync(b + '.' + e); } catch {} }
}
async function save(id, buf, ext, part = 'front') {
  fs.mkdirSync(dir(), { recursive: true });
  const dest = path.join(dir(), safeId(id) + SUFFIX[partOf(part)] + '.' + ext), tmp = dest + '.tmp';
  await fs.promises.writeFile(tmp, buf); clear(id, part); await fs.promises.rename(tmp, dest); return dest;
}

// a thumbnail, fetched once into the cache (three at a time); null when it couldn't be fetched
let slots = 3; const waiting = [];
async function slot(fn) { if (slots > 0) slots--; else await new Promise(r => waiting.push(r)); try { return await fn(); } finally { const n = waiting.shift(); if (n) n(); else slots++; } }
async function thumb(url, cut, sysId) {
  if (!url) return null;
  const cacheKey = cut ? `${url}|${cut}|${sysId || ''}` : url;
  const f = path.join(cacheDir(), sha(cacheKey));
  for (const e of EXTS) if (isFile(f + '.' + e)) return f + '.' + e;
  // (beta.10) only a picture is kept, and through a temp name: a cached thumbnail is trusted whenever it's there
  return slot(async () => {
    let b = await o.fetchImage(url);
    if (!b || !isImg(b)) return null;
    let outExt = extOf(url, b);
    if (cut && o.cutSpine) {
      fs.mkdirSync(cacheDir(), { recursive: true });
      const tmpCut = path.join(cacheDir(), '.tcut-' + process.pid + '-' + sha(cacheKey) + '.' + outExt);
      try {
        await fs.promises.writeFile(tmpCut, b);
        const cb = await o.cutSpine(tmpCut, cut, sysId);
        if (!cb || cb.length < 1500 || !isImg(cb)) return null;
        b = cb; outExt = 'jpg';
      } catch { return null; } finally { await fs.promises.unlink(tmpCut).catch(() => {}); }
    }
    fs.mkdirSync(cacheDir(), { recursive: true });
    const p = f + '.' + outExt, tmp = p + '.tmp';
    try { await fs.promises.writeFile(tmp, b); await fs.promises.rename(tmp, p); } catch (e) { await fs.promises.unlink(tmp).catch(() => {}); o.log('PC cover: thumbnail not saved', e.message); return null; }
    return p;
  });
}

// the options for one game + part: { list: [{ key, thumb, source, label, sub }], sgdb: has a SteamGridDB key, current: chosen?, part }
const last = new Map(); // "<game id>|<part>" → { key → action descriptor }
async function options(game, part = 'front') {
  const p = partOf(part), id = String(game.id), keys = {}, list = [];
  const mine = cover(id, p);
  if (mine) list.push({ key: 'current', thumb: o.fileUrl(mine), source: 'yours', label: 'Your choice now', sub: 'Chosen before' });
  const sgdb = !!(o.steamgrid && o.steamgrid.enabled && o.steamgrid.enabled());

  if (p === 'front') {
    if (game.appid) { const s = o.steamCover(game.appid); if (s) { keys.steam = { file: s }; list.push({ key: 'steam', thumb: o.fileUrl(s), source: 'steam', label: "Steam's cover", sub: 'From your Steam library' }); } }
    // (beta.9) with no key at all: Steam's official cover from its public store (no account)
    try {
      const apps = game.appid ? (keys.steam ? [] : [{ id: String(game.appid), name: '' }]) : (o.steamSearch ? await o.steamSearch(game.title, !game.term) : []);
      const got = await Promise.all(apps.map(async (a, i) => ({ a, i, t: await thumb(steamArt(a.id, 'library_600x900.jpg')[0]) || await thumb(steamArt(a.id, 'library_600x900.jpg')[1]) })));
      for (const { a, i, t } of got) { if (!t) continue; const k = 'st' + i; keys[k] = { urls: [...steamArt(a.id, 'library_600x900_2x.jpg'), ...steamArt(a.id, 'library_600x900.jpg')] };
        list.push({ key: k, thumb: o.fileUrl(t), source: 'steamstore', label: "Steam's cover", sub: a.name ? `${a.name} on Steam` : "From Steam's store" }); }
    } catch (e) { o.log('PC cover: Steam store', e.message); }
    if (sgdb) {
      let posters = [];
      try { posters = await o.steamgrid.posters(game.appid ? { appid: game.appid, title: game.title } : { title: game.title, names: [game.title], term: !!game.term }, o.match); } catch (e) { o.log('PC cover: SteamGridDB', e.message); }
      const got = await Promise.all(posters.slice(0, 24).map(async (x, i) => ({ x, i, t: await thumb(x.thumbUrl || x.url) })));
      for (const { x, i, t } of got) { if (!t) continue; const k = 'sg' + i; keys[k] = { url: x.url }; list.push({ key: k, thumb: o.fileUrl(t), source: 'steamgriddb', label: x.styleName ? `SteamGridDB · ${x.styleName}` : 'SteamGridDB', sub: x.author ? 'by ' + x.author : '' }); }
    }
    if (o.igdbCover) {
      try {
        const u = await o.igdbCover(game);
        if (u) { const t = await thumb(u); if (t) { keys.ig0 = { url: u }; list.push({ key: 'ig0', thumb: o.fileUrl(t), source: 'igdb', label: 'IGDB', sub: 'Game database cover' }); } }
      } catch (e) { o.log('PC cover: IGDB', e.message); }
    }
  } else {
    if (p === 'disc' && sgdb && o.steamgrid.icons) {
      let icons = [];
      try { icons = await o.steamgrid.icons(game.appid ? { appid: game.appid, title: game.title } : { title: game.title, names: [game.title], term: !!game.term }, o.match); } catch (e) { o.log('PC disc: SteamGridDB', e.message); }
      const got = await Promise.all(icons.slice(0, 16).map(async (x, i) => ({ x, i, t: await thumb(x.thumbUrl || x.url) })));
      for (const { x, i, t } of got) { if (!t) continue; const k = 'sg' + i; keys[k] = { url: x.url }; list.push({ key: k, thumb: o.fileUrl(t), source: 'steamgriddb', label: 'SteamGridDB · Icon', sub: x.author ? 'by ' + x.author : '' }); }
    }
  }

  if (o.lbCands) {
    try {
      const cands = await o.lbCands(game, p);
      const got = await Promise.all((cands || []).slice(0, 16).map(async (c, i) => ({ c, i, t: await thumb(c.url, c.cut, c.sysId) })));
      for (const { c, i, t } of got) {
        if (!t) continue;
        const k = 'lb' + i;
        keys[k] = { file: t, url: c.url, ...(c.cut ? { cut: c.cut, sysId: c.sysId } : {}) };
        list.push({ key: k, thumb: o.fileUrl(t), source: 'launchbox', label: c.label || 'LaunchBox', sub: 'LaunchBox DB' });
      }
    } catch (e) { o.log('PC art: LaunchBox', p, e.message); }
  }

  if (p !== 'front' && o.makePart) {
    const isCartShelf = new Set(['sw', 'sw2', 'n3ds', 'nds', 'gba', 'gbc', 'gb', 'n64', 'snes', 'nes', 'megadrive', 'mastersystem', 'gamegear', 'pcengine', 'neogeo', 's32x', 'atari2600', 'lynx', 'wonderswan']).has(String(game.shelf || ''));
    const madeInfo = {
      back: { label: 'Back made by Boxshelf', sub: 'Cover, screenshots & synopsis' },
      spine: { label: 'Spine made by Boxshelf', sub: 'Cover colour & game logo' },
      disc: isCartShelf ? { label: 'Cartridge made by Boxshelf', sub: 'Cover art & game card' } : { label: 'Disc made by Boxshelf', sub: 'Cover art & game logo' }
    }[p];
    const frontChosen = cover(id, 'front');
    let frontStamp = '';
    if (frontChosen) { try { frontStamp = String(Math.floor(fs.statSync(frontChosen).mtimeMs)); } catch {} }
    const madeBase = path.join(cacheDir(), 'made-' + p + '-' + sha(`${id}|${game.title || ''}|${game.appid || ''}|${game.shelf || ''}|${frontChosen || ''}|${frontStamp}`));
    let madeFile = null;
    for (const e of EXTS) if (isFile(madeBase + '.' + e)) { madeFile = madeBase + '.' + e; break; }
    const madeGame = { id, title: game.title, appid: game.appid, ...(game.shelf ? { shelf: game.shelf } : {}), term: !!game.term };
    if (!madeFile) {
      try {
        const r = await o.makePart(p, madeGame);
        if (r && r.buf && isImg(r.buf)) {
          fs.mkdirSync(cacheDir(), { recursive: true });
          const dest = madeBase + '.' + (r.ext || (p === 'disc' ? 'png' : 'jpg'));
          const tmp = dest + '.tmp';
          await fs.promises.writeFile(tmp, r.buf);
          await fs.promises.rename(tmp, dest);
          madeFile = dest;
        }
      } catch (e) { o.log('PC art: made preview', p, e.message); }
    }
    keys.made = madeFile ? { file: madeFile, made: p, game: madeGame } : { made: p, game: madeGame };
    list.push({ key: 'made', thumb: madeFile ? o.fileUrl(madeFile) : '', source: 'made', icon: '✦', label: madeInfo.label, sub: madeInfo.sub });
  }

  last.set(id + '|' + p, keys);
  return { list, sgdb, current: !!mine, part: p, shelf: game.shelf || '' };
}

// use one of the last options (by key) as the game's art for one part
async function use(id, key, part = 'front') {
  const p = partOf(part);
  id = String(id);
  const k = (last.get(id + '|' + p) || {})[String(key || '')];
  if (!k) throw new Error('That cover isn\'t in the list any more. Open the picker again.');
  let buf = null, ext = 'jpg';
  if (k.file && isFile(k.file)) {
    buf = await fs.promises.readFile(k.file); ext = extOf(k.file, buf);
  } else if (k.made) {
    if (!o.makePart) throw new Error('Art generation isn\'t available.');
    const r = await o.makePart(k.made, k.game);
    if (!r || !r.buf) throw new Error('Could not generate art (choose a front cover first).');
    buf = r.buf; ext = r.ext || 'jpg';
  } else if (k.url || k.urls) {
    const us = k.urls || [k.url]; let u = null;
    for (const x of us) { buf = await o.fetchImage(x); if (buf && isImg(buf)) { u = x; break; } buf = null; }
    if (!buf) throw new Error("Couldn't download that cover. Check the connection and try again.");
    ext = extOf(u, buf);
    if (k.cut && o.cutSpine) {
      fs.mkdirSync(cacheDir(), { recursive: true });
      const tmp = path.join(cacheDir(), '.cut-' + process.pid + '-' + sha(u) + '.' + ext);
      try {
        await fs.promises.writeFile(tmp, buf);
        const cut = await o.cutSpine(tmp, k.cut, k.sysId);
        if (cut && cut.length > 1500) { buf = cut; ext = 'jpg'; }
      } finally { await fs.promises.unlink(tmp).catch(() => {}); }
    }
  }
  const dest = await save(id, buf, ext, p);
  o.log('PC art chosen:', id, p, key.startsWith('sg') ? 'SteamGridDB' : key.startsWith('st') ? "Steam's store" : key.startsWith('lb') ? 'LaunchBox' : key);
  return dest;
}

// a picture of your own (a file the player picked in the dialog)
async function own(id, file, part = 'front') {
  const ext = String(path.extname(file)).slice(1).toLowerCase().replace('jpeg', 'jpg'); if (!EXTS.includes(ext)) throw new Error('Pick a JPG, PNG or WebP picture.');
  const st = await fs.promises.stat(file); if (st.size > 25e6) throw new Error('That picture is too big (over 25 MB).');
  return save(String(id), await fs.promises.readFile(file), ext, part);
}

// Try downloading/reading one candidate from `cands` (buffer verified as an image) and save it as front art.
async function saveFirstFrontCand(id, list, onBeforeSave) {
  for (const cand of list.slice(0, 4)) {
    let buf = null, usedUrl = cand.file || '';
    try {
      if (cand.file) {
        const raw = await fs.promises.readFile(cand.file);
        if (raw && isImg(raw)) buf = raw;
      } else {
        const urls = cand.urls || (cand.url ? [cand.url] : []);
        for (const u of urls) {
          const raw = await o.fetchImage(u);
          if (raw && isImg(raw)) { buf = raw; usedUrl = u; break; }
        }
      }
    } catch {}
    if (!buf) continue;
    if (typeof onBeforeSave === 'function') await onBeforeSave();
    const dest = await save(id, buf, extOf(usedUrl, buf), 'front');
    o.log('PC art chosen (fast):', id, 'front', cand.source);
    return { dest, source: cand.source, key: cand.key };
  }
  return null;
}

// Fast zero-thumbnail front cover downloader for bulk operations: fetches metadata only, ranks candidates,
// downloads high-confidence sources first, and skips IGDB/LaunchBox unless needed.
async function downloadBestFront(game, rankFn, onBeforeSave) {
  const id = String((game && game.id) || '');
  if (!id) return null;
  const cands = [];
  const sgdb = !!(o.steamgrid && o.steamgrid.enabled && o.steamgrid.enabled());

  if (game.appid && o.steamCover) {
    const s = o.steamCover(game.appid);
    if (s) cands.push({ key: 'steam', source: 'steam', label: "Steam's cover", sub: 'From your Steam library', file: s });
  }
  const hasLocalSteam = cands.some(c => c.key === 'steam');

  const [storeCands, sgdbCands] = await Promise.all([
    (async () => {
      if (hasLocalSteam) return [];
      try {
        const apps = game.appid ? [{ id: String(game.appid), name: '' }] : (o.steamSearch ? await o.steamSearch(game.title, true) : []);
        return (apps || []).map((a, i) => ({
          key: 'st' + i, source: 'steamstore', label: "Steam's cover",
          sub: a.name ? `${a.name} on Steam` : "From Steam's store",
          urls: [...steamArt(a.id, 'library_600x900_2x.jpg'), ...steamArt(a.id, 'library_600x900.jpg')]
        }));
      } catch (e) { o.log('PC cover (fast): Steam store', e.message); return []; }
    })(),
    (async () => {
      if (!sgdb) return [];
      try {
        const posters = await o.steamgrid.posters(game.appid ? { appid: game.appid, title: game.title } : { title: game.title, names: [game.title] }, o.match);
        return (posters || []).slice(0, 12).map((x, i) => ({
          key: 'sg' + i, source: 'steamgriddb',
          label: x.styleName ? `SteamGridDB · ${x.styleName}` : 'SteamGridDB',
          sub: x.author ? 'by ' + x.author : '',
          url: x.url
        }));
      } catch (e) { o.log('PC cover (fast): SteamGridDB', e.message); return []; }
    })()
  ]);
  cands.push(...storeCands, ...sgdbCands);

  const rank = list => typeof rankFn === 'function' ? (rankFn(list) || []) : list.slice();
  const primaryRanked = rank(cands);
  const topHigh = primaryRanked.filter(c => typeof c._score !== 'number' || c._score >= 85);
  if (topHigh.length) {
    const saved = await saveFirstFrontCand(id, topHigh, onBeforeSave);
    if (saved) return saved;
  }

  const tried = new Set(topHigh.slice(0, 4).map(c => c.key));
  const [igCand, lbList] = await Promise.all([
    (async () => {
      if (!o.igdbCover) return null;
      try {
        const u = await o.igdbCover(game);
        return u ? { key: 'ig0', source: 'igdb', label: 'IGDB', sub: 'Game database cover', url: u } : null;
      } catch (e) { o.log('PC cover (fast): IGDB', e.message); return null; }
    })(),
    (async () => {
      if (!o.lbCands) return [];
      try {
        const list = await o.lbCands(game, 'front');
        return (list || []).slice(0, 8).map((c, i) => ({
          key: 'lb' + i, source: 'launchbox', label: c.label || 'LaunchBox', sub: 'LaunchBox DB', url: c.url
        }));
      } catch (e) { o.log('PC cover (fast): LaunchBox', e.message); return []; }
    })()
  ]);
  if (igCand) cands.push(igCand);
  if (lbList && lbList.length) cands.push(...lbList);

  const rest = rank(cands.filter(c => !tried.has(c.key)));
  return saveFirstFrontCand(id, rest, onBeforeSave);
}

module.exports = { init, cover, art, save, thumb, options, use, own, downloadBestFront, reset: (id, part = 'front') => clear(String(id), part), PARTS, SUFFIX };
