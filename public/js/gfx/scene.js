// Renderer, scene, camera rig (sway, shake, FOV kick, dolly) and lights.
import * as THREE from 'three';

const BASE_POS = new THREE.Vector3(0, 1.55, 3.2);
const LOOK = new THREE.Vector3(0, 0.85, -0.3);
const BASE_FOV = 55;

export function createScene(canvas, { lowfx }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowfx, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowfx ? 1 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !lowfx;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0420);
  scene.fog = new THREE.Fog(0x1a0838, 14, 60);

  const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 400);
  camera.position.copy(BASE_POS);
  camera.lookAt(LOOK);

  // Lights
  const hemi = new THREE.HemisphereLight(0x8a6cff, 0x1a0630, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff1e6, 1.6);
  key.position.set(1.2, 5, 1.5);
  key.target.position.set(0, 0.76, 0);
  key.castShadow = !lowfx;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -2.2; key.shadow.camera.right = 2.2;
  key.shadow.camera.top = 2.8; key.shadow.camera.bottom = -2.8;
  key.shadow.camera.near = 1; key.shadow.camera.far = 9;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  scene.add(key, key.target);
  const pinkL = new THREE.PointLight(0xff3d9a, 6, 7, 1.6);
  pinkL.position.set(-1.6, 1.6, 2.4);
  const cyanL = new THREE.PointLight(0x2de2ff, 6, 8, 1.6);
  cyanL.position.set(1.6, 1.8, -2.6);
  scene.add(pinkL, cyanL);

  // Camera rig state
  const rig = {
    shakeAmp: 0, shakeT: 0, shakeDur: 0.18,
    fovKick: 0,
    dolly: 0, dollyTarget: 0,
    zoom: 0,        // slow match-end zoom
    swayX: 0, swayY: 0,
    focus: new THREE.Vector3().copy(LOOK),
    focusTarget: new THREE.Vector3().copy(LOOK),
  };
  const tmp = new THREE.Vector3();
  const dir = new THREE.Vector3();
  let time = 0;

  function shake(amp, dur = 0.18) {
    if (amp > rig.shakeAmp * (1 - rig.shakeT / rig.shakeDur)) { rig.shakeAmp = amp; rig.shakeT = 0; rig.shakeDur = dur; }
  }
  function kickFov(deg) { rig.fovKick = Math.max(rig.fovKick, deg); }
  function dolly(amount) { rig.dollyTarget = amount; }
  function setZoom(z) { rig.zoom = z; }
  function setFocus(x, y, z) { rig.focusTarget.set(x, y, z); }
  function resetFocus() { rig.focusTarget.copy(LOOK); }

  /** @param {number} dt real seconds; tilt {pitch, roll} from phone */
  function update(dt, tilt) {
    time += dt;
    // sway with phone tilt
    const k = 1 - Math.exp(-dt * 4);
    rig.swayX += ((tilt?.roll || 0) * -0.12 - rig.swayX) * k;
    rig.swayY += ((tilt?.pitch || 0) * 0.06 - rig.swayY) * k;
    rig.dolly += (rig.dollyTarget - rig.dolly) * (1 - Math.exp(-dt * 3));
    rig.focus.lerp(rig.focusTarget, 1 - Math.exp(-dt * 2.5));

    camera.position.copy(BASE_POS);
    camera.position.x += rig.swayX + Math.sin(time * 0.35) * 0.03;
    camera.position.y += rig.swayY + Math.sin(time * 0.5) * 0.015;
    dir.copy(rig.focus).sub(camera.position).normalize();
    camera.position.addScaledVector(dir, rig.dolly + rig.zoom);

    if (rig.shakeT < rig.shakeDur && rig.shakeAmp > 0) {
      rig.shakeT += dt;
      const fall = 1 - rig.shakeT / rig.shakeDur;
      const a = rig.shakeAmp * fall * fall;
      camera.position.x += (Math.random() * 2 - 1) * a;
      camera.position.y += (Math.random() * 2 - 1) * a;
    }
    tmp.copy(rig.focus);
    camera.lookAt(tmp);

    rig.fovKick *= Math.exp(-dt / 0.08); // ~250 ms decay
    const fov = BASE_FOV + rig.fovKick;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  return { renderer, scene, camera, lights: { hemi, key, pinkL, cyanL }, update, shake, kickFov, dolly, setZoom, setFocus, resetFocus, resize };
}
