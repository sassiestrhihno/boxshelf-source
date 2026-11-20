// Machine translation of game descriptions (Details' "About this game"), for the interface languages other than English.
// The descriptions come from LaunchBox, IGDB and Steam in English; with Settings → Look → "Translate game descriptions" on,
// each one is sent once to Google Translate's free web endpoint and the result is kept in data\translations.json, so a
// game's description is only ever asked for the first time its Details open. Only the description text is sent: no game
// list, no account, nothing about the player. One request at a time, spaced out, with a pause after a refusal.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { net } = require('electron');

let file = null, cache = {}, dirty = false, saveT = null, log = () => {};
let busy = Promise.resolve(), last = 0, pausedUntil = 0;
const GAP = 400;            // ms between two requests
const PAUSE = 10 * 60e3;    // after a refusal (429 / 403): no requests for 10 minutes
const MAX = 4000;           // longest text translated (descriptions are cut to 1500 elsewhere)
const LANGS = { 'pt-BR': 'pt' }; // interface language → Google's code

function init(dataDir, logger) {
  file = path.join(dataDir, 'translations.json'); if (logger) log = logger;
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object') cache = j; } catch {}
}
const key = (lang, text) => lang + ':' + crypto.createHash('sha1').update(text).digest('hex').slice(0, 20);
function save() {
  if (!file) return; clearTimeout(saveT);
  saveT = setTimeout(() => { if (!dirty) return; dirty = false; try { fs.writeFileSync(file, JSON.stringify(cache)); } catch (e) { log('translate: save', e.message); } }, 2000);
}
// split a long text into pieces under n characters, at sentence ends where it can
function pieces(text, n = 1800) {
  if (text.length <= n) return [text];
  const out = []; let cur = '';
  for (const s of text.match(/[^.!?\n]+[.!?\n]*\s*/g) || [text]) {
    if ((cur + s).length > n && cur) { out.push(cur); cur = ''; }
    cur += s.length > n ? s.slice(0, n) : s;
  }
  if (cur) out.push(cur);
  return out;
}
async function ask(text, tl) {
  const wait = last + GAP - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t&tl=' + encodeURIComponent(tl) + '&q=' + encodeURIComponent(text);
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (r.status === 429 || r.status === 403) { pausedUntil = Date.now() + PAUSE; throw new Error('refused (' + r.status + '), pausing'); }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  // [[["tradução","original",...],...], null, "en", ...]: the pieces, then the language it found
  const parts = Array.isArray(j && j[0]) ? j[0].map(p => (Array.isArray(p) && typeof p[0] === 'string') ? p[0] : '').join('') : '';
  return { text: parts, from: typeof j[2] === 'string' ? j[2] : '' };
}
// text → its translation, or null (not needed, not possible right now). Never throws.
function translate(text, lang) {
  const tl = LANGS[lang]; text = String(text || '').trim();
  if (!tl || !text || text.length > MAX || !/[A-Za-z]{3}/.test(text)) return Promise.resolve(null);
  const k = key(lang, text);
  if (Object.prototype.hasOwnProperty.call(cache, k)) return Promise.resolve(cache[k] || null);
  if (Date.now() < pausedUntil) return Promise.resolve(null);
  const job = busy.then(async () => {
    if (Object.prototype.hasOwnProperty.call(cache, k)) return cache[k] || null; // asked twice while queued
    if (Date.now() < pausedUntil) return null;
    try {
      let out = '', from = '';
      for (const p of pieces(text)) { const r = await ask(p, tl); out += r.text; from = from || r.from; }
      // already in that language (a description someone wrote in Portuguese): kept as it is, remembered as "nothing to do"
      const res = from && from.split('-')[0] === tl ? '' : out.trim();
      cache[k] = res; dirty = true; save();
      return res || null;
    } catch (e) { log('translate:', e.message); return null; }
  });
  busy = job.catch(() => {});
  return job;
}
module.exports = { init, translate };
