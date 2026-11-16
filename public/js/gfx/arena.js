// Synthwave arena: gradient sky, striped sun, scrolling grid floor, floating shapes, spotlight cones, crowd.
import * as THREE from 'three';

const PINK = new THREE.Color(0xff2e88);
const ORANGE = new THREE.Color(0xff8a1f);
const CYAN = new THREE.Color(0x22e5ff);
const PURPLE = new THREE.Color(0x8b3dff);
const GOLD = new THREE.Color(0xffd23f);

export function createArena(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const uTime = { value: 0 };
  const uFire = { value: 0 };

  // --- Sky dome ---
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime, uFire },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `
      varying vec3 vP; uniform float uTime; uniform float uFire;
      float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
      void main(){
        float h = vP.y;
        vec3 top = vec3(0.02,0.01,0.08);
        vec3 mid = mix(vec3(0.20,0.04,0.32), vec3(0.32,0.06,0.18), uFire);
        vec3 hor = mix(vec3(0.95,0.25,0.55), vec3(1.0,0.45,0.15), uFire);
        vec3 c = mix(mid, top, smoothstep(0.05, 0.6, h));
        c = mix(hor, c, smoothstep(-0.02, 0.18, h));
        // stars
        vec3 q = floor(vP * 220.0);
        float s = step(0.9975, hash(q)) * smoothstep(0.1, 0.5, h);
        s *= 0.6 + 0.4*sin(uTime*2.0 + hash(q)*30.0);
        c += vec3(s);
        if (h < -0.02) c = vec3(0.04,0.0,0.08);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), skyMat);
  group.add(sky);

  // --- Striped synthwave sun ---
  const sunMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uTime, uFire },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: `
      varying vec2 vUv; uniform float uTime; uniform float uFire;
      void main(){
        vec2 p = vUv*2.0-1.0;
        float r = length(p);
        if (r > 1.0) discard;
        vec3 top = vec3(1.0, 0.7, 0.3);
        vec3 bot = mix(vec3(1.0, 0.18, 0.55), vec3(1.0, 0.25, 0.1), uFire);
        vec3 c = mix(bot, top, smoothstep(-0.9, 0.8, p.y)) * 0.6; // kept under the bloom threshold so it doesn't glare behind the ball
        // horizontal cut stripes in the lower half, scrolling down
        float y = p.y;
        if (y < 0.15) {
          float band = fract((y - uTime*0.05) * 7.0);
          float thick = mix(0.05, 0.55, smoothstep(0.15, -1.0, y));
          if (band < thick) discard;
        }
        float edge = smoothstep(1.0, 0.97, r);
        gl_FragColor = vec4(c, edge);
      }`,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), sunMat);
  sun.position.set(0, 9, -120);
  group.add(sun);
  // halo glow behind the sun
  const haloTex = radialTexture('rgba(255,90,170,0.12)', 'rgba(255,60,140,0)');
  const sunHalo = new THREE.Mesh(new THREE.PlaneGeometry(90, 90),
    new THREE.MeshBasicMaterial({ map: haloTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  sunHalo.position.set(0, 9, -121);
  group.add(sunHalo);

  // --- Mountains silhouette (low-poly) ---
  const mountainGeo = new THREE.BufferGeometry();
  {
    const pts = [];
    const n = 40;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < n; i++) {
        const x0 = side * (8 + i * 3), x1 = side * (8 + (i + 1) * 3);
        const h = 3 + Math.abs(Math.sin(i * 1.7) * 7) + (i % 3) * 1.5;
        const xm = (x0 + x1) / 2;
        pts.push(x0, 0, 0, xm, h, 0, x1, 0, 0);
      }
    }
    mountainGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
  const mountains = new THREE.Mesh(mountainGeo, new THREE.MeshBasicMaterial({ color: 0x14062b, side: THREE.DoubleSide, fog: false }));
  mountains.position.set(0, 0, -95);
  group.add(mountains);
  const mountainsWire = new THREE.LineSegments(new THREE.WireframeGeometry(mountainGeo),
    new THREE.LineBasicMaterial({ color: 0xff3fa8, transparent: true, opacity: 0.55, fog: false }));
  mountainsWire.position.copy(mountains.position);
  mountainsWire.position.z += 0.1;
  group.add(mountainsWire);

  // --- Scrolling grid floor ---
  const gridMat = new THREE.ShaderMaterial({
    transparent: false, fog: false,
    uniforms: { uTime, uFire },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w;} `,
    fragmentShader: `
      varying vec3 vW; uniform float uTime; uniform float uFire;
      float line(float v, float w){ float d = abs(fract(v - 0.5) - 0.5) / max(fwidth(v), 1e-4); return 1.0 - clamp(d / w, 0.0, 1.0); }
      void main(){
        vec2 p = vec2(vW.x, vW.z + uTime * 1.2);
        float g = max(line(p.x * 0.5, 1.2), line(p.y * 0.5, 1.2));
        float dist = length(vW.xz);
        float fade = exp(-dist * 0.035);
        vec3 lc = mix(vec3(1.0, 0.18, 0.65), vec3(0.15, 0.85, 1.0), smoothstep(-40.0, 10.0, vW.z));
        lc = mix(lc, vec3(1.0, 0.5, 0.1), uFire * 0.6);
        vec3 base = vec3(0.03, 0.0, 0.07);
        vec3 c = base + lc * g * (0.35 + 1.4 * fade);
        // horizon haze
        c = mix(c, vec3(0.35, 0.07, 0.35), smoothstep(30.0, 110.0, dist));
        gl_FragColor = vec4(clamp(c, 0.0, 4.0), 1.0);
      }`,
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(260, 260, 1, 1), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0;
  group.add(grid);

  // Floor under the table that receives shadows (on top of grid).
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.45 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = 0.002;
  shadowFloor.receiveShadow = true;
  group.add(shadowFloor);

  // --- Floating low-poly shapes ---
  const shapes = [];
  // Faceted look via non-indexed geometry + per-face normals (no flatShading: its derivative-based
  // normals go NaN on wireframes/tiny faces, and bloom smears NaN pixels across the screen).
  const facet = (g) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
  const geos = [facet(new THREE.IcosahedronGeometry(0.6, 0)), facet(new THREE.TorusGeometry(0.6, 0.12, 6, 18)), facet(new THREE.ConeGeometry(0.6, 1.0, 4)), facet(new THREE.OctahedronGeometry(0.55, 0))];
  const shapeColors = [PINK, CYAN, ORANGE, PURPLE];
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1;
    const col = shapeColors[i % 4];
    const mat = i % 5 === 0
      ? new THREE.MeshBasicMaterial({ color: col, wireframe: true })
      : new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0.2 });
    const m = new THREE.Mesh(geos[i % geos.length], mat);
    const x = side * (4.5 + Math.random() * 7);
    const z = -3 - Math.random() * 18;
    const y = 2.2 + Math.random() * 4.5;
    m.position.set(x, y, z);
    m.scale.setScalar(0.6 + Math.random() * 0.9);
    m.userData = { y, phase: Math.random() * 6.28, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.2) };
    group.add(m);
    shapes.push(m);
  }

  // --- Spotlight cones (visual) + colour-shifting lights ---
  const coneTex = coneGradientTexture();
  const cones = [];
  for (let i = 0; i < 3; i++) {
    const mat = new THREE.MeshBasicMaterial({ map: coneTex, color: PINK, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0, 5.0, 32, 1, true), mat);
    cone.position.set((i - 1) * 1.6, 3.3, (i - 1) * -0.4);
    group.add(cone);
    // fixture
    const fix = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x222233, emissive: 0xffffff, emissiveIntensity: 0.6 }));
    fix.position.set(cone.position.x, 5.85, cone.position.z);
    group.add(fix);
    cones.push({ cone, mat, base: cone.position.clone(), phase: i * 2.1 });
  }

  // --- Crowd: instanced cubes on bleachers ---
  const ROWS = 3, PER_ROW = 80;
  const crowdCount = ROWS * PER_ROW;
  const crowdGeo = new THREE.BoxGeometry(0.32, 0.42, 0.32);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.0 });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdCount);
  crowd.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const crowdData = [];
  const palette = [PINK, CYAN, ORANGE, PURPLE, new THREE.Color(0xffffff)];
  const tmpColor = new THREE.Color();
  for (let r = 0; r < ROWS; r++) {
    for (let i = 0; i < PER_ROW; i++) {
      const a = (i / (PER_ROW - 1)) * Math.PI * 1.15 - Math.PI * 0.575; // arc behind robot, wrapping sides
      const rad = 8.5 + r * 1.0;
      const x = Math.sin(a) * rad;
      const z = -Math.cos(a) * rad - 0.5;
      const y = 0.21 + r * 0.55;
      const base = palette[(i + r * 7) % palette.length];
      crowdData.push({ x, y, z, rot: -a, phase: Math.random() * 6.28, speed: 3 + Math.random() * 3, base: base.clone(), jump: 0 });
      crowd.setColorAt(r * PER_ROW + i, tmpColor.copy(base).multiplyScalar(0.5));
    }
  }
  group.add(crowd);
  // bleacher steps
  for (let r = 0; r < ROWS; r++) {
    const rad = 8.5 + r * 1.0;
    const step = new THREE.Mesh(new THREE.CylinderGeometry(rad + 0.5, rad + 0.5, 0.02, 64, 1, true, Math.PI - Math.PI * 0.6, Math.PI * 1.2),
      new THREE.MeshBasicMaterial({ color: r % 2 ? 0x22e5ff : 0xff2e88, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }));
    step.scale.y = 1;
    step.position.set(0, r * 0.55, -0.5);
    group.add(step);
  }

  let cheer = 0;
  const cheerColor = new THREE.Color();
  const dummy = new THREE.Object3D();
  let fireTarget = 0;

  function update(dt, t) {
    uTime.value = t;
    uFire.value += (fireTarget - uFire.value) * (1 - Math.exp(-dt * 2));

    for (const m of shapes) {
      const u = m.userData;
      m.position.y = u.y + Math.sin(t * 0.8 + u.phase) * 0.35;
      m.rotation.x += u.spin.x * dt;
      m.rotation.y += u.spin.y * dt;
      m.rotation.z += u.spin.z * dt;
    }

    for (const c of cones) {
      const h = (t * 0.05 + c.phase * 0.15) % 1;
      c.mat.color.setHSL(fireTarget > 0 ? 0.03 + 0.08 * Math.sin(t + c.phase) * 0.5 + 0.04 : (0.83 + h * 0.5) % 1, 1, 0.55);
      c.cone.position.x = c.base.x + Math.sin(t * 0.6 + c.phase) * 0.35;
      c.cone.rotation.z = Math.sin(t * 0.6 + c.phase) * 0.08;
      c.mat.opacity = 0.07 + 0.025 * Math.sin(t * 2 + c.phase) + Math.min(1, cheer) * 0.06;
    }

    cheer = Math.max(0, cheer - dt * 0.7);
    for (let i = 0; i < crowdCount; i++) {
      const d = crowdData[i];
      d.jump = Math.max(0, d.jump - dt * 1.5);
      const idle = Math.max(0, Math.sin(t * d.speed + d.phase)) * 0.06;
      const jumpH = d.jump > 0 ? Math.abs(Math.sin(t * 12 + d.phase)) * 0.5 * d.jump : 0;
      dummy.position.set(d.x, d.y + idle + jumpH, d.z);
      dummy.rotation.set(0, d.rot, 0);
      dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
      if (cheer > 0) {
        tmpColor.copy(d.base).lerp(cheerColor, Math.min(1, cheer) * (0.5 + 0.5 * Math.sin(t * 14 + d.phase))).multiplyScalar(0.5 + Math.min(1, cheer) * 0.5);
        crowd.setColorAt(i, tmpColor);
      }
    }
    crowd.instanceMatrix.needsUpdate = true;
    if (cheer > 0 || cheerWasOn) { crowd.instanceColor.needsUpdate = true; }
    if (cheer <= 0 && cheerWasOn) {
      for (let i = 0; i < crowdCount; i++) crowd.setColorAt(i, tmpColor.copy(crowdData[i].base).multiplyScalar(0.5));
    }
    cheerWasOn = cheer > 0;
  }
  let cheerWasOn = false;

  /** Crowd jumps & flashes in the given colour. */
  function celebrate(color, strength = 1) {
    cheer = 1.6 * strength;
    cheerColor.set(color);
    for (const d of crowdData) d.jump = 0.6 + Math.random() * 0.8 * strength;
  }

  function setFire(level) { fireTarget = level > 0 ? Math.min(1, 0.5 + level * 0.25) : 0; }

  return { group, update, celebrate, setFire, colors: { PINK, ORANGE, CYAN, PURPLE, GOLD } };
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function coneGradientTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export { radialTexture };
