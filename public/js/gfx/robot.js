// Cute robot opponent from primitives: sphere head + visor with emissive eyes, box body, floating hands, wobbly antenna.
import * as THREE from 'three';

const EMOTES = ['neutral', 'determined', 'happy', 'dizzy'];

export function createRobot(scene) {
  const root = new THREE.Group();
  root.position.set(0, 0, -2.25);
  scene.add(root);

  const metal = new THREE.MeshStandardMaterial({ color: 0xe8ecff, metalness: 0.35, roughness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1640, metalness: 0.5, roughness: 0.3 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x22e5ff, emissive: 0x22e5ff, emissiveIntensity: 2 });

  const bodyG = new THREE.Group();
  root.add(bodyG);

  // Hover base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.12, 20), dark);
  base.position.y = 0.62;
  bodyG.add(base);
  const thruster = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshBasicMaterial({ color: 0x22e5ff, transparent: true, opacity: 0.85 }));
  thruster.rotation.x = Math.PI / 2;
  thruster.position.y = 0.555;
  bodyG.add(thruster);

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.34), metal);
  body.position.y = 0.95;
  body.castShadow = true;
  bodyG.add(body);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.01), glow);
  chest.position.set(0, 1.0, 0.171);
  bodyG.add(chest);
  const chest2 = chest.clone();
  chest2.scale.x = 0.6;
  chest2.position.y = 0.9;
  bodyG.add(chest2);
  for (const sx of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), dark);
    shoulder.position.set(sx * 0.27, 1.13, 0);
    bodyG.add(shoulder);
  }

  // Head
  const headG = new THREE.Group();
  headG.position.y = 1.42;
  bodyG.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 20), metal);
  head.castShadow = true;
  headG.add(head);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.262, 32, 16, Math.PI * 0.14, Math.PI * 0.72, Math.PI * 0.3, Math.PI * 0.38), dark);
  visor.scale.set(1.0, 1.0, 1.02);
  visor.rotation.y = 0; // centred on +z (faces the player)
  headG.add(visor);

  // Eyes: canvas texture on a plane in front of the visor
  const eyeCanvas = document.createElement('canvas');
  eyeCanvas.width = 256; eyeCanvas.height = 96;
  const eyeTex = new THREE.CanvasTexture(eyeCanvas);
  eyeTex.colorSpace = THREE.SRGBColorSpace;
  const eyeMat = new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true, color: 0xffffff, depthWrite: false });
  const eyes = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1125), eyeMat);
  eyes.position.set(0, 0.0, 0.272);
  headG.add(eyes);

  // Ear discs
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16), glow);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(sx * 0.26, 0, 0);
    headG.add(ear);
  }

  // Antenna with spring wobble
  const antG = new THREE.Group();
  antG.position.y = 0.25;
  headG.add(antG);
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, 0.18, 8), dark);
  stalk.position.y = 0.09;
  antG.add(stalk);
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xff2e88, emissive: 0xff2e88, emissiveIntensity: 3 });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), tipMat);
  tip.position.y = 0.19;
  antG.add(tip);

  // Floating hands
  const handGeo = new THREE.SphereGeometry(0.075, 16, 12);
  const leftHand = new THREE.Mesh(handGeo, metal);
  leftHand.castShadow = true;
  root.add(leftHand);
  const rightHand = new THREE.Mesh(handGeo, metal);
  rightHand.castShadow = true;
  root.add(rightHand);

  let emote = 'neutral', emoteTimer = 0;
  let antAngle = 0, antVel = 0, antAngleZ = 0, antVelZ = 0;
  let lastX = 0;
  let time = 0;
  let hop = 0;

  function drawEyes(kind) {
    const g = eyeCanvas.getContext('2d');
    g.clearRect(0, 0, 256, 96);
    const col = kind === 'happy' ? '#7dffb2' : kind === 'dizzy' ? '#ff5a8a' : '#4ff0ff';
    g.strokeStyle = col; g.fillStyle = col;
    g.lineWidth = 12; g.lineCap = 'round'; g.lineJoin = 'round';
    g.shadowColor = col; g.shadowBlur = 16;
    for (const cx of [72, 184]) {
      g.beginPath();
      if (kind === 'determined') {
        // slanted bars
        const s = cx < 128 ? 1 : -1;
        g.moveTo(cx - 34, 40 - s * 10); g.lineTo(cx + 34, 40 + s * 10);
        g.stroke();
        g.beginPath(); g.moveTo(cx - 26, 64); g.lineTo(cx + 26, 64); g.stroke();
      } else if (kind === 'happy') {
        g.moveTo(cx - 30, 62); g.lineTo(cx, 30); g.lineTo(cx + 30, 62); g.stroke();
      } else if (kind === 'dizzy') {
        g.moveTo(cx - 24, 24); g.lineTo(cx + 24, 72);
        g.moveTo(cx + 24, 24); g.lineTo(cx - 24, 72); g.stroke();
      } else {
        g.arc(cx, 48, 20, 0, Math.PI * 2); g.fill();
      }
    }
    eyeTex.needsUpdate = true;
  }
  drawEyes('neutral');

  function setEmote(kind, duration = 0) {
    if (!EMOTES.includes(kind)) return;
    if (kind !== emote) { emote = kind; drawEyes(kind); }
    emoteTimer = duration;
    if (kind === 'happy') hop = 1;
  }

  /**
   * @param {number} dt
   * @param {{x:number, handX:number, handY:number, handZ:number}} s  (world-space paddle position for the right hand)
   */
  function update(dt, s) {
    time += dt;
    if (emoteTimer > 0) { emoteTimer -= dt; if (emoteTimer <= 0) setEmote('neutral'); }
    hop = Math.max(0, hop - dt * 1.4);
    const bob = Math.sin(time * 2.2) * 0.03 + Math.abs(Math.sin(time * 10)) * hop * 0.15;
    const vx = (s.x - lastX) / Math.max(dt, 1e-3);
    lastX = s.x;
    root.position.x = s.x * 0.85;
    bodyG.position.y = bob;
    bodyG.rotation.z = THREE.MathUtils.clamp(-vx * 0.05, -0.25, 0.25);
    headG.rotation.y = Math.sin(time * 0.7) * 0.12;
    headG.rotation.z = emote === 'dizzy' ? Math.sin(time * 8) * 0.25 : 0;

    // antenna spring driven by body acceleration
    antVel += (-antAngle * 120 - antVel * 6 - vx * 0.4) * dt;
    antAngle += antVel * dt;
    antVelZ += (-antAngleZ * 120 - antVelZ * 6 + (emote === 'dizzy' ? Math.sin(time * 9) * 30 : 0)) * dt;
    antAngleZ += antVelZ * dt;
    antG.rotation.z = THREE.MathUtils.clamp(antAngle, -0.8, 0.8);
    antG.rotation.x = THREE.MathUtils.clamp(antAngleZ, -0.8, 0.8);
    tipMat.emissiveIntensity = 2.5 + Math.sin(time * 6) * 0.8;
    thruster.material.opacity = 0.6 + Math.sin(time * 30) * 0.2;

    // hands (in root-local space; root sits at z=-2.25)
    rightHand.position.set(s.handX - root.position.x, s.handY - 0.13 + bob * 0.5, s.handZ - root.position.z - 0.02);
    leftHand.position.set(-0.4, 0.95 + bob + Math.sin(time * 2.2 + 1) * 0.03, 0.12);
  }

  /** Antenna flick (e.g. on hit). */
  function flick(strength = 1) { antVel += 6 * strength; }

  return { root, update, setEmote, flick, get emote() { return emote; } };
}
