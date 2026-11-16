// Phone input: consumes relayed frames, runs the swing detector, tracks sensor rate, tilt, and RTT.
import { SwingDetector } from './swing-detector.js';

const G0_KEY = 'motionpong.g0';

export class PhoneInput {
  /** @param {import('../net.js').Net} net */
  constructor() {
    this.net = null;
    this.detector = new SwingDetector();
    this.connected = false;
    this.lastFrame = null;     // latest {t,a,g,w}
    this.hz = 0;
    this.rtt = 0;
    this.sensorMode = '';
    this.orientation = '';     // 'relative' | 'deviceorientation' | 'none' (from the phone's info message)
    this._count = 0;
    this._hzT = performance.now();
    this._lastFrameAt = 0;
    this.onCalibrated = null;
    this.onPeer = null;
    try {
      const g0 = JSON.parse(sessionStorage.getItem(G0_KEY) || 'null');
      if (g0) this.detector.setNeutral(g0);
    } catch { /* ignore */ }
  }

  attach(net) {
    this.net = net;
    setInterval(() => { if (this.connected) net.send({ type: 'ping', t: performance.now() }); }, 2000);
  }

  get g0() { return this.detector.g0; }
  get streaming() { return performance.now() - this._lastFrameAt < 500; }
  /** Phone sends a face heading (orientation sensor works) → face rule + live paddle stance available.
   *  1.5 s grace so a Wi-Fi hiccup doesn't flip the stance back to the ball-side guess. */
  get hasHeading() { return this.lastFrame != null && 'h' in this.lastFrame && performance.now() - this._lastFrameAt < 1500; }
  get face() { return this.lastFrame?.h ?? null; }

  onSwing(fn) { this.detector.onSwing(fn); }

  handle(msg) {
    switch (msg.type) {
      case 'frame':
        if (!Array.isArray(msg.a) || !Array.isArray(msg.g)) return;
        if (!Array.isArray(msg.w)) msg.w = [0, 0, 0];
        this.lastFrame = msg;
        this._lastFrameAt = performance.now();
        this._count++;
        this.detector.push(msg);
        break;
      case 'calibrated':
        this.detector.setNeutral(msg.g0);
        try { sessionStorage.setItem(G0_KEY, JSON.stringify(msg.g0)); } catch { /* ignore */ }
        this.onCalibrated?.(msg.g0);
        break;
      case 'pong':
        if (typeof msg.t === 'number') this.rtt = this.rtt ? this.rtt * 0.6 + (performance.now() - msg.t) * 0.4 : performance.now() - msg.t;
        break;
      case 'info':
        this.sensorMode = msg.sensorMode || '';
        this.orientation = msg.orientation || 'none';
        break;
      case 'peer':
        if (msg.role === 'phone') {
          this.connected = msg.state === 'joined';
          if (!this.connected) { this.rtt = 0; this.hz = 0; }
          this.onPeer?.(this.connected);
        }
        break;
    }
  }

  /** Call ~every frame; updates measured sensor Hz once per second. */
  tick(now) {
    if (now - this._hzT >= 1000) {
      this.hz = Math.round((this._count * 1000) / (now - this._hzT));
      this._count = 0;
      this._hzT = now;
    }
  }

  /** Paddle tilt relative to the calibrated pose: {pitch, roll} radians. */
  tilt(out) {
    const f = this.lastFrame;
    if (!f || !this.streaming) { out.pitch = 0; out.roll = 0; return out; }
    const g = f.g, g0 = this.detector.g0;
    const p = Math.atan2(-g[2], g[1]) - Math.atan2(-g0[2], g0[1]);
    const r = Math.atan2(-g[0], g[1]) - Math.atan2(-g0[0], g0[1]);
    out.pitch = Math.max(-1, Math.min(1, p));
    out.roll = Math.max(-1, Math.min(1, r));
    return out;
  }

  calibrate() { this.net?.send({ type: 'calibrate' }); }
  haptic(pattern) { if (this.connected) this.net?.send({ type: 'haptic', pattern }); }
  status(text, color = '#fff') { if (this.connected) this.net?.send({ type: 'status', text, color }); }
}
