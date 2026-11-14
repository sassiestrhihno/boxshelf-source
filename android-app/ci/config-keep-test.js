// (beta.14) A saved theme, sound and menu music survive a restart. The settings file's upgrade step used to keep only the
// themes / sounds / music it knew before beta.14, so Nebula, Disc-era, a sound pack or Your music went back to Spectrum /
// Aero / Drift every time Boxshelf started. Old names still move to their new ones; junk still falls back.
// node ci/config-keep-test.js   (no Electron)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0; const ok = (c, m, d) => { console.log((c ? '✅ ' : '❌ ') + m + (c || d === undefined ? '' : ' :: ' + String(d).slice(0, 400))); if (!c) fails++; };
try {
  const config = require(path.join(ROOT, 'main', 'config.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-config-keep-'));
  config.init(dir, () => {});
  const start = ui => { const c = config.defaults(); c.setupDone = true; Object.assign(c.ui, ui); fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(c)); return config.load().ui; };
  for (const [theme, sound, music] of [['nebula', 'disc', 'mine'], ['eventhorizon', 'pack:my-wii-menu', 'night'], ['desertnight', 'instrument:piano', 'off'], ['custom-my-room', 'living', 'drift']]) {
    const u = start({ theme, soundTheme: sound, music });
    ok(u.theme === theme && u.soundTheme === sound && u.music === music, `kept after a restart: ${theme} · ${sound} · ${music}`, JSON.stringify([u.theme, u.soundTheme, u.music]));
  }
  const old = start({ theme: 'sunset', soundTheme: 'glass', music: 'calm' });
  ok(old.theme === 'spectrum' && old.soundTheme === 'aero' && old.music === 'drift', 'old names still move to their new ones (Sunset → Spectrum, Glass → Aero, Calm → Drift)', JSON.stringify([old.theme, old.soundTheme, old.music]));
  const junk = start({ theme: '<b>x</b>', soundTheme: '../../evil', music: 42 });
  ok(junk.theme === 'spectrum' && junk.soundTheme === 'aero' && junk.music === 'drift', 'junk falls back to Spectrum / Aero / Drift', JSON.stringify([junk.theme, junk.soundTheme, junk.music]));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
} catch (e) { ok(false, 'config-keep-test ran', e && e.stack); }
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
