// (beta.14) "Updates keep your setup", the parts in main/ (updater.js, keepsetup.js, updateflow.js). Plain Node, no real
// network (a local server stands in for GitHub), everything in temp folders. Run from setup-test.js. One line per check.
//   - the release file for this platform, and only from our repos' release download addresses
//   - the download: size / Content-Length / SHA-256 (digest or SHA256SUMS) checked, redirects only to allowed hosts,
//     cancel, nothing half-downloaded left behind
//   - the zip reader (names that climb out refused) and the plan (data\ never, the real exe, only files in the zip)
//   - the helper end to end on this platform (Windows: PowerShell over a pretend app folder, user files and data\ kept,
//     a failing copy puts everything back; Linux: sh swaps the AppImage)
//   - the safety copy (state files only, newest 3 kept), the check after an update, Undo, a half-made change dropped
//   - installs.json and Bring my setup over (with and without extras, {app} paths, the key store on Windows)
//   - backup / restore extra parts, with and without keys
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), zlib = require('zlib'), crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..', '..');
const U = require(path.join(ROOT, 'main', 'updater')), K = require(path.join(ROOT, 'main', 'keepsetup'));
let bad = 0;
const check = (name, ok, detail) => { if (!ok) bad++; console.log(`${ok ? '✅' : '❌'} ${name}${ok ? '' : ' :: ' + String(detail).slice(0, 400)}`); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-keep-'));
const W = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const R = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const REPOS = ['owner-a/boxshelf-beta', 'owner-a/boxshelf-source'];

// a small zip writer (stored and deflated entries), as a release zip would be
const CRC = (() => { if (zlib.crc32) return b => zlib.crc32(b) >>> 0; const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } return b => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
function makeZip(entries) {
  const parts = [], cds = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8'), data = Buffer.from(e.data || ''), comp = e.deflate ? zlib.deflateRawSync(data) : data, crc = CRC(data), m = e.deflate ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(m, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(m, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    cds.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(cds), eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eo]);
}
const sha = b => crypto.createHash('sha256').update(b).digest('hex');

(async () => {
  // ---------- the release file ----------
  {
    const url = (repo, tag, name) => `https://github.com/${repo}/releases/download/${tag}/${name}`, tag = 'v1.82.0-beta.15', v = '1.82.0-beta.15';
    const rel = { tag_name: tag, assets: [
      { name: `Boxshelf-${v}-windows.zip`, size: 123456789, state: 'uploaded', digest: 'sha256:' + 'a'.repeat(64), browser_download_url: url(REPOS[0], tag, `Boxshelf-${v}-windows.zip`) },
      { name: `Boxshelf-${v}-linux.AppImage`, size: 133456789, state: 'uploaded', browser_download_url: url(REPOS[0], tag, `Boxshelf-${v}-linux.AppImage`) },
      { name: 'SHA256SUMS.txt', size: 300, state: 'uploaded', browser_download_url: url(REPOS[0], tag, 'SHA256SUMS.txt') },
      { name: `Boxshelf-${v}-android.apk`, size: 50000000, browser_download_url: url(REPOS[0], tag, `Boxshelf-${v}-android.apk`) }] };
    const w = U.pickAsset(rel, { platform: 'win32', repos: REPOS }), l = U.pickAsset(rel, { platform: 'linux', arch: 'x64', repos: REPOS });
    check('Release file: Windows gets the zip with GitHub\'s SHA-256, Linux the AppImage with SHA256SUMS to check it',
      w && w.name.endsWith('-windows.zip') && w.sha256 === 'a'.repeat(64) && w.version === v && l && l.name.endsWith('.AppImage') && !l.sha256 && /SHA256SUMS/.test(l.sumsUrl), JSON.stringify({ w, l }));
    const evil = JSON.parse(JSON.stringify(rel)); evil.assets[0].browser_download_url = url('someone-else/boxshelf', tag, evil.assets[0].name);
    const http1 = JSON.parse(JSON.stringify(rel)); http1.assets[0].browser_download_url = http1.assets[0].browser_download_url.replace('https:', 'http:');
    const other = JSON.parse(JSON.stringify(rel)); other.assets[0].name = 'Boxshelf-1.82.0-beta.14-windows.zip'; other.assets[0].browser_download_url = url(REPOS[0], tag, other.assets[0].name);
    const host = JSON.parse(JSON.stringify(rel)); host.assets[0].browser_download_url = `https://github.com.example.net/${REPOS[0]}/releases/download/${tag}/${host.assets[0].name}`;
    check('Release file: refused from another repo, over http, from a look-alike host, or named for another version; none for an arm64 Linux',
      !U.pickAsset(evil, { platform: 'win32', repos: REPOS }) && !U.pickAsset(http1, { platform: 'win32', repos: REPOS }) && !U.pickAsset(host, { platform: 'win32', repos: REPOS }) && !U.pickAsset(other, { platform: 'win32', repos: REPOS }) && !U.pickAsset(rel, { platform: 'linux', arch: 'arm64', repos: REPOS }) && !U.pickAsset(rel, { platform: 'darwin', repos: REPOS }));
    check('Release file: SHA256SUMS lines are read (plain and *binary)', U.sumFor(`${'b'.repeat(64)}  Boxshelf-1-windows.zip\n${'c'.repeat(64)} *Boxshelf-1-linux.AppImage\n`, 'Boxshelf-1-linux.AppImage') === 'c'.repeat(64) && U.sumFor('x', 'y') === '');
  }

  // ---------- the download, against a local server ----------
  {
    const body = crypto.randomBytes(300000), good = sha(body);
    const srv = http.createServer((q, r) => {
      const u = q.url;
      if (u === '/ok') { r.writeHead(200, { 'content-length': body.length }); r.end(body); }
      else if (u === '/hop') { r.writeHead(302, { location: '/ok' }); r.end(); }
      else if (u === '/away') { r.writeHead(302, { location: `http://localhost:${srv.address().port}/ok` }); r.end(); }
      else if (u === '/short') { r.writeHead(200, { 'content-length': body.length }); r.write(body.subarray(0, 1000)); r.destroy(); }
      else if (u === '/sums') { r.writeHead(200); r.end(`${good}  Boxshelf-9-linux.AppImage\n`); }
      else if (u === '/slow') { r.writeHead(200, { 'content-length': body.length }); r.write(body.subarray(0, 5000)); setTimeout(() => { try { r.end(body.subarray(5000)); } catch {} }, 3000); }
      else { r.writeHead(404); r.end(); }
    });
    await new Promise(res => srv.listen(0, '127.0.0.1', res));
    const base = `http://127.0.0.1:${srv.address().port}`, o = { hosts: ['127.0.0.1'], testHttp: true, version: 'test' }, dir = path.join(tmp, 'dl');
    const asset = (p, x = {}) => ({ name: 'Boxshelf-9-linux.AppImage', url: base + p, size: body.length, sha256: good, ...x });
    const tryDl = async (a, f, oo = o) => { try { return await U.download(a, path.join(dir, f), oo); } catch (e) { return { err: e.code || e.message }; } };
    let prog = 0; const ok = await tryDl(asset('/hop'), 'a.bin', { ...o, onProgress: (d, t) => { prog = d / t; } });
    check('Download: a redirect within the allowed hosts is followed; size and SHA-256 match; progress reaches 100%', ok.verified && ok.sha256 === good && R(path.join(dir, 'a.bin')) !== null && prog === 1, JSON.stringify(ok));
    const away = await tryDl(asset('/away'), 'b.bin'), real = await tryDl({ ...asset('/ok'), url: 'http://127.0.0.1:1/ok' }, 'r.bin', { version: 'x' });
    check('Download: a redirect to a host that isn\'t GitHub is stopped, and plain http is refused outside tests', away.err === 'not-github' && real.err === 'not-github' && !fs.existsSync(path.join(dir, 'b.bin')), JSON.stringify({ away, real }));
    const wrong = await tryDl(asset('/ok', { sha256: 'd'.repeat(64) }), 'c.bin'), size = await tryDl(asset('/ok', { size: body.length + 5 }), 'd.bin'), short = await tryDl(asset('/short'), 'e.bin');
    const parts = fs.readdirSync(dir).filter(n => n.endsWith('.part'));
    check('Download: a wrong checksum, a size that isn\'t GitHub\'s, or a cut-off download is refused and leaves nothing behind',
      wrong.err === 'hash' && size.err === 'size' && ['size', 'net'].includes(short.err) && !parts.length && !fs.existsSync(path.join(dir, 'c.bin')), JSON.stringify({ wrong, size, short, parts }));
    const sums = await tryDl(asset('/ok', { sha256: '', sumsUrl: base + '/sums' }), 'f.bin'), none = await tryDl(asset('/ok', { sha256: '' }), 'g.bin');
    check('Download: without a digest, SHA256SUMS.txt is used; with neither, the size alone', sums.verified === true && none.verified === false && !none.err, JSON.stringify({ sums, none }));
    const ac = new AbortController(); setTimeout(() => ac.abort(), 400); const cn = await tryDl(asset('/slow'), 'h.bin', { ...o, signal: ac.signal });
    check('Download: Cancel stops it and removes the part file', cn.err === 'canceled' && !fs.readdirSync(dir).some(n => n.startsWith('h.bin')), JSON.stringify(cn));
    srv.close();
  }

  // ---------- the zip and the plan ----------
  const app = path.join(tmp, "app it's here"), stage = path.join(tmp, 'stage');
  const zipFile = path.join(tmp, 'Boxshelf-9-windows.zip');
  fs.writeFileSync(zipFile, makeZip([{ name: 'Boxshelf/', data: '' }, { name: 'Boxshelf/Boxshelf.exe', data: 'MZ new program ' + 'x'.repeat(5000), deflate: true }, { name: 'Boxshelf/Start here.txt', data: 'new start here' },
    { name: 'Boxshelf/licenses/fonts/A.txt', data: 'new licence', deflate: true }, { name: 'Boxshelf/data/config.json', data: '{"setupDone":false}' }]));
  {
    const rel = await U.unzip(zipFile, stage), u = U.unpackedRoot(stage, rel);
    const pairs = U.planWindows({ root: u.root, files: u.files, appRoot: app, realExe: path.join(app, 'Boxshelf 1.82.exe') });
    const dst = pairs.map(p => path.relative(app, p[1]).split(path.sep).join('/')).sort();
    check('Zip: unpacked (stored and deflated); the plan copies only its files, its Boxshelf.exe onto the real exe, never data\\',
      JSON.stringify(dst) === JSON.stringify(['Boxshelf 1.82.exe', 'Start here.txt', 'licenses/fonts/A.txt']) && R(path.join(u.root, 'licenses', 'fonts', 'A.txt')) === 'new licence', JSON.stringify(dst));
    const evil = async names => { const f = path.join(tmp, 'evil.zip'); fs.writeFileSync(f, makeZip(names.map(n => ({ name: n, data: 'x' })))); fs.rmSync(path.join(tmp, 'evil'), { recursive: true, force: true }); try { await U.unzip(f, path.join(tmp, 'evil')); return 'unpacked'; } catch (e) { return e.code; } };
    const e1 = await evil(['Boxshelf/../../outside.txt']), e2 = await evil(['/abs.txt']), e3 = await evil(['C:/Windows/x.txt']), e4 = await evil(['Boxshelf\\..\\x.txt']);
    check('Zip: names that climb out, absolute paths and drive letters are refused before anything is written', [e1, e2, e3, e4].every(x => x === 'zip') && !fs.existsSync(path.join(tmp, 'outside.txt')), JSON.stringify([e1, e2, e3, e4]));
    let noExe = ''; try { U.planWindows({ root: u.root, files: ['Start here.txt'], appRoot: app, realExe: path.join(app, 'B.exe') }); } catch (e) { noExe = e.code; }
    check('Zip: a download without Boxshelf.exe is refused', noExe === 'zip');
    // the same reader on a zip Windows' own tar (bsdtar) makes, as scripts/pack-windows.js does
    const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'bsdtar';
    const src = path.join(tmp, 'tarsrc'); W(path.join(src, 'Boxshelf', 'Boxshelf.exe'), 'MZ' + 'y'.repeat(200000)); W(path.join(src, 'Boxshelf', 'licenses', 'b.txt'), 'b');
    const tz = path.join(tmp, 'tar.zip'), t = spawnSync(tar, ['-a', '-c', '-f', tz, '-C', src, 'Boxshelf'], { encoding: 'utf8' });
    if (!t.error && t.status === 0) { let ok = false, d = ''; try { const out = path.join(tmp, 'tarout'), r2 = await U.unzip(tz, out), u2 = U.unpackedRoot(out, r2); ok = u2.files.sort().join() === 'Boxshelf.exe,licenses/b.txt' && fs.statSync(path.join(u2.root, 'Boxshelf.exe')).size === 200002; d = JSON.stringify(u2.files); } catch (e) { d = e.message; }
      check('Zip: one made by bsdtar (the release\'s packer) is read the same way', ok, d); }
    else console.log('(skipped: no bsdtar here for the packer check)');
  }

  // ---------- the helper, end to end on this platform ----------
  const deadPid = () => { const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }); return +r.stdout; };
  if (process.platform === 'win32') {
    fs.rmSync(app, { recursive: true, force: true });
    W(path.join(app, 'Boxshelf 1.82.exe'), 'MZ old program'); W(path.join(app, 'Start here.txt'), 'old start here'); W(path.join(app, 'data', 'config.json'), '{"setupDone":true,"mine":1}');
    W(path.join(app, 'ROMS', 'gc', 'game.iso'), 'my game'); W(path.join(app, 'themes', 'gc', 'logo.png'), 'my logo'); W(path.join(app, 'licenses', 'only-old.txt'), 'kept'); W(path.join(app, 'Dolphin', 'Dolphin.exe'), 'emu');
    const rel = await U.unzip(zipFile, path.join(tmp, 'stage2')), u = U.unpackedRoot(path.join(tmp, 'stage2'), rel);
    const pairs = U.planWindows({ root: u.root, files: u.files, appRoot: app, realExe: path.join(app, 'Boxshelf 1.82.exe') });
    const result = path.join(app, 'data', 'update', 'result.json'), logf = path.join(app, 'data', 'update', 'helper.log');
    const run = (o, name) => { const f = path.join(tmp, name + '.ps1'); fs.writeFileSync(f, '\ufeff' + U.windowsScript(o), 'utf8'); return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8', timeout: 60000 }); };
    const r1 = run({ kind: 'update', from: '1.82.0-beta.14', to: '1.82.0-beta.15', pairs, keepDir: path.join(tmp, 'keep1'), waitPid: deadPid(), start: null, resultFile: result, logFile: logf }, 'h1');
    const res1 = JSON.parse(R(result) || '{}');
    check('Helper (Windows): copies the new program and files over the folder; data\\, games, themes, emulators and files not in the zip stay as they were',
      R(path.join(app, 'Boxshelf 1.82.exe')).startsWith('MZ new program') && R(path.join(app, 'Start here.txt')) === 'new start here' && R(path.join(app, 'licenses', 'fonts', 'A.txt')) === 'new licence'
        && R(path.join(app, 'data', 'config.json')) === '{"setupDone":true,"mine":1}' && R(path.join(app, 'ROMS', 'gc', 'game.iso')) === 'my game' && R(path.join(app, 'themes', 'gc', 'logo.png')) === 'my logo' && R(path.join(app, 'licenses', 'only-old.txt')) === 'kept' && R(path.join(app, 'Dolphin', 'Dolphin.exe')) === 'emu'
        && res1.ok === true && res1.to === '1.82.0-beta.15', JSON.stringify({ status: r1.status, err: (r1.stderr || '').slice(0, 300), res1 }));
    // a copy that can't be done: everything already copied goes back, the old program stays runnable
    W(path.join(app, 'Boxshelf 1.82.exe'), 'MZ old program'); fs.mkdirSync(path.join(app, 'blocked.txt'), { recursive: true });
    const r2 = run({ kind: 'update', from: '1.82.0-beta.14', to: '1.82.0-beta.15', pairs: [...pairs, [path.join(u.root, 'Start here.txt'), path.join(app, 'blocked.txt')]], keepDir: path.join(tmp, 'keep2'), waitPid: deadPid(), retries: 1, start: null, resultFile: result, logFile: logf }, 'h2');
    const res2 = JSON.parse(R(result) || '{}');
    check('Helper (Windows): when a copy fails, every file already replaced is put back (the old Boxshelf still runs) and the error is written for the next start',
      res2.ok === false && !!res2.error && R(path.join(app, 'Boxshelf 1.82.exe')) === 'MZ old program' && R(path.join(app, 'Start here.txt')) === 'new start here', JSON.stringify({ status: r2.status, res2, exe: R(path.join(app, 'Boxshelf 1.82.exe')) }));
    // it waits for Boxshelf to close
    const busy = spawn(process.execPath, ['-e', 'setTimeout(()=>{},2500)']); const t0 = Date.now();
    run({ kind: 'restart', from: 'a', to: 'a', pairs: [], keepDir: path.join(tmp, 'keep3'), waitPid: busy.pid, start: null, resultFile: result, logFile: logf }, 'h3');
    check('Helper (Windows): waits for Boxshelf\'s process to end first', Date.now() - t0 >= 2000, Date.now() - t0);
    // started the way Boxshelf starts it (on its own, hidden), it runs to the end
    const lr = path.join(tmp, 'launch', 'r.json'); W(path.join(tmp, 'launch', 'src.txt'), 'new'); W(path.join(tmp, 'launch', 'dst.txt'), 'old');
    U.launch(U.windowsScript({ kind: 'restart', from: '1', to: '1', pairs: [[path.join(tmp, 'launch', 'src.txt'), path.join(tmp, 'launch', 'dst.txt')]], keepDir: path.join(tmp, 'launch', 'keep'), waitPid: deadPid(), start: null, resultFile: lr, logFile: path.join(tmp, 'launch', 'l.log') }), { tempDir: path.join(tmp, 'launch') });
    for (let i = 0; i < 60 && !R(lr); i++) await new Promise(r => setTimeout(r, 250));
    check('Helper (Windows): started on its own (as Boxshelf starts it, hidden), it runs and writes its result', R(path.join(tmp, 'launch', 'dst.txt')) === 'new' && /"ok":true/.test(R(lr) || ''), R(lr));
  } else if (process.platform === 'linux') {
    const d = path.join(tmp, 'img'); W(path.join(d, 'Boxshelf.AppImage'), 'old'); W(path.join(d, '.Boxshelf-9.AppImage.new'), '\x7fELF new');
    const result = path.join(tmp, 'res.json'), f = path.join(tmp, 'h.sh');
    fs.writeFileSync(f, U.linuxScript({ kind: 'update', from: '1.0', to: '9', waitPid: deadPid(), staged: path.join(d, '.Boxshelf-9.AppImage.new'), target: path.join(d, 'Boxshelf.AppImage'), relaunch: false, resultFile: result, logFile: path.join(tmp, 'h.log') }));
    const r = spawnSync('/bin/sh', [f], { encoding: 'utf8', timeout: 30000 }), res = JSON.parse(R(result) || '{}');
    check('Helper (Linux): the new AppImage replaces the old one (made executable) and the result is written', R(path.join(d, 'Boxshelf.AppImage')) === '\x7fELF new' && (fs.statSync(path.join(d, 'Boxshelf.AppImage')).mode & 0o111) && res.ok === true, JSON.stringify({ status: r.status, res, err: r.stderr }));
  }
  {
    const s = U.windowsScript({ kind: 'update', from: '1', to: '2', pairs: [["C:\\a it's\\x.exe", "D:\\b's\\y.exe"]], keepDir: 'C:\\k', waitPid: 12, stubPid: 34, stubExe: "D:\\b's\\y.exe", start: { exe: "D:\\b's\\y.exe" }, resultFile: 'C:\\r.json', logFile: 'C:\\l.log' });
    const l = U.linuxScript({ kind: 'update', from: '1', to: "2'; rm -rf /", waitPid: 5, staged: "/t/it's new", target: '/t/B.AppImage', relaunch: true, resultFile: '/t/r', logFile: '/t/l' });
    check('Helper scripts: quotes in paths are escaped, a bad version never reaches the script, and neither script deletes your files',
      s.includes("'C:\\a it''s\\x.exe'") && !/Remove-Item|rmdir|\bdel\b/i.test(s) && l.includes("'/t/it'\\''s new'") && !l.includes('rm -rf /') && !/rm -r/.test(l), s.slice(0, 200));
  }

  // ---------- the safety copy ----------
  const data = path.join(tmp, 'A', 'data'), appA = path.join(tmp, 'A');
  W(path.join(data, 'config.json'), JSON.stringify({ setupDone: true, ui: { favorites: ['x'] }, systems: { gc: { emulator: '{app}\\Dolphin\\Dolphin.exe' } }, keysEnc: { fanart: 'c2VhbGVk' } }));
  W(path.join(data, 'history.json'), '{"gc:a":{"count":3}}'); W(path.join(data, 'art-provenance.json'), '{"a":1}'); W(path.join(data, 'companion.json'), '{"phones":[1]}');
  W(path.join(data, 'thumbs', 't1.jpg'), 'x'.repeat(2048)); W(path.join(data, 'library-cache.json'), '{}'); W(path.join(data, 'boxshelf.log'), 'log'); W(path.join(data, 'Local State'), '{"os_crypt":{}}');
  W(path.join(appA, 'sounds', 'pack1', 'pack.json'), '{"name":"Pack"}'); W(path.join(appA, 'sounds', 'pack1', 'move.wav'), 'RIFF'); W(path.join(appA, 'Custom themes', 'th1', 'theme.json'), '{"name":"Mine"}');
  {
    for (let i = 1; i <= 4; i++) K.safetyCopy({ dataDir: data, appRoot: appA, version: `1.82.0-beta.1${i}`, now: 1000 * i });
    const L = K.safetyList(data), m = L[0], names = m.files.map(f => f.p).sort();
    check('Safety copy: the state files and pack / theme definitions only (no caches, log or Chromium files); the newest 3 are kept',
      L.length === 3 && m.version === '1.82.0-beta.14' && JSON.stringify(names) === JSON.stringify(['app/Custom themes/th1/theme.json', 'app/sounds/pack1/pack.json', 'data/art-provenance.json', 'data/companion.json', 'data/config.json', 'data/history.json'])
        && !fs.existsSync(path.join(data, 'backups', '1.82.0-beta.11')), JSON.stringify({ n: L.length, names }));
    // the first start of the next version: a damaged config.json is put back at once, a missing file is listed
    const goodCfg = R(path.join(data, 'config.json')); W(path.join(data, 'config.json'), '{"setupDone":tr'); fs.rmSync(path.join(data, 'art-provenance.json'));
    const c1 = K.checkAfterUpdate({ dataDir: data, appRoot: appA, version: '1.82.0-beta.15' }), c2 = K.checkAfterUpdate({ dataDir: data, appRoot: appA, version: '1.82.0-beta.15' });
    check('After an update: a damaged settings file is put back from the safety copy, anything else missing is listed (once)',
      c1 && c1.fixedConfig && R(path.join(data, 'config.json')) === goodCfg && JSON.stringify(c1.problems) === '["data/art-provenance.json"]' && c2 === null, JSON.stringify({ c1, c2 }));
    // Undo: the safety copy comes back at the next start
    W(path.join(data, 'history.json'), '{}');
    K.stageUndo({ dataDir: data }); const before = R(path.join(data, 'history.json')); const p = K.applyPending({ dataDir: data, appRoot: appA });
    check('Undo the update\'s settings changes: staged, then put in at the next start (history and picks back), nothing left waiting',
      before === '{}' && p && p.kind === 'undo' && R(path.join(data, 'history.json')) === '{"gc:a":{"count":3}}' && R(path.join(data, 'art-provenance.json')) === '{"a":1}' && !fs.existsSync(K.pendingDir(data)), JSON.stringify(p));
    K.pendingBegin(data); W(path.join(K.pendingDir(data), 'data', 'history.json'), 'HALF'); const half = K.applyPending({ dataDir: data, appRoot: appA });
    check('A change that was only half made (Boxshelf closed while copying) is dropped, not applied', half === null && R(path.join(data, 'history.json')) === '{"gc:a":{"count":3}}' && !fs.existsSync(K.pendingDir(data)));
  }

  // ---------- installs.json and Bring my setup over ----------
  {
    const reg = K.registryFile(path.join(tmp, 'appdata'), 'win32'), regL = K.registryFile('/home/x/.config', 'linux');
    const dataB = path.join(tmp, 'B', 'data'), appB = path.join(tmp, 'B'); W(path.join(dataB, 'config.json'), '{"setupDone":false,"ui":{},"systems":{}}');
    K.noteRun(reg, { dataDir: data, appRoot: appA, version: '1.82.0-beta.14', setupDone: true, now: 1000 });
    K.noteRun(reg, { dataDir: dataB, appRoot: appB, version: '1.82.0-beta.15', setupDone: false, now: 2000 });
    for (let i = 0; i < 9; i++) K.noteRun(reg, { dataDir: path.join(tmp, 'Z' + i, 'data'), appRoot: path.join(tmp, 'Z' + i), version: '1', now: 100 + i });
    const L = K.readRegistry(reg), keysOf = Object.keys(JSON.parse(R(reg)).installs[0]).sort().join();
    check('installs.json: one line per Boxshelf (its data folder, folder, version, last run, setup done), newest first, at most 8',
      L.length === 8 && L[0].dataDir === dataB && L[1].dataDir === data && keysOf === 'appRoot,dataDir,lastRun,setupDone,version' && /[\\/]Boxshelf[\\/]installs\.json$/.test(reg) && /\/boxshelf\/installs\.json$/.test(regL.split(path.sep).join('/')), JSON.stringify({ n: L.length, keysOf }));
    const f1 = K.findOther(reg, { dataDir: dataB }), f2 = K.findOther(reg, { dataDir: data });
    check('A fresh Boxshelf finds the other one\'s finished setup; the finished one finds nothing to take', f1 && f1.dataDir === data && f1.version === '1.82.0-beta.14' && f2 === null, JSON.stringify({ f1, f2 }));
    const from = { dataDir: data, appRoot: appA }, to = { dataDir: dataB, appRoot: appB };
    const ex = await K.extrasSize({ from, to }); let pr = 0;
    const s1 = await K.bringStage({ from, to, extras: false, version: '1.82.0-beta.14', platform: 'win32', onProgress: (d, t) => { pr = d / t; } });
    const pd = K.pendingDir(dataB), staged = R(path.join(pd, 'data', 'config.json'));
    check('Bring my setup over: settings, history, picks, sound packs and custom themes are staged; caches only with extras; {app} points at the old folder; the key store comes along when keys are sealed',
      ex >= 2048 && pr === 1 && staged && !staged.includes('{app}') && JSON.parse(staged).systems.gc.emulator === path.join(appA, 'Dolphin', 'Dolphin.exe') && fs.existsSync(path.join(pd, 'app', 'sounds', 'pack1', 'move.wav')) && fs.existsSync(path.join(pd, 'app', 'Custom themes', 'th1', 'theme.json'))
        && !fs.existsSync(path.join(pd, 'data', 'thumbs')) && !fs.existsSync(path.join(pd, 'data', 'boxshelf.log')) && !!s1.localState && fs.existsSync(s1.localState), JSON.stringify({ ex, pr, s1 }));
    await K.bringStage({ from, to, extras: true, version: '1.82.0-beta.14', platform: 'linux' });
    const s2 = fs.existsSync(path.join(pd, 'data', 'thumbs', 't1.jpg')) && fs.existsSync(path.join(pd, 'data', 'library-cache.json')) && !fs.existsSync(path.join(pd, 'chromium'));
    const ap = K.applyPending({ dataDir: dataB, appRoot: appB }), nc = JSON.parse(R(path.join(dataB, 'config.json')) || '{}');
    check('Bring my setup over with extras: the caches come too; at the next start everything is in place and setup is done',
      s2 && ap && ap.kind === 'bring' && nc.setupDone === true && nc.ui.favorites[0] === 'x' && R(path.join(dataB, 'thumbs', 't1.jpg')) && R(path.join(appB, 'sounds', 'pack1', 'pack.json')) === '{"name":"Pack"}' && R(path.join(dataB, 'history.json')), JSON.stringify(ap));
  }

  // ---------- backup / restore extra parts, with and without keys ----------
  {
    const flow = require(path.join(ROOT, 'main', 'updateflow'));
    flow.init({ app: { getPath: k => (k === 'userData' ? data : path.join(tmp, k)), isPackaged: false, getVersion: () => '1.82.0-beta.15' }, handle: () => {}, log: () => {}, updates: {}, version: '1.82.0-beta.15', appRoot: () => appA, getCfg: () => null, isGameRunning: () => false, flushConfig: () => {}, send: () => {} });
    const cfg = { keys: { fanart: 'FAKE-FANART-KEY', steamgriddb: '' }, ra: { user: 'player', key: 'FAKE-RA-KEY' } };
    const plain = flow.backupExtra(cfg, false), withK = flow.backupExtra(cfg, true);
    const txt = JSON.stringify(plain);
    check('Backup file: picks and pack / theme definitions are in it; without the tick no key, password or paired phone is',
      plain.state.files['art-provenance.json'] && plain.state.defs['sounds/pack1/pack.json'] && plain.state.defs['Custom themes/th1/theme.json'] && !plain.secrets && !plain.state.files['companion.json'] && !/FAKE-/.test(txt), txt.slice(0, 200));
    check('Backup file with "Include keys and passwords": the keys and the RetroAchievements key are in it, and the paired phones',
      withK.keysIncluded && withK.secrets.keys.fanart === 'FAKE-FANART-KEY' && !('steamgriddb' in withK.secrets.keys) && withK.secrets.ra.key === 'FAKE-RA-KEY' && !!withK.state.files['companion.json'], JSON.stringify(withK.secrets));
    // restore on "another PC" (an empty folder): its keys come back only from a file that has them
    const cur = { keys: { fanart: '', steamgriddb: 'MINE' }, ra: { user: '', key: '' } };
    const a = flow.withKeys(cur, { secrets: withK.secrets }), b = flow.withKeys(cur, {}), c = flow.withKeys(cur, { secrets: { keys: { notAKey: 'x', fanart: 5 } } });
    check('Restore with keys: they come back (to be sealed again here), keys you have and the file lacks are kept; without keys nothing changes',
      a.keys.fanart === 'FAKE-FANART-KEY' && a.keys.steamgriddb === 'MINE' && a.ra.key === 'FAKE-RA-KEY' && a.ra.user === 'player' && b === cur && !('notAKey' in c.keys) && c.keys.fanart === '', JSON.stringify({ a, c }));
    const dataC = path.join(tmp, 'C', 'data'), appC = path.join(tmp, 'C'); fs.mkdirSync(path.join(appC, 'sounds', 'pack1'), { recursive: true });
    const st = JSON.parse(JSON.stringify(withK.state)); st.files['../../evil.json'] = { x: 1 }; st.files['config.json'] = { setupDone: false }; st.defs['sounds/../x/pack.json'] = { y: 1 };
    const n = K.stageRestore({ dataDir: dataC, appRoot: appC, state: st, from: '1.82.0-beta.15' }); K.applyPending({ dataDir: dataC, appRoot: appC });
    check('Restore: the picks go in at the next start; a pack definition only where its folder is; odd names and the settings file itself are ignored',
      n === 3 && JSON.parse(R(path.join(dataC, 'art-provenance.json'))).a === 1 && R(path.join(dataC, 'companion.json')) && R(path.join(appC, 'sounds', 'pack1', 'pack.json')) && !fs.existsSync(path.join(appC, 'Custom themes')) && !fs.existsSync(path.join(dataC, 'config.json')) && !fs.existsSync(path.join(tmp, 'evil.json')), n);
  }

  // ---------- the start (updateflow.early): a waiting change put in, a failed update said, installs.json written ----------
  {
    const flow = require(path.join(ROOT, 'main', 'updateflow')), dataE = path.join(tmp, 'E', 'data'), appE = path.join(tmp, 'E'), appData = path.join(tmp, 'appdataE');
    W(path.join(dataE, 'config.json'), '{"setupDone":true,"ui":{},"systems":{}}'); W(path.join(dataE, 'update', 'result.json'), JSON.stringify({ ok: false, kind: 'update', from: '1.82.0-beta.14', to: '1.82.0-beta.15', error: 'The file is in use.' }));
    W(path.join(dataE, 'update', '1.82.0-beta.15', 'files', 'Boxshelf', 'Boxshelf.exe'), 'MZ');
    K.pendingBegin(dataE); W(path.join(K.pendingDir(dataE), 'data', 'history.json'), '{"gc:z":{"count":1}}'); K.pendingCommit(dataE, { kind: 'bring', from: '1.82.0-beta.13' });
    flow.init({ app: { getPath: k => (k === 'userData' ? dataE : k === 'appData' ? appData : path.join(tmp, k)), isPackaged: false }, handle: () => {}, log: () => {}, updates: {}, version: '1.82.0-beta.14', appRoot: () => appE, getCfg: () => null, isGameRunning: () => false, flushConfig: () => {}, send: () => {} });
    const notes = flow.early(), reg = K.readRegistry(K.registryFile(appData));
    check('At start: a setup brought over is put in and said; a failed update is said (you\'re still on the old version); its download is cleared; this Boxshelf is noted in installs.json',
      notes.some(n => /setup from Boxshelf 1\.82\.0-beta\.13 is here/.test(n)) && notes.some(n => /update to Boxshelf 1\.82\.0-beta\.15 didn't finish/.test(n) && /still on 1\.82\.0-beta\.14/.test(n))
        && R(path.join(dataE, 'history.json')) === '{"gc:z":{"count":1}}' && !fs.existsSync(path.join(dataE, 'update', 'result.json')) && !fs.existsSync(path.join(dataE, 'update', '1.82.0-beta.15'))
        && reg.length === 1 && reg[0].dataDir === dataE && reg[0].setupDone === true, JSON.stringify({ notes, reg }));
  }

  // ---------- (beta.14) a Boxshelf from before installs.json: found nearby, or its folder chosen ----------
  {
    const dl = path.join(tmp, 'N', 'Downloads'), desk = path.join(tmp, 'N', 'Desktop');
    const old12 = path.join(dl, 'Boxshelf-1.82.0-beta.12-windows', 'Boxshelf'), old11 = path.join(desk, 'Boxshelf-old'), deep = path.join(dl, 'Stuff', 'Boxshelf');
    const app14 = path.join(dl, 'Boxshelf-1.82.0-beta.14-windows', 'Boxshelf'), data14 = path.join(app14, 'data');
    W(path.join(old12, 'data', 'config.json'), '{"setupDone":true,"ui":{"lastSeenVersion":""},"systems":{}}');
    W(path.join(old11, 'data', 'config.json'), '{"setupDone":true,"ui":{"lastSeenVersion":"1.82.0-beta.11"},"systems":{}}');
    W(path.join(deep, 'data', 'config.json'), '{"setupDone":true,"ui":{},"systems":{}}');
    W(path.join(data14, 'config.json'), '{"setupDone":false,"ui":{},"systems":{}}');
    W(path.join(dl, 'Half', 'data', 'config.json'), '{"setupDone":false,"ui":{},"systems":{}}');
    const t = s => new Date(Date.parse('2026-11-01') + s * 1000);
    fs.utimesSync(path.join(old11, 'data', 'config.json'), t(1), t(1)); fs.utimesSync(path.join(old12, 'data', 'config.json'), t(2), t(2)); fs.utimesSync(path.join(deep, 'data', 'config.json'), t(3), t(3));
    const a1 = K.setupAt(old12), a2 = K.setupAt(path.join(old12, 'data')), a3 = K.setupAt(old11), a4 = K.setupAt(path.join(dl, 'Half')), a5 = K.setupAt('relative\\path');
    check('An old Boxshelf folder: its folder or its data folder both work; the version comes from What\'s new, else the folder\'s name; an unfinished one or an odd path is no setup',
      a1 && a1.dataDir === path.join(old12, 'data') && a1.appRoot === old12 && a1.version === '1.82.0-beta.12' && a2 && a2.appRoot === old12 && a3 && a3.version === '1.82.0-beta.11' && a4 === null && a5 === null, JSON.stringify({ a1, a3 }));
    const n1 = K.findNearby({ dataDir: data14, roots: [path.dirname(app14), path.dirname(path.dirname(app14)), dl, desk] }), n2 = K.findNearby({ dataDir: data14, roots: [desk] }), n3 = K.findNearby({ dataDir: path.join(old12, 'data'), roots: [path.dirname(path.dirname(old12))] });
    check('Found nearby: an unzipped Boxshelf-<version>-windows\\Boxshelf beside this one or on the Desktop (the newest); not inside an unrelated folder; never this one',
      n1 && n1.dataDir === path.join(old12, 'data') && n1.version === '1.82.0-beta.12' && n2 && n2.appRoot === old11 && n3 === null, JSON.stringify({ n1, n2, n3 }));
    const flow = require(path.join(ROOT, 'main', 'updateflow')), H = {}; let pick = '', done = false;
    flow.init({ app: { getPath: k => (k === 'userData' ? data14 : k === 'appData' ? path.join(tmp, 'N', 'appdata') : k === 'downloads' ? dl : k === 'desktop' ? desk : path.join(tmp, 'N', k)), isPackaged: false },
      handle: (n, f) => { H[n] = f; }, log: () => {}, updates: {}, version: '1.82.0-beta.14', appRoot: () => app14, getCfg: () => ({ setupDone: done }), isGameRunning: () => false, flushConfig: () => {}, send: () => {}, pickFolder: async () => pick });
    const f1 = H['bring:find']();
    pick = ''; const c0 = await H['bring:choose']();
    let e1 = '', e2 = ''; pick = path.join(dl, 'Half'); try { await H['bring:choose'](); } catch (e) { e1 = e.message; }
    pick = app14; try { await H['bring:choose'](); } catch (e) { e2 = e.message; }
    pick = path.join(old11, 'data'); const c1 = await H['bring:choose'](), sz = await H['bring:size']();
    done = true; const f2 = H['bring:find'](), c2 = await H['bring:choose']();
    check('Bring my setup over for a beta.13 or older: found without installs.json; choosing a folder: cancel does nothing, one without a finished setup or this one is refused, the old one is taken (and copied from); after setup neither is offered',
      f1 && f1.version === '1.82.0-beta.12' && c0 === null && /no finished Boxshelf setup/.test(e1) && /no finished Boxshelf setup|own folder/.test(e2) && c1 && c1.dataDir === path.join(old11, 'data') && c1.version === '1.82.0-beta.11' && typeof sz === 'number' && f2 === null && c2 === null, JSON.stringify({ f1, c0, e1, e2, c1, f2, c2 }));
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(bad ? `${bad} failed` : 'all passed');
  process.exit(bad ? 1 : 0);
})().catch(e => { console.log('❌ the test ran to the end :: ' + (e && e.stack || e)); process.exit(1); });
