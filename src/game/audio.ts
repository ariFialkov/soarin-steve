/** Tiny synthesised sound effects (no audio assets needed). */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;
let noiseBuf: AudioBuffer | null = null;

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export const audio = {
  setEnabled(v: boolean) { enabled = v; if (!v && ctx) void ctx.suspend(); else if (v && ctx) void ctx.resume(); },
  unlock() { ac(); },

  /** Whooshing noise burst, used for launch and confetti pops. */
  whoosh(duration = 0.6, volume = 0.6, pitch = 1) {
    const c = ac(); if (!c || !noiseBuf || !master) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuf; src.playbackRate.value = pitch;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.setValueAtTime(400 * pitch, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(2400 * pitch, c.currentTime + duration * 0.4);
    f.frequency.exponentialRampToValueAtTime(300, c.currentTime + duration);
    f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(volume, c.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    src.connect(f).connect(g).connect(master);
    src.start(); src.stop(c.currentTime + duration + 0.05);
  },

  pop(volume = 0.8) {
    const c = ac(); if (!c || !master) return;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(520, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(90, c.currentTime + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.2);
    o.connect(g).connect(master);
    o.start(); o.stop(c.currentTime + 0.22);
    this.whoosh(0.35, 0.5, 1.6);
  },

  /** Crackly fizz for a sparkler. Returns a stop function. */
  fizz(duration = 1.3) {
    const c = ac(); if (!c || !noiseBuf || !master) return () => {};
    const src = c.createBufferSource();
    src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 1.8;
    const f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 3000;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.4, c.currentTime + 0.05);
    g.gain.setValueAtTime(0.4, c.currentTime + duration - 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
    src.connect(f).connect(g).connect(master);
    src.start(); src.stop(c.currentTime + duration + 0.05);
    return () => { try { g.gain.cancelScheduledValues(c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.1); src.stop(c.currentTime + 0.12); } catch { /* ignore */ } };
  },

  /** Continuous fan hum. Returns {stop}. */
  hum() {
    const c = ac(); if (!c || !noiseBuf || !master) return { stop() {} };
    const src = c.createBufferSource();
    src.buffer = noiseBuf; src.loop = true; src.playbackRate.value = 0.6;
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500;
    const o = c.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 70;
    const og = c.createGain(); og.gain.value = 0.08;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.35, c.currentTime + 0.3);
    src.connect(f).connect(g);
    o.connect(og).connect(g);
    g.connect(master);
    src.start(); o.start();
    return {
      stop() {
        try {
          g.gain.cancelScheduledValues(c.currentTime);
          g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25);
          src.stop(c.currentTime + 0.3); o.stop(c.currentTime + 0.3);
        } catch { /* ignore */ }
      },
    };
  },

  /** Cannon shot: deep thump plus a noise burst. */
  boom() {
    const c = ac(); if (!c || !master) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(35, c.currentTime + 0.5);
    const g = c.createGain();
    g.gain.setValueAtTime(1.0, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6);
    o.connect(g).connect(master);
    o.start(); o.stop(c.currentTime + 0.65);
    this.whoosh(0.9, 1.0, 0.6);
  },

  bonk() {
    const c = ac(); if (!c || !master) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(110, c.currentTime + 0.15);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.2);
    o.connect(g).connect(master);
    o.start(); o.stop(c.currentTime + 0.22);
  },

  boing() {
    const c = ac(); if (!c || !master) return;
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(300, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(700, c.currentTime + 0.12);
    o.frequency.exponentialRampToValueAtTime(450, c.currentTime + 0.3);
    const g = c.createGain();
    g.gain.setValueAtTime(0.4, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.35);
    o.connect(g).connect(master);
    o.start(); o.stop(c.currentTime + 0.4);
  },

  chime(steps = 3) {
    const c = ac(); if (!c || !master) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    for (let i = 0; i < Math.min(steps, notes.length); i++) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = notes[i];
      const g = c.createGain();
      const t0 = c.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.connect(g).connect(master);
      o.start(t0); o.stop(t0 + 0.55);
    }
  },

  tick() {
    const c = ac(); if (!c || !master) return;
    const o = c.createOscillator();
    o.type = 'square'; o.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.05);
    o.connect(g).connect(master);
    o.start(); o.stop(c.currentTime + 0.06);
  },
};
