// (beta.14) Find a logo's Commons search (main/logofind.js) against a pretend Wikimedia Commons: which files count, licences,
// keys, and that only Commons addresses are ever fetched. Also Search the web's install check (main/modelfind.js installLogo).
// node ci/logofind-test.js   (no Electron, no internet)
const fs = require('fs'), path = require('path'), os = require('os'), Module = require('module');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-logofind-'));
let fails = 0; const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); if (!c) fails++; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const page = (i, title, mime, lic, w, extra = {}) => ({ index: i, title: 'File:' + title, imageinfo: [{ mime, width: w, height: 100,
  url: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/' + encodeURIComponent(title.replace(/ /g, '_')),
  thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/' + encodeURIComponent(title.replace(/ /g, '_')) + '/960px-x.png?utm_source=x',
  extmetadata: { LicenseShortName: { value: lic }, Artist: { value: '<a href="x">Some <b>Author</b></a>' } }, ...extra }] });
const fetched = [];
const fake = async u => {
  fetched.push(u);
  if (u.startsWith('https://commons.wikimedia.org/w/api.php')) {
    const q = decodeURIComponent(/gsrsearch=([^&]*)/.exec(u)[1]);
    const pages = /Dreamcast/.test(q) ? [
      page(1, 'Dreamcast logo.svg', 'image/svg+xml', 'Public domain', 1000),
      page(2, 'Sonic Adventure (Dreamcast) logo.png', 'image/png', 'Public domain', 600),
      page(3, 'Dreamcast logo photo.jpg', 'image/jpeg', 'Public domain', 2000),
      page(4, 'Dreamcast logo fan.png', 'image/png', 'CC BY-SA 4.0', 500),
      page(5, 'Dreamcast logo nonfree.png', 'image/png', 'GPLv3', 500),
      page(6, 'Dreamcast logo tiny.png', 'image/png', 'Public domain', 60),
      page(7, 'Saturn logo.png', 'image/png', 'Public domain', 500),
      page(8, 'Dreamcast logo evil.png', 'image/png', 'Public domain', 500, { url: 'https://evil.example/x.png' })] : [];
    return { ok: true, status: 200, json: async () => ({ query: { pages } }) };
  }
  if (/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(u)) return { ok: true, status: 200, arrayBuffer: async () => /notapic/.test(u) ? Buffer.from('<html>nope</html>'.repeat(10)) : PNG };
  return { ok: false, status: 404 };
};
(async () => {
  const L = require('../../main/logofind'); L.init({ fetch: fake, log: () => {} });
  const r = await L.search('dreamcast'), labels = r.list.map(x => x.label);
  ok(labels[0] === 'Dreamcast logo', 'the console\'s own logo comes first: ' + labels.join(' | '));
  ok(labels.includes('Dreamcast logo fan') && r.list.find(x => x.label === 'Dreamcast logo fan').by === 'Some Author', 'CC BY files kept, with their author as plain words');
  ok(!labels.some(l => /photo|nonfree|tiny|Saturn|evil/.test(l)), 'JPEG photos, non-free licences, tiny files, other consoles and non-Commons addresses are left out');
  ok(labels.indexOf('Sonic Adventure (Dreamcast) logo') === labels.length - 1, 'a game\'s logo that names the console only in brackets goes last');
  ok(r.list.every(x => /^cs-dreamcast-\d+$/.test(x.key) && !('url' in x)), 'the screen gets keys only, never addresses');
  const f = await L.file('dreamcast', r.list[0].key, path.join(root, 'cache'));
  ok(f.ext === '.png' && fs.existsSync(f.file) && fetched.some(u => u.startsWith('https://thumb.wikimedia.org/') && !u.includes('utm_')), 'an SVG logo is fetched as Commons\' PNG render, without tracking parameters');
  let e1 = ''; try { await L.file('dreamcast', 'cs-dreamcast-99', path.join(root, 'cache')); } catch (e) { e1 = e.message; }
  ok(/no longer offered/.test(e1), 'a key that was never offered is refused');
  let e2 = ''; try { await L.file('gc', r.list[0].key, path.join(root, 'cache')); } catch (e) { e2 = e.message; }
  ok(/no longer offered/.test(e2), 'one console\'s key doesn\'t work for another');
  ok((await L.search('arcade')).list.length === 0 && (await L.search('dos')).list.length === 0, 'Arcade and DOS aren\'t searched');
  const n = fetched.length; await L.search('dreamcast'); ok(fetched.length === n, 'a second search within the hour is answered from memory');
  ok(fetched.every(u => /^https:\/\/(commons|upload|thumb)\.wikimedia\.org\//.test(u)), 'only Wikimedia addresses were ever fetched');

  // Search the web: the downloaded file must really be a picture
  const themesDir = path.join(root, 'themes'); const calls = [];
  const req = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'electron') return { shell: { openExternal: async () => {} }, app: { getPath: () => root } };
    if (id === './themes') return { setLogoKeepingOld: (s, f) => calls.push([s, path.basename(f)]), set: () => {} };
    return req.apply(this, arguments);
  };
  const MF = require('../../main/modelfind'); Module.prototype.require = req;
  const put = (n, b) => { const p = path.join(root, n); fs.writeFileSync(p, b); return p; };
  ok(!!(await MF._t.installLogo(put('logo.png', PNG), 'dreamcast', 'Dreamcast')) && calls.length === 1, 'Search the web: a real PNG becomes the logo');
  ok(!(await MF._t.installLogo(put('page.png', Buffer.from('<html>' + 'x'.repeat(300))), 'dreamcast', 'Dreamcast')) && calls.length === 1, 'Search the web: a web page saved as .png is ignored');
  ok(!!(await MF._t.installLogo(put('logo.svg', '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'dreamcast', 'Dreamcast')) && calls.length === 2, 'Search the web: an SVG works');
  ok(/^https:\/\/www\.google\.com\/search\?tbm=isch&tbs=ic:trans&q=Dreamcast%20logo%20png$/.test(MF.logoUrl('dreamcast', 'Dreamcast')), 'Search the web opens an image search for see-through pictures');
  fs.rmSync(root, { recursive: true, force: true });
  console.log(fails ? `${fails} failed` : 'all passed'); process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + e.stack); process.exit(1); });
