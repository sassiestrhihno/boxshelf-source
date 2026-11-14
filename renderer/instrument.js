/* The Instrument sound's nine instruments (beta.14), played by sound.js (the Instrument voice, songs, previews).
   Each note is a small node graph that stops itself: a few oscillators or one buffer, a filter or two and an envelope,
   disconnected when it ends. Made to stay light on the Thor:
   - Harp: Karplus-Strong (a burst of noise through a tuned, damped delay loop), worked out once per note and kept
     (the last 20 notes), filled in idle time for the notes a scale will use
   - Piano: stretched (inharmonic) partials like a real string, each dying away at its own rate, a hammer knock and a
     filter that closes as the note fades
   - Violin: two detuned saws, delayed vibrato and the body's resonances (peaking filters), bowed in and out
   - Flute: a near-pure tone, breath noise and a soft octave; Clarinet: odd harmonics (a square through a low-pass)
   - Music box, Marimba, Bells: struck partials at their own (inharmonic) ratios; 8-bit: a square, like a console chip
   - "Real": recorded notes (VSCO 2 Community Edition, CC0) when downloaded, the nearest one pitch-shifted. */
window.BS_INST = (() => {
  const LIST = [['piano', 'Piano', 'Warm keys', 210], ['harp', 'Harp', 'Plucked strings', 45], ['violin', 'Violin', 'Bowed strings', 15], ['flute', 'Flute', 'Soft and airy', 170],
    ['clarinet', 'Clarinet', 'Round woodwind', 120], ['box', 'Music box', 'Steel tines', 290], ['marimba', 'Marimba', 'Wooden bars', 30], ['bells', 'Bells', 'Ringing chimes', 55], ['chip', '8-bit', 'Console chip', 320]];
  const IDS = LIST.map(x => x[0]);
  const freqOf = m => 440 * Math.pow(2, (m - 69) / 12);
  // how much room (reverb send) each instrument wants
  const ROOM = { piano: .4, harp: .55, violin: .5, flute: .45, clarinet: .4, box: .5, marimba: .3, bells: .6, chip: .12 };
  // ---- per audio context caches: a short noise burst, the harp's plucks ----
  const perCtx = new WeakMap();
  function cache(c) { let k = perCtx.get(c); if (!k) { k = { noise: null, ks: new Map() }; perCtx.set(c, k); } return k; }
  function noise(c) {
    const k = cache(c); if (k.noise) return k.noise;
    const n = Math.floor(c.sampleRate * .06), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    return (k.noise = b);
  }
  // Karplus-Strong pluck for MIDI note m (a buffer, kept): brighter and shorter up high
  function pluck(c, m) {
    const k = cache(c), hit = k.ks.get(m); if (hit) { k.ks.delete(m); k.ks.set(m, hit); return hit; }
    const sr = c.sampleRate, f = freqOf(m), decay = Math.max(.8, Math.min(1.8, 2.4 - (m - 48) * .025)), n = Math.floor(sr * decay);
    const buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0), P = Math.max(2, Math.round(sr / f)), line = new Float32Array(P), bright = .3;
    let lp = 0; for (let i = 0; i < P; i++) { lp += ((Math.random() * 2 - 1) - lp) * .6; line[i] = lp; } // (a softened burst: a finger, not a pick)
    let idx = 0; const damp = Math.pow(.5, 1 / (f * decay * .45)); // (the loop's loss: about -6 dB every 0.45 x decay seconds)
    for (let i = 0; i < n; i++) { const cur = line[idx], nx = line[(idx + 1) % P]; line[idx] = (bright * cur + (1 - bright) * (cur + nx) * .5) * damp; d[i] = cur * (i < 64 ? i / 64 : 1); idx = (idx + 1) % P; }
    k.ks.set(m, buf); if (k.ks.size > 20) k.ks.delete(k.ks.keys().next().value);
    return buf;
  }
  // fill the harp's plucks for these notes a little at a time while nothing else is happening
  function prime(c, inst, notes) {
    if (inst !== 'harp' || !c || !notes || !notes.length) return;
    const todo = notes.filter(m => !cache(c).ks.has(m)).slice(0, 12);
    const idle = fn => window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 60);
    const step = () => { if (!todo.length) return; if (typeof window.BS_BUSY === 'function' && window.BS_BUSY()) { idle(step); return; } pluck(c, todo.shift()); if (todo.length) idle(step); };
    idle(step);
  }
  // ---- recorded notes ----
  const banks = {}; // inst -> [{ midi, buf }] sorted
  function setBank(inst, list) { if (!list || !list.length) delete banks[inst]; else banks[inst] = list.slice().sort((a, b) => a.midi - b.midi); }
  const hasReal = inst => !!(banks[inst] && banks[inst].length);
  function nearest(inst, m) { const L = banks[inst]; let best = L[0]; for (const x of L) if (Math.abs(x.midi - m) < Math.abs(best.midi - m)) best = x; return best; }
  const SUSTAIN = { violin: 1, flute: 1, clarinet: 1 };
  function playReal(c, out, inst, m, t, vol, dur) {
    const s = nearest(inst, m); if (!s || s.buf.sampleRate == null) return 0;
    const src = c.createBufferSource(), g = c.createGain(); src.buffer = s.buf; src.playbackRate.value = Math.pow(2, (m - s.midi) / 12);
    const len = s.buf.duration / src.playbackRate.value, end = SUSTAIN[inst] ? Math.min(len, Math.max(.3, dur) + .25) : Math.min(len, dur * 2.2 + .6);
    g.gain.setValueAtTime(vol * 1.3, t); g.gain.setValueAtTime(vol * 1.3, t + Math.max(.02, end - .25)); g.gain.linearRampToValueAtTime(0, t + end);
    src.connect(g); g.connect(out); src.start(t); src.stop(t + end + .02);
    src.onended = () => { try { g.disconnect(); out.disconnect(); } catch {} };
    return t + end;
  }
  // ---- the built-in instruments ----
  // play MIDI note m on `inst` into node `out` at time t. o: { vol (0-1), dur (seconds the note is held), real }. Returns the end time.
  function play(c, out, inst, m, t, o = {}) {
    const vol = o.vol == null ? .5 : o.vol, dur = o.dur || .6, f = freqOf(m);
    if (o.real !== false && hasReal(inst) && inst !== 'chip') { const e = playReal(c, out, inst, m, t, vol, dur); if (e) return e; }
    const nodes = [], last = (s, end) => { s.onended = () => { try { out.disconnect(); } catch {} nodes.forEach(n => { try { n.disconnect(); } catch {} }); }; return end; };
    const osc = (type, fr, at) => { const x = c.createOscillator(); x.type = type; x.frequency.setValueAtTime(fr, at == null ? t : at); nodes.push(x); return x; };
    const gain = v => { const g = c.createGain(); g.gain.value = v; nodes.push(g); return g; };
    const filt = (type, fr, q) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = fr; if (q != null) b.Q.value = q; nodes.push(b); return b; };
    if (inst === 'harp') {
      const s = c.createBufferSource(), lp = filt('lowpass', Math.min(9000, f * 9), .5), g = gain(vol * 1.1); s.buffer = pluck(c, m);
      s.connect(lp); lp.connect(g); g.connect(out); s.start(t); nodes.push(s); return last(s, t + s.buffer.duration);
    }
    if (inst === 'piano') {
      const B = .0004 * Math.pow(2, (60 - m) / 24), body = filt('lowpass', Math.min(9000, f * 12), .4);
      body.frequency.setValueAtTime(Math.min(9000, f * 12), t); body.frequency.exponentialRampToValueAtTime(Math.max(500, Math.min(3000, f * 4)), t + 1.2); body.connect(out);
      const ring = Math.max(.8, Math.min(2.6, dur * 1.8 + 1.2 - (m - 60) * .02)); let end = t;
      [[1, .5, 1], [2, .24, .62], [3, .11, .45], [4, .06, .34], [5, .035, .26], [7, .015, .18]].forEach(([n, a, dm], i) => {
        const fn = f * n * Math.sqrt(1 + B * n * n); if (fn > 14000) return;
        const o1 = osc('sine', fn), g = gain(0), d = ring * dm;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + .003); g.gain.setTargetAtTime(vol * a * .45, t + .003, .05); g.gain.setTargetAtTime(0, t + .06, d / 3.5);
        o1.connect(g); g.connect(body); o1.start(t); o1.stop(t + d + .3); if (i === 0) end = t + d + .3;
        if (i === 0) { const o2 = osc('sine', fn * Math.pow(2, 1.4 / 1200)); o2.connect(g); o2.start(t); o2.stop(t + d + .3); last(o2, end); }
      });
      const ns = c.createBufferSource(), bp = filt('bandpass', Math.min(4000, f * 3), 1.1), ng = gain(vol * .12); ns.buffer = noise(c); ns.connect(bp); bp.connect(ng); ng.connect(body); ns.start(t); nodes.push(ns);
      return end;
    }
    if (inst === 'violin') {
      const o1 = osc('sawtooth', f), o2 = osc('sawtooth', f), lfo = osc('sine', 5.3), lg = gain(0), g = gain(0), hp = filt('highpass', 190), lp = filt('lowpass', 4200, .5), mix = gain(.5);
      o2.detune.value = 6; lg.gain.setValueAtTime(0, t + .16); lg.gain.linearRampToValueAtTime(f * .006, t + .42); lfo.connect(lg); lg.connect(o1.frequency); lg.connect(o2.frequency);
      o1.connect(mix); o2.connect(mix); mix.connect(hp); let node = hp;
      for (const [fr, q, db] of [[290, 1.2, 8], [1100, 1.6, 5], [2700, 2, 4]]) { const pk = filt('peaking', fr, q); pk.gain.value = db; node.connect(pk); node = pk; }
      node.connect(lp); lp.connect(g); g.connect(out);
      const hold = Math.max(.35, dur), end = t + hold + .35;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * .32, t + .1); g.gain.setTargetAtTime(vol * .26, t + .1, .2); g.gain.setTargetAtTime(0, t + hold, .1);
      [o1, o2, lfo].forEach(x => { x.start(t); x.stop(end); }); return last(o1, end);
    }
    if (inst === 'flute' || inst === 'clarinet') {
      const cl = inst === 'clarinet', o1 = osc(cl ? 'square' : 'sine', f), lfo = osc('sine', 4.8), lg = gain(0), g = gain(0), lp = filt('lowpass', cl ? Math.min(2400, f * 5) : Math.min(5000, f * 6), .6);
      lg.gain.setValueAtTime(0, t + .12); lg.gain.linearRampToValueAtTime(f * (cl ? .002 : .004), t + .35); lfo.connect(lg); lg.connect(o1.frequency);
      const hold = Math.max(.3, dur), end = t + hold + .3, peak = vol * (cl ? .2 : .42);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .05); g.gain.setTargetAtTime(peak * .8, t + .05, .2); g.gain.setTargetAtTime(0, t + hold, .08);
      o1.connect(lp); lp.connect(g); g.connect(out); o1.start(t); lfo.start(t); o1.stop(end); lfo.stop(end);
      if (!cl) { const o2 = osc('sine', f * 2), g2 = gain(0); g2.gain.setValueAtTime(0, t); g2.gain.linearRampToValueAtTime(vol * .05, t + .06); g2.gain.setTargetAtTime(0, t + hold, .08); o2.connect(g2); g2.connect(out); o2.start(t); o2.stop(end);
        const ns = c.createBufferSource(), bp = filt('bandpass', Math.min(8000, f * 2), 2.5), ng = gain(vol * .25); ns.buffer = noise(c); ns.connect(bp); bp.connect(ng); ng.connect(out); ns.start(t); nodes.push(ns); }
      return last(o1, end);
    }
    const P = { box: [[1, .4, 1.5], [2, .07, .6], [3.01, .1, .45], [5.4, .04, .2]], marimba: [[1, .55, .5], [4, .14, .1], [9.9, .04, .04]], bells: [[1, .3, 2.4], [2.76, .14, 1.5], [5.4, .08, .7], [8.9, .035, .35]], chip: [[1, .16, .28]] }[inst] || [[1, .3, 1]];
    const lp = filt('lowpass', inst === 'chip' ? 3800 : 11000, .5); lp.connect(out); let end = t, lastSrc = null;
    for (const [ratio, a, dec] of P) {
      const fr = f * ratio; if (fr > 15000) continue;
      const o1 = osc(inst === 'chip' ? 'square' : 'sine', fr), g = gain(0), d = inst === 'chip' ? Math.max(dec, Math.min(.5, dur)) : dec * (m > 84 ? .75 : 1);
      if (inst === 'chip') { o1.frequency.setValueAtTime(fr * 1.012, t); o1.frequency.setValueAtTime(fr, t + .012); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * a, t + .003); g.gain.setTargetAtTime(0, t + .004, d / (inst === 'chip' ? 2.5 : 4));
      o1.connect(g); g.connect(lp); o1.start(t); o1.stop(t + d + .1); if (t + d + .1 > end) { end = t + d + .1; lastSrc = o1; }
    }
    if (inst === 'marimba') { const ns = c.createBufferSource(), bp = filt('bandpass', Math.min(5000, f * 4), 1.5), ng = gain(vol * .15); ns.buffer = noise(c); ns.connect(bp); bp.connect(ng); ng.connect(lp); ns.start(t); nodes.push(ns); }
    if (lastSrc) last(lastSrc, end);
    return end;
  }
  return { LIST, IDS, ROOM, play, prime, setBank, hasReal, freqOf };
})();
