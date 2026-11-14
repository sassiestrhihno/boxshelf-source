// Customize → Logo → Find a logo: a hand-picked list of official console logos on Wikimedia Commons. No account, no key:
// each entry is the file's fixed address on upload.wikimedia.org (SVGs as Commons' own 960px PNG render, a standard size its
// thumbnailer always serves), checked by hand to be the real logo and Public domain / CC0 (no credit needed). If upload.wikimedia.org
// refuses a render, the same path on thumb.wikimedia.org (where Commons now hands out its renders) is tried once.
// Files are cached a week in userData/logo-find/<id>/. Keys are made here; a download takes only a key, never an address from the screen.
// (beta.14) search() adds more from a Commons search for any console (see TERMS); its results' addresses stay here too.
const fs = require('fs');
const path = require('path');

const VER = (() => { try { return require('../package.json').version; } catch { return '0'; } })();
const UA = `Boxshelf/${VER} (personal emulator front end for TVs) Electron`;
const TTL = 7 * 864e5, TIMEOUT = 15000, MAX_BYTES = 6 * 1048576;
const HOSTS = ['https://upload.wikimedia.org/wikipedia/commons/', 'https://thumb.wikimedia.org/wikipedia/commons/'];
// per console: [label, licence, path under /wikipedia/commons/] — best first
const CON = {
  gc: [
    ["GameCube wordmark", "Public domain", "thumb/2/29/Nintendo_GameCube_Official_Logo.svg/960px-Nintendo_GameCube_Official_Logo.svg.png"],
    ["GameCube cube symbol", "CC0", "thumb/7/72/Nintendo_GameCube_symbol_logo.svg/960px-Nintendo_GameCube_symbol_logo.svg.png"]
  ],
  wii: [
    ["Wii logo", "Public domain", "thumb/b/bc/Wii.svg/960px-Wii.svg.png"]
  ],
  wiiu: [
    ["Wii U logo", "Public domain", "thumb/7/7e/WiiU.svg/960px-WiiU.svg.png"]
  ],
  sw: [
    ["Switch logo, wide", "Public domain", "a/a0/Nintendo_Switch_logo%2C_horizontal.png"],
    ["Switch logo, stacked", "Public domain", "thumb/5/5d/Nintendo_Switch_Logo.svg/960px-Nintendo_Switch_Logo.svg.png"],
    ["Switch logo, red", "Public domain", "thumb/f/f0/Nintendo_Switch_logo.svg/960px-Nintendo_Switch_logo.svg.png"]
  ],
  n3ds: [
    ["3DS logo", "Public domain", "thumb/8/89/Nintendo_3DS_logo.svg/960px-Nintendo_3DS_logo.svg.png"],
    ["3DS XL logo", "Public domain", "thumb/9/9e/Nintendo_3DS_XL_logo.svg/960px-Nintendo_3DS_XL_logo.svg.png"],
    ["New 3DS logo", "Public domain", "thumb/b/be/New_Nintendo_3DS_logo.svg/960px-New_Nintendo_3DS_logo.svg.png"]
  ],
  ps2: [
    ["PS2 logo", "Public domain", "thumb/7/76/PlayStation_2_logo.svg/960px-PlayStation_2_logo.svg.png"],
    ["PlayStation 2 wordmark", "Public domain", "thumb/8/8a/PlayStation_2_wordmark.svg/960px-PlayStation_2_wordmark.svg.png"]
  ],
  ps3: [
    ["PS3 logo", "Public domain", "thumb/0/05/PlayStation_3_logo_%282009%29.svg/960px-PlayStation_3_logo_%282009%29.svg.png"],
    ["PS3 logo, wide", "Public domain", "thumb/d/d9/PlayStation_3_Logo.svg/960px-PlayStation_3_Logo.svg.png"],
    ["PlayStation 3 launch wordmark", "Public domain", "thumb/a/a3/Logo_of_the_PlayStation_3_%282006%E2%80%932009%29.svg/960px-Logo_of_the_PlayStation_3_%282006%E2%80%932009%29.svg.png"]
  ],
  ps4: [
    ["PS4 logo with symbol", "Public domain", "thumb/8/87/PlayStation_4_logo_and_wordmark.svg/960px-PlayStation_4_logo_and_wordmark.svg.png"],
    ["PS4 logo", "Public domain", "thumb/c/c4/PlayStation_4_-_Logo.svg/960px-PlayStation_4_-_Logo.svg.png"]
  ],
  psp: [
    ["PSP logo", "Public domain", "thumb/0/0e/PSP_Logo.svg/960px-PSP_Logo.svg.png"]
  ],
  x360: [
    ["Xbox 360 logo", "Public domain", "thumb/1/1b/Xbox_360_logo.svg/960px-Xbox_360_logo.svg.png"],
    ["Xbox 360 logo with TM", "Public domain", "thumb/1/18/Xbox_360_wordmark.svg/960px-Xbox_360_wordmark.svg.png"],
    ["Xbox 360 logo, alternate", "Public domain", "thumb/8/85/X_Box_360_logo.svg/960px-X_Box_360_logo.svg.png"]
  ]
};

// (beta.14) Search Commons too, for every console: what to search for, and what a file's title must contain to count as that
// console's logo (Commons' search also returns game logos and photos). Arcade and DOS have no one logo, so they aren't searched.
const TERMS = {
  gc: ['Nintendo GameCube', /gamecube/i], wii: ['Wii', /\bwii\b(?![ _-]?u\b)/i], wiiu: ['Wii U', /wii[ _-]?u\b/i],
  sw: ['Nintendo Switch', /switch(?![ _-]?2)/i], sw2: ['Nintendo Switch 2', /switch[ _-]?2/i],
  psp: ['PlayStation Portable', /\bpsp\b|playstation[ _-]?portable/i], ps2: ['PlayStation 2', /\bps2\b|playstation[ _-]?2/i],
  ps3: ['PlayStation 3', /\bps3\b|playstation[ _-]?3/i], ps4: ['PlayStation 4', /\bps4\b|playstation[ _-]?4/i], ps5: ['PlayStation 5', /\bps5\b|playstation[ _-]?5/i],
  x360: ['Xbox 360', /xbox[ _-]?360/i], xbox: ['Xbox', /\bxbox\b(?![ _-]*(360|one|series|live|game ?pass|wireless|kinect|app|studios|network|controller|cloud))/i], n3ds: ['Nintendo 3DS', /\b3ds\b/i],
  psx: ['PlayStation', /\bps1\b|\bpsx\b|playstation(?![ _-]*(\d|portable|plus|vr|vita|network|store|studios|now|move))/i],
  nes: ['Nintendo Entertainment System', /\bnes\b|entertainment[ _-]?system|famicom/i], snes: ['Super Nintendo', /\bsnes\b|super[ _-]?nintendo|super[ _-]?famicom/i],
  n64: ['Nintendo 64', /nintendo[ _-]?64|\bn64\b/i], gb: ['Game Boy', /game[ _-]?boy(?![ _-]?(colou?r|advance|micro|pocket|light|player))/i],
  gbc: ['Game Boy Color', /game[ _-]?boy[ _-]?colou?r/i], gba: ['Game Boy Advance', /game[ _-]?boy[ _-]?advance|\bgba\b/i], nds: ['Nintendo DS', /nintendo[ _-]?ds|\bnds\b/i],
  megadrive: [['Mega Drive', 'Sega Genesis'], /mega[ _-]?drive|genesis/i], mastersystem: ['Master System', /master[ _-]?system/i], gamegear: ['Game Gear', /game[ _-]?gear/i],
  dreamcast: ['Dreamcast', /dreamcast/i], saturn: ['Sega Saturn', /saturn/i], pcengine: ['TurboGrafx-16', /turbografx|pc[ _-]?engine/i], neogeo: ['Neo Geo', /neo[ _-]?geo/i],
  segacd: ['Sega CD', /sega[ _-]?cd|mega[ _-]?cd/i], sega32x: ['Sega 32X', /32x/i], atari2600: ['Atari 2600', /2600/i], atarilynx: ['Atari Lynx', /lynx/i],
  wonderswan: ['WonderSwan', /wonder[ _-]?swan/i]
};
const OK_LICENCE = /public domain|^pd\b|cc0|cc[ -]by/i, OK_MIME = ['image/png', 'image/svg+xml', 'image/webp'];
const SEARCH_TTL = 3600e3, found = new Map(); // console id → { at, list: [{ key, source, label, licence, by, url }] }
const API = 'https://commons.wikimedia.org/w/api.php';
const URL_OK = u => /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/commons\//.test(u);

let log = () => {}, fetchFn = null;
function init(o = {}) { log = o.log || log; fetchFn = o.fetch || null; }
const ids = () => Object.keys(CON);
const searchable = id => !!TERMS[id];
const doFetch = u => (fetchFn || require('electron').net.fetch)(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' });
let active = 0; const waitq = [];
async function limited(fn) { while (active >= 2) await new Promise(r => waitq.push(r)); active++; try { return await fn(); } finally { active--; const n = waitq.shift(); if (n) n(); } }
const items = id => (CON[id] || []).map(([label, licence, p], i) => ({ key: 'cm-' + id + '-' + i, source: 'commons', label, licence, by: '', p }));
const pub = ({ key, source, label, licence, by }) => ({ key, source, label, licence, by });

// { list: [{ key, source, label, licence, by }] } (no addresses: those stay here). A console with no hand-picked logos gets an empty list.
async function list(id) {
  if (!CON[id] && !TERMS[id]) throw new Error('Unknown system.');
  return { list: items(id).map(pub) };
}
const plain = h => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
// (beta.14) more logos for a console from a Commons search: only free files (public domain, CC0, CC BY), only pictures that can be
// see-through (PNG, SVG drawn as PNG, WebP), only files whose title names the console, never the hand-picked ones again. Kept an hour.
async function search(id) {
  const T = TERMS[id]; if (!T) return { list: [] };
  const c = found.get(id); if (c && Date.now() - c.at < SEARCH_TTL) return { list: c.list.map(pub) };
  const pages = [];
  for (const term of [].concat(T[0])) {
    const q = `intitle:logo "${term}"`;
    const u = `${API}?action=query&format=json&formatversion=2&generator=search&gsrnamespace=6&gsrlimit=30&gsrsearch=${encodeURIComponent(q)}&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=960&iiextmetadatafilter=LicenseShortName|Artist&origin=*`;
    let r; try { r = await limited(() => doFetch(u)); } catch { const e = new Error("Couldn't reach Wikimedia Commons. Check the internet connection and try again."); e.code = 'offline'; throw e; }
    if (!r.ok) throw new Error('Wikimedia Commons answered ' + r.status);
    let j; try { j = await r.json(); } catch { throw new Error("Wikimedia Commons sent something Boxshelf couldn't read."); }
    const got = ((j && j.query && j.query.pages) || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const p of got) if (p && !pages.some(x => x.title === p.title)) pages.push(p);
  }
  const have = new Set((CON[id] || []).map(x => decodeURIComponent(x[2].split('/').pop()).replace(/^\d+px-/, '').replace(/\.png$/i, '').toLowerCase()));
  // a game's logo names its console only in brackets ("Donkey Kong (Game Boy) logo"): those go last
  const side = p => T[1].test(String(p.title || '').replace(/\([^)]*\)/g, '')) ? 0 : 1;
  pages.forEach((p, i) => { p._o = i; }); pages.sort((a, b) => side(a) - side(b) || a._o - b._o);
  const out = [];
  for (const p of pages) {
    const ii = p && p.imageinfo && p.imageinfo[0]; if (!ii) continue;
    const name = String(p.title || '').replace(/^File:/, ''), md = ii.extmetadata || {};
    const licence = plain(md.LicenseShortName && md.LicenseShortName.value);
    if (!OK_MIME.includes(ii.mime) || !OK_LICENCE.test(licence) || !T[1].test(name) || (ii.width || 0) < 120) continue;
    if (have.has(name.toLowerCase())) continue;
    const url = String((ii.mime === 'image/svg+xml' || (ii.width || 0) > 960) ? (ii.thumburl || '') : (ii.url || '')).split('?')[0];
    if (!URL_OK(url)) continue;
    out.push({ key: 'cs-' + id + '-' + out.length, source: 'commons', label: name.replace(/\.(svg|png|webp)$/i, '').replace(/_/g, ' ').slice(0, 60), licence, by: /^(public domain|cc0)/i.test(licence) ? '' : plain(md.Artist && md.Artist.value), url });
    if (out.length >= 10) break;
  }
  found.set(id, { at: Date.now(), list: out });
  return { list: out.map(pub) };
}
const KIND = b => b.length <= 64 ? null : (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e) ? '.png' : (b[0] === 0xff && b[1] === 0xd8) ? '.jpg'
  : (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') ? '.webp' : null;
const PIC = b => !!KIND(b);
// one key (from this console's list, or its last search) → { file, ext, source }
async function file(id, key, dir) {
  if ((!CON[id] && !TERMS[id]) || typeof key !== 'string') throw new Error('Unknown logo.');
  const fromSearch = key.startsWith('cs-'), s = fromSearch && found.get(id);
  const m = fromSearch ? (s && s.list.find(x => x.key === key)) : items(id).find(x => x.key === key); if (!m) throw new Error('That logo is no longer offered.');
  const d = path.join(dir, id), base = path.join(d, (fromSearch ? 'cs-' + require('crypto').createHash('sha1').update(m.url).digest('hex').slice(0, 16) : key).replace(/[^a-z0-9-]/gi, '_'));
  let have = null; for (const ext of ['.png', '.jpg', '.webp']) { try { const st = fs.statSync(base + ext); if (st.size > 64) { have = { file: base + ext, ext, fresh: Date.now() - st.mtimeMs < TTL }; break; } } catch {} }
  if (have && have.fresh) return { file: have.file, ext: have.ext, source: m.source };
  let last = null;
  const urls = fromSearch ? [m.url] : (m.p.startsWith('thumb/') ? HOSTS : HOSTS.slice(0, 1)).map(h => h + m.p);
  for (const u of urls) {
    let r; try { r = await limited(() => doFetch(u)); } catch (e) { last = new Error("Couldn't reach Wikimedia Commons. Check the internet connection and try again."); last.code = 'offline'; continue; }
    if (!r.ok) { last = new Error('Wikimedia Commons answered ' + r.status); if (r.status === 404) last.code = 'missing'; continue; }
    const b = Buffer.from(await r.arrayBuffer()), ext = KIND(b); if (b.length > MAX_BYTES || !ext) { last = Object.assign(new Error("That file isn't a picture."), { code: 'missing' }); continue; }
    fs.mkdirSync(d, { recursive: true }); const f = base + ext;
    for (const o of ['.png', '.jpg', '.webp']) if (o !== ext) try { fs.unlinkSync(base + o); } catch {}
    await fs.promises.writeFile(f + '.part', b); await fs.promises.rename(f + '.part', f);
    return { file: f, ext, source: m.source };
  }
  if (have) return { file: have.file, ext: have.ext, source: m.source }; // offline (or refused) a week later: the copy from last time still serves
  log('Find a logo:', id, key, last && last.message); throw last || new Error("Couldn't get that logo.");
}
module.exports = { init, list, search, file, ids, searchable, _t: { CON, TERMS, items, PIC, reset: () => found.clear() } };
