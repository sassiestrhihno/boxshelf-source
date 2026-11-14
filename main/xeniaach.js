'use strict';
// (beta.14) Xbox 360 achievements from Xenia Canary. Xenia keeps each game's achievements for the signed-in profile in a
// file named after the game's title id (<content>\<XUID>\FFFE07D1\00010000\<XUID>\<TITLEID>.gpd, an "XDBF" database):
// every achievement's name, both descriptions, gamerscore and, once earned, when. Boxshelf only reads it. The achievement
// pictures aren't in it (they live inside the game), so the list draws its own badges; the game's icon is.
// Also: whether a profile is signed in (achievements are only recorded for one) and whether Xenia's own pop-up is on, and
// a switch for that pop-up (one setting in xenia-canary.config.toml, a copy of the file kept the first time).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const exists = p => fsp.access(p).then(() => true, () => false);
const readText = p => fsp.readFile(p, 'utf8').then(t => t.replace(/^﻿/, ''), () => null);
const CONFIGS = ['xenia-canary.config.toml', 'xenia.config.toml'];

// where this Xenia keeps its settings and content: beside the program when portable.txt is there, else Documents\Xenia
async function places(exe, env = process.env) {
  const dir = path.dirname(String(exe || '')), home = env.USERPROFILE || os.homedir();
  const docs = [path.join(home, 'Documents', 'Xenia'), path.join(home, 'OneDrive', 'Documents', 'Xenia')];
  const roots = (await exists(path.join(dir, 'portable.txt'))) ? [dir] : docs;
  let config = null, text = '';
  for (const r of roots) for (const n of CONFIGS) { const f = path.join(r, n); const t = await readText(f); if (t != null) { config = f; text = t; break; } } // (the first one found)
  const root = config ? path.dirname(config) : roots[0];
  const val = k => { const m = new RegExp('^\\s*' + k + '\\s*=\\s*("([^"]*)"|[^\\s#]+)', 'm').exec(text); return m ? (m[2] !== undefined ? m[2] : m[1]) : ''; };
  const contentRoot = val('content_root');
  return { config, text, root, content: contentRoot ? path.resolve(root, contentRoot) : path.join(root, 'content'), xuid: (val('logged_profile_slot_0_xuid') || '').trim(), popupsRaw: val('show_achievement_notification') };
}
const gpdDir = (p) => path.join(p.content, p.xuid, 'FFFE07D1', '00010000', p.xuid);

// for Settings → RetroAchievements → Your emulators: { state, user, popups, detail }
async function status(exe, env = process.env) {
  const p = await places(exe, env);
  if (!p.config) return { state: 'unknown', user: '', detail: 'Xenia settings not found (run Xenia once)' };
  if (!/^[0-9A-F]{16}$/i.test(p.xuid)) return { state: 'signed-out', user: '', detail: 'No Xenia profile signed in' };
  return { state: 'ok', user: '', popups: p.popupsRaw === '' ? false : /^true$/i.test(p.popupsRaw), detail: '' };
}

// one XDBF database → { achievements: [...], title, icon (PNG Buffer) }
function readGpd(b) {
  if (!b || b.length < 24 || b.toString('latin1', 0, 4) !== 'XDBF') return null;
  const entLen = b.readUInt32BE(8), entCnt = b.readUInt32BE(12), freeLen = b.readUInt32BE(16), base = 24 + entLen * 18 + freeLen * 8;
  if (entCnt > entLen || base > b.length) return null;
  const out = { achievements: [], title: '', icon: null };
  const str = (p, end) => { let s = ''; while (p + 1 < end) { const c = b.readUInt16BE(p); p += 2; if (!c) break; s += String.fromCharCode(c); } return [s, p]; };
  for (let i = 0; i < entCnt; i++) {
    const o = 24 + i * 18, ns = b.readUInt16BE(o), id = b.readBigUInt64BE(o + 2), d = base + b.readUInt32BE(o + 10), len = b.readUInt32BE(o + 14), end = Math.min(b.length, d + len);
    if (d < base || d >= b.length || len <= 0) continue;
    if (ns === 1 && len >= 28) { // an achievement
      const size = b.readUInt32BE(d), flags = b.readUInt32BE(d + 16), t = b.readBigUInt64BE(d + 20);
      let p = d + Math.max(28, size), name, got, locked; [name, p] = str(p, end); [got, p] = str(p, end); [locked, p] = str(p, end);
      const earned = !!(flags & 0x20000), ms = t ? Number(t / 10000n) - 11644473600000 : 0; // (Windows file time → ms)
      out.achievements.push({ id: b.readUInt32BE(d + 4), title: name.trim(), desc: (earned ? got : locked || got).trim(), points: b.readInt32BE(d + 12), earned, date: earned && ms > 0 ? new Date(ms).toISOString() : null });
    } else if (ns === 5 && id === 0x8000n) out.title = str(d, end)[0].trim(); // the game's name
    else if (ns === 2 && id === 0x8000n && b.toString('latin1', d + 1, d + 4) === 'PNG') out.icon = b.subarray(d, end); // the game's icon
  }
  out.achievements.sort((a, c) => a.id - c.id);
  return out;
}

// one game's progress, in the same shape as main/ra.js progress() so Details and the achievements screen show it as they
// do RetroAchievements; null when Xenia has nothing for it yet (it writes the file the first time the game runs)
async function progress(exe, titleId, env = process.env) {
  if (!/^[0-9A-F]{8}$/i.test(String(titleId || ''))) return null;
  const p = await places(exe, env); if (!/^[0-9A-F]{16}$/i.test(p.xuid)) return null;
  let b; try { b = await fsp.readFile(path.join(gpdDir(p), titleId.toUpperCase() + '.gpd')); } catch { return null; }
  const g = readGpd(b); if (!g || !g.achievements.length) return null;
  const A = g.achievements.map(a => ({ id: a.id, title: a.title, desc: a.desc, points: a.points, type: '', badge: '', earned: a.earned, hardcore: false, date: a.date, rarity: null }));
  const earned = A.filter(a => a.earned), points = A.reduce((s, a) => s + a.points, 0), pointsEarned = earned.reduce((s, a) => s + a.points, 0);
  return { id: titleId.toUpperCase(), title: g.title, console: 'Xbox 360', source: 'xenia', unit: 'G', icon: g.icon ? 'data:image/png;base64,' + g.icon.toString('base64') : null, box: null,
    total: A.length, earned: earned.length, points, pointsEarned, completion: null, completionHardcore: null, mastered: A.length && earned.length === A.length ? 'completed' : null, achievements: A, url: null };
}

// Xenia's own pop-up on (or off): that one line in its settings, the rest of the file untouched; Xenia must be closed
// (it writes its settings back when it quits)
async function setPopups(exe, on, env = process.env) {
  const p = await places(exe, env); if (!p.config) throw new Error('Xenia\'s settings file wasn\'t found. Open Xenia once first.');
  const want = on ? 'true' : 'false', re = /^(\s*show_achievement_notification\s*=\s*)(true|false)/m;
  let t = p.text;
  if (re.test(t)) t = t.replace(re, (m, a) => a + want);
  else if (/^\[UI\]\s*$/m.test(t)) t = t.replace(/^\[UI\]\s*$/m, m => m + (t.includes('\r\n') ? '\r\n' : '\n') + 'show_achievement_notification = ' + want);
  else t += (t.endsWith('\n') ? '' : '\n') + '\n[UI]\nshow_achievement_notification = ' + want + '\n';
  if (t === p.text) return { ok: true, changed: false };
  const bak = p.config + '.boxshelf-bak'; if (!(await exists(bak))) await fsp.copyFile(p.config, bak);
  const tmp = p.config + '.tmp'; await fsp.writeFile(tmp, t); await fsp.rename(tmp, p.config);
  return { ok: true, changed: true };
}

module.exports = { status, progress, setPopups, readGpd, places };
