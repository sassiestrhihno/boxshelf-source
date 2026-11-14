/* Boxshelf UI sound, second pass. Still fully synthesised (nothing to download, always in tune with itself),
   but built like a small instrument rather than a beeper:
   - every voice is a struck/plucked tone: a fast pitch drop at the onset (the "thump" that makes a tick feel
     physical), inharmonic partials for the glass/bell voices, a touch of noise for the transient
   - a stereo plate-style reverb (early reflections + diffuse tail, high-cut) that all cues share, so the menu
     sits in one room; a gentle limiter keeps peaks even
   - all pitches sit on one pentatonic scale per voice, so any two cues played together agree
   - navigation ticks climb in pitch and shorten as you scroll faster, then relax
   Voices: Aero (default, soft and airy), Melody (a felt piano playing songs one note per move), Music box (warm steel tines).
   Menu music (1.77): Drift, Night and Glow, subtle ambient home-screen music under the shelf (ambientStart / ambientStop). */
window.Sound = (() => {
  let ctx = null, master, lim, verbIn, verbOut, dryBus, theme = 'aero', volume = .7, enabled = true, lastTick = 0, tickRun = 0, tickVar = 0, lastShelf = 0, shelfRun = 0;
  const THEMES = {
    // Aero (default): the PlayStation-menu idea — almost-pure high tones with a breath of air under them, soft
    // attacks instead of clicks, very little melody, and a long quiet room so each cue tails off into silence.
    aero:  { partials: [[1, 1, 1], [2, .12, .5], [3.01, .04, .35]], decay: .32, bright: 9000, noise: .06, thump: 1.0, verb: .7, scale: [0, 2, 4, 7, 9], root: 1174.66 /* D6 */, wave: 'sine', attack: .012, breath: .5 },
    // Melody: a soft felt piano (slightly stretched partials like real strings, mellow hammer, no pitch thump).
    // Moving along the shelf plays the next note of a song; the other cues are built from the chord under it.
    melody: { partials: [[1, 1, 1], [2.002, .42, .62], [3.006, .15, .42], [4.012, .07, .3], [5.02, .035, .22], [6.03, .015, .18]], decay: .9, bright: 3400, noise: .035, thump: 1.0, verb: .5, scale: [0, 2, 4, 7, 9], root: 523.25 /* C5 */, wave: 'sine', attack: .003, breath: 0 },
    // Music box: small steel tines plucked by a comb. A pure fundamental, a quiet octave and a faint inharmonic
    // shimmer (what makes it sound like metal, not a sine), a soft pluck and a warm room. Nothing buzzy.
    musicbox: { partials: [[1, 1, 1], [2, .16, .5], [3, .04, .3], [5.4, .05, .16], [8.93, .015, .1]], decay: .75, bright: 5200, noise: .04, thump: 1.0, verb: .55, scale: [0, 2, 4, 7, 9], root: 783.99 /* G5 */, wave: 'sine', attack: .002, breath: 0 },
    // (beta.14) three more, made here in a style (nothing taken from any console):
    // Disc-era: glassy FM bells over a soft pad and a big shiny room, the late-90s disc console feel
    disc: { partials: [[1, 1, 1], [2.76, .16, .45], [5.4, .05, .25]], decay: .5, bright: 7200, noise: .02, thump: 1.0, verb: .8, scale: [0, 2, 4, 7, 9], root: 880 /* A5 */, wave: 'sine', attack: .005, breath: .2 },
    // Handheld: small and chirpy, a pulse wave with quick blips and almost no room
    handheld: { partials: [[1, 1, 1]], decay: .07, bright: 4200, noise: 0, thump: 1.0, verb: .06, scale: [0, 2, 4, 7, 9], root: 1318.51 /* E6 */, wave: 'square', attack: .002, breath: 0 },
    // Living room: warm and round, a soft triangle with a little body under it
    living: { partials: [[1, 1, 1], [2, .22, .6], [3, .06, .4]], decay: .32, bright: 2600, noise: .015, thump: 1.04, verb: .45, scale: [0, 2, 4, 7, 9], root: 587.33 /* D5 */, wave: 'triangle', attack: .008, breath: .15 },
    // Instrument: the instrument plays the notes (instrument.js); this is only for the shared cues' pitches
    instrument: { partials: [[1, 1, 1], [2, .3, .6], [3, .1, .4]], decay: .8, bright: 3400, noise: .03, thump: 1.0, verb: .5, scale: [0, 2, 4, 7, 9], root: 523.25 /* C5 */, wave: 'sine', attack: .003, breath: 0 },
  };
  // (a pack's moments are its own recordings; anything it has no file for plays Aero's)
  const T = () => THEMES[theme] || THEMES.aero;
  // older voices from before 1.28 map onto the three current ones (beta.14: Melody and Music box are the Instrument now)
  const ALIAS = { glass: 'aero', wood: 'aero', pulse: 'musicbox', arcade: 'musicbox', xylo: 'melody', jazz: 'melody' };
  // n-th step of the pentatonic scale (negative ok), as a frequency
  // Each shelf plays in its own key (a few semitones up or down from the voice's root) and some in a different
  // pentatonic colour, so GameCube, Switch, Xbox… each have their own tone without changing the cue shapes.
  let keyShift = 0, keyScale = null;
  function deg(n, octave = 0) { const t = T(), s = keyScale || t.scale, o = Math.floor(n / s.length), i = ((n % s.length) + s.length) % s.length; return t.root * Math.pow(2, (keyShift + s[i] + 12 * (o + octave)) / 12); }

  function ensure() {
    if (baking) return ctx; // Android: building the pre-rendered ticks offline (see "ticks from pre-rendered buffers")
    if (ctx) { if (fadeT) { clearTimeout(fadeT); fadeT = 0; master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(volume, ctx.currentTime); } else if (ctx.state === 'suspended') master.gain.setValueAtTime(volume, ctx.currentTime); if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    try { ctx = new AudioContext({ latencyHint: 'interactive' }); } catch { return null; }
    master = ctx.createGain(); master.gain.value = volume;
    lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = .002; lim.release.value = .09;
    dryBus = ctx.createGain();
    verbIn = ctx.createGain(); verbOut = ctx.createGain(); verbOut.gain.value = .9;
    buildReverb();
    // gentle saturation gives the pure tones a little body without sounding distorted
    sat = ctx.createWaveShaper(); sat.curve = satCurve(1.15); sat.oversample = '2x';
    dryBus.connect(sat); verbOut.connect(sat); sat.connect(lim); lim.connect(master); master.connect(ctx.destination);
    ambBus = ctx.createGain(); ambBus.gain.value = 0; ambBus.connect(lim);
    const av = ctx.createGain(); av.gain.value = AMB_VERB; ambBus.connect(av); av.connect(verbIn); // (the menu music sits in the same room as the cues)
    applySink();
    return ctx;
  }
  // Settings → Sound → Output device: '' = the system default; a device that has gone falls back to the default
  let sinkId = '';
  function applySink() {
    if (!ctx || typeof ctx.setSinkId !== 'function') return;
    const cur = typeof ctx.sinkId === 'string' ? ctx.sinkId : ''; if (cur === sinkId) return;
    try { ctx.setSinkId(sinkId).catch(() => { if (sinkId) ctx.setSinkId('').catch(() => {}); }); } catch {}
  }
  function setSink(id) { sinkId = typeof id === 'string' && id !== 'default' ? id : ''; applySink(); }
  let sat, ambBus, amb = null, duckT = 0;
  // overall cue level: every voice goes through this so the whole set can be nudged together (0.5 was too loud)
  const TRIM = .27;
  function satCurve(k) { const n = 2048, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(x * k) / Math.tanh(k); } return c; }
  // Duck the menu music a little while a cue plays, then let it back in (gently: it's music, not a bed)
  function duck(amount, holdMs) { if (!ambBus || !amb) return; const t = ctx.currentTime; ambBus.gain.cancelScheduledValues(t); ambBus.gain.setTargetAtTime(amb.level * (1 - amount * .6), t, .03); ambBus.gain.setTargetAtTime(amb.level, t + holdMs / 1000, .25); }
  // Early reflections (a few discrete taps, panned) + a diffuse convolved tail, with a high cut so it stays soft
  function buildReverb() {
    const taps = [[.011, .5, -.6], [.019, .38, .6], [.029, .3, -.25], [.041, .22, .35]];
    taps.forEach(([d, g, pan]) => { const dl = ctx.createDelay(.1); dl.delayTime.value = d; const gg = ctx.createGain(); gg.gain.value = g; const p = ctx.createStereoPanner(); p.pan.value = pan; verbIn.connect(dl); dl.connect(gg); gg.connect(p); p.connect(verbOut); });
    // the tail's impulse (2.2 s stereo noise) used to be built right here, stalling the first keypress by 60–75 ms:
    // it is now filled in idle time a slice at a time and handed to the convolver when done (silent until then)
    const conv = ctx.createConvolver(); impulseLater(conv, 2.2, 3.6); const hc = ctx.createBiquadFilter(); hc.type = 'lowpass'; hc.frequency.value = 3600; const tail = ctx.createGain(); tail.gain.value = .5;
    verbIn.connect(hc); hc.connect(conv); conv.connect(tail); tail.connect(verbOut);
  }
  const idle = (fn, ms) => window.requestIdleCallback ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(() => fn({ timeRemaining: () => 8, didTimeout: true }), 50);
  function impulseLater(conv, seconds, decay) {
    const rate = ctx.sampleRate, n = Math.floor(rate * seconds), buf = ctx.createBuffer(2, n, rate), lp = [0, 0];
    let c = 0, i = 0;
    const step = dl => {
      const t0 = performance.now(), budget = Math.max(4, Math.min(12, dl && dl.timeRemaining ? dl.timeRemaining() : 8));
      while (c < 2 && performance.now() - t0 < budget) {
        const d = buf.getChannelData(c), end = Math.min(n, i + 8192);
        for (; i < end; i++) { const t = i / n; const w = Math.random() * 2 - 1; lp[c] += (w - lp[c]) * .35; d[i] = lp[c] * Math.pow(1 - t, decay) * (1 - .4 * Math.exp(-i / (rate * .004))); }
        if (i >= n) { c++; i = 0; }
      }
      if (c < 2) idle(step, 1000); else idle(() => { conv.buffer = buf; }, 1000);
    };
    idle(step, 1000);
  }
  // Filtered noise (k: how smooth, amp: its level) for the looping beds and breaths. On Android it is filled in idle
  // slices and `then` runs once it's ready (the 4–6 s beds were half a million random numbers in one go, right as the
  // museum opened); elsewhere it is filled at once and `then` runs straight away, as before.
  const sliced = () => !!(window.bsPlatform && window.bsPlatform.os === 'android');
  function fillNoise(buf, k, amp, then) {
    let ch = 0, i = 0, v = 0;
    const run = budget => { const t0 = performance.now();
      while (ch < buf.numberOfChannels) { const d = buf.getChannelData(ch), end = Math.min(d.length, i + 8192);
        for (; i < end; i++) { v += ((Math.random() * 2 - 1) - v) * k; d[i] = v * amp; }
        if (i >= d.length) { ch++; i = 0; v = 0; }
        if (budget && performance.now() - t0 > budget) return ch >= buf.numberOfChannels; }
      return true; };
    if (!sliced()) { run(0); then(); return; }
    const step = dl => { if (run(Math.max(4, Math.min(12, dl && dl.timeRemaining ? dl.timeRemaining() : 8)))) then(); else idle(step, 1000); };
    idle(step, 1000);
  }
  let fakeClock = null; const clock = () => fakeClock != null ? fakeClock : performance.now();
  let atBase = 0; // demo renders schedule a whole sequence offline by moving this along
  const now = () => ctx.currentTime + atBase;
  // every note also goes out as an event (the Keys theme ripples to it); skipped while rendering offline
  let fxLast = 0;
  function noteFx(f, v, at) {
    if (!ctx || (window.OfflineAudioContext && ctx instanceof OfflineAudioContext)) return;
    const fire = () => { const t = performance.now(); if (t - fxLast < 22) return; fxLast = t; try { window.dispatchEvent(new CustomEvent('bs-note', { detail: { f, v, hue: song ? song.hue : null } })); } catch {} };
    if (at > .01) setTimeout(fire, at * 1000); else fire();
  }
  function bus(verbAmt, pan) {
    // Android, baking the ticks: no panner here, the baked tick is panned when it plays
    if (baking) { const out = ctx.createGain(); out.connect(dryBus); if (verbAmt > 0) { const s = ctx.createGain(); s.gain.value = verbAmt; out.connect(s); s.connect(verbIn); } return out; }
    const out = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = pan || 0; out.connect(p); p.connect(dryBus);
    if (verbAmt > 0) { const s = ctx.createGain(); s.gain.value = verbAmt; p.connect(s); s.connect(verbIn); }
    return out;
  }
  // A struck note. o: freq, dur, vol, at, pan, verb, bright, thump (onset pitch multiplier), partials, attack, noise, glide (target freq), sub (add a soft low octave)
  function hit(o) {
    const c = ensure(); if (!c || !enabled) return;
    if (!lite) duck(o.duck == null ? .35 : o.duck, (o.dur || T().decay) * 1000 + 150);
    const t = T(), t0 = now() + (o.at || 0), dur = o.dur || t.decay, vol = (o.vol == null ? .5 : o.vol) * TRIM;
    if (o.fx !== false && !lite) noteFx(o.freq || 440, o.vol == null ? .5 : o.vol, o.at || 0);
    const out = bus(o.verb == null ? t.verb : o.verb, o.pan || 0);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(o.bright || t.bright, t0); lp.frequency.exponentialRampToValueAtTime(Math.max(400, (o.bright || t.bright) * .35), t0 + dur); lp.Q.value = .6; lp.connect(out);
    const parts = o.partials || t.partials, thump = o.thump == null ? t.thump : o.thump, wv = o.wave || t.wave;
    parts.forEach(([ratio, amp, dm], i) => {
      const osc = c.createOscillator(), g = c.createGain(); osc.type = i === 0 ? wv : 'sine';
      const f = (o.freq || 440) * ratio;
      if (f * Math.max(1, thump) > 18000) return; // partials above hearing (and Nyquist) on the highest notes
      osc.frequency.setValueAtTime(f * thump, t0); osc.frequency.exponentialRampToValueAtTime(f, t0 + .018);
      if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, o.glide * ratio), t0 + (o.glideTime || dur * .7));
      const a = o.attack || t.attack || .003, d = dur * (dm == null ? 1 : dm);
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol * amp, t0 + a); g.gain.setTargetAtTime(0, t0 + a, d / 4.5);
      osc.connect(g); g.connect(lp); osc.start(t0); osc.stop(t0 + d + .25);
    });
    if (o.sub) { const osc = c.createOscillator(), g = c.createGain(); osc.type = 'sine'; osc.frequency.setValueAtTime((o.freq || 440) / 2, t0); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol * o.sub, t0 + .006); g.gain.setTargetAtTime(0, t0 + .006, dur / 3); osc.connect(g); g.connect(out); osc.start(t0); osc.stop(t0 + dur + .3); }
    const br = o.breath == null ? (t.breath || 0) : o.breath;
    if (br > 0) air({ at: o.at || 0, dur: dur * 1.3, vol: vol * br, filter: 'bandpass', freq: Math.min(12000, (o.freq || 440) * 2.2), q: .5, verb: (o.verb == null ? t.verb : o.verb) * .8, pan: o.pan || 0, attack: Math.max(.01, (o.attack || t.attack || .003) * 1.5), soft: true });
    const nAmt = o.noise == null ? t.noise : o.noise;
    if (nAmt > 0) air({ at: o.at || 0, dur: Math.min(.04, dur), vol: vol * nAmt * 2.2, filter: 'bandpass', freq: Math.min(9000, (o.freq || 440) * 5), q: .9, verb: 0, pan: o.pan || 0, attack: .001 });
  }
  // Shaped noise: transients, whooshes, breath
  // the noise itself is made once per audio context (three seconds each of white and of softened noise, two takes of each);
  // every breath plays a random stretch of one, so nothing is allocated per sound
  let airCtx = null, airBufs = null; const AIR_LEN = 3;
  function airNoise(c, soft) {
    if (airCtx !== c) {
      airCtx = c; airBufs = { hard: [], soft: [] }; const n = Math.ceil(c.sampleRate * AIR_LEN);
      // (each one goes into the list once it's filled; until the first is, a breath is skipped)
      for (const kind of ['hard', 'soft']) for (let k = 0; k < 2; k++) { const buf = c.createBuffer(1, n, c.sampleRate), list = airBufs[kind]; fillNoise(buf, kind === 'soft' ? .2 : 1, 1, () => { if (airBufs && airBufs[kind] === list) list.push(buf); }); }
    }
    const a = airBufs[soft ? 'soft' : 'hard']; return a.length ? a[(Math.random() * a.length) | 0] : null;
  }
  function air(o) {
    const c = ensure(); if (!c || !enabled) return;
    const t0 = now() + (o.at || 0), dur = o.dur || .2, len = dur + .05;
    const nb = airNoise(c, o.soft); if (!nb) return; // (Android: the noise is still being made, in idle time)
    const src = c.createBufferSource(); src.buffer = nb;
    const f = c.createBiquadFilter(); f.type = o.filter || 'bandpass'; f.Q.value = o.q || .8; f.frequency.setValueAtTime(o.freq || 1200, t0);
    if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime((o.vol == null ? .1 : o.vol) * TRIM, t0 + (o.attack || .004)); g.gain.setTargetAtTime(0, t0 + (o.attack || .004) + (o.hold || 0), dur / 3);
    const out = bus(o.verb == null ? .2 : o.verb, o.pan || 0);
    src.connect(f); f.connect(g); g.connect(out);
    if (len < AIR_LEN) src.start(t0, Math.random() * (AIR_LEN - len), len); else { src.loop = true; src.start(t0, Math.random() * AIR_LEN); src.stop(t0 + len); }
  }
  // ---- richer voices for the boot (FM, like the bells and electric pianos of that console era) ----
  // fm: a sine carrier bent by a sine modulator whose depth falls away: bright and glassy at the strike, pure as it rings.
  // o: freq, at, dur, vol, ratio (modulator : carrier), index (brightness), pan, verb, detune (cents, adds a chorused twin)
  function fm(o) {
    const c = ensure(); if (!c || !enabled) return;
    const t0 = now() + (o.at || 0), dur = o.dur || 1.2, f = o.freq || 440, vol = (o.vol == null ? .3 : o.vol) * TRIM, out = bus(o.verb == null ? .4 : o.verb, o.pan || 0);
    (o.detune ? [-o.detune, o.detune] : [0]).forEach((cents, k, arr) => {
      const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), ff = f * Math.pow(2, cents / 1200);
      let rr = o.ratio || 3.5; while (ff * rr > 12000 && rr > 1) rr -= 1; /* keep the modulator in the audible range (no aliasing grit on high notes) */ car.frequency.value = ff; mod.frequency.value = ff * rr;
      const idx = (o.index == null ? 2.5 : o.index) * ff; mg.gain.setValueAtTime(idx, t0); mg.gain.setTargetAtTime(idx * (o.floor == null ? .08 : o.floor), t0 + .005, (o.bright || .18) * dur);
      mod.connect(mg); mg.connect(car.frequency);
      const a = o.attack || .002, v = vol / arr.length; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + a); g.gain.setTargetAtTime(0, t0 + a, dur / 4.2);
      car.connect(g); g.connect(out); car.start(t0); mod.start(t0); car.stop(t0 + dur + .3); mod.stop(t0 + dur + .3);
    });
  }
  // pad: detuned saws through a lowpass that opens up, for a lush swell
  function pad(o) {
    const c = ensure(); if (!c || !enabled) return;
    const t0 = now() + (o.at || 0), dur = o.dur || 2, out = bus(o.verb == null ? .7 : o.verb, 0), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = o.q || 1.2;
    lp.frequency.setValueAtTime(o.from || 300, t0); lp.frequency.exponentialRampToValueAtTime(o.to || 3500, t0 + (o.open || dur * .6)); lp.connect(out);
    const notes = o.freqs || [220], v = (o.vol == null ? .2 : o.vol) * TRIM / notes.length / 2;
    notes.forEach((fr, i) => [-7, 7].forEach(ct => { const osc = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner(); osc.type = 'sawtooth'; osc.frequency.value = fr * Math.pow(2, ct / 1200); p.pan.value = ct > 0 ? .4 : -.4;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + (o.attack || dur * .4)); g.gain.setTargetAtTime(0, t0 + (o.hold || dur * .55), dur / 5); osc.connect(g); g.connect(p); p.connect(lp); osc.start(t0); osc.stop(t0 + dur + 1); }));
  }
  const thumpLow = (at, v) => hit({ freq: deg(0, -2), dur: .45, vol: v || .22, at: at || 0, attack: .003, sub: 1, bright: 420, verb: .2, noise: 0, breath: 0, duck: 0, fx: false });
  // Four candidate boots, picked in Settings → Sounds (boot); all in the console's own key
  const BOOTS = {
    // Crystal: a fast glassy run up the scale that blooms into a ringing chord
    crystal() { thumpLow(0, .16); [0, 1, 2, 3, 4].forEach((n, i) => fm({ freq: deg(n, 1), at: .1 + i * .075, dur: .9, vol: .22, ratio: 3.5, index: 2.2, pan: (i - 2) * .18, verb: .45 }));
      [[5, 1, .3, 0], [7, 1, .2, .25], [3, 0, .2, -.25]].forEach(([n, o, v, p]) => fm({ freq: deg(n, o), at: .5, dur: 2.4, vol: v, ratio: 3.5, index: 1.6, pan: p, verb: .6, detune: 4 }));
      fm({ freq: deg(9, 1), at: .95, dur: 1, vol: .06, ratio: 5, index: 1, pan: .4, verb: .8 }); },
    // Pulse: two quick notes and a punchy chord, short and snappy like a power-on
    pulse() { thumpLow(0, .26); fm({ freq: deg(3), at: .02, dur: .35, vol: .3, ratio: 1, index: 3, verb: .25, pan: -.15 });
      fm({ freq: deg(5), at: .16, dur: .35, vol: .3, ratio: 1, index: 3, verb: .25, pan: .15 });
      [[5, 0], [7, 0], [8, 0], [5, 1]].forEach(([n, o], i) => fm({ freq: deg(n, o), at: .32, dur: 1.5, vol: .2, ratio: 1, index: 2.2, floor: .15, pan: (i - 1.5) * .2, verb: .45, detune: 6 }));
      fm({ freq: deg(5, 1), at: .34, dur: 1.3, vol: .12, ratio: 3.5, index: 1.2, verb: .6 }); },
    // Horizon: a deep swell opens up and lands on a bright chord with a shimmering tail
    horizon() { pad({ freqs: [deg(0, -1), deg(3, -1), deg(5, -1)], at: 0, dur: 2.6, vol: .3, from: 180, to: 3200, open: 1.3, attack: 1.1, hold: 1.4 });
      thumpLow(1.25, .24); [[0, 1, .26, 0], [3, 1, .18, -.3], [5, 1, .2, .3], [7, 1, .1, .1]].forEach(([n, o, v, p]) => fm({ freq: deg(n, o), at: 1.25, dur: 2.2, vol: v, ratio: 3.5, index: 2, pan: p, verb: .65, detune: 3 }));
      [9, 10, 12].forEach((n, i) => fm({ freq: deg(n, 1), at: 1.55 + i * .11, dur: .7, vol: .05, ratio: 4, index: 1, pan: (i - 1) * .4, verb: .9 })); },
    // Keys: a warm electric-piano chord rolled upwards with a bell on top
    keys() { thumpLow(0, .14); [[0, 0], [2, 0], [3, 0], [5, 0], [7, 0]].forEach(([n, o], i) => fm({ freq: deg(n, o), at: .08 + i * .06, dur: 2, vol: .2, ratio: 1, index: 1.8, floor: .2, pan: (i - 2) * .15, verb: .5, detune: 5 }));
      fm({ freq: deg(5, 1), at: .45, dur: 1.8, vol: .16, ratio: 3.5, index: 1.8, verb: .6 }); fm({ freq: deg(7, 1), at: .62, dur: 1.4, vol: .09, ratio: 3.5, index: 1.4, verb: .7, pan: .3 }); },
  };
  let bootPick = 'chime'; // until one of the new ones is picked
  BOOTS.chime = () => bootChime();
  // The Boxshelf boot: one signature you'll know from the first note, the same on every console but played in that
  // console's own key (so a GameCube boot and a Wii boot are related, not identical). A soft power-on thump, a breath of
  // air sweeping up, four clear bell notes rising (root, fifth, sixth, octave) and a bright open chord that rings out
  // over a warm pad, with two tiny sparkles at the top. Crisp attacks, short room, everything done by ~3 s.
  function bootSig() { if (BOOTS[bootPick]) return BOOTS[bootPick](); return bootChime(); }
  function bootChime() {
    const bell = [[1, 1, 1], [2, .28, .55], [3, .1, .38], [4.16, .05, .28], [5.4, .02, .2]];
    hit({ freq: deg(0, -2), dur: .5, vol: .2, attack: .004, sub: .8, bright: 500, verb: .25, noise: 0, breath: 0, duck: 0 });
    air({ dur: .7, vol: .06, filter: 'highpass', freq: 1800, sweepTo: 7000, q: .5, verb: .5, attack: .25, soft: true });
    [[0, .14], [3, .29], [4, .44]].forEach(([n, t], i) => hit({ freq: deg(n, 1), dur: .55, vol: .26, at: t, attack: .002, verb: .45, pan: (i - 1) * .22, partials: bell, noise: 0, breath: 0, duck: 0 }));
    // the landing: octave on top, the third above it, the fifth underneath
    hit({ freq: deg(5, 1), dur: 2.1, vol: .26, at: .62, attack: .002, verb: .6, partials: bell, noise: 0, breath: 0, pan: .05 });
    hit({ freq: deg(7, 1), dur: 1.8, vol: .15, at: .65, attack: .003, verb: .65, partials: bell, noise: 0, breath: 0, pan: .25 });
    hit({ freq: deg(3), dur: 1.9, vol: .16, at: .64, attack: .004, verb: .6, partials: bell, noise: 0, breath: 0, pan: -.25 });
    swell({ notes: [0, 2, 3], octave: -1, dur: 2.2, vol: .1, at: .55, attack: .35 });
    [[10, 1.02, .3], [12, 1.16, -.3]].forEach(([n, t, p]) => hit({ freq: deg(n, 1), dur: .5, vol: .07, at: t, attack: .002, verb: .8, pan: p, partials: bell, noise: 0, breath: 0, duck: 0 }));
  }
  // Breathy sustained swell (for boot / go): filtered noise + a soft chord that fades in
  function swell(o) {
    const c = ensure(); if (!c || !enabled) return;
    const t0 = now() + (o.at || 0), dur = o.dur || 1.2, out = bus(o.verb == null ? .6 : o.verb, 0);
    (o.notes || [0]).forEach((n, i) => { const osc = c.createOscillator(), g = c.createGain(); osc.type = 'sine'; osc.frequency.value = deg(n, o.octave || 0); const v = (o.vol == null ? .18 : o.vol) * TRIM / (o.notes || [0]).length;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + (o.attack || dur * .35)); g.gain.setTargetAtTime(0, t0 + dur * .55, dur / 5); const p = c.createStereoPanner(); p.pan.value = ((i % 2) ? .35 : -.35) * (i ? 1 : 0); osc.connect(g); g.connect(p); p.connect(out); osc.start(t0); osc.stop(t0 + dur + .6); });
    air({ at: o.at || 0, dur, vol: .05, filter: 'lowpass', freq: 500, sweepTo: 2600, q: .4, verb: .6, attack: dur * .4, soft: true });
  }

  // Melodic scrolling: each quick step walks one note along the pentatonic scale in the direction you're moving
  // (right climbs, left descends), up to about an octave and a half; pause and it drifts back home. Slow steps stay near home.
  // Quick steps ride a little up-and-down figure (0 1 2 3 2 1 0 1 …) instead of pinning at a top note; going the
  // other way plays it backwards. A pause brings it back to the home note.
  // twelve places: up to four above home, down to two below, so a held scroll takes a couple of seconds per cycle
  const TRI = [0, 1, 2, 3, 4, 3, 2, 1, 0, -1, -2, -1];
  const tri = n => TRI[((Math.round(n) % TRI.length) + TRI.length) % TRI.length];
  function walk(o) {
    const t = clock(), dir = o && o.dir < 0 ? -1 : 1, gap = t - lastTick; lastTick = t;
    // Each press moves one place along the figure. When the pad is held and ticks come every 45 ms, a full
    // place per tick would whirr through the figure four times a second, so held scrolling advances by time
    // instead (one place per ~140 ms): a slow, audible rise and fall like the shelf switch. A pause brings it home.
    if (gap < 2500) tickRun += dir * Math.min(1, gap / 160); else tickRun = 0;
    return tri(tickRun);
  }
  // Flicking through shelves quickly: a short bright step (like the fast tick, a little lower) instead of the whole shelf phrase each time
  function shelfQuick(o) {
    const t = clock(); const quick = t - lastShelf < 600, dir = o && o.dir < 0 ? -1 : 1; shelfRun = t - lastShelf < 2500 ? shelfRun + dir : 0; lastShelf = t;
    if (!quick) return false;
    const step = tri(shelfRun);
    hit({ freq: deg(step, 0), dur: .1, vol: .3, verb: .4, pan: (Math.random() - .5) * .3, attack: .006, breath: .25, duck: .15 });
    hit({ freq: deg(4 + step, 0), dur: .14, vol: .18, at: .05, verb: .5, attack: .01, breath: .25, duck: 0 });
    return true;
  }
  // ---- the cue set. Pitches are scale degrees so every voice gets the same musical shapes. ----
  const S = {
    // one box: short, pitched, climbs and tightens as you scroll faster (max +4 degrees), decays back over ~1 s
    tick(o) { const n = walk(o);
      hit({ freq: deg(5 + n), dur: .075 - Math.abs(n) * .005, vol: .5, verb: .14, pan: (Math.random() - .5) * .15, thump: 1.5 }); },
    // changing shelf: a quick airy whoosh and a low-high pair, wide in stereo
    shelf(o) { if (shelfQuick(o)) return; air({ dur: .24, vol: .3, filter: 'bandpass', freq: 500, sweepTo: 3200, q: .7, verb: .45, soft: true }); hit({ freq: deg(0), dur: .24, vol: .32, at: .02, pan: -.3 }); hit({ freq: deg(4), dur: .34, vol: .3, at: .1, pan: .3 }); },
    open() { hit({ freq: deg(3), dur: .18, vol: .32 }); hit({ freq: deg(7), dur: .3, vol: .3, at: .075, pan: .2 }); },
    back() { hit({ freq: deg(3), dur: .14, vol: .3 }); hit({ freq: deg(0), dur: .26, vol: .28, at: .07, pan: -.2, bright: 3000 }); },
    // Play: a rising three-note figure that lands on the octave, with air swelling under it
    go() { [0, 2, 5].forEach((n, i) => hit({ freq: deg(n), dur: .3 + i * .1, vol: .36, at: i * .095, pan: (i - 1) * .25 })); swell({ notes: [0, 2, 5], octave: -1, dur: 1.1, vol: .14, at: .1, attack: .3 }); },
    flip() { air({ dur: .2, vol: .3, filter: 'bandpass', freq: 1200, sweepTo: 350, q: 1, verb: .2 }); hit({ freq: deg(-2), dur: .12, vol: .34, at: .11, noise: .5, thump: 1.2 }); },
    caseOpen() { hit({ freq: deg(9, 1), dur: .045, vol: .5, noise: 1.2, verb: .08, thump: 1.6 }); hit({ freq: deg(-5), dur: .3, vol: .22, at: .1, bright: 1600, sub: .4 }); },
    caseClose() { hit({ freq: deg(-5), dur: .11, vol: .55, noise: .8, bright: 1500, sub: .7, thump: 1.1 }); hit({ freq: deg(8), dur: .04, vol: .3, noise: 1.2, at: .06, verb: .05 }); },
    discOut() { hit({ freq: deg(4), dur: .2, vol: .26 }); hit({ freq: deg(9), dur: .34, vol: .22, at: .07, pan: .25 }); air({ dur: .4, vol: .12, filter: 'highpass', freq: 3500, verb: .5, attack: .12, soft: false }); },
    page() { air({ dur: .14, vol: .45, filter: 'bandpass', freq: 2200, sweepTo: 600, q: .6, verb: .12, pan: .1 }); hit({ freq: deg(6), dur: .05, vol: .25, noise: .8, verb: .05 }); },
    hold() { hit({ freq: deg(10), dur: .04, vol: .3, noise: 0, verb: 0 }); },
    error() { hit({ freq: deg(-7), dur: .22, vol: .36, partials: [[1, 1, 1], [1.5, .35, .8]], bright: 1100, thump: .9 }); hit({ freq: deg(-8), dur: .3, vol: .28, at: .12, bright: 900, thump: .9 }); },
    toast() { hit({ freq: deg(8), dur: .14, vol: .34, verb: .3, pan: .4 }); hit({ freq: deg(10), dur: .2, vol: .26, at: .05, verb: .4, pan: .4 }); },
    // achievement: a quick upward sparkle landing on a held high note, lots of room
    unlock() { [0, 2, 4, 5, 7].forEach((n, i) => hit({ freq: deg(n, 1), dur: .35, vol: .28, at: i * .06, verb: .55, pan: (i - 2) * .18 })); hit({ freq: deg(9, 1), dur: .9, vol: .2, at: .34, verb: .75, partials: [[1, 1, 1], [2, .15, .6]] }); swell({ notes: [0, 4], octave: 0, dur: 1.4, vol: .12, at: .25, attack: .4 }); },
    boot() { bootSig(); },
    // insert animation foley
    lidClick() { hit({ freq: deg(7), dur: .045, vol: .6, noise: 1.2, verb: .08, thump: 1.7 }); },
    seat() { hit({ freq: deg(-9), dur: .24, vol: .4, bright: 700, noise: .4, sub: .8, thump: 1.1 }); },
    whir() { air({ dur: 1.1, vol: .2, filter: 'bandpass', freq: 110, sweepTo: 1100, q: 2.5, verb: .3, attack: .2, hold: .35 }); air({ dur: 1, vol: .08, filter: 'bandpass', freq: 2400, sweepTo: 5200, q: 3, verb: .3, attack: .35, hold: .2 }); },
  };
  // Aero tick n steps along the figure, in one of three slightly different takes v (jit: a tiny random detune)
  // the bright, tight tick that fast scrolling used to climb to is the resting sound now; fast scrolling still lifts it a little
  function aeroTick(n, v, jit, pan) {
    const parts = [[[1, 1, 1], [2, .12, .5]], [[1, 1, 1], [2.01, .1, .5], [3.98, .03, .3]], [[1, 1, 1], [1.99, .14, .45]]][v];
    return { freq: deg(2 + n) * jit, dur: .085 + v * .006, vol: .34 + v * .015, verb: .35, pan, attack: .005 + v * .002, breath: .3 + v * .05, partials: parts, duck: .15 };
  }
  // Music box tick: one tine (what tine(2 + n, { dur: .55, vol, pan }) plays)
  const boxTick = (n, vol, pan) => ({ freq: deg(2 + n), dur: .55, pan, duck: .1, vol: vol * .48 });
  // Aero overrides: fewer notes, closer intervals, breath instead of attack
  const A = {
    tick(o) { const n = walk(o), v = (tickVar = (tickVar + 1) % 3);
      const h = aeroTick(n, v, 1 + (Math.random() - .5) * .01, (Math.random() - .5) * .2);
      if (!bakedHit(h, 'a' + v + '|' + n)) hit(h); },
    shelf(o) { if (shelfQuick(o)) return; air({ dur: .5, vol: .16, filter: 'bandpass', freq: 900, sweepTo: 4500, q: .5, verb: .7, attack: .12, soft: true }); hit({ freq: deg(0), dur: .5, vol: .2, at: .05, pan: -.2, attack: .03 }); hit({ freq: deg(4), dur: .6, vol: .16, at: .16, pan: .2, attack: .04 }); },
    open() { hit({ freq: deg(2), dur: .26, vol: .32, attack: .008 }); hit({ freq: deg(4), dur: .42, vol: .26, at: .06, attack: .02, pan: .15 }); },
    back() { hit({ freq: deg(2), dur: .2, vol: .3, attack: .008, bright: 4000 }); hit({ freq: deg(-1), dur: .36, vol: .22, at: .06, bright: 2600, pan: -.15 }); },
    go() { hit({ freq: deg(0), dur: .9, vol: .3, attack: .02, verb: .8 }); hit({ freq: deg(4), dur: 1.1, vol: .26, at: .22, attack: .05, verb: .85, pan: .2 }); swell({ notes: [0, 4], octave: -2, dur: 1.6, vol: .2, at: .05, attack: .45 }); air({ dur: 1.2, vol: .16, filter: 'bandpass', freq: 1500, sweepTo: 7000, q: .4, verb: .8, attack: .5, soft: true }); },
    flip() { air({ dur: .28, vol: .26, filter: 'bandpass', freq: 2500, sweepTo: 500, q: .7, verb: .5, attack: .02, soft: true }); hit({ freq: deg(-3), dur: .18, vol: .2, at: .12, attack: .01, breath: .3 }); },
    caseOpen() { hit({ freq: deg(6), dur: .06, vol: .32, noise: .9, verb: .2, attack: .002, breath: 0 }); hit({ freq: deg(-5, -1), dur: .4, vol: .22, at: .08, bright: 1600, sub: .4, attack: .01 }); },
    caseClose() { hit({ freq: deg(-5, -1), dur: .14, vol: .32, noise: .5, bright: 1400, sub: .6, attack: .003, breath: 0 }); hit({ freq: deg(6), dur: .04, vol: .14, noise: 1, at: .06, verb: .1, breath: 0 }); },
    discOut() { hit({ freq: deg(4), dur: .36, vol: .2, attack: .01 }); hit({ freq: deg(7), dur: .6, vol: .15, at: .09, attack: .03, pan: .25 }); air({ dur: .6, vol: .1, filter: 'highpass', freq: 4000, verb: .7, attack: .15, soft: true }); },
    page() { air({ dur: .18, vol: .4, filter: 'bandpass', freq: 2600, sweepTo: 700, q: .5, verb: .25, pan: .1, soft: true }); },
    hold() { hit({ freq: deg(6), dur: .05, vol: .22, noise: 0, verb: .1, breath: 0, attack: .004 }); },
    error() { hit({ freq: deg(-6), dur: .3, vol: .34, partials: [[1, 1, 1], [1.5, .3, .8]], bright: 1300, attack: .006, breath: .2 }); hit({ freq: deg(-6), dur: .3, vol: .26, at: .16, bright: 1200, attack: .006 }); },
    toast() { hit({ freq: deg(5), dur: .3, vol: .26, verb: .6, pan: .4, attack: .01 }); },
    unlock() { [0, 4, 7].forEach((n, i) => hit({ freq: deg(n), dur: .7, vol: .2, at: i * .11, verb: .8, pan: (i - 1) * .25, attack: .02 })); hit({ freq: deg(9), dur: 1.4, vol: .18, at: .4, verb: .9, attack: .06 }); swell({ notes: [0, 4], octave: -1, dur: 1.8, vol: .14, at: .3, attack: .5 }); },
    boot() { bootSig(); },
    lidClick() { hit({ freq: deg(7), dur: .045, vol: .26, noise: 1, verb: .1, attack: .002, breath: 0, thump: 1.6 }); },
    seat() { hit({ freq: deg(-9, -1), dur: .34, vol: .2, bright: 700, noise: 0, sub: .7, attack: .008, breath: 0, thump: 1.05 }); },
    whir: null, // shared
    lamp: null, slide: null, // shared
  };
  // museum foley: a picture lamp switching on (soft thunk + a short filament hum), a case sliding on wood
  S.lamp = () => { hit({ freq: deg(-9, -1), dur: .12, vol: .05, bright: 700, noise: .25, sub: .4, attack: .004, breath: 0, verb: .5, duck: 0 }); };
  // museum opening: a slow warm chord blooming up with a breath of air, like lights coming up in a quiet room
  S.museum = () => {
    const bell = [[1, 1, 1], [2, .32, .6], [3, .1, .4], [4.2, .05, .3]];
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((n, i) => hit({ freq: deg(n), dur: .32 + i * .02, vol: .24, at: i * .072 - i * i * .0015, verb: .55, pan: (i - 3.5) * .09, attack: .003, breath: 0, noise: 0, partials: bell, duck: .2 }));
    // soft landing: the run resolves down onto a warm mid chord rather than a high ping
    hit({ freq: deg(5), dur: 1.5, vol: .18, at: .6, verb: .85, attack: .02, partials: bell, pan: .12 }); hit({ freq: deg(2), dur: 1.5, vol: .14, at: .62, verb: .85, attack: .03, partials: bell, pan: -.12 }); hit({ freq: deg(0, -1), dur: 1.6, vol: .12, at: .64, verb: .8, attack: .04, breath: .3 });
    swell({ notes: [-3, 0, 4], octave: -1, dur: 2.0, vol: .14, at: .5, attack: .2 });
  };
  S.slide = () => { air({ dur: .22, vol: .16, filter: 'bandpass', freq: 900, sweepTo: 1600, q: .9, verb: .35, attack: .02, soft: true }); hit({ freq: deg(-5, -1), dur: .08, vol: .1, at: .16, noise: .4, breath: 0, verb: .3 }); };

  // "arrive": the quiet settle when a motion lands (box comes to rest, panel finishes sliding)
  // (kept for themes that want them; the shelf no longer plays "arrive" by default, it was one sound too many per move)
  S.arrive = () => hit({ freq: deg(0), dur: .1, vol: .05, verb: .3, attack: .01, breath: .1, duck: 0 });
  A.arrive = () => hit({ freq: deg(0, -1), dur: .12, vol: .04, verb: .5, attack: .012, breath: .2, duck: 0 });
  S.panel = () => { air({ dur: .2, vol: .07, filter: 'bandpass', freq: 700, sweepTo: 2200, q: .6, verb: .4, soft: true }); hit({ freq: deg(2), dur: .16, vol: .08, at: .1, attack: .01, duck: .05 }); };
  A.panel = () => { air({ dur: .26, vol: .07, filter: 'bandpass', freq: 800, sweepTo: 2800, q: .5, verb: .6, attack: .04, soft: true }); hit({ freq: deg(2, -1), dur: .22, vol: .07, at: .12, attack: .015, breath: .3, duck: .05 }); };

  // ---------------- Menu music (1.75; ambient since 1.77) ----------------
  // Subtle home-screen music in the spirit of the PS4, PS5 and GameCube menus: no beat, no bass line, no tune to hum.
  // Long chords that swell in and glide into the next (a warm pad), a breath of filtered air under them, a low drone on
  // the darker ones, and now and then one soft note far off in a big room. Made here like every other sound (nothing to
  // download, no licences). A small timer writes the next few seconds on the audio clock (no animation frames); the
  // notes play on the audio thread, and the timer skips a turn while the shelf slides when it's far enough ahead. It
  // sits in the interface voice's key plus the shelf's key (KEYS in app.js), changing key only where its chord loop
  // starts over, so the cues always agree with it. The notes are chosen as it goes (seeded), so it never loops exactly.
  const CH = { maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], sus: [0, 5, 7, 10, 14], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], add9: [0, 4, 7, 14] };
  // bpm: the slow pulse notes fall on (in eighths); bars: bars per chord; pad / air / drone: their levels; glide: seconds
  // a chord takes to slide into the next; notes: the chance per eighth of one soft far-off note, its voice, octave, the
  // shortest gap between two and its loudness. Glow: a slow music-box lullaby instead (plan: a phrase A, its repeat with
  // a new ending A2, '-' a rest; two-bar phrases of long notes)
  const TRACKS = {
    drift: { name: 'Drift', bpm: 60, bars: 3, prog: [[0, 'maj9'], [5, 'maj9'], [9, 'm9'], [7, 'sus']], pad: 1, glide: 1.6, air: 1, airHz: 900, drone: 0, notes: { p: .09, voice: 'glass', oct: 2, gap: 4.5, vel: .055 } },
    night: { name: 'Night', bpm: 52, bars: 4, prog: [[9, 'm9'], [5, 'maj7'], [0, 'add9'], [7, 'sus']], pad: .9, glide: 2.2, air: .7, airHz: 520, drone: .65, notes: { p: .07, voice: 'ep', oct: 1, gap: 6, vel: .05 } },
    glow:  { name: 'Glow',  bpm: 56, bars: 2, prog: [[0, 'add9'], [4, 'm7'], [5, 'maj7'], [0, 'add9']], pad: .65, glide: 1.2, air: .4, airHz: 1200, drone: .6, notes: null, lead: 'box', rhythms: [6, 4, 7], plan: ['A', '-', 'A2', '-'] },
  };
  const OLD_TRACK = { calm: 'drift', lounge: 'night', chime: 'glow' }; // (1.75's tracks: a saved choice still finds its new one)
  // a two-bar phrase's notes: [start, length] in eighths (16 to a phrase)
  const RHY = [[[0, 3], [3, 1], [4, 4], [10, 2], [12, 4]], [[2, 2], [4, 2], [6, 6], [14, 2]], [[0, 2], [2, 2], [4, 2], [6, 2], [8, 8]],
    [[1, 2], [3, 3], [8, 2], [10, 6]], [[0, 6], [6, 2], [8, 8]], [[3, 1], [4, 6], [12, 4]], [[0, 4], [4, 4], [8, 8]], [[0, 8], [8, 6]]];
  const PENTA = [0, 2, 4, 7, 9], STEPS = [-2, -1, -1, 0, 1, 1, 2];
  const MUS_GAIN = .4, AMB_VERB = .4; // the level setting (0-1) onto the music bus; how much of it goes to the room
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  const rngFrom = s => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // the tonic: the voice's root as a pitch class, plus the shelf's key, folded into C3..B3
  function musTonic() { const pc = Math.round(12 * Math.log2(T().root / 440)) + 69; return 48 + ((((pc + keyShift) % 12) + 12) % 12); }

  // electric piano: a sine bent by a sine at the same pitch (the bark fades in a moment), then a slow fall
  function mEp(m, f, t, dur, vel, pan) {
    const c = m.c, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), p = c.createStereoPanner();
    car.frequency.value = f; mod.frequency.value = f; mg.gain.setValueAtTime(f * (.6 + vel * 4), t); mg.gain.setTargetAtTime(f * .08, t, .25);
    mod.connect(mg); mg.connect(car.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + .02); g.gain.setTargetAtTime(vel * .5, t + .02, .4); g.gain.setTargetAtTime(0, t + dur, .8);
    p.pan.value = pan || 0; car.connect(g); g.connect(p); p.connect(m.bus);
    const end = t + dur + 4; car.start(t); mod.start(t); car.stop(end); mod.stop(end);
  }
  // music-box tine: a few partials, plucked and left to ring
  function mBell(m, f, t, vel, pan) {
    const c = m.c, g = c.createGain(), p = c.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(m.bus);
    const parts = [[1, 1], [2, .16], [5.4, .05]], end = t + 2.4;
    for (const [r, a] of (m.lite ? parts.slice(0, 2) : parts)) { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = f * r; og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(end); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + .004); g.gain.setTargetAtTime(0, t + .01, .55);
  }
  // glass: a pure high tone with a soft attack and a long ring (the far-off notes)
  function mGlass(m, f, t, vel, pan) {
    const c = m.c, g = c.createGain(), p = c.createStereoPanner(); p.pan.value = pan || 0; g.connect(p); p.connect(m.bus);
    const parts = [[1, 1], [2.001, .1], [3.003, .03]], end = t + 7;
    for (const [r, a] of (m.lite ? parts.slice(0, 1) : parts)) { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = f * r; og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(end); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + .05); g.gain.setTargetAtTime(0, t + .06, 1.6);
  }
  // the drone: a low tone and its octave, breathing in over a few seconds and out at the next chord
  function mDrone(m, f, t, dur, vel) {
    const c = m.c, g = c.createGain(), end = t + dur + 6; g.connect(m.bus);
    for (const [r, a, d] of [[1, 1, 0], [2, .25, 4], [1, .5, -3]].slice(0, m.lite ? 2 : 3)) { const o = c.createOscillator(), og = c.createGain(); o.frequency.value = f * r; o.detune.value = d; og.gain.value = a; o.connect(og); og.connect(g); o.start(t); o.stop(end); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + 2.5); g.gain.setTargetAtTime(0, t + dur, 1.2);
  }
  // the pad: four held voices (two detuned triangles each; one on Android) that glide to each new chord and breathe
  function padMake(m) {
    const c = m.c, out = c.createGain(), lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 850; lp.Q.value = .3;
    m.padBase = (m.lite ? .036 : .02) * m.def.pad; out.gain.value = 0; lp.connect(out); out.connect(m.bus);
    const vs = [];
    for (let i = 0; i < 4; i++) { const os = []; for (const d of (m.lite ? [0] : [-6, 6])) { const o = c.createOscillator(); o.type = 'triangle'; o.detune.value = d; o.frequency.value = 220; o.connect(lp); o.start(); os.push(o); } vs.push(os); }
    return { out, vs };
  }
  function padTo(m, notes, t) { m.pad.vs.forEach((os, i) => { const f = midi(notes[i % notes.length]); os.forEach(o => { if (m.step <= 1) o.frequency.setValueAtTime(f, t); else o.frequency.setTargetAtTime(f, t, m.def.glide / 3); }); }); }
  // air: filtered noise that slowly breathes (a few seconds of it, looped; filled in idle slices on Android)
  function airMake(m) {
    const d = m.def, c = m.c; if (!d.air) return;
    const buf = c.createBuffer(2, Math.floor(c.sampleRate * 4), c.sampleRate), bp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    bp.type = 'bandpass'; bp.frequency.value = d.airHz; bp.Q.value = .4; lfo.frequency.value = .05; lg.gain.value = d.airHz * .35; lfo.connect(lg); lg.connect(bp.frequency);
    g.gain.value = .05 * d.air; bp.connect(g); g.connect(m.bus); lfo.start(); m.nodes.push(lfo);
    fillNoise(buf, .02, 6, () => { if (m.stopped) return; const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(bp); s.start(); m.nodes.push(s); });
  }
  // a pentatonic degree (0 = the tonic) as a note in the lullaby's octave
  function degNote(m, dg) { const o = Math.floor(dg / 5), i = ((dg % 5) + 5) % 5; return m.tonic + 24 + PENTA[i] + 12 * o; }
  // the nearest degree that's in the chord
  function snap(m, dg, chord) { const pcs = new Set(chord.map(n => ((n % 12) + 12) % 12)); for (const k of [0, -1, 1, -2, 2]) if (pcs.has(((degNote(m, dg + k) % 12) + 12) % 12)) return dg + k; return dg; }

  // one eighth of the music
  function musStep(m) {
    const d = m.def, s = m.step++, pos = s % 8, bar = Math.floor(s / 8), e = m.eighth, t = m.t0 + s * e;
    if (s % (8 * d.bars * d.prog.length) === 0) m.tonic = musTonic(); // a new key only where the chord loop starts over
    const [r, kind] = d.prog[Math.floor(bar / d.bars) % d.prog.length], shape = CH[kind], start = pos === 0 && bar % d.bars === 0;
    let kb = m.tonic + 12 + r; if (kb > 62) kb -= 12; // chord tones around middle C
    const keys = shape.map(i => kb + i);
    if (start) {
      let pb = m.tonic + r; if (pb > 57) pb -= 12; padTo(m, shape.slice(0, 4).map(i => pb + i), t);
      m.pad.out.gain.setTargetAtTime(m.padBase * (.7 + .3 * m.rng()), t, 2.2); // each chord swells in at its own strength
      if (d.drone) { let dn = m.tonic - 12 + r; if (dn > 47) dn -= 12; mDrone(m, midi(dn), t, e * 8 * d.bars + 1.5, .05 * d.drone); }
    }
    const n = d.notes;
    if (n && t - m.lastNote >= n.gap && m.rng() < n.p) { // one soft note far off: a chord tone, up high
      m.lastNote = t; const pick = () => keys[Math.floor(m.rng() * keys.length)] + 12 * (n.oct - 1), pan = (m.rng() - .5) * .9, vel = n.vel * (.75 + m.rng() * .5);
      const play = (note, at, v) => { if (n.voice === 'glass') mGlass(m, midi(note), at, v, pan); else mEp(m, midi(note), at, e * 6, v, pan); };
      play(pick(), t, vel); if (m.rng() < .3) play(pick(), t + e * (1 + Math.floor(m.rng() * 3)), vel * .7); // (now and then a second, a moment later)
    }
    if (d.plan) musLead(m, s, t, keys);
  }
  // Glow's lullaby: two-bar phrases of long notes, walking the pentatonic scale and landing on the chord
  function musLead(m, s, t, chord) {
    const d = m.def, ps = s % 16;
    if (ps === 0) {
      const what = d.plan[Math.floor(s / 16) % d.plan.length];
      if (Math.floor(s / 16) % d.plan.length === 0) m.motif = null;
      const fresh = () => ({ rhy: RHY[d.rhythms[Math.floor(m.rng() * d.rhythms.length)]], keep: [], notes: [] });
      m.ph = what === '-' ? null : what === 'A2' && m.motif ? { rhy: m.motif.rhy, keep: m.motif.notes.slice(0, Math.ceil(m.motif.notes.length / 2)), notes: [] } : fresh();
      if (m.ph && what === 'A') m.motif = m.ph;
    }
    const ph = m.ph; if (!ph) return;
    const k = ph.rhy.findIndex(x => x[0] === ps); if (k < 0) return;
    const len = ph.rhy[k][1]; let dg;
    if (k < ph.keep.length) dg = ph.keep[k];
    else {
      const from = ph.notes.length ? ph.notes[ph.notes.length - 1] : (m.lastDeg != null ? m.lastDeg : 2);
      dg = Math.max(-1, Math.min(7, from + STEPS[Math.floor(m.rng() * STEPS.length)]));
      if (len >= 4 || ps === 0 || k === ph.rhy.length - 1) dg = snap(m, dg, chord);
    }
    ph.notes.push(dg); m.lastDeg = dg;
    mBell(m, midi(degNote(m, dg)), t, .032 * (.85 + m.rng() * .3), (m.rng() - .5) * .4);
  }
  function musMake(c, id, out, seed) {
    const def = TRACKS[id], bus = c.createGain(); bus.connect(out);
    const m = { id, def, c, bus, level: 0, t0: c.currentTime + .2, step: 0, eighth: 30 / def.bpm, tonic: musTonic(), rng: rngFrom(seed), lite: sliced(), timer: 0, motif: null, ph: null, lastDeg: null, lastNote: -1e9, nodes: [], stopped: false };
    m.next = () => m.t0 + m.step * m.eighth;
    m.pad = padMake(m); airMake(m);
    return m;
  }
  // the timer: keep ~2.6 s written ahead
  function musPump() {
    const m = amb; if (!m || m.c !== ctx) return; m.timer = 0;
    const now = ctx.currentTime;
    // (the clock ran on without us, e.g. a throttled timer: carry on from the next bar, not with a pile of late notes)
    if (m.next() < now - .1) m.step = Math.ceil((now + .15 - m.t0) / (8 * m.eighth)) * 8;
    const busy = typeof window.BS_BUSY === 'function' && window.BS_BUSY();
    if (!busy || m.next() < now + 1) { let n = 0; while (m.next() < now + 2.6 && n++ < 64) musStep(m); }
    m.timer = setTimeout(musPump, 600);
  }
  // opts: { track: 'drift' | 'night' | 'glow' (1.75's calm / lounge / chime still work), level: 0-1 }. Called again on every shelf change: the same track just
  // takes the new level (and the shelf's key at its next loop); another track crossfades in.
  // ---- (beta.14) music from files: Your music (the Music folder, shuffled) and a sound pack's own music on its consoles ----
  // An <audio> element plays it (decoded as it streams, not all at once); its level follows Music volume and Sounds volume.
  // MIDI files in Your music are played on the Instrument (their Auto instrument), a few seconds written ahead at a time.
  let ext = null;
  const EXT_GAIN = .55;
  function extLevel() { if (ext && ext.el && !ext.fading) ext.el.volume = Math.max(0, Math.min(1, ext.level * volume * EXT_GAIN)); }
  function extFade(el, from, to, ms, then) { const n = 8; let k = 0; const step = () => { k++; try { el.volume = Math.max(0, Math.min(1, from + (to - from) * k / n)); } catch {} if (k < n) setTimeout(step, ms / n); else if (then) then(); }; setTimeout(step, ms / n); }
  function extStop(quick) {
    if (!ext) return; const x = ext; ext = null; clearTimeout(x.midiT); x.stopped = true;
    if (x.el) { const el = x.el, url = x.url; extFade(el, el.volume, 0, quick ? 120 : 900, () => { try { el.pause(); el.removeAttribute('src'); el.load(); } catch {} if (url) URL.revokeObjectURL(url); }); }
  }
  async function extFile(x, bytes, midiFile, name) {
    if (x.stopped || ext !== x) return;
    if (midiFile) { // a MIDI song: its tune on the Instrument
      let sg; try { sg = Songs.parseMidi(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), name); } catch { x.next(); return; }
      const c = ensure(), plan = Songs.settingsFor(sg, null, 'piano'), times = Songs.timesOf(sg), t0 = c.currentTime + .3; let i = 0;
      const pump = () => { if (x.stopped || ext !== x) return; const until = c.currentTime + 2;
        while (i < plan.notes.length && t0 + times[i] < until) { const nx = times[i + 1] != null ? times[i + 1] - times[i] : .8; instNote(plan.notes[i], { inst: plan.inst, at: Math.max(0, t0 + times[i] - c.currentTime), vol: .26 * x.level * 2, dur: Math.max(.15, Math.min(1.2, nx)), fx: false, duck: 0 }); i++; }
        if (i < plan.notes.length) x.midiT = setTimeout(pump, 700); else x.midiT = setTimeout(() => x.next(), Math.max(800, (t0 + (times[times.length - 1] || 0) - c.currentTime) * 1000 + 1500)); };
      pump(); return;
    }
    const el = x.el || (x.el = new Audio()); if (x.url) URL.revokeObjectURL(x.url);
    x.url = URL.createObjectURL(new Blob([bytes])); el.src = x.url; el.loop = !!x.loop; el.volume = 0;
    if (typeof el.setSinkId === 'function' && sinkId) el.setSinkId(sinkId).catch(() => {});
    el.onended = () => { if (ext === x && !x.loop) x.next(); }; el.onerror = () => { if (ext === x && !x.loop) x.next(); };
    try { await el.play(); } catch { if (!x.loop) { x.next(); return; } }
    x.fading = true; extFade(el, 0, Math.max(0, Math.min(1, x.level * volume * EXT_GAIN)), 1500, () => { x.fading = false; extLevel(); });
  }
  function extStart(kind, id, level) {
    if (ext && ext.kind === kind && ext.id === id) { ext.level = level; extLevel(); return; }
    extStop(); const x = { kind, id, level, el: null, url: '', fails: 0, stopped: false, list: null, pos: -1 }; ext = x;
    const later = fn => { if (typeof window.BS_BUSY === 'function' && window.BS_BUSY()) setTimeout(() => later(fn), 300); else fn(); };
    if (kind === 'pack') {
      const meta = packMeta.find(p => p.id === id), f = meta && meta.matches && meta.matches.music; x.loop = true;
      if (!f || !loaders.packRead) return; later(() => loaders.packRead(id, f).then(b => extFile(x, b, false, f)).catch(() => {})); return;
    }
    x.next = () => { if (x.stopped || ext !== x || !x.list || !x.list.length) return; if (++x.fails > x.list.length + 2) return;
      x.pos = (x.pos + 1) % x.list.length; if (x.pos === 0) for (let i = x.list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x.list[i], x.list[j]] = [x.list[j], x.list[i]]; }
      const s = x.list[x.pos]; later(() => loaders.musicRead(s.file).then(b => { x.fails = 0; extFile(x, b, s.midi, s.name); }).catch(() => x.next())); };
    if (!loaders.musicList) return;
    loaders.musicList().then(L => { if (ext !== x) return; x.list = (L || []).slice(0, 500); if (!x.list.length) { ext = null; ambientStart({ track: 'drift', level: x.level }); return; } x.next(); }).catch(() => {});
  }
  // the music file of the pack playing on this console, when it has one
  const packMusic = () => { const meta = curPack && packMeta.find(p => p.id === curPack); return meta && meta.matches && meta.matches.music ? curPack : ''; };
  function ambientStart(opts) {
    const c = ensure(); if (!c || !enabled) return;
    const lv0 = Math.max(0, Math.min(1, opts && opts.level != null ? +opts.level : .4)), pm = opts && opts.track !== 'off' && !(opts && opts.preview) ? packMusic() : '';
    if (pm || (opts && opts.track === 'mine' && loaders.musicList)) { if (amb) ambientStop(false, true); extStart(pm ? 'pack' : 'mine', pm || 'mine', lv0); return; }
    if (ext) extStop();
    const tr = opts && (OLD_TRACK[opts.track] || opts.track), id = TRACKS[tr] ? tr : 'drift', level = lv0 * MUS_GAIN;
    if (amb && amb.id === id && amb.c === c) { const t = c.currentTime; amb.level = level; ambBus.gain.cancelScheduledValues(t); ambBus.gain.setTargetAtTime(level, t, .4); return; }
    if (amb) ambientStop();
    const m = musMake(c, id, ambBus, (Date.now() ^ Math.floor(Math.random() * 1e9)) | 0); amb = m; m.level = level;
    const t0 = c.currentTime; ambBus.gain.cancelScheduledValues(t0); ambBus.gain.setTargetAtTime(level, t0, .3);
    m.bus.gain.setValueAtTime(0, t0); m.bus.gain.linearRampToValueAtTime(1, t0 + 3);
    musPump();
  }
  function ambientStop(quick, keepExt) {
    if (ext && !keepExt) extStop(quick);
    if (!amb) return; const m = amb; amb = null; clearTimeout(m.timer); m.stopped = true;
    const t = m.c.currentTime; m.bus.gain.cancelScheduledValues(t); m.bus.gain.setValueAtTime(m.bus.gain.value, t); m.bus.gain.setTargetAtTime(0, t, quick ? .05 : .7);
    setTimeout(() => { m.pad.vs.forEach(os => os.forEach(o => { try { o.stop(); } catch {} })); m.nodes.forEach(n => { try { n.stop(); } catch {} }); try { m.bus.disconnect(); } catch {} }, quick ? 300 : 4000);
  }
  // tests and level checks: a few seconds of a track, rendered offline with a fixed seed (an AudioBuffer)
  async function renderMusic(id, seconds = 12, seed = 1, level = .4) {
    id = OLD_TRACK[id] || id; const Off = window.OfflineAudioContext; if (!Off || !TRACKS[id]) return null;
    const saved = { ctx, master, lim, verbIn, verbOut, dryBus, sat, ambBus };
    let off;
    try {
      off = ctx = new Off(2, Math.ceil(44100 * seconds), 44100);
      master = ctx.createGain(); master.gain.value = volume; lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = .002; lim.release.value = .09;
      dryBus = ctx.createGain(); verbIn = ctx.createGain(); verbOut = ctx.createGain(); verbOut.gain.value = .9; buildReverbNow();
      sat = ctx.createWaveShaper(); sat.curve = satCurve(1.15); ambBus = ctx.createGain(); ambBus.gain.value = level * MUS_GAIN;
      dryBus.connect(sat); verbOut.connect(sat); sat.connect(lim); lim.connect(master); master.connect(ctx.destination); ambBus.connect(lim);
      const av = ctx.createGain(); av.gain.value = AMB_VERB; ambBus.connect(av); av.connect(verbIn);
      const m = musMake(ctx, id, ambBus, seed); m.t0 = .05;
      while (m.next() < seconds) musStep(m);
    } finally { ({ ctx, master, lim, verbIn, verbOut, dryBus, sat, ambBus } = saved); }
    return off.startRendering();
  }
  // Museum room tone: the hush of a quiet gallery. Soft filtered air that slowly breathes, and a very faint warm
  // mains-and-lamps hum underneath. Fades in and out; it never plays outside the museum.
  let room = null;
  function roomStart(level) {
    const c = ensure(); if (!c || !enabled || room) return; const lv = level == null ? 1 : level; if (lv <= 0) return;
    const g = c.createGain(); g.gain.value = 0; g.connect(lim); const t0 = c.currentTime, nodes = [];
    const buf = c.createBuffer(2, c.sampleRate * 6, c.sampleRate);
    const lpf = c.createBiquadFilter(); lpf.type = 'lowpass'; lpf.frequency.value = 520; lpf.Q.value = .3;
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .045; lg.gain.value = 140; lfo.connect(lg); lg.connect(lpf.frequency);
    const ng = c.createGain(); ng.gain.value = .5; lpf.connect(ng); ng.connect(g);
    const hum = c.createOscillator(), hg = c.createGain(); hum.type = 'sine'; hum.frequency.value = 110; hg.gain.value = .035; hum.connect(hg); hg.connect(g);
    lfo.start(); hum.start(); nodes.push(lfo, hum);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.02 * lv, t0 + 2.5);
    room = { g, nodes };
    fillNoise(buf, .015, 7, () => { if (!room || room.nodes !== nodes) return; const src = c.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(lpf); src.start(); nodes.push(src); });
  }
  function roomStop(quick) {
    if (!room) return; const r = room; room = null; const t = ctx.currentTime;
    r.g.gain.cancelScheduledValues(t); r.g.gain.setTargetAtTime(0, t, quick ? .05 : .5);
    setTimeout(() => { r.nodes.forEach(n => { try { n.stop(); } catch {} }); try { r.g.disconnect(); } catch {} }, quick ? 250 : 2200);
  }
  // museum: a case sliding back into its gap (the slide, softer and downward), and the console's pedestal: a short warm
  // three-note rise, like a system powering up (an original motif, not any console's real start-up sound)
  S.slideBack = () => { air({ dur: .2, vol: .1, filter: 'bandpass', freq: 1300, sweepTo: 800, q: .9, verb: .3, attack: .015, soft: true }); hit({ freq: deg(-7, -1), dur: .07, vol: .07, at: .15, noise: .4, breath: 0, verb: .25 }); };
  // hands-on in the museum: lifting a case off the shelf (a soft rising slide), and setting the disc back on its hub
  S.lift = () => { air({ dur: .26, vol: .12, filter: 'bandpass', freq: 700, sweepTo: 1500, q: .8, verb: .3, attack: .03, soft: true }); hit({ freq: deg(2), dur: .12, vol: .07, at: .14, verb: .3, attack: .01, breath: .2 }); };
  S.discIn = () => { hit({ freq: deg(7), dur: .1, vol: .14, noise: .3, attack: .004, breath: 0 }); hit({ freq: deg(0), dur: .18, vol: .12, at: .08, attack: .006, thump: 1.3, breath: 0 }); };
  S.pedestal = () => { [0, 4, 7].forEach((n, i) => hit({ freq: deg(n), dur: .5 + i * .1, vol: .12, at: i * .09, verb: .7, attack: .006, breath: .2, pan: (i - 1) * .15, duck: .1 })); hit({ freq: deg(0, -1), dur: 1.2, vol: .07, at: .25, verb: .9, attack: .05, breath: .3 }); };
  // ---------------- Melody: songs played one note per move ----------------
  let song = null, songIdx = 0, songAt = 0, songLoops = 0, lastNote = 0, userSongs = [], useBuiltIn = true, songOrder = [], songPos = -1;
  const SONG_MINUTES = 3;
  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  function pool() { const b = (window.Songs && Songs.builtIn) || []; const all = [...(useBuiltIn || !userSongs.length ? b : []), ...userSongs], L = all.length ? all : b;
    // (beta.14) the Instrument's chosen song ('' = all of them, shuffled as before)
    const want = theme === 'instrument' && iNow().song; if (want) { const one = [...b, ...userSongs].find(s => s.name === want); if (one) return [one]; }
    return L; }
  // (beta.14) a song's notes and instrument on the Instrument: Auto (from the file) or set by hand (Songs.settingsFor)
  const songSet = new WeakMap();
  function songPlan(sg) {
    const ii = iNow(), per = (ii.songs && ii.songs[sg.name]) || null, sig = JSON.stringify(per) + '|' + ii.inst; let x = songSet.get(sg);
    if (!x || x.sig !== sig) { x = { sig, plan: window.Songs && Songs.settingsFor ? Songs.settingsFor(sg, per, ii.inst) : { inst: ii.inst, notes: sg.notes, rate: 1 } }; songSet.set(sg, x); }
    return x.plan;
  }
  const songNote = (sg, i) => theme === 'instrument' ? songPlan(sg).notes[i] : sg.notes[i];
  function shuffleOrder() { const p = pool(); songOrder = p.map((_, i) => i); for (let i = songOrder.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [songOrder[i], songOrder[j]] = [songOrder[j], songOrder[i]]; }
    if (song && songOrder.length > 1 && p[songOrder[0]] === song) songOrder.push(songOrder.shift()); songPos = -1; }
  // move on to another song (every few minutes, a new console shelf, coming back from a game); never the same one twice running
  function nextSong(reason) {
    const p = pool(); if (!p.length) return null;
    if (songPos + 1 >= songOrder.length || songOrder.length !== p.length) shuffleOrder();
    songPos++; song = p[songOrder[songPos]] || p[0]; songIdx = 0; songLoops = 0; songAt = clock();
    try { window.dispatchEvent(new CustomEvent('bs-song', { detail: { name: song.name, hue: song.hue, reason: reason || '' } })); } catch {}
    return song.name;
  }
  function curSong() { if (!song) nextSong('start'); return song; }
  const chordAt = i => { const sg = curSong(); return sg.chords[Math.max(0, Math.min(sg.chords.length - 1, i))] || { root: 0, minor: false }; };
  // the chord under the tune right now, as piano notes around middle C (root position, close voicing)
  function triad(oct) { const c = chordAt(songIdx - 1 < 0 ? 0 : songIdx - 1), r = 48 + 12 * (oct || 0) + c.root; return [r, r + (c.minor ? 3 : 4), r + 7]; }
  function piano(m, o = {}) { const v = (o.vol == null ? .26 : o.vol) * .45;
    if (theme === 'instrument') { instNote(m, Object.assign({}, o, { vol: v * 2.2, inst: songPlan(curSong()).inst, dur: Math.min(1.2, o.dur || .6) })); return; }
    hit(Object.assign({ freq: mf(m), dur: .95, attack: .003, verb: .5, pan: Math.max(-.5, Math.min(.5, (m - 72) / 30)), duck: .1 }, o, { vol: v })); }
  // the bass when a bar changes: the chord root low and soft, with its octave, so the tune has harmony under it
  function bassFor(i) { if (theme === 'instrument' && !['piano', 'harp', 'marimba'].includes(songPlan(curSong()).inst)) return; /* (a held instrument plays the tune alone) */ const c = chordAt(i), r = 36 + c.root + (c.root < 5 ? 12 : 0); piano(r, { dur: 1.9, vol: .15, bright: 1100, verb: .55, attack: .006, noise: 0, fx: false, pan: -.1 }); piano(r + 12, { dur: 1.6, vol: .08, bright: 1500, at: .01, attack: .008, noise: 0, fx: false }); }
  const M = {
    tick() {
      const t = clock(), sg = curSong();
      // held scrolling sends a tick every ~45 ms: the tune keeps its own pace (one note per ~110 ms) instead of racing
      if (t - lastNote < 110) return; const gap = t - lastNote; lastNote = t;
      // a few minutes on one song: change at the next bar, so the switch lands on a downbeat
      if (t - songAt > SONG_MINUTES * 60000 && sg.bars.includes(songIdx)) nextSong('time');
      const s2 = curSong(); if (songIdx >= s2.notes.length) { songIdx = 0; if (++songLoops >= 3) nextSong('loops'); }
      const s3 = curSong(), i = songIdx++, bar = s3.bars.includes(i);
      // quick runs play lighter, a slow deliberate step a little fuller; the first note of a bar leans in
      const v = (gap < 200 ? .22 : .28) + (bar ? .04 : 0) + (Math.random() - .5) * .02;
      piano(songNote(s3, i), { vol: v, dur: gap < 200 ? .7 : 1.05 });
      if (bar || i === 0) bassFor(i);
    },
    shelf(o) {
      // a new shelf starts a new song: its opening chord rolls in under the first notes
      const t = clock(), quick = t - lastShelf < 600; lastShelf = t;
      if (quick) { piano(songNote(curSong(), 0) + 12, { vol: .3, dur: .5 }); return; }
      const sg = curSong(); lastNote = 0; songIdx = 0; const c = sg.chords[0], r = 48 + c.root;
      [r, r + (c.minor ? 3 : 4), r + 7, r + 12].forEach((m, k) => piano(m, { at: k * .045, vol: .22, dur: 1.4, bright: 2600 }));
      piano(songNote(sg, 0), { at: .2, vol: .32, dur: 1.2 });
    },
    open() { const [a, b, c] = triad(1); piano(a, { vol: .18, dur: .8 }); piano(b, { at: .05, vol: .17, dur: .8 }); piano(c, { at: .1, vol: .2, dur: 1 }); },
    back() { const [a, , c] = triad(1); piano(c, { vol: .2, dur: .6 }); piano(a, { at: .07, vol: .18, dur: .9, bright: 2400 }); },
    go() { const [a, b, c] = triad(0); [a, b, c, a + 12, b + 12, c + 12, a + 24].forEach((m, k) => piano(m, { at: k * .055, vol: .2 - k * .01, dur: 1.6, verb: .65 })); piano(a - 12, { at: .02, vol: .16, dur: 2.2, bright: 1200, verb: .6 }); swell({ notes: [0, 4], octave: -1, dur: 1.4, vol: .1, at: .2, attack: .4 }); },
    flip() { const [, b] = triad(1); air({ dur: .22, vol: .16, filter: 'bandpass', freq: 2000, sweepTo: 500, q: .6, verb: .4, soft: true }); piano(b, { at: .1, vol: .14, dur: .6 }); },
    toast() { const [, b, c] = triad(1); piano(c + 12, { vol: .15, dur: .9, verb: .6 }); piano(b + 12, { at: .06, vol: .12, dur: .9, verb: .6 }); },
    error() { const [a] = triad(0); piano(a + 1, { vol: .42, dur: .5, bright: 1800 }); piano(a, { at: .12, vol: .38, dur: .8, bright: 1600 }); },
    unlock() { const [a, b, c] = triad(1); [a, b, c, a + 12, c, a + 12, b + 12, c + 12].forEach((m, k) => piano(m, { at: k * .07, vol: .18, dur: 1.2, verb: .7 })); piano(a + 24, { at: .6, vol: .15, dur: 2, verb: .8 }); },
    boot() { bootSig(); },
    museum() { const [a, b, c] = triad(0); [a, b, c, a + 12, b + 12, c + 12, a + 24].forEach((m, k) => piano(m, { at: k * .09, vol: .15, dur: 1.8, verb: .75 })); },
    pedestal() { const [a, b, c] = triad(1); [a, b, c].forEach((m, k) => piano(m, { at: k * .1, vol: .12, dur: 1.2, verb: .7 })); },
    hold() { piano(songNote(curSong(), 0) + 12, { vol: .1, dur: .25, fx: false }); },
  };
  // ---------------- Music box ----------------
  const tine = (n, o = {}) => hit(Object.assign({ freq: deg(n), dur: .7, pan: Math.max(-.4, Math.min(.4, n * .05)), duck: .1 }, o, { vol: (o.vol == null ? .3 : o.vol) * .48 }));
  const B = {
    tick(o) { const n = walk(o), h = boxTick(n, .3 + (Math.random() - .5) * .03, (Math.random() - .5) * .25); if (!bakedHit(h, 'm' + n)) hit(h); },
    shelf(o) { if (shelfQuick(o)) return; tine(0, { dur: .9, vol: .26 }); tine(4, { at: .09, dur: 1, vol: .24 }); tine(7, { at: .18, dur: 1.2, vol: .2 }); },
    open() { tine(2, { dur: .6, vol: .28 }); tine(4, { at: .07, dur: .8, vol: .26 }); },
    back() { tine(4, { dur: .5, vol: .26 }); tine(1, { at: .07, dur: .8, vol: .24, bright: 3800 }); },
    go() { [0, 2, 4, 7].forEach((n, i) => tine(n, { at: i * .08, dur: 1, vol: .26 })); tine(9, { at: .34, dur: 1.8, vol: .26, verb: .7 }); tine(0, { at: .34, dur: 2, vol: .16, verb: .7, octave: 0, freq: deg(0, -1) }); swell({ notes: [0, 4], octave: -1, dur: 1.4, vol: .1, at: .3, attack: .4 }); },
    flip() { air({ dur: .2, vol: .14, filter: 'bandpass', freq: 2400, sweepTo: 700, q: .6, verb: .4, soft: true }); tine(-1, { at: .1, dur: .5, vol: .2 }); },
    toast() { tine(7, { dur: .8, vol: .22, verb: .65 }); tine(9, { at: .07, dur: .9, vol: .18, verb: .65 }); },
    error() { tine(-2, { dur: .6, vol: .26, bright: 3000 }); tine(-3, { at: .14, dur: .8, vol: .24, bright: 2800 }); },
    unlock() { [0, 2, 4, 7, 9, 7, 9, 11].forEach((n, i) => tine(n, { at: i * .075, dur: 1.1, vol: .22, verb: .7 })); tine(14, { at: .62, dur: 2, vol: .2, verb: .8 }); },
    boot() { bootSig(); },
    museum() { [0, 2, 4, 7, 9, 11, 9, 7].forEach((n, i) => tine(n, { at: i * .1, dur: 1.2, vol: .18, verb: .7 })); tine(4, { at: .85, dur: 2, vol: .16, verb: .8 }); },
    hold() { tine(9, { dur: .2, vol: .14, fx: false }); },
  };
  // ---------------- (beta.14) Disc-era, Handheld, Living room ----------------
  // Disc-era: glassy FM bells (a sine bent by a sine, bright at the strike), a breath of air and a big room
  const bellNote = (n, o = {}) => fm(Object.assign({ freq: deg(n), dur: .5, vol: .2, ratio: 3.5, index: 1.4, floor: .1, verb: .6, attack: .003 }, o));
  const D = {
    tick(o) { const n = walk(o); bellNote(2 + n, { dur: .2, vol: .22, index: 1, pan: (Math.random() - .5) * .25, verb: .45 }); },
    shelf(o) { if (shelfQuick(o)) return; air({ dur: .45, vol: .12, filter: 'bandpass', freq: 700, sweepTo: 5200, q: .5, verb: .8, attack: .1, soft: true }); bellNote(0, { at: .03, dur: .6, vol: .16, pan: -.25 }); bellNote(4, { at: .13, dur: .8, vol: .14, pan: .25 }); },
    open() { bellNote(2, { dur: .4, vol: .2 }); bellNote(4, { at: .06, dur: .7, vol: .17, pan: .2, detune: 4 }); },
    back() { bellNote(4, { dur: .3, vol: .18 }); bellNote(1, { at: .07, dur: .55, vol: .16, pan: -.2, index: .8 }); },
    go() { [0, 2, 4, 7].forEach((n, i) => bellNote(n, { at: i * .08, dur: 1.1, vol: .17, pan: (i - 1.5) * .2, detune: 3 })); pad({ freqs: [deg(0, -2), deg(2, -2), deg(4, -2)], dur: 2, vol: .22, from: 250, to: 2600, open: .9, attack: .5, hold: 1 }); },
    flip() { air({ dur: .26, vol: .2, filter: 'bandpass', freq: 2800, sweepTo: 600, q: .6, verb: .5, soft: true }); bellNote(-2, { at: .1, dur: .3, vol: .12 }); },
    error() { fm({ freq: deg(-6), dur: .35, vol: .24, ratio: 1.41, index: 2.5, floor: .3, verb: .35 }); fm({ freq: deg(-7), at: .15, dur: .45, vol: .2, ratio: 1.41, index: 2.2, floor: .3, verb: .35 }); },
    toast() { bellNote(7, { dur: .6, vol: .15, pan: .4, verb: .7 }); bellNote(9, { at: .07, dur: .8, vol: .12, pan: .4, verb: .75 }); },
    unlock() { [0, 2, 4, 7, 9].forEach((n, i) => bellNote(n, { at: i * .07, dur: .9, vol: .15, pan: (i - 2) * .18, verb: .7 })); bellNote(12, { at: .4, dur: 1.6, vol: .13, verb: .85, detune: 4 }); },
    hold() { bellNote(9, { dur: .12, vol: .08, verb: .3 }); },
    boot() { bootSig(); },
  };
  // Handheld: a pulse wave, short blips that chirp upwards, next to no room
  const chirp = (n, o = {}) => hit(Object.assign({ freq: deg(n), dur: .06, vol: .2, wave: 'square', partials: [[1, 1, 1]], bright: 3800, verb: .05, thump: .94, noise: 0, breath: 0, attack: .002, duck: .1 }, o));
  const HH = {
    tick(o) { const n = walk(o); chirp(2 + n, { dur: .035, vol: .3, pan: (Math.random() - .5) * .2 }); },
    shelf(o) { if (shelfQuick(o)) return; chirp(0, { dur: .05 }); chirp(2, { at: .05, dur: .05 }); chirp(4, { at: .1, dur: .08 }); },
    open() { chirp(2, { dur: .05 }); chirp(5, { at: .055, dur: .09 }); },
    back() { chirp(5, { dur: .05 }); chirp(2, { at: .055, dur: .09, bright: 3000 }); },
    go() { [0, 2, 4, 5, 7].forEach((n, i) => chirp(n, { at: i * .055, dur: .07, vol: .18 })); chirp(10, { at: .3, dur: .3, vol: .17 }); },
    flip() { chirp(3, { dur: .04, glide: deg(0), glideTime: .04 }); },
    error() { chirp(-5, { dur: .12, vol: .22, bright: 1800 }); chirp(-6, { at: .13, dur: .16, vol: .22, bright: 1600 }); },
    toast() { chirp(7, { dur: .05 }); chirp(9, { at: .06, dur: .1 }); },
    unlock() { [0, 2, 4, 7, 9, 12].forEach((n, i) => chirp(n, { at: i * .05, dur: .06, vol: .16 })); chirp(14, { at: .32, dur: .35, vol: .15 }); },
    hold() { chirp(9, { dur: .025, vol: .1 }); },
    boot() { bootSig(); },
  };
  // Living room: warm round triangles with a soft low octave under the bigger moments
  const round = (n, o = {}) => hit(Object.assign({ freq: deg(n), dur: .3, vol: .3, attack: .008 }, o));
  const LV = {
    tick(o) { const n = walk(o); round(2 + n, { dur: .11, vol: .26, pan: (Math.random() - .5) * .2, verb: .3, duck: .12 }); },
    shelf(o) { if (shelfQuick(o)) return; air({ dur: .3, vol: .1, filter: 'bandpass', freq: 500, sweepTo: 1800, q: .6, verb: .5, soft: true }); round(0, { at: .03, dur: .4, vol: .24, pan: -.2, sub: .3 }); round(4, { at: .12, dur: .5, vol: .22, pan: .2 }); },
    open() { round(2, { dur: .28, vol: .28 }); round(4, { at: .07, dur: .45, vol: .24, pan: .15 }); },
    back() { round(3, { dur: .22, vol: .26 }); round(0, { at: .07, dur: .4, vol: .22, pan: -.15, bright: 1800 }); },
    go() { [0, 2, 4].forEach((n, i) => round(n, { at: i * .1, dur: .7 + i * .15, vol: .26, pan: (i - 1) * .2, sub: .3 })); swell({ notes: [0, 2, 4], octave: -1, dur: 1.4, vol: .16, at: .15, attack: .35 }); },
    flip() { air({ dur: .2, vol: .14, filter: 'bandpass', freq: 1400, sweepTo: 450, q: .7, verb: .3, soft: true }); round(-2, { at: .1, dur: .16, vol: .2 }); },
    error() { round(-6, { dur: .3, vol: .3, bright: 1200, sub: .4 }); round(-7, { at: .14, dur: .4, vol: .26, bright: 1000 }); },
    toast() { round(5, { dur: .35, vol: .22, verb: .55, pan: .35 }); },
    unlock() { [0, 2, 4, 7].forEach((n, i) => round(n, { at: i * .09, dur: .6, vol: .22, verb: .6, pan: (i - 1.5) * .2 })); round(9, { at: .4, dur: 1.2, vol: .18, verb: .7 }); },
    hold() { round(7, { dur: .05, vol: .14 }); },
    boot() { bootSig(); },
  };

  // ---------------- (beta.14) the Instrument ----------------
  // ui.instrument: { inst, src: 'built' | 'real', key (-12..12), mood, mode: 'notes' | 'song', song ('' = all, shuffled), songs: { name: { mode, inst, speed, key } } }
  let instCfg = { inst: 'harp', src: 'built', key: 0, mood: 'calm', mode: 'notes', song: '', songs: {} }, instOver = null;
  const iNow = () => instOver ? Object.assign({}, instCfg, instOver) : instCfg;
  const MOODS = { happy: [0, 2, 4, 5, 7, 9, 11], calm: [0, 2, 4, 7, 9], sad: [0, 2, 3, 5, 7, 8, 10], dreamy: [0, 2, 4, 7, 11] };
  const iRoot = () => 72 + (+iNow().key || 0) + keyShift;
  function iDeg(n, oct = 0) { const s = MOODS[iNow().mood] || MOODS.calm, o = Math.floor(n / s.length), i = ((n % s.length) + s.length) % s.length; return iRoot() + s[i] + 12 * (o + oct); }
  const SONG_RANGE = () => (window.Songs && Songs.RANGE) || {};
  // one note on the instrument (vol in the same units as hit()); notes outside the instrument's range move by octaves
  function instNote(m, o = {}) {
    const c = ensure(); if (!c || !enabled || !window.BS_INST) return;
    const ii = iNow(), inst = o.inst || ii.inst, r = SONG_RANGE()[inst] || [36, 100];
    let n = Math.round(m); while (n < r[0] - 5) n += 12; while (n > r[1] + 5) n -= 12;
    if (!lite && o.duck !== 0) duck(.12, 400);
    const at = o.at || 0, out = bus(o.verb != null ? o.verb : (BS_INST.ROOM[inst] || .4), o.pan != null ? o.pan : Math.max(-.4, Math.min(.4, (n - 72) / 30)));
    if (o.fx !== false && !lite) noteFx(midi(n), o.vol == null ? .3 : o.vol, at);
    BS_INST.play(c, out, inst, n, now() + at, { vol: (o.vol == null ? .3 : o.vol) * TRIM * 1.4, dur: o.dur || .5, real: ii.src === 'real' });
  }
  const songOn = () => theme === 'instrument' && iNow().mode === 'song';
  const I = {
    tick(o) { const n = walk(o); instNote(iDeg(2 + n), { vol: .26, dur: .45 }); },
    shelf(o) { const t = clock(), quick = t - lastShelf < 600; lastShelf = t; if (quick) { instNote(iDeg(4), { vol: .26, dur: .3 }); return; } instNote(iDeg(0), { vol: .3, dur: .6 }); instNote(iDeg(4), { at: .09, vol: .26, dur: .7 }); },
    open() { const r = iRoot(), th = iNow().mood === 'sad' ? 3 : 4; [0, th, 7].forEach((s, k) => instNote(r + s, { at: k * .028, vol: .24, dur: .6 })); },
    back() { const r = iRoot(); instNote(r + 7, { vol: .26, dur: .3 }); instNote(r, { at: .15, vol: .24, dur: .6 }); },
    go() { const r = iRoot(), th = iNow().mood === 'sad' ? 3 : 4; [0, th, 7, 12].forEach((s, k) => instNote(r + s, { at: k * .09, vol: .26, dur: .9 })); swell({ notes: [0, 4], octave: -1, dur: 1.4, vol: .1, at: .2, attack: .4 }); },
    error() { const r = iRoot(); instNote(r - 11, { vol: .22, dur: .35 }); instNote(r - 12, { at: .13, vol: .2, dur: .6 }); },
    flip() { air({ dur: .22, vol: .16, filter: 'bandpass', freq: 2000, sweepTo: 500, q: .6, verb: .4, soft: true }); instNote(iDeg(-1), { at: .1, vol: .18, dur: .4 }); },
    toast() { const r = iRoot(); instNote(r + 19, { vol: .2, dur: .6, verb: .6 }); instNote(r + 24, { at: .07, vol: .16, dur: .7, verb: .6 }); },
    unlock() { const r = iRoot(); [0, 4, 7, 12, 16, 19].forEach((s, k) => instNote(r + s, { at: k * .07, vol: .2, dur: .9 })); instNote(r + 24, { at: .5, vol: .16, dur: 1.4 }); },
    museum() { [0, 1, 2, 3, 4, 5, 6].forEach((n, k) => instNote(iDeg(n, -1), { at: k * .09, vol: .17, dur: 1 })); },
    pedestal() { const r = iRoot(); [0, 4, 7].forEach((s, k) => instNote(r + s, { at: k * .1, vol: .14, dur: .9 })); },
    hold() { instNote(iRoot() + 24, { vol: .1, dur: .15, fx: false }); },
    boot() { bootSig(); },
    // (Settings' Instrument page: one step of the scale, n)
    note(o) { instNote(iDeg(o && o.n || 0), { vol: .32, dur: .6 }); },
  };

  // ---------------- (beta.14) sound packs ----------------
  // Each moment of the menu plays one of the pack's files; the cues a pack has no file for play Aero's.
  const MOMENT = { tick: 'move', flip: 'move', shelf: 'move', open: 'open', panel: 'open', caseOpen: 'open', back: 'back', go: 'play', boot: 'play', error: 'problem' };
  const PACK_MOMENTS = ['move', 'open', 'back', 'play', 'problem'];
  let packMeta = [], loaders = {}, curPack = '', lastPackTick = 0;
  const packs = new Map(); // id -> { sig, state: 'idle' | 'loading' | 'ready', bufs: {}, gain: {} }
  const idleWait = () => new Promise(res => { const go = () => { if (typeof window.BS_BUSY === 'function' && window.BS_BUSY()) { setTimeout(() => idle(go, 1500), 200); return; } res(); }; idle(go, 1500); });
  function packLoad(id) {
    const meta = packMeta.find(x => x.id === id); if (!meta || !loaders.packRead) return null;
    const sig = JSON.stringify(meta.matches); let P = packs.get(id);
    if (P && P.sig === sig) return P;
    P = { sig, state: 'loading', bufs: {}, gain: {} }; packs.set(id, P);
    (async () => {
      for (const mo of PACK_MOMENTS) { const f = meta.matches && meta.matches[mo]; if (!f) continue;
        await idleWait(); if (packs.get(id) !== P) return;
        try { const c = ensure(); if (!c) break; const b = await loaders.packRead(id, f), u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
          const buf = await c.decodeAudioData(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength));
          const d = buf.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i += 2) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
          P.bufs[mo] = buf; P.gain[mo] = Math.min(4, .5 / Math.max(.02, pk)); } catch (e) { console.warn('sound pack', id, f, e && e.message); } }
      P.state = 'ready';
    })();
    return P;
  }
  // play cue `name` from the current pack: false = it has no sound for that (or isn't ready yet), play the usual one
  function packPlay(name, o) {
    const mo = MOMENT[name]; if (!mo) return false;
    const P = packs.get(curPack) || packLoad(curPack); if (!P || !P.bufs[mo]) return false;
    if (name === 'tick') { const t = performance.now(); if (t - lastPackTick < 40) return true; lastPackTick = t; }
    const c = ensure(); if (!c || !enabled) return true;
    const buf = P.bufs[mo], src = c.createBufferSource(), g = c.createGain(), out = bus(.14, name === 'tick' ? (Math.random() - .5) * .15 : (o && o.dir < 0 ? -.1 : 0));
    src.buffer = buf; g.gain.value = P.gain[mo] * TRIM * 1.6; src.connect(g); g.connect(out); src.start(now());
    src.onended = () => { try { g.disconnect(); out.disconnect(); } catch {} };
    if (!lite) duck(.3, Math.min(2, buf.duration) * 1000 + 150);
    return true;
  }
  const packVoice = name => o => { if (packPlay(name, o)) return; const f = A[name] || S[name]; if (f) f(o); };

  // ---------------- which sound plays where ----------------
  // ui.soundTheme (everywhere), ui.soundByShelf (a console's own), and packs set to "only on some consoles"
  let mainId = 'aero', byShelf = {}, shelfId = '';
  const VOICES = ['aero', 'instrument', 'disc', 'handheld', 'living'];
  const packIdOf = id => /^kenney-[a-z]+$/.test(id) ? id : /^pack:/.test(id) ? id.slice(5) : '';
  // a sound id as the voice that plays it: { voice, pack, over (instrument settings it forces) }
  function resolve(id) {
    id = String(id || 'aero'); id = ALIAS[id] || id;
    if (id === 'off') return { voice: 'off' };
    if (id === 'melody') return { voice: 'instrument', over: instCfg.set ? { mode: 'song' } : { inst: 'piano', mode: 'song', song: '' } };
    if (id === 'musicbox') return { voice: 'instrument', over: { inst: 'box', mode: 'notes', mood: 'calm' } };
    const im = /^instrument:([a-z]+)$/.exec(id); if (im) return { voice: 'instrument', over: { inst: im[1] } };
    if (VOICES.includes(id)) return { voice: id };
    const p = packIdOf(id); if (p && packMeta.some(x => x.id === p)) return { voice: 'pack', pack: p };
    return { voice: 'aero' };
  }
  const shelfSound = sid => { if (sid && byShelf[sid]) return byShelf[sid]; const p = sid && packMeta.find(x => Array.isArray(x.where) && x.where.includes(sid)); return p ? (p.kenney ? p.id : 'pack:' + p.id) : mainId; };
  function applyActive() {
    const r = resolve(shelfSound(shelfId)), was = theme;
    theme = r.voice; curPack = r.pack || ''; instOver = r.over || null;
    if (curPack) packLoad(curPack);
    if (theme === 'instrument' && window.BS_INST && ctx) BS_INST.prime(ctx, iNow().inst, [0, 1, 2, 3, 4, 5, 6].map(n => iDeg(n)));
    if (theme === 'instrument' && iNow().src === 'real') realLoad(iNow().inst);
    return was !== theme;
  }
  // the packs any setting points at are made ready ahead, in idle time (a pack's few files decoded once)
  function preloadPacks() { const ids = new Set([mainId, ...Object.values(byShelf)].map(packIdOf).filter(Boolean)); packMeta.forEach(p => { if (Array.isArray(p.where)) ids.add(p.id); }); ids.forEach(id => packLoad(id)); }
  // ---- real instruments: each instrument's recorded notes, decoded the first time it plays ----
  const realState = {}; let realHave = {};
  function realLoad(inst) {
    if (!loaders.instRead || !realHave[inst] || realState[inst]) return; realState[inst] = 'loading';
    (async () => { const list = [];
      for (const m of realHave[inst]) { await idleWait(); try { const c = ensure(); const b = await loaders.instRead(inst, m), u8 = b instanceof Uint8Array ? b : new Uint8Array(b); list.push({ midi: m, buf: await c.decodeAudioData(u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)) }); } catch (e) { console.warn('instrument sample', inst, m, e && e.message); } }
      if (window.BS_INST) BS_INST.setBank(inst, list); realState[inst] = list.length ? 'ready' : '';
    })();
  }
  // ---- the lists Settings and the quick menu show ----
  const BUILT = [['aero', 'Aero', 'Soft and airy'], ['instrument', 'Instrument', 'Notes as you move'], ['disc', 'Disc-era', 'Glassy, late-90s'], ['handheld', 'Handheld', 'Small and chirpy'], ['living', 'Living room', 'Warm and round']];
  const KENNEY = [['kenney-clicky', 'Clicky', 'Crisp clicks', '0.4 MB'], ['kenney-soft', 'Soft UI', 'Gentle taps', '0.8 MB'], ['kenney-arcade', 'Arcade', 'Chunky retro', '1.0 MB']];
  function choices() {
    return [...BUILT.map(([id, name, sub]) => ({ id, name, sub, group: 'built', ready: true })),
      ...KENNEY.map(([id, name, sub, size]) => ({ id, name, sub, size, group: 'kenney', ready: packMeta.some(p => p.id === id) })),
      ...packMeta.filter(p => !p.kenney).map(p => ({ id: 'pack:' + p.id, name: p.name, sub: Array.isArray(p.where) ? 'Some consoles' : 'Everywhere', group: 'yours', ready: true }))];
  }
  function nameOf(id) {
    id = ALIAS[id] || String(id || 'aero'); if (id === 'off') return 'Off'; if (id === 'melody' || id === 'musicbox') return 'Instrument';
    const im = /^instrument:([a-z]+)$/.exec(id); if (im) { const x = window.BS_INST && BS_INST.LIST.find(l => l[0] === im[1]); return 'Instrument · ' + (x ? x[1] : im[1]); }
    const c = choices().find(x => x.id === id); return c ? c.name : 'Aero';
  }
  const musicChoices = () => [['drift', 'Drift'], ['night', 'Night'], ['glow', 'Glow'], ...(loaders.musicList ? [['mine', 'Your music']] : []), ['off', 'Off']].map(([id, name]) => ({ id, name }));

  function voiceFor(name) {
    if (theme === 'off') return null;
    if (theme === 'pack') return packVoice(name);
    if (theme === 'instrument') return (songOn() && M[name]) || I[name] || A[name] || S[name];
    if (theme === 'disc') return D[name] || A[name] || S[name];
    if (theme === 'handheld') return HH[name] || S[name];
    if (theme === 'living') return LV[name] || A[name] || S[name];
    if (theme === 'melody') return M[name] || A[name] || S[name]; if (theme === 'musicbox') return B[name] || S[name]; return (theme === 'aero' && A[name]) ? A[name] : S[name]; }
  function play(name, o) {
    try {
      // Android: a held direction sends a tick every ~45 ms. Play at most one per ~70 ms, and while ticks come close
      // together (held, or the museum's thinned top speed) skip the extras: the ambient duck and the 'bs-note' event.
      if (BAKE && name === 'tick') { const t = performance.now(), gap = t - tickPlayAt; if (gap < 70) return; lite = gap < 130; tickPlayAt = t; }
      const fn = voiceFor(name); if (fn) fn(o || {});
    } catch (e) { console.warn('sound', name, e); } finally { lite = false; }
  }
  // your MIDI songs from the Songs folder (main lists them, we read the notes here); quietly skips files it can't read
  async function loadSongs(api, builtIn) {
    useBuiltIn = builtIn !== false; const out = [], bad = [];
    try { const list = (api && api.songs) ? await api.songs() : [];
      for (const s of list.slice(0, 120)) { try { const b = await api.songRead(s.file); out.push(Songs.parseMidi(b instanceof Uint8Array ? b : new Uint8Array(b), s.name)); } catch (e) { bad.push(s.name); } } } catch {}
    userSongs = out; songOrder = []; songPos = -1; if (!song || !pool().includes(song)) nextSong('list');
    return { songs: out.length, skipped: bad };
  }
  // ---------------- Android: ticks from pre-rendered buffers ----------------
  // A live tick builds ~20 audio nodes (partials, filter, panners, two noise layers), and every node creation takes the
  // audio graph lock on the main thread: on the Thor that was the biggest cost of each shelf / museum step when scrolling
  // fast. So on Android each tick take (Aero: 3 takes x 7 steps of the figure; Music box: 7 steps) is rendered once,
  // offline, in idle time, into one buffer (left channel = the dry sound, right = what it sends to the reverb, both
  // before panning). A tick is then one buffer source into a persistent gain -> splitter -> two panners -> the same
  // dry bus and reverb as before, so it sounds the same. Until the buffers are ready (or for Melody) the live synth plays.
  // One bank per voice + shelf key; the last three are kept (about 2 MB each).
  const BAKE = !!(window.bsPlatform && window.bsPlatform.os === 'android' && window.OfflineAudioContext);
  let bakeOn = BAKE, baking = false, lite = false, tickPlayAt = 0;
  const banks = [], chains = new WeakMap(), TICK_SLOT = { aero: .25, musicbox: .8 };
  const bankId = () => theme + '|' + keyShift + '|' + (keyScale ? keyScale.join(',') : '');
  function tickRecipes(th) {
    const out = [];
    for (let n = -2; n <= 4; n++) { if (th === 'aero') for (let v = 0; v < 3; v++) out.push(['a' + v + '|' + n, aeroTick(n, v, 1, 0)]); else out.push(['m' + n, boxTick(n, .3, 0)]); }
    return out;
  }
  function primeTicks() {
    if (!bakeOn || !ctx || baking || !TICK_SLOT[theme] || (window.OfflineAudioContext && ctx instanceof OfflineAudioContext)) return;
    const id = bankId(); if (banks.some(b => b.id === id)) return;
    const b = { id, theme, slot: TICK_SLOT[theme], slots: new Map(), list: tickRecipes(theme), buf: null };
    banks.unshift(b); if (banks.length > 3) banks.pop();
    const live = ctx; let off = null, dry, wet, i = 0;
    const step = dl => {
      if (!banks.includes(b) || ctx !== live) return; // flicked past this shelf already, or the engine changed
      if (!off) {
        airNoise(live); if (!airBufs.hard.length || !airBufs.soft.length) { idle(step, 3000); return; } // (its breaths need the noise, made in idle time on Android)
        off = new OfflineAudioContext(2, Math.ceil(live.sampleRate * b.slot * b.list.length), live.sampleRate);
        dry = off.createGain(); wet = off.createGain(); const mg = off.createChannelMerger(2); dry.connect(mg, 0, 0); wet.connect(mg, 0, 1); mg.connect(off.destination);
      }
      // build a few takes per idle slice into the offline context (same hit() code, nothing panned), then render it
      const t0 = performance.now(), budget = Math.max(3, Math.min(8, dl && dl.timeRemaining ? dl.timeRemaining() : 5));
      const sv = { dryBus, verbIn, amb, airCtx, theme, enabled, atBase };
      ctx = off; dryBus = dry; verbIn = wet; amb = null; airCtx = off; theme = b.theme; enabled = true; baking = true;
      try { do { const [sid, o] = b.list[i]; atBase = i * b.slot; hit(o); b.slots.set(sid, { base: o, off: i * b.slot }); i++; } while (i < b.list.length && performance.now() - t0 < budget); }
      finally { ctx = live; ({ dryBus, verbIn, amb, airCtx, theme, enabled, atBase } = sv); baking = false; }
      if (i < b.list.length) idle(step, 3000); else off.startRendering().then(buf => { b.buf = buf; if (ctx === live) chainFor(live); /* its 4 nodes made now, not on the first tick */ }).catch(() => {});
    };
    idle(step, 3000);
  }
  // persistent per-context path for the baked ticks: gain (level) -> splitter -> dry panner -> dry bus, wet panner -> reverb
  function chainFor(c) {
    let ch = chains.get(c); if (ch) return ch;
    const g = c.createGain(), sp = c.createChannelSplitter(2), pd = c.createStereoPanner(), pw = c.createStereoPanner();
    g.connect(sp); sp.connect(pd, 0); sp.connect(pw, 1); pd.connect(dryBus); pw.connect(verbIn);
    ch = { g, pd, pw }; chains.set(c, ch); return ch;
  }
  // play tick h from the bank if its take is ready; false = not ready, play it live
  function bakedHit(h, sid) {
    if (!bakeOn || baking) return false;
    const id = bankId(), k = banks.findIndex(x => x.id === id);
    if (k < 0) { primeTicks(); return false; }
    const b = banks[k], e = b.buf && b.slots.get(sid); if (!e) return false;
    if (k > 0) { banks.splice(k, 1); banks.unshift(b); }
    const c = ensure(); if (!c || !enabled) return true;
    if (!lite) { duck(h.duck == null ? .35 : h.duck, h.dur * 1000 + 150); noteFx(h.freq, h.vol, 0); }
    const ch = chainFor(c), t0 = now(), src = c.createBufferSource();
    ch.g.gain.value = h.vol / e.base.vol; ch.pd.pan.value = h.pan || 0; ch.pw.pan.value = h.pan || 0;
    src.buffer = b.buf; src.playbackRate.value = h.freq / e.base.freq; src.connect(ch.g); src.start(t0, e.off, b.slot);
    return true;
  }
  // o: { theme (the sound everywhere: any id choices() lists, or 'melody' / 'musicbox' from before), volume, enabled, boot,
  // key / scale (the shelf's key), builtInSongs; beta.14: shelf (the console on screen), byShelf ({ console: sound id }),
  // instrument (ui.instrument), packs (the sound packs' details, main/soundpacks.js), loaders ({ packRead, instRead,
  // musicList, musicRead }), realInsts ({ inst: [MIDI notes] } downloaded) }
  function set(o) {
    let re = false;
    if (o.theme) { mainId = String(o.theme); re = true; }
    if (o.volume != null) { volume = Math.max(0, Math.min(1, +o.volume)); if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, .02); extLevel(); }
    if (o.enabled != null) { enabled = !!o.enabled; if (!enabled) { roomStop(true); ambientStop(true); } }
    if (o.boot) bootPick = o.boot;
    if (o.key !== undefined) { keyShift = +o.key || 0; keyScale = o.scale || null; }
    if (o.builtInSongs !== undefined) { useBuiltIn = o.builtInSongs !== false; songOrder = []; songPos = -1; }
    if (o.loaders) { loaders = Object.assign({}, loaders, o.loaders); re = true; }
    if (Array.isArray(o.packs)) { packMeta = o.packs.filter(p => p && /^[a-z0-9-]{1,48}$/.test(p.id)); for (const id of [...packs.keys()]) if (!packMeta.some(p => p.id === id)) packs.delete(id); re = true; }
    if (o.byShelf && typeof o.byShelf === 'object') { byShelf = Object.assign({}, o.byShelf); re = true; }
    if (o.realInsts && typeof o.realInsts === 'object') { realHave = o.realInsts; for (const k of Object.keys(realState)) if (!realHave[k]) { delete realState[k]; if (window.BS_INST) BS_INST.setBank(k, null); } re = true; }
    if (o.instrument && typeof o.instrument === 'object') {
      const was = instCfg.song + '|' + instCfg.mode;
      instCfg = Object.assign({ inst: 'harp', src: 'built', key: 0, mood: 'calm', mode: 'notes', song: '', songs: {} }, o.instrument, { set: true });
      if (was !== instCfg.song + '|' + instCfg.mode) { song = null; songOrder = []; songPos = -1; }
      re = true;
    }
    if (o.shelf !== undefined && String(o.shelf || '') !== shelfId) {
      shelfId = String(o.shelf || ''); re = true;
      if (songOn() && !iNow().song) nextSong('shelf'); // (a new shelf, a new song: as Melody did)
    }
    if (re) { applyActive(); if (o.packs || o.byShelf || o.theme) preloadPacks(); }
    if (BAKE && (re || o.key !== undefined)) primeTicks();
  }
  // a cue as another sound would play it (Settings' Try it pads), without changing the sound in use
  // id: any sound id; inst: instrument settings to try (the Instrument page). Packs not loaded yet load first.
  async function preview(id, cue, o, inst) {
    const r = resolve(id || mainId); if (r.voice === 'off') return;
    if (r.pack) { const P = packLoad(r.pack); for (let k = 0; P && P.state !== 'ready' && k < 40; k++) await new Promise(res => setTimeout(res, 50)); }
    const sv = { theme, curPack, instOver, instCfg };
    theme = r.voice; curPack = r.pack || ''; instOver = r.over || null; if (inst) { instCfg = Object.assign({}, instCfg, inst); instOver = null; }
    if (theme === 'instrument' && iNow().src === 'real') realLoad(iNow().inst);
    try { const fn = voiceFor(cue); if (fn) fn(o || {}); } catch (e) { console.warn('sound preview', e); } finally { ({ theme, curPack, instOver, instCfg } = sv); }
  }
  // ▶ on a song (the Instrument page): plays it on its instrument (Auto, or `per` set by hand) for up to 25 s; returns stop()
  let songPrev = null;
  function songPreview(name, per, inst) {
    songPreviewStop();
    const c = ensure(); if (!c || !window.Songs) return () => {};
    const sg = [...(Songs.builtIn || []), ...userSongs].find(s => s.name === name); if (!sg) return () => {};
    const plan = Songs.settingsFor(sg, per || null, inst || iNow().inst), times = Songs.timesOf(sg), t0 = c.currentTime + .15, me = { i: 0, timer: 0 };
    const pump = () => { if (songPrev !== me) return; const until = c.currentTime + 1.2;
      while (me.i < plan.notes.length) { const at = t0 + times[me.i] / plan.rate; if (at > until || at - t0 > 25) break;
        const nx = times[me.i + 1] != null ? (times[me.i + 1] - times[me.i]) / plan.rate : .6;
        instNote(plan.notes[me.i], { inst: plan.inst, at: Math.max(0, at - c.currentTime), vol: .3, dur: Math.max(.15, Math.min(1, nx * .95)), fx: false, duck: 0 }); me.i++; }
      const more = me.i < plan.notes.length && t0 + times[me.i] / plan.rate - t0 <= 25;
      me.timer = setTimeout(more ? pump : () => { if (songPrev === me) { songPrev = null; if (me.onEnd) me.onEnd(); } }, more ? 400 : 1500); };
    songPrev = me; if (iNow().src === 'real') realLoad(plan.inst); pump();
    const stop = () => { if (songPrev === me) songPrev = null; clearTimeout(me.timer); };
    stop.onEnd = f => { me.onEnd = f; }; return stop;
  }
  function songPreviewStop() { if (songPrev) { clearTimeout(songPrev.timer); songPrev = null; } }
  // the songs the Instrument can play: built-in ones and your MIDI files, each with its Auto line
  function songList(per, inst) {
    const L = [...((window.Songs && Songs.builtIn) || []), ...userSongs];
    return L.map(s => { const pl = window.Songs && Songs.settingsFor ? Songs.settingsFor(s, per && per[s.name] || null, inst || iNow().inst) : null; return { name: s.name, builtIn: !!s.builtIn, label: pl ? pl.label : '', inst: pl ? pl.inst : '', program: s.program == null ? -1 : s.program }; });
  }
  // Offline render of one cue (for previews / tests): returns an AudioBuffer
  async function render(name, seconds = 1.6, th) {
    const Off = window.OfflineAudioContext; if (!Off) return null;
    const saved = { ctx, master, lim, verbIn, verbOut, dryBus, theme };
    ctx = new Off(2, Math.ceil(44100 * seconds), 44100); if (th) theme = ALIAS[th] || th;
    master = ctx.createGain(); master.gain.value = volume; lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = .002; lim.release.value = .09;
    dryBus = ctx.createGain(); verbIn = ctx.createGain(); verbOut = ctx.createGain(); verbOut.gain.value = .9; buildReverb();
    const sv = sat, av = ambBus; sat = ctx.createWaveShaper(); sat.curve = satCurve(1.6); ambBus = ctx.createGain(); ambBus.gain.value = 0;
    dryBus.connect(sat); verbOut.connect(sat); sat.connect(lim); lim.connect(master); master.connect(ctx.destination); ambBus.connect(lim);
    saved.sat = sv; saved.ambBus = av;
    const en = enabled; enabled = true; try { voiceFor(name)(); } finally { enabled = en; }
    const buf = await ctx.startRendering();
    ctx = saved.ctx; master = saved.master; lim = saved.lim; verbIn = saved.verbIn; verbOut = saved.verbOut; dryBus = saved.dryBus; theme = saved.theme; sat = saved.sat; ambBus = saved.ambBus;
    return buf;
  }
  // A short performance of a voice, rendered offline (for previews): steps = [[cue, opts, gapSeconds], ...]
  async function renderDemo(th, steps, seconds) {
    const Off = window.OfflineAudioContext; if (!Off) return null;
    const saved = { ctx, master, lim, verbIn, verbOut, dryBus, theme, sat, ambBus, song, songIdx, lastNote, lastTick, lastShelf, tickRun };
    ctx = new Off(2, Math.ceil(44100 * seconds), 44100); theme = ALIAS[th] || th;
    master = ctx.createGain(); master.gain.value = volume; lim = ctx.createDynamicsCompressor(); lim.threshold.value = -10; lim.knee.value = 4; lim.ratio.value = 12; lim.attack.value = .002; lim.release.value = .09;
    dryBus = ctx.createGain(); verbIn = ctx.createGain(); verbOut = ctx.createGain(); verbOut.gain.value = .9; buildReverbNow();
    sat = ctx.createWaveShaper(); sat.curve = satCurve(1.15); ambBus = ctx.createGain(); ambBus.gain.value = 0;
    dryBus.connect(sat); verbOut.connect(sat); sat.connect(lim); lim.connect(master); master.connect(ctx.destination); ambBus.connect(lim);
    const en = enabled; enabled = true; let at = 0; fakeClock = 1e6; lastNote = 0; lastTick = 0; lastShelf = 0;
    try { for (const [cue, o, gap] of steps) { atBase = at; fakeClock = 1e6 + at * 1000; if (cue === 'next') nextSong('demo'); else { const fn = voiceFor(cue); if (fn) fn(o || {}); } at += gap || 0; } }
    finally { enabled = en; atBase = 0; fakeClock = null; }
    const buf = await ctx.startRendering();
    Object.assign({}, saved); ({ ctx, master, lim, verbIn, verbOut, dryBus, theme, sat, ambBus } = saved); lastNote = saved.lastNote; lastTick = saved.lastTick; lastShelf = saved.lastShelf; tickRun = saved.tickRun; song = saved.song; songIdx = saved.songIdx;
    return buf;
  }
  // the offline reverb tail can't wait for idle time: build it at once
  function buildReverbNow() {
    const taps = [[.011, .5, -.6], [.019, .38, .6], [.029, .3, -.25], [.041, .22, .35]];
    taps.forEach(([d, g, pan]) => { const dl = ctx.createDelay(.1); dl.delayTime.value = d; const gg = ctx.createGain(); gg.gain.value = g; const p = ctx.createStereoPanner(); p.pan.value = pan; verbIn.connect(dl); dl.connect(gg); gg.connect(p); p.connect(verbOut); });
    const rate = ctx.sampleRate, n = Math.floor(rate * 2.2), buf = ctx.createBuffer(2, n, rate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); let lp = 0; for (let i = 0; i < n; i++) { lp += ((Math.random() * 2 - 1) - lp) * .35; d[i] = lp * Math.pow(1 - i / n, 3.6) * (1 - .4 * Math.exp(-i / (rate * .004))); } }
    const conv = ctx.createConvolver(); conv.buffer = buf; const hc = ctx.createBiquadFilter(); hc.type = 'lowpass'; hc.frequency.value = 3600; const tail = ctx.createGain(); tail.gain.value = .5;
    verbIn.connect(hc); hc.connect(conv); conv.connect(tail); tail.connect(verbOut);
  }
  // while a game runs the audio device is released (it resumes on the next sound)
  function suspend() { if (ctx && ctx.state === 'running' && ctx.suspend) ctx.suspend().catch(() => {}); }
  // fade everything out over ms, then suspend; the next sound brings the level straight back
  let fadeT = 0;
  function fadeOut(ms = 900) { if (!ctx || ctx.state !== 'running' || !master) return suspend(); const t = ctx.currentTime; master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + ms / 1000); clearTimeout(fadeT); fadeT = setTimeout(() => { suspend(); }, ms + 60); }
  // made once while Boxshelf is idle after start-up: the audio engine and the 'air' noise buffers cost ~50 ms the first time
  function warm() { try { const c = ensure(); if (c) { airNoise(c); if (BAKE) primeTicks(); } } catch {} }
  return { warm, setSink, play, set, render, renderDemo, renderMusic, ambientStart, ambientStop, music: () => ext ? { track: ext.kind === 'pack' ? 'pack:' + ext.id : 'mine', level: ext.level, playing: !!(ext.el && !ext.el.paused) } : amb ? { track: amb.id, level: amb.level / MUS_GAIN, step: amb.step } : null,
    // (beta.14) Settings > Sound and the quick menu
    choices, musicChoices, nameOf, preview, songPreview, songPreviewStop, songList, instruments: () => (window.BS_INST ? BS_INST.LIST : []).map(([id, name, sub, hue]) => ({ id, name, sub, hue })),
    active: () => ({ shelf: shelfId, sound: shelfSound(shelfId), voice: theme, pack: curPack, inst: theme === 'instrument' ? iNow().inst : '', mode: theme === 'instrument' ? iNow().mode : '', packReady: !!(curPack && packs.get(curPack) && packs.get(curPack).state === 'ready'), real: Object.keys(realState).filter(k => realState[k] === 'ready') }),
    songMode: () => songOn(), tracks: Object.keys(TRACKS).map(id => [id, TRACKS[id].name]), roomStart, roomStop, suspend, fadeOut, nextSong, loadSongs, song: () => { const s = curSong(); return s ? { name: s.name, hue: s.hue, builtIn: s.builtIn } : null; },
    // tests: switch the Android pre-rendered ticks off/on and see the banks
    _bake: on => { if (on != null) bakeOn = BAKE && !!on; return { on: bakeOn, banks: banks.map(b => ({ id: b.id, ready: !!b.buf, takes: b.slots.size })) }; },
    get theme() { return theme; }, get main() { return mainId; } };
})();
