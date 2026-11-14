// (beta.14) One key per game for what's kept about it (main/moreshots.js more-shots\index.json, main/igdb.js
// igdb-info\index.json, main/trailers.js previews\trailers.json and its clips): "<console>|<file name>", lowercased.
// A generic file name (an Xbox 360 game's default.xex or DVD.iso, a PS3 game's EBOOT.BIN, Nintendont's "Title [ID]/game.iso")
// is shared by many games, so for those the game's folder comes first: "<console>|<folder>/<file name>". Folders that are
// part of a game's layout (PS3_GAME\USRDIR, a Wii U game's code, a Switch game's exefs) are stepped over to the game's own.
// Every other game keeps the key it had before, so what's already kept stays valid. A game without a file: its title.
const path = require('path');

const GENERIC_STEM = /^(game|default|eboot|disc|dvd|boot|main|rom|image|iso)\s*\d*$/i;
const LAYOUT_DIR = /^(usrdir|ps3_game|code|exefs|content|meta|sce_sys|app|files|sys)$/i;
function fileKey(file) {
  const f = String(file || ''), base = path.basename(f), stem = base.replace(/\.[^.]*$/, '');
  if (!GENERIC_STEM.test(stem)) return base.toLowerCase();
  let d = path.dirname(f);
  for (let i = 0; i < 4 && LAYOUT_DIR.test(path.basename(d)); i++) { const up = path.dirname(d); if (up === d) break; d = up; }
  const dn = path.basename(d);
  return ((dn ? dn + '/' : '') + base).toLowerCase();
}
function gameKey(sysId, game) { const f = String((game && game.file) || ''); return sysId + '|' + (f ? fileKey(f) : 't:' + String((game && game.title) || '').toLowerCase()); }

module.exports = { gameKey, fileKey };
