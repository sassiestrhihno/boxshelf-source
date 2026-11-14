// Unit checks (beta.14, Settings > Sound): sound pack name matching, importing a folder and a ZIP (unsupported files
// listed, paths that point outside refused, size caps), Share as ZIP, the real instruments' WAV trimming, and the
// Instrument's Auto settings read from a MIDI file. Plain Node: node android-app/ci/soundpacks-unit-test.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const SP = require('../../main/soundpacks');
global.window = global.window || {};
require('../../renderer/songs.js');
const Songs = window.Songs;

let pass = 0, fail = 0;
const check = (name, ok, info) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (info ? ' :: ' + info : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-snd-test-'));
SP.setRoot(path.join(tmp, 'data'));
const wav = (secs = .1, rate = 8000) => { const n = Math.round(rate * secs), b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36, 'latin1'); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * 8000), 44 + i * 2); return b; };

(async () => {
  // ---------- name matching ----------
  const M = SP.matchName;
  const cases = [['cursor.wav', 'move'], ['SE_Cursor_01.ogg', 'move'], ['select-move.wav', 'move'], ['SelectMove2.wav', 'move'], ['click_003.ogg', 'move'],
    ['decide.wav', 'open'], ['select.wav', 'open'], ['OK.wav', 'open'], ['confirmation_001.ogg', 'open'], ['open_menu.mp3', 'open'],
    ['cancel.wav', 'back'], ['back_002.ogg', 'back'], ['close.flac', 'back'], ['start.wav', 'play'], ['boot.wav', 'play'], ['GameLaunch.wav', 'play'],
    ['error.wav', 'problem'], ['buzz.ogg', 'problem'], ['fail_2.wav', 'problem'], ['bgm.ogg', 'music'], ['menu-music.ogg', 'music'], ['Theme Loop.mp3', 'music'],
    ['whoosh.wav', ''], ['okay_then.wav', '']];
  const bad = cases.filter(([f, want]) => M(f) !== want).map(([f, want]) => `${f}: ${M(f)} (want ${want || 'none'})`);
  check('name matcher: cursor/move/click → Move, decide/select/ok/confirm → Open, cancel/back/close → Back, start/launch/boot → Play, error/buzz/fail → Problem, music/bgm/theme/loop → Music', !bad.length, bad.join('; '));
  const m = SP.matchAll(['cursor_02.wav', 'cursor_01.wav', 'decide.wav', 'bgm.ogg', 'error.wav']);
  check('matchAll: the first file for each moment in natural order, unmatched moments empty', m.move === 'cursor_01.wav' && m.open === 'decide.wav' && m.music === 'bgm.ogg' && m.problem === 'error.wav' && m.back === '' && m.play === '', JSON.stringify(m));
  const md = SP.matchAll(['click_003.ogg', 'confirmation_001.ogg', 'maximize_006.ogg'], { play: 'maximize_006.ogg', back: 'missing.ogg' });
  check('matchAll: a pack\'s defaults win when the file exists, are ignored when it doesn\'t', md.play === 'maximize_006.ogg' && md.back === '', JSON.stringify(md));
  check('a console in the pack\'s name: "PS2 menu sounds" plays only on PS2, "Wii U" on Wii U, "Clean UI" everywhere',
    JSON.stringify(SP.guessWhere('PS2 menu sounds')) === '["ps2"]' && JSON.stringify(SP.guessWhere('Wii U Menu')) === '["wiiu"]' && SP.guessWhere('Clean UI') === 'all');

  // ---------- import a folder ----------
  const src = path.join(tmp, 'PS2 menu'); fs.mkdirSync(path.join(src, 'more'), { recursive: true });
  for (const f of ['cursor.wav', 'decide.wav', 'cancel.wav', 'boot.wav']) fs.writeFileSync(path.join(src, f), wav());
  fs.writeFileSync(path.join(src, 'more', 'error.wav'), wav()); fs.writeFileSync(path.join(src, 'bgm.at3'), Buffer.from('not audio')); fs.writeFileSync(path.join(src, 'readme.txt'), 'hi');
  const p1 = await SP.importFrom([src]);
  check('import a folder: sounds copied, matched by name, sub-folders too', p1.id === 'ps2-menu' && p1.files.length === 5 && p1.matches.move === 'cursor.wav' && p1.matches.open === 'decide.wav' && p1.matches.back === 'cancel.wav' && p1.matches.play === 'boot.wav' && p1.matches.problem === 'error.wav', JSON.stringify(p1));
  check('import a folder: an unsupported file (bgm.at3) is listed in plain words, a readme is ignored', JSON.stringify(p1.unsupported) === '["bgm.at3"]', JSON.stringify(p1.unsupported));
  check('import a folder: "PS2 menu" plays only on PS2 to start with', JSON.stringify(p1.where) === '["ps2"]');
  check('the pack lists back with its pack.json', SP.list().some(p => p.id === 'ps2-menu' && p.matches.move === 'cursor.wav'));

  // ---------- import a ZIP, with paths that try to leave the folder ----------
  const zipFile = path.join(tmp, 'Clean UI.zip');
  fs.writeFileSync(zipFile, SP.makeZip([{ name: 'sounds/cursor.wav', data: wav() }, { name: 'sounds/select.wav', data: wav() }, { name: 'music/menu-bgm.wav', data: wav(.3) },
    { name: '../evil.wav', data: wav() }, { name: 'sub/../../evil2.wav', data: wav() }, { name: 'notes/License.txt', data: 'CC0' }, { name: 'sounds/beep.vag', data: 'x' }]));
  const idx = SP.zipIndex(zipFile);
  check('ZIP index read without unpacking', idx.length === 7 && idx.some(e => e.name === '../evil.wav'));
  check('ZIP entry names that point outside are refused', !SP.safeEntry('../evil.wav') && !SP.safeEntry('a/../../b.wav') && !SP.safeEntry('/abs.wav') && !SP.safeEntry('C:/x.wav') && SP.safeEntry('a/b/c.wav'));
  let p2 = null, e2 = null; try { p2 = await SP.importFrom([zipFile]); } catch (e) { e2 = e; }
  check('import a ZIP: the safe sounds come in and are matched (music too)', p2 && p2.files.length === 3 && p2.matches.move === 'cursor.wav' && p2.matches.open === 'select.wav' && p2.matches.music === 'menu-bgm.wav', e2 ? e2.message : JSON.stringify(p2));
  check('import a ZIP: nothing was written outside (no evil.wav anywhere near), the ".." entries were skipped', !fs.existsSync(path.join(tmp, 'evil.wav')) && !fs.existsSync(path.join(tmp, 'data', 'evil.wav')) && !fs.existsSync(path.join(tmp, 'data', 'sounds', 'evil.wav')) && p2 && p2.skipped.length === 2, p2 && JSON.stringify(p2.skipped));
  check('import a ZIP: beep.vag is listed as unsupported, License.txt is not', p2 && JSON.stringify(p2.unsupported) === '["beep.vag"]', p2 && JSON.stringify(p2.unsupported));
  // a ZIP that says it unpacks to more than 50 MB is turned away before anything is unpacked
  const big = SP.makeZip([{ name: 'a.wav', data: wav() }]), eocd = big.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), cd = big.readUInt32LE(eocd + 16);
  big.writeUInt32LE(60 << 20, cd + 24); const bigFile = path.join(tmp, 'big.zip'); fs.writeFileSync(bigFile, big);
  let e3 = null; try { await SP.importFrom([bigFile]); } catch (e) { e3 = e; }
  check('import a ZIP: more than 50 MB of sounds is refused', !!e3 && /too big/i.test(e3.message), e3 && e3.message);
  let e4 = null; try { await SP.importFrom([path.join(src, 'bgm.at3')]); } catch (e) { e4 = e; }
  check('import only unsupported files: a plain explanation', !!e4 && /not WAV, OGG, MP3 or FLAC/.test(e4.message), e4 && e4.message);

  // ---------- change, share, remove ----------
  const up = SP.update('ps2-menu', { name: 'PS2', matches: { music: 'cursor.wav', move: 'nope.wav' }, where: ['ps2', 'psx', 'BAD id!'] });
  check('change by hand: a match to one of its files, a missing file clears it, where keeps valid console ids', up.name === 'PS2' && up.matches.music === 'cursor.wav' && up.matches.move === '' && JSON.stringify(up.where) === '["ps2","psx"]', JSON.stringify(up));
  const outZip = path.join(tmp, 'share.zip'); SP.exportZip('ps2-menu', outZip);
  const names = SP.zipIndex(outZip).map(e => e.name).sort();
  check('Share as ZIP: its sounds and pack.json', names.includes('pack.json') && names.includes('cursor.wav') && names.length === 6, names.join(','));
  let rt = null; try { rt = await SP.importFrom([outZip]); } catch (e) { rt = { err: e.message }; }
  check('a shared ZIP imports again', rt && rt.files && rt.files.length === 5, JSON.stringify(rt));
  check('Remove: the pack folder goes', SP.remove('ps2-menu') && !fs.existsSync(path.join(SP.packsDir(), 'ps2-menu')) && !SP.list().some(p => p.id === 'ps2-menu'));
  check('Remove refuses an id that isn\'t a pack', SP.remove('../data') === false);
  let e5 = null; try { SP.read('clean-ui', '../../pack.json'); } catch (e) { e5 = e; }
  check('reading a file that isn\'t one of the pack\'s sounds is refused', !!e5);

  // ---------- real instruments: the first seconds of a note as a small mono WAV ----------
  { const rate = 44100, n = rate * 3, ch = 2, b = Buffer.alloc(46 + 8 + n * ch * 3); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8, 'latin1');
    b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(18, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(ch, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * ch * 3, 28); b.writeUInt16LE(ch * 3, 32); b.writeUInt16LE(24, 34); b.writeUInt16LE(0, 36);
    b.write('data', 38, 'latin1'); b.writeUInt32LE(n * ch * 3, 42); for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) b.writeIntLE(i < 2000 ? 0 : Math.round(Math.sin(i / 20) * 3e6), 46 + (i * ch + c) * 3, 3);
    const t = SP.wavTrim(b, 1.5), frames = (t.length - 44) / 2;
    check('real instruments: a 24-bit stereo WAV (odd fmt chunk) becomes 1.5 s of mono 16-bit, leading silence trimmed', t.readUInt16LE(22) === 1 && t.readUInt16LE(34) === 16 && t.readUInt32LE(24) === rate && frames === Math.round(rate * 1.5) && Math.abs(t.readInt16LE(44 + 400)) > 0, `${frames} frames`);
    check('real instruments: the last sample is faded to silence', Math.abs(t.readInt16LE(t.length - 2)) < 200); }
  check('real instruments: every note is pinned to one commit of the CC0 repository', Object.values(SP.VSCO).every(v => v.notes.every(([p, midi]) => typeof p === 'string' && midi > 20 && midi < 110)) && /VSCO-2-CE\/[0-9a-f]{40}\//.test(require('fs').readFileSync(require.resolve('../../main/soundpacks'), 'utf8')));

  // ---------- the Instrument's Auto settings from a MIDI file ----------
  const vlq = n => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
  function midiFile({ program, bpm, notes, ch = 0, extraTrack }) {
    const div = 96, tr = [];
    const ev = (dt, ...b) => tr.push(...vlq(dt), ...b);
    const us = Math.round(60e6 / bpm); ev(0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255);
    if (program != null) ev(0, 0xc0 | ch, program);
    notes.forEach((n, i) => { ev(i ? 0 : 0, 0x90 | ch, n, 90); ev(div / 2, 0x80 | ch, n, 0); });
    ev(0, 0xff, 0x2f, 0);
    const trk = t => [0x4d, 0x54, 0x72, 0x6b, (t.length >> 24) & 255, (t.length >> 16) & 255, (t.length >> 8) & 255, t.length & 255, ...t];
    const tracks = [trk(tr)]; if (extraTrack) tracks.push(trk(extraTrack));
    return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, tracks.length, 0, div, ...[].concat(...tracks)]);
  }
  const tune = [72, 74, 76, 77, 79, 77, 76, 74, 72, 76, 79, 84];
  const sPiano = Songs.parseMidi(midiFile({ program: 0, bpm: 100, notes: tune }), 'Piano tune');
  check('MIDI: the melody\'s program number and tempo are read', sPiano.program === 0 && sPiano.bpm === 100, JSON.stringify({ p: sPiano.program, bpm: sPiano.bpm }));
  check('MIDI: each note\'s time in seconds follows the tempo (an eighth at 100 bpm = 0.3 s)', Math.abs(sPiano.times[1] - .3) < .005 && Math.abs(sPiano.times[4] - 1.2) < .01, JSON.stringify(sPiano.times.slice(0, 5)));
  const a1 = Songs.settingsFor(sPiano, null, 'harp');
  check('Auto: a piano program plays on the Piano at the original speed, no octave shift when it sits in range', a1.inst === 'piano' && a1.rate === 1 && a1.shift === 0 && a1.label === 'Auto: Piano · original speed', JSON.stringify(a1));
  const sLead = Songs.parseMidi(midiFile({ program: 80, bpm: 140, notes: tune }), 'Chip tune');
  check('Auto: a square lead (program 80) plays on 8-bit', Songs.settingsFor(sLead).inst === 'chip');
  const sStr = Songs.parseMidi(midiFile({ program: 40, bpm: 90, notes: tune }), 'Strings');
  check('Auto: a violin program plays on the Violin', Songs.settingsFor(sStr).inst === 'violin');
  check('General MIDI map: music box → Music box, marimba → Marimba, flute → Flute, harp → Harp, organ → Flute, glockenspiel → Bells',
    Songs.gmInstrument(10) === 'box' && Songs.gmInstrument(12) === 'marimba' && Songs.gmInstrument(73) === 'flute' && Songs.gmInstrument(46) === 'harp' && Songs.gmInstrument(19) === 'flute' && Songs.gmInstrument(9) === 'bells');
  const low = Songs.parseMidi(midiFile({ program: 73, bpm: 100, notes: tune.map(n => n - 36) }), 'Low flute');
  const a2 = Songs.settingsFor(low);
  check('Auto: a tune below the flute\'s range moves up by whole octaves (only because it has to)', a2.inst === 'flute' && a2.shift > 0 && a2.shift % 12 === 0 && a2.notes.every(n => n >= 55) && /up \d octave/.test(a2.label), JSON.stringify({ shift: a2.shift, label: a2.label }));
  const sNone = Songs.parseMidi(midiFile({ program: null, bpm: 120, notes: tune }), 'No program');
  check('Auto: no program in the file plays on your chosen instrument', sNone.program === -1 && Songs.settingsFor(sNone, null, 'harp').inst === 'harp');
  const mine = Songs.settingsFor(sPiano, { mode: 'mine', inst: 'marimba', speed: 'faster', key: 2 });
  check('My instrument: your instrument, speed and key per song', mine.inst === 'marimba' && mine.rate === 1.25 && mine.shift === 2 && !mine.auto && /Marimba · faster · \+2/.test(mine.label), JSON.stringify(mine));
  const b0 = Songs.builtIn[0], tb = Songs.timesOf(b0);
  check('built-in songs get an even pace for ▶ (one time per note, rising)', tb.length === b0.notes.length && tb.every((t, i) => !i || t > tb[i - 1]));

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\nsound packs unit test: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
