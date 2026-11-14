// (beta.14) Keeping your setup: the safety copy before an update, the "Undo" after one, "Bring my setup over" from
// another Boxshelf folder, and the extra parts of Back up / Restore settings. Plain files only; main/updateflow.js wires
// it to the screen. Box art beside your games is never touched by any of it.
//
// What "your setup" is (data\ is Boxshelf's own data folder; app\ the Boxshelf folder itself):
//   STATE (small, made by you; in every safety copy, brought over, and in a backup file):
//     data\config.json        settings, favourites, your shelves, Art Studio styles and locks, per-game emulators, keys (sealed)
//     data\history.json       play history
//     data\art-provenance.json  which art set each game uses (Art Studio picks)
//     data\manual-studio.json, manual-auto.json, manual-rejects.json  manual picks and the ones you turned down
//     data\emu-setup.json     what "Set up for me" changed (so Undo still works)
//     data\romm-local.json, romm-device.json  RomM games kept on this PC, this device's RomM id
//     data\companion.json     paired phones (private: in a backup file only with "Include keys and passwords")
//   DEFINITIONS (app\sounds\<pack>\pack.json, app\Custom themes\<theme>\theme.json): in the safety copy and a backup file
//   BROUGHT OVER WHOLE (a setup from another folder): app\sounds, app\Custom themes, app\themes, data\pc-covers
//     (not Chromium's Local Storage: two of its databases can't be merged file by file)
//   EXTRAS ("Also copy downloaded extras"): the caches listed in EXTRA_DATA, and app\Music
//   NEVER: Chromium's own folders, the log, data\update, data\backups, crash dumps
'use strict';
const fs = require('fs'), fsp = fs.promises, path = require('path');

const STATE_FILES = ['config.json', 'history.json', 'art-provenance.json', 'manual-studio.json', 'manual-auto.json', 'manual-rejects.json', 'emu-setup.json', 'romm-local.json', 'romm-device.json', 'companion.json'];
const PRIVATE = new Set(['companion.json']);
const DEF_DIRS = [['sounds', 'pack.json'], ['Custom themes', 'theme.json']];
const BRING_APP_DIRS = ['sounds', 'Custom themes', 'themes'];
const BRING_DATA_DIRS = ['pc-covers'];
const EXTRA_DATA = ['thumbs', 'previews', 'more-shots', 'boxart-cache', 'art-cand', 'manual-cand', 'steam-art', 'stremio-art', 'pc-cover-cache', 'commercials', 'trophy-packs',
  'custom-theme-cache', 'wiiu-manuals', 'ra', 'icons', 'logo-find', 'romm-covers', 'library', 'wiimote-cache', 'tools', 'steam', 'cache',
  'library-cache.json', 'cover-checks.json', 'cover-backs.json', 'steam-info.json', 'x360-titles.json', 'sgdb-cache.json', 'ss-cache.json', 'arcade-names.json', 'commercials.json',
  'manual-collections.json', 'logo-find.json', 'art-missing.json', 'sw2-builds.json', 'pc-xbox.json', 'pc-steam.json', 'romm-library.json'];
const EXTRA_APP = ['Music'];
const KEEP = 3, MAX_JSON = 16 * 1048576;
const SAFE_NAME = /^[^\\/:*?"<>|\x00-\x1f]{1,120}$/;
const safeVer = v => String(v || 'unknown').replace(/[^0-9A-Za-z.+-]/g, '_').slice(0, 64) || 'unknown';
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const readJson = f => { try { const st = fs.statSync(f); if (!st.isFile() || st.size > MAX_JSON) return undefined; return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return undefined; } };
function writeAtomic(f, text) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = f + '.tmp-' + process.pid; fs.writeFileSync(t, text); fs.renameSync(t, f); }
const samePath = (a, b) => { const x = path.resolve(String(a || '')), y = path.resolve(String(b || '')); return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y; };

// the definition files (sounds\<id>\pack.json, Custom themes\<id>\theme.json): [[rel ('/'), full path]]
function defFiles(appRoot) {
  const out = [];
  for (const [dir, file] of DEF_DIRS) { let ents = []; try { ents = fs.readdirSync(path.join(appRoot, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of ents) { if (!e.isDirectory() || !SAFE_NAME.test(e.name)) continue; const f = path.join(appRoot, dir, e.name, file); if (isFile(f)) out.push([`${dir}/${e.name}/${file}`, f]); } }
  return out;
}

// ---------- the safety copy (before every update) ----------
// data\backups\<version>\ { manifest.json, data\…, app\… }; the newest KEEP are kept
function safetyCopy({ dataDir, appRoot, version, keep = KEEP, now = Date.now() }) {
  const dir = path.join(dataDir, 'backups', safeVer(version));
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const f of STATE_FILES) { const src = path.join(dataDir, f); if (!isFile(src)) continue; const to = path.join(dir, 'data', f); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(src, to); files.push({ p: 'data/' + f, size: fs.statSync(to).size, json: readJson(to) !== undefined }); }
  for (const [rel, src] of defFiles(appRoot)) { const to = path.join(dir, 'app', ...rel.split('/')); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(src, to); files.push({ p: 'app/' + rel, size: fs.statSync(to).size, json: readJson(to) !== undefined }); }
  writeAtomic(path.join(dir, 'manifest.json'), JSON.stringify({ app: 'Boxshelf', kind: 'safety', version: String(version || ''), at: now, files }, null, 1));
  rotate(dataDir, keep);
  return { dir, files: files.length };
}
function safetyList(dataDir) {
  const root = path.join(dataDir, 'backups'), out = []; let ents = []; try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) { if (!e.isDirectory()) continue; const m = readJson(path.join(root, e.name, 'manifest.json')); if (m && m.app === 'Boxshelf' && m.kind === 'safety' && Array.isArray(m.files)) out.push({ ...m, dir: path.join(root, e.name) }); }
  return out.sort((a, b) => (+b.at || 0) - (+a.at || 0));
}
function rotate(dataDir, keep = KEEP) { for (const m of safetyList(dataDir).slice(keep)) fs.rmSync(m.dir, { recursive: true, force: true }); }
const latestSafety = dataDir => safetyList(dataDir)[0] || null;

// the first start after an update: is everything from the safety copy still there and readable? A missing or damaged
// config.json is put back at once (otherwise Boxshelf would start over); anything else is only listed (Settings offers
// Undo). Each safety copy is checked once per version
function checkAfterUpdate({ dataDir, appRoot, version, log = () => {} }) {
  const m = latestSafety(dataDir); if (!m || m.version === String(version) || m.checked === String(version)) return null;
  const problems = []; let fixedConfig = false;
  for (const f of m.files) {
    const [where, ...rest] = String(f.p).split('/'), cur = path.join(where === 'app' ? appRoot : dataDir, ...rest), copy = path.join(m.dir, where, ...rest);
    const ok = isFile(cur) && (!f.json || readJson(cur) !== undefined);
    if (ok) continue;
    if (f.p === 'data/config.json' && readJson(copy) !== undefined) {
      try { if (isFile(cur)) fs.copyFileSync(cur, cur + '.before-repair'); fs.copyFileSync(copy, cur); fixedConfig = true; log('Update check: config.json was missing or damaged; put back from the safety copy of', m.version); continue; } catch (e) { log('Update check: could not put config.json back:', e.message); }
    }
    problems.push(f.p);
  }
  try { writeAtomic(path.join(m.dir, 'manifest.json'), JSON.stringify({ app: m.app, kind: m.kind, version: m.version, at: m.at, files: m.files, checked: String(version) }, null, 1)); } catch {}
  if (problems.length) log('Update check: not as before the update:', problems.join(', '));
  return { from: m.version, problems, fixedConfig };
}

// ---------- changes applied at the next start (data\.pending) ----------
// .pending\data\… goes into data\, .pending\app\… into the Boxshelf folder, .pending\chromium\… is the helper's (Local
// State, copied while Boxshelf is closed). ready.json is written last: a half-made .pending is never applied
const pendingDir = dataDir => path.join(dataDir, '.pending');
function pendingBegin(dataDir) { const d = pendingDir(dataDir); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }); return d; }
function pendingCommit(dataDir, meta) { writeAtomic(path.join(pendingDir(dataDir), 'ready.json'), JSON.stringify({ ...meta, at: Date.now() })); }
function pendingDrop(dataDir) { fs.rmSync(pendingDir(dataDir), { recursive: true, force: true }); }
function moveTree(from, to) {
  let n = 0, ents = []; try { ents = fs.readdirSync(from, { withFileTypes: true }); } catch { return 0; }
  for (const e of ents) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) { n += moveTree(s, d); continue; } if (!e.isFile()) continue;
    if (isDir(d)) continue;
    fs.mkdirSync(to, { recursive: true });
    try { fs.renameSync(s, d); } catch { fs.copyFileSync(s, d); } n++;
  }
  return n;
}
// at start, before anything reads its files: returns ready.json's meta (+ n: files put in) or null
function applyPending({ dataDir, appRoot, log = () => {} }) {
  const d = pendingDir(dataDir); if (!isDir(d)) return null;
  const meta = readJson(path.join(d, 'ready.json'));
  if (!meta || typeof meta !== 'object') { log('A half-made change from last time was dropped'); pendingDrop(dataDir); return null; }
  let n = 0;
  try { n += moveTree(path.join(d, 'data'), dataDir); n += moveTree(path.join(d, 'app'), appRoot); }
  catch (e) { log('Putting in the waiting change failed part way:', e.message); }
  pendingDrop(dataDir); log('Put in a waiting change:', meta.kind || '?', n, 'file(s)');
  return { ...meta, n };
}
// Undo the last update's settings change: the newest safety copy, applied at the next start
function stageUndo({ dataDir }) {
  const m = latestSafety(dataDir); if (!m) throw new Error('There is no safety copy to go back to.');
  const d = pendingBegin(dataDir); let n = 0;
  for (const f of m.files) { const parts = String(f.p).split('/'); if (!['data', 'app'].includes(parts[0]) || parts.some(x => x === '..' || !x)) continue; const src = path.join(m.dir, ...parts); if (!isFile(src)) continue; const to = path.join(d, ...parts); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(src, to); n++; }
  pendingCommit(dataDir, { kind: 'undo', from: m.version }); return { n, version: m.version };
}

// ---------- installs.json: where each Boxshelf has run from ----------
// Windows %APPDATA%\Boxshelf\installs.json, Linux ~/.config/boxshelf/installs.json:
// { installs: [{ dataDir, appRoot, version, lastRun, setupDone }] }, newest first, at most 8. Only paths on this PC
const registryFile = (appDataDir, platform = process.platform) => path.join(appDataDir, platform === 'linux' ? 'boxshelf' : 'Boxshelf', 'installs.json');
function readRegistry(file) {
  const j = readJson(file), L = j && Array.isArray(j.installs) ? j.installs : [];
  return L.filter(x => x && typeof x.dataDir === 'string' && x.dataDir.length < 1024 && path.isAbsolute(x.dataDir)).map(x => ({ dataDir: x.dataDir, appRoot: typeof x.appRoot === 'string' && path.isAbsolute(x.appRoot) ? x.appRoot : path.dirname(x.dataDir),
    version: typeof x.version === 'string' ? x.version.slice(0, 64) : '', lastRun: +x.lastRun || 0, setupDone: !!x.setupDone }));
}
function noteRun(file, { dataDir, appRoot, version, setupDone, now = Date.now() }) {
  const L = readRegistry(file).filter(x => !samePath(x.dataDir, dataDir));
  L.unshift({ dataDir, appRoot, version: String(version || ''), lastRun: now, setupDone: !!setupDone });
  writeAtomic(file, JSON.stringify({ installs: L.sort((a, b) => b.lastRun - a.lastRun).slice(0, 8) }, null, 1));
}
// another Boxshelf's setup this one could start from: the most recently run one whose data folder still has a finished
// setup (its config.json says so). null when there is none
function findOther(file, { dataDir }) {
  for (const x of readRegistry(file).sort((a, b) => b.lastRun - a.lastRun)) {
    if (samePath(x.dataDir, dataDir)) continue;
    const c = readJson(path.join(x.dataDir, 'config.json'));
    if (c && typeof c === 'object' && c.setupDone === true && c.ui && c.systems) return x;
  }
  return null;
}
// a Boxshelf folder (or its data folder) with a finished setup in it: an installs.json-style line, else null. The version
// is the one whose What's new it last showed, else the one in the folder's name or its zip folder's
// (Boxshelf-1.82.0-beta.12-windows\Boxshelf)
function setupAt(dir) {
  if (typeof dir !== 'string' || !dir || dir.length > 1024 || !path.isAbsolute(dir)) return null;
  dir = path.resolve(dir);
  const tries = [[path.join(dir, 'data'), dir]]; if (path.basename(dir).toLowerCase() === 'data') tries.unshift([dir, path.dirname(dir)]);
  for (const [dataDir, appRoot] of tries) {
    const f = path.join(dataDir, 'config.json'), c = readJson(f);
    if (!c || typeof c !== 'object' || c.setupDone !== true || !c.ui || !c.systems) continue;
    let lastRun = 0; try { lastRun = fs.statSync(f).mtimeMs; } catch {}
    const vOf = n => (n.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?/) || [''])[0];
    const seen = typeof c.ui.lastSeenVersion === 'string' ? c.ui.lastSeenVersion : '', named = vOf(path.basename(appRoot)) || vOf(path.basename(path.dirname(appRoot)));
    return { dataDir, appRoot, version: (seen || named).slice(0, 64), lastRun, setupDone: true };
  }
  return null;
}
// (beta.14) for a Boxshelf from before installs.json (beta.13 and older): the newest finished setup in a folder inside one of
// roots (the folder this Boxshelf is in, Downloads, Desktop, Documents), or one level further down in a folder whose name
// says Boxshelf (a zip unpacked into a folder of its own). A few hundred folder checks at most
function findNearby({ dataDir, roots = [], maxPerRoot = 400, maxInner = 40 }) {
  let best = null; const seen = new Set();
  const consider = d => { const k = process.platform === 'win32' ? path.resolve(d).toLowerCase() : path.resolve(d); if (seen.has(k)) return; seen.add(k);
    const x = setupAt(d); if (x && !samePath(x.dataDir, dataDir) && (!best || x.lastRun > best.lastRun)) best = x; };
  const kids = (d, max) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')).slice(0, max).map(e => [e.name, path.join(d, e.name)]); } catch { return []; } };
  for (const r of roots) {
    if (typeof r !== 'string' || !r || !path.isAbsolute(r)) continue;
    for (const [name, d] of kids(r, maxPerRoot)) { consider(d); if (/boxshelf/i.test(name)) for (const [, d2] of kids(d, maxInner)) consider(d2); }
  }
  return best;
}

// ---------- bringing a setup over ----------
async function walk(root, cb, cap = { n: 0, max: 400000 }) {
  let ents = []; try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { return; }
  for (const e of ents) { if (cap.n >= cap.max) return; const f = path.join(root, e.name);
    if (e.isDirectory()) await walk(f, cb, cap); else if (e.isFile()) { cap.n++; await cb(f); } }
}
// [[source file, '/'-path under .pending]] for what's chosen
async function bringList({ from, to, extras }) {
  const L = [], sameApp = samePath(from.appRoot, to.appRoot);
  const addFile = (src, rel) => { if (isFile(src)) L.push([src, rel]); };
  const addDir = async (root, rel) => { await walk(root, async f => { L.push([f, rel + '/' + path.relative(root, f).split(path.sep).join('/')]); }); };
  for (const f of STATE_FILES) addFile(path.join(from.dataDir, f), 'data/' + f);
  for (const d of BRING_DATA_DIRS) await addDir(path.join(from.dataDir, d), 'data/' + d);
  if (!sameApp) for (const d of BRING_APP_DIRS) await addDir(path.join(from.appRoot, d), 'app/' + d);
  if (extras) {
    for (const x of EXTRA_DATA) { const p = path.join(from.dataDir, x); if (isDir(p)) await addDir(p, 'data/' + x); else addFile(p, 'data/' + x); }
    if (!sameApp) for (const d of EXTRA_APP) await addDir(path.join(from.appRoot, d), 'app/' + d);
  }
  return L;
}
async function sizeOf(list) { let n = 0; for (const [f] of list) { try { n += (await fsp.stat(f)).size; } catch {} } return n; }
async function extrasSize({ from, to }) { const all = await bringList({ from, to, extras: true }), base = new Set((await bringList({ from, to, extras: false })).map(x => x[1])); return sizeOf(all.filter(x => !base.has(x[1]))); }
// does that setup's settings file hold sealed keys (Windows: they open only with that folder's "Local State")?
function hasSealedKeys(dataDir) { const c = readJson(path.join(dataDir, 'config.json')); return !!(c && ((c.keysEnc && Object.values(c.keysEnc).some(Boolean)) || (c.ra && c.ra.keyEnc))); }
// copies it all into .pending (applied at the next start). Paths written as {app} in the old settings point at the old
// folder (its emulators and games stay where they are). Returns { n, bytes, localState } (localState: the staged
// Chromium file the helper puts in place, or '')
async function bringStage({ from, to, extras, version, platform = process.platform, onProgress, signal }) {
  const list = await bringList({ from, to, extras }), total = await sizeOf(list), d = pendingBegin(to.dataDir);
  let done = 0, lastT = 0;
  try {
    for (const [src, rel] of list) {
      if (signal && signal.aborted) throw Object.assign(new Error('Canceled.'), { code: 'canceled' });
      const dst = path.join(d, ...rel.split('/')); await fsp.mkdir(path.dirname(dst), { recursive: true });
      if (rel === 'data/config.json') {
        let t = await fsp.readFile(src, 'utf8'); const c = JSON.parse(t); if (!c || c.setupDone !== true) throw new Error('That setup isn\'t finished.');
        if (!samePath(from.appRoot, to.appRoot)) t = t.replace(/\{app\}/gi, JSON.stringify(path.resolve(from.appRoot)).slice(1, -1));
        await fsp.writeFile(dst, t);
      } else await fsp.copyFile(src, dst);
      try { done += (await fsp.stat(src)).size; } catch {}
      const now = Date.now(); if (onProgress && now - lastT > 200) { lastT = now; try { onProgress(done, total); } catch {} }
    }
    let localState = '';
    if (platform === 'win32' && hasSealedKeys(from.dataDir) && isFile(path.join(from.dataDir, 'Local State'))) { localState = path.join(d, 'chromium', 'Local State'); await fsp.mkdir(path.dirname(localState), { recursive: true }); await fsp.copyFile(path.join(from.dataDir, 'Local State'), localState); }
    pendingCommit(to.dataDir, { kind: 'bring', from: String(version || ''), fromDir: from.dataDir, extras: !!extras });
    if (onProgress) try { onProgress(total, total); } catch {}
    return { n: list.length, bytes: total, localState };
  } catch (e) { pendingDrop(to.dataDir); throw e; }
}

// ---------- the backup file's extra parts ----------
// { files: { 'art-provenance.json': {...} }, defs: { 'sounds/<id>/pack.json': {...} } } (config.json and history.json
// are the backup's own parts); private files only when asked
function backupState({ dataDir, appRoot, withPrivate = false }) {
  const files = {}, defs = {};
  for (const f of STATE_FILES) { if (f === 'config.json' || f === 'history.json' || (PRIVATE.has(f) && !withPrivate)) continue; const j = readJson(path.join(dataDir, f)); if (j !== undefined) files[f] = j; }
  for (const [rel, full] of defFiles(appRoot)) { const j = readJson(full); if (j !== undefined) defs[rel] = j; }
  return { files, defs };
}
// a backup's extra parts into .pending (applied at the next start): only known file names; a definition only for a pack
// or theme whose folder is here (its sound / picture files aren't in a backup). Returns how many were staged
function stageRestore({ dataDir, appRoot, state, from }) {
  if (!state || typeof state !== 'object') return 0;
  const put = []; const files = state.files && typeof state.files === 'object' ? state.files : {}, defs = state.defs && typeof state.defs === 'object' ? state.defs : {};
  for (const [k, v] of Object.entries(files)) if (STATE_FILES.includes(k) && k !== 'config.json' && k !== 'history.json' && v && typeof v === 'object') put.push(['data/' + k, v]);
  for (const [k, v] of Object.entries(defs)) { const p = String(k).split('/'); const def = DEF_DIRS.find(([d, f]) => p.length === 3 && p[0] === d && p[2] === f);
    if (!def || !SAFE_NAME.test(p[1]) || p[1] === '.' || p[1] === '..' || !v || typeof v !== 'object' || !isDir(path.join(appRoot, p[0], p[1]))) continue; put.push(['app/' + k, v]); }
  if (!put.length) return 0;
  const d = pendingBegin(dataDir);
  for (const [rel, v] of put) writeAtomic(path.join(d, ...rel.split('/')), JSON.stringify(v, null, 1));
  pendingCommit(dataDir, { kind: 'restore', from: String(from || '') });
  return put.length;
}

module.exports = { STATE_FILES, PRIVATE, DEF_DIRS, BRING_APP_DIRS, BRING_DATA_DIRS, EXTRA_DATA, EXTRA_APP, safeVer, defFiles,
  safetyCopy, safetyList, latestSafety, rotate, checkAfterUpdate, applyPending, pendingBegin, pendingCommit, pendingDrop, pendingDir, stageUndo,
  registryFile, readRegistry, noteRun, findOther, setupAt, findNearby, samePath, bringList, extrasSize, hasSealedKeys, bringStage, backupState, stageRestore };
