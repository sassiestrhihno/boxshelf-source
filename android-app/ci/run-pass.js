// Runs ONE device-test pass on its own (a dev helper; web-device-test.js runs them all).
//   cd android-app; node copy-web.js; node ci/run-pass.js look-sound-test.js [out-folder]
// The pass file is one of ci/*.js that exports async ({ browser, base, check, newPage, OUT }). Same set-up as
// web-device-test.js: a static server on www/, real controllers on this PC hidden (a resting stick otherwise moves the
// pages), window.__padHold for pretend pads, the Thor-like 853x480 @2.25 touch page from newPage().
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const { chromium } = require('playwright');
const WWW = path.join(__dirname, '..', 'www'), PASS = process.argv[2], OUT = path.resolve(process.argv[3] || path.join(require('os').tmpdir(), 'boxshelf-pass'));
if (!PASS) { console.error('usage: node ci/run-pass.js <pass-file.js> [out-folder]'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
const server = http.createServer((q, r) => { const f = path.join(WWW, decodeURIComponent(q.url.split('?')[0])); if (!f.startsWith(WWW)) { r.writeHead(403); r.end(); return; }
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(b); }); });
async function newPage(browser, init) {
  const ctx = await browser.newContext({ viewport: { width: 853, height: 480 }, deviceScaleFactor: 2.25, isMobile: true, hasTouch: true });
  ctx.setDefaultTimeout(90000); if (init) await ctx.addInitScript({ content: init });
  const page = await ctx.newPage(), errors = [], logs = []; page.setDefaultTimeout(120000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { const t = m.text(); logs.push(t); if (m.type() === 'error' && !/Failed to load resource/.test(t)) errors.push(t.slice(0, 200)); });
  return { ctx, page, errors, logs };
}
fs.mkdirSync(OUT, { recursive: true });
server.listen(0, async () => {
  const base = `http://localhost:${server.address().port}/index.html`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const noPads = () => { try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, value: () => [null, null, null, null] }); } catch (e) {} };
  const padHold = () => { window.__padHold = async (pad, i, ms) => { const fr = () => new Promise(r => requestAnimationFrame(() => r())), set = p => { pad.buttons[i] = { pressed: p, touched: p, value: p ? 1 : 0 }; pad.timestamp = (pad.timestamp || 0) + 1; };
    ms = ms || 120; set(true); const t0 = performance.now(); await fr(); const left = ms - (performance.now() - t0); if (left > 0) await new Promise(r => setTimeout(r, left)); if (ms >= 400) await fr(); set(false); await fr(); }; };
  const nc = browser.newContext.bind(browser);
  browser.newContext = async o => { const c = await nc(o); await c.addInitScript(noPads); await c.addInitScript(padHold); return c; };
  browser.newPage = async o => { const c = await browser.newContext(o), p = await c.newPage(); const close = p.close.bind(p); p.close = async a => { await close(a); await c.close().catch(() => {}); }; return p; };
  let ok = 0, bad = 0;
  const check = (n, c, d) => { if (c) ok++; else bad++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' :: ' + String(d).slice(0, 600))); };
  try { await require(path.join(__dirname, PASS))({ browser, base, check, newPage, OUT }); } catch (e) { check('the pass ran to the end', false, e && e.stack || e); }
  console.log(`${ok} passed, ${bad} failed (screenshots: ${OUT})`);
  await browser.close(); server.close(); process.exit(bad ? 1 : 0);
});
