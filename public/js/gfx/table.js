// Table: teal-blue top, white lines, glowing edge strips, metallic legs, wobbly glowing net.
import * as THREE from 'three';
import { WORLD } from '../config.js';

const { TABLE_W, TABLE_L, TABLE_Y, NET_H } = WORLD;

export function createTable(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // Top
  const THICK = 0.04;
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE_W, THICK, TABLE_L),
    new THREE.MeshStandardMaterial({ color: 0x0f5a8a, roughness: 0.55, metalness: 0.05, emissive: 0x062a4a, emissiveIntensity: 0.6 }),
  );
  top.position.y = TABLE_Y - THICK / 2;
  top.receiveShadow = true;
  top.castShadow = true;
  group.add(top);

  // Table lines: soft grey-blue rather than pure white so they don't bloom and compete with the ball
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x7d93b8 });
  const lineY = TABLE_Y + 0.0015;
  const addLine = (w, l, x, z) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, lineY, z);
    m.receiveShadow = true;
    group.add(m);
  };
  const LW = 0.02;
  addLine(LW, TABLE_L, -TABLE_W / 2 + LW / 2, 0);
  addLine(LW, TABLE_L, TABLE_W / 2 - LW / 2, 0);
  addLine(TABLE_W, LW, 0, -TABLE_L / 2 + LW / 2);
  addLine(TABLE_W, LW, 0, TABLE_L / 2 - LW / 2);
  addLine(0.006, TABLE_L, 0, 0);

  // Glowing edge strips
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x22e5ff, emissive: 0x22e5ff, emissiveIntensity: 1.1 });
  const edgeMatNear = new THREE.MeshStandardMaterial({ color: 0xff2e88, emissive: 0xff2e88, emissiveIntensity: 1.1 });
  const E = 0.018;
  const addEdge = (w, l, x, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, E, l), mat);
    m.position.set(x, TABLE_Y - THICK / 2, z);
    group.add(m);
  };
  // far half cyan (robot), near half pink (player)
  addEdge(E, TABLE_L / 2, -TABLE_W / 2 - E / 2, -TABLE_L / 4, edgeMat);
  addEdge(E, TABLE_L / 2, TABLE_W / 2 + E / 2, -TABLE_L / 4, edgeMat);
  addEdge(TABLE_W + 2 * E, E, 0, -TABLE_L / 2 - E / 2, edgeMat);
  addEdge(E, TABLE_L / 2, -TABLE_W / 2 - E / 2, TABLE_L / 4, edgeMatNear);
  addEdge(E, TABLE_L / 2, TABLE_W / 2 + E / 2, TABLE_L / 4, edgeMatNear);
  addEdge(TABLE_W + 2 * E, E, 0, TABLE_L / 2 + E / 2, edgeMatNear);

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0xb8c2d8, metalness: 0.9, roughness: 0.25 });
  const legGeo = new THREE.CylinderGeometry(0.022, 0.022, TABLE_Y - THICK, 10);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(sx * (TABLE_W / 2 - 0.12), (TABLE_Y - THICK) / 2, sz * (TABLE_L / 2 - 0.25));
    leg.castShadow = true;
    group.add(leg);
  }
  const brace = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, TABLE_L - 0.5), legMat);
  brace.position.set(0, 0.25, 0);
  group.add(brace);

  // Net: translucent glowing mesh (CPU-wobbled plane) + pink tape
  const NET_W = TABLE_W + 0.3;
  const netGeo = new THREE.PlaneGeometry(NET_W, NET_H, 30, 4);
  const basePos = Float32Array.from(netGeo.attributes.position.array);
  const netMat = new THREE.MeshBasicMaterial({
    map: netTexture(), color: 0x7ff6ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const net = new THREE.Mesh(netGeo, netMat);
  net.position.set(0, TABLE_Y + NET_H / 2, 0);
  group.add(net);
  const tape = new THREE.Mesh(new THREE.BoxGeometry(NET_W, 0.014, 0.012),
    new THREE.MeshStandardMaterial({ color: 0xff2e88, emissive: 0xff2e88, emissiveIntensity: 2.0 }));
  tape.position.set(0, TABLE_Y + NET_H, 0);
  group.add(tape);
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, NET_H + 0.03, 8), legMat);
    post.position.set(sx * NET_W / 2, TABLE_Y + NET_H / 2, 0);
    group.add(post);
  }

  let wobble = 0, wobbleX = 0, glow = 0, glowSide = 1;
  let time = 0;

  function update(dt) {
    time += dt;
    // net wobble
    if (wobble > 0.0005) {
      wobble *= Math.exp(-dt * 3.5);
      const arr = netGeo.attributes.position.array;
      for (let i = 0; i < arr.length; i += 3) {
        const x = basePos[i], y = basePos[i + 1];
        const hFactor = (y + NET_H / 2) / NET_H; // 0 bottom, 1 top
        const xFall = Math.exp(-Math.abs(x - wobbleX) * 2.2);
        arr[i + 2] = Math.sin(time * 38 + x * 6) * wobble * hFactor * xFall;
      }
      netGeo.attributes.position.needsUpdate = true;
      tape.position.z = Math.sin(time * 38 + wobbleX * 6) * wobble * Math.exp(-Math.abs(wobbleX) * 0.5) * 0.8;
      tape.rotation.y = Math.sin(time * 38) * wobble * 0.15;
    }
    // edge glow pulse
    glow *= Math.exp(-dt * 6);
    edgeMat.emissiveIntensity = 1.1 + (glowSide < 0 ? glow * 4 : 0);
    edgeMatNear.emissiveIntensity = 1.1 + (glowSide > 0 ? glow * 4 : 0);
    netMat.opacity = 0.7 + Math.min(0.3, wobble * 8);
  }

  function hitNet(x, strength = 1) {
    wobble = 0.035 * strength;
    wobbleX = x;
  }

  function pulseEdge(side) {
    glow = 1;
    glowSide = side;
  }

  return { group, update, hitNet, pulseEdge };
}

function netTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 32);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 1.2;
  for (let x = 0; x <= 256; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 32); g.stroke(); }
  for (let y = 0; y <= 32; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
