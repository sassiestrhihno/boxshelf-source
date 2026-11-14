// (beta.14) Update now (Windows and Linux). Downloads this platform's file of a newer Boxshelf from its official GitHub
// release, checks it, and leaves the swap to a small helper that runs after Boxshelf has closed, then starts the new one.
// Nothing here runs by itself: main/updateflow.js calls it when Update now / Restart to update is pressed.
//   The file: Boxshelf-<version>-windows.zip or Boxshelf-<version>-linux.AppImage (scripts/pack-windows.js, release.yml),
//   only from https://github.com/<one of updates.js's repos>/releases/download/..., redirects only to GitHub's own
//   download hosts. Its size must match the release's (and the server's Content-Length), and its SHA-256 the release's
//   digest or SHA256SUMS.txt when GitHub gives one. Anything else is refused and deleted.
//   Windows: the zip (a Boxshelf\ folder: Boxshelf.exe, Start here.txt, licences) is unpacked by the reader below (no
//   "..", no absolute names, sizes capped) into data\update\<version>\files. The helper (PowerShell) waits for Boxshelf to
//   close, copies only the files that are in the zip over the app folder (its Boxshelf.exe onto the real exe,
//   PORTABLE_EXECUTABLE_FILE), never anything under data\, never deletes; each file it replaces is kept first and put
//   back if any copy fails. Then it starts Boxshelf.
//   Linux: the AppImage is downloaded beside the running one (same folder, so the swap is one rename) and made executable;
//   the helper (sh) renames it over the old one and starts it.
//   Either way the helper writes data\update\result.json, which the next start reads (and says if it failed).
'use strict';
const fs = require('fs'), fsp = fs.promises, path = require('path'), crypto = require('crypto'), zlib = require('zlib');
const https = require('https'), http = require('http');
const { Transform } = require('stream'), { pipeline } = require('stream/promises');

const MAX_DOWNLOAD = 700 * 1048576, MAX_ENTRIES = 5000, MAX_UNPACKED = 1500 * 1048576;
const ASSET = { win32: /^Boxshelf-(.+)-windows\.zip$/i, linux: /^Boxshelf-(.+)-linux\.AppImage$/i };
// where GitHub's release downloads are served from (github.com sends them on to one of its own download hosts)
const HOSTS = [/^github\.com$/i, /^([a-z0-9-]+\.)*githubusercontent\.com$/i];
const SAFE_VER = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;

const failure = (code, msg) => Object.assign(new Error(msg), { code });

// a release asset's address: https://github.com/<owner>/<repo>/releases/download/<tag>/<name>, one of our repos
function assetUrlOk(u, repos, tag, name) {
  let x; try { x = new URL(String(u || '')); } catch { return false; }
  if (x.protocol !== 'https:' || x.hostname.toLowerCase() !== 'github.com' || x.port || x.username || x.password || x.search || x.hash) return false;
  const m = /^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(x.pathname); if (!m) return false;
  let t, n; try { t = decodeURIComponent(m[3]); n = decodeURIComponent(m[4]); } catch { return false; }
  if (tag != null && t !== String(tag)) return false;
  if (name != null && n !== String(name)) return false;
  return (repos || []).some(r => String(r).toLowerCase() === `${m[1]}/${m[2]}`.toLowerCase());
}

// the file for this platform in one GitHub release (the API's release object), or null:
// { name, size, url, sha256, sumsUrl, version, tag }
function pickAsset(release, { platform = process.platform, arch = process.arch, repos } = {}) {
  if (!release || !Array.isArray(release.assets) || release.draft) return null;
  const re = ASSET[platform]; if (!re) return null;
  if (platform === 'linux' && arch !== 'x64') return null; // (the AppImage is built for x64 only)
  const tag = String(release.tag_name || ''), ver = tag.replace(/^v/, ''); if (!SAFE_VER.test(ver)) return null;
  const sums = release.assets.find(s => s && typeof s.name === 'string' && /^SHA256SUMS(\.txt)?$/i.test(s.name) && +s.size > 0 && +s.size < 65536 && assetUrlOk(s.browser_download_url, repos, tag, s.name));
  for (const a of release.assets) {
    if (!a || typeof a.name !== 'string' || (a.state && a.state !== 'uploaded')) continue;
    const m = re.exec(a.name); if (!m || m[1] !== ver) continue; // (this release's own version, nothing else)
    if (!assetUrlOk(a.browser_download_url, repos, tag, a.name)) continue;
    const size = +a.size; if (!Number.isSafeInteger(size) || size < 4096 || size > MAX_DOWNLOAD) continue;
    const d = /^sha256:([0-9a-f]{64})$/i.exec(String(a.digest || ''));
    return { name: a.name, size, url: a.browser_download_url, sha256: d ? d[1].toLowerCase() : '', sumsUrl: sums ? sums.browser_download_url : '', version: ver, tag };
  }
  return null;
}

// ---------- downloading ----------
function hostOk(u, o) {
  if (u.username || u.password) return false;
  const list = o.hosts || HOSTS, is = h => list.some(p => (p instanceof RegExp ? p.test(h) : String(p).toLowerCase() === h.toLowerCase()));
  if (u.protocol === 'https:') return is(u.hostname);
  return u.protocol === 'http:' && !!o.testHttp && is(u.hostname); // (tests only: a local server)
}
// GET with redirects, each hop checked; resolves the 200 response. o.holder.req: the live request (to cancel it)
function open(url, o, hops = 0) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(url); } catch { return reject(failure('bad-url', 'The download address is not valid.')); }
    if (!hostOk(u, o)) return reject(failure('not-github', 'The download was sent somewhere other than GitHub, so it was stopped.'));
    const req = (u.protocol === 'http:' ? http : https).get(u, { headers: { 'User-Agent': `Boxshelf/${o.version || 'updater'}`, Accept: 'application/octet-stream' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        res.resume(); if (hops >= 6 || !res.headers.location) return reject(failure('redirects', 'GitHub sent the download around too many times.'));
        let next; try { next = new URL(res.headers.location, u).toString(); } catch { return reject(failure('bad-url', 'GitHub sent a download address that is not valid.')); }
        return open(next, o, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(failure('http', `GitHub answered ${res.statusCode}.`)); }
      resolve(res);
    });
    if (o.holder) o.holder.req = req;
    req.on('error', e => reject(o.signal && o.signal.aborted ? failure('canceled', 'Canceled.') : failure('net', `The download stopped (${e.code || e.message}).`)));
    req.setTimeout(o.timeout || 30000, () => req.destroy(failure('net', 'timed out')));
  });
}
async function fetchText(url, o) {
  const res = await open(url, o); let b = '';
  res.setEncoding('utf8');
  for await (const c of res) { b += c; if (b.length > 65536) { res.destroy(); throw failure('size', 'The checksum list is too big.'); } }
  return b;
}
// the SHA-256 SHA256SUMS.txt gives for one file name ('' when it isn't listed)
function sumFor(text, name) {
  for (const l of String(text || '').split(/\r?\n/)) { const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(l); if (m && m[2] === name) return m[1].toLowerCase(); }
  return '';
}
// downloads asset (from pickAsset) to dest, checking size and hash. o: { version, onProgress(done, total), signal,
// hosts / testHttp (tests) }. The partly downloaded file (dest + '.part') is always removed when it fails
async function download(asset, dest, o = {}) {
  if (!asset || !asset.url || !(asset.size > 0)) throw failure('no-asset', 'There is no download for this computer in that release.');
  const holder = {}, oo = { ...o, holder };
  const onAbort = () => { try { holder.req && holder.req.destroy(failure('canceled', 'Canceled.')); } catch {} };
  if (o.signal) { if (o.signal.aborted) throw failure('canceled', 'Canceled.'); o.signal.addEventListener('abort', onAbort, { once: true }); }
  const part = dest + '.part';
  try {
    let want = asset.sha256 || '';
    if (!want && asset.sumsUrl) { try { want = sumFor(await fetchText(asset.sumsUrl, oo), asset.name); } catch (e) { if (e.code === 'canceled') throw e; } }
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const res = await open(asset.url, oo);
    const len = res.headers['content-length'];
    if (len != null && +len !== asset.size) { res.destroy(); throw failure('size', 'The download is not the size GitHub lists for it, so it was not used.'); }
    const hash = crypto.createHash('sha256'); let got = 0, lastT = 0;
    const count = new Transform({ transform(c, _e, cb) { got += c.length; if (got > asset.size) return cb(failure('size', 'The download is bigger than GitHub lists it, so it was not used.')); hash.update(c);
      const t = Date.now(); if (o.onProgress && t - lastT > 200) { lastT = t; try { o.onProgress(got, asset.size); } catch {} } cb(null, c); } });
    const sig = o.signal ? { signal: o.signal } : {};
    try { await pipeline(res, count, fs.createWriteStream(part), sig); }
    catch (e) { throw o.signal && o.signal.aborted ? failure('canceled', 'Canceled.') : e.code === 'size' ? e : failure('net', `The download stopped (${e.code || e.message}).`); }
    if (got !== asset.size) throw failure('size', 'The download ended early. Try again.');
    const sha = hash.digest('hex');
    if (want && sha !== want) throw failure('hash', 'The download doesn\'t match the release\'s checksum, so it was not used.');
    if (o.onProgress) try { o.onProgress(got, asset.size); } catch {}
    await fsp.rename(part, dest);
    return { file: dest, size: got, sha256: sha, verified: !!want };
  } catch (e) { await fsp.unlink(part).catch(() => {}); throw e; }
  finally { if (o.signal) o.signal.removeEventListener('abort', onAbort); }
}

// ---------- the Windows zip ----------
// the zip's entries from its central directory (zip64 sizes too). Nothing is unpacked
async function zipEntries(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const size = (await fh.stat()).size, tl = Math.min(size, 65557), tail = Buffer.alloc(tl);
    await fh.read(tail, 0, tl, size - tl);
    let e = -1; for (let i = tl - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw failure('zip', 'The download isn\'t a zip file.');
    const n = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (n === 0xffff || cdOff === 0xffffffff || n > MAX_ENTRIES || cdOff + cdSize > size) throw failure('zip', 'The zip has more in it than Boxshelf\'s download ever has.');
    const cd = Buffer.alloc(cdSize); await fh.read(cd, 0, cdSize, cdOff);
    const out = []; let p = 0;
    for (let i = 0; i < n; i++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50) throw failure('zip', 'The zip is damaged.');
      const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
      let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24), off = cd.readUInt32LE(p + 42);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const name = cd.subarray(p + 46, p + 46 + nl).toString(flags & 0x800 ? 'utf8' : 'latin1'), ex = cd.subarray(p + 46 + nl, p + 46 + nl + xl);
      if (usize === 0xffffffff || csize === 0xffffffff || off === 0xffffffff) {
        for (let q = 0; q + 4 <= ex.length;) { const id = ex.readUInt16LE(q), len = ex.readUInt16LE(q + 2); if (id === 1) { let r = q + 4;
          if (usize === 0xffffffff) { usize = Number(ex.readBigUInt64LE(r)); r += 8; } if (csize === 0xffffffff) { csize = Number(ex.readBigUInt64LE(r)); r += 8; } if (off === 0xffffffff) { off = Number(ex.readBigUInt64LE(r)); r += 8; } break; } q += 4 + len; }
      }
      out.push({ name, flags, method, crc, csize, size: usize, off, dir: /[\\/]$/.test(name) });
      p += 46 + nl + xl + cl;
    }
    return out;
  } finally { await fh.close(); }
}
// a zip name as safe path parts: forward slashes, no absolute path or drive, no ".." (null when it isn't safe)
function safeParts(name) {
  const s = String(name || '').replace(/\\/g, '/');
  if (!s || s.length > 400 || s.startsWith('/') || /^[a-z]:/i.test(s) || /[\x00-\x1f:*?"<>|]/.test(s)) return null;
  const parts = s.split('/').filter(x => x && x !== '.');
  if (!parts.length || parts.some(x => x === '..' || /[. ]$/.test(x))) return null;
  return parts;
}
const crc32 = typeof zlib.crc32 === 'function' ? zlib.crc32 : null;
// unpacks every file of the zip into dest (which must be empty or missing). Returns the files' relative paths ('/')
async function unzip(file, dest, o = {}) {
  const entries = await zipEntries(file), rel = []; let total = 0;
  for (const e of entries) {
    const parts = safeParts(e.name); if (!parts) throw failure('zip', 'The zip has a file with a name Boxshelf won\'t unpack.');
    if (e.dir) continue;
    if (e.flags & 1) throw failure('zip', 'The zip is password-protected.');
    if (e.method !== 0 && e.method !== 8) throw failure('zip', 'The zip uses a kind of compression Boxshelf doesn\'t unpack.');
    total += e.size; if (total > MAX_UNPACKED) throw failure('zip', 'The zip unpacks to more than Boxshelf\'s download ever does.');
  }
  const root = path.resolve(dest); await fsp.mkdir(root, { recursive: true });
  const fh = await fsp.open(file, 'r');
  try {
    for (const e of entries) {
      if (e.dir) continue; if (o.signal && o.signal.aborted) throw failure('canceled', 'Canceled.');
      const parts = safeParts(e.name), to = path.join(root, ...parts);
      if (!to.startsWith(root + path.sep)) throw failure('zip', 'The zip has a file with a name Boxshelf won\'t unpack.');
      const lh = Buffer.alloc(30); await fh.read(lh, 0, 30, e.off);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw failure('zip', 'The zip is damaged.');
      const start = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      await fsp.mkdir(path.dirname(to), { recursive: true });
      let got = 0, crc = 0;
      const tally = new Transform({ transform(c, _e, cb) { got += c.length; if (got > e.size) return cb(failure('zip', 'The zip is damaged.')); if (crc32) crc = crc32(c, crc); cb(null, c); } });
      const src = e.csize ? fs.createReadStream(null, { fd: fh.fd, autoClose: false, start, end: start + e.csize - 1 }) : require('stream').Readable.from([]);
      await pipeline(src, ...(e.method === 8 ? [zlib.createInflateRaw()] : []), tally, fs.createWriteStream(to));
      if (got !== e.size || (crc32 && (crc >>> 0) !== (e.crc >>> 0))) throw failure('zip', 'The zip is damaged.');
      rel.push(parts.join('/'));
    }
  } finally { await fh.close(); }
  return rel;
}
// the unpacked files' root: the one folder everything is in (the release's Boxshelf\), or dest itself
function unpackedRoot(dest, rel) {
  const tops = new Set(rel.map(r => r.split('/')[0]));
  if (tops.size === 1 && rel.every(r => r.includes('/'))) { const t = [...tops][0]; return { root: path.join(dest, t), files: rel.map(r => r.slice(t.length + 1)) }; }
  return { root: dest, files: rel };
}
const isPE = f => { try { const b = Buffer.alloc(2), fd = fs.openSync(f, 'r'); try { fs.readSync(fd, b, 0, 2, 0); } finally { fs.closeSync(fd); } return b.toString('latin1') === 'MZ'; } catch { return false; } };
const isELF = f => { try { const b = Buffer.alloc(4), fd = fs.openSync(f, 'r'); try { fs.readSync(fd, b, 0, 4, 0); } finally { fs.closeSync(fd); } return b.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])); } catch { return false; } };

// what the helper copies: [[unpacked file, where it goes]], only files that are in the zip. Its Boxshelf.exe goes onto
// the real exe (its name may differ); nothing under data\; nothing outside the app folder
function planWindows({ root, files, appRoot, realExe, exeName = 'Boxshelf.exe' }) {
  const app = path.resolve(appRoot), pairs = []; let exe = false;
  for (const r of files) {
    const parts = safeParts(r); if (!parts) throw failure('zip', 'The zip has a file with a name Boxshelf won\'t unpack.');
    if (parts[0].toLowerCase() === 'data') continue; // (your settings and everything Boxshelf keeps)
    const src = path.join(root, ...parts);
    if (parts.length === 1 && parts[0].toLowerCase() === exeName.toLowerCase()) { if (!isPE(src)) throw failure('zip', 'The Boxshelf.exe in that download isn\'t a Windows program.'); pairs.push([src, path.resolve(realExe)]); exe = true; continue; }
    const dst = path.resolve(app, ...parts);
    if (!dst.toLowerCase().startsWith(app.toLowerCase() + path.sep)) throw failure('zip', 'The zip has a file that would land outside the Boxshelf folder.');
    pairs.push([src, dst]);
  }
  if (!exe) throw failure('zip', 'That download doesn\'t have Boxshelf.exe in it.');
  return pairs;
}

// ---------- the helpers ----------
const psq = s => "'" + String(s).replace(/'/g, "''") + "'";
// PowerShell (Windows): o = { kind, from, to, pairs: [[src, dst]], keepDir, waitPid, stubPid, stubExe, start: { exe, cwd } | null,
// resultFile, logFile, retries (per copy, half a second apart; 40 by default) }. Waits for Boxshelf (and its portable launcher) to close, copies each pair (the file it replaces
// first kept in keepDir), puts every one back if any copy fails, writes the result, starts Boxshelf
function windowsScript(o) {
  const L = [];
  L.push(`# Boxshelf ${o.kind || 'update'} helper, written by Boxshelf. It runs once, after Boxshelf has closed, and deletes nothing of yours.`);
  L.push("$ErrorActionPreference = 'Stop'");
  L.push(`$log = ${psq(o.logFile)}`);
  L.push('function Say([string]$m) { try { [IO.File]::AppendAllText($log, ((Get-Date).ToString("s") + " " + $m + "`r`n")) } catch {} }');
  L.push(`Say ${psq(`${o.kind || 'update'} helper started: ${o.from || ''} -> ${o.to || ''}`)}`);
  L.push(`try { $p = Get-Process -Id ${+o.waitPid || 0} -ErrorAction Stop; [void]$p.WaitForExit(180000) } catch {}`);
  if (o.stubPid && o.stubExe) L.push(`try { $p = Get-Process -Id ${+o.stubPid} -ErrorAction Stop; if ($p.Path -and ($p.Path -ieq ${psq(o.stubExe)})) { [void]$p.WaitForExit(120000) } } catch {}`);
  L.push('Start-Sleep -Milliseconds 600');
  L.push(`function Put([string]$src, [string]$dst) { for ($i = 0; ; $i++) { try { [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dst)); [IO.File]::Copy($src, $dst, $true); return } catch { if ($i -ge ${o.retries != null ? Math.max(0, +o.retries | 0) : 40}) { throw }; Start-Sleep -Milliseconds 500 } } }`);
  L.push('$pairs = New-Object System.Collections.ArrayList');
  (o.pairs || []).forEach(([src, dst], i) => L.push(`[void]$pairs.Add(@(${psq(src)}, ${psq(dst)}, ${psq(path.join(o.keepDir, String(i)))}))`));
  L.push('$done = New-Object System.Collections.ArrayList; $ok = $true; $err = ""');
  L.push('try {');
  L.push('  foreach ($p in $pairs) { $had = [IO.File]::Exists($p[1]); if ($had) { Put $p[1] $p[2] }; [void]$done.Add(@($p[1], $p[2], $had)); Put $p[0] $p[1] }');
  L.push('  Say ("copied " + $pairs.Count + " file(s)")');
  L.push('} catch {');
  L.push('  $ok = $false; $err = $_.Exception.Message; Say ("failed: " + $err)');
  L.push('  for ($i = $done.Count - 1; $i -ge 0; $i--) { $d = $done[$i]; try { if ($d[2]) { Put $d[1] $d[0] } elseif ([IO.File]::Exists($d[0])) { [IO.File]::Delete($d[0]) } } catch { Say ("could not put back " + $d[0]) } }');
  L.push('}');
  L.push(`$res = '{"ok":' + $(if ($ok) { 'true' } else { 'false' }) + ',"kind":${JSON.stringify(String(o.kind || 'update')).replace(/'/g, "''")},"from":${JSON.stringify(String(o.from || '')).replace(/'/g, "''")},"to":${JSON.stringify(String(o.to || '')).replace(/'/g, "''")},"error":' + (ConvertTo-Json ([string]$err)) + ',"at":' + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + '}'`);
  L.push(`try { [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName(${psq(o.resultFile)})); [IO.File]::WriteAllText(${psq(o.resultFile)}, $res) } catch { Say ("could not write the result: " + $_.Exception.Message) }`);
  if (o.start && o.start.exe) L.push(`try { Start-Process -FilePath ${psq(o.start.exe)} -WorkingDirectory ${psq(o.start.cwd || path.dirname(o.start.exe))} } catch { Say ("could not start Boxshelf: " + $_.Exception.Message) }`);
  L.push('Say "helper done"');
  L.push('if ($PSCommandPath) { try { [IO.File]::Delete($PSCommandPath) } catch {} }');
  return L.join('\r\n') + '\r\n';
}
const shq = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
// sh (Linux): o = { kind, from, to, waitPid, staged (the new AppImage, or ''), target (the AppImage), relaunch, resultFile, logFile }
function linuxScript(o) {
  const v = s => (SAFE_VER.test(String(s || '')) ? String(s) : '');
  return [
    '#!/bin/sh',
    `# Boxshelf ${o.kind || 'update'} helper, written by Boxshelf. It runs once, after Boxshelf has closed, and deletes nothing of yours.`,
    `log=${shq(o.logFile)}; result=${shq(o.resultFile)}; staged=${shq(o.staged || '')}; target=${shq(o.target || '')}`,
    'say() { printf \'%s %s\\n\' "$(date \'+%Y-%m-%dT%H:%M:%S\')" "$1" >> "$log" 2>/dev/null; }',
    `say ${shq(`${o.kind || 'update'} helper started: ${v(o.from)} -> ${v(o.to)}`)}`,
    `i=0; while kill -0 ${+o.waitPid || 0} 2>/dev/null && [ $i -lt 360 ]; do sleep 0.5; i=$((i+1)); done`,
    'ok=true; err=""',
    'if [ -n "$staged" ]; then',
    '  chmod +x "$staged" 2>/dev/null',
    '  if [ -f "$staged" ] && mv -f "$staged" "$target"; then say "replaced the AppImage"; else ok=false; err="The new AppImage couldn\'t replace the old one."; say "$err"; fi',
    'fi',
    `printf '{"ok":%s,"kind":"%s","from":"%s","to":"%s","error":"%s","at":%s000}\\n' "$ok" ${shq(String(o.kind || 'update').replace(/[^a-z-]/g, ''))} ${shq(v(o.from))} ${shq(v(o.to))} "$err" "$(date +%s)" > "$result.tmp" 2>/dev/null && mv -f "$result.tmp" "$result"`,
    'case "${LD_LIBRARY_PATH}" in *"${APPDIR:-/nonexistent-appdir}"*) unset LD_LIBRARY_PATH ;; esac',
    'unset APPDIR APPIMAGE ARGV0 OWD',
    o.relaunch && o.target ? 'cd "$(dirname "$target")" 2>/dev/null; nohup "$target" >/dev/null 2>&1 &' : 'say "not starting Boxshelf (start it again yourself)"',
    'say "helper done"',
    'rm -f "$0"',
    ''].join('\n');
}
// writes the helper next to the temp folder and starts it on its own (it outlives Boxshelf). Returns the script's path
function launch(script, { platform = process.platform, tempDir, spawn = require('child_process').spawn, env = process.env } = {}) {
  const dir = path.join(tempDir || require('os').tmpdir(), 'boxshelf-helper'); fs.mkdirSync(dir, { recursive: true });
  const stamp = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
  if (platform === 'win32') {
    const file = path.join(dir, `boxshelf-helper-${stamp}.ps1`);
    fs.writeFileSync(file, '\ufeff' + script, 'utf8'); // (BOM: Windows PowerShell reads non-ASCII paths right)
    // Windows PowerShell started as a detached process (no console) quits at once without running anything, and a plain
    // child can go with its parent; "cmd /c start /b" started detached runs it on its own, hidden, and it outlives Boxshelf.
    // Only for paths cmd reads literally inside quotes (no % " ^ & | < > !); otherwise a plain hidden child
    let ps = path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); if (!fs.existsSync(ps)) ps = 'powershell.exe';
    const args = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File'];
    if (!/[%"^&|<>!]/.test(file + ps)) spawn(env.ComSpec || 'cmd.exe', [`/d /s /c "start "" /b "${ps}" ${args.join(' ')} "${file}""`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
    else spawn(ps, [...args, file], { stdio: 'ignore', windowsHide: true }).unref();
    return file;
  }
  const file = path.join(dir, `boxshelf-helper-${stamp}.sh`);
  fs.writeFileSync(file, script, { mode: 0o700 });
  spawn('/bin/sh', [file], { detached: true, stdio: 'ignore', env }).unref();
  return file;
}

module.exports = { pickAsset, assetUrlOk, download, sumFor, zipEntries, unzip, unpackedRoot, planWindows, safeParts, isPE, isELF, windowsScript, linuxScript, launch, SAFE_VER, HOSTS };
