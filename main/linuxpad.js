// (beta.9) Linux / Steam Deck: hold Select + Start for 1.5 s during a game and Boxshelf closes it (closeGame), whatever
// the emulator, configured or not. Windows has the Home menu on the Guide button (padwatch.js, XInput); in Steam's Game
// Mode the Steam button belongs to Steam, so Linux gets this instead.
// It reads the joystick devices (/dev/input/js*: Steam's virtual gamepad shows up as one, with the Xbox layout) only while
// a game is running, and stops when it ends. Each event is 8 bytes: time (ms), value, type (1 button, 2 axis, | 0x80 the
// first "this is how it is now" report), number. Button numbers: Xbox layout Select 6 / Start 7; PlayStation pads 8 / 9.
// The devices are opened non-blocking and read every 50 ms on the main thread. A read stream (fs.createReadStream) did
// each read on one of libuv's four pool threads, where it waited for the pad's next event; destroy() can't cut a waiting
// read short, so every game left one thread stuck until the pad was touched. With a few pads the pool filled up (every
// other fs call in the main process waited behind them), and on quit the process never ended: it kept the single-instance
// lock, invisible, and the next start only "focused the open window".
'use strict';
const fs = require('fs');
const path = require('path');

const HOLD_MS = 1500;
let log = () => {}, dir = '/dev/input', sysDir = '/sys/class/input', force = false;
function init(o) { log = o.log || log; if (o.dir) dir = o.dir; if (o.sysDir) sysDir = o.sysDir; force = !!o.force; }

const POLL_MS = 50, BUF = Buffer.alloc(8 * 64);
let on = null; // { onQuit, devs: Map(name -> { fd, down: Set, sel, start }), timer, scan, poll, fired }
function layout(name) {
  let n = ''; try { n = fs.readFileSync(path.join(sysDir, name, 'device', 'name'), 'utf8'); } catch {}
  return /sony|playstation|dualsense|dualshock|wireless controller/i.test(n) ? { sel: 8, start: 9, label: n.trim() } : { sel: 6, start: 7, label: n.trim() || 'gamepad' };
}
function check() {
  if (!on || on.fired) return;
  const held = [...on.devs.values()].some(d => d.down.has(d.sel) && d.down.has(d.start));
  if (held && !on.timer) on.timer = setTimeout(() => { if (!on) return; on.timer = null; if ([...on.devs.values()].some(d => d.down.has(d.sel) && d.down.has(d.start))) { on.fired = true; log('Linux pad: Select + Start held, closing the game'); try { on.onQuit(); } catch (e) { log('Linux pad: quit failed', e.message); } } }, HOLD_MS);
  if (!held && on.timer) { clearTimeout(on.timer); on.timer = null; }
}
function open(name) {
  if (!on || on.devs.has(name)) return;
  const L = layout(name), d = { ...L, down: new Set(), fd: null, rest: Buffer.alloc(0) };
  try { d.fd = fs.openSync(path.join(dir, name), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK); } catch { return; }
  on.devs.set(name, d);
}
function shut(d) { if (d.fd == null) return; try { fs.closeSync(d.fd); } catch {} d.fd = null; }
// whatever each pad has sent since the last look; never waits (EAGAIN: nothing new). A pad unplugged (an error, or end of
// file) is dropped, and found again by scan() if it comes back.
function poll() {
  for (const [name, d] of on ? [...on.devs] : []) {
    if (d.fd == null) continue;
    for (let i = 0; i < 16; i++) {
      let n; try { n = fs.readSync(d.fd, BUF, 0, BUF.length, null); } catch (e) { if (e.code !== 'EAGAIN' && e.code !== 'EWOULDBLOCK') { shut(d); if (on) on.devs.delete(name); } break; }
      if (!n) { shut(d); if (on) on.devs.delete(name); break; }
      feed(d, Buffer.from(BUF.subarray(0, n)));
      if (!on || n < BUF.length) break; // (the hold may have closed the game: end() ran)
    }
  }
}
function feed(d, chunk) { const b = d.rest.length ? Buffer.concat([d.rest, chunk]) : chunk; let i = 0;
  for (; i + 8 <= b.length; i += 8) { const value = b.readInt16LE(i + 4), type = b[i + 6], num = b[i + 7];
    if ((type & 0x7f) !== 1) continue; // buttons only
    if (value) d.down.add(num); else d.down.delete(num);
    if (!(type & 0x80)) check(); } // (the opening "how it is now" report never starts a hold)
  d.rest = b.subarray(i); }
// (tests) events for a pretend pad that stays plugged in
function _feed(name, buf, sysName) { if (!on) return; let d = on.devs.get(name); if (!d) { d = { ...layout(sysName || name), down: new Set(), fd: null, rest: Buffer.alloc(0) }; on.devs.set(name, d); } feed(d, buf); }
function scan() { if (!on) return; let names = []; try { names = fs.readdirSync(dir).filter(n => /^js\d+$/.test(n)); } catch {} for (const n of names) open(n); }
// a game started: watch the pads until end()
function begin(onQuit) {
  if (process.platform !== 'linux' && !force) return false;
  end(); on = { onQuit, devs: new Map(), timer: null, fired: false, scan: null, poll: null };
  scan(); on.scan = setInterval(scan, 3000); // (a pad plugged in during the game)
  on.poll = setInterval(poll, POLL_MS);
  return true;
}
function end() { if (!on) return; const o = on; on = null; clearTimeout(o.timer); clearInterval(o.scan); clearInterval(o.poll); for (const d of o.devs.values()) shut(d); }
const watching = () => !!on;

module.exports = { init, begin, end, watching, HOLD_MS, _feed };
