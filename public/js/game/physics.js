// Ball physics at a fixed step. Emits events through a callback; no allocations per step.
import { WORLD, CFG } from '../config.js';

const { TABLE_W, TABLE_L, TABLE_Y, NET_H, BALL_R } = WORLD;

export class Ball {
  constructor() {
    this.pos = { x: 0, y: 1, z: 0 };
    this.prev = { x: 0, y: 1, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.active = false;   // physics running
    this.held = false;     // hovering for serve
    this.dead = false;     // point decided, still flying for show
    this.gold = false;
    this.lastBounceSide = 0;
  }

  place(x, y, z) {
    this.pos.x = this.prev.x = x;
    this.pos.y = this.prev.y = y;
    this.pos.z = this.prev.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
  }

  launch(v) {
    this.vel.x = v.x; this.vel.y = v.y; this.vel.z = v.z;
    this.active = true;
    this.held = false;
  }

  speed() { return Math.hypot(this.vel.x, this.vel.y, this.vel.z); }
}

/**
 * Advance one fixed step.
 * @param {Ball} b
 * @param {number} dt
 * @param {(type:'bounce'|'net'|'floor'|'out', side:number)=>void} emit
 */
export function stepBall(b, dt, emit) {
  if (!b.active) return;
  const p = b.pos, v = b.vel;
  b.prev.x = p.x; b.prev.y = p.y; b.prev.z = p.z;
  v.y -= CFG.GRAVITY * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  // Net: crossing z=0 below the tape.
  if ((b.prev.z > 0) !== (p.z > 0) && Math.abs(p.x) < TABLE_W / 2 + 0.15 && p.y - BALL_R < TABLE_Y + NET_H && p.y > TABLE_Y - 0.02) {
    const side = b.prev.z > 0 ? 1 : -1;
    p.z = side * (BALL_R + 0.005);
    v.z *= -0.3;
    v.x *= 0.5;
    emit('net', side);
    return;
  }

  // Table top.
  if (v.y < 0 && p.y - BALL_R <= TABLE_Y && b.prev.y - BALL_R >= TABLE_Y - 0.03 &&
      Math.abs(p.x) <= TABLE_W / 2 + BALL_R * 0.5 && Math.abs(p.z) <= TABLE_L / 2 + BALL_R * 0.5) {
    p.y = TABLE_Y + BALL_R;
    v.y *= -0.88;
    v.x *= 0.96;
    v.z *= 0.96;
    const side = p.z >= 0 ? 1 : -1;
    b.lastBounceSide = side;
    emit('bounce', side);
    return;
  }

  // Floor.
  if (p.y < BALL_R) {
    p.y = BALL_R;
    v.y *= -0.55;
    v.x *= 0.8; v.z *= 0.8;
    emit('floor', p.z >= 0 ? 1 : -1);
    if (Math.abs(v.y) < 0.4) v.y = 0;
    return;
  }

  if (Math.abs(p.x) > 3 || Math.abs(p.z) > 4) emit('out', p.z >= 0 ? 1 : -1);
}
