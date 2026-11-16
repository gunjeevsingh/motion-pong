// Ball: white-hot emissive sphere, halo sprite, speed-coloured trail, blob shadow, guide ring, squash & stretch.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { radialTexture } from './arena.js';

const { BALL_R, TABLE_W, TABLE_L, TABLE_Y } = WORLD;
const TRAIL = 24;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export function createBallView(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4e0, emissiveIntensity: 2.2, roughness: 0.3 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 24, 16), mat);
  mesh.castShadow = true;
  group.add(mesh);

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
    color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55,
  }));
  halo.scale.setScalar(BALL_R * 7);
  group.add(halo);

  // Trail: instanced fading spheres
  const trailMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const trail = new THREE.InstancedMesh(new THREE.SphereGeometry(BALL_R, 10, 8), trailMat, TRAIL);
  trail.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trail.frustumCulled = false;
  const hist = new Float32Array(TRAIL * 3);
  let histCount = 0, histHead = 0;
  const tmpColor = new THREE.Color();
  for (let i = 0; i < TRAIL; i++) trail.setColorAt(i, tmpColor.set(0xffffff));
  group.add(trail);

  // Blob shadow
  const blob = new THREE.Mesh(new THREE.CircleGeometry(BALL_R * 1.6, 24),
    new THREE.MeshBasicMaterial({ map: radialTexture('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.renderOrder = 2;
  group.add(blob);

  // Guide ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(BALL_R * 1.9, BALL_R * 2.3, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 3;
  group.add(ring);

  const CYAN = new THREE.Color(0x22e5ff), MAGENTA = new THREE.Color(0xff2ed1), GOLD = new THREE.Color(0xffc21a), FLAME = new THREE.Color(0xff6a00);
  const dummy = new THREE.Object3D();
  const velN = new THREE.Vector3();
  let squash = 0;
  let sampleT = 0;

  /**
   * @param {{x,y,z}} pos interpolated position
   * @param {{x,y,z}} vel
   * @param {{visible:boolean, gold:boolean, fire:boolean, dt:number, held:boolean}} s
   */
  function update(pos, vel, s) {
    group.visible = s.visible;
    if (!s.visible) { histCount = 0; return; }
    mesh.position.set(pos.x, pos.y, pos.z);
    halo.position.copy(mesh.position);

    // squash & stretch along velocity
    squash *= Math.exp(-s.dt * 14);
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (speed > 0.5) {
      velN.set(vel.x / speed, vel.y / speed, vel.z / speed);
      mesh.quaternion.setFromUnitVectors(Z_AXIS, velN);
      const stretch = Math.min(0.35, speed * 0.018) - squash * 0.5;
      const sq = 1 + stretch;
      mesh.scale.set(1 / Math.sqrt(Math.max(0.4, sq)), 1 / Math.sqrt(Math.max(0.4, sq)), sq);
    } else {
      mesh.scale.setScalar(1 + squash * 0.3);
    }

    const gold = s.gold, fire = s.fire;
    mat.emissive.set(gold ? 0xffd86b : 0xfff4e0);
    halo.material.color.copy(gold ? GOLD : fire ? FLAME : tmpColor.set(0xffffff));
    halo.material.opacity = gold || fire ? 0.9 : 0.55;
    halo.scale.setScalar(BALL_R * (gold || fire ? 10 : 7));

    // trail history (sample at ~120 Hz regardless of fps)
    sampleT += s.dt;
    if (s.held) histCount = 0;
    else if (sampleT >= 1 / 120 || histCount === 0) {
      sampleT = 0;
      hist[histHead * 3] = pos.x; hist[histHead * 3 + 1] = pos.y; hist[histHead * 3 + 2] = pos.z;
      histHead = (histHead + 1) % TRAIL;
      histCount = Math.min(TRAIL, histCount + 1);
    }
    const speedT = Math.min(1, Math.max(0, (speed - 4) / 8));
    for (let i = 0; i < TRAIL; i++) {
      if (i >= histCount) {
        dummy.scale.setScalar(0);
      } else {
        const idx = ((histHead - 1 - i) + TRAIL * 2) % TRAIL;
        dummy.position.set(hist[idx * 3], hist[idx * 3 + 1], hist[idx * 3 + 2]);
        const f = 1 - i / TRAIL;
        dummy.scale.setScalar(f * (fire ? 1.3 : 0.95));
        if (gold) tmpColor.copy(GOLD);
        else if (fire) tmpColor.copy(FLAME).lerp(GOLD, f * 0.5);
        else tmpColor.copy(CYAN).lerp(MAGENTA, speedT);
        tmpColor.multiplyScalar(f * f * 1.2);
        trail.setColorAt(i, tmpColor);
      }
      dummy.updateMatrix();
      trail.setMatrixAt(i, dummy.matrix);
    }
    trail.instanceMatrix.needsUpdate = true;
    trail.instanceColor.needsUpdate = true;

    // blob shadow + guide ring on table (or floor)
    const overTable = Math.abs(pos.x) < TABLE_W / 2 && Math.abs(pos.z) < TABLE_L / 2;
    const surfY = overTable ? TABLE_Y + 0.003 : 0.004;
    const h = Math.max(0, pos.y - surfY - BALL_R);
    blob.position.set(pos.x, surfY, pos.z);
    const bs = Math.max(0.35, 1.25 - h * 1.2);
    blob.scale.setScalar(bs);
    blob.material.opacity = Math.max(0.15, 0.9 - h * 0.9);
    ring.visible = overTable;
    ring.position.set(pos.x, surfY + 0.001, pos.z);
    ring.scale.setScalar(1 + h * 1.5);
    ring.material.opacity = Math.max(0.05, 0.35 - h * 0.35);
  }

  function hitSquash(p) { squash = 0.5 + p * 0.6; }
  function clearTrail() { histCount = 0; }

  return { group, update, hitSquash, clearTrail, mesh };
}
