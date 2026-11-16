// Chunky stylised paddles with live tilt, swing arc animation and a glowing ribbon trail.
import * as THREE from 'three';

const RIBBON = 22;
const SWING_DUR = 0.18;

function makePaddleMesh(faceColor, rimColor) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.018, 32),
    new THREE.MeshStandardMaterial({ color: faceColor, emissive: faceColor, emissiveIntensity: 0.45, roughness: 0.75 }));
  face.rotation.x = Math.PI / 2; // normal along z
  face.position.y = 0.11;
  face.castShadow = true;
  g.add(face);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.106, 0.009, 8, 40),
    new THREE.MeshStandardMaterial({ color: rimColor, emissive: rimColor, emissiveIntensity: 1.2 }));
  rim.position.y = 0.11;
  g.add(rim);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.11, 0.026),
    new THREE.MeshStandardMaterial({ color: 0xc8874a, roughness: 0.6 }));
  handle.position.y = -0.0;
  handle.castShadow = true;
  g.add(handle);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.014, 0.03),
    new THREE.MeshStandardMaterial({ color: rimColor, emissive: rimColor, emissiveIntensity: 1.0 }));
  cap.position.y = -0.058;
  g.add(cap);
  return { group: g, face, rim };
}

class Ribbon {
  constructor(scene, color) {
    this.pos = new Float32Array(RIBBON * 2 * 3);
    this.col = new Float32Array(RIBBON * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < RIBBON - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.color = new THREE.Color(color);
    this.count = 0;
    this.alpha = 0;
  }

  push(a, b) {
    // shift (small arrays; fine)
    this.pos.copyWithin(6, 0, (RIBBON - 1) * 6);
    this.pos[0] = a.x; this.pos[1] = a.y; this.pos[2] = a.z;
    this.pos[3] = b.x; this.pos[4] = b.y; this.pos[5] = b.z;
    this.count = Math.min(RIBBON, this.count + 1);
  }

  update(dt, active) {
    this.alpha = active ? 1 : Math.max(0, this.alpha - dt * 3.5);
    this.mesh.visible = this.alpha > 0.01 && this.count > 1;
    if (!this.mesh.visible) { if (!active) this.count = 0; return; }
    for (let i = 0; i < RIBBON; i++) {
      const f = i < this.count ? (1 - i / RIBBON) ** 1.5 * this.alpha : 0;
      for (let k = 0; k < 2; k++) {
        const o = (i * 2 + k) * 3;
        const w = k === 0 ? 1 : 0.35;
        this.col[o] = this.color.r * f * w * 1.1;
        this.col[o + 1] = this.color.g * f * w * 1.1;
        this.col[o + 2] = this.color.b * f * w * 1.1;
      }
      if (i >= this.count && this.count > 0) {
        // collapse unused verts onto the last valid one
        const last = (this.count - 1) * 6;
        for (let k = 0; k < 6; k++) this.pos[i * 6 + k] = this.pos[last + k];
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  setColor(c) { this.color.set(c); }
}

export class PaddleView {
  /**
   * @param {THREE.Scene} scene
   * @param {{face:number, rim:number, side:1|-1}} o
   */
  constructor(scene, o) {
    this.side = o.side;
    const m = makePaddleMesh(o.face, o.rim);
    this.root = new THREE.Group();     // position
    this.pivot = new THREE.Group();    // swing rotation
    this.root.add(this.pivot);
    this.pivot.add(m.group);
    this.mesh = m;
    scene.add(this.root);
    this.ribbon = new Ribbon(scene, o.rim);
    this.baseRim = new THREE.Color(o.rim);
    this.x = 0; this.y = 1.0; this.z = o.side * 1.75;
    this.tiltPitch = 0; this.tiltRoll = 0;
    this.swingT = 1; this.swingDir = 1; this.swingPower = 0.5;
    this.snap = 0; this.snapX = 0; this.snapY = 0; this.snapZ = 0;
    this.flash = 0;
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  /** Start the swing arc. dir: +1 forehand (right→left sweep), -1 backhand. */
  swing(power = 0.6, dir = 1) {
    this.swingT = 0;
    this.swingPower = power;
    this.swingDir = dir;
  }

  /** Arcade forgiveness: paddle visually snaps to the contact point. */
  snapTo(x, y, z) {
    this.snap = 1;
    this.snapX = x; this.snapY = y; this.snapZ = z;
  }

  flashColor(c) { this.flash = 1; this.ribbon.setColor(c); }

  update(dt, targetX, targetY) {
    const k = 1 - Math.exp(-dt * 14);
    this.x += (targetX - this.x) * k;
    this.y += (targetY - this.y) * k;
    this.snap = Math.max(0, this.snap - dt * 3);
    this.flash = Math.max(0, this.flash - dt * 2);
    if (this.flash <= 0) this.ribbon.setColor(this.baseRim);

    const s = this.side;
    const sn = this.snap * this.snap;
    // swing arc: ease-out from wind-up to follow-through
    let swingYaw = 0, swingFwd = 0, swingLift = 0;
    const active = this.swingT < SWING_DUR;
    if (this.swingT < SWING_DUR + 0.25) {
      this.swingT += dt;
      const u = Math.min(1, this.swingT / SWING_DUR);
      const e = 1 - (1 - u) ** 3;
      const amp = 0.7 + this.swingPower * 0.6;
      const settle = this.swingT > SWING_DUR ? Math.max(0, 1 - (this.swingT - SWING_DUR) / 0.25) : 1;
      swingYaw = (-0.9 + 1.8 * e) * amp * this.swingDir * settle;
      swingFwd = Math.sin(e * Math.PI) * 0.25 * amp * settle;
      swingLift = Math.sin(e * Math.PI) * 0.06 * settle;
    }

    const px = this.x + (this.snapX - this.x) * sn + (s > 0 ? 0.0 : 0);
    const py = this.y + (this.snapY - this.y) * sn + swingLift;
    const pz = this.z + (this.snapZ - this.z) * sn - s * swingFwd;
    this.root.position.set(px, py - 0.11, pz);
    this.pivot.rotation.set(-this.tiltPitch * s, swingYaw * s + (s < 0 ? Math.PI : 0), -this.tiltRoll * s + (s > 0 ? -0.25 : 0.25));

    this.mesh.rim.material.emissiveIntensity = 1.2 + this.flash * 4;

    // ribbon trail from rim top/bottom
    if (active || this.ribbon.alpha > 0) {
      this.root.updateMatrixWorld(true);
      this._a.set(0, 0.215, 0); this.mesh.group.localToWorld(this._a);
      this._b.set(0, 0.03, 0); this.mesh.group.localToWorld(this._b);
      if (active) this.ribbon.push(this._a, this._b);
    }
    this.ribbon.update(dt, active);
  }
}
