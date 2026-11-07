// Linux pad watcher (main/linuxpad.js): a pad that's plugged in but idle must not keep Boxshelf alive after a game.
//   node linux/ci/pad-test.js            (the check runs in a child Node; exit code 1 = a check failed)
// A FIFO stands in for /dev/input/js0, kept open and silent like a real pad between button presses. Select + Start held
// for 1.5 s must close the game once; after end() the process must be able to exit. (beta.9's read streams left a libuv
// pool thread waiting on the pad for ever: Boxshelf's process never ended after Quit and kept the single-instance lock.)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync, spawnSync } = require('child_process');
if (process.argv[2] === '--child') {
  const LP = require(path.join(__dirname, '..', '..', 'main', 'linuxpad.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bxpad-')); execFileSync('mkfifo', [path.join(dir, 'js0')]);
  const w = fs.openSync(path.join(dir, 'js0'), fs.constants.O_RDWR); // the pad: plugged in, silent
  LP.init({ dir, sysDir: dir, force: true, log: () => {} });
  let quits = 0; LP.begin(() => { quits++; });
  const ev = (num, value) => { const b = Buffer.alloc(8); b.writeInt16LE(value, 4); b[6] = 1; b[7] = num; return b; };
  setTimeout(() => fs.writeSync(w, Buffer.concat([ev(6, 1), ev(7, 1)])), 200); // Select + Start, held
  setTimeout(() => { console.log('quits=' + quits); LP.end(); }, 2300); // the game is over; the pad stays plugged in
  return;
}
let fails = 0; const check = (name, ok, detail) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || detail == null ? '' : '  -> ' + detail)); if (!ok) fails++; };
const t = Date.now(), r = spawnSync(process.execPath, [__filename, '--child'], { encoding: 'utf8', timeout: 15000 });
check('Select + Start held through the pad device closes the game once', /quits=1/.test(r.stdout), r.stdout.trim());
check('after the game, an idle plugged-in pad doesn\'t keep the process alive', !r.error && r.status === 0 && Date.now() - t < 10000, r.error ? r.error.code : 'exit ' + r.status + ' after ' + (Date.now() - t) + ' ms');
console.log(fails ? `${fails} check(s) failed` : 'all passed'); process.exit(fails ? 1 : 0);
