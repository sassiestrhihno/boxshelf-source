// Bulk front-cover downloader for PC & Custom games (Steam, SteamGridDB, IGDB, LaunchBox).
// Picks the highest-ranking candidate across connected sources, runs with bounded concurrency,
// streams progress, supports cancellation, and snapshots overwritten files so Undo restores prior state.
const fs = require('fs');
const path = require('path');

let o = { dataDir: '', pccovers: null, log: () => {}, sendProgress: () => {}, onChanged: () => {} };
let state = { running: false, mode: 'missing', done: 0, total: 0, updated: 0, skipped: 0, failed: 0, title: '', canUndo: false, undoCount: 0 };
let cancelled = false;
let jobPromise = null;
let lastEmit = 0;

const normTitle = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const coverDir = () => path.join(o.dataDir, 'pc-covers');
const undoDir = () => path.join(coverDir(), '.undo');
const undoMetaFile = () => path.join(undoDir(), 'meta.json');

function loadUndoMeta() {
  try {
    const j = JSON.parse(fs.readFileSync(undoMetaFile(), 'utf8'));
    if (j && Array.isArray(j.entries) && j.entries.length) return j;
  } catch {}
  return { entries: [] };
}

function syncUndoState() {
  const meta = loadUndoMeta();
  state.canUndo = meta.entries.length > 0;
  state.undoCount = meta.entries.length;
}

function init(opts = {}) {
  o = { ...o, ...opts };
  syncUndoState();
}

function clearUndoDir() {
  try { fs.rmSync(undoDir(), { recursive: true, force: true }); } catch {}
}

function snapshotBefore(id) {
  const existing = o.pccovers && o.pccovers.cover ? o.pccovers.cover(id) : null;
  if (!existing) return { id, prevFile: null, bakFile: null };
  try {
    fs.mkdirSync(undoDir(), { recursive: true });
    const safe = String(id).replace(/[^a-z0-9_-]/gi, '_');
    const bakName = safe + path.extname(existing);
    const bakPath = path.join(undoDir(), bakName);
    fs.copyFileSync(existing, bakPath);
    return { id, prevFile: existing, bakFile: bakPath };
  } catch {
    return { id, prevFile: null, bakFile: null };
  }
}

/**
 * Computes ranking score for a single front-cover candidate, or -1 if ineligible.
 */
function scoreFrontCandidate(it, idx, targetNorm) {
  if (!it || !it.key || it.act) return -1;
  if (it.key === 'current' || it.source === 'yours' || it.source === 'made' || String(it.key).startsWith('gen')) return -1;
  const src = String(it.source || '').toLowerCase();
  const label = String(it.label || ''), sub = String(it.sub || '');
  if (src === 'steamstore') {
    if (sub === "From Steam's store") return 96;
    const m = /^(.+?)\s+on\s+Steam$/i.exec(sub);
    const exact = targetNorm && m && normTitle(m[1]) === targetNorm;
    return exact ? 98 : 52;
  }
  if (src === 'steamgriddb') {
    let score = 97 - idx * 0.35;
    if (/blur|textless|no logo/i.test(label)) score -= 12;
    if (/official|alternate|material/i.test(label)) score += 1.5;
    return score;
  }
  if (src === 'steam') return 92;
  if (src === 'igdb') return 84 - idx * 0.3;
  if (src === 'launchbox') return 78 - idx * 0.4;
  return 60 - idx * 0.3;
}

/**
 * Filters and sorts front-cover candidates descending by score, attaching _score to each entry.
 */
function rankFrontCandidates(list, gameTitle = '') {
  if (!Array.isArray(list) || !list.length) return [];
  const targetNorm = normTitle(gameTitle);
  const scored = [];
  list.forEach((it, idx) => {
    const score = scoreFrontCandidate(it, idx, targetNorm);
    if (score >= 0) scored.push({ ...it, _score: score });
  });
  scored.sort((a, b) => b._score - a._score);
  return scored;
}

/**
 * Picks the single highest-ranking front-cover candidate from a list.
 */
function pickBestFront(list, gameTitle = '') {
  return rankFrontCandidates(list, gameTitle)[0] || null;
}

function emitProgress(force = false) {
  const now = Date.now();
  if (!force && now - lastEmit < 150) return;
  lastEmit = now;
  try { o.sendProgress({ ...state }); } catch {}
}

function bulkState() {
  if (!state.running) syncUndoState();
  return { ...state };
}

function cancelAll() {
  if (!state.running) return false;
  cancelled = true;
  emitProgress(true);
  return true;
}

async function downloadAll(games, opts = {}) {
  if (state.running && jobPromise) return jobPromise;
  const mode = opts.mode === 'all' ? 'all' : 'missing';
  const lookup = typeof opts.lookup === 'function' ? opts.lookup : g => g;
  const seen = new Set(), list = [];
  for (const g of Array.isArray(games) ? games : []) {
    if (!g || !g.id || seen.has(g.id)) continue;
    seen.add(g.id);
    const hasFront = Boolean((g.art && g.art.front) || (o.pccovers && o.pccovers.cover && o.pccovers.cover(g.id)));
    if (mode === 'missing' && hasFront) continue;
    list.push(g);
  }

  cancelled = false;
  lastEmit = 0;
  state = { ...state, running: true, mode, done: 0, total: list.length, updated: 0, skipped: 0, failed: 0, title: '', canUndo: state.canUndo, undoCount: state.undoCount };
  emitProgress(true);

  if (!list.length) {
    state.running = false;
    emitProgress(true);
    return { ...state };
  }

  clearUndoDir();
  syncUndoState();
  const undoEntries = [], updatedIds = [];
  const useFast = Boolean(o.pccovers && typeof o.pccovers.downloadBestFront === 'function');

  jobPromise = (async () => {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(8, list.length) }, async () => {
      while (!cancelled) {
        const i = cursor++;
        if (i >= list.length) break;
        const g = list[i];
        state.title = g.title || g.id;
        emitProgress(false);
        try {
          const req = lookup(g) || { id: g.id, title: g.title, appid: g.appid };
          if (useFast) {
            let snap = null;
            const res = await o.pccovers.downloadBestFront(
              req,
              cands => rankFrontCandidates(cands, g.title),
              () => { snap = snapshotBefore(g.id); }
            );
            if (res) {
              if (snap) undoEntries.push(snap);
              updatedIds.push(g.id);
              state.updated++;
            } else {
              state.skipped++;
            }
          } else {
            const res = await o.pccovers.options(req, 'front');
            if (cancelled) break;
            const best = pickBestFront(res && res.list, g.title);
            if (!best) {
              state.skipped++;
            } else {
              const snap = snapshotBefore(g.id);
              await o.pccovers.use(g.id, best.key, 'front');
              undoEntries.push(snap);
              updatedIds.push(g.id);
              state.updated++;
            }
          }
        } catch (e) {
          state.failed++;
          o.log('PC bulk cover failed for', g.title || g.id, e && e.message);
        }
        state.done++;
        emitProgress(false);
      }
    });
    await Promise.all(workers);

    if (undoEntries.length) {
      try {
        fs.mkdirSync(undoDir(), { recursive: true });
        fs.writeFileSync(undoMetaFile(), JSON.stringify({ at: Date.now(), entries: undoEntries }));
      } catch (e) { o.log('PC bulk undo meta save', e && e.message); }
    }
    syncUndoState();
    state.running = false;
    state.title = '';
    emitProgress(true);
    if (updatedIds.length) {
      try { await o.onChanged(updatedIds); } catch {}
    }
    return { ...state };
  })();

  try { return await jobPromise; } finally { jobPromise = null; }
}

async function undoAll() {
  if (state.running) return { ok: false, restored: 0 };
  const meta = loadUndoMeta();
  if (!meta.entries.length) return { ok: true, restored: 0 };
  const touched = [];
  for (const e of meta.entries) {
    try {
      o.pccovers.reset(e.id, 'front');
      if (e.bakFile && fs.existsSync(e.bakFile)) {
        await o.pccovers.own(e.id, e.bakFile, 'front');
      }
      touched.push(e.id);
    } catch (err) { o.log('PC bulk undo failed for', e.id, err && err.message); }
  }
  clearUndoDir();
  syncUndoState();
  emitProgress(true);
  if (touched.length) {
    try { await o.onChanged(touched); } catch {}
  }
  return { ok: true, restored: touched.length };
}

module.exports = { init, pickBestFront, rankFrontCandidates, downloadAll, cancelAll, undoAll, bulkState };
