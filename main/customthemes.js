// Custom themes (1.76, Windows): a picture behind the shelf, made by the user. Each one is a folder in "Custom themes"
// beside Boxshelf:
//   background.jpg / .png / .webp / .svg   the picture (required; a folder with a single picture uses that one)
//   gc.jpg, ps2.png, …                     optional: a picture for one console's shelf (named after its id)
//   theme.json                             optional: { "name", "accent": "#rrggbb", "shade": 0-0.9, "blur": true/false,
//                                          "glow": 0-1 } (anything missing gets a default; the accent is taken from the
//                                          picture's average colour)
// Only pictures and these few settings: a theme never runs code. Big pictures are scaled once to 2560 px wide and kept
// in a cache (keyed by file, date and size), so the shelf never decodes a 6000 px photo. The first time the folder is
// looked at it's created with three example themes (pictures drawn here as SVG), which show the format.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

let ROOT = '', CACHE = '', nativeImage = null, sysIds = new Set(), log = () => {};
function init(o) { ROOT = o.root; CACHE = o.cache; nativeImage = o.nativeImage || null; sysIds = new Set(o.systems || []); if (o.log) log = o.log; }
function root() { return ROOT; }

const PIC = /\.(jpe?g|png|webp|svg)$/i, RASTER = /\.(jpe?g|png)$/i; // (webp: nativeImage can't decode it, served as it is)
const MAX_W = 2560, MAX_THEMES = 60, MAX_JSON = 64 * 1024;
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const clamp = (v, lo, hi, d) => { const n = +v; return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const isHex = s => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s.trim());

// a picture ready for the screen: big JPEG / PNG files scaled once into the cache
const prepMemo = new Map();
function prepared(file) {
  let st; try { st = fs.statSync(file); } catch { return null; }
  if (!RASTER.test(file) || !nativeImage) return file;
  const key = file + '|' + Math.floor(st.mtimeMs) + '|' + st.size; if (prepMemo.has(key)) return prepMemo.get(key);
  let out = file;
  try {
    const img = nativeImage.createFromPath(file), sz = img.isEmpty() ? null : img.getSize();
    if (sz && (sz.width > MAX_W * 1.1 || st.size > 6 * 1024 * 1024)) {
      const dst = path.join(CACHE, crypto.createHash('sha1').update(key).digest('hex').slice(0, 24) + '.jpg');
      if (!fs.existsSync(dst)) { fs.mkdirSync(CACHE, { recursive: true }); const tmp = `${dst}.${process.pid}.tmp`; // (beta.10) temp + rename: a cut-off write was trusted from then on
        try { fs.writeFileSync(tmp, img.resize({ width: Math.min(MAX_W, sz.width), quality: 'good' }).toJPEG(88)); fs.renameSync(tmp, dst); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; } }
      out = dst;
    }
  } catch (e) { log('Custom theme: could not prepare', path.basename(file), e.message); }
  prepMemo.set(key, out); return out;
}
// the picture's average colour (a 1 x 1 scale of it), for the selection glow and Settings' accent
const accentMemo = new Map();
function accentOf(file) {
  if (!nativeImage || !RASTER.test(file)) return '#6b8cff';
  if (accentMemo.has(file)) return accentMemo.get(file);
  let hex = '#6b8cff';
  try { const b = nativeImage.createFromPath(file).resize({ width: 1, height: 1, quality: 'good' }).toBitmap(); if (b && b.length >= 3) hex = '#' + [b[2], b[1], b[0]].map(v => v.toString(16).padStart(2, '0')).join(''); } catch {}
  accentMemo.set(file, hex); return hex;
}

function readJson(dir) {
  const f = path.join(dir, 'theme.json');
  try { const st = fs.statSync(f); if (st.size > MAX_JSON) return {}; const o = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
}

function list() {
  ensureExamples();
  let dirs = []; try { dirs = fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isDirectory()).slice(0, MAX_THEMES); } catch { return []; }
  const out = [], seen = new Set();
  for (const d of dirs) {
    const dir = path.join(ROOT, d.name); let files = [];
    try { files = fs.readdirSync(dir, { withFileTypes: true }).filter(e => e.isFile() && PIC.test(e.name)).map(e => e.name); } catch { continue; }
    const bgName = files.find(n => /^background\./i.test(n)) || (files.length === 1 ? files[0] : null); if (!bgName) continue;
    const j = readJson(dir); let id = 'custom-' + (slug(d.name) || 'theme'); for (let n = 2; seen.has(id); n++) id = 'custom-' + slug(d.name) + '-' + n; seen.add(id);
    const bg = prepared(path.join(dir, bgName)); if (!bg) continue;
    const sys = {};
    for (const n of files) { const k = n.replace(PIC, '').toLowerCase(); if (n !== bgName && sysIds.has(k)) { const p = prepared(path.join(dir, n)); if (p) sys[k] = p; } }
    // (beta.14) Make a theme's extras: a night picture, a video loop, and how it looks / moves / sounds (see LOOK below)
    let vids = []; try { vids = fs.readdirSync(dir).filter(n => VIDEO.test(n)); } catch {}
    const nightName = files.find(n => /^night\./i.test(n)), vidName = vids.find(n => /^background\./i.test(n)) || null;
    out.push({ id, name: (typeof j.name === 'string' && j.name.trim() ? j.name.trim() : d.name).slice(0, 40), folder: d.name, bg, sys,
      accent: isHex(j.accent) ? j.accent.trim().toLowerCase() : accentOf(bg), shade: clamp(j.shade, 0, .9, .35), blur: j.blur === true, glow: clamp(j.glow, 0, 1, .35),
      night: nightName && nightName !== bgName ? prepared(path.join(dir, nightName)) : null, video: vidName ? path.join(dir, vidName) : null, ...look(j) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
// a video theme still needs a picture (background.jpg…): its first frame or any still, shown while the video loads and
// at the Low level; a folder with only a video gets a plain dark backdrop picture written beside it
const VIDEO = /\.(mp4|webm)$/i;
// (beta.14) the newer theme.json fields, each checked and given its default when missing (older files keep working)
const ONE = (v, list, d) => (list.includes(v) ? v : d);
function look(j) {
  const soften = j.soften != null ? clamp(j.soften, 0, 22, 0) : (j.blur === true ? 22 : 0); // (an older "blur": true is the 22 px it always was)
  return {
    soften, vignette: clamp(j.vignette, 0, 1, 0), focus: ONE(j.focus, ['center', 'top', 'bottom'], 'center'), floor: ONE(j.floor, ['glow', 'mirror', 'none'], 'glow'),
    motion: ONE(j.motion, ['none', 'drift', 'zoom'], 'none'), particles: ONE(j.particles, ['none', 'dust', 'stars', 'snow', 'sparks'], 'none'), scanlines: j.scanlines === true,
    accentAuto: !isHex(j.accent), sound: typeof j.sound === 'string' && /^[\w-]{1,32}$/.test(j.sound) ? j.sound : '', music: typeof j.music === 'string' && /^[\w-]{1,32}$/.test(j.music) ? j.music : '',
    when: ONE(j.when, ['always', 'evening'], 'always'), shelves: Array.isArray(j.shelves) ? j.shelves.filter(s => typeof s === 'string' && sysIds.has(s)).slice(0, 40) : []
  };
}
function folderOf(id) {
  const t = list().find(x => x.id === id); if (!t) throw new Error('That theme is not there any more.');
  return path.join(ROOT, t.folder);
}
const PIC_OR_VIDEO = /\.(jpe?g|png|webp|svg|mp4|webm)$/i;
// Make a theme → Save: a new folder (or the theme being changed), its pictures copied in under their fixed names, and
// theme.json with everything chosen. files: { background, night, sys: { gc: path… } }, a path or '' to remove (night,
// a console's picture). Returns the theme's id.
function save(o) {
  o = o || {}; const j = o.json && typeof o.json === 'object' ? o.json : {}, files = o.files || {};
  const nm = (String(j.name || '').trim() || 'My theme').slice(0, 40);
  // (beta.14) every chosen file checked first, so a refused one never leaves a half-made theme folder behind
  const chosen = [files.background, files.night, ...Object.values(files.sys || {})].filter(v => v);
  for (const f of chosen) { if (!PIC_OR_VIDEO.test(String(f))) throw new Error('Choose a JPG, PNG, WebP or SVG picture, or an MP4 / WebM video.'); let ok = false; try { ok = fs.statSync(f).isFile(); } catch {} if (!ok) throw new Error('That file is not there any more.'); }
  let dir;
  if (o.id) dir = folderOf(o.id);
  else {
    if (!files.background) throw new Error('Choose a picture for your theme first.');
    const base = nm.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'My theme';
    fs.mkdirSync(ROOT, { recursive: true });
    let folder = base; for (let n = 2; fs.existsSync(path.join(ROOT, folder)); n++) folder = `${base} ${n}`;
    dir = path.join(ROOT, folder); fs.mkdirSync(dir);
  }
  const put = (src, stem) => {
    if (!PIC_OR_VIDEO.test(String(src))) throw new Error('Choose a JPG, PNG, WebP or SVG picture, or an MP4 / WebM video.');
    if (!fs.statSync(src).isFile()) throw new Error('That file is not there any more.');
    const isVid = VIDEO.test(src);
    // the old file of that name goes (another type of picture, or a picture swapped for a video)
    try { for (const n of fs.readdirSync(dir)) if (n.toLowerCase().startsWith(stem + '.') && (isVid ? VIDEO.test(n) : PIC.test(n)) && path.join(dir, n) !== src) fs.unlinkSync(path.join(dir, n)); } catch {}
    const dst = path.join(dir, stem + path.extname(src).toLowerCase()); if (path.resolve(dst) !== path.resolve(src)) fs.copyFileSync(src, dst);
  };
  const drop = stem => { try { for (const n of fs.readdirSync(dir)) if (n.toLowerCase().startsWith(stem + '.') && PIC_OR_VIDEO.test(n)) fs.unlinkSync(path.join(dir, n)); } catch {} };
  if (files.background) {
    put(files.background, 'background');
    // a video: the old still stays as its picture; with none there yet, a dark one is written so the theme still lists
    if (VIDEO.test(files.background)) { let has = false; try { has = fs.readdirSync(dir).some(n => /^background\./i.test(n) && PIC.test(n)); } catch {} if (!has) fs.writeFileSync(path.join(dir, 'background.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#0b0c14"/></svg>`); }
  }
  if (files.video === '') { try { for (const n of fs.readdirSync(dir)) if (/^background\./i.test(n) && VIDEO.test(n)) fs.unlinkSync(path.join(dir, n)); } catch {} }
  if (files.night === '') drop('night'); else if (files.night) put(files.night, 'night');
  for (const [k, v] of Object.entries(files.sys || {})) { if (!sysIds.has(k)) continue; if (v === '') drop(k); else if (v) put(v, k); }
  const out = { name: nm };
  if (isHex(j.accent)) out.accent = j.accent.trim().toLowerCase();
  out.shade = clamp(j.shade, 0, .9, .35); out.glow = clamp(j.glow, 0, 1, .35); out.soften = clamp(j.soften, 0, 22, 0); out.blur = out.soften > 0;
  Object.assign(out, look({ ...j, soften: out.soften })); delete out.accentAuto;
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify(out, null, 2));
  log('Custom theme saved:', path.basename(dir));
  return 'custom-' + (slug(path.basename(dir)) || 'theme');
}
// Remove: the folder goes to the Recycle Bin / Trash (trash is main.js's shell.trashItem)
async function remove(id, trash) { const dir = folderOf(id); if (trash) await trash(dir); else fs.rmSync(dir, { recursive: true, force: true }); log('Custom theme removed:', path.basename(dir)); return true; }

// ---------- Share: a theme as one .zip (a friend adds it with "Add a shared theme") ----------
// A small zip writer and reader of our own (deflate through zlib): only a theme's own files go in, and only those
// (pictures, a video, theme.json, by their fixed names) come out, whatever else the zip holds or however it's laid out.
const zlib = require('zlib');
const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = b => { if (typeof zlib.crc32 === 'function') return zlib.crc32(b) >>> 0; let c = -1; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zipWrite(entries) {
  const parts = [], central = []; let off = 0; const d = new Date(), dt = ((d.getFullYear() - 1980) << 9 | (d.getMonth() + 1) << 5 | d.getDate()) & 0xffff, tm = (d.getHours() << 11 | d.getMinutes() << 5 | (d.getSeconds() >> 1)) & 0xffff;
  for (const { name, data } of entries) {
    const nb = Buffer.from(name, 'utf8'), packed = VIDEO.test(name) || /\.(jpe?g|png|webp)$/i.test(name) ? null : zlib.deflateRawSync(data), body = packed && packed.length < data.length ? packed : data, method = body === data ? 0 : 8, crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8); h.writeUInt16LE(tm, 10); h.writeUInt16LE(dt, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26); h.writeUInt16LE(0, 28);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(method, 10); c.writeUInt16LE(tm, 12); c.writeUInt16LE(dt, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, body); central.push(c, nb); off += 30 + nb.length + body.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
const ZIP_MAX = 200 * 1024 * 1024, ENTRY_MAX = 120 * 1024 * 1024;
function zipRead(buf) {
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("That file isn't a zip.");
  const n = buf.readUInt16LE(e + 10), out = []; let p = buf.readUInt32LE(e + 16);
  for (let k = 0; k < n && p + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'); p += 46 + nl + xl + cl;
    if (/\/$/.test(name) || usize > ENTRY_MAX || lo + 30 > buf.length || buf.readUInt32LE(lo) !== 0x04034b50) continue;
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.slice(ds, ds + csize);
    out.push({ name, get: () => method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: ENTRY_MAX }) : null });
  }
  return out;
}
// export: the theme's folder as <Name>.zip in `destDir` (main.js passes the Desktop); returns the file written
function exportZip(id, destDir) {
  const dir = folderOf(id), entries = [];
  for (const n of fs.readdirSync(dir)) { const f = path.join(dir, n); let st; try { st = fs.statSync(f); } catch { continue; } if (!st.isFile() || st.size > ENTRY_MAX) continue;
    if (n.toLowerCase() === 'theme.json' || PIC_OR_VIDEO.test(n)) entries.push({ name: n, data: fs.readFileSync(f) }); }
  if (!entries.length) throw new Error('That theme has no files to share.');
  const base = path.basename(dir).replace(/[<>:"/\\|?*\x00-\x1f]/g, '') || 'Theme';
  let file = path.join(destDir, `${base} (Boxshelf theme).zip`); for (let k = 2; fs.existsSync(file); k++) file = path.join(destDir, `${base} (Boxshelf theme) ${k}.zip`);
  fs.mkdirSync(destDir, { recursive: true }); fs.writeFileSync(file, zipWrite(entries)); log('Custom theme shared:', path.basename(file));
  return file;
}
// import: a shared theme's .zip becomes a new folder (named after its theme.json, else the zip). Only its pictures, a
// video and theme.json are taken, by their file names alone (folders inside the zip don't matter)
function importZip(file) {
  if (!/\.zip$/i.test(String(file || ''))) throw new Error('Choose a theme .zip file.');
  const st = fs.statSync(file); if (st.size > ZIP_MAX) throw new Error('That zip is too big for a theme.');
  const got = {};
  for (const en of zipRead(fs.readFileSync(file))) {
    const n = en.name.split(/[\\/]/).pop(), low = n.toLowerCase(), stem = low.replace(/\.[^.]+$/, '');
    if (low === 'theme.json' || (PIC_OR_VIDEO.test(n) && (stem === 'background' || stem === 'night' || sysIds.has(stem)))) { if (!got[low]) got[low] = en; }
  }
  if (!Object.keys(got).some(n => /^background\./.test(n))) throw new Error("That zip doesn't hold a Boxshelf theme (no background picture in it).");
  let j = {}; if (got['theme.json']) { try { const o = JSON.parse(String(got['theme.json'].get() || '').replace(/^﻿/, '')); if (o && typeof o === 'object' && !Array.isArray(o)) j = o; } catch {} }
  const nm = (typeof j.name === 'string' && j.name.trim() ? j.name.trim() : path.basename(file).replace(/\.zip$/i, '').replace(/\s*\(Boxshelf theme\)(\s*\d+)?$/i, '')).slice(0, 40) || 'Shared theme';
  const base = nm.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/[. ]+$/, '').trim() || 'Shared theme';
  fs.mkdirSync(ROOT, { recursive: true }); let folder = base; for (let k = 2; fs.existsSync(path.join(ROOT, folder)); k++) folder = `${base} ${k}`;
  const dir = path.join(ROOT, folder); fs.mkdirSync(dir);
  try {
    let total = 0; // (one entry at a time; and no more than 400 MB unpacked in all)
    for (const [n, en] of Object.entries(got)) { const data = en.get(); if (!data) continue; total += data.length; if (total > 400 * 1024 * 1024) throw new Error('it unpacks to more than 400 MB'); if (n === 'theme.json') { fs.writeFileSync(path.join(dir, n), JSON.stringify({ ...j, name: nm }, null, 2)); continue; } fs.writeFileSync(path.join(dir, n), data); }
  } catch (e) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} throw new Error("That theme's zip couldn't be read: " + e.message); }
  log('Custom theme added from a zip:', folder);
  return 'custom-' + (slug(folder) || 'theme');
}

// "Make a theme from a picture": a new folder named after the picture (or the name given), the picture copied in as
// background.<ext>, and a theme.json to edit later. Returns the new theme's id.
function create(file, name) {
  if (!PIC.test(String(file || ''))) throw new Error('Choose a JPG, PNG, WebP or SVG picture.');
  if (!fs.statSync(file).isFile()) throw new Error('That picture is not there any more.');
  const nm = (String(name || '').trim() || path.basename(file).replace(PIC, '').replace(/[_-]+/g, ' ').trim() || 'My theme').slice(0, 40);
  const base = nm.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim() || 'My theme';
  fs.mkdirSync(ROOT, { recursive: true });
  let folder = base; for (let n = 2; fs.existsSync(path.join(ROOT, folder)); n++) folder = `${base} ${n}`;
  const dir = path.join(ROOT, folder); fs.mkdirSync(dir);
  fs.copyFileSync(file, path.join(dir, 'background' + path.extname(file).toLowerCase()));
  fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ name: nm, shade: .35, blur: false, glow: .35 }, null, 2));
  log('Custom theme made:', folder);
  return 'custom-' + (slug(folder) || 'theme');
}

// ---------- the examples (written once, when the folder doesn't exist yet) ----------
function seeded(s) { return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r1 = n => Math.round(n * 10) / 10;
function hills(rnd, y0, amp, n) { let d = `M0 1080L0 ${r1(y0)}`; for (let i = 1; i <= n; i++) { const x = i * 1920 / n, y = y0 - amp * (.4 + .6 * rnd()); d += `Q${r1(x - 960 / n)} ${r1(y - amp * .5)} ${r1(x)} ${r1(y0 - amp * .2 * rnd())}`; } return d + 'L1920 1080Z'; }
function sunsetHills() {
  const rnd = seeded(11);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice"><defs>` +
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1446"/><stop offset=".45" stop-color="#7a2f6b"/><stop offset=".7" stop-color="#e2694a"/><stop offset="1" stop-color="#ffc277"/></linearGradient>` +
    `<radialGradient id="g" cx=".5" cy=".62" r=".35"><stop offset="0" stop-color="#ffe2a6" stop-opacity=".9"/><stop offset="1" stop-color="#ffb070" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="1920" height="1080" fill="url(#s)"/><circle cx="960" cy="650" r="420" fill="url(#g)"/><circle cx="960" cy="640" r="120" fill="#ffd89a"/>` +
    `<path d="${hills(rnd, 700, 120, 5)}" fill="#8a3a5e" opacity=".85"/><path d="${hills(rnd, 790, 140, 4)}" fill="#55224a"/><path d="${hills(rnd, 900, 120, 3)}" fill="#2a1030"/></svg>`;
}
function deepSpace() {
  const rnd = seeded(23); let stars = '';
  for (let i = 0; i < 260; i++) { const z = rnd(); stars += `<circle cx="${r1(rnd() * 1920)}" cy="${r1(rnd() * 1080)}" r="${r1(.6 + z * z * 1.8)}" opacity="${r1(.3 + z * .7)}"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice"><defs>` +
    `<radialGradient id="n1" cx=".28" cy=".32" r=".45"><stop offset="0" stop-color="#5b2bb8" stop-opacity=".75"/><stop offset="1" stop-color="#5b2bb8" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="n2" cx=".74" cy=".58" r=".5"><stop offset="0" stop-color="#1f7ad6" stop-opacity=".6"/><stop offset="1" stop-color="#1f7ad6" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="p" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#ffcf9a"/><stop offset=".55" stop-color="#c0603a"/><stop offset="1" stop-color="#3a1408"/></radialGradient></defs>` +
    `<rect width="1920" height="1080" fill="#05060f"/><rect width="1920" height="1080" fill="url(#n1)"/><rect width="1920" height="1080" fill="url(#n2)"/>` +
    `<g fill="#ffffff">${stars}</g><circle cx="1560" cy="230" r="120" fill="url(#p)"/><ellipse cx="1560" cy="230" rx="210" ry="34" fill="none" stroke="#f2d2b0" stroke-opacity=".45" stroke-width="5" transform="rotate(-14 1560 230)"/></svg>`;
}
function oceanDusk() {
  let waves = '';
  for (let i = 0; i < 14; i++) { const y = 640 + i * 32 + i * i * 1.6, a = 10 + i * 2.2, ph = i * 37; let d = `M0 ${r1(y)}`; for (let x = 0; x <= 1920; x += 120) d += `L${x} ${r1(y + Math.sin((x + ph) / 140) * a)}`; waves += `<path d="${d}" fill="none" stroke="#9fe3ff" stroke-opacity="${r1(.08 + i * .02)}" stroke-width="${r1(1 + i * .25)}"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice"><defs>` +
    `<linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#071a2e"/><stop offset=".5" stop-color="#14506a"/><stop offset=".6" stop-color="#2d8a96"/><stop offset=".61" stop-color="#0a3348"/><stop offset="1" stop-color="#03121e"/></linearGradient>` +
    `<radialGradient id="m" cx=".5" cy=".58" r=".3"><stop offset="0" stop-color="#bff3ff" stop-opacity=".55"/><stop offset="1" stop-color="#bff3ff" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="1920" height="1080" fill="url(#s)"/><ellipse cx="960" cy="640" rx="620" ry="190" fill="url(#m)"/><circle cx="1320" cy="250" r="54" fill="#e8fbff" opacity=".9"/>${waves}</svg>`;
}
const EXAMPLES = [['Sunset Hills', sunsetHills, { accent: '#e2694a', shade: .25, glow: .4 }], ['Deep Space', deepSpace, { accent: '#5b6bff', shade: .2, glow: .35 }], ['Ocean Dusk', oceanDusk, { accent: '#2d8a96', shade: .25, glow: .4 }]];
function ensureExamples() {
  if (!ROOT || fs.existsSync(ROOT)) return;
  try {
    fs.mkdirSync(ROOT, { recursive: true });
    for (const [name, draw, opts] of EXAMPLES) { const dir = path.join(ROOT, name); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'background.svg'), draw()); fs.writeFileSync(path.join(dir, 'theme.json'), JSON.stringify({ name, ...opts, blur: false }, null, 2)); }
    fs.writeFileSync(path.join(ROOT, 'How custom themes work.txt'), [
      'Each folder here is a theme. Put a picture in it named background (.jpg, .png, .webp or .svg).',
      'For one console only, add a picture named after its shelf: gc, wii, wiiu, sw, sw2, ps2, ps3, ps4, ps5, psp, x360, n3ds, pc.',
      'theme.json (optional): {"name": "My theme", "accent": "#6b8cff", "shade": 0.35, "blur": false, "glow": 0.35}',
      '  shade: how much darker the picture is made (0 to 0.9), so the shelf stays easy to read.',
      '  blur: true softens the picture.   glow: how bright the light under the shelf is (0 to 1).',
      'Then in Boxshelf: Settings > Display > Find themes again. Themes are only pictures and settings, never programs.', ''].join('\r\n'));
    log('Custom themes: made the folder with three examples');
  } catch (e) { log('Custom themes: could not make the folder', e.message); }
}

module.exports = { init, root, list, create, save, remove, exportZip, importZip, ensureExamples, _slug: slug, _zipWrite: zipWrite, _zipRead: zipRead };
