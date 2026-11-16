// Swing detector (§7). Pure logic: feed frames, get SwingEvents. Runs on the laptop so it is live-tunable.
import { CFG } from '../config.js';

const BUFFER_MS = 400;
// After a whiff the cooldown is waived, but the same stroke's deceleration spike must not count as a new swing.
const WHIFF_REFRACTORY_MS = 120;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** @typedef {{t:number, a:number[], g:number[], w:number[]}} Frame */
/** @typedef {{t:number, power:number, aim:number, loft:number, peak:number}} SwingEvent */

export class SwingDetector {
  constructor() {
    this.buf = [];             // ring buffer of {t, a, g, w, mag}
    this.state = 'IDLE';
    this.armed = true;         // must drop below START_THRESH before a new swing
    this.lastSwing = -Infinity;
    this.lastEmit = -Infinity;
    this.forgiven = false;
    this.g0 = [0, 9.81, 0];    // neutral pose (gravity, device frame)
    this.lastMag = 0;
    this.listeners = [];
    this._reset();
  }

  _reset() {
    this.t0 = 0; this.peak = 0; this.wSum = 0; this.axSum = 0; this.wySum = 0;
  }

  onSwing(fn) { this.listeners.push(fn); }

  setNeutral(g0) { if (Array.isArray(g0) && g0.length === 3) this.g0 = g0.slice(); }

  /** Called by the game when a swing whiffed: no cooldown penalty. */
  forgiveCooldown() { this.forgiven = true; }

  /** @param {Frame} f */
  push(f) {
    const a = f.a, mag = Math.hypot(a[0], a[1], a[2]);
    this.lastMag = mag;
    const buf = this.buf;
    buf.push({ t: f.t, a, g: f.g, w: f.w, mag });
    while (buf.length && f.t - buf[0].t > BUFFER_MS) buf.shift();

    if (this.state === 'IDLE') {
      if (mag < CFG.START_THRESH) this.armed = true;
      const ready = this.forgiven ? f.t - this.lastEmit > WHIFF_REFRACTORY_MS : f.t - this.lastSwing > CFG.COOLDOWN;
      if (this.armed && mag > CFG.START_THRESH && ready) {
        this.state = 'SWINGING';
        this.armed = false;
        this.forgiven = false;
        this._reset();
        this.t0 = f.t;
        this.peak = mag;
        this._accum(f, mag);
      }
      return null;
    }

    // SWINGING
    this._accum(f, mag);
    if (mag > this.peak) this.peak = mag;
    if (mag < CFG.PEAK_DROP * this.peak || f.t - this.t0 >= CFG.MAX_WINDOW) return this._emit(f.t);
    return null;
  }

  _accum(f, mag) {
    this.wSum += mag;
    this.axSum += f.a[0] * mag;
    this.wySum += (f.w?.[1] || 0) * mag;
  }

  _emit(t) {
    const peak = this.peak;
    const x = clamp((peak - CFG.START_THRESH) / Math.max(1, CFG.FULL_POWER - CFG.START_THRESH), 0, 1);
    const power = Math.pow(x, 0.7);

    const meanAx = this.axSum / this.wSum;
    const meanWy = this.wySum / this.wSum;
    const lat = clamp(meanAx / peak, -1, 1);
    const yaw = clamp(-meanWy / 6, -1, 1);
    let aim = clamp((0.5 * lat + 0.5 * yaw) * CFG.AIM_GAIN, -1, 1);
    const dz = CFG.AIM_DEADZONE;
    aim = Math.abs(aim) < dz ? 0 : Math.sign(aim) * (Math.abs(aim) - dz) / (1 - dz);
    if (CFG.INVERT_AIM) aim = -aim;

    const gz = this._preSwingGz();
    let loft = clamp((-(gz - this.g0[2]) / 9.81) * CFG.LOFT_GAIN, -1, 1);
    if (CFG.INVERT_LOFT) loft = -loft;

    this.state = 'IDLE';
    this.lastSwing = this.t0;
    this.lastEmit = t;
    /** @type {SwingEvent} */
    const ev = { t, power, aim, loft, peak };
    for (const fn of this.listeners) fn(ev);
    return ev;
  }

  /** Median gravity z from 250→100 ms before the swing started (the swing corrupts g). */
  _preSwingGz() {
    const vals = [];
    for (const fr of this.buf) {
      const dt = this.t0 - fr.t;
      if (dt >= 100 && dt <= 250 && fr.g) vals.push(fr.g[2]);
    }
    if (!vals.length) {
      for (let i = this.buf.length - 1; i >= 0; i--) {
        if (this.buf[i].t < this.t0 && this.buf[i].g) return this.buf[i].g[2];
      }
      return this.g0[2];
    }
    vals.sort((p, q) => p - q);
    return vals[vals.length >> 1];
  }
}
