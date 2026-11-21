// Read-only importer for Steam collections (userdata/*/config/cloudstorage/cloud-storage-namespace-1.json)
// and Playnite categories (categories.db + games.db). Never modifies Steam or Playnite files.
const fs = require('fs');
const path = require('path');

const normTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'cat';

function buildAppIndex(pcGames) {
  const byApp = new Map();
  const byTitle = new Map();
  for (const g of Array.isArray(pcGames) ? pcGames : []) {
    if (!g || !g.id) continue;
    const gid = String(g.id);
    const m = /^steam-(\d{1,10})$/.exec(gid);
    const appid = g.appid ? String(g.appid) : (m ? m[1] : null);
    if (appid) {
      if (!byApp.has(appid)) byApp.set(appid, []);
      byApp.get(appid).push(gid);
    }
    const nt = normTitle(g.title);
    if (nt) {
      if (!byTitle.has(nt)) byTitle.set(nt, []);
      byTitle.get(nt).push(gid);
    }
  }
  return { byApp, byTitle };
}

function findSteamCloudFiles(steamPaths) {
  const roots = new Set();
  const list = Array.isArray(steamPaths) ? steamPaths : [steamPaths];
  for (const p of list) {
    if (!p || typeof p !== 'string') continue;
    roots.add(p);
    // Walk up if pointed at a steamapps library folder inside Steam
    if (path.basename(p).toLowerCase() === 'steamapps') roots.add(path.dirname(p));
  }
  if (process.platform === 'win32') {
    for (const d of ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam']) {
      if (fs.existsSync(d)) roots.add(d);
    }
  }
  const found = [];
  for (const root of roots) {
    const ud = path.join(root, 'userdata');
    let ents = [];
    try { ents = fs.readdirSync(ud, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name === '0') continue;
      const f = path.join(ud, e.name, 'config', 'cloudstorage', 'cloud-storage-namespace-1.json');
      try {
        const st = fs.statSync(f);
        if (st.isFile()) found.push({ file: f, mtimeMs: st.mtimeMs });
      } catch {}
    }
  }
  found.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return found.map(x => x.file);
}

function mapAppIds(appIds, excluded, byApp) {
  const excl = new Set((Array.isArray(excluded) ? excluded : []).map(x => String(x)));
  const out = new Set();
  for (const raw of Array.isArray(appIds) ? appIds : []) {
    const k = String(raw);
    if (excl.has(k)) continue;
    for (const gid of byApp.get(k) || []) out.add(gid);
  }
  return [...out];
}

function parseSteamRule(filterSpec, name) {
  const groups = (filterSpec && Array.isArray(filterSpec.filterGroups)) ? filterSpec.filterGroups : [];
  const hasOpts = groups.some(fg => fg && Array.isArray(fg.rgOptions) && fg.rgOptions.length > 0);
  const hasSearch = !!(filterSpec && typeof filterSpec.strSearchText === 'string' && filterSpec.strSearchText.trim());
  if (!hasOpts && !hasSearch) return null;
  const rule = {};
  const g2 = (groups[2] && Array.isArray(groups[2].rgOptions)) ? groups[2].rgOptions : [];
  if (g2.some(n => [8, 9, 23].includes(+n)) || /\b(online|multi|co-?op)\b/i.test(String(name || ''))) {
    rule.multiplayer = true;
  }
  const g3 = (groups[3] && Array.isArray(groups[3].rgOptions)) ? groups[3].rgOptions : [];
  if (g3.includes(1)) rule.install = 'installed';
  return rule;
}

function importSteam(steamPaths, pcGames) {
  const files = findSteamCloudFiles(steamPaths);
  if (!files.length) return { file: null, favorites: [], groups: [] };
  let raw = null;
  let usedFile = null;
  for (const f of files) {
    try {
      raw = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Array.isArray(raw)) { usedFile = f; break; }
    } catch {}
  }
  if (!Array.isArray(raw)) return { file: null, favorites: [], groups: [] };

  const { byApp } = buildAppIndex(pcGames);
  const favorites = [];
  const groups = [];

  for (const item of raw) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || !item[1] || item[1].is_deleted) continue;
    if (!item[0].startsWith('user-collections.')) continue;
    let val;
    try { val = typeof item[1].value === 'string' ? JSON.parse(item[1].value) : item[1].value; } catch { continue; }
    if (!val || typeof val !== 'object' || !val.id || !val.name) continue;
    if (val.id === 'hidden') continue;
    const ids = mapAppIds(val.added, val.removed, byApp);
    if (val.id === 'favorite') {
      for (const gid of ids) if (!favorites.includes(gid)) favorites.push(gid);
      continue;
    }
    const rule = parseSteamRule(val.filterSpec, val.name);
    const isDynamic = !!rule;
    groups.push({
      id: 'st-' + slug(val.id),
      name: String(val.name).replace(/\s+/g, ' ').trim().slice(0, 40) || 'Collection',
      kind: isDynamic ? 'dynamic' : 'manual',
      ids,
      ...(rule ? { rule } : {}),
      collapsed: true,
    });
  }
  return { file: usedFile, favorites, groups };
}

async function importPlaynite(found, pcGames, readFn) {
  if (!found || typeof readFn !== 'function') return { groups: [] };
  const lib = await readFn(found);
  const cats = Array.isArray(lib && lib.categories) ? lib.categories : [];
  if (!cats.length) return { groups: [] };
  const { byApp, byTitle } = buildAppIndex(pcGames);
  const byOwn = new Map();
  for (const g of pcGames || []) if (g && g.id) byOwn.set(String(g.id).toLowerCase(), String(g.id));

  const catNames = new Map();
  const catIdsMap = new Map();
  for (const c of cats) {
    const cid = String((c && (c.Id || c._id)) || '').toLowerCase();
    if (cid && c.Name) {
      catNames.set(cid, String(c.Name).trim().slice(0, 40));
      catIdsMap.set(cid, new Set());
    }
  }
  for (const g of (lib && lib.games) || []) {
    if (!g || g.Hidden || !Array.isArray(g.CategoryIds) || !g.CategoryIds.length) continue;
    const pid = String(g.Id || g._id || '');
    const gidOwn = pid ? byOwn.get('own-' + pid.toLowerCase()) : null;
    const appMatches = g.GameId && /^\d{1,10}$/.test(String(g.GameId)) ? (byApp.get(String(g.GameId)) || []) : [];
    const titleMatches = !gidOwn && !appMatches.length ? (byTitle.get(normTitle(g.Name)) || []) : [];
    const matched = [gidOwn, ...appMatches, ...titleMatches].filter(Boolean);
    if (!matched.length) continue;
    for (const rawCid of g.CategoryIds) {
      const set = catIdsMap.get(String(rawCid || '').toLowerCase());
      if (set) for (const mid of matched) set.add(mid);
    }
  }
  const groups = [];
  for (const [cid, name] of catNames) {
    groups.push({
      id: 'pn-' + slug(cid),
      name,
      kind: 'manual',
      ids: [...(catIdsMap.get(cid) || [])],
      collapsed: true,
    });
  }
  return { groups };
}

module.exports = { findSteamCloudFiles, importSteam, importPlaynite };
