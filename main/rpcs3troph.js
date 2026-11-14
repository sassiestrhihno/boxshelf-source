'use strict';
// (beta.14) PS3 trophies from RPCS3. RPCS3 keeps each game's trophies, as a real PS3 does, in
// dev_hdd0\home\<user>\trophy\<NP communication id>\ beside the program: TROP.SFM (the list: names, details, grades;
// TROP_xx.SFM in other languages), TROPUSR.DAT (which ones are earned, and when) and TROPnnn.PNG (each trophy's picture).
// A game finds its folder by its own TROPDIR (<game>\PS3_GAME\TROPDIR\<id>\, or <title id>\TROPDIR\ for a digital one);
// an .iso, whose files can't be read, by the game's name. Boxshelf only reads. Also: RPCS3's own trophy pop-up
// (config\config.yml → Miscellaneous → "Show trophy popups", on unless switched off) and a switch for it.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const exists = p => fsp.access(p).then(() => true, () => false);
const readText = p => fsp.readFile(p, 'utf8').then(t => t.replace(/^﻿/, ''), () => null);
const GRADE = { P: ['platinum', 'Platinum', 180], G: ['gold', 'Gold', 90], S: ['silver', 'Silver', 30], B: ['bronze', 'Bronze', 15] }; // (PSN's points per grade)
const unxml = s => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').trim();
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// RPCS3's own folders: the trophy root(s) (one per user, the default user first) and its GUI settings file
function rpcs3Dirs(exe) {
  const dir = path.dirname(String(exe || ''));
  return { home: path.join(dir, 'dev_hdd0', 'home'), configs: [path.join(dir, 'config', 'config.yml'), path.join(dir, 'config.yml')] };
}
async function configFile(exe) { for (const f of rpcs3Dirs(exe).configs) { const t = await readText(f); if (t != null) return { f, t }; } return null; }
const POP = /^(\s*Show trophy popups:\s*)(true|false)\s*$/m;
async function trophyRoots(exe) {
  const { home } = rpcs3Dirs(exe); let users = [];
  try { users = (await fsp.readdir(home, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{8}$/.test(d.name)).map(d => d.name).sort((a, b) => (a === '00000001' ? -1 : b === '00000001' ? 1 : a.localeCompare(b))); } catch {}
  return users.map(u => path.join(home, u, 'trophy'));
}

// TROP.SFM → { title, trophies: [{ id, name, detail, grade, hidden }] }
function readSfm(t) {
  if (!t) return null;
  const title = unxml((/<title-name>([\s\S]*?)<\/title-name>/.exec(t) || [])[1]), list = [];
  for (const m of t.matchAll(/<trophy\s+([^>]*)>([\s\S]*?)<\/trophy>/g)) {
    const a = m[1], id = +((/\bid="(\d+)"/.exec(a) || [])[1]), g = ((/\bttype="([PGSB])"/.exec(a) || [])[1]) || 'B';
    if (!Number.isFinite(id)) continue;
    list.push({ id, name: unxml((/<name>([\s\S]*?)<\/name>/.exec(m[2]) || [])[1]), detail: unxml((/<detail>([\s\S]*?)<\/detail>/.exec(m[2]) || [])[1]), grade: g, hidden: /\bhidden="yes"/.test(a) });
  }
  return { title, trophies: list.sort((x, y) => x.id - y.id) };
}
// TROPUSR.DAT → Map(trophy id → unlock time in ms, or 0 when the time isn't known)
function readUsr(b) {
  const out = new Map();
  if (!b || b.length < 48 || b.readUInt32BE(0) !== 0x818F54AD) return out;
  const tables = Math.min(16, b.readUInt32BE(8));
  for (let i = 0; i < tables; i++) {
    const h = 48 + i * 32; if (h + 32 > b.length) break;
    if (b.readUInt32BE(h) !== 6) continue; // (table 6: each trophy's state and time)
    const count = b.readUInt32BE(h + 12); let p = Number(b.readBigUInt64BE(h + 16));
    for (let k = 0; k < count && p + 0x30 <= b.length; k++) {
      const size = b.readUInt32BE(p + 4), id = b.readUInt32BE(p + 16), state = b.readUInt32BE(p + 20), t = b.readBigUInt64BE(p + 32);
      if (state === 1) { const ms = t ? Number(t / 1000n) - 62135596800000 : 0; out.set(id, ms > 0 && ms < Date.now() + 864e5 ? ms : 0); } // (microseconds since year 1)
      p += 16 + (size || 0x60);
    }
  }
  return out;
}

// each trophy set's game name (normalised) → its folder, read once and kept until the trophy folder changes: matching a
// game by its name doesn't read every set's list on every Details visit
const titleMemo = new Map(); // root → { key, map }
async function titlesOf(root, dirs) {
  let m = 0; try { m = (await fsp.stat(root)).mtimeMs; } catch {}
  const key = m + '|' + dirs.length, c = titleMemo.get(root); if (c && c.key === key) return c.map;
  const map = new Map();
  for (const n of dirs) { const t = await readText(path.join(root, n, 'TROP.SFM')); const s = t && /<title-name>([\s\S]*?)<\/title-name>/.exec(t); if (s) { const k = norm(unxml(s[1])); if (k && !map.has(k)) map.set(k, n); } }
  titleMemo.set(root, { key, map }); return map;
}
// the game's own NP communication ids, from its TROPDIR (EBOOT.BIN → USRDIR → PS3_GAME or the title id's folder)
async function ownIds(file) {
  const f = String(file || ''); if (!/eboot\.bin$/i.test(f)) return [];
  const d = path.join(path.dirname(path.dirname(f)), 'TROPDIR');
  try { return (await fsp.readdir(d, { withFileTypes: true })).filter(x => x.isDirectory() && /^NP[A-Z]{2}\d{5}_\d{2}$/i.test(x.name)).map(x => x.name.toUpperCase()); } catch { return []; }
}

// a trophy folder (RPCS3's, or one unpacked from the game's own pack) → the shape main/ra.js progress() has, so Details
// and the list show it like the rest. usr: what's earned (none for a game not played yet)
async function fromDir(dir, id, usr, fileUrl) {
  const sfm = readSfm(await readText(path.join(dir, 'TROP.SFM')) || await readText(path.join(dir, 'TROPCONF.SFM')));
  if (!sfm || !sfm.trophies.length) return null;
  const A = await Promise.all(sfm.trophies.map(async t => { const gr = GRADE[t.grade] || GRADE.B, got = usr.has(t.id), icon = path.join(dir, `TROP${String(t.id).padStart(3, '0')}.PNG`);
    return { id: t.id, title: t.hidden && !got ? 'Hidden trophy' : t.name, desc: t.hidden && !got ? 'Keep playing to find out' : t.detail, points: gr[2], type: gr[0], grade: gr[1],
      badge: (await exists(icon)) ? fileUrl(icon) : '', earned: got, hardcore: false, date: got && usr.get(t.id) ? new Date(usr.get(t.id)).toISOString() : null, rarity: null }; }));
  const earned = A.filter(a => a.earned), icon = path.join(dir, 'ICON0.PNG'), plat = A.find(a => a.type === 'platinum');
  const count = g => `${earned.filter(a => a.type === g).length}/${A.filter(a => a.type === g).length}`;
  return { id: String(id).toUpperCase(), title: sfm.title, console: 'PS3', source: 'rpcs3', unit: 'trophy', icon: (await exists(icon)) ? fileUrl(icon) : null, box: null,
    total: A.length, earned: earned.length, points: A.reduce((s, a) => s + a.points, 0), pointsEarned: earned.reduce((s, a) => s + a.points, 0),
    grades: `${plat ? (plat.earned ? 'Platinum ✓ · ' : 'Platinum · ') : ''}Gold ${count('gold')} · Silver ${count('silver')} · Bronze ${count('bronze')}`,
    completion: null, completionHardcore: null, mastered: plat && plat.earned ? 'platinum' : A.length && earned.length === A.length ? 'completed' : null, achievements: A, url: null };
}

// (beta.14) the game's own trophy pack (TROPDIR\<id>\TROPHY.TRP: a plain archive, magic DCA24D00): its list and pictures are
// unpacked once into cacheDir\<id>\, so a game shows every trophy (all still locked) before it's ever been played
async function unpackTrp(trp, out) {
  if (await exists(path.join(out, 'TROP.SFM')) || await exists(path.join(out, 'TROPCONF.SFM'))) return true;
  let b; try { b = await fsp.readFile(trp); } catch { return false; }
  if (b.length < 64 || b.readUInt32BE(0) !== 0xDCA24D00) return false;
  const n = Math.min(512, b.readUInt32BE(16)), es = b.readUInt32BE(20) || 64; let wrote = 0;
  await fsp.mkdir(out, { recursive: true });
  for (let i = 0; i < n; i++) {
    const e = 64 + i * es; if (e + 64 > b.length) break;
    const name = b.toString('latin1', e, e + 32).replace(/\0.*$/s, ''), off = Number(b.readBigUInt64BE(e + 32)), size = Number(b.readBigUInt64BE(e + 40));
    if (!/^[A-Z0-9_]{1,24}\.(SFM|PNG)$/i.test(name) || off + size > b.length || size > 8 * 1048576) continue; // (only the list and pictures; no paths)
    await fsp.writeFile(path.join(out, name.toUpperCase()), b.subarray(off, off + size)); wrote++;
  }
  return wrote > 0;
}

// one game's trophies: RPCS3's own folder once the game has run (what's earned, and when), else the game's own pack (all
// locked), else null. fileUrl: path → bsfile address; cacheDir: where unpacked packs are kept
async function progress(exe, game, fileUrl = f => f, cacheDir = null) {
  const roots = await trophyRoots(exe), ids = await ownIds(game && game.file), want = norm(game && game.title);
  for (const root of roots) {
    let dirs = []; try { dirs = (await fsp.readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { continue; }
    let pick = dirs.find(n => ids.includes(n.toUpperCase()));
    if (!pick && want) pick = (await titlesOf(root, dirs)).get(want) || null; // (an .iso: by its name)
    if (!pick) continue;
    let usr = new Map(); try { usr = readUsr(await fsp.readFile(path.join(root, pick, 'TROPUSR.DAT'))); } catch {}
    const r = await fromDir(path.join(root, pick), pick, usr, fileUrl); if (r) return r;
  }
  if (cacheDir) for (const id of ids) { // (not played yet: the game's own pack)
    const trp = path.join(path.dirname(path.dirname(String(game.file))), 'TROPDIR', id, 'TROPHY.TRP'), out = path.join(cacheDir, id);
    if (await unpackTrp(trp, out)) { const r = await fromDir(out, id, new Map(), fileUrl); if (r) return r; }
  }
  return null;
}

// for Settings → Your emulators: RPCS3 needs no sign-in (trophies are kept on this PC); is its own pop-up on?
async function status(exe) {
  const c = await configFile(exe), m = c && POP.exec(c.t);
  return { state: 'ok', user: '', popups: m ? m[2] === 'true' : true, detail: c ? '' : 'Open RPCS3 once to make its settings' };
}
// RPCS3's pop-up on: that one line in config.yml, the rest untouched; RPCS3 must be closed (it writes its settings on quit)
async function setPopups(exe, on) {
  const c = await configFile(exe); if (!c) throw new Error('RPCS3\'s settings file wasn\'t found. Open RPCS3 once first.');
  const want = on ? 'true' : 'false', nl = c.t.includes('\r\n') ? '\r\n' : '\n'; let t = c.t;
  if (POP.test(t)) t = t.replace(POP, (m, a) => a + want);
  else if (/^Miscellaneous:\s*$/m.test(t)) t = t.replace(/^Miscellaneous:\s*$/m, m => m + nl + '  Show trophy popups: ' + want);
  else t += (t.endsWith('\n') ? '' : nl) + 'Miscellaneous:' + nl + '  Show trophy popups: ' + want + nl;
  if (t === c.t) return { ok: true, changed: false };
  const bak = c.f + '.boxshelf-bak'; if (!(await exists(bak))) await fsp.copyFile(c.f, bak);
  const tmp = c.f + '.tmp'; await fsp.writeFile(tmp, t); await fsp.rename(tmp, c.f);
  return { ok: true, changed: true };
}

module.exports = { progress, status, setPopups, readSfm, readUsr, unpackTrp };
