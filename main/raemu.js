'use strict';
// Per console: will RetroAchievements actually work in its emulator? Reads each emulator's own
// settings (portable folder first, then the usual Windows places). Never returns tokens.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const emucfg = require('./emucfg'); // where each emulator keeps its settings: one answer for the tweaks and this check

const exists = p => fsp.access(p).then(() => true, () => false);
async function readText(p) { try { return (await fsp.readFile(p, 'utf8')).replace(/^﻿/, ''); } catch { return null; } }

// { section(lowercase): { key(lowercase): value } }
function parseIni(text) {
  const out = {}; let cur = out[''] = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line[0] === ';' || line[0] === '#') continue;
    const sec = /^\[(.+)\]$/.exec(line); if (sec) { cur = out[sec[1].trim().toLowerCase()] = out[sec[1].trim().toLowerCase()] || {}; continue; }
    const i = line.indexOf('='); if (i < 1) continue;
    cur[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return out;
}
const truthy = v => /^(true|1|yes|on)$/i.test(String(v == null ? '' : v).trim());

async function firstExisting(list) { for (const p of list) if (p && await exists(p)) return p; return null; }

// (Documents may be the OneDrive one: Windows moves it there when OneDrive backs it up)
async function dolphinIni(exe, env) {
  return firstExisting(emucfg.dolphinUserDirs(exe, env).map(r => path.join(r, 'Config', 'RetroAchievements.ini')));
}
async function checkDolphin(exe, env) {
  const f = await dolphinIni(exe, env); if (!f) return { state: 'unknown', user: '', detail: 'Dolphin settings not found (run Dolphin once)' };
  const a = parseIni(await readText(f)).achievements || {};
  const extra = truthy(a.hardcoreenabled) ? 'Hardcore mode on' : '';
  if (!truthy(a.enabled)) return { state: 'off', user: a.username || '', detail: 'Achievements are turned off in Dolphin' };
  if (!a.apitoken) return { state: 'signed-out', user: a.username || '', detail: 'Not signed in to RetroAchievements in Dolphin' };
  return { state: 'ok', user: a.username || '', detail: extra };
}

async function ppssppSystem(exe, env) {
  const dir = path.dirname(exe);
  const cands = [path.join(dir, 'memstick')];
  const inst = await readText(path.join(dir, 'installed.txt'));
  if (inst && inst.trim()) cands.push(inst.split(/\r?\n/)[0].trim());
  for (const d of emucfg.docsDirs(env)) cands.push(path.join(d, 'PPSSPP'));
  for (const m of cands) { const sys = path.join(m, 'PSP', 'SYSTEM'); if (await exists(path.join(sys, 'ppsspp.ini'))) return sys; }
  return null;
}
async function checkPpsspp(exe, env) {
  const sys = await ppssppSystem(exe, env); if (!sys) return { state: 'unknown', user: '', detail: 'PPSSPP settings not found (run PPSSPP once)' };
  const a = parseIni(await readText(path.join(sys, 'ppsspp.ini'))).achievements || {};
  const user = a.achievementsusername || '';
  if (!truthy(a.achievementsenable)) return { state: 'off', user, detail: 'Achievements are turned off in PPSSPP' };
  if (!(await exists(path.join(sys, 'ppsspp_retroachievements.dat')))) return { state: 'signed-out', user, detail: 'Not signed in to RetroAchievements in PPSSPP' };
  return { state: 'ok', user, detail: truthy(a.achievementschallengemode) ? 'Hardcore mode on' : '' };
}

async function pcsx2Ini(exe, env) {
  return firstExisting(emucfg.pcsx2Inis(exe, env));
}
async function checkPcsx2(exe, env) {
  const f = await pcsx2Ini(exe, env); if (!f) return { state: 'unknown', user: '', detail: 'PCSX2 settings not found (run PCSX2 once)' };
  const a = parseIni(await readText(f)).achievements || {};
  if (!truthy(a.enabled)) return { state: 'off', user: a.username || '', detail: 'Achievements are turned off in PCSX2' };
  if (!a.token) return { state: 'signed-out', user: a.username || '', detail: 'Not signed in to RetroAchievements in PCSX2' };
  return { state: 'ok', user: a.username || '', popups: a.notifications === undefined || truthy(a.notifications), detail: truthy(a.challengemode) ? 'Hardcore mode on' : '' };
}

// (beta.14) DuckStation (PlayStation) and RetroArch (every retro console, and any other console played through it)
async function duckIni(exe, env) {
  const dir = path.dirname(exe), home = env.USERPROFILE || env.HOME || '', local = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const portable = await exists(path.join(dir, 'portable.txt'));
  return firstExisting([...(portable ? [path.join(dir, 'settings.ini')] : []), path.join(local, 'DuckStation', 'settings.ini'), ...emucfg.docsDirs(env).map(d => path.join(d, 'DuckStation', 'settings.ini')),
    ...(process.platform === 'linux' ? [path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'duckstation', 'settings.ini'), path.join(home, '.var', 'app', 'org.duckstation.DuckStation', 'data', 'duckstation', 'settings.ini')] : [])]);
}
async function checkDuckstation(exe, env) {
  const f = await duckIni(exe, env); if (!f) return { state: 'unknown', user: '', detail: 'DuckStation settings not found (run DuckStation once)' };
  const a = parseIni(await readText(f)).cheevos || {};
  if (!truthy(a.enabled)) return { state: 'off', user: a.username || '', detail: 'Achievements are turned off in DuckStation' };
  if (!a.token) return { state: 'signed-out', user: a.username || '', detail: 'Not signed in to RetroAchievements in DuckStation' };
  return { state: 'ok', user: a.username || '', popups: a.notifications === undefined || truthy(a.notifications), detail: truthy(a.challengemode) ? 'Hardcore mode on' : '' };
}
// retroarch.cfg: beside the program (Windows keeps it there), else the user's RetroArch folder. `key = "value"` lines
const cfgVal = (t, k) => { const m = new RegExp('^\\s*' + k + '\\s*=\\s*"?([^"\\r\\n]*)"?', 'm').exec(t || ''); return m ? m[1].trim() : ''; };
async function checkRetroarch(exe, env) {
  const dir = path.dirname(exe), home = env.USERPROFILE || env.HOME || '', appdata = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const f = await firstExisting([path.join(dir, 'retroarch.cfg'), path.join(appdata, 'RetroArch', 'retroarch.cfg'),
    ...(process.platform === 'linux' ? [exe + '.config/retroarch/retroarch.cfg', path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'retroarch', 'retroarch.cfg'), path.join(home, '.var', 'app', 'org.libretro.RetroArch', 'config', 'retroarch', 'retroarch.cfg')] : [])]);
  if (!f) return { state: 'unknown', user: '', detail: 'RetroArch settings not found (run RetroArch once)' };
  const t = await readText(f), user = cfgVal(t, 'cheevos_username');
  if (!truthy(cfgVal(t, 'cheevos_enable'))) return { state: 'off', user, detail: 'Achievements are turned off in RetroArch' };
  if (!user || !(cfgVal(t, 'cheevos_token') || cfgVal(t, 'cheevos_password'))) return { state: 'signed-out', user, detail: 'Not signed in to RetroAchievements in RetroArch' };
  const vis = cfgVal(t, 'cheevos_visibility_unlock');
  return { state: 'ok', user, popups: !vis || truthy(vis), detail: truthy(cfgVal(t, 'cheevos_hardcore_mode_enable')) ? 'Hardcore mode on' : '' };
}

const EMU = { Dolphin: checkDolphin, PPSSPP: checkPpsspp, PCSX2: checkPcsx2, DuckStation: checkDuckstation, RetroArch: checkRetroarch };
// which emulator a console's program is (by its file name); another one (melonDS, mGBA, RMG…) has no achievements of its own
function emuKind(exe) {
  const n = path.basename(String(exe || '')).toLowerCase();
  return /retroarch/.test(n) ? 'RetroArch' : /dolphin/.test(n) ? 'Dolphin' : /pcsx2/.test(n) ? 'PCSX2' : /ppsspp/.test(n) ? 'PPSSPP' : /duckstation/.test(n) ? 'DuckStation' : null;
}
// the consoles always listed (their usual emulator named even before one is chosen); every other console RetroAchievements
// covers is listed once it has an emulator
const BASE = { gc: 'Dolphin', wii: 'Dolphin', psp: 'PPSSPP', ps2: 'PCSX2' };

// cfg: the app config; supported: RA console ids (main/ra.js CONSOLE_ID); env: for tests
async function check(cfg, supported, env = process.env) {
  const raUser = String((cfg && cfg.ra && cfg.ra.user) || '').trim(), sys = (cfg && cfg.systems) || {};
  const ids = [...new Set([...Object.keys(BASE), ...Object.keys(supported || {}).filter(id => sys[id] && String(sys[id].emulator || '').trim())])];
  const memo = new Map(); // one emulator often runs several consoles (Dolphin: GameCube and Wii; RetroArch: all the retro ones)
  return Promise.all(ids.map(async system => {
    const exe = String((sys[system] && sys[system].emulator) || '').trim(), kind = exe ? emuKind(exe) : null, emulator = kind || (exe ? path.basename(exe).replace(/\.exe$/i, '') : BASE[system] || '');
    const base = { system, emulator, exeKey: exe ? path.resolve(exe).toLowerCase() : '' };
    if (!supported[system]) return { ...base, state: 'unsupported', user: '', detail: system === 'wii' ? 'Few Wii games have achievement sets yet' : 'RetroAchievements does not cover this console' };
    if (!exe) return { ...base, state: 'no-emulator', user: '', detail: `No ${emulator || 'emulator'} set up for this console` };
    if (!kind) return { ...base, state: 'no-ra', user: '', detail: `${emulator} has no RetroAchievements: play this console in RetroArch to earn them` };
    const key = kind + '|' + base.exeKey;
    if (!memo.has(key)) memo.set(key, EMU[kind](exe, env).catch(() => ({ state: 'unknown', user: '', detail: `Could not read ${kind} settings` })));
    const r = { ...base, ...(await memo.get(key)) };
    if (r.state === 'ok' && raUser && r.user && r.user.toLowerCase() !== raUser.toLowerCase())
      return { ...r, state: 'other-user', detail: `${emulator} is signed in as ${r.user}, not ${raUser}` };
    return r;
  }));
}

module.exports = { check, parseIni, emuKind };
