// (beta.7) "Set up for me": Boxshelf sets an emulator up the way the shelf expects, one switch per kind of change.
//   controller  the first pad mapped (only when the emulator is still on keyboard-only controls: a mapping you made is kept)
//   hotkeys     save / load / pause / screenshot on the keys the Home menu presses (main/homemenu.js HOTKEYS)
//   bios        one shared BIOS folder (Boxshelf\BIOS), only when the emulator's own BIOS folder has nothing in it
//   graphics    a resolution preset: fast / balanced / pretty (picked for this PC unless you choose)
//   quit        no "are you sure?" question when the game is closed
//   resume      (RetroArch, off unless chosen) save on quit, carry on where you left off next time
//   picture     (beta.14, off unless chosen) screen shape, sharp pixels and a retro TV look, each only where the emulator has it
// Every file is backed up once before its first change (<file>.boxshelf-bak, the same backups Settings → Restore emulator
// settings puts back), written whole through a temp file, and listed in data/emu-setup.json so Undo puts exactly those
// back. Fullscreen needs nothing here: every launch already passes each emulator's fullscreen option.
// Setting names checked against each emulator's source (2026-11): DuckStation settings.cpp / hotkeys.cpp, PCSX2
// QtHost.cpp / Pcsx2Config.cpp / Hotkeys.cpp, PPSSPP Config.cpp, RetroArch configuration.c (confirm_quit replaced
// quit_press_twice; both are written so older builds listen too).
// (beta.14) Picture settings checked 2026-11-11 against: RetroArch v1.22.2 configuration.c (video_scale_integer,
// aspect_ratio_index, video_shader_enable, auto_shaders_enable, video_shader_dir, rgui_config_directory), gfx/video_defines.h
// (aspect index 22 = "Core provided"), gfx/video_shader_parse.c (the global preset: <menu config folder>\global.slangp or
// .glslp, loaded for every core) and libretro-common config_file.c (the `#reference "path"` line); libretro slang-shaders /
// glsl-shaders crt\ presets; DuckStation master settings.cpp / settings.h ([Display] AspectRatio, Scaling, [GPU]
// WidescreenHack) and util/postprocessing.cpp ([PostProcessing] Enabled / StageCount, [PostProcessing/Stage1] ShaderName,
// resources\shaders\crt-lottes.glsl); PCSX2 master Pcsx2Config.cpp / Config.h / Patch.cpp ([EmuCore/GS] AspectRatio,
// IntegerScaling, [EmuCore] EnableWideScreenPatches: "Auto 4:3/3:2" turns 16:9 only for a game with a widescreen patch;
// TVShader is the TV Shader list's index: pcsx2-qt GraphicsSettingsWidget.cpp / GraphicsPostProcessingSettingsTab.ui and
// GS/Renderers/Common/GSRenderer.cpp s_tv_shader_indices, 5 = Lottes CRT, 0 = None);
// Dolphin master Core/Config/GraphicsSettings.cpp / VideoCommon/VideoConfig.h (GFX.ini [Settings] AspectRatio 0 = Auto,
// wideScreenHack; no integer scaling); PPSSPP v1.20.4 and v1.19.3 Config.cpp (DisplayIntegerScale, in
// [DisplayLayout.Landscape] from 1.20, read from [Graphics] while that section isn't there; [PostShaderList] PostShader1..n,
// "Off" = none) and assets/shaders/defaultshaders.ini (the [CRT] shader, "CRT Scanlines").
const fs = require('fs');
const path = require('path');
const os = require('os');
const emucfg = require('./emucfg');

let log = () => {}, dataDir = '', appRoot = '';
function init(o) { log = o.log || log; dataDir = o.dataDir || ''; appRoot = o.appRoot || ''; }

const GROUPS = ['controller', 'hotkeys', 'bios', 'graphics', 'quit', 'resume', 'picture'];
const GROUP_NAME = { controller: 'Controller', hotkeys: 'Home menu hotkeys', bios: 'BIOS folder', graphics: 'Graphics', quit: 'No quit questions', resume: 'Resume where you left off', picture: 'Picture' };
const DEFAULT_ON = { controller: true, hotkeys: true, bios: true, graphics: true, quit: true, resume: false, picture: false };
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const firstFile = list => list.find(isFile) || null;
const localAppData = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const appData = () => process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');

function kindOf(exe) {
  const n = path.basename(exe || '').toLowerCase();
  if (/^retroarch/.test(n)) return 'retroarch';
  if (/dolphin/.test(n)) return 'dolphin';
  if (/duckstation/.test(n)) return 'duckstation';
  if (/pcsx2/.test(n)) return 'pcsx2';
  if (/ppsspp/.test(n)) return 'ppsspp';
  return null;
}
const EMU_NAME = { retroarch: 'RetroArch', dolphin: 'Dolphin', duckstation: 'DuckStation', pcsx2: 'PCSX2', ppsspp: 'PPSSPP' };

// ---------- where each one keeps its settings ----------
function raCfg(exe) { const own = path.join(path.dirname(exe), 'retroarch.cfg'), roam = path.join(appData(), 'RetroArch', 'retroarch.cfg'); return isFile(own) ? own : isFile(roam) ? roam : own; } // (a fresh RetroArch makes its own beside the exe)
function dolphinDir(exe) { return emucfg.dolphinUserDirs(exe).find(d => isDir(path.join(d, 'Config'))) || null; }
function duckIni(exe) { const dir = path.dirname(exe); return firstFile([...(isFile(path.join(dir, 'portable.txt')) ? [path.join(dir, 'settings.ini')] : []), path.join(localAppData(), 'DuckStation', 'settings.ini'), ...emucfg.docsDirs().map(d => path.join(d, 'DuckStation', 'settings.ini'))]); }
function pcsx2Ini(exe) { return firstFile(emucfg.pcsx2Inis(exe)); }
function ppssppIni(exe) { const dir = path.dirname(exe); return firstFile([path.join(dir, 'memstick', 'PSP', 'SYSTEM', 'ppsspp.ini'), ...emucfg.docsDirs().map(d => path.join(d, 'PPSSPP', 'PSP', 'SYSTEM', 'ppsspp.ini'))]); }
// The settings file this emulator has (null: it hasn't been opened yet, so there's nothing to set up; RetroArch is the
// exception, it reads a file Boxshelf starts for it)
function mainFile(kind, exe) {
  if (kind === 'retroarch') return raCfg(exe);
  if (kind === 'dolphin') { const d = dolphinDir(exe); return d ? path.join(d, 'Config', 'Dolphin.ini') : null; }
  if (kind === 'duckstation') return duckIni(exe);
  if (kind === 'pcsx2') return pcsx2Ini(exe);
  if (kind === 'ppsspp') return ppssppIni(exe);
  return null;
}

// ---------- reading ----------
function readText(f) { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return ''; } }
function iniGet(text, section, key) {
  let sec = ''; for (const l of text.split(/\r?\n/)) { const m = /^\s*\[(.+)\]\s*$/.exec(l); if (m) { sec = m[1]; continue; } if (sec !== section) continue;
    const i = l.indexOf('='); if (i > 0 && l.slice(0, i).trim() === key) return l.slice(i + 1).trim(); }
  return null;
}
function iniSection(text, section) { const out = {}; let sec = ''; for (const l of text.split(/\r?\n/)) { const m = /^\s*\[(.+)\]\s*$/.exec(l); if (m) { sec = m[1]; continue; } if (sec !== section) continue; const i = l.indexOf('='); if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } return out; }
function cfgGet(text, key) { const m = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*"([^"]*)"', 'm').exec(text); return m ? m[1] : null; }

// ---------- BIOS ----------
const BIOS_EXT = /\.(bin|rom|zip|img|bios)$/i;
// (beta.12) a folder with anything in it counts as in use: RetroArch's system\ often holds only the cores' own subfolders
// (PPSSPP\, dolphin-emu\, scummvm\), and moving system_directory away from them left those cores without their files
const hasBiosFiles = d => { try { return fs.readdirSync(d, { withFileTypes: true }).some(e => e.isDirectory() || BIOS_EXT.test(e.name)); } catch { return false; } };
function sharedBiosDir() { return path.join(appRoot || path.dirname(dataDir || '.'), 'BIOS'); }
// the folder each emulator reads its BIOS files from right now
function biosDirOf(kind, exe) {
  try {
    if (kind === 'retroarch') { const v = cfgGet(readText(raCfg(exe)), 'system_directory'); return v && v !== 'default' ? v.replace(/^:[\\/]?/, path.dirname(exe) + path.sep) : path.join(path.dirname(exe), 'system'); }
    if (kind === 'duckstation') { const f = duckIni(exe); if (!f) return null; const v = iniGet(readText(f), 'BIOS', 'SearchDirectory') || 'bios'; return path.isAbsolute(v) ? v : path.join(path.dirname(f), v); }
    if (kind === 'pcsx2') { const f = pcsx2Ini(exe); if (!f) return null; const v = iniGet(readText(f), 'Folders', 'Bios') || 'bios'; return path.isAbsolute(v) ? v : path.join(path.dirname(path.dirname(f)), v); }
  } catch {}
  return null;
}
const PS2_BIOS = /^(scph|ps2|bios).*\.bin$/i;

// ---------- (beta.14) Picture ----------
const PIC_WHAT = { shape: 'Screen shape', wide: 'Widescreen', sharp: 'Sharp pixels', crt: 'Retro TV look' };
// RetroArch's own folders as its settings name them (":" is the folder RetroArch is in)
const raDir = (exe, key, def) => { const v = cfgGet(readText(raCfg(exe)), key); return v && v !== 'default' ? v.replace(/^:[\\/]?/, path.dirname(exe) + path.sep) : path.join(path.dirname(exe), def); };
const RA_CRT = ['crt-easymode', 'crt-lottes', 'crt-geom', 'crt-pi']; // (the first one its shaders folder has, in crt\ of the slang and glsl packs)
const presetText = ref => `#reference "${ref}"`;
// RetroArch's retro TV look: a global shader preset (its config folder's global.slangp / global.glslp, one per shader kind so
// any video driver finds one) that only points at a CRT preset in RetroArch's own shaders folder. Returns { files } or { why }.
function raCrt(exe) {
  const sh = raDir(exe, 'video_shader_dir', 'shaders'), conf = raDir(exe, 'rgui_config_directory', 'config'), files = [];
  for (const t of ['slang', 'glsl']) {
    const name = RA_CRT.find(n => isFile(path.join(sh, 'shaders_' + t, 'crt', n + '.' + t + 'p'))); if (!name) continue;
    const target = path.join(sh, 'shaders_' + t, 'crt', name + '.' + t + 'p'); let ref = path.relative(conf, target); if (!ref || path.isAbsolute(ref)) ref = target;
    files.push({ file: path.join(conf, 'global.' + t + 'p'), ref: ref.split(path.sep).join('/') });
  }
  if (!files.length) return { why: "RetroArch's CRT shaders aren't there yet (its Online Updater gets them)" };
  // a global preset of your own, in any of the places RetroArch looks for one, is kept
  for (const d of [conf, path.dirname(raCfg(exe)), path.join(sh, 'presets')]) for (const e of ['slangp', 'glslp', 'cgp']) {
    const f = path.join(d, 'global.' + e), ours = files.find(x => path.resolve(x.file).toLowerCase() === path.resolve(f).toLowerCase());
    if (isFile(f) && !(ours && readText(f).trim() === presetText(ours.ref))) return { why: 'it already uses a shader of your own' }; }
  return { files };
}
const DUCK_CRT = 'crt-lottes'; // (DuckStation's own CRT shader, resources\shaders\crt-lottes.glsl beside the exe)
function duckCrt(exe, t) {
  if (!isFile(path.join(path.dirname(exe), 'resources', 'shaders', DUCK_CRT + '.glsl'))) return { why: "this DuckStation doesn't have its CRT shader" };
  const n = parseInt(iniGet(t, 'PostProcessing', 'StageCount') || '0', 10) || 0;
  if (n > 1 || (n === 1 && iniGet(t, 'PostProcessing/Stage1', 'ShaderName') !== DUCK_CRT)) return { why: 'it already uses picture filters of your own' };
  return { ok: true };
}
// What this emulator's picture can do: { shape, wide, sharp, crt } (true where it has a real setting), why (each one it
// can't), and write(o, add): the changes for o = { shape: 'original' | 'wide' | null, sharp: true | false | null, crt }
function pictureOf(kind, exe) {
  const P = { shape: false, wide: false, sharp: false, crt: false, why: {}, write: () => {} };
  const noCrt = () => { P.why.crt = `not offered for ${EMU_NAME[kind]} yet`; };
  if (kind === 'retroarch') {
    const f = raCfg(exe), crt = raCrt(exe);
    Object.assign(P, { shape: true, sharp: true, crt: !!crt.files });
    P.why.wide = 'a wide picture would only stretch the games'; if (!crt.files) P.why.crt = crt.why;
    P.write = (o, add) => {
      if (o.shape === 'original') add('picture', f, 'cfg', null, { aspect_ratio_index: '22' }); // (22: "Core provided", the console's own shape)
      if (o.sharp != null) add('picture', f, 'cfg', null, { video_scale_integer: String(o.sharp) });
      if (o.crt && crt.files) { add('picture', f, 'cfg', null, { video_shader_enable: 'true', auto_shaders_enable: 'true' }); for (const x of crt.files) add('picture', x.file, 'preset', null, { '#reference': x.ref }); }
    };
  } else if (kind === 'dolphin') {
    const d = dolphinDir(exe); if (!d) return P;
    const gfx = path.join(d, 'Config', 'GFX.ini');
    P.shape = true; P.why.wide = 'Wii games are wide by themselves; GameCube ones need a code for each game'; P.why.sharp = 'Dolphin has no setting for it'; noCrt();
    P.write = (o, add) => { if (o.shape === 'original') add('picture', gfx, 'ini', 'Settings', { AspectRatio: '0', wideScreenHack: 'False' }); }; // (0: Auto, the game's own shape)
  } else if (kind === 'duckstation') {
    const f = duckIni(exe); if (!f) return P;
    const t = readText(f), crt = duckCrt(exe, t);
    Object.assign(P, { shape: true, wide: true, sharp: true, crt: !!crt.ok }); if (!crt.ok) P.why.crt = crt.why;
    P.write = (o, add) => {
      if (o.shape) { add('picture', f, 'ini', 'Display', { AspectRatio: o.shape === 'wide' ? '16:9' : 'Auto (Game Native)' }); add('picture', f, 'ini', 'GPU', { WidescreenHack: String(o.shape === 'wide') }); }
      // sharp off: a whole-number scaling goes back to DuckStation's own (smooth); any other choice of yours is kept
      if (o.sharp) add('picture', f, 'ini', 'Display', { Scaling: 'NearestInteger' });
      else if (o.sharp === false && /Integer$/.test(iniGet(t, 'Display', 'Scaling') || '')) add('picture', f, 'ini', 'Display', { Scaling: 'BilinearSmooth' });
      if (o.crt && crt.ok) { add('picture', f, 'ini', 'PostProcessing', { Enabled: 'true', StageCount: '1' }); add('picture', f, 'ini', 'PostProcessing/Stage1', { ShaderName: DUCK_CRT }); }
    };
  } else if (kind === 'pcsx2') {
    const f = pcsx2Ini(exe); if (!f) return P;
    // TV shader: the TV Shader list's index, 5 = Lottes CRT (0 = None); any other one you chose is kept
    const tv = (iniGet(readText(f), 'EmuCore/GS', 'TVShader') || '0').trim(), tvMine = !/^(0|5)$/.test(tv);
    Object.assign(P, { shape: true, wide: true, sharp: true, crt: !tvMine }); if (tvMine) P.why.crt = 'it already uses a TV filter of your own';
    P.write = (o, add) => {
      // "Auto 4:3/3:2" is 4:3, and 16:9 for a game PCSX2 has a widescreen patch for (only while those patches are on)
      if (o.shape) { add('picture', f, 'ini', 'EmuCore', { EnableWideScreenPatches: String(o.shape === 'wide') }); add('picture', f, 'ini', 'EmuCore/GS', { AspectRatio: 'Auto 4:3/3:2' }); }
      if (o.sharp != null) add('picture', f, 'ini', 'EmuCore/GS', { IntegerScaling: String(o.sharp) });
      if (o.crt && !tvMine) add('picture', f, 'ini', 'EmuCore/GS', { TVShader: '5' });
    };
  } else if (kind === 'ppsspp') {
    const f = ppssppIni(exe); if (!f) return P;
    const t = readText(f), sec = /^\s*\[DisplayLayout\.Landscape\]\s*$/m.test(t) ? 'DisplayLayout.Landscape' : 'Graphics';
    // its own "CRT" post shader (CRT Scanlines, assets\shaders\defaultshaders.ini beside the exe), only while no post shader is on
    const has = /^\s*\[CRT\]\s*$/m.test(readText(path.join(path.dirname(exe), 'assets', 'shaders', 'defaultshaders.ini')));
    const posts = Object.values(iniSection(t, 'PostShaderList')).filter(v => v && v !== 'Off'), mine = posts.some(v => v !== 'CRT');
    P.sharp = true; P.crt = has && !mine; P.why.shape = "the PSP's screen is wide already";
    if (!has) P.why.crt = "this PPSSPP doesn't have its CRT shader"; else if (mine) P.why.crt = 'it already uses a picture filter of your own';
    P.write = (o, add) => {
      if (o.sharp != null) add('picture', f, 'ini', sec, { DisplayIntegerScale: o.sharp ? 'True' : 'False' });
      if (o.crt && P.crt) add('picture', f, 'ini', 'PostShaderList', { PostShader1: 'CRT' });
    };
  }
  return P;
}

// ---------- the plan: every change this would make, as { group, file, fmt, section?, key, value, note? } ----------
const SDL = { Up: 'DPadUp', Right: 'DPadRight', Down: 'DPadDown', Left: 'DPadLeft', Triangle: 'Y', Circle: 'B', Cross: 'A', Square: 'X', Select: 'Back', Start: 'Start',
  L1: 'LeftShoulder', R1: 'RightShoulder', L2: '+LeftTrigger', R2: '+RightTrigger', L3: 'LeftStick', R3: 'RightStick',
  LUp: '-LeftY', LDown: '+LeftY', LLeft: '-LeftX', LRight: '+LeftX', RUp: '-RightY', RDown: '+RightY', RLeft: '-RightX', RRight: '+RightX', LargeMotor: 'LargeMotor', SmallMotor: 'SmallMotor' };
// (no "Analog" button: the pad's Guide button is the Home menu's)
const sdlPad = type => Object.assign({ Type: type }, ...Object.entries(SDL).map(([k, v]) => ({ [k]: 'SDL-0/' + v })));
const padIsSet = sec => Object.entries(sec).some(([k, v]) => k !== 'Type' && /SDL-|XInput-|DInput-/i.test(v));
const DOLPHIN_PAD = { Device: 'XInput/0/Gamepad', 'Buttons/A': '`Button A`', 'Buttons/B': '`Button B`', 'Buttons/X': '`Button X`', 'Buttons/Y': '`Button Y`', 'Buttons/Z': '`Shoulder R`', 'Buttons/Start': '`Start`',
  'Main Stick/Up': '`Left Y+`', 'Main Stick/Down': '`Left Y-`', 'Main Stick/Left': '`Left X-`', 'Main Stick/Right': '`Left X+`',
  'C-Stick/Up': '`Right Y+`', 'C-Stick/Down': '`Right Y-`', 'C-Stick/Left': '`Right X-`', 'C-Stick/Right': '`Right X+`',
  'Triggers/L': '`Trigger L`', 'Triggers/R': '`Trigger R`', 'Triggers/L-Analog': '`Trigger L`', 'Triggers/R-Analog': '`Trigger R`',
  'D-Pad/Up': '`Pad N`', 'D-Pad/Down': '`Pad S`', 'D-Pad/Left': '`Pad W`', 'D-Pad/Right': '`Pad E`', 'Rumble/Motor': '`Motor L` | `Motor R`' };
const RES = { dolphin: { fast: '1', balanced: '2', pretty: '3' }, duckstation: { fast: '1', balanced: '2', pretty: '4' }, pcsx2: { fast: '1', balanced: '2', pretty: '3' }, ppsspp: { fast: '1', balanced: '2', pretty: '4' } };

function plan(kind, exe, opts = {}) {
  const out = [], skipped = [], add = (group, file, fmt, section, want, note) => { for (const [key, value] of Object.entries(want)) out.push({ group, file, fmt, section, key, value, note }); };
  const preset = ['fast', 'balanced', 'pretty'].includes(opts.graphics) ? opts.graphics : 'balanced';
  const bios = opts.biosDir || sharedBiosDir();
  const biosFree = d => !d || !hasBiosFiles(d);
  if (kind === 'retroarch') {
    const f = raCfg(exe);
    add('quit', f, 'cfg', null, { confirm_quit: 'false', quit_press_twice: 'false' });
    add('hotkeys', f, 'cfg', null, { input_save_state: 'f2', input_load_state: 'f4', input_screenshot: 'f8' });
    add('controller', f, 'cfg', null, { input_autodetect_enable: 'true' });
    if (biosFree(biosDirOf(kind, exe))) add('bios', f, 'cfg', null, { system_directory: bios }); else skipped.push({ group: 'bios', why: 'its system folder already has BIOS files' });
    add('resume', f, 'cfg', null, { savestate_auto_save: 'true', savestate_auto_load: 'true' });  } else if (kind === 'dolphin') {
    const d = dolphinDir(exe); if (!d) return { ok: false, why: 'open Dolphin once first', changes: [] };
    const pad = path.join(d, 'Config', 'GCPadNew.ini'), cur = iniSection(readText(pad), 'GCPad1');
    if (!cur.Device || /keyboard/i.test(cur.Device)) { add('controller', pad, 'ini', 'GCPad1', DOLPHIN_PAD); add('controller', path.join(d, 'Config', 'Dolphin.ini'), 'ini', 'Core', { SIDevice0: '6' }); }
    else skipped.push({ group: 'controller', why: 'a controller is already mapped' });
    add('graphics', path.join(d, 'Config', 'GFX.ini'), 'ini', 'Settings', { InternalResolution: RES.dolphin[preset] });  } else if (kind === 'duckstation') {
    const f = duckIni(exe); if (!f) return { ok: false, why: 'open DuckStation once first', changes: [] };
    const t = readText(f);
    add('quit', f, 'ini', 'Main', { ConfirmPowerOff: 'false' });
    add('hotkeys', f, 'ini', 'Hotkeys', { TogglePause: 'Keyboard/Space', SaveSelectedSaveState: 'Keyboard/F2', LoadSelectedSaveState: 'Keyboard/F1', Screenshot: 'Keyboard/F10' });
    if (!padIsSet(iniSection(t, 'Pad1'))) add('controller', f, 'ini', 'Pad1', sdlPad('AnalogController')); else skipped.push({ group: 'controller', why: 'a controller is already mapped' });
    if (biosFree(biosDirOf(kind, exe))) add('bios', f, 'ini', 'BIOS', { SearchDirectory: bios }); else skipped.push({ group: 'bios', why: 'its BIOS folder already has files' });
    add('graphics', f, 'ini', 'GPU', { ResolutionScale: RES.duckstation[preset] });  } else if (kind === 'pcsx2') {
    const f = pcsx2Ini(exe); if (!f) return { ok: false, why: 'open PCSX2 once first', changes: [] };
    const t = readText(f);
    add('quit', f, 'ini', 'UI', { ConfirmShutdown: 'false' });
    add('hotkeys', f, 'ini', 'Hotkeys', { TogglePause: 'Keyboard/Space', SaveStateToSlot: 'Keyboard/F1', LoadStateFromSlot: 'Keyboard/F3', Screenshot: 'Keyboard/F8' });
    if (!padIsSet(iniSection(t, 'Pad1'))) add('controller', f, 'ini', 'Pad1', sdlPad('DualShock2')); else skipped.push({ group: 'controller', why: 'a controller is already mapped' });
    // PCSX2 needs one BIOS file chosen, not only a folder: only when the shared folder has a PS2 BIOS in it
    const cur = biosDirOf(kind, exe); let ps2 = null; try { ps2 = fs.readdirSync(bios).find(n => PS2_BIOS.test(n)); } catch {}
    if (!biosFree(cur)) skipped.push({ group: 'bios', why: 'its BIOS folder already has files' });
    else if (!ps2) skipped.push({ group: 'bios', why: 'no PS2 BIOS in the BIOS folder yet' });
    else { add('bios', f, 'ini', 'Folders', { Bios: bios }); add('bios', f, 'ini', 'Filenames', { BIOS: ps2 }); }
    add('graphics', f, 'ini', 'EmuCore/GS', { upscale_multiplier: RES.pcsx2[preset] });  } else if (kind === 'ppsspp') {
    const f = ppssppIni(exe); if (!f) return { ok: false, why: 'open PPSSPP once first', changes: [] };
    add('graphics', f, 'ini', 'Graphics', { InternalResolution: RES.ppsspp[preset] });
  } else return { ok: false, why: 'not one Boxshelf can set up yet', changes: [] };
  // (beta.14) Picture: the choices in Settings (opts.shape / sharp / crt); anything this emulator hasn't got is listed as skipped
  const pic = pictureOf(kind, exe);
  for (const k of ['shape', 'wide', 'sharp', 'crt']) if (pic.why[k]) skipped.push({ group: 'picture', what: PIC_WHAT[k], why: pic.why[k] });
  const shape = (opts.shape === 'original' || (opts.shape === 'wide' && pic.wide)) && pic.shape ? opts.shape : null; // (wide where there's none: the shape is left as it is)
  pic.write({ shape, sharp: pic.sharp && typeof opts.sharp === 'boolean' ? opts.sharp : null, crt: pic.crt && opts.crt === true }, add);
  return { ok: true, changes: out, skipped, groups: [...new Set(out.map(c => c.group))] };
}

// ---------- writing ----------
// RetroArch's retroarch.cfg: `key = "value"` lines, no sections. Same safety as emucfg's ini writer.
function setCfg(f, want) {
  let buf = null; try { buf = fs.readFileSync(f); } catch (e) { if (e.code !== 'ENOENT') { log('RetroArch config could not be read, left alone:', e.code || e.message); return false; } }
  if (buf && buf.includes(0)) return false;
  if (buf && !Buffer.from(buf.toString('utf8'), 'utf8').equals(buf)) { log('RetroArch config is not UTF-8 text (an ANSI path?), left alone:', f); return false; } // (beta.10: written back, those bytes would have become U+FFFD)
  const src = buf ? buf.toString('utf8') : '', nl = src.includes('\r\n') ? '\r\n' : '\n', lines = src ? src.split(/\r?\n/) : [], seen = new Set(); let changed = false;
  for (let i = 0; i < lines.length; i++) { const m = /^\s*([A-Za-z0-9_]+)\s*=/.exec(lines[i]); if (!m || want[m[1]] === undefined) continue; seen.add(m[1]);
    if (want[m[1]] === null) { lines.splice(i, 1); i--; changed = true; continue; } // (beta.12) null: the key goes (undo of "it wasn't there")
    const v = `${m[1]} = "${want[m[1]]}"`; if (lines[i] !== v) { lines[i] = v; changed = true; } }
  for (const k of Object.keys(want)) if (!seen.has(k) && want[k] !== null) { if (lines.length && lines[lines.length - 1] === '') lines.pop(); lines.push(`${k} = "${want[k]}"`); changed = true; }
  if (!changed) return false;
  if (buf) { const bak = f + '.boxshelf-bak'; if (!fs.existsSync(bak)) fs.copyFileSync(f, bak); }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp'; try { fs.writeFileSync(tmp, lines.join(nl) + nl); fs.renameSync(tmp, f); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  return true;
}
// (beta.14) RetroArch's global shader preset: a small file Boxshelf starts (one `#reference "path"` line). Only made when it
// isn't there, never written over (Undo takes it away again while it's still Boxshelf's)
function setPreset(f, want) {
  const ref = want['#reference']; if (ref == null || fs.existsSync(f)) return false;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp'; try { fs.writeFileSync(tmp, presetText(ref) + '\n'); fs.renameSync(tmp, f); } catch (e) { try { fs.unlinkSync(tmp); } catch {} throw e; }
  return true;
}

const fileHash = f => { try { return require('crypto').createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return null; } };
const manifestFile = () => path.join(dataDir, 'emu-setup.json');
function manifest() { try { const m = JSON.parse(fs.readFileSync(manifestFile(), 'utf8')); return m && typeof m === 'object' ? m : {}; } catch { return {}; } }
function saveManifest(m) { try { const f = manifestFile(), tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(m, null, 1)); fs.renameSync(tmp, f); } catch (e) { log('Emulator setup: could not save its list', e.message); } }
const keyOf = (kind, exe) => kind + '|' + path.resolve(exe).toLowerCase();

// Applies the switched-on groups. on: { controller: true, ... } (missing = the default). Returns { ok, applied, skipped, files }.
function apply(exe, on = {}, opts = {}) {
  const kind = kindOf(exe); if (!kind) return { ok: false, why: 'not one Boxshelf can set up yet' };
  if (!isFile(exe)) return { ok: false, why: 'the emulator isn\'t there any more' };
  const p = plan(kind, exe, opts); if (!p.ok) return p;
  const want = g => on[g] !== undefined ? !!on[g] : DEFAULT_ON[g];
  const use = p.changes.filter(c => want(c.group));
  if (opts.biosDir !== '' && use.some(c => c.group === 'bios')) { try { fs.mkdirSync(opts.biosDir || sharedBiosDir(), { recursive: true }); } catch {} }
  const byFile = new Map(); for (const c of use) { const k = c.file + '\0' + (c.section || ''); if (!byFile.has(k)) byFile.set(k, { file: c.file, fmt: c.fmt, section: c.section, want: {} }); byFile.get(k).want[c.key] = c.value; }
  const m = manifest(), key = keyOf(kind, exe), rec = m[key] || { kind, exe, files: [], created: [], groups: [] };
  // (beta.12) each key's value before Boxshelf first changed it (null: it wasn't there), so Undo puts back just those keys
  // and leaves everything the user (or the emulator) changed since alone
  // A file setup touches first is also copied as it is now (<file>.boxshelf-setup) and the text setup leaves in it is
  // fingerprinted (hash): if it's still that text at Undo, the copy goes back exactly (or a file setup started goes)
  rec.prev = rec.prev || {}; rec.hash = rec.hash || {}; rec.madeBak = rec.madeBak || [];
  const done = [];
  for (const { file, fmt, section, want: w } of byFile.values()) {
    const existed = isFile(file), first = !rec.files.includes(file), bakHad = isFile(file + '.boxshelf-bak');
    try {
      const pk = file + '\0' + (section || ''), cur = fmt === 'cfg' ? null : iniSection(readText(file), section), text = fmt === 'cfg' ? readText(file) : '';
      const before = {}; for (const k of Object.keys(w)) before[k] = fmt === 'cfg' ? cfgGet(text, k) : cur[k] !== undefined ? cur[k] : null;
      if (first && existed) { try { fs.copyFileSync(file, file + '.boxshelf-setup'); } catch (e) { log(EMU_NAME[kind], 'setup: no copy of', path.basename(file), e.message); } }
      const changed = fmt === 'cfg' ? setCfg(file, w) : fmt === 'preset' ? setPreset(file, w) : emucfg.setIni(file, section, w, EMU_NAME[kind] + ' setup:');
      if (changed) { if (!rec.files.includes(file)) rec.files.push(file); if (!existed && !rec.created.includes(file)) rec.created.push(file); done.push(file);
        if (!bakHad && isFile(file + '.boxshelf-bak') && !rec.madeBak.includes(file)) rec.madeBak.push(file);
        const e = rec.prev[pk] || (rec.prev[pk] = { file, fmt, section: section || null, keys: {} }); for (const k of Object.keys(w)) if (!(k in e.keys)) e.keys[k] = before[k]; }
      else if (first && existed) { try { fs.unlinkSync(file + '.boxshelf-setup'); } catch {} }
      if (rec.files.includes(file)) rec.hash[file] = fileHash(file);
    } catch (e) { log(EMU_NAME[kind], 'setup: could not write', file, e.message);
      // (beta.12) what was already written in this run is on record, so Undo can still put it back
      if (done.length) { rec.at = Date.now(); m[key] = rec; saveManifest(m); }
      return { ok: false, why: `couldn't write ${path.basename(file)} (${e.code || e.message})`, applied: [] }; }
  }
  const groups = [...new Set(use.map(c => c.group))];
  rec.groups = [...new Set([...rec.groups, ...groups])]; rec.at = Date.now(); m[key] = rec; saveManifest(m);
  log(EMU_NAME[kind], 'set up:', groups.join(', ') || 'nothing to change', done.length ? '(' + done.map(f => path.basename(f)).join(', ') + ')' : '');
  return { ok: true, kind, applied: groups, skipped: p.skipped.filter(s => want(s.group)), files: done };
}

// (beta.12) Puts back just the keys this setup changed, as they were before (a key that wasn't there goes again). Never
// deletes a file or copies an old backup over it: the emulator writes its own settings into these files after setup
// (RetroArch saves its whole config on exit), and the old way wiped them. A setup recorded by an older version (no
// per-key record) is only undone for a file that hasn't changed since: otherwise it's left as it is.
function undo(exe) {
  const kind = kindOf(exe); const m = manifest(), key = kind && keyOf(kind, exe), rec = key && m[key]; if (!rec) return { ok: true, restored: [] };
  const restored = [], kept = [];
  if (rec.prev && rec.hash) {
    for (const f of rec.files) {
      try {
        const snap = f + '.boxshelf-setup', same = isFile(f) && rec.hash[f] && fileHash(f) === rec.hash[f];
        if (same && rec.created.includes(f)) { fs.unlinkSync(f); restored.push(f); }
        else if (same && isFile(snap)) { const tmp = f + '.tmp'; fs.copyFileSync(snap, tmp); fs.renameSync(tmp, f); restored.push(f); }
        else { // changed since the setup (the emulator saved its settings into it): only setup's own keys go back
          // (a shader preset Boxshelf started that's different now was saved over by you in RetroArch: it's yours, so it stays)
          for (const e of Object.values(rec.prev)) if (e.file === f && e.fmt !== 'preset') { const ch = e.fmt === 'cfg' ? setCfg(f, e.keys) : emucfg.setIni(f, e.section, e.keys, EMU_NAME[kind] + ' setup undo:'); if (ch && !restored.includes(f)) restored.push(f); }
          if (isFile(f)) kept.push(f); }
        try { fs.unlinkSync(snap); } catch {}
        if (same && (rec.madeBak || []).includes(f)) { try { fs.unlinkSync(f + '.boxshelf-bak'); } catch {} }
      } catch (err) { log('Emulator setup undo:', f, err.message); }
    }
    if (kept.length) log('Emulator setup undo: changed since the setup, so only its own settings were put back in:', kept.map(f => path.basename(f)).join(', '));
    kept.length = 0;
  } else for (const f of rec.files) {
    try {
      let mt = 0; try { mt = fs.statSync(f).mtimeMs; } catch {}
      if (mt && rec.at && mt > rec.at + 5000) { kept.push(f); continue; } // changed since the setup: the user's settings are in it now
      if (rec.created.includes(f)) { if (isFile(f)) fs.unlinkSync(f); restored.push(f); continue; }
      const bak = f + '.boxshelf-bak'; if (!isFile(bak)) continue;
      const tmp = f + '.tmp'; fs.copyFileSync(bak, tmp); fs.renameSync(tmp, f); fs.unlinkSync(bak); restored.push(f);
    } catch (e) { log('Emulator setup undo:', f, e.message); }
  }
  if (kept.length) log('Emulator setup undo: left alone (changed since the setup):', kept.map(f => path.basename(f)).join(', '));
  delete m[key]; saveManifest(m); log(EMU_NAME[kind], 'setup undone:', restored.length, 'file(s) put back');
  return { ok: true, restored };
}

// What the Settings page shows for one emulator
function status(exe) {
  const kind = kindOf(exe); if (!kind) return { supported: false };
  const f = mainFile(kind, exe), rec = manifest()[keyOf(kind, exe)] || null;
  // "used": its settings file is older than two days, so someone has set it up before (the first run leaves those alone)
  let used = false; try { used = !!f && isFile(f) && Date.now() - fs.statSync(f).mtimeMs > 2 * 864e5 && !rec; } catch {}
  const p = plan(kind, exe, {});
  // (beta.14) which picture choices this emulator has (Settings shows a row for each); the Picture switch shows when any does
  const pic = pictureOf(kind, exe), picture = { shape: pic.shape, wide: pic.wide, sharp: pic.sharp, crt: pic.crt }, groups = [...(p.groups || [])];
  if ((pic.shape || pic.sharp || pic.crt) && !groups.includes('picture')) groups.push('picture');
  return { supported: true, kind, name: EMU_NAME[kind], ready: kind === 'retroarch' || !!f, file: f, used, done: rec ? { at: rec.at, groups: rec.groups } : null,
    groups, skipped: p.skipped || [], biosDir: biosDirOf(kind, exe), picture };
}
// The graphics preset for this PC from its graphics card (the vendor of the GPU Chromium uses)
function presetFor(gpu) {
  const d = gpu && gpu.gpuDevice && (gpu.gpuDevice.find(x => x.active) || gpu.gpuDevice[0]); const v = d && d.vendorId;
  return v === 0x10de ? 'pretty' : v === 0x1002 ? 'balanced' : 'fast'; // NVIDIA / AMD / Intel and the rest
}

module.exports = { init, kindOf, plan, apply, undo, status, presetFor, sharedBiosDir, biosDirOf, mainFile, GROUPS, GROUP_NAME, DEFAULT_ON, EMU_NAME, setCfg, pictureOf };
