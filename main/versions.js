'use strict';

const PC_LABELS = {
  steam: 'Steam',
  epic: 'Epic',
  gog: 'GOG',
  ubisoft: 'Ubisoft',
  ea: 'EA',
  xbox: 'Xbox PC',
  battlenet: 'Battle.net',
  quiver: 'Quiver',
  playnite: 'Playnite',
  custom: 'PC (Custom)',
};

const STORE_ORDER = { steam: 0, gog: 1, epic: 2, xbox: 3, ea: 4, ubisoft: 5, battlenet: 6 };

function normalizeTitle(raw) {
  let s = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!s.trim()) return '';
  // Strip bracketed/parenthesized region, revision, year, disc, or tag annotations.
  s = s.replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, ' ');
  // Normalize No-Intro comma-article form: "Legend of Zelda, The - Ocarina of Time" -> "the legend of zelda ocarina of time"
  s = s.replace(/^([^,:-]+),\s*(the|an|a)(?=\s*[-:–—]|$)/i, '$2 $1');
  // Strip standalone version tokens (v1.2, ver 2.0, rev a, build 123) before punctuation replacement dissolves dots.
  // Require a separator after rev/revision so words like "Revelations" are preserved.
  s = s.replace(/\b(?:ver(?:sion)?\.?\s*\d+(?:\.\d+)*|v\d+(?:\.\d+)*|rev(?:ision)?(?:\.\s*|\s+)[a-z0-9]+|build\s*\d+)\b/g, ' ');
  // Unify punctuation and separators.
  s = s.replace(/[&+]/g, ' and ').replace(/['’`]/g, '').replace(/[:\-–—_/\\.,!?*~|]+/g, ' ');
  // Strip common edition / port / recomp phrases without removing sequel numerals.
  s = s.replace(/\b(?:game of the year edition|goty edition|definitive edition|complete edition|ultimate edition|enhanced edition|collector'?s edition|anniversary edition|special edition|director'?s cut|hd remaster|pc port|remastered|remake|recompiled|recomp|decompiled|decomp|edition|goty)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // Drop leading articles after comma-article normalization.
  s = s.replace(/^(?:the|an|a)\s+/, '').trim();
  return s;
}

function editionTagOf(title) {
  const s = String(title || '');
  const m = s.match(/\b(HD Remaster|Game of the Year Edition|GOTY Edition|GOTY|Definitive Edition|Complete Edition|Ultimate Edition|Enhanced Edition|Collector'?s Edition|Anniversary Edition|Special Edition|Director'?s Cut|Remastered|Remake|Recompiled|Recomp|PC Port|Classic)\b/i);
  if (m) {
    return m[1]
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase())
      .replace(/\bOf\b/g, 'of')
      .replace(/\bThe\b/g, 'the')
      .replace(/\bGoty\b/i, 'GOTY')
      .replace(/\bHd\b/i, 'HD')
      .replace(/\bPc\b/i, 'PC');
  }
  const ym = s.match(/\(((?:19|20)\d{2})\)/);
  return ym ? ym[1] : '';
}

function versionLabelOf(g, shelfName) {
  if (!g) return 'Version';
  if (g.kind === 'steam') {
    const ed = editionTagOf(g.title);
    if (g.source === 'owned') {
      return [PC_LABELS[g.store] || g.store || 'Playnite', ed, 'Not installed'].filter(Boolean).join(' · ');
    }
    if (g.source && PC_LABELS[g.source]) {
      return [PC_LABELS[g.source], ed].filter(Boolean).join(' · ');
    }
    const base = shelfName && !/^(pc|custom)$/i.test(String(shelfName)) ? `${shelfName} · PC` : 'Steam';
    return [base, ed].filter(Boolean).join(' · ');
  }
  const sys = String(shelfName || g.system || 'ROM').trim();
  const reg = g.region && g.region !== 'Unknown' ? String(g.region).trim() : '';
  const revM = String(g.file || g.title || '').match(/\((Rev[ ._-]?[\w.]+|v\d[\w.]*)\)/i);
  const rev = revM ? revM[1].replace(/^rev[ ._-]?/i, 'Rev ') : '';
  return [sys, reg, rev].filter(Boolean).join(' · ') || 'ROM';
}

function srcRank(m) {
  if (!m.installed) {
    const s = String(m.store || '').toLowerCase();
    return 30 + (s in STORE_ORDER ? STORE_ORDER[s] : 8);
  }
  if (m.kind === 'steam') {
    if (m.source === 'custom' || m.source === 'quiver') return 10;
    const s = String(m.source || 'steam').toLowerCase();
    return s in STORE_ORDER ? STORE_ORDER[s] : 8;
  }
  return 20;
}

function findDuplicates(shelves, existingVersions = []) {
  const stacked = new Set();
  for (const st of Array.isArray(existingVersions) ? existingVersions : []) {
    if (!st || !Array.isArray(st.members) || st.members.length < 2) continue;
    for (const m of st.members) {
      if (m && typeof m.id === 'string' && m.id) stacked.add(m.id);
    }
  }

  const groups = new Map();
  const seenIds = new Set();

  for (const sh of Array.isArray(shelves) ? shelves : []) {
    if (!sh || sh.id === 'home' || sh.id === 'media' || sh.col) continue;
    const shelfName = sh.name || sh.id || '';
    for (const g of Array.isArray(sh.games) ? sh.games : []) {
      if (!g || !g.id || (g.kind !== 'rom' && g.kind !== 'steam')) continue;
      const id = String(g.id);
      if (stacked.has(id) || seenIds.has(id)) continue;
      const key = normalizeTitle(g.title);
      if (!key || key.length < 2) continue;
      seenIds.add(id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        id,
        title: String(g.title || ''),
        kind: g.kind,
        source: g.source || '',
        store: g.store || '',
        installed: g.source !== 'owned',
        region: g.region || '',
        shelfId: sh.id,
        shelfName,
        label: versionLabelOf(g, shelfName),
      });
    }
  }

  const out = [];
  for (const [key, members] of groups.entries()) {
    if (members.length < 2) continue;
    members.sort((a, b) => srcRank(a) - srcRank(b) || String(a.shelfName).localeCompare(String(b.shelfName)) || a.title.localeCompare(b.title));
    // Disambiguate identical default labels within the same candidate group.
    const counts = new Map();
    for (const m of members) counts.set(m.label, (counts.get(m.label) || 0) + 1);
    const seenLbl = new Map();
    for (const m of members) {
      if ((counts.get(m.label) || 0) > 1) {
        const n = (seenLbl.get(m.label) || 0) + 1;
        seenLbl.set(m.label, n);
        m.label = `${m.label} (${n})`;
      }
    }
    const cleanTitle = members[0].title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim() || members[0].title;
    out.push({ key, title: cleanTitle, members });
  }

  out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  return out;
}

module.exports = { normalizeTitle, editionTagOf, versionLabelOf, findDuplicates };
