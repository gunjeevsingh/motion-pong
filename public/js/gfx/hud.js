// HTML overlay HUD: scoreboard, combo, power/timing ring, phone status, banners, floating text, flash.
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);

function pop(el, cls = 'pop') {
  el.classList.remove(cls);
  void el.offsetWidth; // restart animation
  el.classList.add(cls);
}

export function createHud() {
  const el = {
    scoreP: $('score-p'), scoreR: $('score-r'), serveP: $('serve-p'), serveR: $('serve-r'),
    combo: $('combo'), comboN: $('combo-n'), fire: $('fire'),
    ringPower: $('ring-power'), ringAim: $('ring-aim'), ringLabel: $('ring-label'),
    phone: $('phone-status'), phoneText: $('phone-text'), latency: $('latency'),
    banner: $('banner'), bannerText: $('banner-text'), bannerSub: $('banner-sub'),
    reason: $('reason'),
    floatLayer: $('float-layer'), flash: $('flash'), debug: $('debug-hud'),
    toast: $('toast'), diff: $('difficulty'), matchPoint: $('match-point'),
    hud: $('hud'),
  };

  // floating text pool
  const POOL = 12;
  const floats = [];
  for (let i = 0; i < POOL; i++) {
    const d = document.createElement('div');
    d.className = 'float-text';
    d.style.display = 'none';
    el.floatLayer.appendChild(d);
    floats.push({ d, t: 0, life: 0, pos: new THREE.Vector3(), rise: 0 });
  }
  let floatNext = 0;
  const proj = new THREE.Vector3();
  const RING_LEN = 2 * Math.PI * 34;

  let toastTimer = 0;

  return {
    setScore(p, r, popSide = 0) {
      el.scoreP.textContent = p;
      el.scoreR.textContent = r;
      if (popSide > 0) pop(el.scoreP);
      if (popSide < 0) pop(el.scoreR);
    },
    setServer(side) {
      el.serveP.classList.toggle('on', side > 0);
      el.serveR.classList.toggle('on', side < 0);
    },
    setMatchPoint(on) { el.matchPoint.classList.toggle('show', !!on); },
    setCombo(n, fireLevel) {
      el.combo.classList.toggle('show', n >= 3);
      if (n >= 3) { el.comboN.textContent = 'x' + n; el.combo.style.setProperty('--s', String(1 + Math.min(1, (n - 3) / 12) * 0.6)); pop(el.combo); }
      el.fire.classList.toggle('show', fireLevel > 0);
      document.body.classList.toggle('on-fire', fireLevel > 0);
    },
    showSwing({ power, aim, grade, stroke }) {
      el.ringPower.style.strokeDashoffset = String(RING_LEN * (1 - power));
      const color = grade === 'PERFECT' ? '#ffd23f' : grade === 'GOOD' ? '#7dffb2' : grade === 'WHIFF' ? '#8a7aa8' : '#ff8a1f';
      el.ringPower.style.stroke = color;
      el.ringAim.setAttribute('transform', `rotate(${aim * 60} 40 40)`);
      el.ringLabel.textContent = [grade && grade !== 'SERVE' ? stroke : '', grade].filter(Boolean).join(' ');
      el.ringLabel.style.color = color;
      pop(el.ringLabel.parentElement);
    },
    setPhone({ connected, streaming, rtt, hz }) {
      el.phone.classList.toggle('ok', connected && streaming);
      el.phone.classList.toggle('warn', connected && !streaming);
      el.phoneText.textContent = !connected ? 'NO PHONE' : streaming ? `${hz} Hz` : 'NO SENSORS';
      el.latency.textContent = connected && rtt ? `${Math.round(rtt)} ms` : '';
    },
    banner(text, sub = '', cls = '') {
      el.bannerText.textContent = text;
      el.bannerSub.textContent = sub;
      el.banner.className = 'banner show ' + cls;
      pop(el.bannerText, 'pop');
    },
    hideBanner() { el.banner.classList.remove('show'); },
    reason(text) {
      el.reason.textContent = text;
      if (text) pop(el.reason);
    },
    floatText(text, pos, cls = '', life = 1.0) {
      const f = floats[floatNext]; floatNext = (floatNext + 1) % POOL;
      f.d.textContent = text;
      f.d.className = 'float-text ' + cls;
      f.d.style.display = 'block';
      pop(f.d, 'spring');
      f.pos.set(pos.x, pos.y, pos.z);
      f.t = 0; f.life = life; f.rise = 0;
    },
    flash(ms = 60) {
      el.flash.style.transition = 'none';
      el.flash.style.opacity = '0.85';
      void el.flash.offsetWidth;
      el.flash.style.transition = `opacity ${ms * 3}ms ease-out ${ms}ms`;
      el.flash.style.opacity = '0';
    },
    toast(text) {
      el.toast.textContent = text;
      pop(el.toast, 'show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1600);
    },
    setDifficulty(name) { el.diff.textContent = name; },
    setDebug(on) { el.debug.style.display = on ? 'block' : 'none'; },
    debugText(t) { el.debug.textContent = t; },
    update(dt, camera) {
      const w = window.innerWidth, h = window.innerHeight;
      for (const f of floats) {
        if (f.life <= 0) continue;
        f.t += dt;
        if (f.t >= f.life) { f.life = 0; f.d.style.display = 'none'; continue; }
        f.rise += dt * 0.35;
        proj.copy(f.pos); proj.y += f.rise;
        proj.project(camera);
        const x = (proj.x * 0.5 + 0.5) * w, y = (-proj.y * 0.5 + 0.5) * h;
        const fade = Math.min(1, (f.life - f.t) / 0.3);
        f.d.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        f.d.style.opacity = fade.toFixed(2);
      }
    },
  };
}
