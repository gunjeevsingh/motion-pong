// One shot solver for both player and robot. Pure functions: also used by scripts/test-shot-solver.js in Node.
import { WORLD } from '../config.js';

const { TABLE_W, TABLE_L, TABLE_Y, NET_H, BALL_R } = WORLD;
const HALF_W = TABLE_W / 2;
const HALF_L = TABLE_L / 2;
const MARGIN = 0.08;
export const NET_CLEAR_Y = TABLE_Y + NET_H + BALL_R + 0.05;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export function gauss(sigma = 1, rand = Math.random) {
  if (sigma <= 0) return 0;
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {object} o
 * @param {{x:number,y:number,z:number}} o.from  hit position
 * @param {1|-1} o.dir       side of the hitter (+1 = player at +z, -1 = robot at -z)
 * @param {number} o.power   [0,1]
 * @param {number} o.aim     [-1,1] left/right on the opponent half
 * @param {number} o.loft    [-1,1] (+ = higher, slower)
 * @param {number} o.quality [0,1] timing quality
 * @param {boolean} [o.perfect]
 * @param {number} [o.aimErr]     override gaussian sigma (robot)
 * @param {number} [o.baseLandTime]
 * @param {number} [o.rallyCount]
 * @param {number} [o.gravity]
 * @param {() => number} [o.rand]
 * @returns {{vel:{x:number,y:number,z:number}, target:{x:number,y:number,z:number}, t:number}}
 */
export function solveShot(o) {
  const g = o.gravity ?? 9.0;
  const rand = o.rand ?? Math.random;
  const q = clamp(o.quality ?? 1, 0, 1);
  // Power scaling by timing quality; PERFECT gets +10 %.
  let power = clamp(o.power, 0, 1) * (0.6 + 0.4 * q);
  if (o.perfect) power = Math.min(1, power * 1.1);
  const loft = clamp(o.loft ?? 0, -1, 1);
  const aim = clamp(o.aim ?? 0, -1, 1);
  const { x: x0, y: y0, z: z0 } = o.from;

  // 1. target on the opponent half
  const sigma = o.aimErr ?? (1 - q) * 0.35;
  let tx = aim * (HALF_W - 0.12) + gauss(sigma, rand);
  const d = lerp(0.35, 1.15, power);
  let tz = d * -o.dir;
  const ty = TABLE_Y + BALL_R;
  tx = clamp(tx, -HALF_W + MARGIN, HALF_W - MARGIN);
  tz = o.dir > 0 ? clamp(tz, -HALF_L + MARGIN, -MARGIN - 0.12) : clamp(tz, MARGIN + 0.12, HALF_L - MARGIN);

  // 2. flight time
  const landTime = Math.max(0.5, (o.baseLandTime ?? 0.9) * Math.pow(0.97, o.rallyCount ?? 0));
  let t = lerp(1.15 * landTime, 0.75 * landTime, power) * (1 + 0.3 * loft);
  if (o.perfect) t *= 0.92;
  t = Math.max(0.3, t);

  // 4. net clearance: lengthen the flight until the arc clears the net
  const f = (0 - z0) / (tz - z0); // fraction of flight at the net plane
  const crossesNet = f > 0 && f < 1;
  const yAtNet = (tt) => y0 + f * (ty - y0) + 0.5 * g * tt * tt * f * (1 - f);
  if (crossesNet) {
    for (let i = 0; i < 8 && yAtNet(t) < NET_CLEAR_Y && t < 1.6; i++) t = Math.min(1.6, t * 1.08);
    if (yAtNet(t) < NET_CLEAR_Y) {
      // closed-form minimum flight time that clears (only for extreme low contact points)
      const need = NET_CLEAR_Y - y0 - f * (ty - y0);
      t = Math.sqrt((2 * need) / (g * f * (1 - f))) * 1.02;
    }
  }

  // 3. ballistic velocity hitting (tx,ty,tz) after t seconds
  const vel = {
    x: (tx - x0) / t,
    y: (ty - y0 + 0.5 * g * t * t) / t,
    z: (tz - z0) / t,
  };
  return { vel, target: { x: tx, y: ty, z: tz }, t };
}

/** Height of the trajectory at the net plane (z=0) — used by tests. */
export function heightAtNet(from, vel, g = 9.0) {
  if (vel.z === 0) return Infinity;
  const tn = (0 - from.z) / vel.z;
  if (tn < 0) return Infinity;
  return from.y + vel.y * tn - 0.5 * g * tn * tn;
}
