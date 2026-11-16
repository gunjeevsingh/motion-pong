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
const latest = { a: [0, 0, 0], g: [0, 9.81, 0], w: [0, 0, 0] };
let frames = 0, hzT = performance.now(), hz = 0;
let glow = 0;

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
  if (calib.active) calib.samples.push([latest.g[0], latest.g[1], latest.g[2]]);
  if (net?.open) {
    net.send({
      type: 'frame', t: Math.round(t * 10) / 10,
      a: [r3(latest.a[0]), r3(latest.a[1]), r3(latest.a[2])],
      g: [r3(latest.g[0]), r3(latest.g[1]), r3(latest.g[2])],
      w: [r3(latest.w[0]), r3(latest.w[1]), r3(latest.w[2])],
    });
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
    if (sensorMode) ui.mode.textContent = `${sensorMode} · ${hz} Hz${isIOS ? ' · iPhone (untested)' : ''}`;
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
        net.send({ type: 'info', sensorMode, hz: 60 });
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
const calib = { active: false, running: false, samples: [] };
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
  net?.send({ type: 'calibrated', g0 });
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
