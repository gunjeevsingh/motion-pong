#!/usr/bin/env node
// Impersonates the phone: 60 Hz noisy idle frames + a scripted swing every 2.5 s.
// Also fakes the orientation sensor: forehand/backhand face turns.
//
//   npm run fake-phone -- ABCD                 (swing every 2.5 s, alternating forehand / backhand)
//   npm run fake-phone -- ABCD --manual        (Enter = forehand, "b" = backhand, l/r = aim, s = soft)
//   npm run fake-phone -- ABCD --no-orientation (phone without an orientation sensor: stroke guessed from ball side)
//   npm run fake-phone -- ABCD --every 1.8 --host 192.168.1.23:3000
import WebSocket from 'ws';
import readline from 'node:readline';

const args = process.argv.slice(2);
const room = (args.find((a) => /^[A-Za-z]{4}$/.test(a)) || '').toUpperCase();
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const host = opt('--host', 'localhost:3000');
const every = Number(opt('--every', '2.5')) * 1000;
const manual = args.includes('--manual');
const quiet = args.includes('--quiet');
const orientation = !args.includes('--no-orientation');

if (!room) {
  console.log('Usage: npm run fake-phone -- <ROOM> [--manual] [--every 2.5] [--host localhost:3000] [--quiet]');
  console.log('The 4-letter ROOM code is shown on the laptop page.');
  process.exit(1);
}

const url = `ws://${host}/ws?room=${room}&role=phone`;
let ws = null;
let t0 = Date.now();
const now = () => Date.now() - t0;
let swingQueue = []; // scheduled spike samples
let swings = 0;

const noise = (s) => (Math.random() * 2 - 1) * s;
const r3 = (v) => Math.round(v * 1000) / 1000;

function connect() {
  ws = new WebSocket(url, { perMessageDeflate: false });
  ws.on('open', () => {
    console.log(`📱 fake phone connected to room ${room} (${url})`);
    ws.send(JSON.stringify({ type: 'info', sensorMode: 'fake', hz: 60, orientation: orientation ? 'relative' : 'none' }));
  });
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: m.t }));
    else if (m.type === 'calibrate') {
      console.log('🎯 calibrate requested → sending g0 in ~1.5 s');
      setTimeout(() => send({ type: 'calibrated', g0: [0, 9.81, 0], yaw: orientation }), 1500);
    } else if (m.type === 'haptic') { if (!quiet) console.log(`  📳 haptic ${JSON.stringify(m.pattern)}`); }
    else if (m.type === 'status') { if (!quiet) console.log(`  💬 status "${m.text}"`); }
    else if (m.type === 'peer') console.log(`  👥 ${m.role} ${m.state}`);
  });
  ws.on('close', () => { console.log('connection closed — retrying in 1 s'); setTimeout(connect, 1000); });
  ws.on('error', (e) => { console.log('ws error:', e.message); });
}

function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

let backhand = false;   // current face: false = back toward the table (forehand), true = screen toward it

/** Queue a swing: accel spike ≈ peak m/s² with a lateral component (aim). */
function swing(peak = 25, lateral = 0.25, bh = false) {
  const shape = [0.3, 0.6, 0.85, 1.0, 0.8, 0.5, 0.25, -0.3, -0.5, -0.3, -0.1]; // accel then decel
  // ~300 ms of set-up (face already turned) before the stroke, like a real player preparing the wing
  const setup = Array.from({ length: 18 }, () => ({ k: 0, lat: lateral }));
  swingQueue = setup.concat(shape.map((k) => ({ k: k * peak, lat: lateral })));
  backhand = bh;
  swings++;
  if (!quiet) console.log(`🏓 swing #${swings}: ${bh ? 'BACKHAND' : 'FOREHAND'} peak ${peak.toFixed(1)} m/s², lateral ${lateral.toFixed(2)}`);
}

connect();

// 60 Hz frame loop
setInterval(() => {
  let a = [noise(0.25), noise(0.25), noise(0.25)];
  let w = [noise(0.05), noise(0.05), noise(0.05)];
  const s = swingQueue.shift();
  if (s) {
    // forward thrust along -z (toward the laptop) + upward + lateral x
    const m = s.k;
    a = [m * s.lat + noise(0.3), m * 0.35 + noise(0.3), -m * 0.9 + noise(0.3)];
    w = [noise(0.3), -s.lat * 4 * Math.sign(m) + noise(0.2), noise(0.3)];
  }
  const f = { type: 'frame', t: now(), a: a.map(r3), g: [r3(noise(0.05)), r3(9.81 + noise(0.05)), r3(noise(0.05))], w: w.map(r3) };
  if (orientation) {
    // face heading: ≈0° forehand, ≈180° backhand (with some wobble). Forehand swings travel right→left
    // across the body (lat < 0 for a right-hander), backhands left→right.
    let h = 10 * Math.sin(now() / 4000) + (backhand ? 180 : 0) + noise(1.5);
    h = ((((h + 180) % 360) + 360) % 360) - 180;
    f.h = Math.round(h * 10) / 10;
    f.lat = r3(s ? (backhand ? 1 : -1) * Math.abs(s.k) * 0.6 * Math.sign(s.k) : noise(0.2));
  }
  send(f);
}, 1000 / 60);

if (manual) {
  console.log('Manual mode: Enter = forehand swing, "b" + Enter = backhand. Add "l"/"r" to aim, "s" for soft.');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const l = line.trim().toLowerCase();
    const lateral = l.includes('l') ? -0.5 : l.includes('r') ? 0.5 : 0.1;
    swing(l.includes('s') ? 16 : 25, lateral, l.includes('b'));
  });
} else {
  setInterval(() => swing(22 + Math.random() * 6, (Math.random() * 2 - 1) * 0.4 + 0.15, swings % 2 === 1), every);
}
