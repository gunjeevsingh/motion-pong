// Motion Pong server: static files + WebSocket room relay over HTTP (:3000) and HTTPS (:3443).
import express from 'express';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { getLanIPs, ensureCert } from './scripts/make-cert.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Ports: `npm start -- --port 3100 --https-port 3543` (works on every OS) or PORT / HTTPS_PORT env vars.
const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const HTTP_PORT = Number(arg('--port') || process.env.PORT || 3000);
const HTTPS_PORT = Number(arg('--https-port') || process.env.HTTPS_PORT || 3443);
const ROOM_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
// Logging: `--verbose` also logs every HTTP request + haptic/status messages; `--quiet` logs only errors.
const VERBOSE = argv.includes('--verbose');
const QUIET = argv.includes('--quiet');
const STATS_EVERY_S = 10;

// ---------- Logging ----------
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const C = { dim: 2, bold: 1, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36 };
const paint = (code, s) => (COLOR && code ? `\x1b[${code}m${s}\x1b[0m` : s);

function log(msg, { room, color } = {}) {
  if (QUIET && color !== C.red) return; // errors still show in --quiet
  const t = new Date().toTimeString().slice(0, 8);
  const tag = room ? paint(C.magenta, `[${room}] `) : '';
  console.log(`${paint(C.dim, `[${t}]`)} ${tag}${paint(color, msg)}`);
}

const clientIp = (req) => String(req.socket.remoteAddress || '?').replace(/^::ffff:/, '');

/** "Android · Chrome 131" from a user-agent string. */
function device(ua = '') {
  if (!ua) return 'script (no user-agent)';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const m = ua.match(/(Edg|CriOS|FxiOS|Firefox|Chrome|Version)\/(\d+)/);
  const name = m ? ({ Edg: 'Edge', CriOS: 'Chrome', FxiOS: 'Firefox', Version: 'Safari' }[m[1]] || m[1]) : ua.split(/[ /]/)[0];
  return [os, m ? `${name} ${m[2]}` : name].filter(Boolean).join(' · ');
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

// ---------- Express app ----------
const app = express();
app.disable('x-powered-by');
// Log page loads (always) and every request (--verbose). Seeing the phone's page load proves it can reach the laptop.
app.use((req, res, next) => {
  const page = req.path === '/' || req.path.endsWith('.html') || req.path === '/phone';
  if (page || VERBOSE) {
    res.on('finish', () => {
      const ok = res.statusCode < 400;
      log(`${req.method} ${req.originalUrl} → ${res.statusCode}  (${clientIp(req)} via ${req.secure ? 'https' : 'http'}, ${device(req.headers['user-agent'])})`,
        { color: ok ? (page ? C.blue : C.dim) : C.red });
    });
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three')));

app.get('/api/info', (_req, res) => {
  res.json({ ips: getLanIPs(), httpPort: HTTP_PORT, httpsPort: httpsServer ? HTTPS_PORT : null });
});

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '').slice(0, 512);
  if (!text) return res.status(400).send('missing text');
  try {
    const svg = await QRCode.toString(text, {
      type: 'svg', margin: 1, errorCorrectionLevel: 'M',
      color: { dark: '#ffffffff', light: '#00000000' },
    });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

// ---------- Rooms ----------
/** @type {Map<string, {laptop: import('ws').WebSocket|null, phone: import('ws').WebSocket|null}>} */
const rooms = new Map();

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function handleConnection(ws, req) {
  const url = new URL(req.url, 'http://x');
  const room = String(url.searchParams.get('room') || '').toUpperCase();
  const role = url.searchParams.get('role');
  const ip = clientIp(req);
  if (!ROOM_RE.test(room) || (role !== 'laptop' && role !== 'phone')) {
    log(`rejected WebSocket from ${ip}: bad room "${room}" or role "${role}"`, { color: C.red });
    ws.close(4000, 'bad room or role');
    return;
  }
  req.socket.setNoDelay(true);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let r = rooms.get(room);
  if (!r) {
    r = { laptop: null, phone: null, stream: newStream(), rtt: 0, pingAt: 0 };
    rooms.set(room, r);
    log(`room created (${rooms.size} active)`, { room, color: C.dim });
  }
  const old = r[role];
  if (old && old !== ws) {
    log(`${role} reconnected from ${ip}: closing the previous ${role} connection`, { room, color: C.yellow });
    old._replaced = true;
    try { old.close(4001, 'replaced'); } catch { /* ignore */ }
  }
  r[role] = ws;
  const other = role === 'laptop' ? 'phone' : 'laptop';
  send(r[other], { type: 'peer', role, state: 'joined' });
  if (r[other]) send(ws, { type: 'peer', role: other, state: 'joined' });
  const joinedAt = Date.now();
  let msgCount = 0;
  if (role === 'phone') r.stream = newStream();
  log(`${role === 'phone' ? '📱 phone' : '💻 laptop'} joined from ${ip} via ${req.socket.encrypted ? 'https' : 'http'} (${device(req.headers['user-agent'])})` +
    ` · ${r[other] ? `${other} already here — paired!` : `waiting for ${other}`}`, { room, color: C.green });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const cur = rooms.get(room);
    if (!cur || cur[role] !== ws) return;
    msgCount++;
    const text = data.toString();
    let msg = null;
    try { msg = JSON.parse(text); } catch { /* relay as-is */ }
    if (msg?.type === 'log' && role === 'laptop') { gameLog(room, msg); return; } // for the terminal only
    const peer = cur[other];
    if (peer && peer.readyState === peer.OPEN) peer.send(text);
    if (msg) observe(room, cur, role, msg);
  });

  ws.on('close', (code, reason) => {
    const cur = rooms.get(room);
    if (!cur) return;
    const why = `code ${code}${reason?.length ? ` "${reason}"` : ''}`;
    if (cur[role] === ws) {
      cur[role] = null;
      send(cur[other], { type: 'peer', role, state: 'left' });
      log(`${role === 'phone' ? '📱 phone' : '💻 laptop'} left after ${fmtDuration(Date.now() - joinedAt)} (${msgCount} messages, ${why})`,
        { room, color: C.yellow });
    } else if (VERBOSE) {
      log(`old ${role} connection closed (${why})`, { room, color: C.dim });
    }
    if (!cur.laptop && !cur.phone) {
      rooms.delete(room);
      log(`room closed (${rooms.size} active)`, { room, color: C.dim });
    }
  });
  ws.on('error', (e) => log(`${role} socket error: ${e.message}`, { room, color: C.red }));
}

function attachWss(server) {
  const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 64 * 1024 });
  wss.on('connection', handleConnection);
  wss.on('error', () => { /* listen errors are reported by listen() below */ });
  const iv = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 10_000);
  wss.on('close', () => clearInterval(iv));
  return wss;
}

// ---------- Phone stream monitoring ----------
function newStream() {
  return { frames: 0, maxMag: 0, gaps: 0, lastAt: 0, since: Date.now(), stalled: false, ever: false };
}

/** Peek at relayed messages so the terminal shows what's going on (messages are still relayed verbatim). */
function observe(room, r, role, msg) {
  const now = Date.now();
  switch (msg.type) {
    case 'frame': {
      const s = r.stream;
      if (s.stalled) log(`📱 sensor stream resumed after ${fmtDuration(now - s.lastAt)}`, { room, color: C.green });
      else if (!s.ever) log('📱 sensor stream started', { room, color: C.green });
      if (s.lastAt && now - s.lastAt > 100) s.gaps++;
      s.frames++;
      s.lastAt = now;
      s.stalled = false;
      s.ever = true;
      if (Array.isArray(msg.a)) s.maxMag = Math.max(s.maxMag, Math.hypot(+msg.a[0] || 0, +msg.a[1] || 0, +msg.a[2] || 0));
      break;
    }
    case 'info':
      log(`📱 sensors: ${msg.sensorMode || 'unknown'} @ ${msg.hz || '?'} Hz requested · orientation: ${msg.orientation || 'none'}` +
        `${msg.orientation === 'none' ? ' (no face rule — stroke guessed from the ball side)' : ''}`, { room, color: msg.orientation === 'none' ? C.yellow : C.cyan });
      break;
    case 'calibrate':
      log('💻 asked the phone to calibrate — hold it still', { room, color: C.cyan });
      break;
    case 'calibrated': {
      const g = Array.isArray(msg.g0) ? msg.g0.map((v) => (+v).toFixed(2)).join(', ') : '?';
      log(`📱 calibrated · neutral gravity [${g}]${msg.yaw ? ' · facing re-centred' : ''}`, { room, color: C.cyan });
      break;
    }
    case 'ping':
      if (role === 'laptop') r.pingAt = now;
      break;
    case 'pong':
      if (role === 'phone' && r.pingAt) {
        const rtt = now - r.pingAt;
        r.rtt = r.rtt ? r.rtt * 0.7 + rtt * 0.3 : rtt;
        r.pingAt = 0;
      }
      break;
    case 'haptic':
      if (VERBOSE) log(`→ 📱 haptic [${(msg.pattern || []).join(', ')}]`, { room, color: C.dim });
      break;
    case 'status':
      if (VERBOSE) log(`→ 📱 status "${msg.text}"`, { room, color: C.dim });
      break;
  }
}

const KIND_COLOR = { match: C.magenta, point: C.yellow, hit: C.green, perfect: C.yellow, whiff: C.red, info: C.cyan, warn: C.red, stats: C.dim };

/** Game events sent by the laptop page ({type:'log', kind, text}). */
function gameLog(room, msg) {
  const text = String(msg.text || '').slice(0, 300);
  if (text) log(`🎮 ${text}`, { room, color: KIND_COLOR[msg.kind] });
}

// Once a second: detect stalled phone streams; every STATS_EVERY_S: per-room stream stats.
let statsTick = 0;
setInterval(() => {
  statsTick++;
  const now = Date.now();
  for (const [room, r] of rooms) {
    const s = r.stream;
    if (!r.phone) continue;
    if (s.ever && !s.stalled && now - s.lastAt > 2000) {
      s.stalled = true;
      log('📱 sensor stream stalled for 2s+ (phone screen off, Chrome in background, or Wi-Fi drop?)', { room, color: C.red });
    }
    if (statsTick % STATS_EVERY_S === 0 && s.ever) {
      const secs = (now - s.since) / 1000;
      const hz = s.frames / secs;
      const bad = hz < 40 || s.gaps > 3;
      log(`📊 phone stream ${hz.toFixed(0)} Hz · peak |a| ${s.maxMag.toFixed(1)} m/s² · ${s.gaps} gaps >100ms` +
        `${r.rtt ? ` · phone RTT ~${Math.round(r.rtt)} ms` : ''}${r.laptop ? '' : ' · ⚠ no laptop in room'}`,
        { room, color: bad ? C.yellow : C.dim });
      Object.assign(s, { frames: 0, maxMag: 0, gaps: 0, since: now });
    }
  }
}, 1000).unref();

// ---------- Servers ----------
const httpServer = http.createServer(app);
attachWss(httpServer);

let httpsServer = null;
try {
  const cert = ensureCert();
  httpsServer = https.createServer({ key: cert.key, cert: cert.cert }, app);
  attachWss(httpsServer);
} catch (e) {
  console.warn('\n⚠️  Could not create HTTPS certificate — running HTTP only.');
  console.warn('   Phone motion sensors need HTTPS; see README "Option B" (Chrome flag) or "Option C" (tunnel).');
  console.warn('   Reason:', e.message, '\n');
}

function listen(server, port, name) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n✖ Port ${port} (${name}) is already in use. Stop the other process or run: npm start -- ${name === 'HTTP' ? '--port' : '--https-port'} <other port>\n`);
      }
      reject(err);
    });
    server.listen(port, '0.0.0.0', resolve);
  });
}

try {
  await listen(httpServer, HTTP_PORT, 'HTTP');
  if (httpsServer) await listen(httpsServer, HTTPS_PORT, 'HTTPS');
} catch {
  process.exit(1);
}
banner();
log(`waiting for connections… (logging: ${QUIET ? 'quiet' : VERBOSE ? 'verbose' : 'normal — add --verbose for every request'})`, { color: C.dim });
process.on('SIGINT', () => {
  log(`shutting down (${rooms.size} active room${rooms.size === 1 ? '' : 's'})`, { color: C.dim });
  process.exit(0);
});

function banner() {
  const ips = getLanIPs();
  const lines = [
    'MOTION PONG is running!',
    '',
    `Laptop (open in Chrome):  http://localhost:${HTTP_PORT}`,
    '',
    'Phone (same Wi-Fi) — scan the QR on the laptop page, or open:',
  ];
  if (!ips.length) lines.push('  (no LAN IPv4 found — are you on Wi-Fi?)');
  for (const ip of ips) {
    lines.push(httpsServer
      ? `  https://${ip}:${HTTPS_PORT}/phone.html?room=<CODE>`
      : `  http://${ip}:${HTTP_PORT}/phone.html?room=<CODE>   (needs Chrome flag, see README)`);
  }
  lines.push('', 'The room CODE + QR are shown on the laptop page.', 'Ctrl+C to stop.');
  const w = Math.max(...lines.map((l) => l.length)) + 2;
  const bar = '─'.repeat(w);
  console.log(`\n┌${bar}┐`);
  for (const l of lines) console.log(`│ ${l.padEnd(w - 1)}│`);
  console.log(`└${bar}┘\n`);
}
