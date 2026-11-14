// (beta.14) The in-game Home menu over Azahar: its fullscreen OpenGL game hides any window over it, so the menu takes
// the focus once the game is paused and gives it back on Resume. Over Dolphin nothing changes; over a media app the menu
// still takes the focus at once. Plain Node: electron and the controller helper are stand-ins.
'use strict';
const path = require('path');
const Module = require('module');

const events = [];
class FakeWin {
  constructor() { this.visible = false; this.destroyed = false;
    this.webContents = { send: () => {}, isLoading: () => false, once: () => {}, on: () => {} }; }
  setIgnoreMouseEvents() {} loadFile() {} on() {} setBounds() {}
  getBounds() { return { x: 0, y: 0, width: 1920, height: 1080 }; }
  isDestroyed() { return this.destroyed; } destroy() { this.destroyed = true; }
  setAlwaysOnTop() {} isVisible() { return this.visible; } showInactive() { this.visible = true; } moveTop() {} hide() { this.visible = false; }
  setFocusable(f) { events.push('focusable ' + f); }
  getNativeWindowHandle() { const b = Buffer.alloc(8); b.writeBigUInt64LE(1234n); return b; }
}
const fakeElectron = { BrowserWindow: FakeWin, screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }), getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }) } };
const load0 = Module._load;
Module._load = function (req, parent, isMain) { return req === 'electron' ? fakeElectron : load0.call(this, req, parent, isMain); };

const hm = require(path.join(__dirname, '..', '..', 'main', 'homemenu.js'));
const padwatch = {
  setMenu: () => {}, homeFromNintendo: () => false,
  sendKeys: keys => { events.push('keys ' + keys.join(' ')); return Promise.resolve(true); },
  focusOnce: h => { events.push('focus ' + h); return true; },
  front: keep => { events.push('front ' + (keep ? 'keep' : 'park')); return true; }
};
hm.init({ padwatch, log: () => {}, getUi: () => ({}), getSound: () => null });

let fails = 0;
const check = (name, ok, info) => { console.log((ok ? '✅ ' : '❌ ') + name + (ok ? '' : ' :: ' + info)); if (!ok) fails++; };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // Azahar (3DS)
  hm.begin({ systemId: 'n3ds', exe: 'C:\\Emus\\Azahar\\azahar.exe', title: 'Metroid' }); hm.ready();
  events.length = 0; await hm.open(); await wait(20);
  const pauseAt = events.indexOf('keys f4'), focusAt = events.indexOf('focus 1234');
  check('Azahar: the game is paused (F4) and then the menu takes the focus', pauseAt >= 0 && focusAt > pauseAt, events.join(', '));
  events.length = 0; await hm.act('resume'); await wait(200);
  check('Azahar: Resume unpauses and gives the game the focus back (pointer parked)', events.includes('keys f4') && events.includes('front park') && events.includes('focusable false'), events.join(', '));
  hm.end();

  // Dolphin (GameCube): unchanged, the menu never takes the focus
  hm.begin({ systemId: 'gc', exe: 'C:\\Emus\\Dolphin\\Dolphin.exe', title: 'Wind Waker' }); hm.ready();
  events.length = 0; await hm.open(); await wait(20);
  check('Dolphin: paused (F10), the menu does not take the focus', events.includes('keys f10') && !events.some(e => e.startsWith('focus ')), events.join(', '));
  events.length = 0; await hm.act('resume'); await wait(200);
  check('Dolphin: Resume does not move the focus', events.includes('keys f10') && !events.some(e => e.startsWith('front')), events.join(', '));
  hm.end();

  // A media app: the menu takes the focus at once; Resume gives it back keeping the pointer
  hm.begin({ systemId: 'media', exe: 'C:\\Apps\\Stremio\\stremio.exe', title: 'Stremio' }); hm.ready();
  events.length = 0; await hm.open(); await wait(20);
  check('Media app: the menu takes the focus at once', events[0] === 'focusable true' && events.includes('focus 1234'), events.join(', '));
  events.length = 0; await hm.act('resume'); await wait(200);
  check('Media app: Resume gives the focus back and keeps the pointer', events.includes('front keep'), events.join(', '));
  hm.end();

  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.log('❌ crashed: ' + (e && e.stack || e)); process.exit(1); });
