// Reads installed Steam games, playtime and cover art straight from the Steam folder.
const fs = require('fs');
const path = require('path');
const vdf = require('./vdf');
const { isDir, isFile, readDir } = require('./paths');

// Steam installs helpers alongside games (Proton, runtimes, redistributables, SteamVR…): they're not for the shelf.
// cfg.steam.hideTools (default on) hides them; soundtracks, dedicated servers, SDKs and benchmarks are never games.
const NEVER_GAMES = /soundtrack|dedicated server|\bsdk\b|benchmark/i;
const TOOL_NAMES = /redistributable|steamworks common|^proton\b|proton (experimental|hotfix|easyanticheat|battleye)|steam linux runtime|^steamvr\b|steam audio|directx|visual c\+\+|vc\+\+ ?redist|vcredist|\.net framework|physx|steam controller config|steamworks shared|openvr|compatibility tool/i;
const TOOL_IDS = new Set([ // the well-known ones; anything else is caught by its name
  '228980', // Steamworks Common Redistributables
  '1070560', '1391110', '1628350', // Steam Linux Runtime (scout / soldier / sniper)
  '858280', '961940', '1054830', '1113280', '1245040', '1420170', '1580130', '1887720', '2348590', '2805730', '1493710', '2180100', '2230260', // Proton 3.7 … 9.0, Experimental, Hotfix, Next
  '1161040', '1826330', // Proton BattlEye / EasyAntiCheat runtimes
  '250820', '323910', // SteamVR, SteamVR Performance Test
  '241100' // Steam Controller Configs
]);
function isTool(appid, name) { return TOOL_IDS.has(String(appid)) || TOOL_NAMES.test(String(name || '')); }

function readVdf(file) {
  try { return vdf.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } // (beta.10: a byte-order mark made the first key unreadable)
}
// (beta.10) the folder the user gave: Steam's own folder, or by mistake its steamapps folder or another library
// ("D:\SteamLibrary"): all of them lead to the games. Returns the folder that holds steamapps, or null
function steamRoot(p) {
  if (!p) return null;
  let s = String(p).trim().replace(/^"(.*)"$/, '$1').replace(/[\\/]+$/, '');
  if (/\.(exe|sh)$/i.test(s) || /[\\/]steam$/i.test(s) && !isDir(s)) s = path.dirname(s); // (beta.10: steam.exe itself picked, or pasted with quotes)
  if (/^steamapps$/i.test(path.basename(s)) && isDir(s)) return path.dirname(s);
  if (isDir(path.join(s, 'steamapps'))) return s;
  return null;
}
// installed: Steam's "fully installed" flag, or a game whose update is waiting / paused / running (flags like 6, 1026,
// 1542 drop the 4 while an update is queued): it's on disk and still plays
function installedState(st, lib) {
  const flags = +(vdf.get(st, 'StateFlags') || 0);
  if (flags & 4) return true;
  if (flags & 1) return false; // uninstalled
  const dir = vdf.get(st, 'installdir');
  return +(vdf.get(st, 'SizeOnDisk') || 0) > 0 && !!dir && isDir(path.join(lib, 'steamapps', 'common', String(dir)));
}

// the same folder spelled differently ("C:\Steam\" vs "c:\steam") is one library: keyed by its normalised path
const fold = s => process.platform === 'win32' ? s.toLowerCase() : s; // (beta.12: Linux folders differ by case)
const libKey = p => fold(path.resolve(p).replace(/[\\/]+$/, ''));
// every library Steam lists, without touching their drives (reading libraryfolders.vdf only touches Steam's own folder)
function libraryPaths(steamPath) {
  const out = new Map(), add = p => { const k = libKey(p); if (!out.has(k)) out.set(k, p); };
  add(steamPath);
  const lf = readVdf(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'));
  const root = lf && (vdf.get(lf, 'libraryfolders') || vdf.get(lf, 'LibraryFolders'));
  if (root) for (const v of Object.values(root)) { const p = typeof v === 'string' ? v : vdf.get(v, 'path'); if (p) add(String(p).replace(/\\\\/g, '\\')); }
  return [...out.values()];
}
// (beta.14) a library on a drive that doesn't answer (asleep, unplugged, a network share that's gone) froze the whole app while
// Boxshelf read it, because those reads wait in the main process (issue #34). probeLibraries() asks each drive without waiting
// on it; one that hasn't answered within a few seconds is left out (and remembered for 5 minutes, so it doesn't cost the wait
// again on every shelf refresh); libraryFolders() then never touches it.
const DEAD = new Map(), DEAD_FOR = 5 * 60e3;
const isDead = p => { const t = DEAD.get(libKey(p)); return !!t && Date.now() - t < DEAD_FOR; };
// 'dir' | 'file' | 'none' (not there) | 'timeout' (the drive didn't answer)
function answers(p, ms) {
  return new Promise(res => { let done = false; const end = v => { if (!done) { done = true; clearTimeout(t); res(v); } }; const t = setTimeout(() => end('timeout'), ms);
    fs.promises.stat(p).then(st => end(st.isDirectory() ? 'dir' : 'file'), () => end('none')); });
}
const driveOf = p => ((/^[a-z]:/i.exec(path.resolve(p)) || ['?'])[0]).toUpperCase();
async function probeLibraries(steamPath, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {}, ms = opts.timeout || 6000;
  const paths = libraryPaths(steamPath).filter(p => !isDead(p));
  const ok = await Promise.all(paths.map(async p => {
    const a = await answers(p, ms);
    if (a === 'timeout') { DEAD.set(libKey(p), Date.now()); log(`Steam: a library on drive ${driveOf(p)} didn't answer in ${Math.round(ms / 1000)} s: left out for now (asleep or unplugged?)`); }
    return a === 'dir';
  }));
  return paths.filter((p, i) => ok[i]);
}
function libraryFolders(steamPath) {
  return libraryPaths(steamPath).filter(p => !isDead(p) && isDir(p));
}

// Playtime + last played from the most recently used Steam account.
function userStats(steamPath) {
  const ud = path.join(steamPath, 'userdata');
  let best = null, bestTime = 0;
  for (const ent of readDir(ud)) {
    if (!ent.isDirectory()) continue;
    const f = path.join(ud, ent.name, 'config', 'localconfig.vdf');
    try { const t = fs.statSync(f).mtimeMs; if (t > bestTime) { bestTime = t; best = f; } } catch {}
  }
  if (!best) return {};
  const data = readVdf(best);
  const apps = data && vdf.get(data, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps');
  const stats = {};
  if (apps) for (const [id, a] of Object.entries(apps)) {
    stats[id] = { minutes: +(vdf.get(a, 'Playtime') || 0), lastPlayed: +(vdf.get(a, 'LastPlayed') || 0) };
  }
  return stats;
}

// Steam stores covers as librarycache\<id>_library_600x900.jpg (older)
// or librarycache\<id>\...\library_600x900.jpg (newer).
function findArt(steamPath, appid) {
  const cache = path.join(steamPath, 'appcache', 'librarycache');
  const pick = (names) => {
    for (const n of names) { const f = path.join(cache, n); if (isFile(f)) return f; }
    const dir = path.join(cache, appid);
    const stack = [[dir, 0]];
    while (stack.length) {
      const [d, depth] = stack.pop();
      for (const ent of readDir(d)) {
        const full = path.join(d, ent.name);
        if (ent.isFile() && names.some(x => ent.name.toLowerCase() === x.replace(appid + '_', '').toLowerCase())) return full;
        if (ent.isDirectory() && depth < 2) stack.push([full, depth + 1]);
      }
    }
    return null;
  };
  return {
    front: pick([`${appid}_library_600x900_2x.jpg`, `${appid}_library_600x900.jpg`]),
    hero: pick([`${appid}_library_hero.jpg`])
  };
}

// Steam's own folder (the one with the list of every library, playtimes and its cover cache), not just a library on
// another drive: it has userdata or appcache beside steamapps
const isMainSteam = p => !!p && (isDir(path.join(p, 'userdata')) || isDir(path.join(p, 'appcache')));
function scanSteam(givenPath, opts = {}) {
  const hideTools = opts.hideTools !== false, log = typeof opts.log === 'function' ? opts.log : () => {};
  const given = steamRoot(givenPath);
  if (!given) { log('Steam: no steamapps folder in the Steam folder set in Settings'); return []; }
  // (beta.10) a library on another drive set as "the Steam folder" (D:\SteamLibrary): Steam's own folder (opts.mainPath,
  // found by main.js) still lists every library on every drive, so games on the other drives, playtimes and covers show too
  const main = steamRoot(opts.mainPath), steamPath = isMainSteam(given) || !main ? given : main;
  const stats = userStats(steamPath);
  const games = [], seen = new Set(); let manifests = 0, notInstalled = 0, tools = 0;
  const libs = Array.isArray(opts.libs) ? opts.libs.slice() : libraryFolders(steamPath); if (steamPath !== given && !libs.some(l => process.platform === 'win32' ? path.resolve(l).toLowerCase() === path.resolve(given).toLowerCase() : path.resolve(l) === path.resolve(given))) libs.push(given);
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    for (const ent of readDir(apps)) {
      if (!/^appmanifest_\d+\.acf$/i.test(ent.name)) continue;
      const m = readVdf(path.join(apps, ent.name));
      const st = m && vdf.get(m, 'AppState');
      if (!st) continue; manifests++;
      const appid = String(vdf.get(st, 'appid') || '');
      const name = vdf.get(st, 'name') || '';
      if (!appid || NEVER_GAMES.test(name) || (hideTools && isTool(appid, name))) { tools++; continue; }
      if (!installedState(st, lib)) { notInstalled++; continue; } // (beta.10: a game with an update waiting counts as installed)
      if (seen.has(appid)) continue; seen.add(appid);
      const s = stats[appid] || {};
      games.push({
        kind: 'steam',
        id: 'steam-' + appid,
        appid,
        title: name,
        sizeBytes: +(vdf.get(st, 'SizeOnDisk') || 0),
        minutes: s.minutes || 0,
        lastPlayed: s.lastPlayed || +(vdf.get(st, 'LastPlayed') || 0),
        art: findArt(steamPath, appid)
      });
    }
  }
  games.sort((a, b) => a.title.localeCompare(b.title));
  // (beta.10) what was found, so a problem report says why the PC shelf is empty (counts only, no paths)
  const key = [libs.length, manifests, games.length, notInstalled, tools].join('/'); if (key !== lastLogKey) { lastLogKey = key; log(`Steam: ${libs.length} ${libs.length === 1 ? 'library' : 'libraries'}, ${manifests} installed items, ${games.length} games (${tools} tools / soundtracks left out, ${notInstalled} not installed)`); }
  return games;
}
let lastLogKey = '';
// (beta.14) scanSteam with every library's drive asked first (see probeLibraries): the folder set in Settings and Steam's own
// folder are asked too, so a Steam folder on a drive that's gone can't hold the app up either
async function scanSteamSafe(givenPath, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {}, ms = opts.timeout || 6000;
  const g = String(givenPath || '').trim().replace(/^"(.*)"$/, '$1'); if (!g) return [];
  const probe = /\.(exe|sh)$/i.test(g) ? path.dirname(g) : g.replace(/[\\/]+$/, '') || g;
  if (isDead(probe)) return [];
  const a = await answers(probe, ms);
  if (a === 'timeout') { DEAD.set(libKey(probe), Date.now()); log(`Steam: the Steam folder (drive ${driveOf(probe)}) didn't answer in ${Math.round(ms / 1000)} s: the PC shelf leaves Steam out for now`); return []; }
  const given = steamRoot(g); if (!given) return scanSteam(givenPath, opts);
  let mainPath = opts.mainPath || ''; if (mainPath && (isDead(mainPath) || (await answers(mainPath, ms)) !== 'dir')) mainPath = '';
  const main = steamRoot(mainPath), steamPath = isMainSteam(given) || !main ? given : main;
  return scanSteam(givenPath, { ...opts, mainPath, libs: await probeLibraries(steamPath, opts) });
}

// false when the Steam folder set in Settings is on a drive that didn't answer (now, or within the last 5 minutes)
async function steamAnswers(p, log, ms = 6000) {
  const g = String(p || '').trim().replace(/^"(.*)"$/, '$1'); if (!g) return true;
  const probe = /\.(exe|sh)$/i.test(g) ? path.dirname(g) : g.replace(/[\\/]+$/, '') || g;
  if (isDead(probe)) return false;
  if ((await answers(probe, ms)) !== 'timeout') return true;
  DEAD.set(libKey(probe), Date.now()); if (typeof log === 'function') log(`Steam: the Steam folder (drive ${driveOf(probe)}) didn't answer in ${Math.round(ms / 1000)} s: the PC shelf leaves Steam out for now`);
  return false;
}

module.exports = { scanSteam, scanSteamSafe, steamAnswers, probeLibraries, isTool, steamRoot, isMainSteam, libraryFolders, _t: { DEAD, answers } }; // (beta.12: libraryFolders for main/gamewatch.js)
