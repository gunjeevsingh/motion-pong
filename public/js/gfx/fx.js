// Pooled effects: particles (bursts, puffs, sparks, flames), shockwave rings, table ripple decals, confetti.
// Everything is preallocated; spawn functions never allocate.
import * as THREE from 'three';
import { WORLD } from '../config.js';

const MAX_PARTICLES = 600;
const MAX_CONFETTI = 320;
const RINGS = 10;
const RIPPLES = 10;

export function createFx(scene) {
  // ---------- particles ----------
  const pGeo = new THREE.OctahedronGeometry(0.012, 0);
  const pMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const particles = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
  particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particles.frustumCulled = false;
  const P = {
    pos: new Float32Array(MAX_PARTICLES * 3), vel: new Float32Array(MAX_PARTICLES * 3),
    life: new Float32Array(MAX_PARTICLES), max: new Float32Array(MAX_PARTICLES),
    size: new Float32Array(MAX_PARTICLES), grav: new Float32Array(MAX_PARTICLES),
    col: new Float32Array(MAX_PARTICLES * 3),
  };
  let pNext = 0;
  const tmpC = new THREE.Color();
  const dummy = new THREE.Object3D();
  for (let i = 0; i < MAX_PARTICLES; i++) {
    dummy.scale.setScalar(0); dummy.updateMatrix();
    particles.setMatrixAt(i, dummy.matrix);
    particles.setColorAt(i, tmpC.set(0));
  }
  scene.add(particles);

  function spawnParticle(x, y, z, vx, vy, vz, life, size, grav, color) {
    const i = pNext; pNext = (pNext + 1) % MAX_PARTICLES;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
    P.life[i] = life; P.max[i] = life; P.size[i] = size; P.grav[i] = grav;
    P.col[i * 3] = color.r; P.col[i * 3 + 1] = color.g; P.col[i * 3 + 2] = color.b;
  }

  const rnd = (a = 1) => (Math.random() * 2 - 1) * a;

  /** Radial burst. dirZ biases particles along the shot direction. */
  function burst(pos, count, speed, colorA, colorB, dirZ = 0, size = 1) {
    for (let n = 0; n < count; n++) {
      const c = Math.random() < 0.5 ? colorA : (colorB || colorA);
      const th = Math.random() * Math.PI * 2, ph = Math.acos(rnd());
      const s = speed * (0.4 + Math.random() * 0.8);
      spawnParticle(pos.x, pos.y, pos.z,
        Math.sin(ph) * Math.cos(th) * s, Math.cos(ph) * s * 0.8 + 0.5, Math.sin(ph) * Math.sin(th) * s + dirZ * speed * 0.6,
        0.35 + Math.random() * 0.4, size * (0.8 + Math.random() * 1.4), 4, c);
    }
  }

  function puff(pos, count, color) {
    for (let n = 0; n < count; n++) {
      const th = Math.random() * Math.PI * 2;
      spawnParticle(pos.x, pos.y + 0.01, pos.z, Math.cos(th) * 0.6, 0.4 + Math.random() * 0.5, Math.sin(th) * 0.6,
        0.3 + Math.random() * 0.2, 1.2, 2, color);
    }
  }

  function sparks(pos, count, color) {
    for (let n = 0; n < count; n++) {
      spawnParticle(pos.x, pos.y, pos.z, rnd(1.5), 1 + Math.random() * 2, rnd(1.5), 0.4 + Math.random() * 0.4, 0.8, 9, color);
    }
  }

  const FLAME_A = new THREE.Color(0xff6a00), FLAME_B = new THREE.Color(0xffd23f);
  function flame(pos) {
    spawnParticle(pos.x + rnd(0.02), pos.y + rnd(0.02), pos.z + rnd(0.02), rnd(0.2), 0.6 + Math.random() * 0.5, rnd(0.2),
      0.25 + Math.random() * 0.2, 1.6, -1.5, Math.random() < 0.5 ? FLAME_A : FLAME_B);
  }

  // ---------- shockwave rings ----------
  const ringGeo = new THREE.RingGeometry(0.85, 1.0, 48);
  const rings = [];
  for (let i = 0; i < RINGS; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.visible = false;
    scene.add(m);
    rings.push({ m, t: 0, dur: 0.35, size: 0.5 });
  }
  let ringNext = 0;
  function shockwave(pos, color, size = 0.5, dur = 0.35) {
    const r = rings[ringNext]; ringNext = (ringNext + 1) % RINGS;
    r.m.position.set(pos.x, pos.y, pos.z);
    r.m.rotation.set(0, 0, 0); // faces +z (toward camera) — hit plane
    r.m.material.color.copy(color);
    r.m.visible = true;
    r.t = 0; r.dur = dur; r.size = size;
  }

  // ---------- table ripples ----------
  const ripples = [];
  for (let i = 0; i < RIPPLES; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x22e5ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.visible = false;
    m.renderOrder = 4;
    scene.add(m);
    ripples.push({ m, t: 0 });
  }
  let ripNext = 0;
  function ripple(pos, color) {
    const r = ripples[ripNext]; ripNext = (ripNext + 1) % RIPPLES;
    r.m.position.set(pos.x, WORLD.TABLE_Y + 0.004, pos.z);
    r.m.material.color.copy(color);
    r.m.visible = true;
    r.t = 0;
  }

  // ---------- confetti ----------
  const cGeo = new THREE.PlaneGeometry(0.035, 0.018);
  const cMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const confetti = new THREE.InstancedMesh(cGeo, cMat, MAX_CONFETTI);
  confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confetti.frustumCulled = false;
  const C = {
    pos: new Float32Array(MAX_CONFETTI * 3), vel: new Float32Array(MAX_CONFETTI * 3),
    rot: new Float32Array(MAX_CONFETTI * 3), spin: new Float32Array(MAX_CONFETTI * 3),
    life: new Float32Array(MAX_CONFETTI),
  };
  for (let i = 0; i < MAX_CONFETTI; i++) {
    dummy.scale.setScalar(0); dummy.updateMatrix();
    confetti.setMatrixAt(i, dummy.matrix);
    confetti.setColorAt(i, tmpC.set(0xffffff));
  }
  scene.add(confetti);
  let confNext = 0;
  let confActive = false;
  const WHITE = new THREE.Color(0xffffff);
  const GOLD = new THREE.Color(0xffd23f);

  /** Instanced confetti burst in the winner's colour. */
  function confettiBurst(origin, color, count = 150, spread = 1) {
    for (let n = 0; n < count; n++) {
      const i = confNext; confNext = (confNext + 1) % MAX_CONFETTI;
      C.pos[i * 3] = origin.x + rnd(0.6 * spread); C.pos[i * 3 + 1] = origin.y + Math.random() * 0.3; C.pos[i * 3 + 2] = origin.z + rnd(0.4 * spread);
      C.vel[i * 3] = rnd(2.2 * spread); C.vel[i * 3 + 1] = 2.5 + Math.random() * 3.5 * spread; C.vel[i * 3 + 2] = rnd(2.0 * spread);
      C.rot[i * 3] = Math.random() * 6; C.rot[i * 3 + 1] = Math.random() * 6; C.rot[i * 3 + 2] = Math.random() * 6;
      C.spin[i * 3] = rnd(12); C.spin[i * 3 + 1] = rnd(12); C.spin[i * 3 + 2] = rnd(12);
      C.life[i] = 2.6 + Math.random() * 1.6;
      const r = Math.random();
      tmpC.copy(r < 0.6 ? color : r < 0.8 ? WHITE : GOLD).multiplyScalar(1.3);
      confetti.setColorAt(i, tmpC);
    }
    confetti.instanceColor.needsUpdate = true;
    confActive = true;
  }

  // ---------- update ----------
  function update(dt) {
    // particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (P.life[i] <= 0) continue;
      P.life[i] -= dt;
      const i3 = i * 3;
      if (P.life[i] <= 0) {
        dummy.scale.setScalar(0);
      } else {
        P.vel[i3 + 1] -= P.grav[i] * dt;
        const drag = Math.exp(-dt * 2.5);
        P.vel[i3] *= drag; P.vel[i3 + 1] *= drag; P.vel[i3 + 2] *= drag;
        P.pos[i3] += P.vel[i3] * dt; P.pos[i3 + 1] += P.vel[i3 + 1] * dt; P.pos[i3 + 2] += P.vel[i3 + 2] * dt;
        const f = P.life[i] / P.max[i];
        dummy.position.set(P.pos[i3], P.pos[i3 + 1], P.pos[i3 + 2]);
        dummy.scale.setScalar(P.size[i] * (0.3 + f));
        dummy.rotation.set(f * 6, f * 4, 0);
        tmpC.setRGB(P.col[i3] * f * 2, P.col[i3 + 1] * f * 2, P.col[i3 + 2] * f * 2);
        particles.setColorAt(i, tmpC);
      }
      dummy.updateMatrix();
      particles.setMatrixAt(i, dummy.matrix);
    }
    particles.instanceMatrix.needsUpdate = true;
    particles.instanceColor.needsUpdate = true;

    for (const r of rings) {
      if (!r.m.visible) continue;
      r.t += dt;
      const u = r.t / r.dur;
      if (u >= 1) { r.m.visible = false; continue; }
      const e = 1 - (1 - u) ** 3;
      r.m.scale.setScalar(0.05 + e * r.size);
      r.m.material.opacity = (1 - u) * 1.2;
    }

    for (const r of ripples) {
      if (!r.m.visible) continue;
      r.t += dt;
      const u = r.t / 0.5;
      if (u >= 1) { r.m.visible = false; continue; }
      r.m.scale.setScalar(0.03 + (1 - (1 - u) ** 2) * 0.22);
      r.m.material.opacity = 1 - u;
    }

    if (confActive) {
      let any = false;
      for (let i = 0; i < MAX_CONFETTI; i++) {
        if (C.life[i] <= 0) continue;
        any = true;
        C.life[i] -= dt;
        const i3 = i * 3;
        if (C.life[i] <= 0) { dummy.scale.setScalar(0); dummy.position.set(0, -10, 0); }
        else {
          C.vel[i3 + 1] -= 6 * dt;
          const drag = Math.exp(-dt * 1.6);
          C.vel[i3] *= drag; C.vel[i3 + 2] *= drag;
          if (C.vel[i3 + 1] < -1.2) C.vel[i3 + 1] = -1.2 + Math.sin(C.rot[i3]) * 0.2; // flutter terminal velocity
          C.pos[i3] += C.vel[i3] * dt; C.pos[i3 + 1] += C.vel[i3 + 1] * dt; C.pos[i3 + 2] += C.vel[i3 + 2] * dt;
          if (C.pos[i3 + 1] < 0.01) { C.pos[i3 + 1] = 0.01; C.vel[i3] = C.vel[i3 + 1] = C.vel[i3 + 2] = 0; }
          C.rot[i3] += C.spin[i3] * dt; C.rot[i3 + 1] += C.spin[i3 + 1] * dt; C.rot[i3 + 2] += C.spin[i3 + 2] * dt;
          dummy.position.set(C.pos[i3], C.pos[i3 + 1], C.pos[i3 + 2]);
          dummy.rotation.set(C.rot[i3], C.rot[i3 + 1], C.rot[i3 + 2]);
          dummy.scale.setScalar(Math.min(1, C.life[i] * 2));
        }
        dummy.updateMatrix();
        confetti.setMatrixAt(i, dummy.matrix);
      }
      confetti.instanceMatrix.needsUpdate = true;
      confActive = any;
    }
  }

  return { burst, puff, sparks, flame, shockwave, ripple, confettiBurst, update };
}
