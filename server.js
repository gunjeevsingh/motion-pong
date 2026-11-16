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

// ---------- Express app ----------
const app = express();
app.disable('x-powered-by');
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
  if (!ROOM_RE.test(room) || (role !== 'laptop' && role !== 'phone')) {
    ws.close(4000, 'bad room or role');
    return;
  }
  req.socket.setNoDelay(true);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let r = rooms.get(room);
  if (!r) { r = { laptop: null, phone: null }; rooms.set(room, r); }
  const old = r[role];
  if (old && old !== ws) {
    old._replaced = true;
    try { old.close(4001, 'replaced'); } catch { /* ignore */ }
  }
  r[role] = ws;
  const other = role === 'laptop' ? 'phone' : 'laptop';
  send(r[other], { type: 'peer', role, state: 'joined' });
  if (r[other]) send(ws, { type: 'peer', role: other, state: 'joined' });
  log(`${role} joined room ${room}`);

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    const cur = rooms.get(room);
    if (!cur || cur[role] !== ws) return;
    const peer = cur[other];
    if (peer && peer.readyState === peer.OPEN) peer.send(data.toString());
  });

  ws.on('close', () => {
    const cur = rooms.get(room);
    if (!cur) return;
    if (cur[role] === ws) {
      cur[role] = null;
      send(cur[other], { type: 'peer', role, state: 'left' });
      log(`${role} left room ${room}`);
    }
    if (!cur.laptop && !cur.phone) rooms.delete(room);
  });
  ws.on('error', () => {});
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

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  console.log(`[${t}] ${msg}`);
}

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
