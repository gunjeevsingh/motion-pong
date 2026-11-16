// Robot opponent: tracks the ball, decides hit/miss when the ball bounces on its side, uses the shared solver.
import { CFG, DIFFICULTIES, WORLD } from '../config.js';
import { solveShot } from './shot-solver.js';

const { PADDLE_Z, TABLE_W } = WORLD;

export class RobotAI {
  constructor() {
    this.x = 0;           // paddle x
    this.y = 1.0;         // paddle y
    this.targetX = 0;
    this.targetY = 1.0;
    this.state = 'idle';  // idle | tracking | committed
    this.willMiss = false;
    this.reactAt = 0;
    this.whiffAt = 0;
  }

  get level() { return DIFFICULTIES[CFG.DIFFICULTY] || DIFFICULTIES.NORMAL; }

  reset() {
    this.state = 'idle';
    this.targetX = 0;
    this.targetY = 1.0;
    this.willMiss = false;
    this.whiffAt = 0;
  }

  /** Ball bounced on the robot's side: decide now. */
  onOwnBounce(ball, now, rallyCount) {
    const lvl = this.level;
    const speed = ball.speed();
    const speedFactor = Math.max(0, (speed - 6.5) * 0.025) + (ball.gold ? 0.06 : 0);
    const pMiss = lvl.miss + (rallyCount > 8 ? 0.04 : 0) + speedFactor;
    this.willMiss = Math.random() < pMiss;
    this.state = 'tracking';
    this.reactAt = now + lvl.reaction * 1000;
  }

  /** Predict where the ball crosses the robot's paddle plane (linear in x, ballistic in y). */
  predict(ball) {
    const v = ball.vel;
    if (v.z >= -0.01) return;
    const t = (-PADDLE_Z - ball.pos.z) / v.z;
    if (t < 0) return;
    this.targetX = ball.pos.x + v.x * t;
    this.targetY = Math.max(0.85, ball.pos.y + v.y * t - 0.5 * CFG.GRAVITY * t * t);
  }

  update(dt, ball, now, phase) {
    if (phase === 'RALLY' && ball.active && ball.vel.z < 0 && !ball.dead) {
      if (this.state !== 'tracking' || now >= this.reactAt) this.predict(ball);
    } else if (phase !== 'SERVE') {
      this.targetX *= 0.98;
      this.targetY = 1.0;
    }
    let tx = this.targetX;
    if (this.willMiss && this.state === 'tracking') tx += Math.sign(tx || 1) * 0.25; // reaches a bit wrong
    tx = Math.max(-TABLE_W / 2 - 0.4, Math.min(TABLE_W / 2 + 0.4, tx));
    const k = 1 - Math.exp(-dt * (now >= this.reactAt ? 9 : 2));
    this.x += (tx - this.x) * k;
    this.y += (this.targetY - this.y) * k;
  }

  /**
   * Called each physics step during a rally. Returns 'hit' | 'whiff' | null.
   * @param {boolean} bouncedOwnSide
   */
  check(ball, bouncedOwnSide, now) {
    if (this.state !== 'tracking' || !bouncedOwnSide || ball.vel.z >= 0) return null;
    if (ball.pos.z > -PADDLE_Z) return null;
    this.state = 'committed';
    return this.willMiss ? 'whiff' : 'hit';
  }

  /** Build the robot's shot velocity. */
  shoot(ball, rallyCount) {
    const lvl = this.level;
    return solveShot({
      from: ball.pos,
      dir: -1,
      power: 0.4 + Math.random() * 0.5,
      aim: (Math.random() * 2 - 1) * 0.6,
      loft: (Math.random() * 2 - 1) * 0.3,
      quality: 1,
      aimErr: lvl.aimErr * 0.5, // aimErr is applied around a target already spread ±0.6
      baseLandTime: lvl.landTime,
      rallyCount,
      gravity: CFG.GRAVITY,
    });
  }

  serve(ball) {
    const lvl = this.level;
    return solveShot({
      from: ball.pos, dir: -1, power: 0.45 + Math.random() * 0.35,
      aim: (Math.random() * 2 - 1) * 0.7, loft: 0.1, quality: 1,
      aimErr: lvl.aimErr * 0.4, baseLandTime: lvl.landTime * 1.1, rallyCount: 0, gravity: CFG.GRAVITY,
    });
  }
}
