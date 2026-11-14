// (beta.14) "Updates keep your setup": Update now / Restart to update (main/updater.js), the safety copy before every
// update and its Undo, "Bring my setup over" for a fresh Boxshelf folder, and the extra parts of Back up / Restore
// settings (main/keepsetup.js). main.js calls init() once, early() at the very start of startUp() (before anything reads
// the data folder), and backupExtra / withKeys / restoreExtra from its backup handlers.
// The screen: update:* and keep:* rows in Settings → System, the update card (app.js), the first-run card (setup.js).
'use strict';
const fs = require('fs'), path = require('path');
const updater = require('./updater'), keep = require('./keepsetup');

let D = null, st = { state: 'idle' }, ctrl = null, staged = null, problems = [], found = null, bringBusy = false;
const log = (...a) => { try { D.log(...a); } catch {} };
const dataDir = () => D.app.getPath('userData');
const env = () => D.env || process.env;
const regFile = () => keep.registryFile(D.app.getPath('appData'));
// where an earlier Boxshelf folder usually is: beside this one (or this one's zip folder, Boxshelf-<version>-windows\Boxshelf),
// Downloads, Desktop, Documents
function nearRoots() { const up = path.dirname(D.appRoot()), up2 = path.dirname(up), L = [up]; if (up2 !== up) L.push(up2); for (const k of ['downloads', 'desktop', 'documents']) { try { L.push(D.app.getPath(k)); } catch {} } return L; }
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const send = (ch, x) => { try { D.send(ch, x); } catch {} };
// a Steam Deck's Game Mode: Steam starts Boxshelf, so a Boxshelf the helper started wouldn't be Steam's; you start it again
const gameMode = () => { const e = env(); return process.platform === 'linux' && !!(e.SteamGamepadUI || e.GAMESCOPE_WAYLAND_DISPLAY || e.XDG_CURRENT_DESKTOP === 'gamescope'); };
function writable(dir) { const f = path.join(dir, `.boxshelf-write-test-${process.pid}`); try { fs.writeFileSync(f, ''); fs.unlinkSync(f); return true; } catch { return false; } }
const WHY = {
  dev: 'Update now works in the downloaded Boxshelf. Get the new one from its page instead.',
  'not-portable': 'This Boxshelf isn\'t the downloaded one, so it can\'t update itself. Get the new one from its page instead.',
  'not-appimage': 'Update now works when Boxshelf runs from its AppImage. Get the new one from its page instead.',
  arch: 'There\'s no AppImage for this kind of computer yet.',
  'read-only': 'Boxshelf can\'t write to its own folder, so it can\'t update itself. Get the new one from its page instead.',
  platform: 'Update now isn\'t on this device.'
};
let supMemo = null, supAt = 0;
function support() { const now = Date.now(); if (supMemo && now - supAt < 60000) return supMemo; supMemo = support0(); supAt = now; return supMemo; } // (the folder's write test, at most once a minute)
function support0() {
  const e = env();
  if (process.platform === 'win32') {
    if (!D.app.isPackaged) return { ok: false, why: 'dev' };
    if (!e.PORTABLE_EXECUTABLE_FILE) return { ok: false, why: 'not-portable' };
    if (!writable(D.appRoot())) return { ok: false, why: 'read-only' };
    return { ok: true, exe: e.PORTABLE_EXECUTABLE_FILE };
  }
  if (process.platform === 'linux') {
    if (!D.app.isPackaged || !e.APPIMAGE) return { ok: false, why: 'not-appimage' };
    if (process.arch !== 'x64') return { ok: false, why: 'arch' };
    if (!writable(path.dirname(e.APPIMAGE))) return { ok: false, why: 'read-only' };
    return { ok: true, appImage: e.APPIMAGE };
  }
  return { ok: false, why: 'platform' };
}
function view() { const s = support(); return { ...st, support: s.ok, why: s.ok ? '' : WHY[s.why] || '', selfRestart: !gameMode() }; }
function set(x) { st = { ...x }; send('update:state', view()); return view(); }
const updateDir = () => path.join(dataDir(), 'update');

// ---------- Update now ----------
async function start() {
  if (['downloading', 'unpacking', 'ready', 'installing'].includes(st.state)) return view();
  const s = support(); if (!s.ok) return set({ state: 'error', error: WHY[s.why] });
  let r = null; try { r = await D.updates.check(D.version, false); } catch {}
  if (!r || r.error) return set({ state: 'error', error: 'Couldn\'t reach the beta page. Try again later.' });
  if (!r.newer) return set({ state: 'idle' });
  let asset = null; for (const rel of D.updates.releases(r.latest)) { asset = updater.pickAsset(rel, { repos: D.updates.REPOS }); if (asset) break; }
  if (!asset) return set({ state: 'error', version: r.latest, error: `Boxshelf ${r.latest} has no download for this computer yet. Try again later, or get it from its page.` });
  ctrl = new AbortController(); const signal = ctrl.signal, v = asset.version;
  set({ state: 'downloading', version: v, pct: 0 });
  log('Update now:', asset.name, `(${(asset.size / 1048576).toFixed(1)} MB${asset.sha256 ? ', SHA-256 from GitHub' : asset.sumsUrl ? ', SHA256SUMS' : ', size check only'})`);
  (async () => {
    const onProgress = (got, total) => { if (st.state === 'downloading') set({ state: 'downloading', version: v, pct: Math.min(99, Math.floor(got * 100 / total)) }); };
    let tmp = '';
    try {
      if (process.platform === 'win32') {
        const dir = path.join(updateDir(), keep.safeVer(v)); fs.rmSync(dir, { recursive: true, force: true });
        const zip = tmp = path.join(dir, asset.name);
        const got = await updater.download(asset, zip, { version: D.version, onProgress, signal });
        set({ state: 'unpacking', version: v });
        const rel = await updater.unzip(zip, path.join(dir, 'files'), { signal });
        const u = updater.unpackedRoot(path.join(dir, 'files'), rel);
        const pairs = updater.planWindows({ root: u.root, files: u.files, appRoot: D.appRoot(), realExe: s.exe });
        fs.rmSync(zip, { force: true });
        staged = { version: v, dir, pairs };
        log('Update now: ready,', pairs.length, 'file(s) to copy', got.verified ? '(checksum matched)' : '(size matched)');
      } else {
        const dest = tmp = path.join(path.dirname(s.appImage), `.Boxshelf-${keep.safeVer(v)}.AppImage.new`);
        const got = await updater.download(asset, dest, { version: D.version, onProgress, signal });
        fs.chmodSync(dest, 0o755);
        if (!updater.isELF(dest)) throw Object.assign(new Error('That download isn\'t a Linux program.'), { code: 'zip' });
        staged = { version: v, file: dest };
        log('Update now: ready', got.verified ? '(checksum matched)' : '(size matched)');
      }
      set({ state: 'ready', version: v });
    } catch (e) {
      staged = null;
      if (process.platform === 'win32') { try { fs.rmSync(path.join(updateDir(), keep.safeVer(v)), { recursive: true, force: true }); } catch {} } else if (tmp) { try { fs.rmSync(tmp, { force: true }); } catch {} }
      if (e.code === 'canceled') { log('Update now: canceled'); set({ state: 'idle' }); }
      else { log('Update now failed:', e.code || '', e.message); set({ state: 'error', version: v, error: e.message }); }
    } finally { ctrl = null; }
  })();
  return view();
}
function cancel() { if (ctrl) ctrl.abort(); return view(); }
// the helper: data\update\result.json says how it went (read by early() at the next start)
function helperPaths() { return { resultFile: path.join(updateDir(), 'result.json'), logFile: path.join(updateDir(), 'helper.log') }; }
function launchHelper(script) { fs.mkdirSync(updateDir(), { recursive: true }); return updater.launch(script, { tempDir: D.app.getPath('temp'), env: env() }); }
function install() {
  if (D.isGameRunning()) throw new Error('Close your game first: Boxshelf never updates during a game.');
  if (st.state !== 'ready' || !staged) throw new Error('The update isn\'t downloaded yet.');
  const s = support(); if (!s.ok) throw new Error(WHY[s.why]);
  try { D.flushConfig(); } catch {}
  try { const c = keep.safetyCopy({ dataDir: dataDir(), appRoot: D.appRoot(), version: D.version }); log('Safety copy before the update:', c.files, 'file(s) in', path.relative(dataDir(), c.dir)); }
  catch (e) { log('Safety copy failed:', e.message); throw new Error('Couldn\'t make the safety copy of your settings, so nothing was changed. ' + e.message); }
  const hp = helperPaths(); try { fs.rmSync(hp.resultFile, { force: true }); } catch {}
  const script = process.platform === 'win32'
    ? updater.windowsScript({ kind: 'update', from: D.version, to: staged.version, pairs: staged.pairs, keepDir: path.join(staged.dir, 'replaced'), waitPid: process.pid, stubPid: process.ppid, stubExe: s.exe, start: { exe: s.exe, cwd: D.appRoot() }, ...hp })
    : updater.linuxScript({ kind: 'update', from: D.version, to: staged.version, waitPid: process.pid, staged: staged.file, target: s.appImage, relaunch: !gameMode(), ...hp });
  launchHelper(script); log('Update now: closing for the update to', staged.version);
  set({ state: 'installing', version: staged.version });
  setTimeout(() => D.app.quit(), 400);
  return view();
}
// close and start again (a setup brought over, Undo): through the helper, so the new start waits for this one to be gone
// (and, Windows, puts the old folder's "Local State" in place, which its sealed keys need)
function restart({ localState = '' } = {}) {
  const e = env(), hp = helperPaths();
  if (process.platform === 'win32' && D.app.isPackaged) {
    const exe = e.PORTABLE_EXECUTABLE_FILE || process.execPath;
    launchHelper(updater.windowsScript({ kind: 'restart', from: D.version, to: D.version, pairs: localState ? [[localState, path.join(dataDir(), 'Local State')]] : [], keepDir: path.join(updateDir(), 'replaced-restart'),
      waitPid: process.pid, stubPid: e.PORTABLE_EXECUTABLE_FILE ? process.ppid : 0, stubExe: exe, start: { exe, cwd: D.appRoot() }, ...hp }));
  } else if (process.platform === 'linux' && D.app.isPackaged && e.APPIMAGE) {
    launchHelper(updater.linuxScript({ kind: 'restart', from: D.version, to: D.version, waitPid: process.pid, staged: '', target: e.APPIMAGE, relaunch: !gameMode(), ...hp }));
  } else { try { D.app.relaunch(); } catch {} }
  setTimeout(() => D.app.quit(), 400);
}

// ---------- at start ----------
function early() {
  const dd = dataDir(), app = D.appRoot(), notices = [];
  try {
    const p = keep.applyPending({ dataDir: dd, appRoot: app, log });
    if (p && p.kind === 'bring') notices.push(`Your setup from Boxshelf ${p.from || 'your other folder'} is here.`);
    else if (p && p.kind === 'undo') notices.push(`Your settings from before the update (Boxshelf ${p.from}) are back.`);
    else if (p && p.kind === 'restore') notices.push('The rest of your backup is in: Art Studio and manual picks, sound and theme choices.');
  } catch (e) { log('Waiting change:', e.message); }
  try {
    const rf = path.join(dd, 'update', 'result.json'), r = readJson(rf);
    if (r) { fs.rmSync(rf, { force: true });
      if (r.kind === 'update') { if (r.ok) log('Updated from', r.from, 'to', r.to); else { log('The update to', r.to, 'failed:', r.error); notices.push(`The update to Boxshelf ${r.to} didn't finish, so you're still on ${D.version}. Nothing else changed.${r.error ? ' (' + String(r.error).slice(0, 160) + ')' : ''}`); } }
      else if (!r.ok) { log('Restart helper failed:', r.error); notices.push('Your keys and passwords couldn\'t be brought over. Enter them again in Settings → Accounts & services.'); } }
    // nothing downloaded survives a restart (it's fetched again when asked)
    let ents = []; try { ents = fs.readdirSync(path.join(dd, 'update'), { withFileTypes: true }); } catch {}
    for (const x of ents) if (x.isDirectory()) fs.rmSync(path.join(dd, 'update', x.name), { recursive: true, force: true });
    const img = env().APPIMAGE; if (process.platform === 'linux' && img) { let L = []; try { L = fs.readdirSync(path.dirname(img)); } catch {} for (const n of L) if (/^\.Boxshelf-.*\.AppImage\.new(\.part)?$/.test(n)) { try { fs.rmSync(path.join(path.dirname(img), n), { force: true }); } catch {} } }
  } catch (e) { log('Update result:', e.message); }
  try {
    const c = keep.checkAfterUpdate({ dataDir: dd, appRoot: app, version: D.version, log });
    if (c) { problems = c.problems;
      if (c.fixedConfig) notices.push('Your settings file didn\'t come through the update, so it was put back from the safety copy.');
      if (c.problems.length) notices.push('Some of your settings didn\'t come through the update. Settings → System → Undo the update\'s settings changes puts them back.'); }
  } catch (e) { log('Update check:', e.message); }
  try { const c = readJson(path.join(dd, 'config.json')); keep.noteRun(regFile(), { dataDir: dd, appRoot: app, version: D.version, setupDone: !!(c && c.setupDone) }); } catch (e) { log('installs.json:', e.message); }
  if (notices.length) { const t = setTimeout(() => notices.forEach((x, i) => setTimeout(() => send('app:notice', x), i * 5000)), 9000); if (t.unref) t.unref(); }
  return notices;
}

// ---------- the backup file ----------
const KEY_NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/;
function backupExtra(cfg, withKeys) {
  const x = { state: keep.backupState({ dataDir: dataDir(), appRoot: D.appRoot(), withPrivate: !!withKeys }) };
  if (withKeys) { const k = {}; for (const [n, v] of Object.entries((cfg && cfg.keys) || {})) if (KEY_NAME.test(n) && typeof v === 'string' && v) k[n] = v;
    x.keysIncluded = true; x.secrets = { keys: k, ra: cfg && cfg.ra && cfg.ra.key ? { user: String(cfg.ra.user || ''), key: String(cfg.ra.key) } : null }; }
  return x;
}
// a backup with keys in it: those keys over today's (sealed again for this PC when saved)
function withKeys(next, b) {
  const s = b && b.secrets; if (!s || typeof s !== 'object') return next;
  const out = { ...next, keys: { ...(next.keys || {}) } };
  if (s.keys && typeof s.keys === 'object') for (const [n, v] of Object.entries(s.keys)) if (KEY_NAME.test(n) && Object.prototype.hasOwnProperty.call(out.keys, n) && typeof v === 'string' && v && v.length < 4096) out.keys[n] = v;
  if (s.ra && typeof s.ra.key === 'string' && s.ra.key && s.ra.key.length < 512) out.ra = { ...(out.ra || {}), key: s.ra.key, user: typeof s.ra.user === 'string' ? s.ra.user.slice(0, 120) : (out.ra && out.ra.user) || '' };
  return out;
}
function restoreExtra(b) { try { return keep.stageRestore({ dataDir: dataDir(), appRoot: D.appRoot(), state: b && b.state, from: b && b.version }); } catch (e) { log('Restore: the extra parts were not staged:', e.message); return 0; } }

// ---------- init: the screen's calls ----------
function init(deps) {
  D = deps; const h = D.handle;
  h('update:info', () => view());
  h('update:start', () => start());
  h('update:cancel', () => cancel());
  h('update:install', () => install());
  h('keep:info', () => { const m = keep.latestSafety(dataDir()); return { safety: m ? { version: m.version, at: m.at, files: m.files.length } : null, problems, current: D.version }; });
  h('keep:undo', () => {
    if (D.isGameRunning()) throw new Error('Close your game first.');
    try { D.flushConfig(); } catch {}
    const r = keep.stageUndo({ dataDir: dataDir() }); log('Undo the update\'s settings changes:', r.n, 'file(s) from', r.version); restart(); return { ok: true, version: r.version };
  });
  // Bring my setup over: only for a Boxshelf whose setup isn't done, and only a folder found here or chosen in the system's
  // folder picker (never a path from the screen). installs.json first, then (a Boxshelf from before it) the folders nearby
  const shown = x => (x ? { version: x.version, dataDir: x.dataDir, lastRun: x.lastRun } : null);
  h('bring:find', () => {
    const c = D.getCfg(); if (!c || c.setupDone) return null;
    if (fs.existsSync(path.join(dataDir(), 'bring-skipped'))) return null;
    found = keep.findOther(regFile(), { dataDir: dataDir() });
    if (!found) { try { found = keep.findNearby({ dataDir: dataDir(), roots: nearRoots() }); if (found) log('Bring my setup over: found an earlier Boxshelf beside this one or in a usual folder'); } catch (e) { log('Looking for an earlier Boxshelf:', e.message); } }
    return shown(found);
  });
  h('bring:choose', async () => {
    const c = D.getCfg(); if (!c || c.setupDone) return null;
    if (bringBusy || !D.pickFolder) return null;
    const dir = await D.pickFolder('Choose your old Boxshelf folder');
    if (!dir) return null;
    const x = keep.setupAt(dir);
    if (!x) throw new Error('That folder has no finished Boxshelf setup. Choose the folder your old Boxshelf ran from (it has a "data" folder in it).');
    if (keep.samePath(x.dataDir, dataDir())) throw new Error('That\'s this Boxshelf\'s own folder. Choose the old one.');
    found = x; log('Bring my setup over: a folder was chosen'); return shown(found);
  });
  h('bring:size', async () => (found ? keep.extrasSize({ from: found, to: { dataDir: dataDir(), appRoot: D.appRoot() } }) : 0));
  h('bring:skip', () => { found = null; try { fs.writeFileSync(path.join(dataDir(), 'bring-skipped'), ''); } catch {} return true; });
  h('bring:copy', async ({ extras } = {}) => {
    if (!found) throw new Error('That setup isn\'t there any more.');
    if (bringBusy) throw new Error('Already copying.');
    bringBusy = true;
    try {
      const r = await keep.bringStage({ from: found, to: { dataDir: dataDir(), appRoot: D.appRoot() }, extras: !!extras, version: found.version, onProgress: (done, total) => send('bring:progress', { done, total }) });
      log('Bring my setup over:', r.n, 'file(s),', (r.bytes / 1048576).toFixed(1), 'MB', extras ? '(with extras)' : '', r.localState ? '(and its key store)' : '');
      restart({ localState: r.localState }); return { ok: true };
    } finally { bringBusy = false; }
  });
}

module.exports = { init, early, backupExtra, withKeys, restoreExtra, support, _state: () => st };
