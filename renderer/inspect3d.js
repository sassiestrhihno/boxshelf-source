/* Inspect in real 3D: a lit, reflective game case you can turn in your hands, open, and take the disc
   (or cartridge / UMD) out of. Built with three.js; falls back to the CSS version if WebGL isn't there.
   Optional models: themes\<system>\cart.glb (Switch) or disc.glb / umd.glb replace the built-in media. */
window.Inspect3D = (() => {
  const T = () => window.BS3D && window.BS3D.THREE;
  let renderer, scene, camera, canvas, env, rot, caseG, lidPivot, media, mediaG, manualPlane, spineM = null;
  let active = false, raf = 0, failed = false, tex = new Map(), cur = null, customMedia = null, customUrl = null;
  const st = { state: 0, lid: 0, lidT: 0, out: 0, outT: 0, bump: 0, spin: 0, rx: 0, ry: 0, zoom: 1, px: 0, py: 0, in: 0, lid0: 0, out0: 0, flip: 0, base: 0 };
  // The hand-off between the shelf and this canvas. phase: 'idle' | 'wait' (built, art decoding: the shelf box still shows) |
  // 'in' (flying out of the slot) | 'shown' | 'out' (flying back into the slot) | 'fade' (a quick cross-fade out instead).
  // tok tags each open so late promises from an earlier one do nothing; pend = an open waiting for the last case to fade.
  let phase = 'idle', tok = 0, pend = null, ready = false, fadeT0 = 0, fadeFrom = 1, target = null, onDone = null, cvRect = null, coverMat = null, standInTex = null;
// (beta.14: the spine flickered as the case came out) the spine's own stand-in, as the cover has: the shelf box's
// spine picture (already decoded) until the big one is on the GPU, instead of a blank spine that pops in a moment later
let spineMat = null, standInSpine = null;
  const FADE_MS = 140;
  const DEG = Math.PI / 180;

  function available() { return !failed && !!T() && !!ensure(); }
  function ensure() {
    if (renderer) return true;
    if (failed) return false;
    const THREE = T(); if (!THREE) return false;
    try {
      canvas = document.createElement('canvas'); canvas.className = 'isp-gl';
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { failed = true; setTimeout(() => { failed = false; }, 30000); return false; } /* (beta.12: tried again in 30 s, not off until a restart) */
    // Neutral tone mapping keeps the cover's colours as printed (ACES lifted and desaturated them into a milky wash);
    // only real highlights get compressed. Lights are balanced so a white sleeve facing you sits at ~1.0.
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
    scene = new THREE.Scene();
    const pm = new THREE.PMREMGenerator(renderer); env = pm.fromScene(new window.BS3D.RoomEnvironment(), .04).texture; pm.dispose(); scene.environment = env; scene.environmentIntensity = .45;
    camera = new THREE.PerspectiveCamera(30, 1, .2, 12); /* a tight depth range: more depth precision for the case's thin walls */ camera.position.set(0, 0, 3.9); camera.lookAt(0, 0, 0);
    const key = new THREE.DirectionalLight(0xffffff, 1.55); key.position.set(2, 3, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(0xb9c6ff, .55); rim.position.set(-3, 1, -2); scene.add(rim);
    const fill = new THREE.DirectionalLight(0xfff3ea, .6); fill.position.set(-2, -1, 3); scene.add(fill);
    rot = new THREE.Group(); scene.add(rot);
    caseG = new THREE.Group(); rot.add(caseG);
    mediaG = new THREE.Group(); rot.add(mediaG);
    const stage = document.querySelector('#inspect .isp-stage'); if (stage) stage.appendChild(canvas);
    // If the GPU drops our context (it can while a game runs fullscreen), throw everything away and rebuild on the next open.
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); lost = true; });
    return true;
  }
  let lost = false;
  function teardown() {
    try { cancelAnimationFrame(raf); raf = 0; if (renderer) { renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } } catch {}
    try { canvas && canvas.remove(); } catch {}
    tex.forEach(t => { try { t.dispose(); } catch {} }); tex = new Map(); mediaSeq++;
    genTex.forEach(t => { try { t.dispose(); } catch {} }); genTex.clear();
    renderer = scene = camera = canvas = env = rot = caseG = lidPivot = media = mediaG = manualPlane = null; built = null; pauseAt = 0; cur = null; customMedia = null; customUrl = null; lost = false;
    coverMat = null; if (standInTex) { try { standInTex.dispose(); } catch {} standInTex = null; } spineMat = null; if (standInSpine) { try { standInSpine.dispose(); } catch {} standInSpine = null; } phase = 'idle'; pend = null; fadeT0 = 0; target = null; tok++;
    const cb = onDone; onDone = null; if (cb) try { cb(true); } catch {} // a box still hidden for a flight that can't finish now comes back
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    const pr0 = Math.min((devicePixelRatio || 1) * (document.body.classList.contains('fx') ? 1.5 : 1), (document.body.classList.contains('fx') ? 2 : 1.5) * (window.BS_AUTOZOOM || 1), (window.Perf ? Perf.get().inspectPr : 2) * (window.BS_AUTOZOOM || 1));
    // the supersampling has a budget (a 1080p screen's 1.5x): on an ultrawide or 4K screen it would draw 11+ million pixels a
    // frame, up to 240 times a second. Never below the screen's own pixels, so the art stays as sharp as the panel shows it
    renderer.setPixelRatio(Math.max(Math.min(pr0, devicePixelRatio || 1), Math.min(pr0, Math.sqrt(1920 * 1080 * 2.25 / Math.max(1, w * h))))); /* with effects on, a little supersampling: the case's glossy edges and light glints stop shimmering as it turns */ // one object on screen: render at the panel's real pixels so the art stays sharp
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    cvRect = canvas.classList.contains('on') ? canvas.getBoundingClientRect() : null;
  }
  // a point on screen (client px, e.g. a shelf box's rect) in the canvas's own px: the canvas sits inside #app, which
  // Fit to TV scales, so the two differ when the picture is shrunk
  function local(f) { const r = cvRect, kx = r && r.width ? innerWidth / r.width : 1, ky = r && r.height ? innerHeight / r.height : 1;
    return { x: (f.x - (r ? r.left : 0)) * kx, y: (f.y - (r ? r.top : 0)) * ky, h: f.h * ky, ry: f.ry || 0 }; }
  function loadTex(url) {
    if (!url) return null;
    if (tex.has(url)) { const t = tex.get(url); tex.delete(url); tex.set(url, t); return t; } // used again: last in line to be freed
    const THREE = T(), t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.userData.cached = true;
    // decoded off the main thread (img.decode) before three gets it, so its upload never stops to decode a 1536px scan
    // mid-animation; userData.p resolves (true = it has its picture) once that's done, userData.ok says so afterwards
    t.addEventListener('dispose', () => { t.userData.gone = true; });
    t.userData.p = new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
      im.onload = () => Promise.resolve(im.decode && im.decode()).catch(() => {}).then(() => { if (t.userData.gone) return res(false); t.image = im; t.needsUpdate = true; t.userData.ok = true; res(true); });
      im.onerror = () => res(false); im.src = url; });
    tex.set(url, t);
    if (tex.size > 14) { const [k, old] = tex.entries().next().value; tex.delete(k); try { old.dispose(); } catch {} } // keep the last few games' art on the GPU, not everything ever opened
    return t;
  }
  // Spine text drawn into a texture when there's no spine art
  function spineTexture(title, bg, ink) {
    const THREE = T(); const c = document.createElement('canvas'); c.width = 128; c.height = 1024; const x = c.getContext('2d');
    x.fillStyle = bg; x.fillRect(0, 0, 128, 1024);
    x.save(); x.translate(64, 512); x.rotate(-Math.PI / 2); x.fillStyle = ink; x.font = '600 56px Lexend, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let s = title; while (x.measureText(s).width > 900 && s.length > 4) s = s.slice(0, -2); if (s !== title) s += '…'; x.fillText(s, 0, 0); x.restore();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  // ---- (beta.14) real cases, one builder for Inspect and the museum peek ----
  // Each console's case as the real one is made (the case research; sizes in mm, width x height). pack: a moulded keep
  // case, a CD jewel case or a printed card box. man: the booklet [w, h, thickness]; null = none (Switch and PS4 / PS5
  // games ship without one: the Manual button still opens the digital or made booklet); 'def' = a size from the case.
  // tabs: what holds the booklet: 'hinge' (two tabs gripping its top and bottom edges near the hinge), 'lips' (the Sega
  // clamshells' long moulded lips), 'round' (the long case's small round tabs), 'edge' (a jewel lid's tabs on its free
  // edge). d: the disc's diameter; cart / umd: the media [w, h, thickness] (an N64 cartridge lies landscape); lift: how
  // far above the middle the media sits (case heights); well: the holder moulded into the tray; shell: the plastic's
  // colour where it isn't the shelf's (an NA DS case is black, an original Xbox one green); clear: a clear case (PS3,
  // PSP); tray: a jewel case's tray ('clear' or a colour); disc: the underside's look (discBackTexture).
  const DVD = [135, 190], BD = [135, 171.5];
  const keepC = o => Object.assign({ pack: 'keep', mm: DVD, man: [120, 180, 2.5], tabs: 'hinge' }, o);
  const jewelC = o => Object.assign({ pack: 'jewel', mm: [142, 125], man: [120, 120, 1.5], tabs: 'edge', d: 120, disc: 'cd' }, o);
  const boxC = o => Object.assign({ pack: 'box', man: 'def', tabs: null }, o);
  const CASES = {
    gc: keepC({ man: [120, 180, 2], d: 80, disc: 'gc', lift: .1, well: 'gc' }),
    wii: keepC({ d: 120, disc: 'dvd' }),
    wiiu: keepC({ man: [120, 180, .8], d: 120, disc: 'bd' }),
    ps2: keepC({ d: 120, disc: 'dvd', lift: .06, well: 'ps2' }),
    xbox: keepC({ d: 120, disc: 'dvd', shell: '#2a7834' }),
    x360: keepC({ d: 120, disc: 'dvd' }),
    ps3: keepC({ mm: BD, man: [120, 160, 2], d: 120, disc: 'bd', clear: 1 }),
    ps4: keepC({ mm: BD, man: null, d: 120, disc: 'bd' }),
    ps5: keepC({ mm: BD, man: null, d: 120, disc: 'bd' }),
    sw: keepC({ mm: [104, 170], man: null, cart: [21, 31, 3], lift: .1, well: 'sw' }),
    sw2: keepC({ mm: [104, 170], man: null, cart: [21, 31, 3], lift: .1, well: 'sw' }),
    psp: keepC({ mm: [99, 168], man: [88, 150, 2], d: 60, umd: [64, 65, 4.2], clear: 1 }),
    nds: keepC({ mm: [135, 122], man: [112, 104, 2], cart: [33, 35, 3.8], lift: .05, well: 'ds', shell: '#1b1b1f' }),
    n3ds: keepC({ mm: [135, 122], man: [112, 104, 1.5], cart: [33, 35, 3.8], lift: .05, well: 'ds' }),
    saturn: keepC({ mm: [144, 207], man: [125, 185, 2], tabs: 'round', d: 120, disc: 'cd' }),
    segacd: keepC({ mm: [144, 207], man: [125, 185, 2], tabs: 'round', d: 120, disc: 'cd' }),
    megadrive: keepC({ mm: [129, 181], man: [115, 167, 2], tabs: 'lips', cart: [110, 132, 18] }),
    sega32x: keepC({ mm: [129, 181], man: [115, 167, 2], tabs: 'lips', cart: [110, 132, 18] }),
    mastersystem: keepC({ mm: [129, 181], man: [115, 167, 2], tabs: 'lips' }),
    psx: jewelC({ disc: 'psx', tray: '#111114' }),
    dreamcast: jewelC({ disc: 'gd', tray: 'clear' }),
    pcengine: jewelC({ mm: null, d: 0, tray: '#151519' }),
    nes: boxC({ mm: [130, 182], cart: [120, 134, 17] }),
    snes: boxC({ mm: [179, 127], cart: [136, 88, 20] }),
    n64: boxC({ mm: [178, 127], cart: [116, 75, 18.5] }),
    gb: boxC({ mm: [113, 136], cart: [57, 65, 9] }),
    gbc: boxC({ mm: [113, 136], cart: [57, 65, 9] }),
    gba: boxC({ mm: [113, 136], cart: [57.5, 35, 9] })
  };
  // the case for a console. st: its shelf style; an explicit pack there (systems-extra.js) wins, otherwise the bottom
  // screen's rule: sharp corners and thin = a jewel case, sharp corners and thick = a card box, rounded = a keep case
  function caseSpec(sys, st) {
    st = st || {}; const t = CASES[sys], p = st.pack === 'long' ? 'keep' : /^(keep|jewel|box)$/.test(st.pack || '') ? st.pack : null;
    const s = Object.assign({ pack: st.rc != null && st.rc <= .012 ? ((st.depth || .1) < .1 ? 'jewel' : 'box') : 'keep', man: 'def', tabs: 'hinge' }, t || {});
    if (p && p !== s.pack) { s.pack = p; if (!t) s.man = 'def'; }
    s.tabs = s.pack === 'jewel' ? 'edge' : s.pack === 'box' ? null : st.pack === 'long' ? 'round' : s.tabs === 'edge' || !s.tabs ? 'hinge' : s.tabs;
    return s;
  }
  // the booklet in case units [w, h, thickness], or null
  function manualDims(s, w, h) {
    if (!s.man) return null;
    const k = s.mm ? w / s.mm[0] : 0; let mw, mh, mt;
    if (Array.isArray(s.man) && k) { mw = s.man[0] * k; mh = s.man[1] * k; mt = s.man[2] * k; }
    else { const f = s.pack === 'jewel' ? [.845, .96] : s.pack === 'box' ? [.9, .9] : [.889, .947]; mw = w * f[0]; mh = h * f[1]; mt = .011 * h; }
    if (s.pack === 'box') { mw = Math.min(mw, w * .9); mh = Math.min(mh, h * .9); }
    return [Math.min(mw, w * .93), Math.min(mh, h * .965), Math.max(.004 * h, Math.min(.016 * h, mt))];
  }
  // the media at its real size, in case units: a disc's radius R; a cartridge cw x ch x ct; a UMD's shell sw x sh x st
  function mediaDims(s, o, w, h) {
    const k = s.mm ? w / s.mm[0] : 0, kind = o.kind === 'cart' || o.kind === 'umd' ? o.kind : 'disc';
    if (kind === 'cart') {
      if (o.form !== 'floppy' && s.cart && k) return { kind, cw: s.cart[0] * k, ch: s.cart[1] * k, ct: s.cart[2] * k, k };
      const cw = w * (o.size || .5) * .9; return { kind, cw, ch: cw * (o.form === 'floppy' ? 94 / 90 : 1.1), ct: o.form === 'floppy' ? cw * 3.3 / 90 : .035 * h, k: 0 };
    }
    const R = s.d && k ? s.d * k / 2 : w * (o.size || .8) / 2;
    if (kind === 'umd') return { kind, R, sw: s.umd && k ? s.umd[0] * k : R * 2.3, sh: s.umd && k ? s.umd[1] * k : R * 2.5, st: s.umd && k ? s.umd[2] * k : .05 * h, k };
    return { kind, R, k };
  }

  // ---- the plates: the moulded insides, drawn ONCE per case family and kept (a canvas per family: Inspect keeps its texture
  // too, the museum makes one from the same canvas), so opening a case draws nothing ----
  // Android: a CPU canvas (willReadFrequently), uploaded without a GPU read-back
  const ctxOpt = () => window.bsPlatform && bsPlatform.os === 'android' ? { willReadFrequently: true } : undefined;
  let grainC = null;
  function grainTile() {
    if (grainC) return grainC; const N = 128; grainC = document.createElement('canvas'); grainC.width = grainC.height = N;
    const x = grainC.getContext('2d', { willReadFrequently: true }), img = x.createImageData(N, N), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = Math.random() - .5; d[i] = d[i + 1] = d[i + 2] = n < 0 ? 0 : 255; d[i + 3] = Math.round(Math.abs(n) * 32); }
    x.putImageData(img, 0, 0); return grainC;
  }
  const plateC = new Map();
  function plateCanvas(key, W, H, draw) {
    let c = plateC.get(key); if (c) { plateC.delete(key); plateC.set(key, c); return c; }
    c = document.createElement('canvas'); c.width = W; c.height = H; draw(c.getContext('2d', ctxOpt()), W, H);
    plateC.set(key, c); if (plateC.size > 14) plateC.delete(plateC.keys().next().value); return c;
  }
  function canvasTex(c, aniso) { const THREE = T(), t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso || 4; return t; }
  // matte, faintly grainy plastic with a soft falloff toward the edges; black plastic still reads as dark grey under light,
  // so the base is lifted a little and the moulding shows
  function plasticBase(x, W, H, bg, cx, cy) {
    const THREE = T(); { const cc = new THREE.Color(bg), l = cc.r * .3 + cc.g * .59 + cc.b * .11; if (l < .12) cc.lerp(new THREE.Color(0x2c2d33), .75); bg = '#' + cc.getHexString(); }
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const pat = x.createPattern(grainTile(), 'repeat'); if (pat) { x.fillStyle = pat; x.fillRect(0, 0, W, H); }
    const g = x.createRadialGradient(cx, cy, 40, cx, cy, Math.max(W, H) * .62); g.addColorStop(0, 'rgba(255,255,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,.3)'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  }
  function emboss(x, path, depth) { x.save(); x.lineWidth = 3; x.strokeStyle = `rgba(255,255,255,${.16 * depth})`; x.translate(-1.5, -1.5); path(); x.stroke(); x.restore(); x.save(); x.lineWidth = 3; x.strokeStyle = `rgba(0,0,0,${.35 * depth})`; x.translate(1.5, 1.5); path(); x.stroke(); x.restore(); }
  function recycleMark(x, mx, my, s) {
    x.save(); x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 2; x.beginPath(); x.moveTo(mx, my - s); x.lineTo(mx + s, my + s * .8); x.lineTo(mx - s, my + s * .8); x.closePath(); x.stroke();
    x.fillStyle = 'rgba(255,255,255,.14)'; x.font = `700 ${Math.round(s * .9)}px sans-serif`; x.textAlign = 'center'; x.fillText('5', mx, my + s * .55); x.font = `600 ${Math.round(s * .7)}px sans-serif`; x.fillText('PP', mx, my + s * 2); x.restore();
  }
  const r3 = v => Math.round((v || 0) * 1000);
  // The tray side, drawn from real moulded cases: the disc's shallow well with finger notches either side (a GameCube's
  // memory-card holder under its mini disc, a PS2's card pocket), a jewel case's tray (a seat ring, ribs round the hub, finger
  // cut-outs), a game-card holder with a lip (DS / 3DS; a Switch one with the two tabs above it that hold a paper insert),
  // a UMD well with four hooks, or a cartridge cradle with a thumb notch. pw x ph: the plate in case units; lift: how
  // far above the middle the media sits, in the same units. Returns [key, make] for a cache.
  function trayPlate(s, md, bg, pw, ph, lift) {
    const H = 1024, W = Math.max(64, Math.round(H * pw / ph));
    const key = ['tray', s.pack, s.well || '', md.kind, bg, r3(pw), r3(ph), r3(md.R || md.cw), r3(md.ch), r3(md.sw), r3(md.sh), r3(lift), r3(md.k)].join('|');
    return [key, () => plateCanvas(key, W, H, x => {
      const px = v => v / ph * H, cx = W / 2, cy = H / 2 - px(lift), E = (p, d) => emboss(x, p, d), k = md.k || ph / 180;
      plasticBase(x, W, H, bg, cx, cy);
      if (md.kind === 'cart') {
        const cw = px(md.cw), ch = px(md.ch), ty = cy - ch / 2;
        if (s.well === 'sw' || s.well === 'ds') {
          const m = px(1.5 * k), rx = cx - cw / 2 - m, ry = ty - m, rw = cw + 2 * m, rh = ch + 2 * m;
          x.fillStyle = 'rgba(0,0,0,.32)'; x.beginPath(); x.roundRect(rx, ry, rw, rh, 6); x.fill(); E(() => { x.beginPath(); x.roundRect(rx, ry, rw, rh, 6); }, 1.2);
          x.fillStyle = 'rgba(255,255,255,.16)'; x.fillRect(rx + rw * .2, ry - 3, rw * .6, Math.max(4, px(1.2 * k)));
          x.fillStyle = 'rgba(0,0,0,.42)'; x.beginPath(); x.ellipse(cx, ry + rh, rw * .3, px(3 * k), 0, 0, Math.PI); x.fill();
          if (s.well === 'sw') [-1, 1].forEach(sd => { const tx = cx + sd * px(22 * k), tyy = ry - px(14 * k), tw = px(10 * k), th = px(3 * k);
            x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(tx - tw / 2, tyy, tw, th); E(() => { x.beginPath(); x.rect(tx - tw / 2, tyy, tw, th); }, .8); });
        } else {
          const cw2 = cw * 1.06, ch2 = ch + cw * .06, ty2 = cy - ch2 / 2;
          x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.roundRect(cx - cw2 / 2, ty2, cw2, ch2, 14); x.fill(); E(() => { x.beginPath(); x.roundRect(cx - cw2 / 2, ty2, cw2, ch2, 14); }, 1);
          x.fillStyle = 'rgba(0,0,0,.28)'; x.beginPath(); x.ellipse(cx, ty2 + ch2 + 6, cw2 * .22, 26, 0, Math.PI, 0, true); x.fill();
        }
      } else if (md.kind === 'umd') {
        const uy = cy + px(md.R * .1), rw = px(md.sw / 2 * 1.05), rh = px(md.sh / 2 * 1.05);
        x.fillStyle = 'rgba(0,0,0,.2)'; x.beginPath(); x.roundRect(cx - rw, uy - rh, rw * 2, rh * 2, rw * .25); x.fill(); E(() => { x.beginPath(); x.roundRect(cx - rw, uy - rh, rw * 2, rh * 2, rw * .25); }, 1);
        [[-1, -.55], [1, -.55], [-1, .55], [1, .55]].forEach(([sx, sy]) => { const hx = cx + sx * (rw + 6), hy = uy + sy * rh; x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(hx - 9, hy - 16, 18, 32); E(() => { x.beginPath(); x.rect(hx - 9, hy - 16, 18, 32); }, 1); });
      } else {
        const R = md.R, rw = px(R * 1.035);
        if (s.pack === 'jewel') {
          x.strokeStyle = 'rgba(255,255,255,.09)'; x.lineWidth = 3; x.strokeRect(px(.014), px(.014), W - px(.028), H - px(.028));
          for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx + Math.cos(a) * px(R * .27), cy + Math.sin(a) * px(R * .27)); x.lineTo(cx + Math.cos(a) * px(R * .42), cy + Math.sin(a) * px(R * .42)); x.stroke(); }
        }
        x.fillStyle = 'rgba(0,0,0,.16)'; x.beginPath(); x.arc(cx, cy, rw, 0, Math.PI * 2); x.fill();
        E(() => { x.beginPath(); x.arc(cx, cy, rw, 0, Math.PI * 2); }, 1);
        [-1, 1].forEach(sd => { x.fillStyle = 'rgba(0,0,0,.3)'; x.beginPath(); x.ellipse(cx + sd * rw, cy, 34, 58, 0, 0, Math.PI * 2); x.fill(); E(() => { x.beginPath(); x.ellipse(cx + sd * rw, cy, 34, 58, 0, sd > 0 ? -Math.PI / 2 : Math.PI / 2, sd > 0 ? Math.PI / 2 : Math.PI * 1.5); }, .7); });
        x.strokeStyle = 'rgba(255,255,255,.06)'; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, px(R * .92), 0, Math.PI * 2); x.stroke();
        // a memory-card pocket under the disc (GameCube: a card-sized holder with a retaining lip and a push-out notch;
        // PS2: a wider pocket, where it sits varies between case makers)
        if (s.well === 'gc' || s.well === 'ps2') { const ps2 = s.well === 'ps2', mw = ps2 ? px(58 * k) : px(.2), mh = ps2 ? px(40 * k) : px(.235), my = cy + rw + px(ps2 ? .008 : .035);
          x.fillStyle = 'rgba(0,0,0,.4)'; x.beginPath(); x.roundRect(cx - mw / 2, my, mw, mh, 8); x.fill(); E(() => { x.beginPath(); x.roundRect(cx - mw / 2, my, mw, mh, 8); }, 1.4);
          x.fillStyle = 'rgba(255,255,255,.1)'; x.fillRect(cx - mw / 2 + 6, my + 4, mw - 12, px(.012));
          x.fillStyle = 'rgba(0,0,0,.45)'; x.beginPath(); x.ellipse(cx, my + mh, mw * .2, px(.02), 0, 0, Math.PI); x.fill();
          x.fillStyle = 'rgba(255,255,255,.22)'; x.font = `600 ${Math.round(px(.016))}px sans-serif`; x.textAlign = 'center'; x.fillText('MEMORY CARD', cx, my + px(.04)); }
      }
      recycleMark(x, s.well === 'gc' || s.well === 'ps2' ? W - px(.08) : W / 2, H - px(.06), px(.022));
    })];
  }
  // The inside of the front cover: where the booklet lies a shallow recess, the sockets the tabs are moulded from, and
  // the recycling mark (a case without a booklet: a plain recess for a paper insert). Seen from inside, the hinge is on
  // the right. tabs: [{x, y, w, h}] in the plate's own units (x to the right, y up, from its middle).
  function lidPlate(s, man, bg, pw, ph, mx, tabs) {
    const H = 512, W = Math.max(32, Math.round(H * pw / ph));
    const key = ['lid', s.pack, s.tabs || '', bg, r3(pw), r3(ph), man ? r3(man[0]) + 'x' + r3(man[1]) : 'none', r3(mx), (tabs || []).map(t => r3(t.x) + ',' + r3(t.y) + ',' + r3(t.w)).join(';')].join('|');
    return [key, () => plateCanvas(key, W, H, x => {
      const px = v => v / ph * H, X = v => W / 2 + px(v), Y = v => H / 2 - px(v);
      plasticBase(x, W, H, bg, W / 2, H / 2);
      if (man) { const m = px(.012), rx = X(mx - man[0] / 2) - m, ry = Y(man[1] / 2) - m, rw = px(man[0]) + 2 * m, rh = px(man[1]) + 2 * m;
        x.fillStyle = 'rgba(0,0,0,.1)'; x.fillRect(rx, ry, rw, rh); emboss(x, () => { x.beginPath(); x.rect(rx, ry, rw, rh); }, .8); }
      else { const rw = px(pw * .6), rh = px(ph * .42), rx = W / 2 - rw / 2, ry = H * .2; emboss(x, () => { x.beginPath(); x.roundRect(rx, ry, rw, rh, 8); }, .7); }
      (tabs || []).forEach(t => { const tw = px(t.w) + 6, th = px(t.h) + 6; x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(X(t.x) - tw / 2, Y(t.y) - th / 2, tw, th); });
      recycleMark(x, W / 2, H - px(.05), px(.02));
    })];
  }
  // the booklet's page edges: thin pages stacked, a darker cover sheet on either side
  function pageEdgeCanvas() { return plateCanvas('pe', 8, 64, (x, W, H) => { x.fillStyle = '#efebe2'; x.fillRect(0, 0, W, H); for (let y = 4; y < H - 4; y += 3) { x.fillStyle = `rgba(90,80,64,${(.16 + Math.random() * .14).toFixed(2)})`; x.fillRect(0, y, W, 1); } x.fillStyle = 'rgba(40,36,30,.4)'; x.fillRect(0, 0, W, 3); x.fillRect(0, H - 3, W, 3); }); }
  // a jewel case's ribbed hinge: five clear knuckles
  function hingeCanvas() { return plateCanvas('hinge', 4, 128, (x, W, H) => { const n = 5, sg = H / (n * 2 - 1); x.fillStyle = '#3c3e45'; x.fillRect(0, 0, W, H); for (let i = 0; i < n; i++) { x.fillStyle = '#c9ced6'; x.fillRect(0, Math.round(i * 2 * sg) + 1, W, Math.round(sg) - 2); } }); }
  // a card box's tray: printed card with fold lines at its ends and the die-cut slot the cartridge sits in (at the end
  // that comes out first, a thumb cut-out beside it). TW x TH: the tray's face; ax, ay: the slot's middle; sw x sh its size
  function cardTrayPlate(TW, TH, ax, ay, sw, sh, land) {
    const H = 512, W = Math.max(32, Math.round(H * TW / TH)), key = ['ctray', r3(TW), r3(TH), r3(ax), r3(ay), r3(sw), r3(sh), land ? 1 : 0].join('|');
    return [key, () => plateCanvas(key, W, H, x => {
      const px = v => v / TH * H, X = v => W / 2 + px(v), Y = v => H / 2 - px(v);
      x.fillStyle = '#e4ddcc'; x.fillRect(0, 0, W, H);
      const pat = x.createPattern(grainTile(), 'repeat'); if (pat) { x.fillStyle = pat; x.fillRect(0, 0, W, H); }
      x.strokeStyle = 'rgba(120,104,80,.35)'; x.lineWidth = 2;
      if (land) { [.04, .96].forEach(f => { x.beginPath(); x.moveTo(W * f, 0); x.lineTo(W * f, H); x.stroke(); }); } else { [.04, .96].forEach(f => { x.beginPath(); x.moveTo(0, H * f); x.lineTo(W, H * f); x.stroke(); }); }
      const rw = px(sw) + 8, rh = px(sh) + 8, rx = X(ax) - rw / 2, ry = Y(ay) - rh / 2;
      x.fillStyle = 'rgba(40,32,22,.55)'; x.fillRect(rx, ry, rw, rh); x.strokeStyle = 'rgba(60,48,32,.7)'; x.lineWidth = 3; x.strokeRect(rx, ry, rw, rh);
      x.fillStyle = 'rgba(40,32,22,.5)'; x.beginPath(); if (land) x.arc(rx, Y(ay), Math.min(rh, rw) * .18, -Math.PI / 2, Math.PI / 2, true); else x.arc(X(ax), ry + rh, Math.min(rh, rw) * .18, 0, Math.PI); x.fill();
    })];
  }

  // One case, as Inspect and the museum peek both draw it, face-on: x across (the spine and hinge at -w/2), y up, z out of
  // the cover; the back's outer face at z0, the tray D deep above it and the lid (lt thick) on top, hinged at the spine
  // edge (a card box: D is the whole box, lt 0). P: { w, h, D, lt, tb, z0, s (caseSpec), md (mediaDims), man
  // (manualDims), lite (the museum: fewer segments), mat(params) (a material: Inspect's are physical, the museum's
  // standard), front / back / spine (the printed faces' materials, or null), manualMap, caseColor, caseSide, edge, wrap,
  // rc, open (degrees the lid opens), crop(mesh, which, W, H, from, to) (fit the art once loaded), tex(key, make) (a
  // texture for a cached plate), shadow }. Returns the group, the parts that move (pivot, manG, movers), where the media
  // sits (seat: the z its back rests at; x0, y0: its middle), anim(k) (the opening, 0..1: returns the shifts, see frame),
  // slide(k) (Y: the booklet out from under its tabs), info (for the tests), geos / mats (what it made: the museum frees them).
  const NOAN = { cx: 0, cy: 0, mx: 0, my: 0 };
  function buildCase(THREE, P) {
    const { w, h, s, md, man } = P, u = h, g = new THREE.Group(), seg = P.lite ? 8 : 12, geos = [], mats = [];
    const D = P.D, lt = P.lt, tb = P.tb, z0 = P.z0, top = z0 + D, floorZ = z0 + tb, k = s.mm ? w / s.mm[0] : h / 190;
    const bev = Math.min(.0028 * u, (D + lt) * .05), rc = P.rc;
    const M = p => { const m = P.mat(p); mats.push(m); return m; };
    const mesh = (geo, m) => { geos.push(geo); const o = new THREE.Mesh(geo, m); if (P.shadow) o.castShadow = true; return o; };
    const rr = (W, H, R) => { const sh = new THREE.Shape(), x = -W / 2, y = -H / 2; R = Math.max(.0005, Math.min(R, W / 2 - .001, H / 2 - .001));
      sh.moveTo(x + R, y); sh.lineTo(x + W - R, y); sh.quadraticCurveTo(x + W, y, x + W, y + R); sh.lineTo(x + W, y + H - R); sh.quadraticCurveTo(x + W, y + H, x + W - R, y + H);
      sh.lineTo(x + R, y + H); sh.quadraticCurveTo(x, y + H, x, y + H - R); sh.lineTo(x, y + R); sh.quadraticCurveTo(x, y, x + R, y); return sh; };
    const face = (W, H, R, m) => { const fg = new THREE.ShapeGeometry(rr(W, H, R), seg), uv = fg.attributes.uv, pos = fg.attributes.position; for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / W + .5, pos.getY(i) / H + .5); uv.needsUpdate = true; const o = mesh(fg, m); o.castShadow = false; return o; };
    const slab = (W, H, R, Tk, m) => { const sg = new THREE.ExtrudeGeometry(rr(W - 2 * bev, H - 2 * bev, Math.max(.002 * u, R - bev)), { depth: Math.max(.0005, Tk - 2 * bev), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: P.lite ? 2 : 3, curveSegments: seg }); sg.translate(0, 0, -(Tk - 2 * bev) / 2); return mesh(sg, m); };
    const plastic = (color, x) => M(Object.assign({ color, roughness: .42, metalness: .02, clearcoat: .35, clearcoatRoughness: .4 }, x || {}));
    // clear plastic: plain see-through (no transmission pass, on any level), not written to depth so the parts behind show
    const glass = () => M({ color: 0xeef2f7, roughness: .06, metalness: 0, clearcoat: 1, clearcoatRoughness: .05, transparent: true, opacity: .24, depthWrite: false });
    const shellCol = s.shell || P.caseSide, clear = !!s.clear, jewel = s.pack === 'jewel';
    const out = { g, geos, mats, pivot: null, manG: null, manPage: null, manMat: null, pageRange: null, coverMat: null, spine: null, movers: [], seat: floorZ + .004 * u, x0: 0, y0: (s.lift || 0) * h,
      anim: null, slide: null, info: { pack: s.pack, man: !!man, manW: man ? man[0] / w : 0, manH: man ? man[1] / h : 0, manT: man ? man[2] : 0, tabs: 0, clear: clear || jewel } };
    const edge = P.edge || 0, sp = P.spine;
    // the booklet: one thin box (page edges, the back, the page: two draws; a jewel booklet's outside is the front cover: three)
    const booklet = (pageFace, coverMat) => {
      const [mw, mh, mt] = man, bg = new THREE.BoxGeometry(mw, mh, mt), uv = bg.attributes.uv;
      for (let i = 0; i < 8; i++) uv.setXY(i, uv.getY(i), uv.getX(i)); // the end faces' stripes run along the pages too
      const ix = Array.from(bg.index.array), f6 = f => ix.slice(f * 6, f * 6 + 6), coverFace = 9 - pageFace;
      const order = [0, 1, 2, 3].concat(coverMat ? [] : [coverFace]).concat(coverMat ? [coverFace] : []).concat([pageFace]);
      bg.setIndex(order.reduce((a, f) => a.concat(f6(f)), [])); bg.clearGroups();
      const edgeN = coverMat ? 24 : 30; bg.addGroup(0, edgeN, 0); if (coverMat) { bg.addGroup(24, 6, 1); bg.addGroup(30, 6, 2); } else bg.addGroup(30, 6, 1);
      const edgeM = M({ color: 0xffffff, map: P.tex('pe', pageEdgeCanvas), roughness: .85, clearcoat: 0 });
      const pageM = M({ color: P.manualMap ? 0xffffff : 0xe8e4dc, map: P.manualMap || null, roughness: .75, clearcoat: 0 });
      const page = mesh(bg, coverMat ? [edgeM, coverMat, pageM] : [edgeM, pageM]); page.castShadow = false;
      const G = new THREE.Group(); G.add(page); out.manG = G; out.manPage = page; out.manMat = pageM; out.pageRange = [pageFace * 4, pageFace * 4 + 4];
      if (coverMat && P.crop) P.crop(page, 'front', mw, mh, coverFace * 4, coverFace * 4 + 4);
      return G;
    };
    const tabAt = (G, list, m) => { if (!list.length) return; const tg = new THREE.BoxGeometry(list[0].w, list[0].h, list[0].d); geos.push(tg); list.forEach(t => { const o = new THREE.Mesh(tg, m); o.position.set(t.x, t.y, t.z); G.add(o); }); out.info.tabs = list.length; };

    if (s.pack === 'box') {
      // ---- a printed card box: six flat faces (the end that opens is a flap), a card tray inside holding the cartridge
      // in a die-cut slot, the booklet lying in front of it. Opening: the flap swings out, the tray slides out of that
      // end (along the box's long side), the booklet peeks out with it ----
      const T0 = D, land = w > h, L = land ? w : h, C = land ? h : w, c = .003 * u;
      const card = plastic(P.caseColor, { roughness: .8, clearcoat: 0, metalness: 0 }), kraft = M({ color: 0xb9ad95, roughness: .92, clearcoat: 0, side: THREE.BackSide });
      const endF = land ? 0 : 2, openEnd = geo => { const a = Array.from(geo.index.array); a.splice(endF * 6, 6); geo.setIndex(a); geo.clearGroups(); return geo; };
      const body = mesh(openEnd(new THREE.BoxGeometry(w, h, T0)), card); body.position.z = z0 + T0 / 2; g.add(body);
      const ins = mesh(openEnd(new THREE.BoxGeometry(w - 2 * c, h - 2 * c, T0 - 2 * c)), kraft); ins.position.z = z0 + T0 / 2; ins.castShadow = false; g.add(ins);
      const ed = P.front ? edge : 0; if (ed > .0015) { const rim = face(w - .002 * u, h - .002 * u, .003 * u, plastic(P.caseColor, { roughness: .8, clearcoat: 0 })); rim.position.z = z0 + T0 + .0003 * u; g.add(rim); }
      const cw2 = w - .002 * u - 2 * ed, ch2 = h - .002 * u - 2 * ed, cover = face(cw2, ch2, .003 * u, P.front || card); cover.position.z = z0 + T0 + .0006 * u; g.add(cover); if (P.front && P.crop) P.crop(cover, 'front', cw2, ch2);
      out.coverMat = P.front || null;
      const eb = P.back ? edge : 0; if (eb > .0015) { const rimB = face(w - .002 * u, h - .002 * u, .003 * u, plastic(P.caseColor, { roughness: .8, clearcoat: 0 })); rimB.rotation.y = Math.PI; rimB.position.z = z0 - .0003 * u; g.add(rimB); }
      const bw2 = w - .002 * u - 2 * eb, bh2 = h - .002 * u - 2 * eb, back = face(bw2, bh2, .003 * u, P.back || card); back.rotation.y = Math.PI; back.position.z = z0 - .0006 * u; g.add(back); if (P.back && P.crop) P.crop(back, 'back', bw2, bh2);
      const spine = mesh(new THREE.PlaneGeometry(T0 - .002 * u, h - .002 * u), sp || card); spine.castShadow = false; spine.rotation.y = -Math.PI / 2; spine.position.set(-w / 2 - .0008 * u, 0, z0 + T0 / 2); g.add(spine); out.spine = spine;
      const fp = new THREE.Group(); fp.position.set(land ? w / 2 : 0, land ? 0 : h / 2, z0); g.add(fp);
      const flap = mesh(new THREE.PlaneGeometry(land ? T0 : w - .002 * u, land ? h - .002 * u : T0), plastic(P.caseColor, { roughness: .8, clearcoat: 0, side: THREE.DoubleSide }));
      if (land) flap.rotation.y = Math.PI / 2; else flap.rotation.x = -Math.PI / 2; flap.position.z = T0 / 2; fp.add(flap);
      // the tray, as thick as the box leaves room for under the sunk cartridge and the booklet
      const ct = md.kind === 'cart' ? md.ct : .01 * u, cl = md.kind === 'cart' ? (land ? md.cw : md.ch) : 2 * (md.R || .1), cc = md.kind === 'cart' ? (land ? md.ch : md.cw) : 2 * (md.R || .1), mt = man ? man[2] : 0;
      const Lt = L - 2 * c - .004 * u, Ct = C - 2 * c - .004 * u, tt = Math.max(.006 * u, T0 - 2 * c - .6 * ct - mt - .008 * u), mrg = .014 * L, aC = Lt / 2 - mrg - cl / 2;
      const TW = land ? Lt : Ct, TH = land ? Ct : Lt, trayG = new THREE.Group(); g.add(trayG);
      const tray = mesh(new THREE.BoxGeometry(TW, TH, tt), M({ color: 0xffffff, map: P.tex(...cardTrayPlate(TW, TH, land ? aC : 0, land ? 0 : aC, land ? cl : cc, land ? cc : cl, land)), roughness: .9, clearcoat: 0 }));
      tray.position.z = z0 + c + tt / 2; tray.castShadow = false; trayG.add(tray);
      out.seat = z0 + c + tt - .4 * ct; out.x0 = land ? aC : 0; out.y0 = land ? 0 : aC;
      const slideOut = Math.min(Lt * .92, .1 * L + cl + .03 * u), shift = (slideOut + Lt / 2 - L / 2) / 2;
      let mx0 = 0, my0 = 0, mz0 = 0, peekA = .12 * L, yA = .3 * L, ak = 0, sk = 0;
      if (man) { const G = booklet(4, null); mz0 = out.seat + ct + .003 * u + mt / 2; G.position.set(0, 0, mz0); g.add(G); }
      const place = () => { if (!out.manG) return; const a = peekA * ak + yA * sk; out.manG.position.set(land ? mx0 + a : 0, land ? 0 : my0 + a, mz0); };
      const A = { cx: 0, cy: 0, mx: 0, my: 0 }, sstep = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      out.anim = kk => { const kf = sstep(Math.min(1, kk / .45)), kt = sstep((kk - .3) / .7), th = 125 * DEG * kf;
        if (land) fp.rotation.y = th; else fp.rotation.x = -th;
        const a = slideOut * kt; trayG.position.set(land ? a : 0, land ? 0 : a, 0); ak = kt; place();
        A.mx = land ? a : 0; A.my = land ? 0 : a; A.cx = land ? -shift * kt : 0; A.cy = land ? 0 : -shift * kt; return A; };
      out.slide = t => { sk = t; place(); };
      out.movers = [fp, trayG, out.manG].filter(Boolean);
      return out;
    }

    // ---- a keep case or a jewel case: the back plate, the moulded tray, the walls (one rounded ring), the printed spine,
    // the hub; the lid hinged at the spine edge with the cover on it and the booklet held inside ----
    const side = clear || jewel ? glass() : plastic(shellCol), inner = clear || jewel ? side : plastic(shellCol, { roughness: .55 });
    const back = slab(w, h, rc, tb, side); back.position.z = z0 + tb / 2; g.add(back);
    const trayBg = jewel ? (s.tray === 'clear' ? '#d3d7de' : s.tray || '#111114') : clear ? '#c6cad1' : shellCol;
    const pw = w - .02 * u, ph = h - .02 * u;
    { const inFace = face(pw, ph, rc * .8, plastic(0xffffff, { map: P.tex(...trayPlate(s, md, trayBg, pw, ph, out.y0)), roughness: .7, clearcoat: .1 })); inFace.position.z = floorZ + .0004 * u; g.add(inFace); }
    { const eb = P.back && !jewel ? edge : 0; if (eb > .0015) { const rimB = face(w - .004 * u, h - .004 * u, rc, plastic(P.caseColor)); rimB.rotation.y = Math.PI; rimB.position.z = z0 - .0003 * u; g.add(rimB); }
      const bw2 = w - .004 * u - (P.wrap ? eb : 2 * eb), bh2 = h - .004 * u - 2 * eb;
      const outFace = face(bw2, bh2, Math.max(.003 * u, rc - eb * .6), P.back || plastic(P.caseColor)); outFace.rotation.y = Math.PI; outFace.position.set(P.wrap ? -eb / 2 : 0, 0, z0 - .0006 * u); g.add(outFace); if (P.back && P.crop) P.crop(outFace, 'back', bw2, bh2); }
    const wall = Math.min(.011 * u, w * .03), Dw = D - tb;
    { const ringS = rr(w, h, rc), hole = rr(w - 2 * wall, h - 2 * wall, Math.max(.003 * u, rc - wall)); ringS.holes.push(new THREE.Path(hole.getPoints(P.lite ? 40 : 48)));
      const rg = new THREE.ExtrudeGeometry(ringS, { depth: Dw, bevelEnabled: false, curveSegments: P.lite ? 12 : 16 }); const ring = mesh(rg, [inner, side]); ring.position.z = floorZ; g.add(ring); }
    // the printed spine wraps the hinge side (a jewel case: the back inlay's folded end, seen through the clear wall)
    { const spine = mesh(new THREE.PlaneGeometry(D + lt - .004 * u, P.wrap ? h - .004 * u - 2 * edge : h - rc * 1.1), sp || plastic(P.caseColor)); spine.castShadow = false; spine.rotation.y = -Math.PI / 2; spine.position.set(-w / 2 - .0008 * u, 0, z0 + (D + lt) / 2); g.add(spine); out.spine = spine; }
    // the hub: a raised collar, a ring of springy fingers (one mesh) and the push button that releases the disc; a jewel
    // tray's is a twelve-toothed crown; a UMD is held by four hooks; a card or cartridge sits in its moulded holder
    const hz = Math.max(.004 * u, Math.min(.016 * u, Dw * .7));
    const ringOf = (n, r0, tw, tl, depth) => { const shapes = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), pts = [[-tw / 2, -tl / 2], [tw / 2, -tl / 2], [tw / 2, tl / 2], [-tw / 2, tl / 2]].map(([px, py]) => new THREE.Vector2(r0 * ca + px * -sa + py * ca, r0 * sa + px * ca + py * sa)); shapes.push(new THREE.Shape(pts)); }
      return new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false }); };
    if (md.kind === 'disc') {
      const base = jewel ? (s.tray === 'clear' ? 0xd5d9e0 : new THREE.Color(trayBg)) : clear ? 0xd5d9e0 : new THREE.Color(shellCol);
      const hubM = plastic(new THREE.Color(base).lerp(new THREE.Color(0xffffff), .12), { roughness: .5 }), btnM = plastic(new THREE.Color(base).lerp(new THREE.Color(0x000000), .25), { roughness: .35 });
      const hr = md.R * .135, hub = new THREE.Group(); hub.position.set(0, out.y0, floorZ); g.add(hub);
      const collar = mesh(new THREE.CylinderGeometry(hr * 1.45, hr * 1.6, hz * .225, 48), hubM); collar.rotation.x = Math.PI / 2; collar.position.z = hz * .11; hub.add(collar);
      const fingers = mesh(jewel ? ringOf(12, hr * .78, hr * .32, hr * .42, hz * .75) : ringOf(10, hr * .7, hr * .4, hr * .32, hz * .69), hubM); fingers.position.z = hz * .3; hub.add(fingers);
      if (!jewel) { const btn = mesh(new THREE.CylinderGeometry(hr * .45, hr * .5, hz, 32), btnM); btn.rotation.x = Math.PI / 2; btn.position.z = hz * .625; hub.add(btn);
        const cap = mesh(new THREE.SphereGeometry(hr * .45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), btnM); cap.rotation.x = Math.PI / 2; cap.scale.set(1, .35, 1); cap.position.z = hz * 1.125; hub.add(cap); }
    } else if (md.kind === 'umd') {
      const pegM = plastic(clear ? 0xd5d9e0 : new THREE.Color(shellCol).lerp(new THREE.Color(0xffffff), .12), { roughness: .5 }), shapes = [], pw2 = .018 * u, ph2 = .03 * u, uy = out.y0 - md.R * .1;
      [[-1, -.55], [1, -.55], [-1, .55], [1, .55]].forEach(([sx, sy]) => { const cx = sx * (md.sw / 2 + pw2 * .3), cy = uy + sy * md.sh / 2; shapes.push(new THREE.Shape([new THREE.Vector2(cx - pw2 / 2, cy - ph2 / 2), new THREE.Vector2(cx + pw2 / 2, cy - ph2 / 2), new THREE.Vector2(cx + pw2 / 2, cy + ph2 / 2), new THREE.Vector2(cx - pw2 / 2, cy + ph2 / 2)])); });
      const pegs = mesh(new THREE.ExtrudeGeometry(shapes, { depth: Math.min(hz * .9, md.st * 1.2 + .004 * u), bevelEnabled: false }), pegM); pegs.position.z = floorZ; g.add(pegs);
    }
    if (jewel) { const hr2 = Math.min(.011 * u, (D + lt) * .16), hinge = mesh(new THREE.CylinderGeometry(hr2, hr2, h * .97, 14, 1), M({ color: 0xffffff, map: P.tex('hinge', hingeCanvas), roughness: .3, metalness: 0, clearcoat: .6, clearcoatRoughness: .3, transparent: true, opacity: .85 }));
      hinge.castShadow = false; hinge.position.set(-w / 2 + hr2, 0, top); g.add(hinge); }
    // the lid, hinged at the spine edge, closing flush on the walls
    const pivot = new THREE.Group(); pivot.position.set(-w / 2, 0, top + lt / 2); g.add(pivot); out.pivot = pivot; out.movers = [pivot];
    const lid = slab(w, h, rc, lt, jewel ? glass() : side); lid.position.set(w / 2, 0, 0); pivot.add(lid);
    if (!jewel) {
      // the printed cover inside a border of the case's own colour, as wide as on the shelf (style edge), so the case looks
      // the same in your hands as on the shelf
      const ed = P.front ? edge : 0;
      if (ed > .0015) { const rim = face(w - .004 * u, h - .004 * u, rc, plastic(P.caseColor)); rim.position.set(w / 2, 0, lt / 2 + .0003 * u); pivot.add(rim); }
      const cw2 = w - .004 * u - (P.wrap ? ed : 2 * ed), ch2 = h - .004 * u - 2 * ed;
      const cover = face(cw2, ch2, Math.max(.003 * u, rc - ed * .6), P.front || plastic(P.caseColor)); cover.position.set(P.wrap ? w / 2 - ed / 2 : w / 2, 0, lt / 2 + .0006 * u); pivot.add(cover); if (P.front && P.crop) P.crop(cover, 'front', cw2, ch2);
      out.coverMat = P.front || null;
    }
    // the booklet inside the lid and what holds it
    const mxC = man ? (jewel ? Math.min(w - .012 * u - man[0] / 2, .11 * w + man[0] / 2) : w / 2) : w / 2;
    const tabs = [];
    if (man) {
      const [mw, mh, mt] = man, ov = 2.5 * k, pr = 2.5 * k, td = .0006 * u + mt + .0025 * u, tz = -lt / 2 - td / 2;
      if (s.tabs === 'edge') [.3, -.3].forEach(f => tabs.push({ x: mxC + mw / 2 + (pr - ov) / 2, y: f * mh, z: tz, w: ov + pr, h: 9 * k, d: td }));
      else { const tw = s.tabs === 'lips' ? mw * .62 : s.tabs === 'round' ? 6 * k : 9 * k, tx = s.tabs === 'lips' ? mxC : mxC - mw / 2 + 15 * k;
        [1, -1].forEach(sd => tabs.push({ x: tx, y: sd * (mh / 2 + (pr - ov) / 2), z: tz, w: tw, h: ov + pr, d: td })); }
    }
    if (!jewel) {
      const ub = clear ? '#c6cad1' : shellCol, uw = w - .01 * u, uh = h - .01 * u;
      const under = face(uw, uh, rc * .9, plastic(0xffffff, { map: P.tex(...lidPlate(s, man, ub, uw, uh, w / 2 - mxC, tabs.map(t => ({ x: w / 2 - t.x, y: t.y, w: t.w, h: t.h })))), roughness: .5 }));
      under.rotation.y = Math.PI; under.position.set(w / 2, 0, -lt / 2 - .0004 * u); pivot.add(under);
    }
    if (man) {
      const mt = man[2], G = booklet(5, jewel ? P.front : null), mz0 = -lt / 2 - .0006 * u - mt / 2; G.position.set(mxC, 0, mz0); pivot.add(G);
      if (jewel) out.coverMat = P.front || null;
      tabAt(pivot, tabs, jewel ? glass() : plastic(clear ? 0xd5d9e0 : new THREE.Color(shellCol).lerp(new THREE.Color(0xffffff), .1), { roughness: .5 }));
      // Y: slid 18 mm toward the opening edge, out from under the tabs (a jewel booklet lifts over its tabs as it goes)
      const sx = jewel ? 9 * k : 18 * k, sz = jewel ? -mt * 1.2 : 0;
      out.slide = t => { G.position.set(mxC + sx * t, 0, mz0 + sz * t); };
      out.movers.push(G);
    }
    const ang = (P.open || 165) * DEG;
    out.anim = kk => { pivot.rotation.y = -ang * kk; return NOAN; };
    return out;
  }

  // Where the front cover is on a manual's first page, as a texture rectangle {u0,u1,v0,v1,aspect} (v up). Scans come
  // in three shapes: the front cover alone (use it all); the booklet's outside, back + front side by side (use the right
  // half); or a whole print sheet, the cover spread on top and inside pages below (find the dense, colourful block,
  // then its right half). flipped: the picture is stored upside down (an ImageBitmap decoded with flipY).
  function coverRect(img, flipped) {
    const iw = img && (img.naturalWidth || img.width), ih = img && (img.naturalHeight || img.height); if (!iw || !ih) return null;
    const W = 160, H = Math.max(8, Math.round(W * ih / iw)), c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true });
    try { x.drawImage(img, 0, 0, W, H); } catch { return null; } let d; try { d = x.getImageData(0, 0, W, H).data; } catch { return null; }
    const px = (X, Y) => { const k = ((flipped ? H - 1 - Y : Y) * W + X) * 4; return [d[k], d[k + 1], d[k + 2]]; };
    // background: the commonest of the four corners' colours
    const cs = [px(1, 1), px(W - 2, 1), px(1, H - 2), px(W - 2, H - 2)], bg = cs.map(a => [a, cs.filter(b => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 40).length]).sort((a, b) => b[1] - a[1])[0][0];
    const ink = new Uint8Array(W * H); for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) { const p = px(X, Y); ink[Y * W + X] = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 48 ? 1 : 0; }
    const rowInk = Y => { let n = 0; for (let X = 0; X < W; X++) n += ink[Y * W + X]; return n / W; };
    // blocks of rows, split only at clear blank bands (at least 4% of the height)
    const segs = []; let s0 = -1, gap = 0; const minGap = Math.max(2, Math.round(H * .04));
    for (let Y = 0; Y <= H; Y++) { const on = Y < H && rowInk(Y) > .02; if (on) { if (s0 < 0) s0 = Y; gap = 0; } else if (s0 >= 0 && (++gap >= minGap || Y === H)) { segs.push([s0, Y - gap + 1]); s0 = -1; gap = 0; } }
    const blocks = segs.filter(([a, b]) => b - a >= H * .12).map(([a, b]) => { let n = 0; for (let Y = a; Y < b; Y++) for (let X = 0; X < W; X++) n += ink[Y * W + X]; return { a, b, n }; });
    if (!blocks.length) return { u0: 0, u1: 1, v0: 0, v1: 1, aspect: iw / ih };
    const blk = blocks.sort((p, q) => q.n - p.n)[0]; // the most printed-on block: the cover, not a page of text
    // its columns: the widest run of printed columns (thin specks and scanner edges off to the side don't count)
    let x0 = 0, x1 = W; { const on = []; for (let X = 0; X < W; X++) { let n = 0; for (let Y = blk.a; Y < blk.b; Y++) n += ink[Y * W + X]; on.push(n / (blk.b - blk.a) > .02); }
      const runs = []; let r0 = -1, g = 0; const mg = Math.max(2, Math.round(W * .03)); for (let X = 0; X <= W; X++) { if (X < W && on[X]) { if (r0 < 0) r0 = X; g = 0; } else if (r0 >= 0 && (++g >= mg || X === W)) { runs.push([r0, X - g + 1]); r0 = -1; g = 0; } }
      const best = runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0]; if (best && best[1] - best[0] > W * .1) { x0 = best[0]; x1 = best[1]; } }
    let y0 = blk.a, y1 = blk.b; const bw = (x1 - x0) * iw / W, bh = (y1 - y0) * ih / H;
    if (bw / bh > 1.02) x0 = Math.round((x0 + x1) / 2); // back + front side by side: the front is the right half
    // tiny blocks are noise: then show the whole page
    if ((x1 - x0) * (y1 - y0) < W * H * .08) return { u0: 0, u1: 1, v0: 0, v1: 1, aspect: iw / ih };
    // keep the full page when the block is nearly all of it anyway (a full-bleed cover)
    const r = { u0: x0 / W, u1: x1 / W, v0: 1 - y1 / H, v1: 1 - y0 / H }; if (r.u0 < .03 && r.u1 > .97 && r.v0 < .03 && r.v1 > .97) Object.assign(r, { u0: 0, u1: 1, v0: 0, v1: 1 });
    r.aspect = (r.u1 - r.u0) * iw / ((r.v1 - r.v0) * ih); return r;
  }
  // The front cover of a manual's first page as its own picture (an object URL), for the booklet readers: null when
  // the page already is just the cover. Cached per page.
  const crops = new Map();
  function coverCrop(url) {
    if (!url) return Promise.resolve(null); if (crops.has(url)) return crops.get(url);
    const p = new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async'; let late = false; const to = setTimeout(() => { late = true; crops.delete(url); res(null); }, 8000); /* slow: give up now, try again next time */
      im.onload = () => { clearTimeout(to); if (late) return; try { const r = coverRect(im, false); if (!r || (r.u0 === 0 && r.u1 === 1 && r.v0 === 0 && r.v1 === 1)) return res(null);
        const iw = im.naturalWidth, ih = im.naturalHeight, sx = r.u0 * iw, sy = (1 - r.v1) * ih, sw = (r.u1 - r.u0) * iw, sh = (r.v1 - r.v0) * ih, k = Math.min(1, 1800 / sh);
        const c = document.createElement('canvas'); c.width = Math.round(sw * k); c.height = Math.round(sh * k); c.getContext('2d', { willReadFrequently: true }).drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
        c.toBlob(b => { c.width = c.height = 0; res(b ? URL.createObjectURL(b) : null); }, 'image/jpeg', .9); } catch { res(null); } };
      im.onerror = () => { clearTimeout(to); res(null); }; im.src = url; });
    // (the crop is read back as a JPEG: a canvas kept in memory, not on the GPU. The oldest crop's picture is let go a
    // minute after it leaves the cache, so a reader still showing it keeps it)
    crops.set(url, p);
    if (crops.size > 40) { const k0 = crops.keys().next().value, p0 = crops.get(k0); crops.delete(k0); p0.then(u => { if (u) setTimeout(() => URL.revokeObjectURL(u), 60000); }); }
    return p;
  }
  // put that rectangle on a manual plane, sized to fit maxW x maxH without stretching
  function fitCover(mesh, r, maxW, maxH) { if (!r) return; const uv = mesh.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, Math.round(uv.getX(i)) ? r.u1 : r.u0, Math.round(uv.getY(i)) ? r.v1 : r.v0); uv.needsUpdate = true;
    const k = r.aspect > maxW / maxH ? [1, maxW / r.aspect / maxH] : [r.aspect * maxH / maxW, 1]; mesh.scale.set(k[0], k[1], 1); }
  // (beta.14) the same for a booklet that keeps its real size: that rectangle on one face of it (vertices a..b of a box),
  // cropped to the booklet's shape (filled, never stretched). Safe to call again (a late booklet): it starts from the face's own UVs
  function fitPage(mesh, r, W, H, a, b) {
    if (!r || !mesh || !mesh.geometry) return; const uv = mesh.geometry.attributes.uv, ud = mesh.geometry.userData, u0 = ud.uv0 || (ud.uv0 = uv.array.slice());
    let { u0: a0, u1: a1, v0: b0, v1: b1 } = r; const ta = W / H, ra = r.aspect || ta;
    if (ra > ta) { const c = (a0 + a1) / 2, hw = (a1 - a0) * ta / ra / 2; a0 = c - hw; a1 = c + hw; } else { const c = (b0 + b1) / 2, hh = (b1 - b0) * ra / ta / 2; b0 = c - hh; b1 = c + hh; }
    for (let i = a == null ? 0 : a; i < (b == null ? uv.count : b); i++) uv.setXY(i, a0 + u0[i * 2] * (a1 - a0), b0 + u0[i * 2 + 1] * (b1 - b0)); uv.needsUpdate = true;
  }
  // how far above the middle the media sits (case heights = 1): a GameCube disc rides high to leave room for the card holder
  function discLift(kind, sys) { return (CASES[sys] && CASES[sys].lift) || 0; }
  // The disc's underside, by format: a clear outer rim; the data area, a mirror with fine concentric grooves (the
  // rainbow comes from the material's iridescence as you turn it) and a slightly different sheen where the data
  // ends; the mirror band near the middle with a tiny moulded ID code; the clear stacking ring and the hole.
  function discBackTexture(fmt, code) {
    const THREE = T(), S = 1024, c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d'), m = S / 2;
    // Blu-ray cooler and violet, DVD warmer and golden; (beta.14) a PlayStation disc's black underside, a CD's plain silver
    // (Saturn, Sega CD), a Dreamcast GD-ROM's silver with the ring between its two data areas
    const base = fmt === 'bd' ? [196, 200, 232] : fmt === 'gc' ? [214, 210, 226] : fmt === 'psx' ? [46, 42, 56] : fmt === 'cd' || fmt === 'gd' ? [218, 218, 224] : [226, 218, 196];
    const col = (k, a = 1) => `rgba(${base.map(v => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')},${a})`;
    x.fillStyle = col(1); x.fillRect(0, 0, S, S);
    for (let r = m * .36; r < m * .985; r += 1.5) { x.strokeStyle = col(.9 + .12 * Math.sin(r * .9) + (Math.random() - .5) * .05, .35); x.lineWidth = 1; x.beginPath(); x.arc(m, m, r, 0, Math.PI * 2); x.stroke(); }
    const end = m * (.82 + Math.random() * .12); x.fillStyle = col(.86, .55); x.beginPath(); x.arc(m, m, m * .985, 0, Math.PI * 2); x.arc(m, m, end, 0, Math.PI * 2, true); x.fill(); // past the end of the data
    x.strokeStyle = col(.7, .6); x.lineWidth = 2; x.beginPath(); x.arc(m, m, end, 0, Math.PI * 2); x.stroke();
    if (fmt === 'gd') { x.fillStyle = col(1.06, .5); x.beginPath(); x.arc(m, m, m * .52, 0, Math.PI * 2); x.arc(m, m, m * .36, 0, Math.PI * 2, true); x.fill(); x.strokeStyle = col(.55, .9); x.lineWidth = 7; x.beginPath(); x.arc(m, m, m * .535, 0, Math.PI * 2); x.stroke(); }
    // mirror band with the moulded ID code running round it (a black disc's centre is still clear and silvery)
    x.fillStyle = fmt === 'psx' ? 'rgb(196,198,206)' : col(1.12); x.beginPath(); x.arc(m, m, m * .36, 0, Math.PI * 2); x.fill();
    x.save(); x.translate(m, m); x.fillStyle = col(.62, .9); x.font = `600 ${Math.round(S * .012)}px monospace`; const txt = (code + '   ').repeat(3); for (let i = 0; i < txt.length; i++) { x.save(); x.rotate(i / txt.length * Math.PI * 2); x.fillText(txt[i], 0, -m * .3); x.restore(); } x.restore();
    x.strokeStyle = col(.75, .8); x.lineWidth = 3; x.beginPath(); x.arc(m, m, m * .36, 0, Math.PI * 2); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  // The drawn textures (case interior, disc underside) are the same every time for the same inputs: keep the last few
  // instead of redrawing a 1024px canvas and re-uploading it on each open. Marked cached so disposeGroup leaves them.
  // (kit.* hands out fresh, caller-owned ones, as before.)
  const genTex = new Map();
  function genCached(key, make) {
    let t = genTex.get(key);
    if (t) { genTex.delete(key); genTex.set(key, t); return t; }
    t = make(); t.userData.cached = true; genTex.set(key, t);
    if (genTex.size > 12) { const [k, old] = genTex.entries().next().value; genTex.delete(k); try { old.dispose(); } catch {} }
    return t;
  }
  const discBackCached = (fmt, code) => genCached('db|' + fmt + '|' + code, () => discBackTexture(fmt, code));
  // Bounding box of an object in its own local space, whatever its parents are doing
  function localBox(obj) {
    const THREE = T(); obj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), box = new THREE.Box3(), m = new THREE.Matrix4();
    obj.traverse(n => { if (!n.isMesh || !n.geometry) return; for (let q = n; q && q !== obj.parent; q = q.parent) if (q.visible === false) return; if (!n.geometry.boundingBox) n.geometry.computeBoundingBox(); m.multiplyMatrices(inv, n.matrixWorld); box.union(n.geometry.boundingBox.clone().applyMatrix4(m)); });
    return box;
  }
  // (beta.10) frees every texture a material holds (a cart.glb brings normal / roughness maps, and the label's original), not only .map; cached art stays
  function disposeGroup(g) { if (!g) return; g.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) (Array.isArray(n.material) ? n.material : [n.material]).forEach(m => { if (!m) return; for (const k in m) { const v = m[k]; if (v && v.isTexture && !(v.userData && v.userData.cached)) v.dispose(); } const lo = m.userData && m.userData.labelOrig; if (lo && lo.isTexture && !(lo.userData && lo.userData.cached)) lo.dispose(); m.dispose(); }); }); while (g.children.length) g.remove(g.children[0]); }

  // Build the case for a game. o = {ratio, depth, caseColor, caseSide, spineInk, front, back, spine, disc, manual, kind:'disc'|'cart'|'umd', size, title, modelUrl, sys, pack}
  // (beta.14) the case itself comes from buildCase (shared with the museum): a keep case, a jewel case or a card box
  function build(o) {
    const THREE = T();
    if (customMedia && customMedia.parent === mediaG) mediaG.remove(customMedia);
    disposeGroup(caseG); disposeGroup(mediaG); cur = o;
    const h = 1, w = o.ratio, s = caseSpec(o.sys, o), man = manualDims(s, w, h), md = mediaDims(s, o, w, h);
    // printed sleeve under clear plastic: the paper itself is matte (no broad haze over the art), the shine is a
    // tight clearcoat highlight that moves as you turn the case
    const sleeve = map => new THREE.MeshPhysicalMaterial({ map, color: 0xffffff, roughness: .62, metalness: 0, clearcoat: .55, clearcoatRoughness: .22, reflectivity: .3, envMapIntensity: .6 });
    // a card box is as thick as on the shelf (width x depth); the cartridge (sunk into its tray) and the booklet fit inside it
    const T0 = s.pack === 'box' ? Math.max(.05, o.depth * w) : 0;
    if (T0 && md.kind === 'cart') md.ct = Math.min(md.ct, Math.max(.008, (T0 - .006 - (man ? man[2] : 0) - .008 - .006) / .6));
    // Media first, so the tray is exactly deep enough for it (a cartridge needs more room than a disc)
    buildMedia(o, md, s);
    // measure the media in its own space (the whole scene may be turned at this point; a world-space box would be far too deep)
    const mb = localBox(media), sc = media.userData.s0 || 1, mDepth = mb.isEmpty() ? .01 : (mb.max.z - mb.min.z) * sc;
    // tray depth: back plate + media + the booklet lying over it + a little air
    const tb = .012; let D, lt;
    if (T0) { D = T0; lt = 0; }
    else if (s.pack === 'jewel') { const Tj = Math.max(.05, o.depth * w); lt = Math.max(.012, Tj * .2); D = Math.max(.035, Tj - lt, mDepth + tb + .012 + (man ? man[2] : 0)); }
    else { lt = Math.max(.014, o.depth * .18); D = Math.max(.045, o.depth * .55, mDepth + tb + .014 + (man ? man[2] + .004 : 0)); }
    const spineMap = o.spine ? loadTex(o.spine) : spineTexture(o.title, o.caseColor, o.spineInk);
    // a printed face: UVs spread 0..1 over the whole rectangle so the art fills it like the shelf's cover pictures
    // (object-fit: cover): once the scan has loaded, crop it to the face's shape instead of stretching it (vertices a..b only)
    const cropTo = (mesh, t, W, H, a, b) => { if (!t || !t.userData || !t.userData.p) return; t.userData.p.then(ok => { const im = t.image; if (!ok || !im || !mesh.geometry || !mesh.geometry.attributes) return;
      const ia = (im.naturalWidth || im.width) / (im.naturalHeight || im.height), pa = W / H; if (!isFinite(ia) || !ia) return;
      let su = 1, sv = 1; if (ia > pa) su = pa / ia; else sv = ia / pa; const u0 = (1 - su) / 2, v0 = (1 - sv) / 2, uv = mesh.geometry.attributes.uv, pos = mesh.geometry.attributes.position;
      for (let i = a == null ? 0 : a; i < (b == null ? pos.count : b); i++) uv.setXY(i, u0 + (pos.getX(i) / W + .5) * su, v0 + (pos.getY(i) / H + .5) * sv); uv.needsUpdate = true; }); };
    const ft = o.front ? loadTex(o.front) : null, bt = o.back ? loadTex(o.back) : null;
    const frontM = ft ? sleeve(ft.userData.ok || !standInTex ? ft : standInTex) : null;
    const B = buildCase(THREE, { w, h, D, lt, tb, z0: -D / 2, s, md, man, mat: p => new THREE.MeshPhysicalMaterial(p), front: frontM, back: bt ? sleeve(bt) : null, spine: sleeve(spineMap),
      manualMap: o.manual ? loadTex(o.manual) : null, caseColor: o.caseColor, caseSide: o.caseSide, edge: Math.max(0, Math.min(.08, o.edge || 0)) * w, wrap: !!o.wrap,
      rc: Math.max(.012, Math.min(.09, (o.rc || .04) * w)), open: 165, crop: (m, which, W, H, a, b) => cropTo(m, which === 'front' ? ft : bt, W, H, a, b),
      tex: (key, make) => genCached('pl|' + key, () => canvasTex(make())) });
    caseG.add(B.g); built = B; lidPivot = B.pivot; manualPlane = B.manG; coverMat = B.coverMat; spineM = B.spine; spineMat = o.spine ? B.spine.material : null;
    // the booklet's front cover only (see coverRect), once the scan has loaded
    fitManual();
    // seat the media in its holder (a card box: in the tray's die-cut slot)
    const zIn = B.seat - mb.min.z * sc; media.position.set(B.x0, B.y0, zIn); Object.assign(media.userData, { zIn, y0: B.y0, x0: B.x0 });
    const meshes = [], cnt = n => { if (n.isMesh && n.visible !== false) meshes.push(Array.isArray(n.material) ? Math.max(1, n.geometry.groups.length) : 1); };
    caseG.traverse(cnt); const caseN = meshes.length, caseD = meshes.reduce((a, b) => a + b, 0); media.traverse(cnt);
    caseInfo = Object.assign({}, B.info, { discW: md.kind !== 'cart' ? +(2 * md.R / w).toFixed(3) : null, mediaMm: md.kind === 'cart' && md.k ? [+(md.cw / md.k).toFixed(1), +(md.ch / md.k).toFixed(1), +(md.ct / md.k).toFixed(1)] : null,
      meshes: caseN, draws: caseD, mediaMeshes: meshes.length - caseN, D: +D.toFixed(4), lt: +lt.toFixed(4) });
    st.lid = st.lidT = 0; st.out = st.outT = 0; st.spin = 0; st.man = st.manT = 0;
    applyState(true);
  }
  let built = null, caseInfo = null;
  // the booklet's page: the cover cut out of the first scan (coverRect), cropped to the booklet's real shape
  function fitManual() {
    const B = built, page = B && B.manPage, mm = B && B.manMat; if (!page || !mm || !mm.map) return; const mt = mm.map; let n = 0;
    const chk = () => { if (built !== B || mm.map !== mt) return; const img = mt.image; if (!img || !(img.naturalWidth || img.width)) { if (n++ < 100) setTimeout(chk, 100); return; }
      const g = page.geometry.parameters; fitPage(page, coverRect(img, false), g.width, g.height, B.pageRange[0], B.pageRange[1]); };
    chk();
  }
  function buildMedia(o, md, s) {
    const THREE = T(), RB = window.BS3D.RoundedBoxGeometry;
    const labelMap = loadTex(o.disc || o.front);
    // (beta.14) out of its case, a small card is held up bigger (a Switch card at its real 21 x 31 mm would be a speck)
    const hand = md.kind === 'cart' ? Math.min(2.6, Math.max(.3, .62 / Math.max(md.cw, md.ch) - 1)) : .55;
    if (customMedia && customUrl === o.modelUrl) { mediaG.add(customMedia); media = customMedia; media.position.set(0, 0, 0);
      // a model is fitted to .42 across (loadMediaModel): a real-size card or cartridge scales it to its own size
      const s0 = md.kind === 'cart' && md.k ? Math.max(md.cw, md.ch) / .42 : 1; media.scale.setScalar(s0); Object.assign(media.userData, { s0, hand: md.kind === 'cart' ? Math.min(2.6, Math.max(.3, .62 / (.42 * s0) - 1)) : .55 }); media.updateMatrixWorld(true); return; }
    if (o.kind === 'cart' && o.form === 'floppy') {
      // (beta.11) a 3.5" floppy disk (DOS): a 90 x 94 mm dark plastic shell 3.3 mm thick, a sliding metal shutter across the
      // top with its window, the game's label below it and a write-protect tab in the corner
      const fw = md.cw, fh = md.ch, fd = md.ct;
      const shellM = new THREE.MeshPhysicalMaterial({ color: 0x1d1e22, roughness: .6, clearcoat: .15 });
      media = new THREE.Group();
      media.add(new THREE.Mesh(new RB(fw, fh, fd, 2, fw * .02), shellM));
      const metal = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: .9, roughness: .28 });
      const sw = fw * .6, sh = fh * .34, sx = fw * .04;
      [1, -1].forEach(side => { const sh2 = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, .0012), metal); sh2.position.set(sx, fh / 2 - sh / 2, side * (fd / 2 + .0006)); media.add(sh2);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(sw * .28, sh * .62), new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: .9 })); win.position.set(sx + sw * .1, fh / 2 - sh / 2 - sh * .06, side * (fd / 2 + .0013)); if (side < 0) win.rotation.y = Math.PI; media.add(win); });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(fw * .82, fh * .56), new THREE.MeshPhysicalMaterial({ map: labelMap, roughness: .7 }));
      lbl.position.set(0, -fh / 2 + fh * .05 + fh * .28, fd / 2 + .0007); media.add(lbl);
      const tab = new THREE.Mesh(new THREE.BoxGeometry(fw * .07, fw * .07, .0012), new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: .8 })); tab.position.set(-fw / 2 + fw * .09, -fh / 2 + fw * .09, -fd / 2 - .0006); media.add(tab);
    } else if (o.kind === 'cart') {
      // (beta.14) at its real size (a Switch card 21 x 31 mm, a DS card 33 x 35, an N64 cartridge lying landscape 116 x 75)
      const cw = md.cw, ch = md.ch, cd = md.ct;
      const shell = new THREE.MeshPhysicalMaterial({ color: 0x24252b, roughness: .55, clearcoat: .2 });
      const cart = new THREE.Mesh(new RB(cw, ch, cd, 3, Math.min(.008, cd * .3, cw * .08)), [shell, shell, shell, shell, new THREE.MeshPhysicalMaterial({ map: labelMap, roughness: .45, clearcoat: .3 }), shell]);
      media = new THREE.Group(); media.add(cart);
      // (beta.14, #32) the gold contacts sit on the back only (the label side has none), as on a real DS / 3DS / Switch card
      const pins = new THREE.Mesh(new THREE.BoxGeometry(cw * .7, ch * .12, .0012), new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: .8, roughness: .35 })); pins.position.set(0, -ch / 2 + ch * .08, -cd / 2 - .0006); media.add(pins);
    } else {
      const R = md.R;
      const label = new THREE.MeshPhysicalMaterial({ map: labelMap, roughness: .3, clearcoat: .6, clearcoatRoughness: .15 });
      const fmt = s.disc || (o.sys === 'ps3' || o.sys === 'ps4' || o.sys === 'ps5' || o.sys === 'wiiu' ? 'bd' : o.sys === 'gc' ? 'gc' : 'dvd');
      let hcode = 0; for (const ch of (o.title || 'disc')) hcode = (hcode * 31 + ch.charCodeAt(0)) >>> 0;
      const code = `${(o.sys || 'DSC').toUpperCase()}-${(hcode % 9000 + 1000)}-${String.fromCharCode(65 + hcode % 26)}${String.fromCharCode(65 + (hcode >> 5) % 26)}  ${(hcode >> 9) % 90 + 10}`;
      const data = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: discBackCached(fmt, code), metalness: .92, roughness: .1, iridescence: 1, iridescenceIOR: fmt === 'bd' ? 1.8 : 1.6, iridescenceThicknessRange: fmt === 'bd' ? [200, 560] : [120, 480], clearcoat: .6, clearcoatRoughness: .05 });
      media = new THREE.Group();
      // glass: real transmission renders the whole scene once more each frame to see through it; the Handheld level (phones)
      // draws the clear plastic as plain see-through instead, which looks nearly the same on a small screen
      const glass = !window.Perf || Perf.get().glass !== false;
      const TH = .0045, clear = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: glass ? .35 : .45, roughness: .05, transmission: glass ? .6 : 0, thickness: .01, clearcoat: 1 });
      const top = new THREE.Mesh(new THREE.RingGeometry(R * .22, R, 128), label); top.position.z = TH / 2; media.add(top);
      // underside: planar UVs so the round texture lands on the ring as drawn; a clear outer rim beyond the data
      const bg = new THREE.RingGeometry(R * .2, R * .985, 128), bp = bg.attributes.position, bu = bg.attributes.uv; for (let i = 0; i < bp.count; i++) bu.setXY(i, .5 + bp.getX(i) / (2 * R), .5 + bp.getY(i) / (2 * R)); bu.needsUpdate = true;
      const bottom = new THREE.Mesh(bg, data); bottom.rotation.y = Math.PI; bottom.position.z = -TH / 2; media.add(bottom);
      const rim = new THREE.Mesh(new THREE.RingGeometry(R * .985, R, 128), clear); rim.rotation.y = Math.PI; rim.position.z = -TH / 2; media.add(rim);
      const hubT = new THREE.Mesh(new THREE.RingGeometry(R * .14, R * .22, 64), clear); hubT.position.z = TH / 2; media.add(hubT);
      const hubB = new THREE.Mesh(new THREE.RingGeometry(R * .14, R * .2, 64), clear); hubB.rotation.y = Math.PI; hubB.position.z = -TH / 2; media.add(hubB);
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(R, R, TH, 128, 1, true), clear); edge.rotation.x = Math.PI / 2; media.add(edge);
      const hole = new THREE.Mesh(new THREE.CylinderGeometry(R * .14, R * .14, TH, 48, 1, true), clear); hole.rotation.x = Math.PI / 2; hole.material.side = THREE.BackSide; media.add(hole);
      if (o.kind === 'umd') {
        const shell = new THREE.Mesh(new RB(md.sw, md.sh, Math.max(.012, md.st), 3, Math.min(.02, md.st * .45)), new THREE.MeshPhysicalMaterial({ color: 0xdfe6ff, transparent: true, opacity: glass ? .22 : .3, roughness: .1, transmission: glass ? .3 : 0, clearcoat: 1 }));
        shell.position.set(0, -R * .1, 0); media.add(shell);
      }
    }
    media.position.set(0, 0, 0); media.scale.set(1, 1, 1); Object.assign(media.userData, { s0: 1, hand }); mediaG.add(media); media.updateMatrixWorld(true);
  }
  // Optional user model for the media (e.g. themes\sw\cart.glb). Files often hold several copies of the object
  // (a row of cartridges): keep the first copy that has a picture on it, hide the rest, and put the game's own
  // label where that picture was.
  // each call takes a ticket: a slow earlier load that finishes after a newer one is dropped, not swapped in
  let mediaSeq = 0;
  async function loadMediaModel(url, labelUrl, opts) {
    const seq = ++mediaSeq;
    if (!url) { customMedia = null; customUrl = null; return; }
    if (customUrl === url && customMedia) { relabel(labelUrl); return; }
    try {
      const THREE = T(); const gltf = await new window.BS3D.GLTFLoader().loadAsync(url);
      if (seq !== mediaSeq || !renderer) { try { disposeGroup(gltf.scene); } catch {} return; }
      let m = gltf.scene; m.updateMatrixWorld(true);
      // step down single-child wrappers to the level where the copies live
      let lvl = m; while (lvl.children.length === 1 && !lvl.children[0].isMesh) lvl = lvl.children[0];
      const kids = lvl.children.slice();
      if (kids.length > 1) {
        const boxes = kids.map(k => new THREE.Box3().setFromObject(k));
        const groups = []; const used = new Set();
        kids.forEach((k, i) => { if (used.has(i)) return; const g = [i]; used.add(i); let grew = true; const acc = boxes[i].clone();
          while (grew) { grew = false; kids.forEach((k2, j) => { if (used.has(j)) return; const b = boxes[j].clone().expandByScalar(acc.getSize(new THREE.Vector3()).length() * .02); if (b.intersectsBox(acc)) { used.add(j); g.push(j); acc.union(boxes[j]); grew = true; } }); }
          groups.push({ idx: g, box: acc }); });
        const hasPic = g => g.idx.some(i => { let f = false; kids[i].traverse(n => { if (n.isMesh && n.material && (Array.isArray(n.material) ? n.material : [n.material]).some(mt => mt.map)) f = true; }); return f; });
        let pick = groups.find(hasPic) || groups.sort((a, b) => b.idx.length - a.idx.length)[0];
        groups.forEach(g => { if (g !== pick) g.idx.forEach(i => { kids[i].visible = false; }); });
      }
      const vis = new THREE.Box3(); m.traverse(n => { if (n.isMesh) { let v = true; for (let q = n; q; q = q.parent) if (q.visible === false) v = false; if (v) vis.expandByObject(n); } });
      let size = vis.getSize(new THREE.Vector3()), c = vis.getCenter(new THREE.Vector3());
      const g = new THREE.Group(); const k = .42 / Math.max(size.x, size.y, size.z); m.scale.setScalar(k); m.position.set(-c.x * k, -c.y * k, -c.z * k);
      // stand it up facing you: the thin axis becomes depth, the long axis becomes height (cart.json yaw/pitch/roll adjust from there)
      const hold = new THREE.Group(); hold.add(m);
      const thin = size.x <= size.y && size.x <= size.z ? 'x' : size.y <= size.z ? 'y' : 'z';
      if (thin === 'y') hold.rotation.x = -Math.PI / 2; else if (thin === 'x') hold.rotation.y = Math.PI / 2;
      hold.updateMatrixWorld(true);
      const visBox = obj => { const b = new THREE.Box3(); obj.updateMatrixWorld(true); obj.traverse(n => { if (n.isMesh) { let v = true; for (let q = n; q; q = q.parent) if (q.visible === false) v = false; if (v) b.expandByObject(n); } }); return b; };
      const s2 = visBox(hold).getSize(new THREE.Vector3());
      const spin = new THREE.Group(); spin.add(hold); if (s2.x > s2.y) spin.rotation.z = Math.PI / 2;
      // picture side toward the camera: the label sits on the front surface, so its centre is in front of the body's centre
      spin.updateMatrixWorld(true);
      const isVis = n => { for (let q = n; q; q = q.parent) if (q.visible === false) return false; return true; };
      const matsOf = n => Array.isArray(n.material) ? n.material : [n.material];
      const centerOf = pred => { const b = new THREE.Box3(); m.traverse(n => { if (n.isMesh && isVis(n) && pred(n)) b.expandByObject(n); }); return b.isEmpty() ? null : b.getCenter(new THREE.Vector3()); };
      // look at it from the front and from the back: whichever side shows the picture first is the front
      const meshes = []; m.traverse(n => { if (n.isMesh && isVis(n)) meshes.push(n); });
      const bodyC = visBox(spin).getCenter(new THREE.Vector3());
      const hitHasMap = dirZ => { const rc = new THREE.Raycaster(new THREE.Vector3(bodyC.x, bodyC.y, bodyC.z - dirZ * 5), new THREE.Vector3(0, 0, dirZ)); const hits = rc.intersectObjects(meshes, false); return hits.length ? matsOf(hits[0].object).some(mt => mt.map) : null; };
      const frontPic = hitHasMap(-1), backPic = hitHasMap(1);
      if (!frontPic && backPic) spin.rotation.y += Math.PI;
      else if (frontPic === null && backPic === null) { const labelC = centerOf(n => matsOf(n).some(mt => mt.map)); if (labelC && labelC.z < bodyC.z) spin.rotation.y += Math.PI; }
      spin.updateMatrixWorld(true);
      // contacts at the bottom: the most metallic material marks the pin end
      let pinC = centerOf(n => matsOf(n).some(mt => /metal|pin|contact|connector/i.test(mt.name || '')));
      if (!pinC) { let best = 0; m.traverse(n => { if (n.isMesh && isVis(n)) matsOf(n).forEach(mt => { if ((mt.metalness || 0) > best && !mt.map) best = mt.metalness; }); }); if (best > .5) pinC = centerOf(n => matsOf(n).some(mt => mt.metalness === best)); }
      const bodyC2 = visBox(spin).getCenter(new THREE.Vector3());
      if (pinC && pinC.y > bodyC2.y + 1e-4) { spin.rotation.z += Math.PI; }
      const o = opts || {}; const adj = new THREE.Group(); adj.add(spin);
      adj.rotation.set((o.pitch || 0) * DEG, (o.yaw || 0) * DEG, (o.roll || 0) * DEG); if (o.scale) adj.scale.setScalar(o.scale);
      g.add(adj);
      // label materials = the ones with a picture; clone them so each game gets its own
      g.userData.labels = [];
      m.traverse(n => { if (!n.isMesh || !n.material) return; let v = true; for (let q = n; q; q = q.parent) if (q.visible === false) v = false; if (!v) return;
        const arr = Array.isArray(n.material) ? n.material : [n.material];
        arr.forEach((mt, i) => { if (mt.map) { const cl = mt.clone(); cl.userData.labelOrig = mt.map; if (Array.isArray(n.material)) n.material[i] = cl; else n.material = cl; g.userData.labels.push(cl); } }); });
      if (customMedia && customMedia !== g) { const old = customMedia; try { if (old.parent) old.parent.remove(old); if (old.userData.labelTex) old.userData.labelTex.dispose(); disposeGroup(old); } catch {} } // swapping cart.glb ↔ umd.glb: free the old one
      customMedia = g; customUrl = url; relabel(labelUrl);
      if (active && cur && cur.modelUrl === url) { const keep = { ...st }; build(cur); st.state = keep.state; applyState(true); }
    } catch (e) { if (seq !== mediaSeq) return; console.warn('media model', e); customMedia = null; customUrl = null; }
  }
  function relabel(labelUrl) {
    if (customMedia) customMedia.userData.want = labelUrl; // (beta.10) a ticket: a late decode of the last game's label mustn't land on this game's cart
    if (!customMedia || !labelUrl) return;
    const src = loadTex(labelUrl), cm = customMedia; if (!src.userData.ok) { src.userData.p.then(ok => { if (ok && customMedia === cm && cm.userData.want === labelUrl && renderer) relabel(labelUrl); }); return; } // the copy needs the picture itself
    const THREE = T(); const tx = src.clone(); tx.flipY = false; tx.needsUpdate = true; tx.colorSpace = THREE.SRGBColorSpace;
    const prev = customMedia.userData.labelTex; if (prev && prev !== tx) { try { prev.dispose(); } catch {} } customMedia.userData.labelTex = tx;
    customMedia.userData.labels.forEach(mt => { mt.map = tx; mt.needsUpdate = true; });
  }

  function applyState(snap) {
    st.lidT = st.state >= 1 ? 1 : 0; st.outT = st.state >= 2 ? 1 : 0;
    if (snap) { st.lid = st.lidT; st.out = st.outT; }
  }
  const sm = (a, b, k) => a + (b - a) * k;
  let lastT = 0, paused = false, pauseAt = 0;
  function frame(now) {
    if (pauseAt && (phase !== 'shown' || st.man > .97 || now >= pauseAt)) { const p = phase === 'shown'; pauseAt = 0; if (p) paused = true; } // (beta.14) the booklet has slid out from under its tabs: now the loop rests
    if (!cur || paused) { raf = 0; lastT = 0; return; } // (beta.10) paused (a manual is open) or nothing shown: the loop stops; setPaused(false) / open() start it again
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, lastT ? (now - lastT) / 1000 : .016); lastT = now;
    // the quick cross-fade: the canvas keeps its last picture, only its opacity moves (no re-render)
    if (fadeT0) {
      const k = Math.min(1, (now - fadeT0) / FADE_MS); canvas.style.opacity = (fadeFrom * (1 - easeIO(k))).toFixed(3);
      if (k < 1) return;
      fadeT0 = 0; canvas.style.opacity = '0';
      if (pend) { start(pend); return; } // the next game, now that the last one has gone
      finish(); return;
    }
    if (phase === 'idle') return;
    if (phase === 'wait') { if (!ready) return; begin(); } // art decoded (or the wait ran out): take over from the shelf box this frame
    if (standInTex && coverMat && cur.front) { const ft = tex.get(cur.front); if (ft && ft.userData.ok) { coverMat.map = ft; coverMat.needsUpdate = true; try { standInTex.dispose(); } catch {} standInTex = null; } }
    if (standInSpine && spineMat && cur.spine) { const sp = tex.get(cur.spine); if (sp && sp.userData.ok) { spineMat.map = sp; spineMat.needsUpdate = true; try { standInSpine.dispose(); } catch {} standInSpine = null; } } // (beta.14: the big spine in, once it's on the GPU)
    const reduce = document.body.classList.contains('reduce-motion'), leaving = phase === 'out';
    // entrance / exit run on the clock with an ease-in-out curve, so they start and land softly at any frame rate
    if (phase === 'in' || leaving) {
      st.in = Math.max(0, Math.min(1, st.in + (leaving ? -dt : dt) / (reduce ? .18 : leaving ? (cur.from ? .44 : .32) : (cur.from ? .56 : .5))));
      // the box may still be sliding (or the scene moving for Details): fly to where it is now; if it's gone (another
      // game picked, another shelf, a game launching), cross-fade instead of landing somewhere it no longer is
      if (leaving && target) { let f = null; try { f = target(); } catch {} if (!f) { crossfade(now); return; } cur.from = local(f); }
      if (leaving && st.in <= 0) { finish(); return; } // landed: the box shows again in this same frame, the canvas goes
      if (phase === 'in' && st.in >= 1) { phase = 'shown'; canvas.style.transition = ''; canvas.style.opacity = ''; } // hand opacity back to the stylesheet (the reader's dim)
    }
    const kl = 1 - Math.exp(-dt * 4.2), ko = 1 - Math.exp(-dt * 4);
    if (leaving) { const k = easeIO(st.in); st.lid = st.lid0 * k; st.out = st.out0 * k; } // shut on the way back: it lands closed, like the box on the shelf
    else { st.lid = sm(st.lid, st.lidT, kl); st.out = sm(st.out, st.outT, ko); }
    st.bump *= Math.exp(-dt * 9);
    // (beta.14) the case opens its own way (a lid on its hinge; a card box's flap, then its tray sliding out); what that
    // returns shifts the case (cx, cy: a card box moves over so box and tray stay in the middle) and the media riding the tray (mx, my)
    const an = built && built.anim ? built.anim(easeIO(st.lid)) : NOAN;
    if (built && built.slide) { st.man = sm(st.man || 0, leaving ? 0 : st.manT || 0, 1 - Math.exp(-dt * 9)); if (Math.abs(st.man - (leaving ? 0 : st.manT || 0)) < .002) st.man = leaving ? 0 : st.manT || 0; built.slide(easeIO(st.man)); }
    const o = easeIO(st.out), mu = media.userData;
    // disc out: the case slides away off-screen and the disc alone sits in your hands; "put back" brings the case in again
    caseG.position.set(-2.6 * o + an.cx, -.3 * o + an.cy, -.6 * o); caseG.rotation.y = 30 * DEG * o; caseG.visible = o < .995;
    media.position.x = ((mu.x0 || 0) + an.mx + an.cx) * (1 - o); media.position.y = ((mu.y0 || 0) + an.my + an.cy) * (1 - o); media.position.z = mu.zIn * (1 - o) + .25 * o + st.bump;
    const ms = (mu.s0 || 1) * (1 + (mu.hand != null ? mu.hand : cur.kind === 'cart' ? .9 : .55) * o); media.scale.set(ms, ms, ms);
    media.rotation.set(0, 0, 0);
    // A disc (or UMD) out of its case spins about its own centre, like in a player, and only tilts gently; it doesn't swing round
    // the case's middle. So as it comes out, the turn the controls make (st.ry, counted from where it left the case: st.base)
    // moves off the whole scene and onto the disc's own face axis, and up / down becomes a softer tilt of the disc alone.
    // rxE / ryE: what's left for the scene (the case), squared up to face you once the disc is out. dw: the spin, wrapped to half a turn, so taking it in or out only ever
    // unwinds less than half a turn (whole turns are invisible on a round disc and on the off-screen case).
    let rxE = st.rx, ryE = st.ry;
    if (cur.kind !== 'cart' && !st.own) { const idle = now - lastMove > 1500; st.spinV = sm(st.spinV || 0, (st.out > .95 && idle) ? .22 : 0, 1 - Math.exp(-dt * 2)); st.spin += dt * st.spinV; media.rotation.z = st.spin; } // Windows: as before
    else if (cur.kind !== 'cart') {
      const idle = now - lastMove > 1500; st.spinV = sm(st.spinV || 0, (st.out > .95 && idle) ? .22 : 0, 1 - Math.exp(-dt * 2)); st.spin += dt * st.spinV;
      const d = st.ry - st.base, dw = d - 360 * Math.round(d / 360), whole = d - dw, front = 360 * Math.round(st.base / 360);
      ryE = st.base + whole + dw * (1 - o) + (front - st.base) * o; rxE = st.rx * (1 - o); // out: the scene squares up, so the disc faces you
      // (0.3.1) the turn moves the disc in 3D about its own centre: side to side turns it over (both faces), up / down
      // tilts it right round; it still spins in its own plane when left alone, like in a player (Euler XYZ: the spin is
      // applied in the disc's plane first, then the turn, then the tilt)
      media.rotation.set(-st.rx * o * DEG, (st.flip + dw) * o * DEG, st.spin);
    }
    const perPx = (2 * 3.9 * Math.tan(camera.fov * DEG / 2)) / innerHeight;
    const e = easeIO(st.in);
    if (cur.from && !reduce) {
      // "pull it off the shelf": start exactly where the selected box sits on screen (position, size and the angle the
      // shelf turns it to), glide to the middle while turning to the inspect angle; leaving plays the path back into
      // the box's current place. Size: the box's rect is as tall as its nearer edge, so match that edge, not the middle.
      const f = cur.from, fx = (f.x - innerWidth / 2) * perPx, fy = -(f.y - innerHeight / 2) * perPx, H = f.h * perPx, a = Math.abs(Math.sin(f.ry * DEG)) * cur.ratio / 2, fs = 3.9 * H / (3.9 + a * H);
      rot.rotation.set(-rxE * e * DEG, (f.ry * (1 - e) + ryE * e) * DEG, 0);
      const s = fs + (st.zoom - fs) * e; rot.scale.set(s, s, s);
      rot.position.set(fx + (st.px * perPx - fx) * e, fy + (-st.py * perPx - fy) * e, .35 * Math.sin(Math.PI * e) * (leaving ? .4 : 1));
    } else {
      // no box to come from (over the museum), or reduce motion: the case comes forward out of the dark and fades in;
      // leaving, it keeps coming toward you and fades out (reduce motion: a plain fade in place)
      if (phase !== 'shown') canvas.style.opacity = (leaving ? Math.max(0, e * 1.2 - .2) : Math.min(1, e * 1.05)).toFixed(3);
      const m = reduce ? 0 : 1 - e, back = leaving ? -m * 1.1 : -m * 1.6;
      rot.rotation.set(-rxE * DEG, (ryE + m * 22) * DEG, 0);
      const s = st.zoom * (leaving ? 1 + m * .35 : .8 + .2 * (1 - m)); rot.scale.set(s, s, s);
      rot.position.set(st.px * perPx, -st.py * perPx - m * .12, leaving ? -back : back);
    }
    renderer.render(scene, camera);
  }
  const easeIO = t => t <= 0 ? 0 : t >= 1 ? 1 : (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const sameGame = (a, b) => a && b && a.front === b.front && a.back === b.back && a.sys === b.sys && !!a.from === !!b.from;
  // o: as build, plus from {x,y,h,ry} (the shelf box on screen, client px; null = no box), standIn (the box's own,
  // already-loaded cover <img>: shown on the case if the big scan isn't ready in time), onStart() (called in the frame
  // the 3D case takes over: hide the box then)
  function open(o) {
    if (lost || (renderer && renderer.getContext().isContextLost())) teardown();
    if (!ensure()) return false;
    tok++;
    canvas.classList.add('on'); active = true;
    // still flying back into its box: the same game just turns round and comes out again
    if (phase === 'out' && sameGame(cur, o)) { target = null; onDone = null; phase = 'in'; cur.onStart = o.onStart; if (o.onStart) o.onStart(); return true; }
    // another case still on screen: it fades out quickly while this one's art loads; this one starts once it's gone
    if (phase === 'in' || phase === 'shown' || phase === 'out') crossfade(performance.now());
    if (fadeT0) { pend = o; [o.front, o.back, o.spine].forEach(loadTex); } else start(o);
    if (!raf) { lastT = 0; raf = requestAnimationFrame(frame); }
    return true;
  }
  function start(o) {
    pend = null; const my = tok;
    if (standInTex) { try { standInTex.dispose(); } catch {} standInTex = null; }
    if (standInSpine) { try { standInSpine.dispose(); } catch {} standInSpine = null; }
    canvas.style.transition = 'none'; canvas.style.opacity = '0';
    resize(); build(o); st.state = 0; applyState(true); st.in = 0; phase = 'wait'; ready = false; target = null; onDone = null;
    if (o.from) cur.from = local(o.from);
    if (o.modelUrl) loadMediaModel(o.modelUrl, o.disc || o.front, o.modelOpts);
    // wait (at most a quarter second) for the outside art to be decoded and on the GPU and the materials compiled, so
    // the case never flies out blank or half-drawn; the shelf box stays on screen meanwhile
    const ps = [o.front, o.back, o.spine].map(u => { const t = loadTex(u); return t && (t.userData.ok ? null : t.userData.p.then(ok => { if (ok && tok === my && renderer) try { renderer.initTexture(t); } catch {} })); }).filter(Boolean);
    if (renderer.compileAsync && renderer.extensions.has('KHR_parallel_shader_compile')) ps.push(renderer.compileAsync(scene, camera).catch(() => {})); // first open: shaders compile off the main thread
    Promise.race([Promise.all(ps), new Promise(r => setTimeout(r, 250))]).then(() => { if (tok === my) ready = true; });
  }
  function begin() {
    phase = 'in';
    // re-read where the box is now (the shelf may have settled during the wait) and the canvas's own place (its parent
    // only drops the CSS case's scale once the overlay is in 3D mode), so the first frame sits exactly on the box
    cvRect = canvas.getBoundingClientRect(); { let f = null; try { f = cur.where && cur.where(); } catch {} if (f) cur.from = local(f); }
    // the big scan isn't here yet: wear the shelf box's own cover (already decoded) until it is, rather than a blank sleeve
    const ft = cur.front && tex.get(cur.front), si = cur.standIn;
    if (coverMat && ft && !ft.userData.ok && si && si.complete && si.naturalWidth && untainted(si)) {
      const THREE = T(); standInTex = new THREE.Texture(si); standInTex.colorSpace = THREE.SRGBColorSpace; standInTex.needsUpdate = true; coverMat.map = standInTex; coverMat.needsUpdate = true; }
    // (beta.14) the spine likewise: the shelf box's spine picture until the big one is in
    const spt = cur.spine && tex.get(cur.spine), ss = cur.standInSpine;
    if (spineMat && spt && !spt.userData.ok && ss && ss.complete && ss.naturalWidth && untainted(ss)) {
      const THREE = T(); standInSpine = new THREE.Texture(ss); standInSpine.colorSpace = THREE.SRGBColorSpace; standInSpine.needsUpdate = true; spineMat.map = standInSpine; spineMat.needsUpdate = true; }
    if (cur.from && !document.body.classList.contains('reduce-motion')) canvas.style.opacity = '1';
    if (cur.onStart) try { cur.onStart(); } catch (e) { console.warn(e); }
  }
  // a picture from this page's own origin (or data: / blob:) can't taint WebGL: no test draw (which decodes the whole picture
  // on the main thread just to read one pixel back) is needed for those
  function untainted(im) { try { const u = new URL(im.currentSrc || im.src, location.href); if (u.protocol === 'data:' || u.protocol === 'blob:' || (u.origin !== 'null' && u.origin === location.origin)) return true; } catch {}
    try { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 1, 1); x.getImageData(0, 0, 1, 1); return true; } catch { return false; } }
  function crossfade(now) {
    const v = parseFloat(canvas.style.opacity); fadeFrom = isNaN(v) ? 1 : v; fadeT0 = now || performance.now(); phase = 'fade'; canvas.style.transition = 'none';
    target = null; const cb = onDone; onDone = null; if (cb) try { cb(true); } catch (e) { console.warn(e); } // the box fades back in as the case fades out
  }
  function finish() { phase = 'idle'; target = null; const cb = onDone; onDone = null; if (canvas) canvas.style.opacity = '0'; close(); if (cb) try { cb(false); } catch (e) { console.warn(e); } }
  // tgt(): where the box is now ({x,y,h,ry} client px) or null when it's no longer the place to land; done(fade): show
  // the box again (fade = cross-fading, not landing)
  function leave(tgt, done) {
    if (!active) { if (done) done(false); return; }
    tok++; // a pending start or late art from this open does nothing now
    if (pend || phase === 'wait' || phase === 'idle') { pend = null; if (!fadeT0) finish(); if (done) done(true); return; } // never got as far as the screen
    if (phase === 'fade') { if (done) done(true); return; }
    cvRect = canvas.getBoundingClientRect();
    st.lid0 = st.lid; st.out0 = st.out; canvas.style.transition = 'none';
    // the flight home goes the short way: st.ry is the shelf's running angle (every turn you gave it), and the path
    // eases from it to the box's angle, so two full turns used to be spun back on the way into the slot
    { const fr = cur && cur.from ? cur.from.ry || 0 : 0; st.ry = fr + (((st.ry - fr) % 360) + 540) % 360 - 180; }
    if (document.body.classList.contains('reduce-motion') && cur.from) { onDone = done; crossfade(performance.now()); return; }
    if (phase === 'shown') canvas.style.opacity = cur.from ? '1' : '1';
    phase = 'out'; target = cur.from ? tgt : null; onDone = done;
  }
  // closed: only the shown game's art stays on the GPU (reopening it is instant); every other cached texture is freed
  function close() { active = false; cancelAnimationFrame(raf); raf = 0; phase = 'idle'; pend = null; fadeT0 = 0; pauseAt = 0; if (canvas) canvas.classList.remove('on');
    const keep = new Set(cur ? [cur.front, cur.back, cur.spine, cur.disc, cur.manual, cur.disc || cur.front] : []);
    tex.forEach((t, k) => { if (keep.has(k)) return; tex.delete(k); try { t.dispose(); } catch {} }); }
  let lastMove = 0;
  // flip: the disc turned over (degrees, eased by the caller); base: the turn (ry) it had when it came out of the case
  function setPose(rx, ry, zoom, px, py, busy, flip, base) { if (busy) lastMove = performance.now(); st.rx = rx; st.ry = ry; st.zoom = zoom; st.px = px; st.py = py; st.flip = flip || 0; st.own = base != null; st.base = base || 0; } // (base null: Windows, the disc turns with the case as before)
  function setState(n) { st.state = n; applyState(false); }
  function bump() { st.bump = .12; }
  // (beta.12, touch) what's under a finger on the screen: 'manual' (the booklet in the lid), 'disc' (the disc or
  // cartridge), or null (the case itself, or nothing). Whatever is nearest along the line of sight wins, so a case wall in
  // front of the manual keeps it. Once per tap, never per frame
  function hitAt(x, y) {
    if (!active || !renderer || !camera || !canvas || !scene) return null;
    const THREE = T(), r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return null;
    const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    scene.updateMatrixWorld(true);
    const hits = rc.intersectObjects([caseG, mediaG].filter(Boolean), true).filter(h => h.object.visible !== false);
    for (let o = hits.length ? hits[0].object : null; o; o = o.parent) { if (o === manualPlane) return 'manual'; if (media && o === media) return 'disc'; }
    return null;
  }
  function setPaused(p) {
    p = !!p;
    // (beta.14) Y on an open case: the booklet first slides out from under its tabs (about a third of a second), then the loop rests
    if (p && !paused && active && raf && built && built.slide && st.lidT === 1 && st.outT === 0 && phase === 'shown') { st.manT = 1; if (!pauseAt) pauseAt = performance.now() + 3000; return; }
    pauseAt = 0; paused = p; if (!p) st.manT = 0;
    if (!paused && active && !raf && renderer) { lastT = 0; raf = requestAnimationFrame(frame); } }
  addEventListener('resize', () => { if (renderer && active) resize(); });
  // the lid's manual, when it arrives late (Boxshelf's own booklet is drawn after the case opens)
  function setManual(url) { const m = built && built.manMat; if (!manualPlane || !m || !url || (cur && cur.manual)) return; const t = loadTex(url); m.map = t; m.color.set(0xffffff); m.needsUpdate = true; if (cur) cur.manual = url; fitManual(); }
  return { setManual, kit: { discBackTexture, discLift, coverRect, fitCover, fitPage, coverCrop, caseSpec, manualDims, mediaDims, buildCase }, available, open, close, leave, setPose, setState, bump, hitAt, setPaused, isActive: () => active,
    busy: () => !paused && (phase === 'out' || phase === 'fade' || phase === 'wait' || phase === 'in'), _st: () => ({ phase, in: st.in, ry: st.ry, rotY: rot ? Math.round(rot.rotation.y / DEG) : null, ready, fade: !!fadeT0, pend: !!pend, op: canvas && canvas.style.opacity, on: !!(canvas && canvas.classList.contains('on')), from: cur && cur.from, standIn: !!standInTex, tok, disc: discPose(), manual: manualXY(), spine: !!(spineM && spineM.parent && spineM.parent.parent), lid: st.lid, lidT: st.lidT, manSlide: st.man || 0, paused, cs: caseInfo }) }; // (beta.11 spine: the printed spine is on the case; beta.14 cs: the case built: its type, booklet, media size, meshes)
  // (test hook) where on the screen the middle of the lid's manual is, in page pixels (null when it isn't drawn)
  function manualXY() { if (!manualPlane || !camera || !canvas) return null; const THREE = T(); scene.updateMatrixWorld(true); const p = manualPlane.getWorldPosition(new THREE.Vector3()).project(camera), r = canvas.getBoundingClientRect();
    return { x: Math.round(r.left + (p.x + 1) / 2 * r.width), y: Math.round(r.top + (1 - p.y) / 2 * r.height) }; }
  // (test hook) where the disc / cartridge is in the scene, and which way its face points
  function discPose() { if (!media) return null; const THREE = T(); media.updateWorldMatrix(true, false); const p = media.getWorldPosition(new THREE.Vector3()), n = new THREE.Vector3(0, 0, 1).transformDirection(media.matrixWorld); return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), nz: +n.z.toFixed(3) }; }
})();
