// WebAudio synthesis. No asset files. Call unlock() from a user gesture.
import { CFG, setConfig } from './config.js';

class Synth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuf = null;
    this.music = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = CFG.MASTER_VOLUME;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // 1 s white noise buffer, reused.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (CFG.MUSIC) this.startMusic();
  }

  get ready() { return !!this.ctx && !this.muted; }

  setVolume(v) {
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  toggleMute() {
    this.muted = !this.muted;
    this.setVolume(CFG.MASTER_VOLUME);
    return this.muted;
  }

  // --- primitives ---
  tone({ type = 'sine', f0, f1 = f0, dur = 0.1, vol = 0.3, delay = 0, attack = 0.004 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.1, vol = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, delay = 0 }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // --- game sounds ---
  hit(power = 0.5, perfect = false) {
    const f = 380 + power * 520;
    this.tone({ type: 'triangle', f0: f, f1: f * 0.6, dur: 0.09, vol: 0.45 });
    this.tone({ type: 'square', f0: f * 2, f1: f, dur: 0.03, vol: 0.08 });
    this.noise({ dur: 0.03, vol: 0.25, type: 'highpass', f0: 3000, q: 0.7 });
    if (perfect) {
      [0, 4, 7, 12].forEach((s, i) =>
        this.tone({ type: 'sine', f0: 1046 * 2 ** (s / 12), dur: 0.12, vol: 0.12, delay: 0.04 + i * 0.045 }));
    }
  }

  bounce() {
    this.tone({ type: 'sine', f0: 180, f1: 90, dur: 0.08, vol: 0.5 });
    this.noise({ dur: 0.02, vol: 0.12, type: 'highpass', f0: 2500 });
  }

  net() {
    this.noise({ dur: 0.07, vol: 0.35, type: 'bandpass', f0: 1800, f1: 900, q: 4 });
  }

  whoosh(power = 0.5) {
    this.noise({ dur: 0.18 + power * 0.1, vol: 0.12 + power * 0.18, type: 'bandpass', f0: 400, f1: 2400, q: 1.5 });
  }

  tick() { this.tone({ type: 'square', f0: 880, dur: 0.05, vol: 0.12 }); }

  pointWon() {
    [0, 4, 7, 12].forEach((s, i) =>
      this.tone({ type: 'triangle', f0: 523 * 2 ** (s / 12), dur: 0.16, vol: 0.3, delay: i * 0.09 }));
  }

  pointLost() {
    this.tone({ type: 'sawtooth', f0: 440, f1: 110, dur: 0.5, vol: 0.18 });
    this.tone({ type: 'triangle', f0: 330, f1: 82, dur: 0.55, vol: 0.2 });
  }

  fanfare() {
    const notes = [[0, 0.12], [4, 0.12], [7, 0.12], [12, 0.35], [7, 0.12], [12, 0.6]];
    let t = 0;
    for (const [s, d] of notes) {
      this.tone({ type: 'square', f0: 392 * 2 ** (s / 12), dur: d, vol: 0.14, delay: t });
      this.tone({ type: 'triangle', f0: 196 * 2 ** (s / 12), dur: d, vol: 0.2, delay: t });
      t += d * 0.9;
    }
  }

  sadTrombone() {
    [0, -1, -2, -4].forEach((s, i) =>
      this.tone({ type: 'sawtooth', f0: 233 * 2 ** (s / 12), f1: 233 * 2 ** ((s - (i === 3 ? 2 : 0)) / 12), dur: i === 3 ? 0.7 : 0.28, vol: 0.14, delay: i * 0.3 }));
  }

  connected() {
    [0, 7, 12].forEach((s, i) => this.tone({ type: 'sine', f0: 660 * 2 ** (s / 12), dur: 0.12, vol: 0.2, delay: i * 0.07 }));
  }

  // --- generative synthwave bass loop ---
  toggleMusic() {
    if (this.music) this.stopMusic(); else this.startMusic();
    setConfig('MUSIC', !!this.music);
    return !!this.music;
  }

  startMusic() {
    if (!this.ctx || this.music) return;
    const bpm = 104, step = 60 / bpm / 2;
    const roots = [45, 41, 48, 43]; // A, F, C, G (midi)
    const out = this.ctx.createGain();
    out.gain.value = 0.10;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 6;
    out.connect(lp).connect(this.master);
    let next = this.ctx.currentTime + 0.1, i = 0;
    const midi = (m) => 440 * 2 ** ((m - 69) / 12);
    const sched = () => {
      while (next < this.ctx.currentTime + 0.3) {
        const root = roots[Math.floor(i / 16) % 4];
        const note = root + ([0, 12, 0, 7][i % 4]);
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = midi(note);
        g.gain.setValueAtTime(0.0001, next);
        g.gain.linearRampToValueAtTime(1, next + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, next + step * 0.9);
        o.connect(g).connect(out);
        o.start(next); o.stop(next + step);
        lp.frequency.setValueAtTime(500 + 400 * Math.sin(i / 10), next);
        next += step; i++;
      }
    };
    const iv = setInterval(sched, 100);
    sched();
    this.music = { iv, out };
  }

  stopMusic() {
    if (!this.music) return;
    clearInterval(this.music.iv);
    const g = this.music.out.gain;
    g.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    const out = this.music.out;
    setTimeout(() => out.disconnect(), 600);
    this.music = null;
  }
}

export const audio = new Synth();
