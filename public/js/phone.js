// Phone controller: streams motion sensors at ~60 Hz, vibrates on haptic, runs calibration.
import { Net, wsUrl, ROOM_ALPHABET } from './net.js';

const $ = (id) => document.getElementById(id);
const ui = {
  room: $('room'), chip: $('chip'), orb: $('orb'), countdown: $('countdown'), status: $('status-text'),
  error: $('error'), roomEntry: $('room-entry'), roomInput: $('room-input'),
  start: $('start-btn'), cal: $('cal-btn'), mode: $('mode'),
};
const ROOM_RE = new RegExp(`^[${ROOM_ALPHABET}]{4}$`);
const isIOS = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';

let room = (new URLSearchParams(location.search).get('room') || '').toUpperCase();
if (!ROOM_RE.test(room)) { room = ''; ui.roomEntry.hidden = false; }
ui.room.textContent = room || '····';
ui.orb.classList.add('idle');

let net = null;
let sensorMode = '';
let sensorsOk = false;
let wakeLock = null;
const latest = { a: [0, 0, 0], g: [0, 9.81, 0], w: [0, 0, 0], q: null }; // q: orientation quaternion [x,y,z,w]
let orientMode = 'none';
let frames = 0, hzT = performance.now(), hz = 0;
let glow = 0;
let lastFace = null;

ui.roomInput.addEventListener('input', () => {
  ui.roomInput.value = ui.roomInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
});

function setChip(text, cls) { ui.chip.textContent = text; ui.chip.className = 'chip ' + (cls || ''); }
function showError(html) { ui.error.innerHTML = html; ui.error.hidden = false; }
function clearError() { ui.error.hidden = true; }
function setStatus(text, color = '#fff') { ui.status.textContent = text; ui.status.style.color = color; }

ui.start.addEventListener('click', start);
ui.cal.addEventListener('click', () => calibrate());

async function start() {
  clearError();
  if (!room) {
    const v = ui.roomInput.value.toUpperCase();
    if (!ROOM_RE.test(v)) { showError('Enter the 4-letter room code shown on the laptop.'); return; }
    room = v;
    ui.room.textContent = room;
    history.replaceState(null, '', `?room=${room}`);
  }
  if (!window.isSecureContext) {
    showError('<b>Not a secure page.</b> Motion sensors only work over HTTPS. Open the <b>https://</b> link from the QR code, or see README <b>Option B</b> (Chrome flag for the http:// address).');
    return;
  }
  ui.start.disabled = true;
  try {
    await startSensors();
  } catch (e) {
    ui.start.disabled = false;
    showError(e.message || String(e));
    return;
  }
  await startOrientation();
  ui.roomEntry.hidden = true;
  ui.start.hidden = true;
  ui.cal.hidden = false;
  ui.orb.classList.remove('idle');
  connect();
  requestWakeLock();
  try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }); } catch { /* optional */ }
  try { await screen.orientation?.lock?.('portrait'); } catch { /* optional */ }
}

// ---------------------------------------------------------------- sensors
const SENSOR_HELP = 'Motion sensors are blocked. In Chrome: tap the <b>lock / ⓘ icon</b> left of the address → <b>Permissions / Site settings</b> → <b>Motion sensors → Allow</b>, then reload. Also check Chrome <b>Settings → Site settings → Motion sensors</b> is allowed.';

async function startSensors() {
  if ('LinearAccelerationSensor' in window && 'GravitySensor' in window && 'Gyroscope' in window) {
    try {
      if (navigator.permissions) {
        const names = ['accelerometer', 'gyroscope'];
        for (const name of names) {
          const st = await navigator.permissions.query({ name }).catch(() => null);
          if (st && st.state === 'denied') throw new Error(SENSOR_HELP);
        }
      }
      await startGeneric();
      sensorMode = 'generic';
      return;
    } catch (e) {
      if (e && e.message === SENSOR_HELP) throw e;
      console.warn('Generic Sensor API failed, falling back to devicemotion', e);
    }
  }
  await startDeviceMotion();
  sensorMode = 'devicemotion';
}

// ---------------------------------------------------------------- orientation (forehand/backhand + pointing)
// Optional: without it the laptop falls back to auto-follow and guesses the stroke from the ball side.
async function startOrientation() {
  if ('RelativeOrientationSensor' in window) {
    try {
      await new Promise((resolve, reject) => {
        const s = new RelativeOrientationSensor({ frequency: 60, referenceFrame: 'device' });
        s.addEventListener('reading', () => { latest.q = s.quaternion; resolve(); });
        s.addEventListener('error', (e) => reject(e.error || e));
        s.start();
        setTimeout(() => reject(new Error('timeout')), 1500);
      });
      orientMode = 'relative';
      return;
    } catch (e) {
      latest.q = null;
      console.warn('RelativeOrientationSensor failed, trying deviceorientation', e);
    }
  }
  if (typeof DeviceOrientationEvent !== 'undefined') {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return; } catch { return; }
    }
    await new Promise((resolve) => {
      window.addEventListener('deviceorientation', (e) => {
        if (e.alpha == null) return;
        latest.q = eulerToQuat(e.alpha, e.beta, e.gamma);
        if (orientMode === 'none') { orientMode = 'deviceorientation'; resolve(); }
      });
      setTimeout(resolve, 1500);
    });
  }
}

/** W3C DeviceOrientation (Z-X'-Y'' intrinsic) → quaternion [x, y, z, w]. */
function eulerToQuat(alpha, beta, gamma) {
  const D = Math.PI / 360; // half-angle in radians
  const cX = Math.cos(beta * D), cY = Math.cos(gamma * D), cZ = Math.cos(alpha * D);
  const sX = Math.sin(beta * D), sY = Math.sin(gamma * D), sZ = Math.sin(alpha * D);
  return [sX * cY * cZ - cX * sY * sZ, cX * sY * cZ + sX * cY * sZ, cX * cY * sZ + sX * sY * cZ, cX * cY * cZ - sX * sY * sZ];
}

// Quaternion conventions differ between APIs (device→world vs world→device). Gravity settles it: rotated into
// the world frame, the "up" gravity reading must point along +Z. Vote over the first frames, then keep the winner.
const conv = { votes: 0, frames: 0, conj: false, decided: false };
function rotate(q, v, conj) {
  const x = conj ? -q[0] : q[0], y = conj ? -q[1] : q[1], z = conj ? -q[2] : q[2], w = q[3];
  return [
    (1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - z * w) * v[1] + 2 * (x * z + y * w) * v[2],
    2 * (x * y + z * w) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - x * w) * v[2],
    2 * (x * z - y * w) * v[0] + 2 * (y * z + x * w) * v[1] + (1 - 2 * (x * x + y * y)) * v[2],
  ];
}

// Face heading: horizontal direction of the screen normal (device +Z), relative to `yaw0` (the calibration pose,
// screen toward the player). 0° = screen toward the player (forehand), ±180° = screen toward the laptop (backhand).
let yaw0 = null;
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
function orientation() {
  const q = latest.q;
  if (!q) return null;
  if (!conv.decided) {
    const gm = Math.hypot(...latest.g) || 9.81;
    const zA = rotate(q, latest.g, false)[2] / gm, zB = rotate(q, latest.g, true)[2] / gm;
    if (Math.abs(zA - zB) > 0.3) conv.votes += zA > zB ? -1 : 1;
    if (Math.abs(conv.votes) >= 20 || ++conv.frames > 300) { conv.decided = true; conv.conj = conv.votes > 0; }
    return null;
  }
  const n = rotate(q, [0, 0, 1], conv.conj);
  const hor = Math.hypot(n[0], n[1]);
  const heading = Math.atan2(n[1], n[0]) * 180 / Math.PI;
  if (yaw0 === null && hor > 0.6) yaw0 = heading; // START was just tapped, so the screen faces the player
  if (yaw0 === null) return null;
  const aw = rotate(q, latest.a, conv.conj);
  const r = yaw0 * Math.PI / 180;
  return {
    heading,
    h: hor > 0.3 ? wrapDeg(heading - yaw0) : null,   // null: face pointing at floor/sky, heading meaningless
    lat: -Math.sin(r) * aw[0] + Math.cos(r) * aw[1], // linear accel along the player's right (world frame)
    hor,
  };
}

function startGeneric() {
  return new Promise((resolve, reject) => {
    const opts = { frequency: 60, referenceFrame: 'device' };
    let lin, grav, gyro;
    try {
      lin = new LinearAccelerationSensor(opts);
      grav = new GravitySensor(opts);
      gyro = new Gyroscope(opts);
    } catch (e) {
      reject(e);
      return;
    }
    let settled = false;
    const fail = (ev) => {
      const err = ev.error || ev;
      if (!settled) {
        settled = true;
        if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) reject(new Error(SENSOR_HELP));
        else reject(err);
      } else {
        setChip('SENSOR ERROR', 'bad');
      }
    };
    for (const s of [lin, grav, gyro]) s.addEventListener('error', fail);
    grav.addEventListener('reading', () => { latest.g[0] = grav.x; latest.g[1] = grav.y; latest.g[2] = grav.z; });
    gyro.addEventListener('reading', () => { latest.w[0] = gyro.x; latest.w[1] = gyro.y; latest.w[2] = gyro.z; });
    lin.addEventListener('reading', () => {
      if (!settled) { settled = true; resolve(); }
      latest.a[0] = lin.x; latest.a[1] = lin.y; latest.a[2] = lin.z;
      emitFrame(lin.timestamp || performance.now());
    });
    grav.start(); gyro.start(); lin.start();
    setTimeout(() => { if (!settled) { settled = true; reject(new Error('Sensors did not start (timeout).')); } }, 2500);
  });
}

async function startDeviceMotion() {
  if (typeof DeviceMotionEvent === 'undefined') throw new Error('This browser has no motion sensor support. Use Chrome on Android.');
  if (isIOS) {
    const res = await DeviceMotionEvent.requestPermission();
    if (res !== 'granted') throw new Error('Motion permission was denied. Reload and tap START, then Allow.');
  }
  const sign = isIOS ? -1 : 1; // iOS reports the opposite sign convention (untested target)
  const D2R = Math.PI / 180;
  return new Promise((resolve, reject) => {
    let got = false;
    window.addEventListener('devicemotion', (e) => {
      const a = e.acceleration, ag = e.accelerationIncludingGravity, r = e.rotationRate;
      if (!a || a.x == null || !ag) return;
      if (!got) { got = true; resolve(); }
      latest.a[0] = sign * a.x; latest.a[1] = sign * a.y; latest.a[2] = sign * a.z;
      latest.g[0] = sign * (ag.x - a.x); latest.g[1] = sign * (ag.y - a.y); latest.g[2] = sign * (ag.z - a.z);
      if (r) { latest.w[0] = (r.beta || 0) * D2R; latest.w[1] = (r.gamma || 0) * D2R; latest.w[2] = (r.alpha || 0) * D2R; }
      emitFrame(e.timeStamp || performance.now());
    });
    setTimeout(() => { if (!got) reject(new Error(SENSOR_HELP)); }, 2500);
  });
}

const r3 = (v) => Math.round(v * 1000) / 1000;
function emitFrame(t) {
  frames++;
  const mag = Math.hypot(latest.a[0], latest.a[1], latest.a[2]);
  glow = Math.max(glow * 0.9, Math.min(1, mag / 25));
  const o = orientation();
  lastFace = o?.h ?? null;
  if (calib.active) {
    calib.samples.push([latest.g[0], latest.g[1], latest.g[2]]);
    if (o && o.hor > 0.6) calib.headings.push(o.heading);
  }
  if (net?.open) {
    const f = {
      type: 'frame', t: Math.round(t * 10) / 10,
      a: [r3(latest.a[0]), r3(latest.a[1]), r3(latest.a[2])],
      g: [r3(latest.g[0]), r3(latest.g[1]), r3(latest.g[2])],
      w: [r3(latest.w[0]), r3(latest.w[1]), r3(latest.w[2])],
    };
    if (o) { f.h = o.h === null ? null : Math.round(o.h * 10) / 10; f.lat = r3(o.lat); }
    net.send(f);
  }
}

// orb glow + Hz
function tick() {
  requestAnimationFrame(tick);
  glow *= 0.94;
  ui.orb.style.setProperty('--g', glow.toFixed(3));
  const now = performance.now();
  if (now - hzT >= 1000) {
    hz = Math.round((frames * 1000) / (now - hzT));
    frames = 0; hzT = now;
    sensorsOk = hz > 10;
    if (net?.open) setChip(sensorsOk ? `SENSORS OK · ${hz}Hz` : 'NO SENSOR DATA', sensorsOk ? 'ok' : 'bad');
    if (sensorMode) {
      const face = orientMode === 'none' ? 'no orientation' : lastFace === null ? 'face —'
        : `${Math.abs(lastFace) <= 70 ? 'FOREHAND' : Math.abs(lastFace) >= 110 ? 'BACKHAND' : 'EDGE-ON'} face ${Math.round(lastFace)}°`;
      ui.mode.textContent = `${sensorMode} · ${hz} Hz · ${face}${isIOS ? ' · iPhone (untested)' : ''}`;
    }
  }
}
requestAnimationFrame(tick);

// ---------------------------------------------------------------- network
function connect() {
  setChip('CONNECTING', 'connecting');
  net = new Net({
    url: () => wsUrl(room, 'phone'),
    onState: (s) => {
      if (s === 'open') {
        setChip('CONNECTED', 'connected');
        net.send({ type: 'info', sensorMode, hz: 60, orientation: orientMode });
      } else if (s === 'connecting') setChip('CONNECTING', 'connecting');
      else setChip('RECONNECTING…', 'connecting');
    },
    onMessage: onMessage,
  });
}

function onMessage(msg) {
  switch (msg.type) {
    case 'ping': net.send({ type: 'pong', t: msg.t }); break;
    case 'haptic':
      if (Array.isArray(msg.pattern)) {
        try { navigator.vibrate?.(msg.pattern.slice(0, 10).map((n) => Math.max(0, Math.min(1000, Number(n) || 0)))); } catch { /* ignore */ }
        flashOrb(msg.pattern.length >= 3);
      }
      break;
    case 'calibrate': calibrate(); break;
    case 'status': setStatus(String(msg.text || '').slice(0, 40), msg.color || '#fff'); break;
    case 'peer':
      if (msg.role === 'laptop') setStatus(msg.state === 'joined' ? 'LAPTOP READY' : 'LAPTOP LEFT', msg.state === 'joined' ? '#22e5ff' : '#ff2e88');
      break;
  }
}

function flashOrb(perfect) {
  ui.orb.classList.remove('flash', 'perfect');
  void ui.orb.offsetWidth;
  ui.orb.classList.add('flash');
  if (perfect) ui.orb.classList.add('perfect');
}

// ---------------------------------------------------------------- calibration
const calib = { active: false, running: false, samples: [], headings: [] };
async function calibrate() {
  if (calib.running || !sensorMode) return;
  calib.running = true;
  ui.cal.disabled = true;
  setStatus('HOLD STILL', '#22e5ff');
  for (const n of [3, 2, 1]) {
    ui.countdown.textContent = n;
    try { navigator.vibrate?.([15]); } catch { /* ignore */ }
    await sleep(700);
  }
  ui.countdown.textContent = '•';
  calib.samples = [];
  calib.headings = [];
  calib.active = true;
  await sleep(1000);
  calib.active = false;
  const s = calib.samples;
  const g0 = [0, 0, 0];
  if (s.length) {
    for (const v of s) { g0[0] += v[0]; g0[1] += v[1]; g0[2] += v[2]; }
    for (let i = 0; i < 3; i++) g0[i] = Math.round((g0[i] / s.length) * 1000) / 1000;
  } else {
    g0[1] = 9.81;
  }
  if (calib.headings.length) {
    // circular mean of the face heading = new "screen toward the player" reference (re-centres pointing too)
    let sx = 0, sy = 0;
    for (const hd of calib.headings) { sx += Math.cos(hd * Math.PI / 180); sy += Math.sin(hd * Math.PI / 180); }
    yaw0 = Math.atan2(sy, sx) * 180 / Math.PI;
  }
  net?.send({ type: 'calibrated', g0, yaw: calib.headings.length > 0 });
  try { navigator.vibrate?.([20, 30, 40]); } catch { /* ignore */ }
  ui.countdown.textContent = '';
  setStatus('CALIBRATED ✔', '#7dffb2');
  ui.cal.disabled = false;
  calib.running = false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- wake lock
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener?.('release', () => { wakeLock = null; });
    }
  } catch { /* battery saver etc. */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && sensorMode) {
    if (!wakeLock) requestWakeLock();
    net?.kick();
  }
});
