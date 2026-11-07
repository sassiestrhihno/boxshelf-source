// (Linux) PC games without Steam: Windows games through Wine or Proton, and Epic Games through legendary.
// Linux only; main.js calls it behind linux.isLinux. Windows keeps main/pcgames.js exactly as it is.
//
//   - Runners: the Proton and Wine builds already on the PC, found where Steam, Heroic, Lutris and the distro put them.
//     Proton runs through umu-run when it's installed (the Steam Linux Runtime and protonfixes, the way Heroic and
//     Lutris run Proton outside Steam), else through Proton's own script. Each game gets its own Wine prefix.
//   - Epic: legendary (the Epic Games client Heroic itself uses) does the account and the install list. When Heroic is
//     set up, its legendary folder is shared, so its sign-in, installs and each game's Wine settings (its runner, prefix
//     and environment from Heroic's GamesConfig) are used as they are: a game plays the same, with the same saves, from
//     either launcher. `legendary launch --json` gives the game's program, folder and Epic's sign-in arguments; Boxshelf
//     starts the game itself, so the quit combo, Home menu and play time work as for any game.
// Every path Boxshelf starts comes from these lists, never from the screen.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawn, execFile } = require('child_process');

let log = () => {}, dataDir = '', appRoot = '';
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isExec = p => { try { fs.accessSync(p, fs.constants.X_OK); return isFile(p); } catch { return false; } };
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'game';
const H = () => os.homedir();
const which = name => { for (const d of String(process.env.PATH || '').split(':').filter(Boolean)) { const f = path.join(d, name); if (isExec(f)) return f; } return null; };
const ls = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => path.join(d, e.name)); } catch { return []; } };

function init(opts = {}) { dataDir = opts.dataDir || ''; appRoot = opts.appRoot || ''; if (opts.log) log = opts.log; }

// ---------- Wine and Proton builds ----------
// Proton: a folder with a `proton` script (Steam's own builds, GE-Proton, UMU-Proton, distro builds such as CachyOS's)
const PROTON_DIRS = () => [
  path.join(H(), '.steam', 'root', 'compatibilitytools.d'), path.join(H(), '.local', 'share', 'Steam', 'compatibilitytools.d'),
  path.join(H(), '.var', 'app', 'com.valvesoftware.Steam', 'data', 'Steam', 'compatibilitytools.d'),
  '/usr/share/steam/compatibilitytools.d', '/usr/local/share/steam/compatibilitytools.d',
  path.join(H(), '.config', 'heroic', 'tools', 'proton'), path.join(H(), '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic', 'tools', 'proton')];
const STEAM_COMMON = () => [path.join(H(), '.steam', 'steam', 'steamapps', 'common'), path.join(H(), '.local', 'share', 'Steam', 'steamapps', 'common')];
// Wine: a build folder with bin/wine (Heroic's Wine-GE / Wine-Staging-TkG, Lutris' runners), and the system's wine
const WINE_DIRS = () => [path.join(H(), '.config', 'heroic', 'tools', 'wine'), path.join(H(), '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic', 'tools', 'wine'),
  path.join(H(), '.local', 'share', 'lutris', 'runners', 'wine')];
// newest first: "GE-Proton11-5" before "GE-Proton10-4", "Proton 9.0" before "Proton 8.0"
const verKey = n => (String(n).match(/\d+/g) || []).map(x => x.padStart(6, '0')).join('.');
function runners() {
  const out = [], seen = new Set();
  const add = r => { let real = r.path; try { real = fs.realpathSync(r.path); } catch {} if (seen.has(real)) return; seen.add(real); out.push(r); };
  const protons = [];
  for (const d of PROTON_DIRS()) for (const p of ls(d)) if (isFile(path.join(p, 'proton'))) protons.push(p);
  for (const d of STEAM_COMMON()) for (const p of ls(d)) if (/^proton/i.test(path.basename(p)) && isFile(path.join(p, 'proton'))) protons.push(p);
  protons.sort((a, b) => verKey(path.basename(b)).localeCompare(verKey(path.basename(a))));
  for (const p of protons) add({ id: 'proton:' + p, kind: 'proton', name: path.basename(p), path: p });
  const wines = [];
  for (const d of WINE_DIRS()) for (const p of ls(d)) if (isExec(path.join(p, 'bin', 'wine'))) wines.push(path.join(p, 'bin', 'wine'));
  wines.sort((a, b) => verKey(path.basename(path.dirname(path.dirname(b)))).localeCompare(verKey(path.basename(path.dirname(path.dirname(a))))));
  for (const w of wines) add({ id: 'wine:' + w, kind: 'wine', name: path.basename(path.dirname(path.dirname(w))), path: w });
  const sys = which('wine'); if (sys) add({ id: 'wine:' + sys, kind: 'wine', name: 'Wine (system)', path: sys });
  return out;
}
// a runner from its id (Settings keeps the id), or the best one found: Proton first (it brings DXVK and VKD3D), the
// newest GE-Proton or UMU-Proton before Valve's builds, then Wine
function pickRunner(id, list = runners()) {
  if (id) { const r = list.find(x => x.id === id); if (r) return r; }
  return list.find(r => r.kind === 'proton' && /ge-proton|umu-proton/i.test(r.name)) || list.find(r => r.kind === 'proton') || list[0] || null;
}
// a runner Heroic named in a game's settings ({ bin, type, name }), if it's here
function runnerFromHeroic(v) {
  if (!v || typeof v !== 'object' || typeof v.bin !== 'string') return null;
  if (v.type === 'proton' && isFile(v.bin)) return { id: 'proton:' + path.dirname(v.bin), kind: 'proton', name: String(v.name || path.basename(path.dirname(v.bin))), path: path.dirname(v.bin) };
  if (v.type === 'wine' && isExec(v.bin)) return { id: 'wine:' + v.bin, kind: 'wine', name: String(v.name || 'Wine'), path: v.bin };
  return null;
}
const umuRun = () => which('umu-run') || [path.join(H(), '.local', 'bin', 'umu-run'), '/usr/bin/umu-run', '/usr/local/bin/umu-run'].find(isExec) || null;
const steamRoot = () => [path.join(H(), '.steam', 'steam'), path.join(H(), '.local', 'share', 'Steam')].find(isDir) || '';
const prefixRoot = custom => custom && path.isAbsolute(custom) ? custom : path.join(appRoot || path.join(H(), 'Boxshelf'), 'Prefixes');
const prefixFor = (id, custom) => path.join(prefixRoot(custom), slug(id));

// the command that runs a Windows program: { cmd, args, env, cwd, how }. env is the full environment for the child.
//   proton + umu-run: WINEPREFIX / STEAM_COMPAT_DATA_PATH = the prefix, PROTONPATH = the build (as Heroic does)
//   proton alone:     <build>/proton waitforexitandrun <exe>
//   wine:             <wine> <exe>, WINEPREFIX = the prefix
function windowsCommand({ exe, args = [], cwd, runner, prefix, env = {}, gameId, store }) {
  if (!runner) throw new Error('No Wine or Proton found. Install Wine, or a Proton build (GE-Proton) with Steam, Heroic or ProtonUp-Qt.');
  try { fs.mkdirSync(prefix, { recursive: true }); } catch (e) { throw new Error(`Can't make the Wine prefix ${prefix}: ${e.message}`); }
  const base = { ...process.env, ...env };
  delete base.APPDIR; delete base.APPIMAGE; delete base.ARGV0; delete base.OWD; // (an AppImage's own: not for the game)
  if (process.env.APPDIR && base.LD_LIBRARY_PATH) base.LD_LIBRARY_PATH = base.LD_LIBRARY_PATH.split(':').filter(p => !p.startsWith(process.env.APPDIR)).join(':');
  const dir = cwd || path.dirname(exe);
  if (runner.kind === 'proton') {
    const pe = { ...base, WINEPREFIX: prefix, STEAM_COMPAT_DATA_PATH: prefix, STEAM_COMPAT_CLIENT_INSTALL_PATH: steamRoot() || prefix, STEAM_COMPAT_INSTALL_PATH: dir, PROTONPATH: runner.path };
    const umu = umuRun();
    if (umu) return { cmd: umu, args: [exe, ...args], cwd: dir, env: { ...pe, GAMEID: gameId || 'umu-0', STORE: store || 'none', UMU_RUNTIME_UPDATE: pe.UMU_RUNTIME_UPDATE || '1' }, how: `${runner.name} (umu-run)` };
    return { cmd: path.join(runner.path, 'proton'), args: ['waitforexitandrun', exe, ...args], cwd: dir, env: pe, how: runner.name };
  }
  return { cmd: runner.path, args: [exe, ...args], cwd: dir, env: { ...base, WINEPREFIX: prefix }, how: runner.name };
}
// end whatever is left in a prefix (wineserver) once its game has closed or been forced
function endPrefix(runner, prefix) {
  if (!runner || !prefix) return;
  const ws = runner.kind === 'wine' ? path.join(path.dirname(runner.path), 'wineserver') : path.join(runner.path, 'files', 'bin', 'wineserver');
  const pfx = runner.kind === 'proton' && isDir(path.join(prefix, 'pfx')) ? path.join(prefix, 'pfx') : prefix;
  if (isExec(ws)) try { execFile(ws, ['-k'], { env: { ...process.env, WINEPREFIX: pfx }, timeout: 10000 }, () => {}); } catch {}
}
const isWindowsProgram = exe => /\.(exe|msi|bat|lnk)$/i.test(String(exe || ''));

// ---------- umu's game ids (protonfixes): asked once per game, kept in data/umu-ids.json ----------
let umuIds = null; const umuFile = () => path.join(dataDir, 'umu-ids.json');
function umuId(store, codename) {
  if (!umuIds) umuIds = readJson(umuFile()) || {};
  const k = store + ':' + codename, e = umuIds[k];
  if (e && (e.id || Date.now() - e.at < 7 * 864e5)) return Promise.resolve(e.id || null);
  return new Promise(res => {
    const rq = https.get(`https://umu.openwinecomponents.org/umu_api.php?store=${encodeURIComponent(store)}&codename=${encodeURIComponent(codename)}`, { headers: { 'User-Agent': 'Boxshelf' }, timeout: 4000 }, r => {
      let b = ''; r.setEncoding('utf8'); r.on('data', c => { b += c; if (b.length > 1e5) rq.destroy(); });
      r.on('end', () => { let id = null; try { const j = JSON.parse(b); const x = Array.isArray(j) ? j[0] : j; if (x && /^umu-[\w.-]{1,40}$/.test(String(x.umu_id || ''))) id = x.umu_id; } catch {}
        umuIds[k] = { id, at: Date.now() }; try { fs.writeFileSync(umuFile(), JSON.stringify(umuIds)); } catch {} res(id); }); });
    rq.on('timeout', () => rq.destroy(new Error('timeout'))); rq.on('error', () => res(null));
  });
}

// ---------- Heroic ----------
const HEROIC_DIRS = () => [path.join(H(), '.config', 'heroic'), path.join(H(), '.var', 'app', 'com.heroicgameslauncher.hgl', 'config', 'heroic')];
const heroicDir = () => HEROIC_DIRS().find(isDir) || '';
// a game's own Wine settings in Heroic: { runner, prefix, env } (nothing when Heroic has none, or its runner isn't here)
function heroicGame(appName) {
  const d = heroicDir(); if (!d || !/^[\w.-]{1,120}$/.test(appName)) return null;
  const j = readJson(path.join(d, 'GamesConfig', appName + '.json')), g = j && j[appName]; if (!g) return null;
  const env = {}; for (const e of Array.isArray(g.enviromentOptions) ? g.enviromentOptions : []) if (e && /^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(String(e.key || ''))) env[e.key] = String(e.value ?? '').replace(/^"(.*)"$/, '$1').slice(0, 2000);
  return { runner: runnerFromHeroic(g.wineVersion), prefix: typeof g.winePrefix === 'string' && path.isAbsolute(g.winePrefix) ? g.winePrefix : '', env };
}
// where Heroic installs games (its Settings → Default install path), when it's a folder that can be written
function heroicInstallDir() {
  const d = heroicDir(), c = d && readJson(path.join(d, 'config.json')), p = c && c.defaultSettings && c.defaultSettings.defaultInstallPath;
  if (typeof p !== 'string' || !p) return '';
  const full = p.replace(/^~(?=\/|$)/, H());
  try { fs.accessSync(full, fs.constants.W_OK); return full; } catch { return ''; }
}

// ---------- legendary (Epic Games) ----------
// legendary itself: the one chosen in Settings, one on the PATH, then the copy inside Heroic (distro package, the
// tarball in /opt, an extracted AppImage), then one Boxshelf was given in data/tools
const HEROIC_LEGENDARY = ['/usr/lib/heroic-games-launcher/app.asar.unpacked/build/bin/x64/linux/legendary', '/opt/Heroic/resources/app.asar.unpacked/build/bin/x64/linux/legendary',
  '/opt/heroic/resources/app.asar.unpacked/build/bin/x64/linux/legendary', '/usr/lib/heroic/resources/app.asar.unpacked/build/bin/x64/linux/legendary'];
function legendaryBin(custom) {
  if (custom && isExec(custom)) return custom;
  return which('legendary') || HEROIC_LEGENDARY.find(isExec) || [path.join(dataDir, 'tools', 'legendary')].find(isExec) || null;
}
// legendary's folder (its sign-in and install list): Heroic's when Heroic is set up, so both launchers see the same account
// and games; otherwise Boxshelf's own data/legendary
function legendaryConfig() {
  if (process.env.LEGENDARY_CONFIG_PATH && isDir(process.env.LEGENDARY_CONFIG_PATH)) return { dir: process.env.LEGENDARY_CONFIG_PATH, shared: 'env' };
  for (const d of HEROIC_DIRS()) { const l = path.join(d, 'legendaryConfig', 'legendary'); if (isDir(l)) return { dir: l, shared: 'heroic' }; }
  return { dir: path.join(dataDir, 'legendary'), shared: '' };
}
function runLegendary(bin, args, { ms = 60000, onLine } = {}) {
  let proc = null; // (the executor runs at once: the child is known before the promise is returned, for Cancel)
  const pr = new Promise(res => {
    const cfg = legendaryConfig(); try { fs.mkdirSync(cfg.dir, { recursive: true }); } catch {}
    let out = '', err = '', done = false;
    const env = { ...process.env, LEGENDARY_CONFIG_PATH: cfg.dir, PYTHONUNBUFFERED: '1' };
    delete env.APPDIR; delete env.APPIMAGE;
    let p; try { p = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return res({ code: -1, out: '', err: e.message }); }
    proc = p;
    const t = ms ? setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, ms) : null;
    const lines = (buf, s) => { if (!onLine) return buf + s; buf += s; const parts = buf.split(/\r?\n|\r/); const rest = parts.pop(); for (const l of parts) try { onLine(l); } catch {} return rest; };
    let ob = '', eb = '';
    p.stdout.on('data', c => { const s = c.toString(); if (out.length < 32e6) out += s; ob = lines(ob, s); });
    p.stderr.on('data', c => { const s = c.toString(); if (err.length < 2e6) err += s; eb = lines(eb, s); });
    const fin = code => { if (done) return; done = true; if (t) clearTimeout(t); res({ code, out, err }); };
    p.on('error', e => { err += e.message; fin(-1); }); p.on('close', fin);
  });
  pr.proc = proc;
  return pr;
}
// the signed-in account's name (never its tokens), or null
function epicAccount() { const u = readJson(path.join(legendaryConfig().dir, 'user.json')); return u && (u.displayName || u.account_id) ? String(u.displayName || 'Epic account').slice(0, 80) : null; }
// the installed Epic games: legendary's installed.json (read, never written); DLC and games whose folder is gone left out
function epicGames() {
  const j = readJson(path.join(legendaryConfig().dir, 'installed.json')); if (!j || typeof j !== 'object') return [];
  const out = [];
  for (const [app, g] of Object.entries(j).slice(0, 2000)) {
    if (!g || typeof g !== 'object' || g.is_dlc || !/^[\w.-]{1,120}$/.test(app)) continue;
    const dir = String(g.install_path || ''); if (!dir || !isDir(dir)) continue;
    out.push({ id: 'epic-' + slug(app), source: 'epic', title: String(g.title || app).trim().slice(0, 120), appName: app, dir, exe: g.executable ? path.join(dir, String(g.executable)) : '', platform: String(g.platform || 'Windows') });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}
// sign in with the code from Epic's login page (main.js shows it and reads the code); { ok, name } or { error }
async function epicSignIn(bin, code) {
  if (!/^[\w-]{8,200}$/.test(String(code || ''))) return { error: "Epic didn't give a sign-in code. Try again." };
  const r = await runLegendary(bin, ['auth', '--code', String(code)], { ms: 60000 });
  const name = epicAccount();
  if (r.code === 0 && name) { log('Epic: signed in'); return { ok: true, name }; }
  log('Epic sign-in failed', r.code, (r.err || '').split('\n').filter(l => /ERROR|error/.test(l)).slice(-2).join(' | ').replace(/[\w-]{24,}/g, '…'));
  return { error: "Couldn't sign in to Epic Games. Try again in a moment." };
}
async function epicSignOut(bin) { const r = await runLegendary(bin, ['auth', '--delete'], { ms: 30000 }); log('Epic: signed out', r.code); return { ok: !epicAccount() }; }
// every game the account owns, for Settings → Epic library: [{ appName, title, installed, cover }] (legendary asks Epic)
async function epicLibrary(bin) {
  const r = await runLegendary(bin, ['list', '--json'], { ms: 120000 });
  if (r.code !== 0) return { error: epicAccount() ? "Couldn't get your Epic library. Check the internet connection." : 'Sign in to Epic Games first.' };
  let list = []; try { list = JSON.parse(r.out); } catch { return { error: "Couldn't read the Epic library." }; }
  const have = new Set(epicGames().map(g => g.appName)), out = [];
  for (const g of Array.isArray(list) ? list.slice(0, 5000) : []) {
    const app = String(g && g.app_name || ''); if (!/^[\w.-]{1,120}$/.test(app)) continue;
    const imgs = g.metadata && Array.isArray(g.metadata.keyImages) ? g.metadata.keyImages : [];
    const cover = (imgs.find(i => i && i.type === 'DieselGameBoxTall') || imgs.find(i => i && i.type === 'DieselGameBox') || {}).url;
    out.push({ appName: app, title: String(g.app_title || app).slice(0, 120), installed: have.has(app), cover: typeof cover === 'string' && /^https:\/\//.test(cover) ? cover : '' });
  }
  return { games: out.sort((a, b) => a.title.localeCompare(b.title)) };
}
// one install at a time: { appName, title, pct, speed, eta, state: 'installing' | 'done' | 'failed' | 'cancelled' }
let job = null;
function epicJob() { return job ? { appName: job.appName, title: job.title, pct: job.pct, speed: job.speed, eta: job.eta, state: job.state, error: job.error, update: !!job.update } : null; }
function epicInstallDir(custom) { if (custom && path.isAbsolute(custom)) return custom; return heroicInstallDir() || path.join(appRoot || path.join(H(), 'Boxshelf'), 'Epic Games'); }
function epicInstall(bin, appName, title, baseDir, onChange, update = false) {
  if (!/^[\w.-]{1,120}$/.test(String(appName || ''))) throw new Error('Unknown Epic game.');
  if (job && job.state === 'installing') throw new Error(`${job.title} is installing. Wait for it to finish, or cancel it.`);
  if (!update) try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) { throw new Error(`Can't use ${baseDir} for games: ${e.message}`); }
  job = { appName, title: String(title || appName).slice(0, 120), pct: 0, speed: '', eta: '', state: 'installing', error: '', update };
  const me = job, tell = () => { try { onChange(epicJob()); } catch {} };
  log(update ? 'Epic: updating' : 'Epic: installing', appName, update ? '' : 'into ' + baseDir);
  const onLine = l => {
    let m = /Progress:\s*([\d.]+)%.*?ETA:\s*([\d:]+)/.exec(l); if (m) { me.pct = Math.min(100, +m[1]); me.eta = m[2]; tell(); return; }
    m = /\+ Download\s*-\s*([\d.]+ \w+\/s)/.exec(l); if (m) me.speed = m[1];
  };
  const p = runLegendary(bin, update ? ['install', appName, '--update-only', '--skip-dlcs', '--skip-sdl', '-y'] : ['install', appName, '--base-path', baseDir, '--platform', 'Windows', '--skip-dlcs', '--skip-sdl', '-y'], { ms: 0, onLine });
  me.proc = p.proc;
  p.then(r => {
    if (me.state === 'cancelled') { tell(); return; }
    me.state = r.code === 0 ? 'done' : 'failed';
    if (r.code !== 0) { const e = (r.err.match(/ERROR: (.+)/g) || []).pop(); me.error = e ? e.replace(/^ERROR: /, '').slice(0, 200) : 'The install stopped.'; log('Epic install failed', appName, me.error); }
    else { me.pct = 100; log('Epic: installed', appName); }
    tell();
  });
  return epicJob();
}
function epicCancel() { if (!job || job.state !== 'installing') return false; job.state = 'cancelled'; const p = job.proc; try { if (p) p.kill('SIGTERM'); } catch {} log('Epic: install cancelled', job.appName); return true; }
async function epicUninstall(bin, appName) {
  if (!/^[\w.-]{1,120}$/.test(String(appName || ''))) throw new Error('Unknown Epic game.');
  const r = await runLegendary(bin, ['uninstall', appName, '-y'], { ms: 300000 });
  log('Epic: uninstall', appName, r.code); return { ok: r.code === 0 };
}
// how to start an installed Epic game: legendary hands over its program and Epic's sign-in arguments (online, or offline
// when Epic can't be reached and the game allows it); { exe, args, cwd, env, offline }
async function epicLaunchInfo(bin, appName) {
  let outdated = false;
  const ask = async (off, skip) => { const r = await runLegendary(bin, ['launch', appName, '--json', ...(off ? ['--offline'] : []), ...(skip ? ['--skip-version-check'] : [])], { ms: 45000 });
    if (r.code !== 0) { if (/out of date/i.test(r.err)) outdated = true; return null; } try { return JSON.parse(r.out); } catch { return null; } };
  let off = !epicAccount(), j = await ask(off, false);
  // an update is waiting: play this version anyway, still signed in (Settings → PC games → Epic library updates it)
  if (!j && !off && outdated) { j = await ask(false, true); if (j) log('Epic: an update is available, starting this version', appName); }
  if (!j && !off) { off = true; j = await ask(true, false); if (j) log('Epic: offline launch (Epic not reachable)', appName); }
  if (!j || !j.game_executable || !j.game_directory) throw new Error(epicAccount() ? "Couldn't get the game ready with Epic. Check the internet connection, or that the game is still installed." : 'Sign in to Epic Games in Settings → PC games first.');
  const strs = a => (Array.isArray(a) ? a : []).map(String).filter(Boolean).slice(0, 200);
  const env = {}; if (j.environment && typeof j.environment === 'object') for (const [k, v] of Object.entries(j.environment)) if (/^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(k)) env[k] = String(v);
  return { exe: path.join(String(j.game_directory), String(j.game_executable)), args: [...strs(j.game_parameters), ...strs(j.egl_parameters), ...strs(j.user_parameters)], cwd: String(j.working_directory || j.game_directory), env, offline: off, outdated };
}

module.exports = { init, runners, pickRunner, runnerFromHeroic, windowsCommand, endPrefix, isWindowsProgram, prefixFor, prefixRoot, umuRun, umuId,
  heroicDir, heroicGame, legendaryBin, legendaryConfig, epicAccount, epicGames, epicSignIn, epicSignOut, epicLibrary, epicInstall, epicCancel, epicUninstall, epicJob, epicInstallDir, epicLaunchInfo };
