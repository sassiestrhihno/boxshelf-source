// (beta.14) Better trailers (main/trailers.js), with a pretend ScreenScraper, IGDB and YouTube helper: the order (your choice,
// ScreenScraper's gameplay clip, IGDB's trailer, LaunchBox's link, a YouTube search), the wrong-video guard (a GameCube demo
// disc isn't Billy Hatcher's trailer; a real trailer, even without the subtitle, is), a ScreenScraper clip fetched once and
// never again, the guard's verdict remembered per game, Change trailer's choice winning, and no secret in any kept address,
// IGDB request address or log line. Plain Node: node android-app/ci/trailers-test.js → exits 1 on a failure
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let fails = 0; const ok = (c, m, extra) => { console.log((c ? '✅ ' : '❌ ') + m + (c || extra === undefined ? '' : ' ' + JSON.stringify(extra).slice(0, 400))); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-trailers-'));
const SECRETS = ['pretendPass9', 'pretendDevPass', 'pretend-igdb-secret', 'pretend-token'];
const logs = [], log = (...a) => logs.push(a.join(' '));
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const T = require(path.join(ROOT, 'main', 'trailers.js')), SS = require(path.join(ROOT, 'main', 'screenscraper.js')), Y = require(path.join(ROOT, 'main', 'ytclips.js'));
  const I = require(path.join(ROOT, 'main', 'igdb.js')), previews = require(path.join(ROOT, 'main', 'previews.js'));

  // ---------- 1. the wrong-video guard (ytclips.looksRight) ----------
  const BH = 'Billy Hatcher and the Giant Egg (USA)';
  ok(!Y.looksRight('Nintendo GameCube Interactive Multi-Game Demo Disc - Version 12', BH), 'guard: the GameCube demo disc menu is not Billy Hatcher\'s trailer');
  ok(!Y.looksRight('Billy Hatcher and the Giant Egg and 9 more - Top 10 GameCube games', BH), 'guard: a top 10 that names it is still a compilation');
  ok(Y.looksRight('Billy Hatcher and the Giant Egg - Official Trailer', BH), 'guard: the real trailer is accepted');
  ok(Y.looksRight('Billy Hatcher Trailer (GameCube, 2003)', BH), 'guard: the title without its subtitle is accepted ("Billy Hatcher")');
  ok(Y.looksRight('Zelda: Twilight Princess - E3 trailer', 'The Legend of Zelda: Twilight Princess') && !Y.looksRight('Mario Kart Double Dash trailer', 'The Legend of Zelda: Twilight Princess'), 'guard: a subtitle alone counts; another game doesn\'t');
  ok(Y.looksRight('Every Extend Extra - Trailer', 'Every Extend Extra'), 'guard: a game whose own title has "every" isn\'t taken for a compilation');
  ok(!Y.looksRight('Top 10 GameCube games', 'F-Zero GX') && !Y.looksRight('Top 10 GameCube games', BH), 'guard: "Top 10 GameCube games" is still a compilation');
  ok(Y.looksRight('Pokemon Colosseum Trailer', 'Pokémon Colosseum (USA)') && Y.looksRight('Okami - Launch Trailer', 'Ōkami (USA)'), 'guard: accents don\'t count (Pokémon = Pokemon, Ōkami = Okami)');
  ok(Y.looksRight('Dragon Quest 8 Trailer', 'Dragon Quest VIII: Journey of the Cursed King (USA)') && !Y.looksRight('Dragon Quest 7 Trailer', 'Dragon Quest VIII: Journey of the Cursed King (USA)'), 'guard: Roman numerals are numbers (VIII = 8), and another number is another game');
  ok(!Y.looksRight('Sonic Adventure - Trailer', 'Sonic Adventure 2 (USA)') && Y.looksRight('Sonic Adventure 2 Trailer', 'Sonic Adventure 2 (USA)'), 'guard: a game\'s number counts (Sonic Adventure isn\'t Sonic Adventure 2)');
  ok(Y.looksRight('Splinter Cell Trailer', "Tom Clancy's Splinter Cell (USA)") && Y.looksRight('Colosseum - GameCube trailer', 'Pokemon Colosseum'), 'guard: the part after a possessive or a series name counts ("Splinter Cell")');
  const ranked = Y.rankResults(['aaaaaaaaaaa\tGameCube Demo Disc 2003 - Billy Hatcher, F-Zero GX\t300', 'bbbbbbbbbbb\tBilly Hatcher Trailer\t90'], BH);
  ok(ranked.length === 1 && ranked[0] === 'bbbbbbbbbbb', 'guard: the search passes over a demo disc and takes the subtitle-less trailer', ranked);

  // ---------- 2. the pretend ScreenScraper (the real module, a pretend server) ----------
  const fakeMp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(4000, 7)]);
  const ssReq = []; let ssLookups = 0, ssDownloads = 0, bodyDelay = 0, refuse = false;
  const vidUrl = 'https://neoclone.screenscraper.fr/api2/mediaVideoJeu.php?devid=x&devpassword=pretendDevPass&softname=Boxshelf&ssid=pretendUser&sspassword=pretendPass9&systemeid=13&jeuid=77&media=video-normalized';
  const ssFetch = async u => { ssReq.push(u);
    if (/jeuInfos\.php/.test(u) && refuse) { ssLookups++; return { status: 403, ok: false, text: async () => 'Erreur de login' }; }
    if (/jeuInfos\.php/.test(u)) { ssLookups++; const novid = /romnom=No(\+|%20)Video/.test(u);
      return { status: 200, ok: true, text: async () => JSON.stringify({ response: { jeu: { id: novid ? 78 : 77, medias: [{ type: 'box-2D', region: 'us', url: 'https://neoclone.screenscraper.fr/api2/mediaJeu.php?media=box-2D(us)&sspassword=pretendPass9', format: 'png' }, ...(novid ? [] : [{ type: 'video', parent: 'jeu', url: vidUrl.replace('video-normalized', 'video'), format: 'mp4' }, { type: 'video-normalized', parent: 'jeu', url: vidUrl, format: 'mp4' }])] } } }) }; }
    if (/mediaVideoJeu\.php/.test(u)) { ssDownloads++; const parts = [fakeMp4.subarray(0, 100), fakeMp4.subarray(100)]; let i = 0; // (streamed in two pieces, bodyDelay apart; no content-length)
      return { status: 200, ok: true, headers: { get: () => null }, body: { getReader: () => ({ read: async () => { await wait(bodyDelay); return i < parts.length ? { done: false, value: new Uint8Array(parts[i++]) } : { done: true }; }, cancel: () => {} }) } }; }
    return { status: 404, ok: false, text: async () => '' }; };
  let ssCreds = { user: 'pretendUser', pass: 'pretendPass9', devId: 'pretendDev', devPass: 'pretendDevPass' };
  SS.init({ dataDir: dir, log, creds: () => ssCreds, fetch: ssFetch });

  // ---------- 3. the pretend IGDB (the shared client, a pretend server) and YouTube helper ----------
  const igReq = []; let igVideos = [{ video_id: 'teaserVid01', name: 'Teaser' }, { video_id: 'igdbTrail01', name: 'Launch Trailer' }];
  const igFetch = async (u, o) => { igReq.push([u, o]);
    if (/twitch/.test(u)) return { status: 200, ok: true, json: async () => ({ access_token: 'pretend-token', expires_in: 5000 }) };
    return { status: 200, ok: true, json: async () => [{ name: 'Other Game', videos: [{ video_id: 'otherVid001', name: 'Trailer' }] }, { name: 'Sonic Heroes', videos: igVideos }] }; };
  let igKeys = { id: 'pretend-igdb-id', secret: 'pretend-igdb-secret' };
  const igMatch = (L, g) => L.find(x => x.name === String(g.title).replace(/\s*\(.*?\)/g, '')) || null;
  const igdb = I.client({ keys: () => igKeys, fetch: igFetch, match: igMatch });
  // the YouTube side: clips "made" at once (their files are pretend), titles from a list, a search that finds one trailer
  const kept = new Set(), clipAsks = [], titleAsks = [], titles = { lbDemoDisc1: 'Nintendo GameCube Interactive Multi-Game Demo Disc - Version 12', lbRealOne1: 'Billy Hatcher and the Giant Egg - Official Trailer' };
  let searches = 0;
  const yt = { cached: id => kept.has(id) ? path.join(dir, 'yt', id + '.hd.mp4') : null, gone: () => false,
    clip: async id => { clipAsks.push(id); if (titles[id]) knownTitles[id] = titles[id]; kept.add(id); return path.join(dir, 'yt', id + '.hd.mp4'); }, /* (the clip's helper run tells its title, as streamOf does) */
    titleKnown: id => (Object.prototype.hasOwnProperty.call(knownTitles, id) ? knownTitles[id] : undefined), titleOf: async id => { titleAsks.push(id); const t = titles[id]; if (t) knownTitles[id] = t; return t || null; },
    looksRight: Y.looksRight, searchKnown: (t, s) => searched.has(s + '|' + t) ? 'searchRes01' : undefined, searchList: async () => ['searchRes01'],
    clipFromSearch: async (t, s) => { searches++; searched.add(s + '|' + t); kept.add('searchRes01'); return { id: 'searchRes01', file: path.join(dir, 'yt', 'searchRes01.hd.mp4') }; } };
  const knownTitles = {}, searched = new Set();
  T.init({ dataDir: dir, log, ss: SS, yt, igdb, igMatch, plat: I.PLAT, match: null, discId: null, trim: () => {} });
  const game = (name, x = {}) => ({ sysId: 'gc', file: path.join(dir, 'roms', name + '.iso'), title: name, sysName: 'GameCube', lb: null, clips: true, choice: '', ...x });

  // ---------- 4. ScreenScraper's gameplay clip first, fetched once ----------
  const sonic = game('Sonic Heroes (USA)', { lb: 'lbRealOne1' });
  const q1 = await T.find(sonic, { quick: true });
  ok(q1 === T.NEED && ssLookups === 0, 'order: with a ScreenScraper account, the first quick look asks nothing and says it must look (NEED)', q1);
  const r1 = await T.run(sonic);
  ok(r1 && r1.src === 'ss' && fs.existsSync(r1.file) && r1.file.includes(path.join('previews', 'ss', 'gc')), 'order: ScreenScraper\'s gameplay clip comes first, kept under previews\\ss\\<console>', r1);
  ok(ssLookups === 1 && ssDownloads === 1 && /media=video-normalized/.test(ssReq.find(u => /mediaVideoJeu/.test(u)) || ''), 'ScreenScraper: one lookup, one download, the normalized video chosen over the raw one', { ssLookups, ssDownloads });
  const r1b = await T.find(sonic, { quick: true }), r1c = await T.run(sonic), r1d = await T.run(game('Sonic Heroes (USA)'));
  ok(r1b.src === 'ss' && r1c.src === 'ss' && r1d.src === 'ss' && ssLookups === 1 && ssDownloads === 1 && igReq.length === 0 && !clipAsks.length, 'ScreenScraper: asked again, the kept clip plays: never a second lookup or download, nothing else asked', { ssLookups, ssDownloads });
  const vs = await SS.video('gc', { file: sonic.file, title: sonic.title });
  ok(vs && !SECRETS.some(s => vs.url.includes(s)) && Object.values(SS._t.cacheGet().games).every(v => !SECRETS.some(s => JSON.stringify(v).includes(s))), 'ScreenScraper: the video address is kept without the sign-in', vs);
  const nv = game('No Video (USA)', { lb: 'lbRealOne1' }); await T.run(nv); const l0 = ssLookups; await T.run(nv); await T.find(nv, { quick: true });
  ok(ssLookups === l0, 'ScreenScraper: a game it has no video for is marked and not asked again', { l0, ssLookups });
  // an answer cached before the videos were kept (flag 1) is asked again once, for its video
  const old = { file: path.join(dir, 'roms', 'Old Game.iso'), title: 'Old Game' }; SS._t.cacheGet().games['gc|' + old.file.toLowerCase() + '|0'] = [77, Date.now(), [], 1];
  const l1 = ssLookups; await SS.video('gc', old); await SS.video('gc', old);
  ok(ssLookups === l1 + 1, 'ScreenScraper: an answer cached before the videos were kept is asked again once', { before: l1, after: ssLookups });
  const twin = { file: path.join(dir, 'roms', 'Twin Game.iso'), title: 'Twin Game' }; SS._t.cacheGet().games['gc|' + twin.file.toLowerCase() + '|0'] = [77, Date.now(), [], 1];
  const l2 = ssLookups; const [tv, tsh] = await Promise.all([SS.video('gc', twin), SS.shots('gc', twin)]);
  ok(ssLookups === l2 + 1 && tv && Array.isArray(tsh), 'ScreenScraper: Details\' screenshots and its trailer asking at once share one lookup', { before: l2, after: ssLookups });
  // a game beside the one you're on (low): looked up only; the game on screen downloads it
  const warm = game('Warm Game (USA)'), dl0 = ssDownloads, lk0 = ssLookups, rw = await T.run(warm, { low: true });
  ok(rw === null && ssDownloads === dl0 && ssLookups === lk0 + 1, 'ScreenScraper: a game made ahead (preview:warm) is looked up only, its video not downloaded', { rw, downloads: ssDownloads - dl0, lookups: ssLookups - lk0 });
  const rw2 = await T.run(warm); ok(rw2 && rw2.src === 'ss' && ssDownloads === dl0 + 1 && ssLookups === lk0 + 1, 'ScreenScraper: on screen, the video comes from the kept lookup (no second lookup)', rw2);
  const rg = game('Raise Game (USA)'), pLow = T.run(rg, { low: true }), pNow = T.run(rg), [ra, rb] = await Promise.all([pLow, pNow]);
  ok(rb && rb.src === 'ss' && ra && ra.src === 'ss', 'run: landing on a game while it\'s being made ahead turns that run into a normal one (the clip comes)', { ra, rb });
  const lk1 = ssLookups; await T.run(game('Clips Off Game', { ssClips: false })); ok(ssLookups === lk1, 'ScreenScraper: with Console trailers off nothing is fetched from it');
  // the video streams in after the request's start: the limiter (1 at a time on a free account) is free for other lookups meanwhile
  bodyDelay = 400; let tDl = 0; const pSlow = T.run(game('Slow Game (USA)')).then(r => { tDl = Date.now(); return r; }); await wait(150);
  await SS.video('gc', { file: path.join(dir, 'roms', 'Quick Lookup.iso'), title: 'Quick Lookup' }); const tLook = Date.now(); const rSlow = await pSlow; bodyDelay = 0;
  ok(rSlow && rSlow.src === 'ss' && fs.statSync(rSlow.file).size === fakeMp4.length && tLook < tDl, 'ScreenScraper: a lookup isn\'t held up by a video still coming in; the streamed video is whole', { tLook, tDl });
  // a sign-in ScreenScraper refuses: nothing marked "no clip"
  refuse = true; const rf = game('Refused Game (USA)'); await T.run(rf); refuse = false; SS.credsChanged();
  ok(!fs.existsSync(T._t.ssOut(rf).replace(/\.mp4$/, '.none')), 'ScreenScraper: a refused sign-in marks no game as having no clip');

  // ---------- 5. no ScreenScraper: IGDB's trailer next ----------
  ssCreds = {}; T._t.reset();
  const sonic2 = game('Sonic Heroes (USA)', { file: path.join(dir, 'roms', 'Sonic Heroes v2.iso'), lb: 'lbRealOne1' });
  ok((await T.find(sonic2, { quick: true })) === T.NEED, 'order: no ScreenScraper account, IGDB set up: it must look');
  const r2 = await T.run(sonic2);
  ok(r2 && r2.src === 'igdb' && r2.id === 'igdbTrail01', 'order: IGDB\'s trailer next, a trailer before a teaser', r2);
  const igq = igReq.filter(r => /api\.igdb\.com/.test(r[0])); const body = igq.length ? String(igq[0][1].body) : '';
  ok(/videos\.video_id/.test(body) && /platforms = \(21\)/.test(body) && /videos != null/.test(body), 'IGDB: the game\'s videos asked for on its own platform (GameCube)', body);
  ok(igReq.every(r => !SECRETS.some(s => r[0].includes(s))) && igReq.some(r => /twitch/.test(r[0]) && String(r[1].body).includes('pretend-igdb-secret')), 'IGDB: the secret goes in the token request\'s body, never in an address');
  const n2 = igq.length; const r2b = await T.find(sonic2, { quick: true });
  ok(r2b.src === 'igdb' && r2b.file && igReq.filter(r => /api\.igdb\.com/.test(r[0])).length === n2, 'IGDB: remembered: asked again, the clip plays and IGDB isn\'t asked twice', r2b);

  // ---------- 6. no IGDB: LaunchBox's link, but only when it's this game's ----------
  igKeys = {}; T._t.reset();
  const billy = game(BH, { lb: 'lbDemoDisc1' });
  ok((await T.find(billy, { quick: true })) === T.NEED, 'guard: LaunchBox\'s link whose title isn\'t known yet: it must look');
  const s0 = searches, ta0 = titleAsks.length, r3 = await T.run(billy);
  ok(r3 && r3.src === 'search' && searches === s0 + 1 && titleAsks.length === ta0, 'guard: Billy Hatcher\'s LaunchBox link (a GameCube demo disc) is skipped (its title from the clip\'s own run, no second helper run); the YouTube search plays instead', { r3, titleAsks });
  const ta = titleAsks.length; const r3b = await T.find(billy, { quick: true });
  ok(r3b.src === 'search' && titleAsks.length === ta && (T._t.load().games[T._t.keyOf(billy)].bad || []).some(x => Array.isArray(x) && x[0] === 'lbDemoDisc1' && x[1] > 0), 'guard: the rejection is remembered for the game, with when (it\'s looked at again after 30 days)', r3b);
  // a LaunchBox clip kept from before (title not known): plays at once, its title checked in the background; wrong: not again
  titles.lbLegacy01 = 'Mario Kart Double Dash trailer'; kept.add('lbLegacy01'); const leg = game('Legacy Game (USA)', { lb: 'lbLegacy01' }), ta1 = titleAsks.length;
  const rl = await T.find(leg, { quick: true }); await wait(50); const rl2 = await T.find(leg, { quick: true });
  ok(rl && rl.src === 'lb' && rl.file && titleAsks.length === ta1 + 1 && !(rl2 && rl2.src === 'lb'), 'guard: an older kept LaunchBox clip plays at once, its title checked in the background, and a wrong one isn\'t played again', { rl, rl2 });
  const good = game(BH, { file: path.join(dir, 'roms', 'Billy Hatcher (Europe).iso'), lb: 'lbRealOne1' });
  const r4 = await T.run(good);
  ok(r4 && r4.src === 'lb' && r4.id === 'lbRealOne1', 'order: LaunchBox\'s link when its title names the game', r4);

  // ---------- 7. Change trailer: your choice wins ----------
  ssCreds = { user: 'pretendUser', pass: 'pretendPass9', devId: 'pretendDev', devPass: 'pretendDevPass' }; T._t.reset();
  const mine = game('Sonic Heroes (USA)', { lb: 'lbRealOne1', choice: 'yt:ownPick001' });
  const r5 = await T.run(mine);
  ok(r5 && r5.src === 'yours' && r5.id === 'ownPick001', 'choice: a YouTube video you picked wins over ScreenScraper\'s clip', r5);
  ok((await T.find({ ...mine, choice: 'none' }, { quick: true })).none === true, 'choice: No trailer: none at all');
  const r6 = await T.find({ ...mine, choice: 'ss' }, { quick: true }); ok(r6 && r6.src === 'ss', 'choice: ScreenScraper\'s clip picked: it plays', r6);
  ok(T.parseChoice('https://www.youtube.com/watch?v=abcdefghijk', previews.youtubeId) === 'yt:abcdefghijk' && T.parseChoice('https://youtu.be/abcdefghijk', previews.youtubeId) === 'yt:abcdefghijk'
    && T.parseChoice('abcdefghijk', previews.youtubeId) === 'yt:abcdefghijk' && T.parseChoice('not a link', previews.youtubeId) === null && T.parseChoice('', previews.youtubeId) === '' && T.parseChoice('none') === 'none',
    'choice: a pasted link or id becomes yt:<id>; anything else is refused');
  const ch = await T.choices({ ...game(BH, { lb: 'lbDemoDisc1' }), choice: 'none' });
  ok(ch.cur === 'none' && ch.list.some(c => c.key === 'yt:lbDemoDisc1' && /another video/i.test(c.note)) && ch.list.some(c => c.key === 'yt:searchRes01'), 'Change trailer\'s list: LaunchBox\'s wrong link is marked, the search result is offered', ch);

  // ---------- 8. the real helper's title ask: once per video ----------
  const yd = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-trailers-yt-')); fs.mkdirSync(path.join(yd, 'tools')); fs.writeFileSync(path.join(yd, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'), Buffer.alloc(2e6));
  Y.init({ dataDir: yd, log }); Y._force(true); Y._reset(); let runs = 0;
  Y._setRun(async args => { runs++; return args.includes('--skip-download') ? 'Nintendo GameCube Interactive Multi-Game Demo Disc\n' : ''; });
  const t1 = await Y.titleOf('lbDemoDisc1'), t2 = await Y.titleOf('lbDemoDisc1');
  ok(t1 && t1 === t2 && runs === 1 && Y.titleKnown('lbDemoDisc1') === t1, 'helper: a video\'s title is asked once, then known', { t1, runs });
  Y._setRun(async () => { runs++; throw new Error("Sign in to confirm you're not a bot"); }); const r0b = runs; const b1 = await Y.titleOf('botCheck001'), b2 = await Y.titleOf('botCheck001');
  ok(b1 === null && b2 === null && runs === r0b + 1 && !Y.gone('botCheck001'), 'helper: a title ask that fails (a bot check) isn\'t run again for ten minutes, and the video isn\'t marked gone', { runs: runs - r0b });

  // ---------- 9. nothing secret kept or logged ----------
  await wait(1300);
  const kept1 = fs.existsSync(path.join(dir, 'previews', 'trailers.json')) ? fs.readFileSync(path.join(dir, 'previews', 'trailers.json'), 'utf8') : '';
  ok(kept1 && !SECRETS.some(s => kept1.includes(s)) && !SECRETS.some(s => logs.join('\n').includes(s)), 'no secret in the kept list or any log line', SECRETS.filter(s => logs.join('\n').includes(s)));

  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(yd, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + (e && e.stack || e)); process.exit(1); });
