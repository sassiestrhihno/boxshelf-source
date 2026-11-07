// A readable name for an emulator program, shared by the main process and the screen: "<emulator> · <build>".
// Pure string logic on a path (Windows or Linux), nothing is read from disk.
//   C:\Emus\selevet-eglantine-performance-6-windows-x86_64\eglantine.exe → "Eglantine · performance 6"
//   C:\Switch 2 emu\lichii pgo\lichii.exe                              → "Lichii · pgo"
//   /home/me/Games/Nintendo Switch 2/Lichii_K-code-AI.AppImage          → "Lichii · K code AI"
//   /home/me/Games/Nintendo Switch 2/Eglantine_old.AppImage             → "Eglantine · old"
//   /home/me/Applications/dolphin-emu.AppImage                          → "Dolphin"
// The emulator is a known name found in the program's name (else its folder's, else the program's first word); the build
// is what's left of the program's name, or, when the program is named after the emulator alone (eglantine.exe, a Windows
// build in a folder of its own), of the folder's name when that folder is named after the emulator too (a generic folder
// such as "Nintendo Switch 2" or "bin" holding several programs never names a build).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.BSEmuName = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // [what to look for in a name, how to write it]: longer names first, so "citra" doesn't win over "citron"
  const KNOWN = [['eglantine', 'Eglantine'], ['lichii', 'Lichii'], ['orchid', 'Orchid'], ['citron', 'Citron'], ['sudachi', 'Sudachi'], ['ryujinx', 'Ryujinx'], ['ryubing', 'Ryubing'],
    ['eden', 'Eden'], ['yuzu', 'yuzu'], ['suyu', 'Suyu'], ['dolphin', 'Dolphin'], ['cemu', 'Cemu'], ['pcsx2', 'PCSX2'], ['rpcs3', 'RPCS3'], ['shadps4', 'shadPS4'],
    ['ppsspp', 'PPSSPP'], ['xenia', 'Xenia'], ['azahar', 'Azahar'], ['lime3ds', 'Lime3DS'], ['citra', 'Citra'], ['duckstation', 'DuckStation'], ['retroarch', 'RetroArch'],
    ['melonds', 'melonDS'], ['mgba', 'mGBA'], ['flycast', 'Flycast'], ['rmg', 'RMG'], ['kyty', 'Kyty'], ['xemu', 'xemu'], ['blastem', 'BlastEm'], ['stremio', 'Stremio'], ['nuvio', 'Nuvio']];
  // words that say nothing about the build: platforms, packaging, the program's role
  const NOISE = /^(windows?|win(32|64)?|x86|x86_64|64|x64|amd64|arm64|aarch64|linux|appimage|exe|qt|qt6|sdl2?|setup|portable|release|stable|bin|emu|emulator|cli|msvc|mingw)$/i;
  // words of a name: split at spaces, _ - ( ) [ ] and dots that aren't inside a version number (2.1.0 stays whole); a
  // platform glued to a word goes ("x86_64mariotennis" → "mariotennis")
  const tokens = s => String(s || '').replace(/(x86_64|x86-64|win64|windows)(?=[a-z])/gi, ' ').replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .split(/[\s_\-()[\]]+/).filter(Boolean);
  const known = s => { const l = String(s || '').toLowerCase(); const k = KNOWN.find(([id]) => l.includes(id)); return k ? k[1] : ''; };
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  // the build words of a name: the emulator's own word, platform noise and repeats left out; a commit hash shortened
  function rest(s, emu) {
    const e = emu.toLowerCase(), out = [];
    for (let t of tokens(s)) {
      const l = t.toLowerCase();
      if (NOISE.test(t) || l === e) continue;
      if (l.startsWith(e) && l.length > e.length) t = t.slice(e.length); // ("eglantinemariotennis" → "mariotennis")
      else if (l.endsWith(e) && l.length > e.length) t = t.slice(0, -e.length);
      if (/^[0-9a-f]{40}$/i.test(t)) t = t.slice(0, 7);
      if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
    return out.join(' ');
  }
  function parts(p) {
    const segs = String(p || '').split(/[\\/]/).filter(Boolean), file = segs.pop() || '', dir = segs.pop() || '';
    const stem = file.replace(/\.(exe|appimage|sh|bin|bat|cmd|app)$/i, '');
    const emu = known(stem) || known(dir) || cap(tokens(stem)[0] || stem) || 'Emulator';
    let build = rest(stem, emu);
    if (!build && dir && (known(dir) === emu || /[0-9a-f]{40}/i.test(dir))) build = rest(dir, emu);
    return { emu, build };
  }
  // "Lichii · K code AI"; just "Dolphin" when nothing tells builds apart
  function label(p) { const { emu, build } = parts(p); return build ? `${emu} · ${build}` : emu; }
  // the emulator alone: "Lichii", "Citron"
  const emulator = p => parts(p).emu;
  // a known emulator's name in the program's name or folder ("" for a program it doesn't recognise)
  const knownName = p => { const segs = String(p || '').split(/[\\/]/).filter(Boolean); return known(segs.pop() || '') || known(segs.pop() || ''); };
  return { label, emulator, parts, knownName };
});
