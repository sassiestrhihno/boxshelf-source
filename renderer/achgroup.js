// (beta.14) How a game's achievements are grouped and sorted, shared by the shelf's Achievements screen (app.js) and the
// in-game Home menu's (home.js), so both read the same way: the trophy shelf of what's unlocked (newest first), then the
// rest by Order (Story, Missable, Everything else), Rarity (its tiers) or Points. Plain functions, no page access.
(() => {
  const TABS = [['all', 'All'], ['got', 'Unlocked'], ['locked', 'Locked']];
  const SORTS = [['order', 'Order'], ['rarity', 'Rarity'], ['points', 'Points']];
  // the share of players who have it → its tier
  const tier = r => r == null ? null : r < 3 ? ['ultra', 'Ultra rare'] : r < 10 ? ['rare', 'Rare'] : r < 40 ? ['uncommon', 'Uncommon'] : ['common', 'Common'];
  // RetroAchievements' type, or a PS3 trophy's grade
  const type = t => { t = String(t || '').toLowerCase(); return t === 'progression' ? ['story', 'Story'] : t === 'win_condition' ? ['win', 'Beats the game'] : t === 'missable' ? ['miss', 'Missable'] : /^(platinum|gold|silver|bronze)$/.test(t) ? ['grade-' + t, t[0].toUpperCase() + t.slice(1)] : null; };
  function date(s) { if (!s) return ''; const d = new Date(String(s).replace(' ', 'T')); return isNaN(d) ? String(s).slice(0, 10) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); }
  function sorted(list, sort) { const L = list.slice(); if (sort === 'rarity') L.sort((a, b) => (a.rarity ?? 101) - (b.rarity ?? 101)); else if (sort === 'points') L.sort((a, b) => b.points - a.points); return L; }
  // a tab's achievements
  const filtered = (all, filter) => filter === 'got' ? all.filter(a => a.earned) : filter === 'locked' ? all.filter(a => !a.earned) : all.slice();
  // the wall in sections: All has a trophy shelf of what you've unlocked (newest first) over the rest; Order splits the rest
  // into Story, Missable and everything else, Rarity into its tiers
  function sections(list, filter, sort) {
    const S = [];
    if (filter === 'all') { S.push({ key: 'shelf', label: 'Your trophies', shelf: true, items: list.filter(a => a.earned).sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))) }); list = list.filter(a => !a.earned); }
    const L = sorted(list, sort), kind = a => { const t = type(a.type); return t ? t[0] : ''; }, rest = filter === 'all' ? 'Still to unlock' : filter === 'got' ? 'Unlocked' : 'Locked';
    if (sort === 'rarity') [['ultra', 'Ultra rare'], ['rare', 'Rare'], ['uncommon', 'Uncommon'], ['common', 'Common'], ['none', 'No rarity yet']].forEach(([k, l]) => { const it = L.filter(a => (tier(a.rarity) || ['none'])[0] === k); if (it.length) S.push({ key: k, label: l, items: it }); });
    else if (sort === 'order') { const st = L.filter(a => kind(a) === 'story' || kind(a) === 'win'), mi = L.filter(a => kind(a) === 'miss'), ot = L.filter(a => !st.includes(a) && !mi.includes(a));
      if (st.length) S.push({ key: 'story', label: 'Story', items: st }); if (mi.length) S.push({ key: 'miss', label: 'Missable', items: mi }); if (ot.length) S.push({ key: 'rest', label: st.length || mi.length ? 'Everything else' : rest, items: ot }); }
    else if (L.length) S.push({ key: 'rest', label: rest, items: L });
    return S;
  }
  // an achievement with no picture of its own (Xenia doesn't keep them): a drawn trophy, gold once unlocked
  const TROPHY = on => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="${on ? '#3a2c0c' : '#1d2230'}"/><path d="M22 16h20v8a10 10 0 0 1-20 0zM22 19h-6a6 6 0 0 0 7 7M42 19h6a6 6 0 0 1-7 7M29 34h6v7h-6zM24 44h16v5H24z" fill="none" stroke="${on ? '#f1c75a' : '#5c6478'}" stroke-width="3" stroke-linejoin="round"/></svg>`);
  // the badge's own picture (a locked one is dimmed by the page: RetroAchievements' "_lock" copy is already grey)
  const img = a => a.badge ? String(a.badge).replace(/_lock(\.png)$/i, '$1') : TROPHY(!!a.earned);
  // up / down on a wall with sections and a shelf (no fixed column count): the badge in the row above or below that's
  // nearest across, from where the badges are (centres, half a badge of slack: the selected one is lifted and scaled)
  function nearest(tiles, sel, d) {
    const c = tiles[sel]; if (!c) return -1; const r = c.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, hh = r.height / 2; let best = -1, bd = Infinity, bx = Infinity;
    tiles.forEach((t, i) => { if (i === sel) return; const q = t.getBoundingClientRect(), dy = d > 0 ? q.top + q.height / 2 - cy : cy - q.top - q.height / 2; if (dy < hh) return; const dx = Math.abs(q.left + q.width / 2 - cx); if (dy < bd - hh || (Math.abs(dy - bd) <= hh && dx < bx)) { bd = dy; bx = dx; best = i; } });
    return best;
  }
  window.AchGroup = { TABS, SORTS, tier, type, date, sorted, filtered, sections, TROPHY, img, nearest };
})();
