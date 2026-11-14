// (beta.14, issue #34) A Steam library on a drive that never answers (asleep, unplugged, a lost network share) is left out
// after a few seconds instead of freezing Boxshelf while it reads the libraries. node ci/steam-dead-drive-test.js
const fs = require('fs'), path = require('path'), os = require('os');
let fails = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fails++; };
const S = require('../../main/steam');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-steam-')), st = path.join(root, 'Steam'), lib2 = path.join(root, 'Lib2');
fs.mkdirSync(path.join(st, 'steamapps'), { recursive: true }); fs.mkdirSync(path.join(st, 'userdata'));
fs.mkdirSync(path.join(lib2, 'steamapps', 'common', 'Second Game'), { recursive: true });
const esc = p => p.replace(/\\/g, '\\\\');
fs.writeFileSync(path.join(st, 'steamapps', 'libraryfolders.vdf'), `"libraryfolders"\n{\n "0" { "path" "${esc(st)}" }\n "1" { "path" "${esc(lib2)}" }\n "2" { "path" "Q:\\\\SteamLibrary" }\n}\n`);
const man = (d, id, n) => fs.writeFileSync(path.join(d, 'steamapps', `appmanifest_${id}.acf`), `"AppState"\n{\n "appid" "${id}"\n "name" "${n}"\n "StateFlags" "4"\n "installdir" "${n}"\n}\n`);
man(st, 10, 'First Game'); man(lib2, 20, 'Second Game');
const stat = fs.promises.stat; fs.promises.stat = p => /^Q:/i.test(String(p)) ? new Promise(() => {}) : stat(p); // Q: never answers
(async () => {
  const logs = [], t0 = Date.now(), g = await S.scanSteamSafe(st, { log: m => logs.push(m), timeout: 800 }), ms = Date.now() - t0;
  ok(g.map(x => x.title).join(',') === 'First Game,Second Game', 'the libraries that answer still give their games');
  ok(ms < 3000, `a library that never answers is given up on after the wait (${ms} ms)`);
  ok(logs.some(l => /drive Q: didn't answer/.test(l)) && !logs.some(l => l.includes(root)), 'the log says which drive, without folder names');
  const t1 = Date.now(); await S.scanSteamSafe(st, { log: () => {}, timeout: 800 });
  ok(Date.now() - t1 < 400, 'the next refresh doesn\'t wait for it again');
  ok(S.libraryFolders(st).length === 2, 'the game watcher\'s list skips it too');
  ok(await S.steamAnswers(st, () => {}) === true && await S.steamAnswers('Q:\\Steam', () => {}, 500) === false, 'a Steam folder on a drive that doesn\'t answer is skipped');
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + e.stack); process.exit(1); });
