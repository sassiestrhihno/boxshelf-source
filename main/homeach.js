// (beta.14) The Home menu's Achievements item: the running game's achievements / trophies, read-only, from the same
// places Details' Achievements tab uses: RetroAchievements (main/ra.js), Xbox 360 through Xenia's own files
// (main/xeniaach.js), PS3 through RPCS3's (main/rpcs3troph.js). Nothing here runs while the game simply plays: whether
// the game has any is worked out the first time the menu opens over it (from files on this PC and RetroAchievements'
// game list as last downloaded), and the list is read when the item is chosen. RetroAchievements is asked at most once
// every couple of minutes (an answer from before the game started is never shown: it can't have this session's unlocks).
'use strict';
let d = {};
// deps: { ra, xeniaach, rpcs3troph, xeniaExe(), rpcs3Exe(), fileUrl(p), trophyCache, game(systemId, file) → library game }
function init(deps) { d = deps || {}; }

const SRC = { ra: 'RetroAchievements', x360: 'Xenia', ps3: 'RPCS3' };
const RA_MAX_MS = 2 * 60e3, LOCAL_MS = 15e3;

// the running game as the library knows it: its title, Xbox 360 title id and file
function gameOf(meta) {
  meta = meta || {}; let g = null;
  try { if (d.game && meta.file) g = d.game(meta.systemId, meta.file); } catch {}
  return { systemId: meta.systemId, title: String((g && g.title) || meta.title || ''), titleId: g && g.titleId ? String(g.titleId) : '', file: String((g && g.file) || meta.file || '') };
}
function kindOf(meta) {
  const s = meta && meta.systemId;
  if (s === 'x360') return d.xeniaach && d.xeniaExe && d.xeniaExe() ? 'x360' : null;
  if (s === 'ps3') return d.rpcs3troph && d.rpcs3Exe && d.rpcs3Exe() ? 'ps3' : null;
  return d.ra && d.ra.enabled && d.ra.enabled() && d.ra.CONSOLE_ID && d.ra.CONSOLE_ID[s] ? 'ra' : null;
}
async function local(kind, g) {
  if (kind === 'x360') return /^[0-9A-F]{8}$/i.test(g.titleId) ? d.xeniaach.progress(d.xeniaExe(), g.titleId) : null;
  return d.rpcs3troph.progress(d.rpcs3Exe(), { title: g.title, file: g.file }, d.fileUrl || (f => f), d.trophyCache || null);
}

// { on, label, src } for the menu; s: the game's session (kept there: asked once per game)
async function available(meta, s) {
  const kind = kindOf(meta); if (!kind) return { on: false };
  const g = gameOf(meta); if (!g.title && !g.titleId) return { on: false };
  const out = { on: false, label: kind === 'ps3' ? 'Trophies' : 'Achievements', src: SRC[kind] };
  if (kind === 'ra') out.on = !!(await d.ra.hasSet(g.systemId, g.title));
  else { const p = await local(kind, g); out.on = !!(p && p.total > 0); if (s && p) s.achLocal = { at: Date.now(), p }; }
  return out;
}

// the list, trimmed to what the menu shows. null: nothing for this game (yet)
async function list(meta, force, s) {
  const kind = kindOf(meta); if (!kind) return null;
  const g = gameOf(meta); let p;
  if (kind === 'ra') {
    const since = s && s.startedAt ? Date.now() - s.startedAt : RA_MAX_MS;
    p = await d.ra.progress(g.systemId, g.title, !!force, Math.max(1, Math.min(RA_MAX_MS, since)));
  } else if (!force && s && s.achLocal && Date.now() - s.achLocal.at < LOCAL_MS) p = s.achLocal.p;
  else { p = await local(kind, g); if (s) s.achLocal = p ? { at: Date.now(), p } : null; }
  if (!p) return null;
  const str = (v, n) => String(v == null ? '' : v).slice(0, n);
  return { src: SRC[kind], unit: p.unit || 'points', title: str(p.title, 300), total: +p.total || 0, earned: +p.earned || 0, points: +p.points || 0, pointsEarned: +p.pointsEarned || 0,
    grades: p.grades ? str(p.grades, 200) : '', mastered: p.mastered || null,
    achievements: (Array.isArray(p.achievements) ? p.achievements : []).slice(0, 2000).map(a => ({ id: a.id, title: str(a.title, 300), desc: str(a.desc, 600), points: +a.points || 0,
      type: str(a.type, 40), grade: str(a.grade, 40), badge: /^(https:|bsfile:)/.test(String(a.badge || '')) ? String(a.badge) : '', earned: !!a.earned, hardcore: !!a.hardcore, date: a.date ? str(a.date, 40) : null, rarity: Number.isFinite(a.rarity) ? a.rarity : null })) };
}

module.exports = { init, available, list, gameOf, kindOf };
