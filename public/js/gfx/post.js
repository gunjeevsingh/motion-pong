// Post-processing: bloom + chromatic-aberration pulse + output. ?lowfx=1 renders directly.
import * as THREE from 'three';
import { CFG } from '../config.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const ChromaticShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main() {
      vec2 d = (vUv - 0.5);
      float r2 = dot(d, d);
      vec2 off = d * amount * (0.4 + r2 * 2.0);
      vec4 c = texture2D(tDiffuse, vUv);
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.b = texture2D(tDiffuse, vUv - off).b;
      // subtle vignette
      c.rgb *= 1.0 - r2 * 0.55;
      gl_FragColor = c;
    }`,
};

export function createPost(renderer, scene, camera, { lowfx }) {
  let pulse = 0;
  let bloomScale = 1;

  if (lowfx) {
    return {
      enabled: false,
      render() { renderer.render(scene, camera); },
      pulse() {},
      resize() {},
      reduce() { return false; },
      get bloomScale() { return 0; },
    };
  }

  const size = new THREE.Vector2();
  renderer.getSize(size);
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), CFG.BLOOM_STRENGTH, CFG.BLOOM_RADIUS, CFG.BLOOM_THRESHOLD);
  composer.addPass(bloom);
  const chroma = new ShaderPass(ChromaticShader);
  composer.addPass(chroma);
  composer.addPass(new OutputPass());

  function applyBloomSize() {
    renderer.getSize(size);
    const pr = renderer.getPixelRatio();
    bloom.setSize(Math.round(size.x * pr * bloomScale), Math.round(size.y * pr * bloomScale));
  }

  return {
    enabled: true,
    bloom,
    render(dt) {
      pulse *= Math.exp(-dt / 0.12);
      bloom.strength = CFG.BLOOM_STRENGTH + pulse * 0.9;
      bloom.radius = CFG.BLOOM_RADIUS;
      bloom.threshold = CFG.BLOOM_THRESHOLD;
      chroma.uniforms.amount.value = 0.0015 + pulse * 0.018;
      composer.render(dt);
    },
    /** 0..1 bloom + chromatic pulse */
    pulse(p) { pulse = Math.max(pulse, p); },
    resize() {
      renderer.getSize(size);
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(size.x, size.y);
      applyBloomSize();
    },
    /** Called when FPS is low: halves bloom resolution (down to 1/4). Returns true if it changed anything. */
    reduce() {
      if (bloomScale <= 0.25) return false;
      bloomScale /= 2;
      applyBloomSize();
      return true;
    },
    get bloomScale() { return bloomScale; },
  };
}
