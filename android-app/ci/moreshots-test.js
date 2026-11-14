// (beta.14) More screenshots for Details (main/moreshots.js), with pretend sources: a game with 2 LaunchBox shots is topped up
// to 6, gameplay before title screens; the same picture from two sources is kept once (same bytes, or the same picture
// re-encoded); a source with nothing leaves the list as it was; a source not set up is never asked; a game already at 6 asks
// nothing; nothing is downloaded twice; the background top-up waits its turn and skips full games. Also ScreenScraper's
// screenshot lookup (main/screenscraper.js shots) on a pretend answer. node ci/moreshots-test.js
const fs = require('fs'), path = require('path'), os = require('os');
let fails = 0; const ok = (c, m, extra) => { console.log((c ? '✅ ' : '❌ ') + m + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra))); if (!c) fails++; };
const M = require('../../main/moreshots');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-shots-'));

// a pretend picture: a PNG header, the "scene" it shows (byte 16) and some filler. Two with the same scene but different
// filler are the same picture saved twice (a different encoding); the pretend decoder draws a 9x8 picture from the scene
const pic = (scene, filler = 0) => { const b = Buffer.alloc(200, filler); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b[16] = scene; return b; };
const decode = async buf => { const s = buf[16], bmp = Buffer.alloc(9 * 8 * 4); for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) { const v = (x * 37 + y * 11 + s * 53 + ((x * s) % 7) * 29) % 256, i = (y * 9 + x) * 4; bmp[i] = bmp[i + 1] = bmp[i + 2] = v; bmp[i + 3] = 255; } return bmp; };
const LB = 'https://images.launchbox-app.com/';
const web = { [LB + 'a1.jpg']: pic(1), [LB + 'a2.jpg']: pic(2), [LB + 'c1.jpg']: pic(30), 'ss:play': pic(3), 'ss:title': pic(4), 'ss:fan': pic(5), 'lr:snap': pic(1, 9) /* LaunchBox's a1, saved again */, 'lr:title': pic(6),
  'ig:1': pic(7), 'ig:2': pic(3) /* ScreenScraper's screenshot, byte for byte */, 'ig:3': pic(8), 'ig:4': pic(10), 'lr2:snap': pic(11), 'lr2:title': pic(12) };
const fetched = []; const fetchBuf = async u => { fetched.push(u); return web[u] || null; };
const asked = { ss: 0, lr: 0, igdb: 0 }, got = [];
const src = (id, on, find) => ({ id, ready: () => on(), find: async (sysId, g) => { asked[id]++; return find(sysId, g); }, get: async (c, dest) => { got.push(c.url); const b = web[c.url]; if (!b) return 'missing'; fs.writeFileSync(dest, b); return 'ok'; } });
let ssOn = true, igOn = true, lrBusy = false;
const games = { a: { file: 'C:/roms/A Game (USA).iso', title: 'A Game' }, b: { file: 'C:/roms/B Game.iso', title: 'B Game' }, c: { file: 'C:/roms/C Game.iso', title: 'C Game' }, d: { file: 'C:/roms/D Game.iso', title: 'D Game' }, e: { file: 'C:/roms/E Game.iso', title: 'E Game' } };
const sources = [
  src('ss', () => ssOn, (s, g) => g === games.a ? [{ url: 'ss:play', kind: 'play' }, { url: 'ss:title', kind: 'title' }, { url: 'ss:fan', kind: 'fan' }] : []),
  src('lr', () => true, (s, g) => { if (lrBusy) throw new Error('no list'); return g === games.a ? [{ url: 'lr:snap', kind: 'play' }, { url: 'lr:title', kind: 'title' }] : g === games.d ? [{ url: 'lr2:snap', kind: 'play' }, { url: 'lr2:title', kind: 'title' }] : []; }),
  src('igdb', () => igOn, (s, g) => g === games.a ? [{ url: 'ig:1', kind: 'play' }, { url: 'ig:2', kind: 'play' }, { url: 'ig:3', kind: 'play' }, { url: 'ig:4', kind: 'play' }] : [])
];
const fileUrl = p => 'bsfile://local/' + encodeURIComponent(p);
const start = () => M.init({ dataDir: root, log: () => {}, sources, decode, fetchBuf, fileUrl });
start();
const base2 = [LB + 'a1.jpg', LB + 'a2.jpg'];

(async () => {
  // the difference hash itself
  const h1 = M._t.dhashOf(await decode(pic(1))), h1b = M._t.dhashOf(await decode(pic(1, 9))), h7 = M._t.dhashOf(await decode(pic(7)));
  ok(/^[0-9a-f]{16}$/.test(h1) && h1 === h1b && M._t.bitsApart(h1, h7) > 8, 'the difference hash: 16 hex digits, the same for one picture saved twice, far apart for another', { h1, h7 });

  // 1. two LaunchBox shots → six: gameplay first (ScreenScraper, libretro, IGDB), then a title screen; duplicates dropped
  ok(M.need('gc', games.a, base2), 'a game with 2 screenshots wants more');
  const L = await M.topUp('gc', games.a, base2);
  const names = L.slice(2).map(u => { const f = decodeURIComponent(u.replace('bsfile://local/', '')); return fs.readFileSync(f)[16]; });
  ok(L.length === 9 && L[0] === base2[0] && L[1] === base2[1], 'topped up towards 10 (every different picture the sources have: 9), the LaunchBox ones first and in place', L);
  ok(names.join() === '3,7,8,10,4,6,5', 'the new ones: ScreenScraper\'s screenshot, then IGDB\'s, then the title screens (gameplay before any title screen)', names);
  ok(got.indexOf('ig:4') < got.indexOf('ss:title') && got.indexOf('lr:title') < got.indexOf('ss:fan'), 'every gameplay shot is fetched before a title screen, and title screens before anything else', got);
  ok(got.includes('lr:snap') && got.includes('ig:2') && !names.includes(1), 'libretro\'s snap (LaunchBox\'s picture saved again) and IGDB\'s copy of ScreenScraper\'s are dropped as duplicates', names);
  ok(fetched.filter(u => u.startsWith(LB)).length === 2, 'the LaunchBox shots were looked at once, to compare', fetched);
  ok(L.slice(2).every(u => u.startsWith('bsfile://local/') && fs.existsSync(decodeURIComponent(u.replace('bsfile://local/', ''))) && decodeURIComponent(u).includes(path.join(root, 'more-shots'))), 'the new ones are saved under more-shots and shown from there', L);

  // 2. asked again: nothing new is looked up or downloaded, the order stays
  const n0 = got.length, a0 = { ...asked }, f0 = fetched.length;
  const L2 = await M.topUp('gc', games.a, base2);
  ok(JSON.stringify(L2) === JSON.stringify(L) && got.length === n0 && JSON.stringify(asked) === JSON.stringify(a0) && fetched.length === f0, 'asked again: the same list, nothing looked up or downloaded again');
  ok(!M.need('gc', games.a, base2), 'a game whose sources all answered needs nothing more');
  // the scan: the saved ones join the LaunchBox list (never twice, even on a list that already has them)
  const mi = M.merge('gc', games.a, { overview: 'x', shots: base2 }), mi2 = M.merge('gc', games.a, mi);
  ok(mi.overview === 'x' && JSON.stringify(mi.shots) === JSON.stringify(L) && JSON.stringify(mi2.shots) === JSON.stringify(L), 'the scan\'s game info gets the saved ones after LaunchBox\'s, once', mi2.shots);
  ok(M.merge('gc', games.b, null) === null && M.merge('gc', games.b, { shots: [] }).shots.length === 0, 'a game with nothing saved: its info unchanged');

  // 3. no source has anything: the list is unchanged, and the sources aren't asked again
  const LB0 = await M.topUp('gc', games.b, [LB + 'b1.jpg']);
  ok(LB0.length === 1 && LB0[0] === LB + 'b1.jpg', 'no source has anything: the list is as it was', LB0);
  const ab = { ...asked }; await M.topUp('gc', games.b, [LB + 'b1.jpg']);
  ok(JSON.stringify(asked) === JSON.stringify(ab) && !M.need('gc', games.b, [LB + 'b1.jpg']), 'and nobody is asked again for it (until a month has passed)');

  // 4. no accounts: ScreenScraper and IGDB are skipped, libretro is still asked
  ssOn = false; igOn = false; const ad = { ...asked };
  const LD = await M.topUp('gc', games.d, [LB + 'd1.jpg', LB + 'd2.jpg']);
  ok(asked.ss === ad.ss && asked.igdb === ad.igdb && asked.lr === ad.lr + 1, 'no ScreenScraper account or IGDB keys: those are never asked; libretro is', { asked, ad });
  ok(LD.length === 4, 'libretro\'s snap and title screen are added', LD);
  ssOn = true; igOn = true;
  ok(M.need('gc', games.d, [LB + 'd1.jpg', LB + 'd2.jpg']), 'set up later: those sources are asked next time');

  // 5. a game already at 10: nothing asked, nothing fetched
  const six = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => LB + 'c' + n + '.jpg'), a6 = { ...asked }, g6 = got.length, f6 = fetched.length;
  const L6 = await M.topUp('gc', games.c, six);
  ok(!M.need('gc', games.c, six) && JSON.stringify(L6) === JSON.stringify(six) && JSON.stringify(asked) === JSON.stringify(a6) && got.length === g6 && fetched.length === f6, 'a game already at 10: nothing asked or fetched');
  // 5b. a game topped up when the aim was 6 (before test.11) is looked at once more, then not again
  const oldIdx = M._t.load(); oldIdx.games['gc|old game.iso'] = { s: [], t: { ss: Date.now(), lr: Date.now(), igdb: Date.now() } };
  const old = { file: 'C:/roms/Old Game.iso', title: 'Old Game' }, ob = [1, 2, 3, 4, 5, 6].map(n => LB + 'o' + n + '.jpg');
  const wasDue = M.need('gc', old, ob); await M.topUp('gc', old, ob);
  ok(wasDue && !M.need('gc', old, ob), 'a game that stopped at the old aim of 6 is asked once more for up to 10, then left alone', { wasDue });

  // 6. a busy source isn't marked as asked
  lrBusy = true; ssOn = false; igOn = false; const ae = asked.lr;
  await M.topUp('gc', games.e, []); ok(asked.lr === ae + 1 && M.need('gc', games.e, []), 'a busy source (no list right now) is asked again next time');
  lrBusy = false;

  // 7. the background: waits its turn before each game that needs a look, skips full games and ones every source answered
  let waits = 0; const eBefore = asked.lr;
  await M.background([{ sysId: 'gc', game: games.c, base: six }, { sysId: 'gc', game: games.b, base: [LB + 'b1.jpg'] }, { sysId: 'gc', game: games.e, base: [] }], { wait: async () => { waits++; }, gap: 0 });
  ok(waits === 1 && asked.lr === eBefore + 1, 'the background top-up waited once, for the one game that needed a look', { waits });
  let stopped = 0; await M.background([{ sysId: 'gc', game: { file: 'C:/roms/F.iso', title: 'F' }, base: [] }], { wait: async () => { stopped++; }, stop: () => true, gap: 0 });
  ok(stopped === 0, 'stopped (a game started): it does nothing');

  // 8. kept on disk: a new run (the next launch) still has them, without asking anyone
  await M.flush(); start(); const a8 = { ...asked }, g8 = got.length;
  const mi8 = M.merge('gc', games.a, { shots: base2 });
  ok(JSON.stringify(mi8.shots) === JSON.stringify(L) && JSON.stringify(asked) === JSON.stringify(a8) && got.length === g8, 'after a restart the saved ones are listed from disk, nothing fetched', mi8.shots);
  ok(!M.need('gc', games.a, mi8.shots), 'and the merged list (with the extra ones in it) counts as full');

  // 9. ScreenScraper's screenshot lookup: one of each type, the best region; an older cached answer without them is asked again
  const SS = require('../../main/screenscraper'); let calls = 0;
  const media = [{ type: 'box-2D', region: 'us', url: 'https://neoclone.screenscraper.fr/api2/mediaJeu.php?media=box-2D(us)', format: 'png' },
    { type: 'ss', region: 'jp', url: 'https://neoclone.screenscraper.fr/api2/mediaJeu.php?media=ss(jp)', format: 'png' }, { type: 'ss', region: 'us', url: 'https://neoclone.screenscraper.fr/api2/mediaJeu.php?media=ss(us)', format: 'png' },
    { type: 'sstitle', region: 'wor', url: 'https://neoclone.screenscraper.fr/api2/mediaJeu.php?media=sstitle(wor)', format: 'jpg' }, { type: 'fanart', region: '', url: 'https://neoclone.screenscraper.fr/api2/mediaJeu.php?media=fanart', format: 'jpg' }];
  SS.init({ dataDir: root, log: () => {}, creds: () => ({ user: 'pretend', pass: 'pretend', devId: 'pretend', devPass: 'pretend' }), fetch: async () => { calls++; return { status: 200, ok: true, text: async () => JSON.stringify({ response: { jeu: { id: 77, medias: media } } }) }; } });
  const sg = { file: path.join(root, 'nothere', 'Some Game.iso'), title: 'Some Game', sizeBytes: 1234 };
  SS._t.cacheGet().games['gc|' + sg.file.toLowerCase() + '|1234'] = [77, Date.now(), [{ type: 'box-2D', region: 'us', url: media[0].url, ext: '.png' }]];
  const sh = await SS.shots('gc', sg);
  ok(calls === 1 && sh.map(x => x.kind).join() === 'play,title' && /ss%28us%29|ss\(us\)/.test(sh[0].url) && sh[1].ext === '.jpg', 'ScreenScraper: an older cached answer is asked again; the screenshot (USA first) and title screen, never fan art (real screenshots only)', sh);
  const sh2 = await SS.shots('gc', sg); const fr = await SS.candidates('gc', sg, 'front');
  ok(calls === 1 && sh2.length === 2 && fr.length === 1 && fr[0].type === 'box-2D', 'asked again: from the cache; the Art Studio\'s front list still has only the box', { calls, fr: fr.length });
  ok(sh.every(x => !/ssid|sspassword|devid|devpassword/i.test(x.url)), 'the media addresses carry no sign-in');
  SS.init({ dataDir: root, log: () => {}, creds: () => ({}) });
  ok((await SS.shots('gc', sg)).length === 0, 'ScreenScraper with no account: nothing');

  // 10. the sources main.js builds: libretro's addresses and IGDB's query (pretend fetch), IGDB without keys not ready
  const lr = M.lrSource({ systems: { gc: 'Nintendo - GameCube' }, index: async () => ['A Game (USA)'], match: (n, g) => n[0], download: async () => 'ok' });
  const lrc = await lr.find('gc', games.a);
  ok(lrc.length === 2 && lrc[0].url === 'https://thumbnails.libretro.com/Nintendo%20-%20GameCube/Named_Snaps/A%20Game%20(USA).png' && lrc[1].url.includes('/Named_Titles/') && lrc[0].kind === 'play' && lrc[1].kind === 'title', 'libretro: the snap and title screen under the cover\'s name', lrc);
  ok((await lr.find('n64', games.a)).length === 0, 'libretro: a console it has no folder for gives nothing');
  const reqs = []; const ig = M.igdbSource({ keys: () => ({ id: 'pretend-id', secret: 'pretend-secret' }), match: (L, g) => L.find(x => x.name === g.title) || null, download: async () => 'ok',
    fetch: async (u, o) => { reqs.push([u, o]); if (/twitch/.test(u)) return { status: 200, ok: true, json: async () => ({ access_token: 'tok', expires_in: 5000 }) }; return { status: 200, ok: true, json: async () => [{ name: 'Other', screenshots: [{ image_id: 'x1' }] }, { name: 'A Game', screenshots: [{ image_id: 'abc' }, { image_id: 'bad/../id' }] }] }; } });
  const igc = await ig.find('gc', games.a);
  ok(igc.length === 1 && igc[0].url === 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/abc.jpg' && /platforms = \(21\)/.test(reqs[1][1].body) && !reqs.some(r => r[0].includes('pretend-secret')), 'IGDB: the matching game\'s screenshots; the secret never in an address', igc);
  ok(!M.igdbSource({ keys: () => ({ id: 'x', secret: '' }) }).ready(), 'IGDB without both keys: not set up');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + e.stack); process.exit(1); });
