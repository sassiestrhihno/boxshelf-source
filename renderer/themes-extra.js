// Ten more shelf themes (made for the Thor in Android 0.3.5, on Windows too since 1.75). index.html loads this before the
// app's scripts; the shelf (app.js THEMES / QM_THEMES), Settings' theme tiles (settings.js) and the theme layer
// (themefx.js) add them after the original six.
//
// Each theme: id, name, swatch (Settings tile), halo(sh) (the selection glow's hue), tint(sh, g, p) (the CSS backdrop
// behind the shelf; the bottom screen wears the same string) and, for the moving ones, fx(c): one frame on the theme
// layer's canvas (c = { g, W, H, t, dt, hue, scale, floorY, lite, still }). The backdrop is complete on its own: fx only
// adds motion on top (light trails, sparks, a rolling bar), so a still frame (c.still: the Handheld level, Low, Reduce
// motion, or anything covering the shelf) still looks finished. Static patterns are SVG / gradients painted once per
// game change (when the shelf has landed), never per frame.
(function () {
  if (window.BS_EXTRA_THEMES) return;
  const hsl = (h, s, l, a = 1) => `hsla(${((Math.round(h) % 360) + 360) % 360},${s}%,${l}%,${a})`;
  // an SVG as a CSS image (single quotes inside; only the characters a data URL needs escaped)
  const svg = (vb, body, par) => `url("data:image/svg+xml,${(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb}' preserveAspectRatio='${par || 'none'}'>${body}</svg>`)
    .replace(/%/g, '%25').replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;
  // the same "random" pattern every start (a small seeded generator)
  const seeded = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const r1 = n => Math.round(n * 10) / 10;
  // a console's hue drawn part of the way towards the theme's own (k = how much of the console's colour is kept)
  const pull = (sh, to, k) => to + ((((sh - to) % 360) + 540) % 360 - 180) * k;

  // ---------- Cube: indigo with a soft isometric cube pattern ----------
  const CUBE = (() => {
    const d = '#110d2e', m = '#17123d', l = '#1d1849', s = '/64px 112px', e = '12%,transparent 12.5%,transparent 87%,', f = '25%,transparent 25.5%,transparent 75%,';
    return [`linear-gradient(30deg,${d} ${e}${d} 87.5%,${d}) 0 0${s}`, `linear-gradient(150deg,${d} ${e}${d} 87.5%,${d}) 0 0${s}`,
      `linear-gradient(30deg,${d} ${e}${d} 87.5%,${d}) 32px 56px${s}`, `linear-gradient(150deg,${d} ${e}${d} 87.5%,${d}) 32px 56px${s}`,
      `linear-gradient(60deg,${l} ${f}${l} 75%,${l}) 0 0${s}`, `linear-gradient(60deg,${l} ${f}${l} 75%,${l}) 32px 56px${s}`, m].join(',');
  })();

  // ---------- Blue Shift: deep blue, glass towers in the fog, slow light trails ----------
  const BLUE = (() => {
    const rnd = seeded(7); let rects = '';
    for (let i = 0; i < 26; i++) { const side = i % 2, x = side ? 1600 - (40 + rnd() * 500) : 40 + rnd() * 500, w = 10 + rnd() * 30, h = 60 + rnd() * rnd() * 330;
      rects += `<rect x='${Math.round(x)}' y='${Math.round(513 - h)}' width='${Math.round(w)}' height='${Math.round(h + 6)}'/>`; }
    return svg('0 0 1600 900', `<defs><linearGradient id='p' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#7fb4ff' stop-opacity='.02'/><stop offset='.7' stop-color='#4d8dff' stop-opacity='.16'/><stop offset='1' stop-color='#9cc8ff' stop-opacity='.42'/></linearGradient>` +
      `<linearGradient id='t' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#8fc0ff' stop-opacity='0'/><stop offset='.55' stop-color='#bcdcff' stop-opacity='.5'/><stop offset='1' stop-color='#8fc0ff' stop-opacity='0'/></linearGradient></defs>` +
      `<g id='k' fill='url(#p)'>${rects}</g><use href='#k' transform='matrix(1 0 0 -.45 0 744)' opacity='.4'/>` +
      `<path d='M-60 250C380 120 900 330 1660 150' fill='none' stroke='url(#t)' stroke-width='1.6'/><path d='M-60 800C500 760 1000 820 1660 770' fill='none' stroke='url(#t)' stroke-width='1.2' opacity='.5'/>`);
  })();
  // the moving heads' paths: [height, speed, wave height, waves, phase] (fractions of the screen)
  const TRAILS = [[.24, .5, .05, .9, 0], [.36, .42, .04, .7, 2.1], [.7, .64, .04, 1.1, 4.4], [.88, .9, .02, .8, 1.3]];
  function blueFx(c) {
    const { g, W, H } = c, t = c.still ? 14 : c.t;
    g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    TRAILS.forEach(([y0, sp, amp, fr, ph], k) => {
      // a head drifting across the screen (one crossing every ~25-40 s), leaving a tail that fades out behind it
      const at = s => { const u = ((s * sp * .035 + ph * .17) % 1.3) - .15; return [u * W, H * (y0 + Math.sin(u * 6.28 * fr + ph) * amp)]; };
      const N = 18; let [px, py] = at(t - 3.2);
      for (let i = 1; i <= N; i++) { const s = t - 3.2 + i * 3.2 / N, [x, y] = at(s); if (Math.abs(x - px) < W * .3) { g.strokeStyle = hsl(pull(c.hue, 205, .25), 90, 72, (i / N) * .32); g.lineWidth = Math.max(1, H * .004 * (i / N) + .5); g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke(); } px = x; py = y; }
      const gr = g.createRadialGradient(px, py, 0, px, py, H * .016); gr.addColorStop(0, 'rgba(235,245,255,.95)'); gr.addColorStop(.3, 'rgba(150,200,255,.4)'); gr.addColorStop(1, 'rgba(120,170,255,0)');
      g.fillStyle = gr; g.fillRect(px - H * .016, py - H * .016, H * .032, H * .032);
    });
  }

  // ---------- Swirl: a warm orange vortex on deep grey ----------
  // one log-spiral arm (screen space 1600 x 900, centred behind the shelf), turned three ways
  const SW_C = [800, 380], swArm = th => { const r = 26 * Math.exp(.235 * th); return [SW_C[0] + Math.cos(th) * r, SW_C[1] + Math.sin(th) * r * .82]; };
  const SWIRL = (() => {
    // as smooth curves: each piece a cubic whose handles follow the spiral's direction (dr/dθ = .235 r)
    const tan = th => { const r = 26 * Math.exp(.235 * th); return [r * (.235 * Math.cos(th) - Math.sin(th)), r * .82 * (.235 * Math.sin(th) + Math.cos(th))]; };
    const N = 40, h = 16 / N; let [x0, y0] = swArm(0), d = `M${r1(x0)} ${r1(y0)}`;
    for (let i = 1; i <= N; i++) { const a = (i - 1) * h, b = i * h, [x1, y1] = swArm(b), [ax, ay] = tan(a), [bx, by] = tan(b);
      d += `C${Math.round(x0 + ax * h / 3)} ${Math.round(y0 + ay * h / 3)} ${Math.round(x1 - bx * h / 3)} ${Math.round(y1 - by * h / 3)} ${Math.round(x1)} ${Math.round(y1)}`; x0 = x1; y0 = y1; }
    const u = (rot, sw, op) => `<use href='#a' transform='rotate(${rot} 800 380)' stroke-width='${sw}' stroke-opacity='${op}'/>`;
    return svg('0 0 1600 900', `<defs><path id='a' d='${d}'/></defs><g fill='none' stroke='#ff6a1a' stroke-linecap='round'>${u(0, 34, .05)}${u(120, 34, .04)}${u(240, 34, .05)}${u(0, 2.4, .38)}${u(120, 2, .26)}${u(240, 2.4, .32)}</g>`, 'xMidYMid slice');
  })();
  function swirlFx(c) {
    if (c.still) return; // the backdrop's arms are the still picture
    const { g, W, H, t } = c, s = Math.max(W / 1600, H / 900), ox = (W - 1600 * s) / 2, oy = (H - 900 * s) / 2;
    g.globalCompositeOperation = 'lighter';
    // sparks riding the arms inwards, brightest halfway in
    for (let k = 0; k < 12; k++) {
      const arm = k % 3, life = ((t * .04 + k * .211) % 1), th = 15 - life * 10, [x0, y0] = swArm(th), a = arm * 2.0944, dx = x0 - SW_C[0], dy = y0 - SW_C[1];
      const x = ox + (SW_C[0] + dx * Math.cos(a) - dy * Math.sin(a)) * s, y = oy + (SW_C[1] + dx * Math.sin(a) + dy * Math.cos(a)) * s;
      const al = Math.sin(life * 3.14), rr = Math.max(1.5, H * (.0035 + .004 * (1 - life)));
      const gr = g.createRadialGradient(x, y, 0, x, y, rr * 4); gr.addColorStop(0, `rgba(255,236,200,${al * .9})`); gr.addColorStop(.25, `rgba(255,150,60,${al * .45})`); gr.addColorStop(1, 'rgba(255,110,30,0)');
      g.fillStyle = gr; g.fillRect(x - rr * 4, y - rr * 4, rr * 8, rr * 8);
    }
  }

  // ---------- Forest: deep green, light through the trees ----------
  const FOREST = (() => {
    const rnd = seeded(31); let far = '', near = '';
    const pine = (x, base, h) => { const w = h * .34; return `M${r1(x)} ${r1(base - h)}L${r1(x + w * .55)} ${r1(base - h * .45)}L${r1(x + w * .3)} ${r1(base - h * .45)}L${r1(x + w)} ${r1(base)}L${r1(x - w)} ${r1(base)}L${r1(x - w * .3)} ${r1(base - h * .45)}L${r1(x - w * .55)} ${r1(base - h * .45)}Z`; };
    for (let i = 0; i < 14; i++) { const side = i % 2, x = side ? 1600 - rnd() * 430 : rnd() * 430; far += pine(x, 400, 120 + rnd() * 150); }
    for (let i = 0; i < 8; i++) { const side = i % 2, x = side ? 1600 - rnd() * 300 : rnd() * 300; near += pine(x, 410, 190 + rnd() * 170); }
    return svg('0 0 1600 400', `<path d='${far}' fill='#123a28' opacity='.8'/><path d='${near}' fill='#020b06'/>`);
  })();
  function forestFx(c) {
    const { g, W, H } = c, t = c.still ? 9 : c.t;
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 22; k++) {
      // fireflies: wander slowly, blink on and off; kept out of the band where the game's name sits
      const x = W * (.04 + ((k * .618 + Math.sin(t * .05 + k) * .04) % 1) * .92), y = H * (.18 + ((k * .371) % 1) * .62 + Math.sin(t * .11 + k * 2.3) * .025);
      if (y > H * .66 && Math.abs(x / W - .5) < .22) continue;
      const blink = Math.max(0, Math.sin(t * (.5 + (k % 5) * .13) + k * 1.7)), al = .12 + blink * .6, rr = Math.max(1.5, H * .006);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr * 2.4); gr.addColorStop(0, `rgba(226,255,150,${al})`); gr.addColorStop(1, 'rgba(160,255,90,0)');
      g.fillStyle = gr; g.fillRect(x - rr * 2.4, y - rr * 2.4, rr * 4.8, rr * 4.8);
    }
  }

  // ---------- CRT: a glowing tube, scanlines, a slow roll bar ----------
  // the tube's rounded glass edge inside a thin black bezel, with a soft inner shadow and a faint rim of light
  const CRT_BEZEL = svg('0 0 1600 900', `<path fill-rule='evenodd' fill='#020203' d='M0 0H1600V900H0ZM84 20H1516Q1580 20 1580 84V816Q1580 880 1516 880H84Q20 880 20 816V84Q20 20 84 20Z'/>` +
    `<rect x='20' y='20' width='1560' height='860' rx='64' fill='none' stroke='#000' stroke-opacity='.28' stroke-width='60'/><rect x='20' y='20' width='1560' height='860' rx='64' fill='none' stroke='#000' stroke-opacity='.45' stroke-width='18'/>` +
    `<rect x='21.5' y='21.5' width='1557' height='857' rx='63' fill='none' stroke='#b4c8dc' stroke-opacity='.12' stroke-width='1.6'/>`);
  function crtFx(c) {
    if (c.still) return; // the backdrop is the whole still picture
    const { g, W, H, t } = c, y = ((t * .085) % 1.4 - .2) * H, h = H * .22;
    const gr = g.createLinearGradient(0, y - h / 2, 0, y + h / 2); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, hsl(c.hue, 40, 80, .055)); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, y - h / 2, W, h);
  }

  // ---------- VHS: tape glow, colour bleed, the odd tracking line ----------
  // the worn tape's marks, fixed in place: a tracking band low on the screen with colour-fringed lines, and the
  // head-switching jitter along the bottom edge
  const VHS_NOISE = (() => {
    const rnd = seeded(19); let w = '', cy = '', mg = '';
    for (let i = 0; i < 16; i++) { const x = rnd() * 1100, y = 772 + rnd() * 34; w += `<rect x='${Math.round(x)}' y='${r1(y)}' width='${Math.round(180 + rnd() * 1300)}' height='${r1(.8 + rnd() * 2.6)}' opacity='${r1(.05 + rnd() * .14)}'/>`; }
    for (let i = 0; i < 3; i++) { const x = rnd() * 900, y = 776 + rnd() * 26; cy += `<rect x='${Math.round(x)}' y='${r1(y)}' width='${Math.round(300 + rnd() * 700)}' height='1.6'/>`; mg += `<rect x='${Math.round(x + 14)}' y='${r1(y + 2.2)}' width='${Math.round(300 + rnd() * 700)}' height='1.6'/>`; }
    for (let i = 0; i < 6; i++) { const y = 884 + i * 2.6; w += `<rect x='${Math.round(rnd() * 60)}' y='${r1(y)}' width='${Math.round(1500 + rnd() * 100)}' height='1.3' opacity='${r1(.04 + rnd() * .08)}'/>`; }
    return svg('0 0 1600 900', `<g fill='#eef2ff'>${w}</g><g fill='#28d2ff' opacity='.28'>${cy}</g><g fill='#ff2a80' opacity='.26'>${mg}</g>`);
  })();
  function vhsFx(c) {
    const { g, W, H, t } = c;
    if (c.still) return;
    // light snow, a different handful of specks every frame
    g.fillStyle = 'rgba(230,235,255,.10)';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2.5, 1);
    // every ~7 s a tracking band rolls up the screen for a second or so: jittery bright lines and a colour fringe
    const ph = t % 7.3; if (ph > 1.4) return;
    const y = H * (1.05 - ph / 1.4 * 1.1), bh = H * .05;
    for (let i = 0; i < 7; i++) { const yy = y + (Math.random() - .5) * bh, x0 = Math.random() * W * .3; g.fillStyle = `rgba(235,240,255,${.06 + Math.random() * .12})`; g.fillRect(x0, yy, W - x0 - Math.random() * W * .2, 1 + Math.random() * 2); }
    g.fillStyle = 'rgba(255,40,120,.05)'; g.fillRect(0, y - bh * .6, W, bh * .5); g.fillStyle = 'rgba(40,200,255,.05)'; g.fillRect(0, y + bh * .1, W, bh * .5);
  }

  // ---------- Synthwave: a striped sun on the horizon, a neon grid running towards you ----------
  const HZ = .57; // the horizon, as a fraction of the screen (just above the shelf's floor)
  const SYN_GRID = (() => {
    let d = ''; for (let i = -14; i <= 14; i++) d += `M800 0L${800 + i * 175} 400`;
    for (let k = 1; k <= 9; k++) { const y = Math.round(400 * Math.pow(k / 9, 2.1)); d += `M0 ${y}H1600`; }
    return svg('0 0 1600 400', `<defs><linearGradient id='f' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='0' y2='400'><stop offset='0' stop-color='#ff4fd8' stop-opacity='.06'/><stop offset='1' stop-color='#ff4fd8' stop-opacity='.62'/></linearGradient></defs><path d='${d}' fill='none' stroke='url(#f)' stroke-width='1.4' vector-effect='non-scaling-stroke'/>`);
  })();
  const SYN_SUN = svg('0 0 200 100', `<defs><linearGradient id='s' x1='0' y1='0' x2='0' y2='.5'><stop offset='0' stop-color='#ffd84a'/><stop offset='.5' stop-color='#ff7a4e'/><stop offset='1' stop-color='#ff2d8a'/></linearGradient>` +
    `<clipPath id='c'><rect width='200' height='48'/><rect y='53' width='200' height='9'/><rect y='66' width='200' height='7'/><rect y='77' width='200' height='5'/><rect y='86' width='200' height='4'/><rect y='94' width='200' height='3'/></clipPath></defs>` +
    `<circle cx='100' cy='100' r='99' fill='url(#s)' clip-path='url(#c)'/>`, 'xMidYMax meet');
  function synthFx(c) {
    const { g, W, H } = c, hy = H * HZ, t = c.still ? 3 : c.t;
    g.globalCompositeOperation = 'lighter';
    // stars over the sunset
    const rnd = seeded(5);
    for (let i = 0; i < 70; i++) { const x = rnd() * W, y = rnd() * hy * .62, z = rnd(), tw = .5 + .5 * Math.sin(t * (1 + z * 2) + i); g.fillStyle = `rgba(255,230,255,${(.12 + z * .4) * (c.still ? .8 : tw)})`; g.fillRect(x, y, z > .9 ? 2 : 1.2, z > .9 ? 2 : 1.2); }
    if (c.still) return;
    // the ground rushing towards you: a bright line sliding down the grid, plus pulses racing along its rails
    for (let k = 0; k < 2; k++) {
      const u = ((t * .42 + k * .5) % 1), y = hy + (H - hy) * Math.pow(u, 2.1);
      const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(255,80,220,0)'); gr.addColorStop(.5, `rgba(255,120,235,${.08 + u * .3})`); gr.addColorStop(1, 'rgba(255,80,220,0)');
      g.fillStyle = gr; g.fillRect(0, y - 1, W, Math.max(1.5, 2.5 * u * c.scale));
    }
    for (let k = 0; k < 6; k++) {
      const lane = [-9, -6, -4, 4, 6, 9][k], u = ((t * (.18 + k * .03) + k * .29) % 1), e = Math.pow(u, 2.1);
      const x = W / 2 + lane * 175 / 1600 * W * e, y = hy + (H - hy) * e, rr = H * (.004 + .012 * e);
      const gr = g.createRadialGradient(x, y, 0, x, y, rr * 3); gr.addColorStop(0, hsl(c.hue + 180 * (k % 2), 100, 75, .7)); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rr * 3, y - rr * 3, rr * 6, rr * 6);
    }
  }

  // ---------- (beta.14) six more: Nebula, Abyss, Ember, Dusk, and the two showpieces Prism and Hologram ----------
  // Nebula, Abyss, Ember and Dusk move on the theme layer's three CSS layers (#themeFx i, themes-extra.css): transforms and
  // opacity only, run by the graphics card with no frame loop; they hold still while the shelf slides (app.js fxHold) and
  // at the Handheld / Low levels (body:not(.fx)). Prism and Hologram draw on the theme layer's canvas at half rate (fps 30,
  // waiting out BS_BUSY), and at Handheld / Low show their backdrop alone, which is a finished still picture.
  // dots as zero-length round-capped strokes ("M x y h0"), three sizes / brightnesses: a few characters a dot, so the
  // backdrop string stays small (the Thor's bottom screen is sent it on every change of game)
  const dotField = (seed, n, h, col, sizes, par) => { const rnd = seeded(seed), d = sizes.map(() => '');
    for (let i = 0; i < n; i++) { const k = Math.min(sizes.length - 1, Math.floor(rnd() * rnd() * sizes.length * 1.4)); d[k] += `M${Math.round(rnd() * 1600)} ${Math.round(rnd() * h)}h0`; }
    return svg(`0 0 1600 ${h}`, `<g fill='none' stroke='${col}' stroke-linecap='round'>${sizes.map(([w, o], k) => d[k] ? `<path d='${d[k]}' stroke-width='${w}' stroke-opacity='${o}'/>` : '').join('')}</g>`, par || 'xMidYMid slice'); };
  const STAR_SIZES = [[1.2, .35], [2, .6], [3.2, .9]];
  const NEB_STARS = dotField(41, 170, 900, '#fff', STAR_SIZES);
  const DUSK_STARS = dotField(53, 90, 420, '#fff', STAR_SIZES, 'none');
  const ABYSS_SNOW = dotField(61, 70, 900, '#cfefff', [[1.4, .12], [2.2, .2], [3, .28]]);
  // Ember's sparks: one tile, repeated down a layer twice the screen's height that rises one tile in ~40 s (themes-extra.css)
  const emberTile = (seed, n) => { const rnd = seeded(seed); let s = '';
    for (let i = 0; i < n; i++) { const x = Math.round(rnd() * 1600), y = Math.round(rnd() * 900), r = r1(1 + rnd() * 1.8), o = r1(.35 + rnd() * .6);
      s += `<circle cx='${x}' cy='${y}' r='${r1(r * 4)}' fill='url(#g)' opacity='${o}'/><circle cx='${x}' cy='${y}' r='${r}' fill='#ffe2b0' opacity='${o}'/>`; }
    return svg('0 0 1600 900', `<defs><radialGradient id='g'><stop offset='0' stop-color='#ff9a40' stop-opacity='.7'/><stop offset='1' stop-color='#ff6a20' stop-opacity='0'/></radialGradient></defs>${s}`); };
  const EMBER_STILL = emberTile(71, 14), EMBER_RISE = emberTile(73, 22);
  // Hologram's floor: a cyan grid running to the horizon (the canvas slides bright lines along it)
  const HOLO_GRID = (() => {
    let d = ''; for (let i = -16; i <= 16; i++) d += `M800 0L${800 + i * 150} 400`;
    for (let k = 1; k <= 11; k++) { const y = Math.round(400 * Math.pow(k / 11, 2)); d += `M0 ${y}H1600`; }
    return svg('0 0 1600 400', `<defs><linearGradient id='f' gradientUnits='userSpaceOnUse' x1='0' y1='0' x2='0' y2='400'><stop offset='0' stop-color='#5adcff' stop-opacity='.05'/><stop offset='1' stop-color='#5adcff' stop-opacity='.55'/></linearGradient></defs><path d='${d}' fill='none' stroke='url(#f)' stroke-width='1.3' vector-effect='non-scaling-stroke'/>`);
  })();
  // Make a theme's particles (custom themes, themes-extra.css): snow and dust as tiles that move, stars that twinkle
  const dotTile = (seed, n, fill, r0, r1_, o0, o1) => { const rnd = seeded(seed); let s = '';
    for (let i = 0; i < n; i++) s += `<circle cx='${Math.round(rnd() * 1600)}' cy='${Math.round(rnd() * 900)}' r='${r1(r0 + rnd() * (r1_ - r0))}' opacity='${r1(o0 + rnd() * (o1 - o0))}'/>`;
    return svg('0 0 1600 900', `<g fill='${fill}'>${s}</g>`); };
  try { const st = document.documentElement.style; st.setProperty('--bs-ember-rise', EMBER_RISE); st.setProperty('--bs-dusk-stars', DUSK_STARS);
    st.setProperty('--bs-tile-snow', dotTile(81, 60, '#ffffff', 1.4, 3.6, .35, .85)); st.setProperty('--bs-tile-dust', dotTile(83, 46, '#fff0d2', .8, 2, .15, .5)); st.setProperty('--bs-tile-stars', NEB_STARS); } catch {}
  const HZ2 = .57;
  // Prism: liquid glass. Soft colour pools drawn small and stretched up (the upscale is the softness), turning slowly
  // through the spectrum; when you stop on a new game a ripple runs out from under the shelf
  const prismOff = document.createElement('canvas'), prismO = prismOff.getContext('2d');
  const PRISM_POOLS = [[.26, .34, 250], [.42, .62, 190], [.6, .3, 150], [.72, .6, 55], [.52, .5, 330], [.82, .32, 275]];
  let prismHt = null; const prismRip = [];
  function prismFx(c) {
    if (c.still) return; // the backdrop's pools are the still picture
    const { g, W, H, t } = c, ow = Math.max(48, W >> 3), oh = Math.max(27, H >> 3);
    if (prismOff.width !== ow || prismOff.height !== oh) { prismOff.width = ow; prismOff.height = oh; }
    const o = prismO; o.globalCompositeOperation = 'source-over'; o.clearRect(0, 0, ow, oh); o.globalCompositeOperation = 'lighter';
    PRISM_POOLS.forEach(([x0, y0, h0], k) => {
      const x = (x0 + Math.sin(t * .07 + k * 1.9) * .08) * ow, y = (y0 + Math.cos(t * .055 + k * 2.6) * .07) * oh, r = oh * (.34 + .08 * Math.sin(t * .09 + k));
      const gr = o.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, hsl(h0 + t * 4 + c.hue * .15, 95, 58, .55)); gr.addColorStop(1, hsl(h0 + t * 4, 95, 50, 0));
      o.fillStyle = gr; o.fillRect(x - r, y - r, r * 2, r * 2);
    });
    g.imageSmoothingEnabled = true; g.globalAlpha = .6; g.drawImage(prismOff, 0, 0, W, H); g.globalAlpha = 1;
    // a glassy sheen drifting across
    const sx = W * (.5 + Math.sin(t * .05) * .3), sy = H * (.36 + Math.cos(t * .04) * .08), sr = H * .5;
    const sh = g.createRadialGradient(sx, sy, 0, sx, sy, sr); sh.addColorStop(0, 'rgba(255,255,255,.09)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = sh; g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    if (c.ht != null && c.ht !== prismHt) { if (prismHt != null) { prismRip.push(t); if (prismRip.length > 3) prismRip.shift(); } prismHt = c.ht; }
    for (let i = prismRip.length - 1; i >= 0; i--) { const k = (t - prismRip[i]) / 2.2; if (k >= 1 || k < 0) { prismRip.splice(i, 1); continue; }
      const cx = W / 2, cy = H * (c.floorY - .08), rr = W * (.05 + k * .55);
      g.strokeStyle = hsl(c.hue + 40 + k * 120, 90, 80, .22 * (1 - k)); g.lineWidth = Math.max(1, H * .03 * (1 - k)); g.beginPath(); g.ellipse(cx, cy, rr, rr * .32, 0, 0, 6.2832); g.stroke(); }
  }
  // Hologram: bright lines slide down the grid towards you, a scan band runs down the screen, motes drift up
  function holoFx(c) {
    if (c.still) return; // the grid and glow on the backdrop are the still picture
    const { g, W, H, t } = c, hy = H * HZ2, hu = pull(c.hue, 195, .2);
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      const u = ((t * .16 + k / 3) % 1), y = hy + (H - hy) * u * u;
      const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(90,220,255,0)'); gr.addColorStop(.5, hsl(hu, 95, 72, .1 + u * .35)); gr.addColorStop(1, 'rgba(90,220,255,0)');
      g.fillStyle = gr; g.fillRect(0, y - 1, W, Math.max(1.5, 3 * u * c.scale));
    }
    const sy = ((t * .06) % 1.2 - .1) * H, sh = H * .1;
    const sg = g.createLinearGradient(0, sy - sh, 0, sy + sh); sg.addColorStop(0, 'rgba(120,230,255,0)'); sg.addColorStop(.5, 'rgba(120,230,255,.05)'); sg.addColorStop(1, 'rgba(120,230,255,0)');
    g.fillStyle = sg; g.fillRect(0, sy - sh, W, sh * 2);
    for (let k = 0; k < 16; k++) {
      const life = (t * .035 + k * .137) % 1, x = W * (.06 + ((k * .618) % 1) * .88), y = hy - life * hy * .8, al = Math.sin(life * 3.1416) * .5;
      if (Math.abs(x / W - .5) < .2 && y > hy * .7) continue;
      const rr = Math.max(1.2, H * .004);
      g.fillStyle = hsl(hu + (k % 3) * 12, 100, 80, al); g.fillRect(x - rr / 2, y - rr / 2, rr, rr);
    }
  }

  // ---------- (beta.14) six more: Starfield, Rainy Night, Cherry Blossom, Snowfall, and the showpieces Event Horizon and Glass Lake ----------
  // (They replace Pocket and Walnut; a saved pocket / walnut is mapped by BS_THEME_RETIRED below.) All six move on
  // #themeFx's three CSS layers only (themes-extra.css): transform and opacity, run by the graphics card, no frame loop and no
  // canvas. They hold while the shelf slides (app.js fxHold), are still at Handheld / Low (body:not(.fx)) and with Reduce
  // motion. The backdrop (tint) is the finished still picture, the one the bottom screen wears. The pictures the layers move
  // are made once here and handed to the CSS as custom properties. A tile that falls is drawn to the shape it's shown at on a
  // 16:9 screen (viewBox 1600 x 1600 * tile height / tile width), so its flakes and petals stay round.
  const softTile = (seed, n, h, col, rr, oo) => { const rnd = seeded(seed); let s = '';
    for (let i = 0; i < n; i++) s += `<circle cx='${Math.round(rnd() * 1600)}' cy='${Math.round(rr[1] + rnd() * (h - rr[1] * 2))}' r='${r1(rr[0] + rnd() * (rr[1] - rr[0]))}' opacity='${r1(oo[0] + rnd() * (oo[1] - oo[0]))}'/>`;
    return svg(`0 0 1600 ${h}`, `<defs><radialGradient id='f'><stop offset='0' stop-color='${col}'/><stop offset='.45' stop-color='${col}' stop-opacity='.75'/><stop offset='1' stop-color='${col}' stop-opacity='0'/></radialGradient></defs><g fill='url(#f)'>${s}</g>`); };
  // rain: straight streaks in three strengths (the layer's skew slants them and their fall)
  const rainTile = (seed, n, h, len, op) => { const rnd = seeded(seed), d = ['', '', ''];
    for (let i = 0; i < n; i++) { const l = len[0] + rnd() * (len[1] - len[0]); d[Math.min(2, Math.floor(rnd() * 3))] += `M${Math.round(rnd() * 1600)} ${Math.round(rnd() * (h - l))}v${Math.round(l)}`; }
    return svg(`0 0 1600 ${h}`, `<g fill='none' stroke='#d2e2ff' stroke-width='1.3' stroke-linecap='round'>${d.map((p, k) => p ? `<path d='${p}' stroke-opacity='${r1(op * (.45 + k * .35))}'/>` : '').join('')}</g>`); };
  const petalTile = (seed, n, h, sz, oo) => { const rnd = seeded(seed); let s = '';
    for (let i = 0; i < n; i++) { const x = Math.round(rnd() * 1600), y = Math.round(sz * 2 + rnd() * (h - sz * 4)), w = r1(sz * (.7 + rnd() * .6));
      s += `<ellipse cx='${x}' cy='${y}' rx='${w}' ry='${r1(w * .55)}' transform='rotate(${Math.round(rnd() * 180)} ${x} ${y})' opacity='${r1(oo[0] + rnd() * (oo[1] - oo[0]))}'/>`; }
    return svg(`0 0 1600 ${h}`, `<defs><linearGradient id='p' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#fff3f7'/><stop offset='.55' stop-color='#ffbccf'/><stop offset='1' stop-color='#ee86a5'/></linearGradient></defs><g fill='url(#p)'>${s}</g>`); };
  // northern lights: a curtain of narrow rays, each fading up from a bright lower hem that waves along the sky; each ray is
  // three steps wide at a third of the strength, so neighbours overlap and blend instead of standing as bars
  // (flip: the same curtain upside down, for its reflection in the lake)
  const auroraSvg = (seed, n, base, amp, hgt, op, cols, flip) => { const rnd = seeded(seed), ph = rnd() * 6.28, step = 1600 / n; let s = '';
    for (let i = -1; i <= n; i++) { const u = (i + .5) / n, yb = base + amp * Math.sin(u * 7.5 + ph) + amp * .4 * Math.sin(u * 19.5 + ph * 2), h = hgt * (.55 + .45 * Math.sin(u * 5 + ph * .7));
      const ray = .25 + .75 * Math.pow(.5 + .5 * Math.sin(u * 57 + ph + Math.sin(u * 14.5) * 2), 2.5), o = ray * Math.pow(Math.max(0, Math.sin(Math.PI * u)), .6) * op * (.8 + rnd() * .4) * .4;
      if (o < .012) continue;
      s += `<rect x='${r1((i - 1) * step)}' y='${Math.round(flip ? 400 - yb : yb - h)}' width='${r1(step * 3)}' height='${Math.round(h)}' opacity='${o.toFixed(3)}'/>`; }
    const [a, b, c] = cols, st = `<stop offset='0' stop-color='${a}' stop-opacity='0'/><stop offset='.06' stop-color='${a}' stop-opacity='.95'/><stop offset='.32' stop-color='${b}' stop-opacity='.5'/><stop offset='.75' stop-color='${c}' stop-opacity='.14'/><stop offset='1' stop-color='${c}' stop-opacity='0'/>`;
    return svg('0 0 1600 400', `<defs><linearGradient id='g' x1='0' y1='${flip ? 0 : 1}' x2='0' y2='${flip ? 1 : 0}'>${st}</linearGradient></defs><g fill='url(#g)'>${s}</g>`); };

  // Starfield: deep black, a faint glow far ahead; two star layers fly towards you in turn (themes-extra.css bsTxWarp)
  const SF_STARS = dotField(91, 130, 900, '#eef3ff', STAR_SIZES);
  // the still picture's sense of travel: short streaks pointing away from the point ahead, longer the further out they are
  const SF_STREAKS = (() => { const rnd = seeded(131); let d = '';
    for (let i = 0; i < 40; i++) { const a = rnd() * 6.2832, r = 130 + rnd() * 600, l = 3 + r * .022, c = Math.cos(a), s = Math.sin(a) * .8;
      d += `M${Math.round(800 + c * r)} ${Math.round(342 + s * r)}l${Math.round(c * l)} ${Math.round(s * l)}`; }
    return svg('0 0 1600 900', `<path d='${d}' fill='none' stroke='#d4e0ff' stroke-opacity='.3' stroke-width='1.6' stroke-linecap='round'/>`, 'xMidYMid slice'); })();
  // Rainy Night: city lights out of focus (amber and blue) and beads of water on the glass; rain falls in front
  const RAIN_GLASS = (() => { const rnd = seeded(93); let b = '', d = '';
    for (let i = 0; i < 14; i++) { const x = Math.round(rnd() * 1600), y = Math.round(40 + rnd() * rnd() * 520), r = Math.round(22 + rnd() * 46);
      b += `<circle cx='${x}' cy='${y}' r='${r}' fill='url(#${rnd() < .62 ? 'a' : 'b'})' opacity='${r1(.25 + rnd() * .4)}'/>`; }
    for (let i = 0; i < 26; i++) d += `<circle cx='${Math.round(rnd() * 1600)}' cy='${Math.round(rnd() * 880)}' r='${r1(2 + rnd() * 5)}'/>`;
    const disc = (id, c) => `<radialGradient id='${id}'><stop offset='0' stop-color='${c}' stop-opacity='.42'/><stop offset='.68' stop-color='${c}' stop-opacity='.4'/><stop offset='.86' stop-color='${c}' stop-opacity='.5'/><stop offset='1' stop-color='${c}' stop-opacity='0'/></radialGradient>`;
    return svg('0 0 1600 900', `<defs>${disc('a', '#ffaa55')}${disc('b', '#5f9cff')}<radialGradient id='d'><stop offset='.55' stop-color='#cfe4ff' stop-opacity='.04'/><stop offset='.85' stop-color='#dcebff' stop-opacity='.4'/><stop offset='1' stop-color='#dcebff' stop-opacity='0'/></radialGradient></defs>${b}<g fill='url(#d)'>${d}</g>`, 'xMidYMid slice');
  })();
  // Cherry Blossom: a flowering branch hanging in from the top on each side (clear of the console's name, the tabs and the
  // clock) over a dusky pink sky
  const SAKURA_BRANCH = (() => { const rnd = seeded(95), pts = [[272, 8], [300, 58], [350, 94], [410, 116], [470, 138], [540, 164], [440, 42], [396, 54], [440, 198], [582, 118], [520, 140]];
    const d = ['', '', ''];
    for (const [x0, y0] of pts) for (let i = 0; i < 6; i++) d[i % 3] += `M${Math.round(x0 + (rnd() - .5) * 56)} ${Math.round(y0 + (rnd() - .5) * 40)}h0`;
    const g = `<g id='t'><path d='M262 -20C282 40 322 84 396 112C452 134 500 150 566 172' stroke-width='9'/><path d='M330 86C360 60 400 46 446 40M432 126C440 160 430 190 446 214M500 150C530 128 560 118 600 116' stroke-width='4'/>` +
      `<g stroke-linecap='round'><path d='${d[0]}' stroke='#f6a0bc' stroke-opacity='.55' stroke-width='22'/><path d='${d[1]}' stroke='#ffc4d4' stroke-opacity='.7' stroke-width='13'/><path d='${d[2]}' stroke='#fff0f5' stroke-opacity='.85' stroke-width='6'/></g></g>`;
    return svg('0 0 1600 900', `<g fill='none' stroke='#1c0d1a'>${g}<use href='#t' transform='matrix(-1 0 0 1 1600 -14)'/></g>`, 'xMidYMid slice');
  })();
  // Snowfall: snowy hills under a cold moon; flakes fall in front
  const SNOW_HILLS = svg('0 0 1600 900', `<defs><linearGradient id='h' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#34588c'/><stop offset='.2' stop-color='#152844'/><stop offset='1' stop-color='#070e1a'/></linearGradient></defs>` +
    `<path d='M0 470C220 440 420 462 640 452C860 442 1060 466 1260 450C1420 438 1520 452 1600 446V900H0Z' fill='#1d3558' fill-opacity='.75'/>` +
    `<path d='M0 506C170 470 360 498 560 486C760 474 900 508 1100 492C1300 476 1450 500 1600 482V900H0Z' fill='url(#h)'/><path d='M0 506C170 470 360 498 560 486C760 474 900 508 1100 492C1300 476 1450 500 1600 482' fill='none' stroke='#d6e6ff' stroke-opacity='.35' stroke-width='2'/>`);
  const SNOW_STILL = dotField(97, 80, 900, '#f2f8ff', [[1.6, .25], [2.6, .45], [3.8, .6]]);
  // Event Horizon: a black hole behind the shelf, seen almost edge-on (one picture in the 1600 x 900 frame, cover, so the
  // CSS layers can sit on it exactly: centre 800,330, shadow r 170). Its glowing disk crosses in front of the shadow low down
  // and passes behind it high up; the light of the disk's far side, bent round the hole, makes a bright ring over the top
  // and a fainter one under it; the side turning towards you is brighter
  const EH = (() => { const C = 'cx=\'800\' cy=\'330\'';
    return svg('0 0 1600 900', `<defs><radialGradient id='g' ${C} r='560' gradientUnits='userSpaceOnUse'><stop offset='.28' stop-color='#ff9a4a' stop-opacity='.24'/><stop offset='.6' stop-color='#ff6a2a' stop-opacity='.07'/><stop offset='1' stop-color='#ff5a20' stop-opacity='0'/></radialGradient>` +
      `<radialGradient id='l' ${C} r='250' gradientUnits='userSpaceOnUse'><stop offset='.68' stop-color='#ffe2b0' stop-opacity='0'/><stop offset='.7' stop-color='#fff6e6'/><stop offset='.76' stop-color='#ffc070' stop-opacity='.8'/><stop offset='.88' stop-color='#e0602a' stop-opacity='.3'/><stop offset='1' stop-color='#a03010' stop-opacity='0'/></radialGradient>` +
      `<linearGradient id='v' gradientUnits='userSpaceOnUse' x1='0' y1='80' x2='0' y2='580'><stop offset='.45' stop-color='#fff'/><stop offset='.62' stop-color='#fff' stop-opacity='.32'/></linearGradient><mask id='m'><rect width='1600' height='900' fill='url(#v)'/></mask>` +
      `<radialGradient id='d'><stop offset='.2' stop-color='#fff8e8' stop-opacity='0'/><stop offset='.235' stop-color='#fff8e8'/><stop offset='.33' stop-color='#ffcf80' stop-opacity='.85'/><stop offset='.52' stop-color='#ff8a3a' stop-opacity='.45'/><stop offset='.76' stop-color='#b83a18' stop-opacity='.16'/><stop offset='1' stop-color='#601008' stop-opacity='0'/></radialGradient>` +
      `<linearGradient id='h'><stop offset='0' stop-color='#fff'/><stop offset='1' stop-color='#fff' stop-opacity='.45'/></linearGradient><mask id='k'><rect width='1600' height='900' fill='url(#h)'/></mask>` +
      `<radialGradient id='s'><stop offset='.94' stop-color='#000'/><stop offset='1' stop-color='#000' stop-opacity='0'/></radialGradient>` +
      `<ellipse id='e' ${C} rx='860' ry='103' fill='url(#d)'/><clipPath id='b'><path d='M630 330A170 170 0 0 0 970 330Z'/></clipPath></defs>` +
      `<circle ${C} r='560' fill='url(#g)'/><circle ${C} r='250' fill='url(#l)' mask='url(#m)'/><g mask='url(#k)'><use href='#e'/></g>` +
      `<circle ${C} r='170' fill='url(#s)'/><circle ${C} r='172.5' fill='none' stroke='#fff1d8' stroke-opacity='.85' stroke-width='2.4'/><g mask='url(#k)'><use href='#e' clip-path='url(#b)'/></g>`, 'xMidYMid slice');
  })();
  const EH_STARS = dotField(101, 40, 900, '#fff', STAR_SIZES);
  // Glass Lake: two mountain ranges standing in still water (each with its reflection, fading with depth), stars, and the
  // northern lights on the CSS layers; the ranges shift a little with your place along the shelf (tint's p), the near one more
  const GL_WL = 518; // the waterline in the 1600 x 900 frame (57.6%, the shelf's floor)
  const glRange = (seed, n, hf, top, bot, refl, rim) => { const rnd = seeded(seed); let d = `M-40 ${GL_WL}`;
    for (let i = 0; i <= n; i++) { const x = -40 + i * 1680 / n; d += `L${Math.round(x)} ${Math.round(GL_WL - hf(x, rnd))}`; }
    let rip = ''; if (rim) for (let i = 0; i < 4; i++) rip += `<rect x='${Math.round(rnd() * 1100)}' y='${Math.round(GL_WL + 8 + rnd() * 190)}' width='${Math.round(200 + rnd() * 600)}' height='1.4'/>`;
    return svg('0 0 1600 900', `<defs><path id='m' d='${d}L1640 ${GL_WL}Z'/><linearGradient id='a' gradientUnits='userSpaceOnUse' x1='0' y1='300' x2='0' y2='${GL_WL}'><stop offset='0' stop-color='${top}'/><stop offset='1' stop-color='${bot}'/></linearGradient>` +
      `<linearGradient id='r' gradientUnits='userSpaceOnUse' x1='0' y1='${GL_WL}' x2='0' y2='300'><stop offset='0' stop-color='${refl}' stop-opacity='.9'/><stop offset='1' stop-color='${refl}' stop-opacity='.4'/></linearGradient></defs>` +
      `<use href='#m' fill='url(#r)' transform='matrix(1 0 0 -1 0 ${GL_WL * 2})'/><use href='#m' fill='url(#a)'/>` +
      (rim ? `<use href='#m' fill='none' stroke='${rim}' stroke-opacity='.14' stroke-width='2'/><g fill='#a8e0ff' opacity='.05'>${rip}</g>` : '')); };
  const GL_FAR = glRange(103, 32, (x, rnd) => 70 + 80 * Math.abs(Math.sin(x / 1600 * 5.2 + .4)) + rnd() * 30, '#163650', '#0b1c2c', '#0a1a28', '#7dffd0');
  const GL_NEAR = glRange(107, 26, (x, rnd) => { const e = Math.min(1, Math.abs(x - 800) / 800); return 26 + 130 * Math.pow(e, 1.6) + 30 * Math.abs(Math.sin(x / 90)) * e + rnd() * 16; }, '#07121c', '#03080e', '#02070c');
  const GL_STARS = dotField(109, 40, 450, '#e8f4ff', STAR_SIZES, 'none');
  try { const st = document.documentElement.style;
    st.setProperty('--bs-sf-a', dotField(111, 90, 900, '#e6eeff', [[1, .4], [1.6, .7], [2.3, .95]])); st.setProperty('--bs-sf-b', dotField(113, 90, 900, '#dfe8ff', [[1, .4], [1.6, .7], [2.3, .95]]));
    st.setProperty('--bs-rain-a', rainTile(115, 70, 346, [28, 64], .34)); st.setProperty('--bs-rain-b', rainTile(117, 150, 346, [12, 30], .2));
    st.setProperty('--bs-sk-a', petalTile(119, 16, 321, 8, [.6, .95])); st.setProperty('--bs-sk-b', petalTile(121, 34, 321, 4.6, [.35, .7]));
    st.setProperty('--bs-sn-a', softTile(123, 30, 375, '#ffffff', [2.4, 5], [.55, .95])); st.setProperty('--bs-sn-b', softTile(125, 90, 375, '#e6f0ff', [.9, 2.1], [.35, .8]));
    st.setProperty('--bs-gl-a', auroraSvg(127, 160, 270, 36, 200, .95, ['#5dffb4', '#29e0c0', '#7d5cff'])); st.setProperty('--bs-gl-ar', auroraSvg(127, 160, 270, 36, 200, .95, ['#5dffb4', '#29e0c0', '#7d5cff'], true));
    st.setProperty('--bs-gl-b', auroraSvg(129, 110, 190, 28, 130, .65, ['#7bffd0', '#4ab8ff', '#c070ff'])); } catch {}

  // ---------- (beta.14) five more: Neon City, Deep Sea, Thunderstorm, Fireflies, Desert Night ----------
  // Built like the six above: only #themeFx's three layers move (themes-extra.css), by transform and opacity, with no frame
  // loop and no canvas; they hold while the shelf slides, and are still at Handheld / Low and with Reduce motion. The backdrop
  // is the finished still picture (the bottom screen's, under 4000 characters); the layers' pictures are made once here and
  // handed to the CSS as custom properties (--bs-nc-*, --bs-ds-*, --bs-st-*, --bs-ff-*, --bs-dn-*).

  // Neon City: a skyline at night, the far towers in the city's magenta haze, the near ones dark with lit windows and neon
  // signs (frame 1600 x 900, cover; the street at 518, the shelf's floor). On the layers: a set of windows that flickers,
  // tail lights streaming along the street at the towers' feet, and traffic on a sky lane above
  const NC_HZ = 518;
  const ncTowers = (seed, hf, gap, w0) => { const rnd = seeded(seed), t = []; let x = -8;
    while (x < 1608) { const w = w0 + Math.round(rnd() * 44), h = Math.max(16, Math.round(hf(x + w / 2, rnd))); t.push([x, w, h, rnd() < .2]); x += w + Math.round(rnd() * gap); }
    return t; };
  const ncPath = ts => ts.map(([x, w, h, crown]) => { if (!crown) return `M${x} ${NC_HZ}v-${h}h${w}v${h}z`; const a = Math.round(w * .2);
    return `M${x} ${NC_HZ}v-${h}h${a}v-12h${w - a * 2}v12h${a}v${h}z`; }).join('');
  const NC_FAR = ncTowers(141, (x, rnd) => 60 + rnd() * 130 + 70 * Math.abs(Math.sin(x / 230)), 3, 36);
  const NC_NEAR = ncTowers(143, (x, rnd) => { const e = Math.min(1, Math.abs(x - 800) / 800); return 24 + 390 * Math.pow(e, 1.15) * (.5 + .5 * rnd()); }, 6, 34);
  // lit windows (4 x 5 marks on a 9 x 12 grid inside each tower), shared out among a few colours
  const ncWindows = (seed, ts, p, n) => { const rnd = seeded(seed), d = Array(n).fill('');
    for (const [x, w, h] of ts) for (let y = NC_HZ - h + 9; y < NC_HZ - 8; y += 12) for (let xx = x + 5; xx < x + w - 8; xx += 9) if (rnd() < p) d[Math.floor(rnd() * n)] += `M${xx} ${y}h4`;
    return d; };
  const NC_SKY = (() => { const [wa, wb] = ncWindows(145, NC_NEAR, .02, 2), sg = ['', ''];
    [...NC_NEAR].sort((a, b) => b[2] - a[2]).slice(0, 4).forEach(([x, w, h], k) => { sg[k % 2] += `M${x + Math.round(w * .3)} ${NC_HZ - h + 24}v${Math.round(Math.min(90, h * .35))}`; });
    const sign = (d, c) => `<path d='${d}' stroke='${c}' stroke-width='11' stroke-opacity='.2'/><path d='${d}' stroke='${c}' stroke-width='3'/>`;
    return svg('0 0 1600 900', `<defs><linearGradient id='f' gradientUnits='userSpaceOnUse' x1='0' y1='260' x2='0' y2='${NC_HZ}'><stop offset='0' stop-color='#1d0d3e'/><stop offset='1' stop-color='#521a6a'/></linearGradient>` +
      `<pattern id='w' width='9' height='12' patternUnits='userSpaceOnUse'><path d='M5 4h4' stroke='#ffc98a' stroke-width='5' stroke-opacity='.1'/></pattern><path id='n' d='${ncPath(NC_NEAR)}'/></defs>` +
      `<path d='${ncPath(NC_FAR)}' fill='url(#f)'/><use href='#n' fill='#08040f'/><use href='#n' fill='url(#w)'/>` +
      `<g fill='none' stroke-width='5'><path d='${wa}' stroke='#ffc777' stroke-opacity='.6'/><path d='${wb}' stroke='#76e4ff' stroke-opacity='.5'/></g>` +
      `<g fill='none' stroke-linecap='round'>${sign(sg[0], '#ff5ac8')}${sign(sg[1], '#4fe0ff')}</g>`, 'xMidYMid slice'); })();
  // the flickering set: more windows on the near towers (none where the backdrop's own are), and a neon bar on a few roofs
  const NC_FLICK = (() => { const d = ncWindows(147, NC_NEAR, .07, 3); let bar = '';
    NC_NEAR.filter(t => t[2] > 120 && !t[3]).slice(0, 5).forEach(([x, w, h]) => { bar += `M${x + 4} ${NC_HZ - h + 6}h${w - 8}`; });
    return svg('0 0 1600 900', `<g fill='none' stroke-width='5'><path d='${d[0]}' stroke='#ffd08a'/><path d='${d[1]}' stroke='#7fe8ff' stroke-opacity='.85'/><path d='${d[2]}' stroke='#ff9ad8' stroke-opacity='.8'/></g>` +
      `<g fill='none' stroke-linecap='round'><path d='${bar}' stroke='#ff4fb8' stroke-width='10' stroke-opacity='.22'/><path d='${bar}' stroke='#ffb0e4' stroke-width='2.6'/></g>`, 'xMidYMid slice'); })();
  // light trails: streaks with a bright head and a fading tail (headLeft: they travel left), kept inside the tile so it
  // repeats along the lane without a seam
  const ncTrails = (seed, n, h, len, core, cols, headLeft) => { const rnd = seeded(seed); let s = '';
    for (let i = 0; i < n; i++) { const l = Math.round(len[0] + rnd() * (len[1] - len[0])), x = Math.round(rnd() * (1600 - l)), y = core * 2 + rnd() * (h - core * 4);
      s += `<rect x='${x}' y='${r1(y - core * 1.6)}' width='${l}' height='${r1(core * 3.2)}' fill='url(#g)' opacity='.25'/><rect x='${x}' y='${r1(y - core / 2)}' width='${l}' height='${core}' fill='url(#g)'/>`; }
    return svg(`0 0 1600 ${h}`, `<defs><linearGradient id='g' x1='${headLeft ? 1 : 0}' y1='0' x2='${headLeft ? 0 : 1}' y2='0'><stop offset='0' stop-color='${cols[0]}' stop-opacity='0'/><stop offset='.82' stop-color='${cols[0]}' stop-opacity='.85'/><stop offset='1' stop-color='${cols[1]}'/></linearGradient></defs>${s}`); };

  // Deep Sea: deep water, rays from the surface, marine snow; glowing jellyfish drift up through it on two layers (near and
  // far), kept mostly to the sides of the shelf. One jellyfish: a scalloped bell with a light inside, a halo, trailing arms
  const dsJelly = (id, a, b) => `<radialGradient id='${id}h'><stop offset='0' stop-color='${a}' stop-opacity='.5'/><stop offset='.4' stop-color='${a}' stop-opacity='.2'/><stop offset='1' stop-color='${a}' stop-opacity='0'/></radialGradient>` +
    `<radialGradient id='${id}b' cx='.5' cy='.3' r='.7'><stop offset='0' stop-color='#fff'/><stop offset='.35' stop-color='${b}' stop-opacity='.9'/><stop offset='1' stop-color='${a}' stop-opacity='.4'/></radialGradient>` +
    `<g id='${id}'><circle cx='50' cy='24' r='70' fill='url(#${id}h)'/><path d='M8 34C8 8 28 0 50 0S92 8 92 34C82 29 76 38 67 33S56 40 50 35S41 40 33 33S18 29 8 34Z' fill='url(#${id}b)'/>` +
    `<g fill='none' stroke='${b}' stroke-linecap='round'><path d='M42 36c-2 20 10 28 4 52M58 36c2 20-10 28-4 52' stroke-width='5' stroke-opacity='.3'/>` +
    `<path d='M22 34c-8 30 8 52-2 96M36 36c4 36-8 62 2 118M64 36c-4 36 8 62-2 112M78 34c8 30-8 52 2 92' stroke-width='1.4' stroke-opacity='.62'/></g></g>`;
  // one screen of them (the layer is two screens tall and rises one screen a loop), none crossing the tile's edge
  const dsTile = (seed, n, sz, oo) => { const rnd = seeded(seed); let s = '';
    for (let i = 0; i < n; i++) { const k = sz[0] + rnd() * (sz[1] - sz[0]), u = rnd(), x = i % 2 ? 1570 - k * 100 - u * 480 : 30 + u * 520, y = 12 + rnd() * (876 - k * 160);
      s += `<use href='#${i % 3 ? 'p' : 'c'}' transform='translate(${Math.round(x)} ${Math.round(y)}) scale(${k.toFixed(2)})' opacity='${r1(oo[0] + rnd() * (oo[1] - oo[0]))}'/>`; }
    return svg('0 0 1600 900', `<defs>${dsJelly('p', '#ff7ad0', '#ffc6ee')}${dsJelly('c', '#5fdcff', '#c8f6ff')}</defs>${s}`); };
  const DS_SNOW = dotField(163, 64, 900, '#d8f4ff', [[1.4, .14], [2.2, .24], [3, .32]]);

  // Thunderstorm: heavy clouds over dark hills, faint rain curtains; on the layers a soft lightning glow (behind the clouds,
  // a few seconds apart and low contrast, never a strobe) and two cloud decks rolling past at different speeds
  // a cloud deck: a dark ceiling with soft masses hanging from it, each puff drawn round and then stretched wide (the group's
  // scale), soft-edged; a puff that crosses the tile's edge is drawn again on the other side, so the deck repeats seamlessly
  const stCloudTile = (seed, n, h, ry, rr, body, op) => { const rnd = seeded(seed), W = 1600 / 2.4; let b = '';
    for (let i = 0; i < n; i++) { const x = Math.round(rnd() * W), y = Math.round(ry[0] + rnd() * (ry[1] - ry[0])), r = Math.round(rr[0] + rnd() * (rr[1] - rr[0])), o = r1(op[0] + rnd() * (op[1] - op[0]));
      for (const dx of x - r < 0 ? [0, W] : x + r > W ? [0, -W] : [0]) b += `<circle cx='${r1(x + dx)}' cy='${y}' r='${r}' opacity='${o}'/>`; }
    return svg(`0 0 1600 ${h}`, `<defs><radialGradient id='c'><stop offset='0' stop-color='${body}'/><stop offset='.45' stop-color='${body}' stop-opacity='.85'/><stop offset='1' stop-color='${body}' stop-opacity='0'/></radialGradient>` +
      `<linearGradient id='t' x1='0' y1='0' x2='0' y2='1'><stop offset='.3' stop-color='${body}'/><stop offset='1' stop-color='${body}' stop-opacity='0'/></linearGradient></defs><rect width='1600' height='${ry[0] + rr[0]}' fill='url(#t)'/><g fill='url(#c)' transform='scale(2.4 1)'>${b}</g>`); };
  const ST_SKY = (() => { const rnd = seeded(165); let c = '';
    for (let i = 0; i < 30; i++) { const k = i % 3; c += `<circle cx='${Math.round(rnd() * 730)}' cy='${Math.round([60, 150, 250][k] + (rnd() - .5) * 110)}' r='${[150, 110, 80][k] + Math.round(rnd() * 50)}' fill='url(#${'abc'[k]})'/>`; }
    const g = (id, col, a) => `<radialGradient id='${id}'><stop offset='0' stop-color='${col}' stop-opacity='${a}'/><stop offset='1' stop-color='${col}' stop-opacity='0'/></radialGradient>`;
    return svg('0 0 1600 900', `<defs>${g('a', '#121725', .8)}${g('b', '#1b2232', .7)}${g('c', '#3a4560', .4)}</defs><g transform='scale(2.2 1)'>${c}</g>` +
      `<path d='M0 506C140 486 260 470 420 488C560 504 700 482 860 494C1020 506 1180 476 1340 484C1460 490 1540 500 1600 496V530H0Z' fill='#0a0d15'/>`, 'xMidYMid slice'); })();
  const ST_BOLT = svg('0 0 100 300', `<g fill='none' stroke='#e6ecff' stroke-linejoin='round'><path id='b' d='M54 0L47 58L57 64L41 138L51 145L37 226L45 232L39 300M47 108L30 150L34 176' stroke-width='6' stroke-opacity='.14'/><use href='#b' stroke-width='1.6' stroke-opacity='.6'/></g>`);

  // Fireflies: a meadow at dusk, a tree line on the glowing horizon and tall grass in the corners; three swarms of fireflies
  // wander and blink, each at its own pace, kept off the column where the selected game and its name sit
  const ffTile = (seed, n) => { const rnd = seeded(seed); let s = '';
    for (let i = 0; i < n; i++) { let x, y; do { x = 40 + rnd() * 1520; y = 130 + rnd() * 720; } while (Math.abs(x - 800) < 300 && y > 110 && y < 800);
      s += `<circle cx='${Math.round(x)}' cy='${Math.round(y)}' r='${r1(9 + rnd() * 10)}' opacity='${r1(.6 + rnd() * .4)}'/>`; }
    return svg('0 0 1600 900', `<defs><radialGradient id='f'><stop offset='0' stop-color='#fffef0'/><stop offset='.1' stop-color='#f4ffa0'/><stop offset='.22' stop-color='#d4f860' stop-opacity='.7'/><stop offset='.5' stop-color='#b4ec48' stop-opacity='.2'/><stop offset='1' stop-color='#a0e040' stop-opacity='0'/></radialGradient></defs><g fill='url(#f)'>${s}</g>`, 'xMidYMid slice'); };
  const FF_LAND = (() => { const rnd = seeded(167), tr = ['', '', '']; let gr = '', ff = '', pn = '';
    // the tree line: round crowns of three sizes, uneven along the horizon, and a few pines standing out of it
    for (let x = -20; x < 1630; x += 18 + Math.round(rnd() * 30)) { const k = Math.floor(rnd() * 3); tr[k] += `M${x} ${Math.round(514 - [22, 12, 4][k] - rnd() * rnd() * 34)}h0`; }
    for (let i = 0; i < 8; i++) { const x = Math.round(i % 2 ? 1600 - rnd() * 520 : rnd() * 520), h = Math.round(50 + rnd() * 50), w = Math.round(h * .22); pn += `M${x} ${510 - h}l${w} ${h}h-${w * 2}z`; }
    for (let i = 0; i < 34; i++) { const side = i % 2, x = side ? 1600 - rnd() * 360 : rnd() * 360, h = 60 + rnd() * 120 * (1 - Math.abs((side ? 1600 - x : x) / 360 - .3)), dx = (rnd() - .5) * 24;
      gr += `M${Math.round(x)} 900q${Math.round(dx)} -${Math.round(h * .55)} ${Math.round(dx * 2.4)} -${Math.round(h)}`; }
    for (let i = 0; i < 9; i++) { const side = i % 2; ff += `<circle cx='${Math.round(side ? 1590 - rnd() * 520 : 10 + rnd() * 520)}' cy='${Math.round(160 + rnd() * 660)}' r='12'/>`; }
    return svg('0 0 1600 900', `<defs><radialGradient id='f'><stop offset='0' stop-color='#fffef0'/><stop offset='.12' stop-color='#f4ffa0'/><stop offset='.3' stop-color='#d4f860' stop-opacity='.5'/><stop offset='1' stop-color='#a0e040' stop-opacity='0'/></radialGradient></defs>` +
      `<path d='${pn}' fill='#060c07'/><g fill='none' stroke-linecap='round' stroke='#060c07'><path d='${tr[0]}' stroke-width='84'/><path d='${tr[1]}' stroke-width='56'/><path d='${tr[2]}' stroke-width='36'/><path d='M0 522H1600' stroke-width='22'/>` +
      `<path d='${gr}' stroke='#030603' stroke-width='3.4'/></g><g fill='url(#f)'>${ff}</g>`, 'xMidYMid slice'); })();
  const FF_STARS = dotField(169, 26, 420, '#fff', STAR_SIZES, 'none');

  // Desert Night: moonlit dunes under a sky that slowly turns about a point high on the left (a disc of stars on layer 1,
  // fading towards its rim); layer 2 lays the dunes and the moon back over it so no star passes in front of them; layer 3 is
  // a shooting star now and then, starting from a different place each time
  // a range of dunes from its troughs and crests (trough, crest, trough, ...): a steep slip face rising to each sharp crest
  // and a long gentle back sloping away towards the moon; the slip face in shadow, the crest's edge catching the light
  const dnRange = (pts, fill, op, shade) => { let d = `M-10 ${pts[0][1]}`, s = '';
    for (let i = 0; i + 2 < pts.length; i += 2) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], [x2, y2] = pts[i + 2], up = `Q${Math.round(x0 + (x1 - x0) * .72)} ${y0} ${x1} ${y1}`;
      d += `L${x0} ${y0}${up}Q${Math.round(x1 + (x2 - x1) * .3)} ${y1} ${x2} ${y2}`;
      s += `M${x0} ${y0}${up}Q${Math.round(x1 + (x2 - x1) * .1)} ${Math.round(y1 + (y0 - y1) * .7)} ${Math.round(x1 - (x1 - x0) * .08)} ${Math.round(y0 + (y0 - y1) * .6)}Z`; }
    return `<path d='${d}L1610 ${pts[pts.length - 1][1]}V910H-10Z' fill='url(#${fill})' stroke-opacity='${op}'/><path d='${s}' fill='${shade}' stroke='none'/>`; };
  const DN_DUNES = svg('0 0 1600 900', `<defs><linearGradient id='a' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#4a5482'/><stop offset='.5' stop-color='#1c2242'/></linearGradient>` +
    `<linearGradient id='b' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#323a62'/><stop offset='.6' stop-color='#0e1228'/></linearGradient><linearGradient id='c' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#1d2242'/><stop offset='.5' stop-color='#05070f'/></linearGradient></defs>` +
    `<g stroke='#dfe6ff' stroke-width='2'>${dnRange([[-10, 512], [200, 478], [430, 514], [660, 488], [880, 516], [1130, 474], [1390, 510], [1560, 486], [1610, 492]], 'a', .32, 'rgba(14,18,40,.55)')}` +
    `${dnRange([[-10, 604], [260, 556], [560, 612], [820, 574], [1090, 622], [1380, 560], [1610, 606]], 'b', .24, 'rgba(8,10,26,.6)')}` +
    `${dnRange([[-10, 744], [380, 668], [820, 762], [1250, 682], [1610, 750]], 'c', .16, 'rgba(2,3,10,.6)')}</g>`);
  const DN_MOON = 'radial-gradient(circle at 76% 17%,#fffaf0 0 2.1%,rgba(255,238,205,.32) 2.5%,rgba(190,200,255,.09) 7%,transparent 18%)';
  const DN_STARS = dotField(171, 62, 520, '#fff', STAR_SIZES, 'none');
  const DN_SPIN = (() => { const rnd = seeded(173), d = ['', '', '', '', '', ''];
    for (let i = 0; i < 240; i++) { const a = rnd() * 6.2832, r = Math.sqrt(rnd()) * 790, k = Math.min(2, Math.floor(rnd() * rnd() * 3.8));
      d[k + (r > 560 ? 3 : 0)] += `M${Math.round(800 + Math.cos(a) * r)} ${Math.round(800 + Math.sin(a) * r)}h0`; }
    return svg('0 0 1600 1600', `<g fill='none' stroke='#eef2ff' stroke-linecap='round'>${STAR_SIZES.map(([w, o], k) => `<path d='${d[k]}' stroke-width='${w}' stroke-opacity='${o}'/><path d='${d[k + 3]}' stroke-width='${w}' stroke-opacity='${r1(o * .5)}'/>`).join('')}<path d='M800 800h0' stroke-width='4.4'/></g>`); })();

  try { const st = document.documentElement.style;
    st.setProperty('--bs-nc-win', NC_FLICK); st.setProperty('--bs-nc-a', ncTrails(151, 9, 18, [120, 380], 2, ['#ff2f5e', '#ffd8e0'], false)); st.setProperty('--bs-nc-b', ncTrails(153, 6, 14, [80, 260], 1.4, ['#3fd0ff', '#eaffff'], true));
    st.setProperty('--bs-ds-a', dsTile(175, 6, [.75, 1.2], [.65, .95])); st.setProperty('--bs-ds-b', dsTile(177, 10, [.32, .52], [.3, .55]));
    st.setProperty('--bs-st-near', stCloudTile(179, 46, 500, [40, 330], [50, 115], '#0b0f17', [.85, 1])); st.setProperty('--bs-st-far', stCloudTile(181, 44, 360, [80, 250], [26, 64], '#3a465f', [.5, .9]));
    st.setProperty('--bs-st-bolt', ST_BOLT);
    st.setProperty('--bs-ff-a', ffTile(183, 17)); st.setProperty('--bs-ff-b', ffTile(185, 17)); st.setProperty('--bs-ff-c', ffTile(187, 15));
    st.setProperty('--bs-dn-spin', DN_SPIN);
    // (layer 2: the moon's disc and the dunes exactly as the backdrop draws them, and the darker patch under the game's name)
    st.setProperty('--bs-dn-cover', ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(2,3,10,.55),transparent 75%)', 'radial-gradient(circle at 76% 17%,#fffaf0 0 2.1%,transparent 2.3%)', `${DN_DUNES} 0 0/100% 100% no-repeat`].join(',')); } catch {}

  // a saved theme that has been retired, and the one it now shows (app.js themeId falls back to Spectrum without this)
  window.BS_THEME_RETIRED = { pocket: 'forest', walnut: 'midnight', crt: 'midnight', vhs: 'synth' }; /* (beta.14: CRT and VHS retired too) */

  window.BS_EXTRA_THEMES = [
    { id: 'cube', name: 'Cube', halo: sh => sh,
      swatch: `linear-gradient(30deg,#110d2e 12%,transparent 12.5%,transparent 87%,#110d2e 87.5%) 0 0/24px 42px,linear-gradient(150deg,#110d2e 12%,transparent 12.5%,transparent 87%,#110d2e 87.5%) 0 0/24px 42px,linear-gradient(30deg,#110d2e 12%,transparent 12.5%,transparent 87%,#110d2e 87.5%) 12px 21px/24px 42px,linear-gradient(150deg,#110d2e 12%,transparent 12.5%,transparent 87%,#110d2e 87.5%) 12px 21px/24px 42px,linear-gradient(60deg,#2a2366 25%,transparent 25.5%,transparent 75%,#2a2366 75%) 0 0/24px 42px,linear-gradient(60deg,#2a2366 25%,transparent 25.5%,transparent 75%,#2a2366 75%) 12px 21px/24px 42px,#1d1752`,
      tint: sh => [`radial-gradient(ellipse 46% 30% at 50% 57%,${hsl(sh, 72, 52, .36)},transparent 72%)`, `radial-gradient(ellipse 44% 48% at 50% 44%,rgba(14,11,40,.8),transparent 78%)`,
        `radial-gradient(ellipse 55% 45% at 18% 8%,${hsl(sh, 60, 48, .16)},transparent 70%)`, `linear-gradient(180deg,rgba(8,6,24,.55),transparent 24%,transparent 58%,rgba(5,4,16,.9))`, CUBE].join(',') },
    { id: 'blueshift', name: 'Blue Shift', halo: sh => pull(sh, 215, .35), fx: blueFx,
      swatch: 'linear-gradient(165deg,transparent 42%,rgba(190,220,255,.7) 44%,transparent 46%),linear-gradient(90deg,transparent 12%,rgba(110,170,255,.35) 12% 17%,transparent 17% 26%,rgba(110,170,255,.25) 26% 29%,transparent 29% 70%,rgba(110,170,255,.3) 70% 76%,transparent 76%) 0 100%/100% 55% no-repeat,linear-gradient(180deg,#000615,#00134a 55%,#1a4fd0 62%,#000a2a)',
      tint: sh => [`radial-gradient(ellipse 70% 20% at 50% 57%,rgba(70,140,255,.42),transparent 70%)`, `radial-gradient(ellipse 46% 34% at 50% 58%,${hsl(sh, 80, 52, .16)},transparent 70%)`,
        `${BLUE} 0 0/100% 100% no-repeat`, 'linear-gradient(180deg,#000514 0%,#000f3c 38%,#08287f 55.5%,#0b3197 57%,#03185a 59%,#000a2a 76%,#00030e 100%)'].join(',') },
    { id: 'swirl', name: 'Swirl', halo: () => 22, fx: swirlFx,
      swatch: 'radial-gradient(circle at 50% 46%,transparent 0 14%,rgba(255,106,26,.85) 15% 18%,transparent 19% 30%,rgba(255,106,26,.5) 31% 33%,transparent 34% 48%,rgba(255,106,26,.3) 49% 50.5%,transparent 52%),linear-gradient(180deg,#1d1e23,#0e0f12)',
      tint: sh => [`radial-gradient(ellipse 34% 30% at 50% 44%,rgba(255,120,40,.14),transparent 70%)`, `radial-gradient(ellipse 60% 30% at 50% 102%,${hsl(sh, 55, 45, .16)},transparent 72%)`,
        `${SWIRL} 50% 50%/cover no-repeat`, 'radial-gradient(ellipse 90% 80% at 50% 45%,transparent 50%,rgba(0,0,0,.55))', 'linear-gradient(180deg,#1c1d22,#131418 60%,#0b0c0e)'].join(',') },
    { id: 'oled', name: 'OLED', halo: sh => sh,
      swatch: 'radial-gradient(ellipse 34% 9% at 50% 66%,rgba(120,150,255,.7),transparent 75%),#000',
      tint: sh => `radial-gradient(ellipse 24% 6% at 50% 60%,${hsl(sh, 85, 52, .22)},transparent 75%),#000` },
    { id: 'forest', name: 'Forest', halo: sh => pull(sh, 120, .3), fx: forestFx,
      swatch: 'linear-gradient(135deg,transparent 30%,rgba(210,255,190,.25) 34%,transparent 40%,transparent 48%,rgba(210,255,190,.18) 51%,transparent 56%),linear-gradient(60deg,#04140c 18%,transparent 18%) 0 100%/30% 40% repeat-x,linear-gradient(180deg,#123826,#0a2218 60%,#04100b)',
      tint: sh => ['radial-gradient(ellipse 30% 14% at 50% 77%,rgba(3,12,8,.55),transparent 75%)', `${FOREST} 0 100%/100% 46% no-repeat`,
        'conic-gradient(from 112deg at 16% -32%,transparent 0deg,rgba(210,255,190,.1) 5deg,transparent 11deg,transparent 15deg,rgba(210,255,190,.075) 19deg,transparent 25deg,transparent 29deg,rgba(225,255,205,.11) 33deg,transparent 39deg,transparent 44deg,rgba(210,255,190,.06) 47deg,transparent 53deg,transparent 360deg)',
        `radial-gradient(ellipse 44% 30% at 50% 58%,${hsl(pull(sh, 120, .3), 40, 40, .2)},transparent 72%)`, 'radial-gradient(ellipse 50% 40% at 16% 0%,rgba(170,230,160,.13),transparent 70%)',
        'linear-gradient(180deg,#0e2e20,#0a2418 45%,#071a12 66%,#04100b)'].join(',') },
    /* (beta.14) CRT and VHS removed (crtFx / vhsFx and their pictures below are no longer used); a saved one falls back
       through BS_THEME_RETIRED */
    { id: 'synth', name: 'Synthwave', halo: sh => sh, fx: synthFx,
      swatch: 'radial-gradient(circle at 50% 62%,#ffd36a 0 22%,transparent 23%),linear-gradient(180deg,transparent 62%,#ff4fd8 62% 63%,transparent 63%),repeating-linear-gradient(0deg,rgba(255,79,216,.6) 0 1px,transparent 1px 7px) 0 100%/100% 37% no-repeat,linear-gradient(180deg,#120428,#5a1060 50%,#ff6a5a 62%,#120420 62%)',
      tint: sh => ['radial-gradient(ellipse 30% 13% at 50% 77%,rgba(8,2,18,.6),transparent 75%)', `${SYN_GRID} 0 100%/100% 43% no-repeat`,
        `radial-gradient(ellipse 60% 7% at 50% 57%,${hsl(sh, 95, 66, .5)},transparent 70%)`, `${SYN_SUN} 50% 34.85%/auto 34% no-repeat`,
        'radial-gradient(ellipse 40% 30% at 50% 50%,rgba(255,90,140,.22),transparent 72%)', 'linear-gradient(180deg,#0b0420 0%,#1c0838 28%,#47105c 45%,#a3246e 53%,#ff6a5a 56.9%,#14062a 57%,#0c0418 76%,#05020c 100%)'].join(',') },
    // (beta.14) css: moves on the CSS layers; fx + fps + busy: the canvas at half rate, still while the shelf slides.
    // blurb / chips / isNew: the Themes page (themes-page.js)
    { id: 'nebula', name: 'Nebula', halo: sh => pull(sh, 270, .3), css: true, isNew: true, blurb: 'Violet and teal clouds drifting through deep space', chips: ['Moving', 'Follows the game', 'Light on performance'],
      swatch: 'radial-gradient(ellipse 45% 35% at 32% 40%,rgba(150,70,255,.7),transparent 70%),radial-gradient(ellipse 40% 32% at 68% 58%,rgba(30,190,200,.55),transparent 70%),radial-gradient(1px 1px at 20% 30%,#fff,transparent),radial-gradient(1px 1px at 70% 20%,#fff,transparent),radial-gradient(1.5px 1.5px at 85% 70%,#fff,transparent),#03030a',
      tint: sh => [`radial-gradient(ellipse 34% 24% at 50% 60%,${hsl(sh, 70, 50, .2)},transparent 72%)`, `radial-gradient(ellipse 46% 36% at 30% 38%,${hsl(pull(sh, 275, .35), 75, 52, .46)},transparent 70%)`,
        `radial-gradient(ellipse 40% 32% at 70% 58%,${hsl(pull(sh, 185, .35), 75, 42, .38)},transparent 70%)`, 'radial-gradient(ellipse 30% 22% at 56% 26%,rgba(255,90,170,.16),transparent 70%)',
        `${NEB_STARS} 50% 50%/cover no-repeat`, 'linear-gradient(180deg,#05040f,#03030a 60%,#020208)'].join(',') },
    { id: 'abyss', name: 'Abyss', halo: sh => pull(sh, 200, .4), css: true, isNew: true, blurb: 'Deep ocean blue, slow shafts of light from above', chips: ['Moving', 'Calm', 'Light on performance'],
      swatch: 'linear-gradient(100deg,transparent 30%,rgba(160,230,255,.22) 40%,transparent 50%,transparent 60%,rgba(160,230,255,.14) 66%,transparent 74%),radial-gradient(ellipse 60% 25% at 50% 0%,rgba(120,220,255,.35),transparent 70%),linear-gradient(180deg,#06365a 0%,#041d36 45%,#020914 100%)',
      tint: sh => ['radial-gradient(ellipse 60% 25% at 50% 0%,rgba(120,220,255,.26),transparent 70%)', `radial-gradient(ellipse 40% 26% at 50% 60%,${hsl(pull(sh, 200, .4), 70, 45, .18)},transparent 72%)`,
        'linear-gradient(100deg,transparent 30%,rgba(160,230,255,.07) 40%,transparent 50%,transparent 60%,rgba(160,230,255,.045) 66%,transparent 74%)', `${ABYSS_SNOW} 50% 50%/cover no-repeat`,
        'radial-gradient(ellipse 90% 80% at 50% 45%,transparent 55%,rgba(0,4,10,.5))', 'linear-gradient(180deg,#06365a 0%,#041d36 45%,#020914 100%)'].join(',') },
    { id: 'ember', name: 'Ember', halo: sh => pull(sh, 22, .25), css: true, isNew: true, blurb: 'Charcoal, a warm glow low down and slow sparks', chips: ['Moving', 'Warm', 'Light on performance'],
      swatch: 'radial-gradient(circle at 30% 70%,#ffd08a 0 1px,transparent 2px),radial-gradient(circle at 62% 50%,#ffd08a 0 1px,transparent 2px),radial-gradient(circle at 80% 76%,#ffd08a 0 1px,transparent 2px),radial-gradient(ellipse 60% 30% at 50% 100%,rgba(255,110,40,.55),transparent 70%),linear-gradient(180deg,#0e0a09 0%,#2b1309 100%)',
      tint: sh => ['radial-gradient(ellipse 60% 30% at 50% 100%,rgba(255,110,40,.5),transparent 70%)', `radial-gradient(ellipse 40% 24% at 50% 62%,${hsl(pull(sh, 22, .25), 85, 48, .18)},transparent 72%)`,
        `${EMBER_STILL} 0 0/100% 100% no-repeat`, 'radial-gradient(ellipse 90% 80% at 50% 45%,transparent 55%,rgba(0,0,0,.5))', 'linear-gradient(180deg,#0e0a09 0%,#1a0f0b 60%,#2b1309 100%)'].join(',') },
    { id: 'dusk', name: 'Dusk', halo: sh => pull(sh, 25, .5), css: true, isNew: true, blurb: 'A twilight horizon in the game’s colour', chips: ['Calm', 'Follows the game'],
      swatch: 'radial-gradient(ellipse 30% 14% at 50% 78%,rgba(255,190,120,.6),transparent 70%),linear-gradient(180deg,#0b1030 0%,#23215a 45%,#a2406b 72%,#f08a5d 86%,#2a1430 100%)',
      tint: sh => [`radial-gradient(ellipse 30% 12% at 50% 57%,${hsl(pull(sh, 32, .5), 95, 72, .5)},transparent 70%)`, `radial-gradient(ellipse 70% 22% at 50% 58%,${hsl(pull(sh, 345, .5), 70, 52, .3)},transparent 72%)`,
        `${DUSK_STARS} 0 0/100% 42% no-repeat`,
        `linear-gradient(180deg,#0b1030 0%,#1b1a4c 30%,#3a2a6a 42%,${hsl(pull(sh, 335, .45), 48, 42)} 51%,${hsl(pull(sh, 22, .45), 82, 64)} 56.6%,${hsl(pull(sh, 300, .45), 36, 16)} 57.6%,#140b20 72%,#07050d 100%)`].join(',') },
    { id: 'prism', name: 'Prism', halo: sh => sh, fx: prismFx, fps: 30, busy: true, isNew: true, showpiece: true, blurb: 'Liquid glass that ripples when you move', chips: ['Moving', 'Best on High', 'Still on Low'],
      swatch: 'radial-gradient(ellipse 40% 40% at 60% 40%,rgba(255,255,255,.3),transparent 60%),conic-gradient(from 0deg at 40% 50%,#2a1cff,#00d4ff,#00ffa3,#ffe600,#ff3d9a,#8a2bff,#2a1cff)',
      tint: sh => ['radial-gradient(ellipse 36% 30% at 58% 36%,rgba(255,255,255,.1),transparent 62%)', 'radial-gradient(ellipse 34% 26% at 50% 60%,rgba(5,5,12,.55),transparent 75%)',
        ...PRISM_POOLS.map(([x, y, h], k) => `radial-gradient(ellipse ${30 + k % 3 * 4}% ${26 + k % 2 * 6}% at ${Math.round(x * 100)}% ${Math.round(y * 100)}%,${hsl(h + sh * .15, 92, 55, .34)},transparent 70%)`),
        'linear-gradient(180deg,#07061a,#05050c 60%,#030308)'].join(',') },
    { id: 'holo', name: 'Hologram', halo: sh => pull(sh, 195, .25), fx: holoFx, fps: 30, busy: true, isNew: true, showpiece: true, blurb: 'The cases float over a glowing grid to the horizon', chips: ['Moving', 'Best on High', 'Still on Low'],
      swatch: 'linear-gradient(rgba(90,220,255,.35) 1px,transparent 1px) 0 0/100% 18px,radial-gradient(ellipse 80% 40% at 50% 62%,rgba(40,160,255,.45),transparent 70%),linear-gradient(180deg,#02040e 0%,#061a33 55%,#020610 100%)',
      tint: sh => ['radial-gradient(ellipse 30% 13% at 50% 77%,rgba(2,6,16,.6),transparent 75%)', `${HOLO_GRID} 0 100%/100% 43% no-repeat`,
        `radial-gradient(ellipse 55% 7% at 50% 57%,${hsl(pull(sh, 195, .25), 95, 66, .5)},transparent 70%)`, 'radial-gradient(ellipse 80% 40% at 50% 60%,rgba(40,160,255,.3),transparent 70%)',
        'repeating-linear-gradient(0deg,rgba(120,230,255,.025) 0 1px,transparent 1px 4px)', 'linear-gradient(180deg,#02040e 0%,#05132a 45%,#061a33 56.8%,#030a18 57.4%,#020610 100%)'].join(',') },
    // (beta.14) the second six: css only (themes-extra.css), each backdrop a finished still picture
    { id: 'starfield', name: 'Starfield', halo: sh => pull(sh, 225, .3), css: true, isNew: true, blurb: 'Stars drifting past on the way through deep space', chips: ['Moving', 'Calm', 'Light on performance'],
      swatch: 'radial-gradient(ellipse 30% 24% at 50% 42%,rgba(170,200,255,.4),transparent 70%),radial-gradient(1px 1px at 20% 30%,#fff,transparent),radial-gradient(1.5px 1.5px at 72% 22%,#fff,transparent),radial-gradient(1px 1px at 84% 66%,#fff,transparent),radial-gradient(1px 1px at 34% 74%,#cfe0ff,transparent),radial-gradient(1.5px 1.5px at 60% 60%,#fff,transparent),radial-gradient(1px 1px at 10% 80%,#fff,transparent),#010208',
      tint: sh => ['radial-gradient(ellipse 34% 14% at 50% 77%,rgba(0,0,4,.55),transparent 75%)', 'radial-gradient(ellipse 46% 26% at 50% 48%,rgba(1,2,8,.5),transparent 75%)',
        'radial-gradient(ellipse 20% 15% at 50% 38%,rgba(190,210,255,.13),transparent 70%)', `radial-gradient(ellipse 62% 46% at 50% 38%,${hsl(pull(sh, 225, .3), 70, 45, .13)},transparent 72%)`,
        `radial-gradient(ellipse 40% 7% at 50% 58%,${hsl(sh, 70, 55, .12)},transparent 72%)`, `${SF_STREAKS} 50% 50%/cover no-repeat`, `${SF_STARS} 50% 50%/cover no-repeat`,
        'linear-gradient(155deg,transparent 26%,rgba(140,160,230,.05) 40%,rgba(170,150,230,.045) 50%,transparent 64%)', 'radial-gradient(ellipse 80% 70% at 50% 38%,#060a18,#020309 66%,#000)'].join(',') },
    { id: 'rain', name: 'Rainy Night', halo: sh => pull(sh, 210, .35), css: true, isNew: true, blurb: 'Rain on the glass, city lights soft behind it', chips: ['Moving', 'Calm', 'Light on performance'],
      swatch: 'repeating-linear-gradient(100deg,transparent 0 9px,rgba(190,215,255,.22) 9px 10px),radial-gradient(circle at 25% 35%,rgba(255,170,80,.75) 0 7%,transparent 13%),radial-gradient(circle at 72% 26%,rgba(95,156,255,.6) 0 6%,transparent 12%),radial-gradient(circle at 54% 58%,rgba(255,190,100,.5) 0 5%,transparent 10%),radial-gradient(circle at 86% 64%,rgba(255,170,80,.45) 0 4%,transparent 9%),linear-gradient(180deg,#0a1222,#101c30 60%,#070b14)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(2,4,10,.6),transparent 75%)', 'radial-gradient(ellipse 46% 28% at 50% 47%,rgba(4,8,18,.5),transparent 75%)',
        `${RAIN_GLASS} 50% 50%/cover no-repeat`, `radial-gradient(ellipse 44% 8% at 50% 58%,${hsl(pull(sh, 215, .4), 70, 55, .15)},transparent 72%)`,
        'radial-gradient(ellipse 80% 22% at 50% 60%,rgba(255,160,70,.13),transparent 70%)', 'radial-gradient(ellipse 70% 40% at 72% 8%,rgba(60,110,210,.22),transparent 70%)',
        'linear-gradient(180deg,#070b16 0%,#0b1426 45%,#111b2e 58%,#080c16 75%,#04060c 100%)'].join(',') },
    { id: 'sakura', name: 'Cherry Blossom', halo: sh => pull(sh, 340, .45), css: true, isNew: true, blurb: 'Pink petals drifting through a dusky sky', chips: ['Moving', 'Calm', 'Light on performance'],
      swatch: 'radial-gradient(ellipse 4% 2.5% at 22% 30%,#ffc6d6,transparent),radial-gradient(ellipse 4% 2.5% at 64% 48%,#ffb3c8,transparent),radial-gradient(ellipse 3% 2% at 80% 22%,#ffd3df,transparent),radial-gradient(ellipse 3% 2% at 40% 64%,#ffc0d2,transparent),radial-gradient(ellipse 22% 16% at 0% 0%,rgba(255,170,200,.55),transparent 70%),radial-gradient(ellipse 50% 22% at 50% 72%,rgba(255,150,180,.45),transparent 70%),linear-gradient(180deg,#1c1236,#4a2552 50%,#c46a86 72%,#2a1428 74%,#140a18)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(12,4,12,.55),transparent 75%)', `${SAKURA_BRANCH} 50% 50%/cover no-repeat`,
        'radial-gradient(ellipse 46% 28% at 50% 46%,rgba(16,8,26,.45),transparent 75%)', 'radial-gradient(circle at 77% 14%,rgba(255,240,244,.8) 0 1.4%,rgba(255,200,220,.16) 1.8%,transparent 7%)',
        `radial-gradient(ellipse 34% 10% at 50% 57%,${hsl(pull(sh, 345, .4), 85, 72, .4)},transparent 70%)`, `radial-gradient(ellipse 70% 20% at 50% 58%,${hsl(pull(sh, 320, .4), 60, 48, .26)},transparent 72%)`,
        'linear-gradient(180deg,#120c28 0%,#24163e 26%,#47264f 42%,#8a4466 52%,#d98299 56.8%,#3a1a36 57.8%,#1a0c1e 72%,#0a0510 100%)'].join(',') },
    { id: 'snow', name: 'Snowfall', halo: sh => pull(sh, 205, .4), css: true, isNew: true, blurb: 'Gentle snow over a cold blue night', chips: ['Moving', 'Calm', 'Light on performance'],
      swatch: 'radial-gradient(circle at 22% 25%,#fff 0 1.5px,transparent 2px),radial-gradient(circle at 58% 18%,#fff 0 1px,transparent 1.6px),radial-gradient(circle at 76% 48%,#fff 0 1.5px,transparent 2px),radial-gradient(circle at 38% 52%,#fff 0 1px,transparent 1.6px),radial-gradient(circle at 12% 56%,#fff 0 1px,transparent 1.6px),radial-gradient(circle at 84% 18%,rgba(240,246,255,.95) 0 5%,rgba(200,220,255,.2) 6.5%,transparent 15%),linear-gradient(180deg,#081428,#14294a 64%,#2c4a72 65%,#13243e 72%,#070e1a)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(2,6,14,.55),transparent 75%)', 'radial-gradient(ellipse 46% 26% at 50% 47%,rgba(4,10,24,.42),transparent 75%)',
        `${SNOW_STILL} 50% 50%/cover no-repeat`, `${SNOW_HILLS} 0 0/100% 100% no-repeat`, 'radial-gradient(circle at 80% 13%,rgba(240,246,255,.95) 0 1.3%,rgba(200,220,255,.24) 1.7%,transparent 8%)',
        'radial-gradient(ellipse 40% 34% at 80% 10%,rgba(150,185,240,.12),transparent 70%)', `radial-gradient(ellipse 42% 8% at 50% 57%,${hsl(pull(sh, 205, .4), 65, 62, .16)},transparent 72%)`,
        'linear-gradient(180deg,#040a1a 0%,#091631 35%,#11264a 52%,#1a3560 57%,#081222 75%,#040810 100%)'].join(',') },
    // the showpieces: still pictures that hold up on their own (the Thor shows them still), and move on High / Balanced
    { id: 'eventhorizon', name: 'Event Horizon', halo: sh => pull(sh, 30, .2), css: true, isNew: true, showpiece: true, blurb: 'A black hole behind your shelf, its glowing disk slowly turning', chips: ['Moving', 'Showpiece', 'Still on Handheld'],
      swatch: 'radial-gradient(ellipse 46% 5% at 50% 50%,rgba(255,236,200,.95),rgba(255,140,60,.5) 45%,transparent 75%),radial-gradient(circle at 50% 44%,#000 0 16%,rgba(255,240,215,.95) 17.5%,rgba(255,170,80,.55) 21%,transparent 29%),radial-gradient(ellipse 45% 40% at 50% 44%,rgba(255,130,50,.24),transparent 70%),#030204',
      tint: sh => ['radial-gradient(ellipse 30% 12% at 50% 78%,rgba(0,0,0,.5),transparent 75%)', `${EH} 50% 50%/cover no-repeat`,
        `radial-gradient(ellipse 40% 7% at 50% 58%,${hsl(pull(sh, 28, .3), 80, 55, .12)},transparent 72%)`, `${EH_STARS} 50% 50%/cover no-repeat`,
        'radial-gradient(ellipse 75% 65% at 50% 37%,#140b08,#060407 58%,#010102)'].join(',') },
    { id: 'glasslake', name: 'Glass Lake', halo: sh => pull(sh, 160, .4), css: true, isNew: true, showpiece: true, blurb: 'Northern lights over the mountains, mirrored in still water', chips: ['Moving', 'Showpiece', 'Still on Handheld'],
      swatch: 'conic-gradient(from -45deg at 30% 55%,rgba(7,19,29,.9) 0 90deg,transparent 0) 0 100%/100% 40% no-repeat,conic-gradient(from -40deg at 72% 32%,rgba(11,26,40,.9) 0 80deg,transparent 0) 0 100%/100% 40% no-repeat,radial-gradient(ellipse 50% 14% at 42% 84%,rgba(70,255,170,.25),transparent 70%),conic-gradient(from 135deg at 30% 63%,#07131d 0 90deg,transparent 0) 0 0/100% 60% no-repeat,conic-gradient(from 140deg at 72% 72%,#0b1a28 0 80deg,transparent 0) 0 0/100% 60% no-repeat,radial-gradient(ellipse 52% 20% at 42% 20%,rgba(70,255,170,.6),transparent 70%),radial-gradient(ellipse 30% 14% at 74% 12%,rgba(150,110,255,.4),transparent 70%),linear-gradient(180deg,#03091a,#08283c 60%,#0b3240 60%,#020a12)',
      tint: (sh, g, p) => { const q = typeof p === 'number' && isFinite(p) ? Math.max(0, Math.min(1, p)) : .5;
        return ['radial-gradient(ellipse 32% 12% at 50% 77%,rgba(1,5,10,.55),transparent 75%)', `${GL_NEAR} ${r1(50 + (q - .5) * 80)}% 0/112% 100% no-repeat`, `${GL_FAR} ${r1(50 + (q - .5) * 40)}% 0/106% 100% no-repeat`,
          'linear-gradient(180deg,transparent 57.3%,rgba(150,230,255,.1) 57.55%,transparent 58.6%)', `radial-gradient(ellipse 42% 7% at 50% 58%,${hsl(pull(sh, 165, .35), 70, 55, .14)},transparent 72%)`,
          'radial-gradient(ellipse 50% 20% at 36% 19%,rgba(60,255,170,.16),transparent 70%)', 'radial-gradient(ellipse 40% 16% at 70% 13%,rgba(90,190,255,.12),transparent 70%)',
          'radial-gradient(ellipse 50% 12% at 36% 92%,rgba(60,255,170,.07),transparent 70%)', `${GL_STARS} 0 0/100% 50% no-repeat`,
          'linear-gradient(180deg,#02050f 0%,#041128 32%,#06233a 50%,#0c3846 57.5%,#031019 57.6%,#03121d 72%,#01070d 100%)'].join(','); } },
    // (beta.14) five more, css only like the six above (themes-extra.css), each backdrop a finished still picture
    { id: 'neoncity', name: 'Neon City', halo: sh => pull(sh, 320, .35), css: true, isNew: true, showpiece: true, blurb: 'A skyline at night, windows flickering and light trails racing by', chips: ['Moving', 'Showpiece', 'Still on Handheld'],
      swatch: 'linear-gradient(90deg,transparent 12%,rgba(255,70,130,.95) 40%,#ffe0ea 42%,transparent 42%,transparent 60%,rgba(80,220,255,.9) 62%,transparent 80%) 0 79%/100% 2px no-repeat,radial-gradient(circle at 12% 52%,#ffc777 0 1px,transparent 1.6px),radial-gradient(circle at 16% 66%,#76e4ff 0 1px,transparent 1.6px),radial-gradient(circle at 84% 44%,#ffc777 0 1px,transparent 1.6px),radial-gradient(circle at 80% 60%,#ff9ad8 0 1px,transparent 1.6px),' +
        'linear-gradient(#ff5ac8,#ff5ac8) 81% 34%/2px 14% no-repeat,linear-gradient(#08040f,#08040f) 6% 100%/16% 62% no-repeat,linear-gradient(#08040f,#08040f) 30% 100%/10% 34% no-repeat,linear-gradient(#08040f,#08040f) 80% 100%/16% 72% no-repeat,linear-gradient(#08040f,#08040f) 98% 100%/10% 48% no-repeat,linear-gradient(#08040f,#08040f) 56% 100%/12% 26% no-repeat,' +
        'radial-gradient(ellipse 60% 26% at 50% 80%,rgba(255,60,170,.45),transparent 70%),linear-gradient(180deg,#07041c,#240c46 50%,#6a1a6a 80%,#0b0616 80%)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(4,2,12,.6),transparent 75%)', 'radial-gradient(ellipse 46% 28% at 50% 46%,rgba(6,3,18,.45),transparent 75%)',
        `radial-gradient(ellipse 44% 7% at 50% 58%,${hsl(pull(sh, 310, .35), 85, 60, .16)},transparent 72%)`, 'radial-gradient(ellipse 1.3% 15% at 17% 68%,rgba(255,90,200,.16),transparent 70%)',
        'radial-gradient(ellipse 1.1% 12% at 84% 66%,rgba(80,224,255,.14),transparent 70%)', `${NC_SKY} 50% 50%/cover no-repeat`,
        'conic-gradient(from -32deg at 23% 60%,transparent 0deg,rgba(170,140,255,.07) 2deg,transparent 5deg,transparent 360deg)', 'conic-gradient(from 24deg at 80% 60%,transparent 0deg,rgba(120,210,255,.06) 2deg,transparent 5deg,transparent 360deg)',
        'radial-gradient(ellipse 70% 24% at 50% 57%,rgba(255,60,170,.24),transparent 70%)', 'linear-gradient(180deg,#05031a 0%,#0c0630 30%,#240c46 46%,#4a1260 55%,#6a1a6a 57.4%,#0b0616 57.6%,#08040f 75%,#030208 100%)'].join(',') },
    { id: 'deepsea', name: 'Deep Sea', halo: sh => pull(sh, 195, .4), css: true, isNew: true, blurb: 'Glowing jellyfish drifting up through dark water', chips: ['Moving', 'Calm', 'Light on performance'],
      swatch: 'radial-gradient(ellipse 9% 7% at 30% 38%,rgba(255,206,240,.95),rgba(255,122,208,.35) 60%,transparent 75%),linear-gradient(90deg,transparent 28.5%,rgba(255,180,230,.45) 28.5% 29.5%,transparent 29.5% 30.5%,rgba(255,180,230,.45) 30.5% 31.5%,transparent 31.5%) 0 52%/100% 18% no-repeat,' +
        'radial-gradient(ellipse 6% 5% at 72% 62%,rgba(205,246,255,.95),rgba(95,220,255,.3) 60%,transparent 75%),radial-gradient(ellipse 20% 18% at 30% 40%,rgba(255,122,208,.25),transparent 70%),radial-gradient(ellipse 14% 12% at 72% 62%,rgba(95,220,255,.22),transparent 70%),' +
        'linear-gradient(165deg,transparent 30%,rgba(150,230,255,.16) 38%,transparent 46%),linear-gradient(180deg,#0b4a6c,#04223e 50%,#01050c)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(0,4,10,.55),transparent 75%)', 'radial-gradient(ellipse 46% 28% at 50% 46%,rgba(1,8,20,.45),transparent 75%)',
        `radial-gradient(ellipse 42% 8% at 50% 58%,${hsl(pull(sh, 195, .4), 75, 55, .15)},transparent 72%)`, 'radial-gradient(ellipse 2.2% 3% at 13% 30%,rgba(255,140,220,.3),transparent 70%)',
        'radial-gradient(ellipse 1.7% 2.3% at 87% 72%,rgba(110,230,255,.26),transparent 70%)', 'radial-gradient(ellipse 1.3% 1.8% at 29% 80%,rgba(110,230,255,.2),transparent 70%)', `${DS_SNOW} 50% 50%/cover no-repeat`,
        'conic-gradient(from 158deg at 50% -18%,transparent 0deg,rgba(150,230,255,.08) 4deg,transparent 9deg,transparent 15deg,rgba(150,230,255,.06) 18deg,transparent 23deg,rgba(170,240,255,.07) 29deg,transparent 35deg,transparent 360deg)',
        'radial-gradient(ellipse 70% 30% at 50% -4%,rgba(110,210,255,.3),transparent 70%)', 'linear-gradient(180deg,#0b4a6c 0%,#073656 18%,#04223e 40%,#03172c 57%,#020d1a 75%,#01050c 100%)'].join(',') },
    { id: 'storm', name: 'Thunderstorm', halo: sh => pull(sh, 222, .4), css: true, isNew: true, blurb: 'Heavy clouds rolling by, lit now and then by distant lightning', chips: ['Moving', 'Moody', 'Light on performance'],
      swatch: 'radial-gradient(ellipse 34% 26% at 20% 10%,#131824 55%,transparent 72%),radial-gradient(ellipse 34% 26% at 60% 6%,#1a2030 55%,transparent 72%),radial-gradient(ellipse 30% 24% at 92% 16%,#131824 55%,transparent 72%),' +
        'linear-gradient(170deg,transparent 46%,rgba(230,236,255,.75) 48%,transparent 50%) 48% 34%/14% 40% no-repeat,radial-gradient(ellipse 34% 30% at 46% 30%,rgba(190,205,255,.38),transparent 70%),repeating-linear-gradient(104deg,transparent 0 5px,rgba(170,190,230,.08) 5px 6px),linear-gradient(180deg,#0c111d,#2a3346 72%,#0b0e16 73%)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(2,3,6,.55),transparent 75%)', 'radial-gradient(ellipse 46% 26% at 50% 46%,rgba(6,8,14,.42),transparent 75%)',
        `radial-gradient(ellipse 42% 7% at 50% 58%,${hsl(pull(sh, 220, .4), 50, 60, .14)},transparent 72%)`, 'repeating-linear-gradient(104deg,transparent 0 9px,rgba(170,190,230,.035) 9px 10px)',
        `${ST_SKY} 50% 50%/cover no-repeat`, 'radial-gradient(ellipse 60% 18% at 50% 56%,rgba(120,140,190,.16),transparent 72%)',
        'linear-gradient(180deg,#0c111d 0%,#182031 30%,#283247 48%,#39435c 56.5%,#0b0e16 57.6%,#080a10 75%,#040508 100%)'].join(',') },
    { id: 'fireflies', name: 'Fireflies', halo: sh => pull(sh, 75, .35), css: true, isNew: true, blurb: 'Fireflies wandering over a meadow at dusk', chips: ['Moving', 'Calm', 'Light on performance'],
      swatch: 'radial-gradient(circle at 20% 40%,#f6ffb0 0 1.5px,rgba(200,240,90,.35) 2.5px,transparent 6px),radial-gradient(circle at 70% 28%,#f6ffb0 0 1.5px,rgba(200,240,90,.35) 2.5px,transparent 6px),radial-gradient(circle at 84% 60%,#f6ffb0 0 1px,rgba(200,240,90,.3) 2px,transparent 5px),' +
        'radial-gradient(circle at 38% 82%,#f6ffb0 0 1px,rgba(200,240,90,.3) 2px,transparent 5px),radial-gradient(circle at 10% 86%,#f6ffb0 0 1.5px,rgba(200,240,90,.35) 2.5px,transparent 6px),radial-gradient(ellipse 60% 14% at 50% 68%,rgba(255,180,110,.5),transparent 70%),' +
        'linear-gradient(180deg,#0a1030,#2a2c5e 40%,#b07a6c 62%,#f0b27a 68%,#081008 69%,#040704)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(2,5,3,.55),transparent 75%)', 'radial-gradient(ellipse 46% 26% at 50% 46%,rgba(6,8,22,.4),transparent 75%)',
        `radial-gradient(ellipse 42% 7% at 50% 58%,${hsl(pull(sh, 70, .35), 70, 58, .14)},transparent 72%)`, `${FF_LAND} 50% 50%/cover no-repeat`, `${FF_STARS} 0 0/100% 42% no-repeat`,
        'radial-gradient(ellipse 60% 14% at 50% 57%,rgba(255,190,120,.35),transparent 70%)',
        'linear-gradient(180deg,#070c26 0%,#121a46 26%,#2a2c5e 40%,#5c4870 49%,#b07a6c 54.5%,#f0b27a 57%,#0a1209 57.6%,#081008 72%,#040704 100%)'].join(',') },
    { id: 'desertnight', name: 'Desert Night', halo: sh => pull(sh, 230, .35), css: true, isNew: true, showpiece: true, blurb: 'Moonlit dunes under a slowly turning sky, a shooting star now and then', chips: ['Moving', 'Showpiece', 'Still on Handheld'],
      swatch: 'radial-gradient(circle at 76% 22%,#fffaf0 0 6%,rgba(255,238,205,.25) 8%,transparent 20%),radial-gradient(ellipse 80% 30% at 28% 102%,#0c1024 60%,transparent 61%),radial-gradient(ellipse 70% 30% at 88% 94%,#1c2242 60%,transparent 61%),' +
        'radial-gradient(1px 1px at 20% 20%,#fff,transparent),radial-gradient(1px 1px at 42% 36%,#fff,transparent),radial-gradient(1px 1px at 58% 12%,#fff,transparent),radial-gradient(1px 1px at 90% 44%,#fff,transparent),' +
        'linear-gradient(162deg,transparent 40%,rgba(255,255,255,.9) 50%,transparent 52%) 24% 26%/20% 12% no-repeat,linear-gradient(180deg,#02040f,#0f1c44 50%,#3c4478 68%,#141a34 70%)',
      tint: sh => ['radial-gradient(ellipse 32% 13% at 50% 77%,rgba(2,3,10,.55),transparent 75%)', `${DN_DUNES} 0 0/100% 100% no-repeat`,
        'radial-gradient(ellipse 46% 24% at 50% 42%,rgba(3,5,16,.4),transparent 75%)', `radial-gradient(ellipse 44% 8% at 50% 54%,${hsl(pull(sh, 230, .35), 60, 60, .14)},transparent 72%)`,
        DN_MOON, `${DN_STARS} 0 0/100% 58% no-repeat`, 'linear-gradient(152deg,transparent 30%,rgba(170,170,230,.05) 42%,rgba(200,180,230,.06) 50%,transparent 62%)',
        'linear-gradient(180deg,#02040f 0%,#060d26 30%,#0f1c44 46%,#26346a 54%,#3c4478 58%,#0b0f22 70%,#05070f 100%)'].join(',') }
  ];
})();
