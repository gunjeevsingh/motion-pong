// Plain-Node checks: shot solver lands on the opponent half and clears the net; rules + swing detector sanity.
import assert from 'node:assert/strict';
import { solveShot, heightAtNet, NET_CLEAR_Y } from '../public/js/game/shot-solver.js';
import { Rules, serverFor, matchWinner } from '../public/js/game/rules.js';
import { SwingDetector } from '../public/js/input/swing-detector.js';
import { WORLD } from '../public/js/config.js';

const { TABLE_W, TABLE_L, TABLE_Y, NET_H, BALL_R, PADDLE_Z } = WORLD;
const G = 9.0;
let checks = 0;

// Simulate the ballistic flight and find where it first comes down to table height.
function landing(from, vel) {
  const a = 0.5 * G, b = -vel.y, c = TABLE_Y + BALL_R - from.y; // y(t) = from.y + vy t - ½gt² = ty
  const disc = b * b - 4 * a * c;
  const t = (-b + Math.sqrt(disc)) / (2 * a);
  return { x: from.x + vel.x * t, z: from.z + vel.z * t, t };
}

for (const dir of [1, -1]) {
  for (let i = 0; i < 1000; i++) {
    const from = {
      x: (Math.random() * 2 - 1) * 1.1,
      y: TABLE_Y + 0.05 + Math.random() * 0.6,
      z: dir * (PADDLE_Z + (Math.random() * 0.5 - 0.25)),
    };
    const shot = solveShot({
      from, dir, power: Math.random(), aim: Math.random() * 2 - 1, loft: Math.random() * 2 - 1,
      quality: 1, perfect: Math.random() < 0.3, rallyCount: Math.floor(Math.random() * 30),
      baseLandTime: [1.05, 0.85, 0.65][i % 3], gravity: G,
    });
    const land = landing(from, shot.vel);
    assert.ok(Math.abs(land.x) <= TABLE_W / 2, `x out: ${land.x}`);
    assert.ok(Math.abs(land.z) <= TABLE_L / 2, `z long: ${land.z}`);
    assert.ok(Math.sign(land.z) === -dir, `wrong half: ${land.z} dir ${dir}`);
    const hn = heightAtNet(from, shot.vel, G);
    assert.ok(hn >= TABLE_Y + NET_H + BALL_R, `net: ${hn.toFixed(3)} < ${(TABLE_Y + NET_H + BALL_R).toFixed(3)}`);
    assert.ok(hn >= NET_CLEAR_Y - 1e-9, 'clearance margin');
    checks += 4;
  }
}
console.log('✔ shot-solver: 2000 random quality-1 shots land on the opponent half and clear the net');

// Rules
{
  const r = new Rules();
  r.onHit(1);
  assert.deepEqual(r.onBounce(1), { winner: -1, reason: 'own-side' });
  r.onHit(1);
  assert.equal(r.onBounce(-1), null);
  assert.deepEqual(r.onBounce(-1), { winner: 1, reason: 'double' });
  r.onHit(-1);
  assert.deepEqual(r.onDead('net'), { winner: 1, reason: 'net' });
  r.onHit(-1);
  r.onBounce(1);
  assert.deepEqual(r.onDead('out'), { winner: -1, reason: 'missed' });
  r.onHit(1);
  assert.deepEqual(r.onDead('out'), { winner: -1, reason: 'out' });
  assert.equal(serverFor(0, 0), 1); assert.equal(serverFor(1, 0), 1);
  assert.equal(serverFor(1, 1), -1); assert.equal(serverFor(3, 1), 1);
  assert.equal(serverFor(10, 10), 1); assert.equal(serverFor(11, 10), -1); assert.equal(serverFor(11, 11), 1);
  assert.equal(matchWinner(11, 9), 1); assert.equal(matchWinner(11, 10), 0); assert.equal(matchWinner(10, 12), -1);
  checks += 16;
  console.log('✔ rules: own-side fault, double bounce, net, out, serve rotation, win-by-2');
}

// Swing detector
{
  const d = new SwingDetector();
  const evs = [];
  d.onSwing((e) => evs.push(e));
  let t = 0;
  const frame = (ax, ay) => d.push({ t: (t += 16.7), a: [ax, ay, 0], g: [0, 9.81, 0], w: [0, 0, 0] });
  for (let i = 0; i < 30; i++) frame(0.2, 0.1);
  [6, 14, 22, 26, 20, 12, 4].forEach((m) => frame(m * 0.2, m));
  for (let i = 0; i < 30; i++) frame(0.2, 0.1);
  assert.equal(evs.length, 1, 'one swing');
  assert.ok(evs[0].power > 0.5 && evs[0].power <= 1, `power ${evs[0].power}`);
  assert.ok(evs[0].aim > 0, `aim right ${evs[0].aim}`);
  checks += 3;
  console.log(`✔ swing-detector: spike → 1 swing (power ${evs[0].power.toFixed(2)}, aim ${evs[0].aim.toFixed(2)})`);
}

// Whiff forgiveness: cooldown waived, but the same stroke's deceleration spike is ignored.
{
  const d = new SwingDetector();
  const evs = [];
  d.onSwing((e) => { evs.push(e); d.forgiveCooldown(); }); // treat every swing as a whiff
  let t = 0;
  const frame = (m) => d.push({ t: (t += 16.7), a: [0, m, 0], g: [0, 9.81, 0], w: [0, 0, 0] });
  for (let i = 0; i < 20; i++) frame(0.2);
  [8, 15, 22, 25, 20, 12, 5, 8, 13, 9, 3].forEach(frame);  // stroke + its decel bump ~70 ms later
  assert.equal(evs.length, 1, 'decel spike ignored');
  for (let i = 0; i < 3; i++) frame(0.2);
  [12, 20, 26, 21, 4].forEach(frame);                       // real stroke ~200 ms after the whiff
  assert.equal(evs.length, 2, 'next stroke after a whiff is not eaten by the cooldown');
  checks += 2;
  console.log('✔ swing-detector: whiff waives cooldown without double-counting the deceleration');
}

console.log(`\nAll ${checks} checks passed.`);
