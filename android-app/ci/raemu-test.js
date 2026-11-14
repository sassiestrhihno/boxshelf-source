// (beta.14, issue #28) RetroAchievements sign-in check (main/raemu.js) finds PCSX2's settings in a business OneDrive whose
// Documents folder has its translated name, and in a portable PCSX2. node ci/raemu-test.js
const fs = require('fs'), path = require('path'), os = require('os');
let fails = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fails++; };
const R = require('../../main/raemu');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-ra-')), env = { USERPROFILE: root, APPDATA: path.join(root, 'AppData', 'Roaming'), HOME: root };
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
const exe = put(path.join(root, 'PCSX2', 'pcsx2-qt.exe'), 'x');
const cfg = { ra: { user: 'player' }, systems: { ps2: { emulator: exe } } };
(async () => {
  const ps2 = async () => (await R.check(cfg, { ps2: true }, env)).find(x => x.system === 'ps2');
  ok((await ps2()).state === 'unknown', 'no settings anywhere: unknown');
  put(path.join(root, 'OneDrive - Contoso', 'Dokumente', 'PCSX2', 'inis', 'PCSX2.ini'), '[Achievements]\nEnabled = true\nUsername = player\nToken = abc\n');
  await new Promise(r => setTimeout(r, 10));
  const a = await ps2(); ok(a.state === 'ok' && a.user === 'player' && !JSON.stringify(a).includes('abc'), 'found in a business OneDrive\'s "Dokumente" folder, signed in, no token handed out');
  put(path.join(root, 'PCSX2', 'portable.txt'), ''); put(path.join(root, 'PCSX2', 'inis', 'PCSX2.ini'), '[Achievements]\nEnabled = true\nUsername = player\n');
  ok((await ps2()).state === 'signed-out', 'a portable PCSX2 uses its own folder first (here: not signed in)');
  // (beta.14) RetroArch (one sign-in for every console it runs), DuckStation, an emulator with no achievements, pop-ups off
  const raExe = put(path.join(root, 'RetroArch', 'retroarch.exe'), 'x'), duck = put(path.join(root, 'Duck', 'duckstation-qt-x64-ReleaseLTCG.exe'), 'x'), mel = put(path.join(root, 'melonDS', 'melonDS.exe'), 'x');
  put(path.join(root, 'Duck', 'portable.txt'), ''); put(path.join(root, 'Duck', 'settings.ini'), '[Cheevos]\nEnabled = true\nUsername = player\nToken = t\nNotifications = false\n');
  put(path.join(root, 'RetroArch', 'retroarch.cfg'), 'cheevos_enable = "true"\ncheevos_username = "player"\ncheevos_token = "abc"\n');
  const cfg2 = { ra: { user: 'player' }, systems: { ps2: { emulator: exe }, snes: { emulator: raExe }, n64: { emulator: raExe }, psx: { emulator: duck }, nds: { emulator: mel } } };
  const all = await R.check(cfg2, { ps2: 21, snes: 3, n64: 2, psx: 12, nds: 18, gc: 16 }, env), by = id => all.find(x => x.system === id) || {};
  ok(by('snes').state === 'ok' && by('n64').state === 'ok' && by('snes').emulator === 'RetroArch' && by('snes').exeKey === by('n64').exeKey && by('snes').popups === true, 'RetroArch: signed in once, every console it runs counts, pop-ups on');
  ok(by('psx').state === 'ok' && by('psx').emulator === 'DuckStation' && by('psx').popups === false, 'DuckStation: signed in, and its pop-ups switched off is noticed');
  ok(by('nds').state === 'no-ra', 'an emulator with no RetroAchievements (melonDS) says to use RetroArch');
  ok(by('gc').state === 'no-emulator' && !all.some(x => x.system === 'gba'), 'the usual consoles are always listed; others only once they have an emulator');
  put(path.join(root, 'RetroArch', 'retroarch.cfg'), 'cheevos_enable = "true"\ncheevos_username = "player"\ncheevos_visibility_unlock = "false"\n');
  ok((await R.check(cfg2, { snes: 3 }, env)).find(x => x.system === 'snes').state === 'signed-out', 'RetroArch with no password or token saved: not signed in');
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + e.stack); process.exit(1); });
