// Linux build, test 3: PC games without Steam (main/linuxpc.js), the real AppImage on a virtual screen, in a made-up home.
//   xvfb-run -a node linux/ci/pc-test.js <Boxshelf-…-linux.AppImage>
// Heroic set up with legendary: one Epic game installed (legendary's installed.json), signed in, and Heroic's own Wine
// settings for it (a Proton build and a prefix); a pretend legendary (~/.local/bin/legendary: answers launch --json and
// list --json like the real one), a pretend Proton (GE-Proton-Test) and a pretend umu-run that writes down how it was
// started (its arguments, folder and Wine variables), runs 6 s and closes. A Windows program added by hand too.
// Checks: the Epic game is on the PC shelf, Settings sees the Proton build, umu-run and the Epic account; Play starts the
// game through umu-run with legendary's program and sign-in arguments, Heroic's prefix and Proton, STORE=egs; the
// program added by hand gets a prefix of its own; the Epic library is read. Screenshots go to linux-test-out/.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const img = path.resolve(process.argv[2] || '');
const OUT = path.resolve('linux-test-out'); fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || detail == null ? '' : '  -> ' + String(detail).slice(0, 500))); if (!ok) fails++; };

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'bxpc-'));
const mk = (p, body, exec) => { const f = path.join(HOME, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body || ''); if (exec) fs.chmodSync(f, 0o755); return f; };
const gameDir = path.join(HOME, 'Games', 'Heroic', 'Test Epic Game'); mk('Games/Heroic/Test Epic Game/Binaries/Game.exe', 'MZ');
const legDir = path.join(HOME, '.config', 'heroic', 'legendaryConfig', 'legendary');
mk('.config/heroic/legendaryConfig/legendary/installed.json', JSON.stringify({ FakeApp: { app_name: 'FakeApp', title: 'Test Epic Game', install_path: gameDir, executable: 'Binaries/Game.exe', platform: 'Windows', is_dlc: false } }));
mk('.config/heroic/legendaryConfig/legendary/user.json', JSON.stringify({ displayName: 'Tester', account_id: 'x' }));
const proton = path.join(HOME, '.steam', 'root', 'compatibilitytools.d', 'GE-Proton-Test'); mk('.steam/root/compatibilitytools.d/GE-Proton-Test/proton', '#!/bin/sh\nexit 0\n', true);
const heroicPfx = path.join(HOME, 'Games', 'Heroic', 'Prefixes', 'Test Epic Game');
mk('.config/heroic/GamesConfig/FakeApp.json', JSON.stringify({ FakeApp: { winePrefix: heroicPfx, wineVersion: { bin: path.join(proton, 'proton'), type: 'proton', name: 'GE-Proton-Test' }, enviromentOptions: [{ key: 'HEROIC_SET', value: 'yes' }] } }));
const launchJson = JSON.stringify({ game_executable: 'Binaries/Game.exe', game_directory: gameDir, working_directory: path.join(gameDir, 'Binaries'), game_parameters: ['-windowed'], egl_parameters: ['-AUTH_PASSWORD=fake-code', '-epicenv=Prod'], user_parameters: [], environment: { FROM_LEGENDARY: '1' } });
const listJson = JSON.stringify([{ app_name: 'FakeApp', app_title: 'Test Epic Game', metadata: { keyImages: [] } }, { app_name: 'Other', app_title: 'Not Installed Game', metadata: { keyImages: [{ type: 'DieselGameBoxTall', url: 'https://example.com/c.jpg' }] } }]);
mk('.local/bin/legendary', `#!/bin/sh\necho "$LEGENDARY_CONFIG_PATH" > "${HOME}/legendary-config.txt"\ncase "$*" in\n  *launch*--json*) echo '${launchJson}' ;;\n  *list*--json*) echo '${listJson}' ;;\n  *) exit 0 ;;\nesac\n`, true);
const umuOut = path.join(HOME, 'umu-run.txt');
mk('.local/bin/umu-run', `#!/bin/sh\n{ echo "PWD=$PWD"; echo "WINEPREFIX=$WINEPREFIX"; echo "PROTONPATH=$PROTONPATH"; echo "STORE=$STORE"; echo "GAMEID=$GAMEID"; echo "HEROIC_SET=$HEROIC_SET"; echo "FROM_LEGENDARY=$FROM_LEGENDARY"; for a in "$@"; do echo "ARG=$a"; done; } >> "${umuOut}"\necho --- >> "${umuOut}"\nsleep 6\necho x >> "${umuOut}.ended"\nexit 0\n`, true);
const tool = mk('Games/Tools/Tool.exe', 'MZ');
mk('Boxshelf/data/config.json', JSON.stringify({ setupDone: true,
  ui: { bootIntro: 'off', sound: false, music: 'off', startFullscreen: true, openInto: 'last', autoCovers: false, lastSeenVersion: require('../../package.json').version },
  steam: { enabled: false }, pc: { epic: true, quiver: false, custom: [{ id: 'tool', title: 'Test Tool', exe: tool, args: '' }] }, systems: {} }, null, 2));
const ended = () => { try { return fs.readFileSync(umuOut + '.ended', 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } };
// the n-th game has closed, and Boxshelf has had a moment to see it go
const gameOver = async n => { for (let i = 0; i < 40 && ended() < n; i++) await sleep(500); await sleep(1500); return ended() >= n; };
const runs = () => { try { return fs.readFileSync(umuOut, 'utf8').split('---\n').filter(Boolean).map(b => { const o = { args: [] }; for (const l of b.split('\n').filter(Boolean)) { const [k, ...v] = l.split('='); if (k === 'ARG') o.args.push(v.join('=')); else o[k] = v.join('='); } return o; }); } catch { return []; } };

async function cdp(url) {
  const ws = new WebSocket(url); let id = 0; const wait = new Map(), events = [];
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && wait.has(d.id)) { wait.get(d.id)(d); wait.delete(d.id); } else if (d.method) events.push(d); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result && r.result.result.value; };
  return { send, ev, events, close: () => ws.close() };
}
async function pageTarget(port) {
  for (let i = 0; i < 120; i++) { try { const l = await (await fetch('http://127.0.0.1:' + port + '/json')).json(); const t = l.find(x => x.type === 'page' && /index\.html/.test(x.url)); if (t) return t.webSocketDebuggerUrl; } catch {} await sleep(500); }
  throw new Error('the Boxshelf page never came up');
}
const shot = async (p, name) => { try { const r = await p.send('Page.captureScreenshot', { format: 'png' }); if (r.result && r.result.data) fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); } catch {} };

(async () => {
  check('the AppImage exists', fs.existsSync(img), img);
  const env = { ...process.env, HOME, PATH: path.join(HOME, '.local', 'bin') + ':' + process.env.PATH, APPIMAGE_EXTRACT_AND_RUN: '1' };
  delete env.LEGENDARY_CONFIG_PATH;
  const app = spawn(img, ['--no-sandbox', '--remote-debugging-port=9335'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let p;
  try {
    p = await cdp(await pageTarget(9335));
    let ready = false; for (let i = 0; i < 90 && !ready; i++) { ready = await p.ev('!!(window.Shelf && Shelf._qs && Shelf._qs().g)').catch(() => false); if (!ready) await sleep(500); }
    check('Boxshelf reports Linux to the page', (await p.ev('window.bsPlatform && bsPlatform.os')) === 'linux');
    const shelves = await p.ev('window.boxshelf.scan()');
    const pcShelf = (shelves || []).find(s => s.id === 'pc'), custom = (shelves || []).find(s => s.id === 'custom');
    const eg = pcShelf && pcShelf.games.find(g => g.source === 'epic');
    check('the Epic game Heroic installed is on the PC shelf', !!eg && eg.title === 'Test Epic Game', JSON.stringify((shelves || []).map(s => s.id + ':' + (s.games || []).map(g => g.title).join('/'))));
    check('the Windows program added by hand is on the Custom shelf', !!custom && custom.games.some(g => g.title === 'Test Tool'));
    const L = await p.ev('window.boxshelf.pcLinux()');
    check('Settings sees the Proton build, umu-run, legendary and the Epic account (shared with Heroic)', !!L && L.runners.some(r => r.name === 'GE-Proton-Test') && L.umu && L.legendary && L.epicAccount === 'Tester' && L.epicShared === 'heroic', JSON.stringify(L));
    // Play the Epic game
    const r1 = await p.ev(`window.boxshelf.launchPc(${JSON.stringify(eg ? eg.id : '')}).then(r => ({ ok: true, r }), e => ({ error: e.message }))`);
    await sleep(2500); const a = runs()[0] || {};
    check('Play starts the Epic game through umu-run with legendary\'s program and sign-in arguments', !!r1 && r1.ok && a.args && a.args[0] === path.join(gameDir, 'Binaries', 'Game.exe') && a.args.includes('-windowed') && a.args.includes('-AUTH_PASSWORD=fake-code'), JSON.stringify({ r1, a }));
    check('…in Heroic\'s prefix, with Heroic\'s Proton and environment, STORE=egs, from the game\'s folder', a.WINEPREFIX === heroicPfx && a.PROTONPATH === proton && a.STORE === 'egs' && a.HEROIC_SET === 'yes' && a.FROM_LEGENDARY === '1' && a.PWD === path.join(gameDir, 'Binaries'), JSON.stringify(a));
    check('legendary used Heroic\'s folder (same sign-in and installs)', fs.readFileSync(path.join(HOME, 'legendary-config.txt'), 'utf8').trim() === legDir);
    await shot(p, 'pc-1-playing');
    check('the game is over when umu-run exits', await gameOver(1));
    // Play the program added by hand
    const tg = custom && custom.games.find(g => g.title === 'Test Tool');
    const r2 = await p.ev(`window.boxshelf.launchPc(${JSON.stringify(tg ? tg.id : '')}).then(r => ({ ok: true }), e => ({ error: e.message }))`);
    await sleep(2500); const b = runs()[1] || {};
    check('a Windows program added by hand runs through Proton in a prefix of its own', !!r2 && r2.ok && b.args && b.args[0] === tool && b.PROTONPATH === proton && b.WINEPREFIX === path.join(HOME, 'Boxshelf', 'Prefixes', 'custom-tool') && b.STORE === 'none', JSON.stringify({ r2, b }));
    await gameOver(2);
    const lib = await p.ev('window.boxshelf.epicLibrary()');
    check('the Epic library lists owned games, installed or not', !!lib && Array.isArray(lib.games) && lib.games.length === 2 && lib.games.find(g => g.appName === 'FakeApp').installed && !lib.games.find(g => g.appName === 'Other').installed, JSON.stringify(lib));
    // Settings → PC games, and the Epic library page
    await p.ev('window.boxshelf.getConfig().then(inf => { Settings.show(inf, { page: "pc" }); return true; })'); await sleep(2500); await shot(p, 'pc-2-settings');
    const txt = await p.ev('document.body.innerText');
    check('Settings → PC games shows Wine / Proton and the Epic account', /Run Windows games with/.test(txt) && /Signed in as Tester/.test(txt) && !/Show installed GOG games/.test(txt), (txt.match(/PC games[\s\S]{0,600}/) || [''])[0]);
    const errs = p.events.filter(e => e.method === 'Runtime.exceptionThrown').map(e => JSON.stringify(e.params.exceptionDetails).slice(0, 200));
    check('no script errors', !errs.length, errs.slice(0, 3).join(' | '));
  } catch (e) { check('the test ran to the end', false, e && e.stack || e); }
  try { if (p) p.close(); } catch {}
  try { process.kill(-app.pid, 'SIGTERM'); } catch {} await sleep(1500); try { process.kill(-app.pid, 'SIGKILL'); } catch {}
  try { fs.copyFileSync(path.join(HOME, 'Boxshelf', 'data', 'boxshelf.log'), path.join(OUT, 'pc-boxshelf.log')); } catch {}
  console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
  process.exit(fails ? 1 : 0);
})();
