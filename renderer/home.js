// The Home menu overlay, used two ways:
//  • in a game: Resume, Save/Load state, Screenshot, (beta.14) Achievements, Power, Quit to shelf (only what that
//    emulator supports; Achievements only for a game that has some)
//  • on the shelf: Home shelf, Museum, Settings, (beta.12, Seamless play) Go to desktop, Power
// Power opens a sub-list in place (Sleep, Restart, Shut down, Quit Boxshelf). The main process opens the menu,
// forwards controller buttons (from the XInput helper) and carries out whatever is chosen here.
(() => {
  // fonts are bundled (fonts/fonts.css, linked from home.html): no font CDN request
  const api = window.home || { onOpen() {}, onButton() {}, onToast() {}, act() {} };
  const $ = id => document.getElementById(id);
  const P = (d, fill) => fill ? `<path d="${d}" fill="currentColor"/>` : `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  const ICON = {
    resume: P('M8 5.5v13l11-6.5z', true),
    save: P('M12 4v10m0 0-4-4m4 4 4-4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3'),
    load: P('M12 15V5m0 0-4 4m4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3'),
    shot: P('M4 8.5A2.5 2.5 0 0 1 6.5 6h1.7l1.3-2h5l1.3 2h1.7A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5zM12 9.1a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z'),
    quit: P('M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10'),
    power: P('M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0'),
    shelfhome: P('M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z'),
    museum: P('M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18'),
    settings: P('M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6zM19.4 13.5l1.6 1.2-1.8 3.1-1.9-.6a7.4 7.4 0 0 1-1.6.9L15.3 20h-3.6l-.4-1.9a7.4 7.4 0 0 1-1.6-.9l-1.9.6-1.8-3.1 1.6-1.2a7 7 0 0 1 0-1.9L6 10.4l1.8-3.1 1.9.6c.5-.4 1-.7 1.6-.9L11.7 5h3.6l.4 1.9c.6.2 1.1.5 1.6.9l1.9-.6 1.8 3.1-1.6 1.2a7 7 0 0 1 0 1.9z'),
    sleep: P('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'),
    restart: P('M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'),
    shutdown: P('M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0'),
    quitapp: P('M6 6l12 12M18 6L6 18'),
    desktop: P('M3 5h18v11H3zM8 20h8M12 16v4'), // (beta.12) Seamless play: Go to desktop
    ach: P('M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3.5 4.5M16 6h3a3 3 0 0 1-3.5 4.5M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z'), // (beta.14) Achievements
    back: P('M15 5l-7 7 7 7')
  };
  const LABEL = { resume: 'Resume', save: 'Save state', load: 'Load state', shot: 'Screenshot', quit: 'Quit to shelf', power: 'Power', ach: 'Achievements',
    shelfhome: 'Home shelf', museum: 'Museum', settings: 'Settings', desktop: 'Go to desktop',
    sleep: 'Sleep', restart: 'Restart', shutdown: 'Shut down', quitapp: 'Quit Boxshelf', back: 'Back' };
  const HOLD = new Set(['quit', 'restart', 'shutdown', 'quitapp']); // these need A held, so a stray press never does them
  const SEP_BEFORE = new Set(['power', 'quit']);
  let main = [], power = [], items = [], inPower = false, sel = 0, mainSel = 0, open = false, info = null, holdT = 0, holdStart = 0, toastT = 0, clockT = 0;
  const HOLD_MS = 900;

  function fmtFor(ms) { const m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim(); }
  function tick() {
    $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (info && info.startedAt) $('time').textContent = `Playing for ${fmtFor(Date.now() - info.startedAt)}`;
  }
  // Settings → Controller → Confirm button 'b' (Nintendo style): the main process passes info.confirmButton; A and B swap
  const swapAB = () => !!(info && info.confirmButton === 'b');
  // which: 'ok' / 'back' -> the face button that does it (bottom, or right when swapped), labelled as that pad prints it
  function glyph(which) { const g = info && info.glyphs, bottom = (which === 'ok') !== swapAB();
    return g === 'ps' ? (bottom ? '✕' : '○') : g === 'nintendo' ? (bottom ? 'B' : 'A') : (bottom ? 'A' : 'B'); }
  function subFor(id) {
    if ((id === 'restart' || id === 'shutdown') && info && info.inGame) return `closes the game · hold ${glyph('ok')}`;
    if (HOLD.has(id)) return `hold ${glyph('ok')}`;
    if ((id === 'save' || id === 'load') && info && info.slot) return `slot ${info.slot}`;
    if (id === 'sleep' && info && info.inGame) return info.canSave ? 'saves, then sleeps' : info.paused ? 'game stays paused' : 'game keeps running';
    if (id === 'resume' && info && info.inGame && !info.paused) return 'game is still running';
    if (id === 'power' || id === 'ach') return '›';
    return '';
  }
  function render() {
    const nav = $('items'); nav.innerHTML = '';
    document.body.classList.toggle('in-power', inPower); document.body.classList.toggle('in-ach', inAch);
    if (inAch) { renderAch(nav); foot(); return; }
    if (inPower) { const h = document.createElement('div'); h.className = 'subhead'; h.textContent = 'Power'; nav.append(h); }
    items.forEach((id, i) => {
      if (!inPower && SEP_BEFORE.has(id) && i > 0) nav.append(Object.assign(document.createElement('div'), { className: 'sep' }));
      const el = document.createElement('div'); el.className = 'item' + (i === sel ? ' sel' : '') + (HOLD.has(id) ? ' danger' : ''); el.setAttribute('role', 'menuitem');
      const sub = subFor(id);
      el.innerHTML = `<svg viewBox="0 0 24 24">${ICON[id] || ''}</svg><span></span>`; el.lastChild.textContent = id === 'ach' ? achLabel() : LABEL[id] || id; // text parts as text: sub can carry values from the main process
      if (sub) { const sp = document.createElement('span'); sp.className = 'sub'; sp.textContent = sub; el.append(sp); }
      if (HOLD.has(id)) { const h = document.createElement('span'); h.className = 'hold'; el.append(h); }
      nav.append(el);
    });
    foot();
  }
  // the prompts along the bottom (beta.14: a tap or click on one does it, for mouse and touch)
  function foot() {
    const guide = `<span data-b="home"><b class="guide">${info && info.glyphs === 'nintendo' ? 'Home' : 'Guide'}</b>${info && info.inGame ? 'Resume' : 'Close'}</span>`;
    if (inAch) { const sort = (AG.SORTS.find(s => s[0] === achSort) || AG.SORTS[0])[1], ok = achState === 'ok' && !!ach;
      $('foot').innerHTML = (achState === 'err' ? `<span data-b="a"><b>${glyph('ok')}</b>Try again</span>` : '') + `<span data-b="b"><b>${glyph('back')}</b>Back</span>`
        + (ok ? `<span data-b="y"><b>${glyphX('y')}</b>Sort: ${sort}</span><span data-b="tabs"><b>${glyphX('lb')}</b><b>${glyphX('rb')}</b>Tabs</span>` : '') + guide; return; }
    const backLabel = inPower ? 'Back' : info && info.inGame ? 'Resume' : 'Close';
    $('foot').innerHTML = `<span data-b="a"><b>${glyph('ok')}</b>Select</span><span data-b="b"><b>${glyph('back')}</b>${backLabel}</span><span><b>↕</b>Move</span>` + guide;
  }
  // the shelf's own sounds, in a game too (the shelf's audio is asleep while a game runs; this small window has its own)
  const cue = (name, o) => { if (!info || !info.inGame || !window.Sound) return; try { Sound.play(name, o); } catch {} };
  function move(d) { if (!items.length) return; sel = (sel + d + items.length) % items.length; cancelHold(); render(); cue('tick', { dir: d > 0 ? 1 : -1 }); }
  let holdShown = 0, holdFull = false;
  function cancelHold() { cancelAnimationFrame(holdT); holdT = 0; holdShown = 0; holdFull = false; const h = document.querySelector('.item.sel .hold'); if (h) h.style.width = '0'; }
  function holdLoop() {
    // the bar is the timer: it can't jump more than a step per frame (a busy game can make frames late), and the action
    // only fires once a full bar has actually been on screen, so it never goes off before the bar fills
    if (holdFull) { holdT = 0; holdFull = false; choose(items[sel]); return; }
    const p = Math.min(1, (performance.now() - holdStart) / HOLD_MS, holdShown + .08); holdShown = p;
    const h = document.querySelector('.item.sel .hold'); if (h) h.style.width = (p * 100) + '%';
    if (p >= 1) holdFull = true; holdT = requestAnimationFrame(holdLoop);
  }
  function enterPower() { mainSel = sel; inPower = true; items = power.concat(['back']); sel = 0; render(); cue('open'); }
  function leavePower() { inPower = false; items = main; sel = mainSel; render(); cue('back'); }

  // ---------- (beta.14) Achievements: the running game's, laid out like the shelf's Achievements screen ----------
  // main adds the item only for a game that has some (RetroAchievements, Xenia for Xbox 360, RPCS3 for PS3) and reads the
  // list when it's chosen. As on the shelf (the grouping and sorting are achgroup.js, shared with app.js): tabs All /
  // Unlocked / Locked, a trophy shelf of what's unlocked (newest first), then the wall of the rest in sections (Order:
  // Story, Missable, Everything else; Rarity: its tiers; Points), each badge's rim saying how rare it is, and a card for
  // the selected one. Y sorts, LB / RB switch tabs, B goes back to the menu. Badges load as they scroll near.
  const AG = window.AchGroup;
  let inAch = false, ach = null, achState = '', achErr = '', achItems = [], achTiles = [], achSel = 0, achShown = -1, achSeq = 0, achIO = null, achFilter = 'all', achSort = 'order';
  const achLabel = () => (info && info.achLabel) || 'Achievements';
  const achSrc = () => (info && info.achSrc) || 'RetroAchievements';
  const achPts = p => p.unit === 'G' ? `${p.pointsEarned} / ${p.points} G` : p.unit === 'trophy' ? (p.grades || `${p.earned} / ${p.total} trophies`) : `${p.pointsEarned} / ${p.points} points`;
  // what the card calls a badge's worth: RetroAchievements points, Xbox 360 gamerscore, a PS3 trophy's grade
  const achWorth = p => p.unit === 'G' ? ['Gamerscore', a => `${a.points} G`] : p.unit === 'trophy' ? ['Grade', a => a.grade || '—'] : ['Points', a => String(a.points)];
  // the other face buttons as that pad prints them
  const glyphX = k => { const g = info && info.glyphs; return (g === 'ps' ? { y: '△', lb: 'L1', rb: 'R1' } : g === 'nintendo' ? { y: 'X', lb: 'L', rb: 'R' } : { y: 'Y', lb: 'LB', rb: 'RB' })[k]; };
  function addAch() {
    if (main.includes('ach')) return; const p = main.indexOf('power'), at = p < 0 ? main.length : p;
    main = main.slice(0, at).concat('ach', main.slice(at));
    if (inPower || inAch) { if (mainSel >= at) mainSel++; } else { items = main; if (sel >= at) sel++; }
  }
  function achReset() { inAch = false; achSeq++; ach = null; achItems = []; achTiles = []; achShown = -1; achState = ''; if (achIO) { achIO.disconnect(); achIO = null; } }
  function enterAch() { mainSel = sel; inAch = true; ach = null; achSel = 0; achFilter = 'all'; cue('open'); achLoad(false); }
  function leaveAch() { achReset(); items = main; sel = mainSel; render(); cue('back'); }
  function achLoad(force) {
    const seq = ++achSeq; achState = 'load'; achErr = ''; render();
    Promise.resolve().then(() => api.achList ? api.achList(!!force) : null).then(
      p => { if (seq !== achSeq || !inAch) return; ach = p && Array.isArray(p.achievements) && p.achievements.length ? p : null; achState = ach ? 'ok' : 'none'; achSel = 0; render(); },
      e => { if (seq !== achSeq || !inAch) return; achState = 'err'; achErr = String((e && e.message) || '').replace(/^Error invoking remote method '[^']*': (Error: )?/, ''); render(); });
  }
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  function renderAch(nav) {
    if (achIO) { achIO.disconnect(); achIO = null; }
    const top = el('div', 'ach-top'); top.append(el('div', 'subhead', achLabel())); nav.append(top);
    if (achState !== 'ok' || !ach) {
      achItems = []; achTiles = []; const m = el('div', 'ach-msg' + (achState === 'err' ? ' err' : ''));
      if (achState === 'load') m.append(el('b', '', `Loading from ${achSrc()}…`));
      else if (achState === 'err') m.append(el('b', '', `${achLabel()} didn't load`), el('span', '', achErr || `${achSrc()} didn't answer.`));
      else m.append(el('b', '', 'None for this game yet'), el('span', '', achSrc() === 'RetroAchievements' ? 'RetroAchievements has no set for this game.' : `They show once ${achSrc()} has some for this game.`));
      nav.append(m); return;
    }
    const p = ach, pct = p.total ? Math.round(100 * p.earned / p.total) : 0, sum = el('div', 'ach-sum'), st = el('div', 'st');
    st.append(el('span', '', p.mastered === 'mastered' ? 'Mastered' : p.mastered === 'platinum' ? 'Platinum' : p.mastered === 'completed' ? 'Completed' : `${p.earned} of ${p.total} unlocked`), el('small', '', pct + '%'));
    const bar = el('div', 'bar'), bi = el('i'); bi.style.width = pct + '%'; bar.append(bi);
    sum.append(st, bar, el('div', 'ln', (p.mastered ? `${p.earned} of ${p.total} unlocked · ` : '') + achPts(p) + ' · ' + (p.src || achSrc())));
    nav.append(sum);
    const tabs = el('div', 'ach-tabs'); tabs.id = 'achTabs'; top.append(tabs);
    const body = el('div', 'ach-body'), wall = el('div', 'ach-wall'), card = el('div', 'ach-card');
    wall.id = 'achWall'; wall.setAttribute('role', 'list'); card.id = 'achCard'; card.setAttribute('aria-live', 'polite');
    card.innerHTML = '<div class="ach-card-top"><img class="ach-big" alt="" decoding="async"><div class="ach-card-h"><div class="ach-card-t"></div><div class="ach-meta"><span class="ach-tier"></span><span class="ach-tags"></span></div></div></div><div class="ach-card-d"></div><div class="ach-facts"></div><div class="ach-when"></div>';
    body.append(wall, card); nav.append(body);
    achWall(true);
  }
  function achTabs() {
    const t = $('achTabs'); if (!t || !ach) return; t.innerHTML = ''; const all = ach.achievements;
    AG.TABS.forEach(([id, label]) => { const n = id === 'got' ? all.filter(a => a.earned).length : id === 'locked' ? all.filter(a => !a.earned).length : all.length;
      const b = el('button', 'ach-tab' + (id === achFilter ? ' on' : '')); b.type = 'button'; b.tabIndex = -1; b.dataset.tab = id; b.append(el('span', '', label), el('em', '', String(n))); t.append(b); });
  }
  // the wall for the chosen tab and sort; opening lands on the first locked one (the next to go for), as on the shelf
  function achWall(first) {
    const wall = $('achWall'); if (!wall || !ach) return; if (achIO) { achIO.disconnect(); achIO = null; }
    const all = ach.achievements, secs = AG.sections(AG.filtered(all, achFilter), achFilter, achSort);
    achItems = secs.flatMap(s => s.items); achSel = first ? Math.max(0, achItems.findIndex(a => !a.earned)) : 0; achShown = -1; achTiles = [];
    wall.innerHTML = ''; wall.scrollTop = 0; const card = $('achCard'); if (card) card._a = null;
    if ('IntersectionObserver' in window) achIO = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; const im = e.target; achIO.unobserve(im); if (im.dataset.src) { im.src = im.dataset.src; delete im.dataset.src; } }), { root: wall, rootMargin: '160px 0px' });
    const fr = document.createDocumentFragment(); let i = 0;
    secs.forEach(s => {
      const h = el('div', 'ach-sec' + (s.shelf ? ' top' : '')); h.append(el('span', '', s.label), el('em', '', String(s.items.length))); fr.append(h);
      if (s.shelf) { const sh = el('div', 'ach-shelf'), row = el('div', 'ach-shelf-row');
        if (!s.items.length) { const e = el('div', 'ach-shelf-empty'); e.append(el('i'), el('span', '', 'Your first unlock goes here')); row.append(e); }
        s.items.forEach(a => row.append(achTile(a, i++))); sh.append(row); fr.append(sh); return; }
      s.items.forEach(a => fr.append(achTile(a, i++)));
    });
    if (!achItems.length || (achFilter === 'all' && !all.some(a => !a.earned))) fr.append(el('div', 'ach-empty', achFilter === 'got' ? 'Nothing unlocked yet. Every achievement is under Locked.' : 'All unlocked. Nothing left to earn here.'));
    wall.append(fr); achTabs(); foot(); achSelect(false);
    if (card && !achItems.length) card.hidden = true;
  }
  function achTile(a, i) {
    const t = el('div', 'ach' + (a.earned ? '' : ' locked')), tier = AG.tier(a.rarity), type = AG.type(a.type);
    if (type && type[0] === 'miss') t.classList.add('miss'); t.dataset.i = i; if (tier) t.dataset.tier = tier[0];
    t.setAttribute('role', 'listitem'); t.setAttribute('aria-label', `${a.title}, ${a.earned ? 'unlocked' : 'locked'}${tier ? ', ' + tier[1].toLowerCase() : ''}`);
    const im = el('img'), src = AG.img(a); im.alt = ''; im.decoding = 'async'; im.draggable = false; im.onerror = () => { im.onerror = null; im.src = AG.TROPHY(a.earned); };
    if (a.badge && achIO) { im.dataset.src = src; achIO.observe(im); } else im.src = src;
    t.append(im); achTiles.push(t); return t;
  }
  // the selected badge: only the one that was on and the new one change (a move touches two badges, not the whole wall)
  function achSelect(smooth) {
    if (achShown >= 0 && achTiles[achShown]) achTiles[achShown].classList.remove('sel');
    const t = achTiles[achSel]; if (t) { t.classList.add('sel'); achKeep(t, smooth); } achShown = achSel; achCard();
  }
  // keep it in view: the shelf scrolls across to it, the wall up or down (bringing a section's heading along with its first row)
  function achKeep(t, smooth) {
    const wall = $('achWall'); if (!wall) return; const behavior = smooth && !document.body.classList.contains('reduce-motion') ? 'smooth' : 'auto';
    const row = t.parentNode && t.parentNode.classList.contains('ach-shelf-row') ? t.parentNode : null;
    if (row) { const l = t.offsetLeft - 10, r = t.offsetLeft + t.offsetWidth + 10; if (l < row.scrollLeft) row.scrollTo({ left: Math.max(0, l), behavior }); else if (r > row.scrollLeft + row.clientWidth) row.scrollTo({ left: r - row.clientWidth, behavior }); }
    const box = row ? row.parentNode : t; let top = box.offsetTop; const bot = box.offsetTop + box.offsetHeight;
    let h = box.previousElementSibling; while (h && !h.classList.contains('ach-sec')) h = h.previousElementSibling;
    if (h && top - h.offsetTop < t.offsetHeight * 1.6) top = h.offsetTop;
    const to = top - 6 < wall.scrollTop ? top - 6 : bot + 10 > wall.scrollTop + wall.clientHeight ? bot + 10 - wall.clientHeight : null;
    if (to != null) wall.scrollTo({ top: Math.max(0, to), behavior });
  }
  // the card: what the badge wall can't say
  function achCard() {
    const c = $('achCard'), a = achItems[achSel]; if (!c) return; if (!a) { c.hidden = true; return; } c.hidden = false;
    if (c._a === a) return; c._a = a; const tier = AG.tier(a.rarity), type = AG.type(a.type), worth = achWorth(ach);
    c.dataset.tier = tier ? tier[0] : ''; c.classList.toggle('locked', !a.earned);
    const big = c.querySelector('.ach-big'); big.onerror = () => { big.onerror = null; big.src = AG.TROPHY(a.earned); }; big.src = AG.img(a);
    c.querySelector('.ach-card-t').textContent = a.title; c.querySelector('.ach-card-d').textContent = a.desc || '';
    c.querySelector('.ach-tier').textContent = tier ? tier[1] : '';
    const tg = c.querySelector('.ach-tags'); tg.innerHTML = ''; if (type) tg.append(el('span', 'ach-tag ' + type[0], type[1]));
    const f = c.querySelector('.ach-facts'); f.innerHTML = '';
    [[worth[0], worth[1](a)], ['Players', a.rarity != null ? a.rarity + '%' : '—'], ['Status', a.earned ? 'Unlocked' + (a.hardcore ? ' · hardcore' : '') : 'Locked']].forEach(([k, v]) => { const d = el('div'); d.append(el('small', '', k), el('b', '', v)); f.append(d); });
    c.querySelector('.ach-when').textContent = a.earned && a.date ? 'Unlocked ' + AG.date(a.date) : '';
  }
  function achMove(d) { const n = AG.nearest(achTiles, achSel, d); if (n < 0) return; achSel = n; achSelect(true); cue('tick', { dir: d }); }
  function achSide(d) { if (!achItems.length) return; const n = Math.max(0, Math.min(achItems.length - 1, achSel + d)); if (n === achSel) return; achSel = n; achSelect(true); cue('tick', { dir: d }); }
  function achTab(d) { const i = AG.TABS.findIndex(t => t[0] === achFilter), n = Math.max(0, Math.min(AG.TABS.length - 1, i + d)); if (n === i) return; achFilter = AG.TABS[n][0]; achWall(false); cue('tick', { dir: d > 0 ? 1 : -1 }); }
  // Order → Rarity → Points; the one you were on stays selected, wherever it moved to
  function achSortStep() { const i = AG.SORTS.findIndex(s => s[0] === achSort), keep = achItems[achSel]; achSort = AG.SORTS[(i + 1) % AG.SORTS.length][0]; achWall(false);
    const j = keep ? achItems.indexOf(keep) : -1; if (j > 0) { achSel = j; achSelect(false); } cue('tick', { dir: 1 }); }
  function achPress(btn, down) {
    if (!down) return;
    if (btn === 'b') return leaveAch();
    if (btn === 'home' || btn === 'start') return close('resume');
    if (achState !== 'ok') { if (btn === 'a' && achState === 'err') achLoad(true); return; }
    if (btn === 'up') achMove(-1); else if (btn === 'down') achMove(1);
    else if (btn === 'left') achSide(-1); else if (btn === 'right') achSide(1);
    else if (btn === 'y') achSortStep();
    else if (btn === 'lb') achTab(-1); else if (btn === 'rb') achTab(1);
  }

  function choose(id) {
    if (!open) return; cancelHold();
    if (id === 'ach') return enterAch();
    if (id === 'power') return enterPower();
    if (id === 'back') return leavePower();
    close(id);
  }
  // once the closing cue has played, the menu's audio fades and sleeps (it ran for the whole game otherwise); a cue wakes it
  let sndT = 0;
  function close(action) { if (!open) return; cancelHold(); cue(!action || action === 'resume' || action === 'quit' ? 'back' : 'open'); open = false; inPower = false; document.body.classList.remove('open'); clearInterval(clockT); api.act(action || 'resume');
    clearTimeout(sndT); sndT = setTimeout(() => { if (!open && window.Sound && Sound.fadeOut) { try { Sound.fadeOut(400); } catch {} } }, 900); }

  api.onOpen(d => {
    info = d || {}; main = (info.actions && info.actions.length ? info.actions : ['resume', 'quit']); power = info.power || ['sleep', 'restart', 'shutdown'];
    items = main; inPower = false; sel = 0; cancelHold(); // a hold still filling from the last time must not fire in this one
    achReset(); if (info.inGame && info.ach) addAch(); // (beta.14) Achievements, for a game that has some
    ptr = null; document.body.classList.remove('pointer');
    document.documentElement.style.setProperty('--accent', info.accent || '#9d8cff');
    document.body.classList.toggle('layout-center', info.layout === 'center'); document.body.classList.toggle('layout-side', info.layout !== 'center');
    document.body.classList.toggle('is-paused', !!info.paused); document.body.classList.toggle('shelf', !info.inGame);
    { let rm = false; try { rm = info.reduceMotion === true || (info.reduceMotion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches); } catch {} document.body.classList.toggle('reduce-motion', rm); } // (beta.12) Boxshelf's own Reduce motion
    $('cover').src = info.cover || ''; $('cover').parentNode.style.display = info.cover ? '' : 'none';
    $('sys').textContent = info.system || ''; $('title').textContent = info.title || (info.inGame ? 'Now playing' : 'Home'); $('time').textContent = info.subtitle || '';
    render(); tick(); clearInterval(clockT); clockT = setInterval(tick, 15000);
    if (window.Sound && Sound.setSink && typeof info.audioOut === 'string') { try { Sound.setSink(info.audioOut); } catch {} } // Settings → Sound → Output device, when passed
    if (info.inGame && info.sound && window.Sound) { try { Sound.set({ enabled: info.sound.enabled !== false, theme: info.sound.theme, volume: info.sound.volume, boot: info.sound.boot }); } catch {} }
    cue('panel');
    open = true; requestAnimationFrame(() => document.body.classList.add('open'));
  });
  // controller buttons from the main process (XInput helper): up/down/left/right/a/b/start/home (beta.14: y/lb/rb too, for
  // Achievements), with down/up for A.
  // 'ok' / 'cancel' are the same as a / b but never swapped (keyboard Enter / Esc: they mean select / back on any setting).
  api.onButton(({ btn, down }) => {
    if (!open) return;
    if (down) document.body.classList.remove('pointer'); // (beta.14: a controller in use again hides the mouse pointer)
    if (swapAB()) btn = btn === 'a' ? 'b' : btn === 'b' ? 'a' : btn;
    press(btn === 'ok' ? 'a' : btn === 'cancel' ? 'b' : btn, down);
  });
  // The window only has the keyboard while it's open over a media app (the menu takes the focus there): Enter / Esc and the
  // arrows work like on the shelf, instead of nothing at all
  // (beta.14: S sorts and Q / E switch tabs in Achievements, as on the shelf)
  const KEY = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b', Home: 'home', s: 'y', S: 'y', q: 'lb', Q: 'lb', e: 'rb', E: 'rb' };
  addEventListener('keydown', e => { const b = KEY[e.key]; if (!b || !open) return; e.preventDefault(); document.body.classList.remove('pointer'); if (e.repeat && !/^Arrow/.test(e.key)) return; press(b, true); });
  addEventListener('keyup', e => { const b = KEY[e.key]; if (b === 'a' && open) press(b, false); });
  function press(btn, down) {
    if (inAch) return achPress(btn, down);
    const centre = document.body.classList.contains('layout-center') && !inPower;
    if (down && (btn === 'up' || (centre && btn === 'left'))) move(centre && btn === 'up' ? -3 : -1);
    else if (down && (btn === 'down' || (centre && btn === 'right'))) move(centre && btn === 'down' ? 3 : 1);
    else if (btn === 'a') {
      const id = items[sel];
      if (HOLD.has(id)) { if (down) { holdStart = performance.now(); cancelAnimationFrame(holdT); holdT = requestAnimationFrame(holdLoop); } else cancelHold(); }
      else if (down) choose(id);
    }
    else if (down && btn === 'b') { if (inPower) leavePower(); else close('resume'); }
    else if (down && (btn === 'home' || btn === 'start')) close('resume');
  }
  if (api.onPaused) api.onPaused(p => { if (!info || !info.inGame) return; info.paused = !!p; document.body.classList.toggle('is-paused', !!p); if (open && !inAch) render(); }); /* the pause lands a moment after the menu appears */
  // (beta.14) main found the game has achievements after the menu opened (it asks the first time the menu opens over a game)
  if (api.onAch) api.onAch(d => { if (!info || !info.inGame || !d || !d.ach) return; info.ach = true; info.achLabel = d.achLabel; info.achSrc = d.achSrc; addAch(); if (open && !inPower && !inAch) render(); });

  // (beta.14) mouse and touch (main lets them reach the menu while it's open): a tap chooses (Quit, Restart… still want it
  // held, as A does), a tap on a prompt along the bottom does what it says, a tap beside the panel or a right-click is B.
  // The pointer shows once the mouse really moves, and hides again on any button.
  let ptr = null, ptrHold = false;
  const itemEls = () => [...$('items').querySelectorAll('.item')];
  addEventListener('pointermove', e => { if (!open || e.pointerType !== 'mouse') return; if (!ptr) { ptr = { x: e.clientX, y: e.clientY }; return; } if (Math.abs(e.clientX - ptr.x) + Math.abs(e.clientY - ptr.y) > 6) document.body.classList.add('pointer'); });
  $('items').addEventListener('pointerdown', e => {
    if (!open || inAch || e.button > 0) return; const i = itemEls().indexOf(e.target.closest('.item')); if (i < 0) return;
    if (i !== sel) { sel = i; cancelHold(); itemEls().forEach((x, j) => x.classList.toggle('sel', j === sel)); cue('tick', { dir: 1 }); }
    if (HOLD.has(items[sel])) { ptrHold = true; press('a', true); }
  });
  const ptrUp = () => { if (ptrHold) { ptrHold = false; if (open && !inAch) press('a', false); } };
  addEventListener('pointerup', ptrUp); addEventListener('pointercancel', ptrUp);
  $('items').addEventListener('click', e => {
    if (!open) return;
    if (inAch) {
      const tb = e.target.closest('[data-tab]'); if (tb) { if (tb.dataset.tab !== achFilter && ach) { achFilter = tb.dataset.tab; achWall(false); cue('tick', { dir: 1 }); } return; }
      const r = e.target.closest('.ach'); if (r && +r.dataset.i !== achSel) { achSel = +r.dataset.i; achSelect(false); cue('tick', { dir: 1 }); } return; }
    const i = itemEls().indexOf(e.target.closest('.item')); if (i >= 0 && i === sel && !HOLD.has(items[sel])) choose(items[sel]);
  });
  $('foot').addEventListener('click', e => { const s = e.target.closest('[data-b]'); if (!s || !open) return; const b = s.dataset.b; if (b === 'a' && !inAch && HOLD.has(items[sel])) return; if (b === 'tabs') { if (inAch && ach) achTab(achFilter === 'locked' ? -2 : 1); return; } press(b, true); if (b === 'a') press('a', false); });
  $('dim').addEventListener('click', () => { if (open) press('b', true); });
  addEventListener('contextmenu', e => { e.preventDefault(); if (open) press('b', true); });

  api.onToast(text => { const t = $('toast'); t.textContent = text; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1800); });
})();
