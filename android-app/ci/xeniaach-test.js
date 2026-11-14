// (beta.14) Xbox 360 achievements from Xenia (main/xeniaach.js), on a pretend portable Xenia with a made-up achievements
// file: the list, gamerscore, unlock date, the game's name and icon; no profile / no file → nothing; the pop-up switch
// changes only its own line and keeps a copy. node ci/xeniaach-test.js
const fs = require('fs'), path = require('path'), os = require('os');
let fails = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fails++; };
const X = require('../../main/xeniaach');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-xenia-')), dir = path.join(root, 'Xenia Canary'), exe = path.join(dir, 'xenia_canary.exe');
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
put(exe, 'x'); put(path.join(dir, 'portable.txt'), '');
const XUID = 'E0300000AABBCCDD', TID = '4D5307E6';
const cfgText = '[Profiles]\r\nlogged_profile_slot_0_xuid = "' + XUID + '"   \t# XUID\r\n\r\n[UI]\r\nshow_achievement_notification = false             \t# Show achievement notification on screen.\r\n';
const cfgFile = put(path.join(dir, 'xenia-canary.config.toml'), cfgText);
// a small XDBF file: two achievements (one earned), the game's name, its icon
const u16 = s => { const b = Buffer.alloc(s.length * 2 + 2); for (let i = 0; i < s.length; i++) b.writeUInt16BE(s.charCodeAt(i), i * 2); return b; };
const ach = (id, gs, earned, name, d1, d2) => { const h = Buffer.alloc(28); h.writeUInt32BE(28, 0); h.writeUInt32BE(id, 4); h.writeUInt32BE(id + 10, 8); h.writeInt32BE(gs, 12); h.writeUInt32BE(earned ? 0x20009 : 9, 16);
  if (earned) h.writeBigUInt64BE(BigInt(Date.UTC(2026, 10, 10) + 11644473600000) * 10000n, 20); return Buffer.concat([h, u16(name), u16(d1), u16(d2)]); };
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(60, 7)]);
const entries = [[1, 1n, ach(1, 10, true, 'First blood', 'You did it', 'Do the thing')], [1, 2n, ach(2, 40, false, 'Secret ending', 'Got it', 'Keep playing')], [5, 0x8000n, u16('Pretend Racer')], [2, 0x8000n, png]];
const ET = 16, FT = 4, head = Buffer.alloc(24); head.write('XDBF', 0, 'latin1'); head.writeUInt32BE(0x10000, 4); head.writeUInt32BE(ET, 8); head.writeUInt32BE(entries.length, 12); head.writeUInt32BE(FT, 16); head.writeUInt32BE(0, 20);
const table = Buffer.alloc(ET * 18 + FT * 8); let off = 0; const data = [];
entries.forEach(([ns, id, b], i) => { table.writeUInt16BE(ns, i * 18); table.writeBigUInt64BE(id, i * 18 + 2); table.writeUInt32BE(off, i * 18 + 10); table.writeUInt32BE(b.length, i * 18 + 14); data.push(b); off += b.length; });
put(path.join(dir, 'content', XUID, 'FFFE07D1', '00010000', XUID, TID + '.gpd'), Buffer.concat([head, table, ...data]));
(async () => {
  const st = await X.status(exe); ok(st.state === 'ok' && st.popups === false, 'a signed-in profile is seen, and its pop-ups being off');
  const p = await X.progress(exe, TID);
  ok(p && p.total === 2 && p.earned === 1 && p.points === 50 && p.pointsEarned === 10 && p.unit === 'G', 'the list: 2 achievements, 1 unlocked, 10 of 50 G');
  ok(p && p.title === 'Pretend Racer' && /^data:image\/png;base64,/.test(p.icon), 'the game\'s name and icon come from the file');
  ok(p && p.achievements[0].desc === 'You did it' && p.achievements[1].desc === 'Keep playing' && /^2026-11-10/.test(p.achievements[0].date || '') && !p.achievements[1].date, 'unlocked ones show what you did and when; locked ones the hint');
  ok(await X.progress(exe, 'DEADBEEF') === null && await X.progress(exe, '../x') === null, 'a game Xenia has nothing for (or a bad id) gives nothing');
  const r = await X.setPopups(exe, true), after = fs.readFileSync(cfgFile, 'utf8');
  ok(r.changed && after === cfgText.replace('show_achievement_notification = false', 'show_achievement_notification = true') && fs.readFileSync(cfgFile + '.boxshelf-bak', 'utf8') === cfgText, 'the pop-up switch changes only its own line and keeps a copy of the file');
  ok((await X.status(exe)).popups === true && !(await X.setPopups(exe, true)).changed, 'it reads as on now, and switching it on again changes nothing');
  fs.writeFileSync(cfgFile, cfgText.replace(XUID, '')); ok((await X.status(exe)).state === 'signed-out' && await X.progress(exe, TID) === null, 'no profile signed in: says so, and nothing is read');
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + e.stack); process.exit(1); });
