// (beta.14) every build says what's new: the version in package.json (a test build counts as its release, so
// "1.82.0-beta.14-test.4" needs "1.82.0-beta.14") has its notes in renderer/whatsnew.js, complete enough for the card
// after an update, Settings → What's new and the GitHub release (scripts/release-notes.js); the Android app's version too.
// Plain Node, run from setup-test.js. Prints one line per check (✅ / ❌).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const box = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'renderer', 'whatsnew.js'), 'utf8'), box);
const all = box.window.BS_WHATSNEW || [];
const base = v => String(v || '').trim().replace(/^v/, '').replace(/[-.]test\.?\d+$/i, '');
let bad = 0;
const check = (name, ok, detail) => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' :: ' + detail}`); };

const win = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const e = all.find(x => x.version === base(win));
check(`Windows / Linux ${win}: its notes are in renderer/whatsnew.js`, !!e, `add an entry with version '${base(win)}'`);
if (e) {
  check('its notes have a title, 3 to 5 highlights and at least one section with items',
    !!e.title && Array.isArray(e.highlights) && e.highlights.length >= 3 && e.highlights.length <= 5 && (e.sections || []).some(s => s.items && s.items.length),
    JSON.stringify({ title: e.title, highlights: (e.highlights || []).length, sections: (e.sections || []).length }));
  check('it is the newest entry (the list is newest first)', all[0] === e, `first is ${all[0] && all[0].version}`);
  // the card after an update shows the first three, one line each on a TV and the Thor: kept short
  const long = (e.highlights || []).filter(h => h.length > 48);
  check('its highlights are short (48 characters at most, one line on the card)', !long.length, JSON.stringify(long));
}
const andr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
check(`Android ${andr}: its notes are in renderer/whatsnew.js`, all.some(x => x.android && base(x.android) === base(andr)), `add android: '${base(andr)}' to its entry`);
check('every entry has a date and a title, and no version is listed twice',
  all.every(x => x.date && x.title) && new Set(all.map(x => x.version)).size === all.length, JSON.stringify(all.map(x => x.version)));
console.log(bad ? `${bad} failed` : 'all passed');
process.exit(bad ? 1 : 0);
