// (beta.14) PS3 trophies from RPCS3 (main/rpcs3troph.js), on a pretend RPCS3 with one game's trophy folder: the list with
// grades and pictures, which are earned and when, hidden ones kept hidden, the game found by its own TROPDIR (and an .iso by
// its name); RPCS3's pop-up switch changes only its own line. node ci/rpcs3troph-test.js
const fs = require('fs'), path = require('path'), os = require('os');
let fails = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fails++; };
const T = require('../../main/rpcs3troph');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-rpcs3-')), dir = path.join(root, 'RPCS3'), exe = path.join(dir, 'rpcs3.exe');
const put = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); return f; };
put(exe, 'x');
const cfg = put(path.join(dir, 'config', 'config.yml'), 'Core:\n  PPU Decoder: Recompiler (LLVM)\nMiscellaneous:\n  Automatically start games after boot: true\n  Show trophy popups: false\n  Silence All Logs: false\n');
const NP = 'NPWR01234_00', tdir = path.join(dir, 'dev_hdd0', 'home', '00000001', 'trophy', NP);
put(path.join(tdir, 'TROP.SFM'), `<?xml version="1.0" encoding="utf-8"?><trophyconf version="1.0"><npcommid>${NP}</npcommid><title-name>Sky Ruins &amp; Friends</title-name>
<trophy id="000" hidden="no" ttype="P" pid="-1"><name>Sky King</name><detail>Get every trophy</detail></trophy>
<trophy id="001" hidden="no" ttype="B" pid="000"><name>First flight</name><detail>Finish the first level</detail></trophy>
<trophy id="002" hidden="yes" ttype="G" pid="000"><name>The twist</name><detail>A secret</detail></trophy></trophyconf>`);
put(path.join(tdir, 'TROP001.PNG'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])); put(path.join(tdir, 'ICON0.PNG'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
// TROPUSR.DAT: header, one table (type 6) with three entries; trophy 1 earned at a known time
const head = Buffer.alloc(48); head.writeUInt32BE(0x818F54AD, 0); head.writeUInt32BE(1, 8);
const th = Buffer.alloc(32); th.writeUInt32BE(6, 0); th.writeUInt32BE(0x60, 4); th.writeUInt32BE(3, 12); th.writeBigUInt64BE(80n, 16);
const when = Date.UTC(2026, 10, 9, 20, 0, 0), ent = (id, got) => { const e = Buffer.alloc(0x70); e.writeUInt32BE(6, 0); e.writeUInt32BE(0x60, 4); e.writeUInt32BE(id, 8); e.writeUInt32BE(id, 16); e.writeUInt32BE(got ? 1 : 0, 20); if (got) e.writeBigUInt64BE(BigInt(when + 62135596800000) * 1000n, 32); return e; };
put(path.join(tdir, 'TROPUSR.DAT'), Buffer.concat([head, th, ent(0, false), ent(1, true), ent(2, false)]));
const game = path.join(root, 'Games', 'Sky Ruins', 'PS3_GAME'); put(path.join(game, 'USRDIR', 'EBOOT.BIN'), 'x'); fs.mkdirSync(path.join(game, 'TROPDIR', NP), { recursive: true });
(async () => {
  const url = f => 'bsfile:///' + path.basename(f);
  const p = await T.progress(exe, { title: 'Something else', file: path.join(game, 'USRDIR', 'EBOOT.BIN') }, url);
  ok(p && p.title === 'Sky Ruins & Friends' && p.total === 3 && p.earned === 1 && p.unit === 'trophy', 'found by the game\'s own TROPDIR: 3 trophies, 1 earned');
  const [plat, first, hidden] = p ? p.achievements : [];
  ok(first && first.earned && first.type === 'bronze' && first.badge === 'bsfile:///TROP001.PNG' && first.date && first.date.startsWith('2026-11-09T20:00'), 'an earned trophy: its grade, its own picture and when');
  ok(plat && plat.type === 'platinum' && !plat.earned && hidden && hidden.title === 'Hidden trophy' && !/secret/i.test(hidden.desc), 'the platinum is there; a hidden one stays hidden until earned');
  ok(p && /^Platinum · Gold 0\/1 · Silver 0\/0 · Bronze 1\/1$/.test(p.grades) && p.icon === 'bsfile:///ICON0.PNG', 'the grades line and the game\'s icon');
  const iso = await T.progress(exe, { title: 'Sky Ruins & Friends', file: path.join(root, 'Sky Ruins.iso') }, url);
  ok(iso && iso.id === NP, 'an .iso is matched by its name');
  ok(await T.progress(exe, { title: 'Unknown', file: path.join(root, 'x.iso') }, url) === null, 'a game RPCS3 has nothing for gives nothing');
  ok((await T.status(exe)).popups === false, 'RPCS3\'s pop-ups being off is seen');
  // a game never played: its own pack (TROPDIR\<id>\TROPHY.TRP) gives the whole list, all locked
  const NP2 = 'NPWR05678_00', g2 = path.join(root, 'Games', 'Second', 'PS3_GAME'); put(path.join(g2, 'USRDIR', 'EBOOT.BIN'), 'x');
  const sfm2 = Buffer.from(`<trophyconf><title-name>Second Game</title-name><trophy id="000" hidden="no" ttype="G" pid="-1"><name>Gold one</name><detail>Do it all</detail></trophy><trophy id="001" hidden="no" ttype="B" pid="-1"><name>Bronze one</name><detail>Start</detail></trophy></trophyconf>`);
  const pngA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]), files = [['TROP.SFM', sfm2], ['TROP001.PNG', pngA], ['../evil.PNG', pngA]];
  const th2 = Buffer.alloc(64); th2.writeUInt32BE(0xDCA24D00, 0); th2.writeUInt32BE(1, 4); th2.writeUInt32BE(files.length, 16); th2.writeUInt32BE(64, 20);
  let off = 64 + files.length * 64; const tab = Buffer.alloc(files.length * 64);
  files.forEach(([n, b], i) => { tab.write(n, i * 64, 'latin1'); tab.writeBigUInt64BE(BigInt(off), i * 64 + 32); tab.writeBigUInt64BE(BigInt(b.length), i * 64 + 40); off += b.length; });
  put(path.join(g2, 'TROPDIR', NP2, 'TROPHY.TRP'), Buffer.concat([th2, tab, ...files.map(f => f[1])]));
  const cache = path.join(root, 'cache'), p2 = await T.progress(exe, { title: 'Second Game', file: path.join(g2, 'USRDIR', 'EBOOT.BIN') }, url, cache);
  ok(p2 && p2.total === 2 && p2.earned === 0 && p2.title === 'Second Game' && p2.achievements[1].badge === 'bsfile:///TROP001.PNG', 'a game not played yet shows its whole list from its own pack, all locked, with pictures');
  ok(!fs.existsSync(path.join(root, 'evil.PNG')) && !fs.existsSync(path.join(cache, 'evil.PNG')), 'a name with a path in the pack is skipped');
  const before = fs.readFileSync(cfg, 'utf8'); await T.setPopups(exe, true);
  ok(fs.readFileSync(cfg, 'utf8') === before.replace('Show trophy popups: false', 'Show trophy popups: true') && fs.existsSync(cfg + '.boxshelf-bak') && (await T.status(exe)).popups === true, 'the switch changes only its own line and keeps a copy');
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + e.stack); process.exit(1); });
