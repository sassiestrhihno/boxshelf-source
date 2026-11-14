// (beta.14) IGDB's game info (main/igdb.js), with a pretend fetch: one IGDB question gives a game's screenshots and its info
// (through main/moreshots.js igdbSource); the info only fills gaps (LaunchBox's values are never replaced); it's kept on disk
// and not asked for again (until 30 days have passed); a busy IGDB is asked again next time; the requests keep IGDB's
// limit; the keys are never in an address or a log line. node ci/igdbinfo-test.js
const fs = require('fs'), path = require('path'), os = require('os');
let fails = 0; const ok = (c, m, extra) => { console.log((c ? '✅ ' : '❌ ') + m + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra))); if (!c) fails++; };
const I = require('../../main/igdb'), M = require('../../main/moreshots');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-igdb-'));
const SECRET = 'pretend-secret-123', ID = 'pretend-id-456', TOKEN = 'pretend-token-789';

const logs = []; const log = (...a) => logs.push(a.map(String).join(' '));
const reqs = []; let busy = false;
const answer = {
  'Star Quest': [{ name: 'Star Quest II', screenshots: [{ image_id: 'zz1' }] },
    { name: 'Star Quest', summary: 'A space adventure.', first_release_date: 1000080000, total_rating: 87.4, genres: [{ name: 'Adventure' }, { name: 'Shooter' }],
      involved_companies: [{ developer: true, publisher: false, company: { name: 'Dev Co' } }, { developer: false, publisher: true, company: { name: 'Pub Co' } }],
      franchise: { name: 'Star Saga' }, screenshots: [{ image_id: 'aa1' }, { image_id: 'aa2' }, { image_id: 'bad/../x' }] }],
  'Quiet Game': [{ name: 'Quiet Game', summary: 'Calm.', genres: [{ name: 'Puzzle' }] }],
  'Busy Game': [{ name: 'Busy Game', summary: 'Never seen.' }]
};
const fetch = async (u, o) => {
  reqs.push({ u, body: String(o && o.body || ''), headers: o && o.headers || {}, at: Date.now() });
  if (/id\.twitch\.tv/.test(u)) return { status: 200, ok: true, json: async () => ({ access_token: TOKEN, expires_in: 5000 }) };
  const t = (/search "([^"]+)"/.exec(String(o.body)) || [])[1];
  if (busy && t === 'Busy Game') return { status: 429, ok: false, json: async () => [] };
  return { status: 200, ok: true, json: async () => answer[t] || [] };
};
const match = (L, g) => L.find(x => x.name === g.title) || null;
const keys = () => ({ id: ID, secret: SECRET });
const C = I.client({ keys, fetch, match });
const games = { star: { file: 'C:/roms/Star Quest (USA).iso', title: 'Star Quest' }, quiet: { file: 'C:/roms/Quiet Game.iso', title: 'Quiet Game' }, busy: { file: 'C:/roms/Busy Game.iso', title: 'Busy Game' } };
const igdbAsks = () => reqs.filter(r => /api\.igdb\.com/.test(r.u)).length;

(async () => {
  I.init({ dataDir: root, log });

  // 1. one IGDB question gives both: the screenshots (moreshots' IGDB source) and the info (kept by onFound)
  const src = M.igdbSource({ client: C, onFound: (s, g, r) => I.put(s, g, r.hit), download: async () => 'ok' });
  ok(src.ready() && src.id === 'igdb', 'the screenshots\' IGDB source uses the shared client, ready with both keys');
  const shots = await src.find('gc', games.star);
  ok(shots.length === 2 && shots[0].url === 'https://images.igdb.com/igdb/image/upload/t_screenshot_huge/aa1.jpg' && shots.every(s => s.kind === 'play'), 'the matching game\'s screenshots (a bad image id dropped)', shots);
  const q = reqs.find(r => /api\.igdb\.com\/v4\/games/.test(r.u));
  ok(igdbAsks() === 1 && /screenshots\.image_id/.test(q.body) && /summary/.test(q.body) && /genres\.name/.test(q.body) && /involved_companies\.company\.name/.test(q.body) && /first_release_date/.test(q.body) && /total_rating/.test(q.body) && /platforms = \(21\)/.test(q.body),
    'one query asks for the screenshots and the info together, on the game\'s console', q && q.body);
  const st = I.get('gc', games.star);
  ok(st && st.overview === 'A space adventure.' && st.genres === 'Adventure; Shooter' && st.dev === 'Dev Co' && st.pub === 'Pub Co' && st.release === '2001-09-10' && st.year === 2001 && st.rating === 4.4 && st.series === 'Star Saga',
    'the info from that same answer: description, genres, developer, publisher (by their flags), release date and year, score out of 5, series', st);

  // 2. Details opened for the same game: answered from what's kept, IGDB isn't asked again
  const n1 = igdbAsks(); const again = await I.lookupInfo(C, 'gc', games.star);
  ok(igdbAsks() === n1 && again && again.dev === 'Dev Co' && !I.due('gc', games.star), 'asked again (Details): from what\'s kept, no new IGDB question', { asks: igdbAsks() });

  // 3. the info only fills gaps: LaunchBox's values stay
  const lb = { overview: 'LaunchBox text.', genres: 'Action', dev: '', pub: undefined, year: '2001', rating: 3.9, shots: ['https://images.launchbox-app.com/x.jpg'] };
  const m = I.merge('gc', games.star, lb);
  ok(m.overview === 'LaunchBox text.' && m.genres === 'Action' && m.rating === 3.9 && m.year === '2001' && m.shots.length === 1, 'LaunchBox\'s description, genres, score and year are never replaced', m);
  ok(m.dev === 'Dev Co' && m.pub === 'Pub Co' && m.release === '2001-09-10' && m.series === 'Star Saga', 'the gaps are filled: developer, publisher, release date (it agrees with the year), series', m);
  ok(lb.dev === '' && lb.pub === undefined && !('release' in lb), 'the LaunchBox info itself isn\'t changed (a new object)', lb);
  const other = I.merge('gc', games.star, { year: 1999 });
  ok(other.year === 1999 && !other.release, 'a release date that disagrees with LaunchBox\'s year is left out', other);
  const none = I.merge('gc', games.star, null);
  ok(none && none.overview === 'A space adventure.' && none.year === 2001, 'a game LaunchBox doesn\'t know: all of IGDB\'s info', none);
  const full = { overview: 'a', genres: 'b', dev: 'c', pub: 'd', release: '1999-01-01', rating: 2, series: 'e' };
  ok(I.merge('gc', games.star, full) === full, 'nothing missing: the same info back, untouched');
  ok(I.merge('gc', { file: 'C:/roms/Unknown.iso', title: 'Unknown' }, lb) === lb, 'a game IGDB wasn\'t asked about: its info unchanged');
  ok(I.gaps(lb) && !I.gaps(full) && I.gaps(null), 'gaps: missing developer (or description, genres, release) is worth a look; a full game isn\'t');

  // 4. a game with info only (no screenshots): Details asks; kept; not asked again
  const n2 = igdbAsks(); const qi = await I.lookupInfo(C, 'gc', games.quiet);
  ok(igdbAsks() === n2 + 1 && qi && qi.overview === 'Calm.' && qi.genres === 'Puzzle' && !qi.dev, 'a game without screenshots on IGDB still gets its info (only what IGDB has)', qi);
  const qi2 = await I.lookupInfo(C, 'gc', games.quiet);
  ok(igdbAsks() === n2 + 1 && qi2.overview === 'Calm.', 'and isn\'t asked about again');

  // 5. a busy IGDB: nothing kept, asked again next time
  busy = true; const b0 = igdbAsks(); const bi = await I.lookupInfo(C, 'gc', games.busy);
  ok(igdbAsks() === b0 + 1 && bi === null && I.due('gc', games.busy), 'IGDB busy (429): nothing kept, the game is still due');
  busy = false; const bi2 = await I.lookupInfo(C, 'gc', games.busy);
  ok(igdbAsks() === b0 + 2 && bi2 && bi2.overview === 'Never seen.', 'asked again once IGDB answers', bi2);

  // 6. IGDB's limit: requests one at a time, at least 250 ms apart (4 a second)
  const ig = reqs.filter(r => /api\.igdb\.com/.test(r.u)), gaps = ig.slice(1).map((r, k) => r.at - ig[k].at);
  ok(gaps.length >= 3 && gaps.every(g => g >= 250), 'IGDB\'s requests are spaced out (at most 4 a second)', gaps);

  // 7. kept on disk: a new run has it, without asking; due again after 30 days
  await I.flush(); I.init({ dataDir: root, log }); const n7 = igdbAsks();
  const m7 = I.merge('gc', games.star, {});
  ok(m7.dev === 'Dev Co' && !I.due('gc', games.star) && igdbAsks() === n7 && fs.existsSync(path.join(root, 'igdb-info', 'index.json')), 'after a restart the info is read from igdb-info/index.json, nothing asked', m7);
  const idx = I._t.load(); idx.games[I._t.keyOf('gc', games.star)].at = Date.now() - 31 * 864e5;
  ok(I.due('gc', games.star), 'a month later it is due again');

  // 8. no keys: nothing asked, nothing kept
  const C0 = I.client({ keys: () => ({ id: ID, secret: '' }), fetch, match }); const n8 = reqs.length;
  const r0 = await I.lookupInfo(C0, 'gc', { file: 'C:/roms/Nokeys.iso', title: 'Star Quest' });
  ok(!C0.ready() && r0 === null && reqs.length === n8 && I.due('gc', { file: 'C:/roms/Nokeys.iso', title: 'Star Quest' }), 'without both keys: never asked');

  // 9. the keys stay secret: never in an address, never in a log line; the secret only goes to Twitch
  const inUrl = reqs.some(r => r.u.includes(SECRET) || r.u.includes(TOKEN) || r.u.includes(ID));
  const inLog = logs.some(l => l.includes(SECRET) || l.includes(TOKEN) || l.includes(ID));
  const secretTo = [...new Set(reqs.filter(r => r.body.includes(SECRET)).map(r => new URL(r.u).host))];
  const igHeaders = reqs.filter(r => /api\.igdb\.com/.test(r.u)).every(r => r.headers['Client-ID'] === ID && r.headers.Authorization === 'Bearer ' + TOKEN && !r.body.includes(SECRET));
  ok(!inUrl && !inLog && secretTo.join() === 'id.twitch.tv' && igHeaders, 'keys never in an address or the log; the secret only to Twitch, IGDB gets the Client ID and token in headers', { inUrl, inLog, secretTo });

  // 10. one key per game: a generic file name (default.xex, EBOOT.BIN, game.iso) has its game's folder in it; others as before
  const GK = require('../../main/gamekey'), T = require('../../main/trailers');
  const xa = { file: 'D:/X360/Halo 3/default.xex', title: 'Halo 3' }, xb = { file: 'D:/X360/Gears of War/default.xex', title: 'Gears of War' };
  const pa = { file: 'D:/PS3/Demons Souls [BLUS30443]/PS3_GAME/USRDIR/EBOOT.BIN', title: 'Demon\'s Souls' }, pb = { file: 'D:/PS3/Skate 3/PS3_GAME/USRDIR/EBOOT.BIN', title: 'Skate 3' };
  const na = { file: 'D:/Wii/Metroid Prime [GM8E01]/game.iso', title: 'Metroid Prime' }, nb = { file: 'D:/Wii/Pikmin [GPIE01]/game.iso', title: 'Pikmin' };
  ok(GK.gameKey('x360', xa) !== GK.gameKey('x360', xb) && GK.gameKey('x360', xa) === 'x360|halo 3/default.xex', 'two Xbox 360 default.xex games in different folders: different keys, the folder named', [GK.gameKey('x360', xa), GK.gameKey('x360', xb)]);
  ok(GK.gameKey('ps3', pa) !== GK.gameKey('ps3', pb) && GK.gameKey('ps3', pa) === 'ps3|demons souls [blus30443]/eboot.bin', 'PS3 EBOOT.BIN: the game\'s own folder (past PS3_GAME\\USRDIR)', [GK.gameKey('ps3', pa), GK.gameKey('ps3', pb)]);
  ok(GK.gameKey('gc', na) !== GK.gameKey('gc', nb) && GK.gameKey('gc', { file: 'D:/X360/Halo/DVD1.iso' }) === 'gc|halo/dvd1.iso', 'Nintendont\'s Title [ID]/game.iso and DVD1.iso: by folder');
  ok(GK.gameKey('gc', games.star) === 'gc|star quest (usa).iso' && GK.gameKey('gc', { title: 'No File' }) === 'gc|t:no file', 'a normal game keeps exactly the key it had (what\'s kept stays valid); no file: its title');
  ok(M._t.keyOf('x360', xa) === GK.gameKey('x360', xa) && I._t.keyOf('x360', xa) === GK.gameKey('x360', xa) && T._t.keyOf({ sysId: 'x360', ...xa }) === GK.gameKey('x360', xa) && T._t.keyOf({ sysId: 'gc', ...games.star }) === 'gc|star quest (usa).iso',
    'more screenshots, IGDB info and trailers all use the same key');
  I.put('x360', xa, { name: 'Halo 3', summary: 'Finish the fight.' });
  ok(I.get('x360', xa) && !I.get('x360', xb) && I.due('x360', xb), 'IGDB info for one default.xex game isn\'t given to another');

  // 11. keys Twitch turns down: thrown like busy (nothing kept as "IGDB has nothing"), and Twitch isn't asked again per game
  let tw = 0; const refFetch = async (u, o) => { reqs.push({ u, body: String(o && o.body || ''), headers: o && o.headers || {}, at: Date.now() }); if (/id\.twitch\.tv/.test(u)) { tw++; return { status: 400, ok: false, json: async () => ({}) }; } return { status: 200, ok: true, json: async () => [] }; };
  const CR = I.client({ keys: () => ({ id: 'wrong-id', secret: 'wrong-secret' }), fetch: refFetch, match }), g1 = { file: 'C:/roms/Ref One.iso', title: 'Star Quest' }, g2 = { file: 'C:/roms/Ref Two.iso', title: 'Quiet Game' };
  let threw = null; try { await CR.lookup('gc', g1); } catch (e) { threw = e; }
  ok(threw && threw.refused && !/wrong-/.test(threw.message) && CR.refused(), 'Twitch turns the keys down: the lookup throws (refused, no keys in the message)', threw && threw.message);
  const r2 = await I.lookupInfo(CR, 'gc', g2); const srcR = M.igdbSource({ client: CR, download: async () => 'ok' }); let srcThrew = false; try { await srcR.find('gc', g2); } catch { srcThrew = true; }
  ok(tw === 1 && r2 === null && I.due('gc', g1) && I.due('gc', g2) && srcThrew, 'for ten minutes nothing asks Twitch again (one token request in all), nothing is kept, the screenshots\' source counts it as busy', { tw });
  // IGDB itself turning the token down (401 twice, or 403): refused too
  let tw2 = 0; const f403 = async (u) => { if (/id\.twitch\.tv/.test(u)) { tw2++; return { status: 200, ok: true, json: async () => ({ access_token: 'tok-x', expires_in: 5000 }) }; } return { status: 403, ok: false, json: async () => [] }; };
  const C403 = I.client({ keys: () => ({ id: 'id-403', secret: 's-403' }), fetch: f403, match }); let t403 = null; try { await C403.lookup('gc', g1); } catch (e) { t403 = e; }
  ok(t403 && t403.refused && C403.refused() && tw2 === 1, 'IGDB answering 403: refused, not "nothing found"');
  // the trailers still cope: a refused IGDB gives no videos and remembers nothing
  T.init({ dataDir: root, log, igdb: CR, igMatch: match, plat: I.PLAT }); const tv = await T.igList({ sysId: 'gc', file: 'C:/roms/Ref Three.iso', title: 'Star Quest' });
  ok(Array.isArray(tv) && !tv.length && tw === 1 && !Object.keys(T._t.load().games).length, 'trailers: a refused IGDB gives no videos, remembers nothing, asks Twitch nothing more', { tw });

  // 12. a long description is cut to 1500 characters; overlapping saves and a flush leave a whole index
  const long = I.infoOf({ name: 'Long', summary: ('word ').repeat(800) });
  ok(long.overview.length <= 1500 && long.overview.endsWith('…'), 'a long IGDB description is kept short (1500 characters at most)', long.overview.length);
  for (let k = 0; k < 30; k++) I.put('gc', { file: `C:/roms/Many ${k}.iso`, title: 'Many ' + k }, { name: 'Many', summary: 'S' + k });
  await Promise.all([I.flush(), I.flush()]); I.put('gc', { file: 'C:/roms/Last.iso', title: 'Last' }, { name: 'Last', summary: 'L' }); await I.flush();
  const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'igdb-info', 'index.json'), 'utf8')), left = fs.readdirSync(path.join(root, 'igdb-info')).filter(f => /\.tmp$/.test(f));
  ok(onDisk.games['gc|last.iso'] && onDisk.games['gc|many 29.iso'] && !left.length, 'overlapping writes: the index on disk is whole and no temporary files are left', left);

  // 13. the screenshots' background pass can be limited to IGDB (box art fetching off, IGDB's keys set)
  const asked2 = []; const fake = id => ({ id, ready: () => true, find: async () => { asked2.push(id); return []; }, get: async () => 'missing' });
  M.init({ dataDir: root, log, sources: [fake('lr'), fake('igdb')] });
  await M.background([{ sysId: 'gc', game: { file: 'C:/roms/Only.iso', title: 'Only' }, base: [] }], { gap: 0, only: ['igdb'] });
  ok(asked2.join() === 'igdb', 'background with only: [\'igdb\']: libretro (and ScreenScraper) aren\'t asked', asked2);
  await M.flush();
  ok(!logs.some(l => /wrong-|s-403|tok-x/.test(l)) && !reqs.some(r => /wrong-|s-403|tok-x/.test(r.u)), 'turned-down keys and their tokens: never in a log line or an address');

  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + e.stack); process.exit(1); });
