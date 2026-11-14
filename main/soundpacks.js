// Sound packs, real instruments and Your music (Settings > Sound).
// - A pack is a folder <Boxshelf data>/sounds/<id>/ holding the sound files and a pack.json:
//   { name, matches: { move, open, back, play, problem, music }, where: 'all' | [console ids], files, unsupported, kenney }
//   Packs come in as a ZIP, a folder or loose files. Files are matched to moments by name (matchName), and any match can
//   be changed by hand later. Only WAV, OGG, MP3 and FLAC are copied; anything else is listed as unsupported.
// - ZIPs: the entries are read from the ZIP's own index first (names and sizes, nothing unpacked) so paths with "..",
//   absolute paths, too many files or too many bytes are turned away before anything is written; then only the chosen
//   entries are unpacked the way modelfind.js does it (tar, or Expand-Archive with the paths in environment variables,
//   or the Linux helper), into a fresh temporary folder that is deleted afterwards.
// - Kenney's free packs (CC0): kenney.nl has no stable download address, so the asset page opens in the browser and
//   the Downloads folder is watched for its ZIP (as modelfind.js does for models), which is then imported as a pack.
// - Real instruments: a few notes per instrument from VSCO 2 Community Edition (CC0, its GitHub repository, pinned to
//   one commit), fetched with ranged requests (only the first seconds of each note), turned into small mono WAVs.
// - Your music: <Boxshelf data>/Music (MP3, OGG, FLAC, WAV, MIDI), played under the shelf.
const fs = require('fs');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const https = require('https');
const { execFile } = require('child_process');

let log = () => {};
function init(logger) { if (logger) log = logger; }
let rootOverride = '';
const dataRoot = () => rootOverride || require('./paths').appRoot();
function setRoot(p) { rootOverride = p || ''; } // (tests)
const packsDir = () => path.join(dataRoot(), 'sounds');
const instDir = () => path.join(dataRoot(), 'instruments');
const musicDir = () => path.join(dataRoot(), 'Music');
const electron = () => { try { const e = require('electron'); return typeof e === 'object' ? e : null; } catch { return null; } };

const AUDIO = /\.(wav|ogg|mp3|flac)$/i;
// files that are plainly not sounds (a pack's readme, licence, pictures): skipped without a warning
const IGNORE = /\.(txt|md|url|pdf|png|jpe?g|gif|webp|bmp|json|nfo|html?|ini|db|ds_store|lnk|sfv|xml|csv|rtf|doc|docx)$/i;
const MAX_BYTES = 50 << 20, MAX_FILES = 300, MAX_ZIP = 200 << 20, MAX_FILE = 20 << 20;
const MOMENTS = ['move', 'open', 'back', 'play', 'problem', 'music'];

// ---------- name matching ----------
// A file's name, split into lower-case words (camelCase, digits and punctuation split too): "SelectMove_02.wav" -> select move
function words(name) {
  const base = String(name || '').replace(/\.[a-z0-9]{1,5}$/i, '');
  return base.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
}
// The moment a file name suggests, or '' (checked in this order: music, problem, back, play a game, move, open)
function matchName(name) {
  const w = words(name), has = (...L) => w.some(x => L.some(l => l === 'ok' ? x === 'ok' : x.startsWith(l)));
  const joined = w.join(' ');
  if (has('music', 'bgm', 'theme', 'loop', 'song')) return 'music';
  if (has('error', 'buzz', 'fail', 'wrong', 'denied', 'invalid')) return 'problem';
  if (has('cancel', 'back', 'close', 'return', 'exit')) return 'back';
  if (has('start', 'launch', 'boot')) return 'play';
  if (/\bselect ?move\b/.test(joined) || has('cursor', 'move', 'click', 'hover', 'rollover', 'tick', 'scroll', 'nav')) return 'move';
  if (has('decide', 'select', 'ok', 'open', 'confirm', 'accept', 'enter')) return 'open';
  return '';
}
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
// every moment's first matching file (in natural order, so _001 before _002)
function matchAll(files, defaults) {
  const m = {}, list = [...files].sort(natural), have = new Set(list.map(f => f.toLowerCase()));
  for (const k of MOMENTS) m[k] = '';
  for (const f of list) { const k = matchName(f); if (k && !m[k]) m[k] = f; }
  if (defaults) for (const k of MOMENTS) { const d = defaults[k]; if (d && have.has(d.toLowerCase())) m[k] = list.find(f => f.toLowerCase() === d.toLowerCase()); }
  return m;
}
// a console named in the pack's name: "PS2 menu sounds" -> only on PS2 (you can change it)
const GUESS = [[/\bps ?2\b|playstation ?2/i, ['ps2']], [/\bps ?3\b|playstation ?3/i, ['ps3']], [/\bps ?4\b|playstation ?4/i, ['ps4']], [/\bps ?5\b|playstation ?5/i, ['ps5']],
  [/\bpsp\b/i, ['psp']], [/\bps ?1\b|\bpsx\b|\bpsone\b/i, ['psx']], [/\bwii ?u\b/i, ['wiiu']], [/\bwii\b/i, ['wii']], [/gamecube|\bngc\b/i, ['gc']],
  [/switch ?2/i, ['sw2']], [/\bswitch\b/i, ['sw']], [/\b3ds\b/i, ['n3ds']], [/xbox ?360|\bx360\b/i, ['x360']], [/dreamcast/i, ['dreamcast']]];
function guessWhere(name) { for (const [re, ids] of GUESS) if (re.test(name || '')) return ids; return 'all'; }

// ---------- ZIP: reading the index, writing a ZIP ----------
// The entries of a ZIP from its central directory: [{ name, size, csize, dir }]. Throws on something that isn't a ZIP.
function zipIndex(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd), tail = Math.min(st.size, 65557), buf = Buffer.alloc(tail);
    fs.readSync(fd, buf, 0, tail, st.size - tail);
    let e = -1; for (let i = tail - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('That file isn\'t a ZIP.');
    const count = buf.readUInt16LE(e + 10), cdSize = buf.readUInt32LE(e + 12), cdOff = buf.readUInt32LE(e + 16);
    if (count === 0xffff || cdOff === 0xffffffff) throw new Error('That ZIP is too big.');
    if (cdSize > 8 << 20 || cdOff + cdSize > st.size) throw new Error('That ZIP looks damaged.');
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = []; let p = 0;
    for (let k = 0; k < count && p + 46 <= cd.length; k++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('That ZIP looks damaged.');
      const flags = cd.readUInt16LE(p + 8), csize = cd.readUInt32LE(p + 20), size = cd.readUInt32LE(p + 24), nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
      out.push({ name, size, csize, dir: /\/$/.test(name) });
      p += 46 + nl + xl + cl;
    }
    return out;
  } finally { fs.closeSync(fd); }
}
// a ZIP entry name that stays inside the folder it is unpacked into
function safeEntry(name) {
  const n = String(name).replace(/\\/g, '/');
  if (!n || n.startsWith('/') || /^[a-z]:/i.test(n) || n.includes('\0')) return false;
  return !n.split('/').some(s => s === '..');
}
let CRC = null;
function crc32(b) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(b) >>> 0;
  if (!CRC) { CRC = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c; } }
  let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0;
}
// a ZIP from [{ name, data }] (deflated; names as UTF-8)
function makeZip(entries) {
  const parts = [], cds = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(String(e.name), 'utf8'), raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data || ''), crc = crc32(raw);
    let data = zlib.deflateRawSync(raw), method = 8; if (data.length >= raw.length) { data = raw; method = 0; }
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, name, data); cds.push(ch, name); off += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(cds), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const run = (cmd, args, opts = {}) => new Promise((res, rej) => execFile(cmd, args, { windowsHide: true, timeout: 120e3, maxBuffer: 16 << 20, ...opts }, (err, out) => err ? rej(err) : res(String(out))));
// unpack `members` of `zip` into the fresh folder `out` (the modelfind.js way)
async function unpack(zip, out, members) {
  if (process.platform === 'linux') { const L = require('./linux'); for (const m of members) if (!(await L.unzipAsync(zip, out, m))) throw new Error('Couldn\'t unpack the ZIP (install unzip or bsdtar).'); return; }
  try { await run('tar', ['-xf', zip, '-C', out, ...members]); }
  catch { await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:BS_SRC -DestinationPath $env:BS_DST -Force'], { env: { ...process.env, BS_SRC: zip, BS_DST: out } }); }
}
// delete `p` only if it really is a folder below `root`
function rmInside(root, p) {
  const rel = path.relative(path.resolve(root), path.resolve(p));
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) { log('sound packs: refusing to delete', p); return false; }
  try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch (e) { log('sound packs: delete', e.message); return false; }
}
const inside = (root, p) => { const rel = path.relative(path.resolve(root), path.resolve(p)); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); };

// ---------- import ----------
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pack';
const cleanName = s => String(s || '').replace(/\.(zip)$/i, '').replace(/^kenney[_ -]*/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'My sounds';
const safeFile = s => String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '_').slice(0, 120);
function walkFiles(dir, depth = 0, out = [], base = dir) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (out.length > MAX_FILES * 4 || e.name.startsWith('.') || e.name === '__MACOSX') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 6) walkFiles(p, depth + 1, out, base); }
    else if (e.isFile()) out.push({ abs: p, rel: path.relative(base, p) }); // (isFile: no links out of the folder)
  }
  return out;
}
// Import sound files from `sources` (one ZIP, one folder, or loose files; several of any are merged into one pack).
// opts: { name, id (Kenney packs use their own id; an existing pack with it is replaced), kenney, defaults, only (a RegExp
// a ZIP entry / file path must match) }. Returns the new pack (see list()).
async function importFrom(sources, opts = {}) {
  sources = (Array.isArray(sources) ? sources : [sources]).map(String).filter(Boolean);
  if (!sources.length) throw new Error('Nothing to add.');
  const root = packsDir(); fs.mkdirSync(root, { recursive: true });
  const tmpRoot = path.join(os.tmpdir(), 'boxshelf-sounds'); fs.mkdirSync(tmpRoot, { recursive: true });
  const temps = [], cands = [], skipped = [];
  let total = 0, guessName = opts.name || '';
  try {
    for (const src of sources) {
      let st; try { st = fs.statSync(src); } catch { throw new Error('Couldn\'t find ' + path.basename(src) + '.'); }
      if (st.isDirectory()) { if (!guessName) guessName = path.basename(src); walkFiles(src).forEach(f => cands.push(f)); continue; }
      if (/\.zip$/i.test(src)) {
        if (st.size > MAX_ZIP) throw new Error('That ZIP is too big (over 200 MB).');
        if (!guessName) guessName = path.basename(src);
        const ents = zipIndex(src).filter(e => !e.dir);
        // (a Kenney pack's own folder of sounds; a ZIP laid out differently is taken whole)
        const onlyOk = opts.only && ents.some(e => safeEntry(e.name) && opts.only.test(e.name)) ? opts.only : null;
        const pick = [];
        for (const e of ents) {
          if (!safeEntry(e.name)) { skipped.push(e.name); continue; } // a path that would land outside: ignored
          const base = e.name.split('/').pop();
          if (/^__MACOSX\//.test(e.name) || base.startsWith('.')) continue;
          if (onlyOk && !onlyOk.test(e.name)) continue;
          if (!AUDIO.test(base)) { if (!IGNORE.test(base)) cands.push({ rel: e.name, unsupported: true }); continue; }
          pick.push(e); total += e.size;
        }
        if (pick.length > MAX_FILES) throw new Error(`That ZIP has too many sounds (over ${MAX_FILES}).`);
        if (total > MAX_BYTES) throw new Error('The sounds in that ZIP are too big (over 50 MB in all).');
        if (!pick.length) continue;
        const out = fs.mkdtempSync(path.join(tmpRoot, 'z-')); temps.push(out);
        await unpack(src, out, pick.map(e => e.name));
        for (const e of pick) {
          const p = path.join(out, ...e.name.split('/'));
          if (!inside(out, p)) continue;
          let s2; try { s2 = fs.lstatSync(p); } catch { continue; }
          if (!s2.isFile()) continue;
          cands.push({ abs: p, rel: e.name });
        }
        continue;
      }
      cands.push({ abs: src, rel: path.basename(src) });
      if (!guessName) guessName = sources.length === 1 ? path.basename(src).replace(/\.[a-z0-9]+$/i, '') : 'My sounds';
    }
    // what goes in: audio files under the caps; everything else that isn't plainly a document is listed as unsupported
    const keep = [], unsupported = [], names = new Set(); total = 0;
    for (const c of cands) {
      const base = path.basename(c.rel.replace(/\\/g, '/').split('/').pop());
      if (c.unsupported || !AUDIO.test(base)) { if (c.unsupported || !IGNORE.test(base)) unsupported.push(base); continue; }
      let size = 0; try { size = fs.statSync(c.abs).size; } catch { continue; }
      if (size > MAX_FILE) { unsupported.push(base); continue; }
      total += size; if (total > MAX_BYTES) throw new Error('Those sounds are too big (over 50 MB in all).');
      if (keep.length >= MAX_FILES) throw new Error(`That's too many sounds (over ${MAX_FILES}).`);
      let name = safeFile(base);
      if (names.has(name.toLowerCase())) { const dir = path.basename(path.dirname(c.rel)); name = safeFile((dir && dir !== '.' ? dir + '-' : 'x-') + base); let k = 2; while (names.has(name.toLowerCase())) name = safeFile(k++ + '-' + base); }
      names.add(name.toLowerCase()); keep.push({ abs: c.abs, name });
    }
    if (!keep.length) throw new Error(unsupported.length ? `No sounds Boxshelf can play: ${unsupported.slice(0, 3).join(', ')}${unsupported.length > 3 ? '…' : ''} ${unsupported.length === 1 ? 'is' : 'are'} not WAV, OGG, MP3 or FLAC.` : 'No sound files in there (WAV, OGG, MP3 or FLAC).');
    const name = cleanName(guessName);
    let id = opts.id && /^[a-z0-9-]{1,48}$/.test(opts.id) ? opts.id : slug(name);
    if (!opts.id) { let k = 2; const b = id; while (fs.existsSync(path.join(root, id))) id = b + '-' + k++; }
    const dest = path.join(root, id);
    if (opts.id && fs.existsSync(dest)) rmInside(root, dest);
    fs.mkdirSync(dest, { recursive: true });
    for (const f of keep) fs.copyFileSync(f.abs, path.join(dest, f.name));
    const files = keep.map(f => f.name).sort(natural);
    const pack = { name: opts.packName || name, matches: matchAll(files, opts.defaults), where: opts.kenney ? 'all' : guessWhere(name), files, unsupported: [...new Set(unsupported)].slice(0, 40), skipped: skipped.slice(0, 20), kenney: opts.kenney || undefined, added: new Date().toISOString() };
    writePack(id, pack);
    log('Sound pack added:', id, files.length, 'files', unsupported.length ? `(${unsupported.length} unsupported)` : '');
    return Object.assign({ id }, pack);
  } finally { for (const t of temps) rmInside(tmpRoot, t); }
}
function writePack(id, pack) {
  const f = path.join(packsDir(), id, 'pack.json'), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(pack, null, 1)); fs.renameSync(tmp, f);
}
function readPack(id) {
  if (!/^[a-z0-9-]{1,48}$/.test(id)) return null;
  const dir = path.join(packsDir(), id);
  let p; try { p = JSON.parse(fs.readFileSync(path.join(dir, 'pack.json'), 'utf8')); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  let files; try { files = fs.readdirSync(dir).filter(f => AUDIO.test(f)).sort(natural); } catch { files = []; }
  const set = new Set(files), m = {};
  for (const k of MOMENTS) m[k] = p.matches && typeof p.matches[k] === 'string' && set.has(p.matches[k]) ? p.matches[k] : '';
  const where = Array.isArray(p.where) ? p.where.filter(x => /^[a-z0-9]{1,16}$/.test(x)).slice(0, 60) : 'all';
  let bytes = 0; for (const f of files) try { bytes += fs.statSync(path.join(dir, f)).size; } catch {}
  return { id, name: String(p.name || id).slice(0, 60), matches: m, where: Array.isArray(where) && !where.length ? 'all' : where, files, unsupported: Array.isArray(p.unsupported) ? p.unsupported.map(String).slice(0, 40) : [], kenney: typeof p.kenney === 'string' ? p.kenney : '', bytes };
}
function list() {
  let ents; try { ents = fs.readdirSync(packsDir(), { withFileTypes: true }); } catch { return []; }
  return ents.filter(e => e.isDirectory()).map(e => readPack(e.name)).filter(Boolean).sort((a, b) => natural(a.name, b.name));
}
function read(id, file) {
  const p = readPack(id); if (!p || !p.files.includes(String(file))) throw new Error('No such sound in that pack.');
  const f = path.join(packsDir(), id, String(file)); const st = fs.statSync(f); if (st.size > MAX_FILE) throw new Error('That sound is too big.');
  return fs.readFileSync(f);
}
// patch: { name, matches: { moment: file | '' }, where: 'all' | [ids] }
function update(id, patch = {}) {
  const p = readPack(id); if (!p) throw new Error('That pack is gone.');
  const raw = JSON.parse(fs.readFileSync(path.join(packsDir(), id, 'pack.json'), 'utf8'));
  if (typeof patch.name === 'string' && patch.name.trim()) raw.name = patch.name.replace(/[\x00-\x1f]/g, '').trim().slice(0, 60);
  if (patch.matches && typeof patch.matches === 'object') { raw.matches = Object.assign({}, p.matches); for (const k of MOMENTS) if (k in patch.matches) { const v = patch.matches[k]; raw.matches[k] = v && p.files.includes(v) ? v : ''; } }
  if (patch.where === 'all' || Array.isArray(patch.where)) raw.where = patch.where === 'all' ? 'all' : patch.where.filter(x => /^[a-z0-9]{1,16}$/.test(x)).slice(0, 60);
  writePack(id, raw);
  return readPack(id);
}
function remove(id) { const p = readPack(id); if (!p) return false; return rmInside(packsDir(), path.join(packsDir(), id)); }
// the pack as one ZIP (its sounds and pack.json), written to `dest`
function exportZip(id, dest) {
  const p = readPack(id); if (!p) throw new Error('That pack is gone.');
  const dir = path.join(packsDir(), id), entries = p.files.map(f => ({ name: f, data: fs.readFileSync(path.join(dir, f)) }));
  entries.push({ name: 'pack.json', data: JSON.stringify({ name: p.name, matches: p.matches, where: p.where }, null, 1) });
  fs.writeFileSync(dest, makeZip(entries));
  return dest;
}

// ---------- Kenney's free packs ----------
// (the ids are Boxshelf's; defaults: the file for each moment when the pack is first added)
const KENNEY = {
  'kenney-clicky': { slug: 'ui-audio', name: 'Clicky', size: '0.4 MB', only: /(^|\/)Audio\/[^/]+\.ogg$/i,
    defaults: { move: 'click3.ogg', open: 'switch2.ogg', back: 'switch3.ogg', play: 'switch30.ogg', problem: '' } },
  'kenney-soft': { slug: 'interface-sounds', name: 'Soft UI', size: '0.8 MB', only: /(^|\/)Audio\/[^/]+\.(ogg|wav)$/i,
    defaults: { move: 'click_003.ogg', open: 'confirmation_001.ogg', back: 'back_002.ogg', play: 'maximize_006.ogg', problem: 'error_004.ogg' } },
  'kenney-arcade': { slug: 'digital-audio', name: 'Arcade', size: '1.0 MB', only: /(^|\/)Audio\/[^/]+\.(ogg|wav)$/i,
    defaults: { move: 'pepSound1.ogg', open: 'twoTone1.ogg', back: 'lowDown.ogg', play: 'powerUp2.ogg', problem: 'lowThreeTone.ogg' } },
};
const kenneyUrl = kid => KENNEY[kid] ? `https://kenney.nl/assets/${KENNEY[kid].slug}` : '';
function downloadsDir() { const e = electron(); try { if (e && e.app) return e.app.getPath('downloads'); } catch {} return path.join(os.homedir(), 'Downloads'); }
let kwatch = null;
function kenneyStop() { if (kwatch) { try { kwatch.watcher && kwatch.watcher.close(); } catch {} clearInterval(kwatch.poll); clearTimeout(kwatch.timer); clearTimeout(kwatch.debounce); kwatch = null; } }
// the Kenney ZIP for `kid` in the Downloads folder: "kenney_ui-audio.zip", "kenney_ui-audio (1).zip"…
const kenneyRe = kid => new RegExp('^kenney[ _-]?' + KENNEY[kid].slug.replace(/-/g, '[ _-]?') + '.*\\.zip$', 'i');
// Opens the asset page and watches Downloads; onDone(err, pack). A matching ZIP that's already there is used at once.
function kenneyStart(kid, onDone, openUrl) {
  const K = KENNEY[kid]; if (!K) return { ok: false, error: 'Unknown pack.' };
  kenneyStop();
  const dir = downloadsDir(), re = kenneyRe(kid);
  const take = f => importFrom([f], { id: kid, kenney: kid, packName: K.name, defaults: K.defaults, only: K.only }).then(p => { onDone(null, p); return true; });
  let names = []; try { names = fs.readdirSync(dir); } catch { return { ok: false, error: 'No Downloads folder found.' }; }
  const already = names.filter(n => re.test(n)).map(n => path.join(dir, n)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (already) { take(already).catch(e => onDone(e)); return { ok: true, found: true }; }
  const before = new Set(names), seen = new Map(), me = { watcher: null, poll: 0, timer: 0, debounce: 0, busy: false };
  const tick = () => {
    if (kwatch !== me || me.busy) return; let L; try { L = fs.readdirSync(dir); } catch { return; }
    for (const n of L) {
      if (before.has(n) || !re.test(n)) continue;
      const f = path.join(dir, n); let st; try { st = fs.statSync(f); } catch { continue; }
      const prev = seen.get(n); seen.set(n, st.size); if (prev == null || prev !== st.size || st.size < 1024) continue; // (still being written)
      me.busy = true; before.add(n);
      take(f).then(() => { if (kwatch === me) kenneyStop(); }).catch(e => { me.busy = false; log('kenney import', e.message); onDone(e); });
      return;
    }
  };
  try { me.watcher = fs.watch(dir, () => { if (kwatch !== me) return; clearTimeout(me.debounce); me.debounce = setTimeout(tick, 900); }); } catch (e) { log('downloads watch', e.message); }
  me.poll = setInterval(tick, 2500); me.timer = setTimeout(() => { if (kwatch === me) { kenneyStop(); onDone(new Error('timeout')); } }, 15 * 60e3); kwatch = me;
  const url = kenneyUrl(kid);
  if (openUrl) openUrl(url); else { const e = electron(); if (e && e.shell) e.shell.openExternal(url).catch(err => log('kenney open', err.message)); }
  return { ok: true, waiting: true, url };
}

// ---------- real instruments (VSCO 2 Community Edition, CC0) ----------
// github.com/sgossner/VSCO-2-CE, pinned to one commit so the files never change under us. Each note: [path, MIDI note
// (its real pitch, checked against the samples)]. Only the first `secs` seconds are fetched (a ranged request) and kept
// as a mono 16-bit WAV with a short fade, about 10 MB to download in all.
const VSCO_BASE = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/440300901dfe9275fd84e0b7763af1f8443ae62e/';
const VSCO = {
  piano: { secs: 2.6, notes: [['Keys/Upright%20Nr1/UR1_C3_mf_RR1.wav', 48], ['Keys/Upright%20Nr1/UR1_C4_mf_RR1.wav', 60], ['Keys/Upright%20Nr1/UR1_C5_mf_RR1.wav', 72], ['Keys/Upright%20Nr1/UR1_C6_mf_RR1.wav', 84]] },
  harp: { secs: 2.4, notes: [['Strings/Harp/KSHarp_C3_mf.wav', 48], ['Strings/Harp/KSHarp_F4_mf.wav', 65], ['Strings/Harp/KSHarp_C5_mf.wav', 72], ['Strings/Harp/KSHarp_D6_mf.wav', 86]] },
  violin: { secs: 2.0, notes: [['Strings/Solo%20Violin/Arco%20Vib/LLVln_ArcoVib_G3_p.wav', 55], ['Strings/Solo%20Violin/Arco%20Vib/LLVln_ArcoVib_G4_p.wav', 67], ['Strings/Solo%20Violin/Arco%20Vib/LLVln_ArcoVib_G5_p.wav', 79]] },
  flute: { secs: 1.8, notes: [['Woodwinds/Flute/susvib/LDFlute_susvib_C3_v1_1.wav', 60], ['Woodwinds/Flute/susvib/LDFlute_susvib_C4_v1_1.wav', 72], ['Woodwinds/Flute/susvib/LDFlute_susvib_C5_v1_1.wav', 84]] },
  clarinet: { secs: 1.8, notes: [['Woodwinds/Clarinet/susLong/DCClar_susLong_D2_v2_rr1_sum.wav', 50], ['Woodwinds/Clarinet/susLong/DCClar_susLong_D3_v2_rr1_sum.wav', 62], ['Woodwinds/Clarinet/susLong/DCClar_susLong_D4_v2_rr1_sum.wav', 74]] },
  marimba: { secs: 1.4, notes: [['Percussion/Marimba/Marimba_hit_Outrigger_C2_loud_01.wav', 48], ['Percussion/Marimba/Marimba_hit_Outrigger_F3_loud_01.wav', 65], ['Percussion/Marimba/Marimba_hit_Outrigger_C4_loud_01.wav', 72], ['Percussion/Marimba/Marimba_hit_Outrigger_C6_loud_01.wav', 96]] },
  bells: { secs: 2.2, notes: [['Percussion/Glock/glock_medium_C5.wav', 84], ['Percussion/Glock/glock_medium_C6.wav', 96], ['Percussion/Glock/glock_medium_C7.wav', 108]] },
};
const HEAD_ROOM = 4096; // the WAV header and chunks before the samples (the largest seen is 654 bytes)
function instStatus() {
  let m = null; try { m = JSON.parse(fs.readFileSync(path.join(instDir(), 'manifest.json'), 'utf8')); } catch {}
  if (!m || !m.insts) return { got: false, bytes: 0, insts: {}, size: '10 MB' };
  let bytes = 0; for (const [k, notes] of Object.entries(m.insts)) for (const n of notes) try { bytes += fs.statSync(path.join(instDir(), k, n + '.wav')).size; } catch {}
  return { got: true, bytes, insts: m.insts, size: '10 MB' };
}
function getRange(url, end, onData) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { Range: `bytes=0-${end}`, 'User-Agent': 'Boxshelf' }, timeout: 30000 }, r => {
      if (r.statusCode !== 206 && r.statusCode !== 200) { r.resume(); rej(new Error('HTTP ' + r.statusCode)); return; }
      if (!/audio|octet-stream|wav/i.test(String(r.headers['content-type'] || ''))) { r.resume(); rej(new Error('Not a sound file')); return; }
      const bufs = []; let n = 0;
      r.on('data', b => { bufs.push(b); n += b.length; onData(b.length); if (n > end + 1) { r.destroy(); res(Buffer.concat(bufs).slice(0, end + 1)); } });
      r.on('end', () => res(Buffer.concat(bufs))); r.on('error', rej);
    });
    req.on('timeout', () => req.destroy(new Error('The download stalled.'))); req.on('error', rej);
  });
}
// a WAV's first `secs` seconds as a small mono 16-bit WAV: leading silence trimmed, peak evened out, faded at the end
function wavTrim(buf, secs) {
  if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WAVE') throw new Error('Not a WAV file');
  let p = 12, fmt = null, dataAt = -1, dataLen = 0;
  while (p + 8 <= buf.length) {
    const id = buf.toString('latin1', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { tag: buf.readUInt16LE(p + 8), ch: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') { dataAt = p + 8; dataLen = Math.min(len, buf.length - dataAt); break; }
    p += 8 + len + (len & 1);
  }
  if (!fmt || dataAt < 0 || (fmt.tag !== 1 && fmt.tag !== 0xfffe) || (fmt.bits !== 16 && fmt.bits !== 24)) throw new Error('Unsupported WAV');
  const bps = fmt.bits / 8, frame = bps * fmt.ch, frames = Math.floor(dataLen / frame), mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) { const o = dataAt + i * frame + c * bps; s += fmt.bits === 16 ? buf.readInt16LE(o) / 32768 : buf.readIntLE(o, 3) / 8388608; } mono[i] = s / fmt.ch; }
  let start = 0; while (start < frames && Math.abs(mono[start]) < .01) start++; start = Math.max(0, start - Math.round(fmt.rate * .004));
  const n = Math.min(frames - start, Math.round(fmt.rate * secs)); if (n < fmt.rate * .2) throw new Error('Sample too short');
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(mono[start + i]));
  const g = peak > 0 ? .8 / peak : 1, fade = Math.round(fmt.rate * .3), out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0, 'latin1'); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVEfmt ', 8, 'latin1'); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(fmt.rate, 24); out.writeUInt32LE(fmt.rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34); out.write('data', 36, 'latin1'); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const f = i > n - fade ? (n - i) / fade : 1; out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(mono[start + i] * g * f * 32767))), 44 + i * 2); }
  return out;
}
let instJob = null;
// onProgress({ done, total }); resolves to instStatus(). One download at a time; a failed note leaves that instrument built in.
async function instDownload(onProgress) {
  if (instJob) return instJob;
  instJob = (async () => {
    const dir = instDir(); fs.mkdirSync(dir, { recursive: true });
    const jobs = []; for (const [k, v] of Object.entries(VSCO)) for (const [p, midi] of v.notes) jobs.push({ k, p, midi, end: HEAD_ROOM + Math.ceil(v.secs * 264600) - 1, secs: v.secs });
    const total = jobs.reduce((s, j) => s + j.end + 1, 0) * .82; let done = 0, last = 0;
    const tick = n => { done += n; const t = Date.now(); if (t - last > 120) { last = t; try { onProgress && onProgress({ done: Math.min(done, total), total }); } catch {} } };
    const got = {}, failed = new Set();
    let i = 0; const worker = async () => { while (i < jobs.length) { const j = jobs[i++];
      try { let b; try { b = await getRange(VSCO_BASE + j.p, j.end, tick); } catch (e) { log('instrument sample, trying again:', j.k, j.midi, e.message); await new Promise(r => setTimeout(r, 800)); b = await getRange(VSCO_BASE + j.p, j.end, () => {}); }
        const w = wavTrim(b, j.secs); fs.mkdirSync(path.join(dir, j.k), { recursive: true }); fs.writeFileSync(path.join(dir, j.k, j.midi + '.wav'), w); (got[j.k] = got[j.k] || []).push(j.midi); }
      catch (e) { failed.add(j.k); log('instrument sample', j.k, j.midi, e.message); } } };
    await Promise.all([worker(), worker(), worker()]);
    const insts = {}; for (const k of Object.keys(got)) if (!failed.has(k) || got[k].length >= 2) insts[k] = got[k].sort((a, b) => a - b);
    if (!Object.keys(insts).length) throw new Error('The download didn\'t work. Check the Internet connection and try again.');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ source: 'VSCO 2 Community Edition (CC0), github.com/sgossner/VSCO-2-CE', insts }, null, 1));
    try { onProgress && onProgress({ done: total, total }); } catch {}
    return instStatus();
  })();
  try { return await instJob; } finally { instJob = null; }
}
function instRemove() { const d = instDir(); if (!fs.existsSync(d)) return instStatus(); fs.rmSync(d, { recursive: true, force: true }); return instStatus(); }
function instRead(inst, midi) {
  if (!VSCO[inst] || !/^\d{1,3}$/.test(String(midi))) throw new Error('No such sample.');
  return fs.readFileSync(path.join(instDir(), inst, String(midi) + '.wav'));
}

// ---------- Your music ----------
const MUSIC = /\.(mp3|ogg|flac|wav|mid|midi)$/i;
function musicList() {
  const root = musicDir(), out = []; try { fs.mkdirSync(root, { recursive: true }); } catch {}
  const walk = (d, depth) => { let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => natural(a.name, b.name));
    for (const e of ents) { if (out.length >= 500 || e.name.startsWith('.')) continue; const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); } else if (e.isFile() && MUSIC.test(e.name)) out.push({ name: e.name.replace(MUSIC, '').replace(/_+/g, ' ').trim(), file: path.relative(root, p), midi: /\.midi?$/i.test(e.name) }); } };
  walk(root, 0); return out;
}
function musicRead(file) {
  const root = musicDir(), full = path.resolve(root, String(file || ''));
  if (!inside(root, full) || !MUSIC.test(full)) throw new Error('Not a song in the Music folder.');
  if (fs.statSync(full).size > 40 << 20) throw new Error('That song is too big.');
  return fs.readFileSync(full);
}
// copy picked files into a folder (Add songs…); returns how many were added
function copyInto(dir, files, re) {
  fs.mkdirSync(dir, { recursive: true }); let n = 0;
  for (const f of files || []) { if (!re.test(f)) continue; try { const st = fs.statSync(f); if (!st.isFile() || st.size > 40 << 20) continue; let to = path.join(dir, safeFile(path.basename(f))); if (path.resolve(to) === path.resolve(f)) continue; fs.copyFileSync(f, to); n++; } catch (e) { log('copy song', e.message); } }
  return n;
}
// MIDI files in Downloads that the Songs folder doesn't have yet
function midiInDownloads(songsDir) {
  const d = downloadsDir(); let L; try { L = fs.readdirSync(d); } catch { return []; }
  let have = new Set(); try { have = new Set(fs.readdirSync(songsDir).map(n => n.toLowerCase())); } catch {}
  return L.filter(n => /\.midi?$/i.test(n) && !have.has(n.toLowerCase())).map(n => path.join(d, n)).filter(f => { try { return fs.statSync(f).size < 2 << 20; } catch { return false; } });
}

module.exports = { init, setRoot, packsDir, instDir, musicDir, matchName, matchAll, guessWhere, words, zipIndex, safeEntry, makeZip, importFrom, list, read, update, remove, exportZip,
  KENNEY, kenneyStart, kenneyStop, kenneyUrl, instStatus, instDownload, instRemove, instRead, VSCO, wavTrim, musicList, musicRead, copyInto, midiInDownloads, downloadsDir };
