#!/usr/bin/env node
// Impersonates the phone: 60 Hz noisy idle frames + a scripted swing every 2.5 s.
//
//   npm run fake-phone -- ABCD                 (swing every 2.5 s)
//   npm run fake-phone -- ABCD --manual        (press Enter to swing; type l/r + Enter to aim)
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
    ws.send(JSON.stringify({ type: 'info', sensorMode: 'fake', hz: 60 }));
  });
  ws.on('message', (data) => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: m.t }));
    else if (m.type === 'calibrate') {
      console.log('🎯 calibrate requested → sending g0 in ~1.5 s');
      setTimeout(() => send({ type: 'calibrated', g0: [0, 9.81, 0] }), 1500);
    } else if (m.type === 'haptic') { if (!quiet) console.log(`  📳 haptic ${JSON.stringify(m.pattern)}`); }
    else if (m.type === 'status') { if (!quiet) console.log(`  💬 status "${m.text}"`); }
    else if (m.type === 'peer') console.log(`  👥 ${m.role} ${m.state}`);
  });
  ws.on('close', () => { console.log('connection closed — retrying in 1 s'); setTimeout(connect, 1000); });
  ws.on('error', (e) => { console.log('ws error:', e.message); });
}

function send(obj) { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); }

/** Queue a swing: accel spike ≈ peak m/s² with a lateral component (aim). */
function swing(peak = 25, lateral = 0.25) {
  const shape = [0.3, 0.6, 0.85, 1.0, 0.8, 0.5, 0.25, -0.3, -0.5, -0.3, -0.1]; // accel then decel
  swingQueue = shape.map((k) => ({ k: k * peak, lat: lateral }));
  swings++;
  if (!quiet) console.log(`🏓 swing #${swings}: peak ${peak.toFixed(1)} m/s², lateral ${lateral.toFixed(2)}`);
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
  send({ type: 'frame', t: now(), a: a.map(r3), g: [r3(noise(0.05)), r3(9.81 + noise(0.05)), r3(noise(0.05))], w: w.map(r3) });
}, 1000 / 60);

if (manual) {
  console.log('Manual mode: press Enter to swing (type "l" or "r" before Enter to aim, "s" for a soft swing).');
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const l = line.trim().toLowerCase();
    const lateral = l.includes('l') ? -0.5 : l.includes('r') ? 0.5 : 0.1;
    swing(l.includes('s') ? 16 : 25, lateral);
  });
} else {
  setInterval(() => swing(22 + Math.random() * 6, (Math.random() * 2 - 1) * 0.4 + 0.15), every);
}
