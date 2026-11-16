// Generates a self-signed certificate with SANs for localhost + every LAN IPv4.
// Used automatically by server.js; run `npm run cert` to force regeneration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CERT_DIR = path.join(__dirname, '..', 'certs');
const KEY_FILE = path.join(CERT_DIR, 'key.pem');
const CERT_FILE = path.join(CERT_DIR, 'cert.pem');
const META_FILE = path.join(CERT_DIR, 'meta.json');

function isPrivate(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
}

/** Non-internal IPv4 addresses, private ranges first. */
export function getLanIPs() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      const v4 = ni.family === 'IPv4' || ni.family === 4;
      if (v4 && !ni.internal && !ni.address.startsWith('169.254.')) out.push(ni.address);
    }
  }
  return [...new Set(out)].sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}

/** Returns {key, cert}; regenerates when missing, expiring, or the LAN IPs changed. */
export function ensureCert({ force = false } = {}) {
  const ips = getLanIPs();
  const want = ['127.0.0.1', ...ips].sort();
  if (!force && fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE) && fs.existsSync(META_FILE)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_FILE, 'utf8'));
      const covered = want.every((ip) => meta.ips.includes(ip));
      if (covered && meta.expires > Date.now() + 7 * 864e5) {
        return { key: fs.readFileSync(KEY_FILE, 'utf8'), cert: fs.readFileSync(CERT_FILE, 'utf8') };
      }
    } catch { /* regenerate */ }
  }
  const altNames = [
    { type: 2, value: 'localhost' },
    ...want.map((ip) => ({ type: 7, ip })),
  ];
  const days = 365;
  const pems = selfsigned.generate([{ name: 'commonName', value: 'motion-pong.local' }], {
    days,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, pems.private);
  fs.writeFileSync(CERT_FILE, pems.cert);
  fs.writeFileSync(META_FILE, JSON.stringify({ ips: want, expires: Date.now() + days * 864e5 }, null, 2));
  console.log(`🔐 Generated self-signed certificate for localhost, ${want.join(', ')}`);
  return { key: pems.private, cert: pems.cert };
}

// CLI: node scripts/make-cert.js [--force]
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureCert({ force: process.argv.includes('--force') });
  console.log(`Certificate written to ${CERT_DIR}`);
}
