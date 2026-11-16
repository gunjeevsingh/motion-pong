// Boot, game loop, state machine glue.
import * as THREE from 'three';
import { CFG, WORLD, DIFFICULTIES, setConfig } from './config.js';
import { Net, wsUrl, randomRoom, ROOM_ALPHABET } from './net.js';
import { audio } from './audio.js';
import { Ball, stepBall } from './game/physics.js';
import { Rules } from './game/rules.js';
import { solveShot } from './game/shot-solver.js';
import { RobotAI } from './game/ai.js';
import { GameState, PHASE } from './game/state.js';
import { PhoneInput } from './input/phone-input.js';
import { KeyboardInput } from './input/keyboard-input.js';
import { paddlePosition } from './input/paddle-position.js';
import { createScene } from './gfx/scene.js';
import { createPost } from './gfx/post.js';
import { createArena } from './gfx/arena.js';
import { createTable } from './gfx/table.js';
import { createBallView } from './gfx/ball.js';
import { PaddleView } from './gfx/paddles.js';
import { createRobot } from './gfx/robot.js';
import { createFx } from './gfx/fx.js';
import { createHud } from './gfx/hud.js';
import { createDebugPanel } from './debug.js';

const { TABLE_W, TABLE_L, TABLE_Y, PADDLE_Z, STEP } = WORLD;
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LOWFX = params.get('lowfx') === '1';

// ---------------------------------------------------------------- graphics
const S = createScene($('game'), { lowfx: LOWFX });
const post = createPost(S.renderer, S.scene, S.camera, { lowfx: LOWFX });
const arena = createArena(S.scene);
const table = createTable(S.scene);
const ballView = createBallView(S.scene);
const playerPaddle = new PaddleView(S.scene, { face: 0xff2e88, rim: 0xff8a1f, side: 1 });
const robotPaddle = new PaddleView(S.scene, { face: 0x1aa8ff, rim: 0x22e5ff, side: -1 });
const robot = createRobot(S.scene);
const fx = createFx(S.scene);
const hud = createHud();
const C = {
  pink: new THREE.Color(0xff2e88), orange: new THREE.Color(0xff8a1f), cyan: new THREE.Color(0x22e5ff),
  gold: new THREE.Color(0xffd23f), white: new THREE.Color(0xffffff), magenta: new THREE.Color(0xff2ed1),
  lightCyan: new THREE.Color(0x9ff6ff),
};

// ---------------------------------------------------------------- game objects
const game = new GameState();
const ball = new Ball();
const rules = new Rules();
const ai = new RobotAI();
const phone = new PhoneInput();

// ---------------------------------------------------------------- pairing / network
const ROOM_KEY = 'motionpong.room';
let room = sessionStorage.getItem(ROOM_KEY);
if (!room || !new RegExp(`^[${ROOM_ALPHABET}]{4}$`).test(room)) {
  room = randomRoom();
  sessionStorage.setItem(ROOM_KEY, room);
}
const net = new Net({ url: () => wsUrl(room, 'laptop'), onMessage: (m) => phone.handle(m) });
phone.attach(net);

/** Game event → server terminal (not relayed to the phone). kind picks the colour there. */
function termLog(kind, text) { net.send({ type: 'log', kind, text }); }
const sgn = (v) => { const r = v.toFixed(2); return r === '-0.00' ? '+0.00' : (v >= 0 ? '+' : '') + r; };
const scoreStr = () => `YOU ${game.score[1]} – ${game.score[-1]} ROBOT`;

const connectPanel = $('connect');
let serverInfo = { ips: [], httpPort: 3000, httpsPort: 3443 };
let proto = 'https';
let selectedIp = '';

function phoneUrl() {
  const ip = selectedIp || location.hostname;
  return proto === 'https' && serverInfo.httpsPort
    ? `https://${ip}:${serverInfo.httpsPort}/phone.html?room=${room}`
    : `http://${ip}:${serverInfo.httpPort}/phone.html?room=${room}`;
}

function refreshConnectPanel() {
  $('room-code').textContent = room;
  const url = phoneUrl();
  $('phone-url').textContent = url;
  $('qr').src = '/api/qr?text=' + encodeURIComponent(url);
  $('proto-https').classList.toggle('on', proto === 'https');
  $('proto-http').classList.toggle('on', proto === 'http');
  const hint = $('connect-hint');
  if (!serverInfo.ips.length) {
    hint.className = 'hint warn';
    hint.innerHTML = 'No Wi-Fi/LAN address found on this laptop. Connect to Wi-Fi and reload.';
  } else if (proto === 'https') {
    hint.className = 'hint';
    hint.innerHTML = 'Scan with your phone (same Wi-Fi). On the warning page tap <b>Advanced → Proceed</b>, then <b>START</b>.';
  } else {
    hint.className = 'hint warn';
    hint.innerHTML = 'HTTP mode: phone Chrome needs <b>chrome://flags/#unsafely-treat-insecure-origin-as-secure</b> set to <b>' +
      `http://${selectedIp}:${serverInfo.httpPort}</b> (README Option B).`;
  }
}

fetch('/api/info').then((r) => r.json()).then((info) => {
  serverInfo = info;
  if (!info.httpsPort) proto = 'http';
  const sel = $('ip-select');
  sel.innerHTML = '';
  for (const ip of info.ips) {
    const o = document.createElement('option');
    o.value = o.textContent = ip;
    sel.appendChild(o);
  }
  sel.classList.toggle('single', info.ips.length <= 1);
  selectedIp = info.ips[0] || location.hostname;
  refreshConnectPanel();
}).catch(() => refreshConnectPanel());

$('ip-select').addEventListener('change', (e) => { selectedIp = e.target.value; refreshConnectPanel(); });
$('proto-https').addEventListener('click', () => { proto = 'https'; refreshConnectPanel(); });
$('proto-http').addEventListener('click', () => { proto = 'http'; refreshConnectPanel(); });
$('kbd-btn').addEventListener('click', () => { if (game.phase === PHASE.LOBBY) startMatch(); });
refreshConnectPanel();

function hideConnectPanel(connected) {
  if (connected) connectPanel.classList.add('connected');
  setTimeout(() => connectPanel.classList.add('leaving'), connected ? 1100 : 0);
}

function showConnectPanel() {
  connectPanel.classList.remove('leaving', 'connected', 'hidden');
}

phone.onPeer = (connected) => {
  if (connected) {
    audio.connected();
    hud.toast('📱 Phone connected');
    if (game.phase === PHASE.LOBBY) {
      hideConnectPanel(true);
      setTimeout(() => { if (game.phase === PHASE.LOBBY) game.enter(PHASE.CALIBRATE); }, 1300);
    }
  } else {
    hud.toast('Phone disconnected — keyboard still works');
  }
};

phone.onCalibrated = () => {
  hud.toast('✔ Calibrated');
  audio.tick();
  if (game.phase === PHASE.CALIBRATE) startMatch();
};

// ---------------------------------------------------------------- input
const kb = new KeyboardInput({
  onSwing: (ev) => { if (!started) { begin(); return; } handleSwing(ev, 'keyboard'); },
  onKey: (code, e) => onKey(code, e),
});
phone.onSwing((ev) => handleSwing(ev, 'phone'));

let debugOn = false;
const debugPanel = createDebugPanel({
  onDifficulty: (v) => setDifficulty(v, false),
  onVolume: (v) => audio.setVolume(v),
  onRecalibrate: () => recalibrate(),
});

function onKey(code) {
  if (!started) { begin(); return; }
  switch (code) {
    case 'KeyR': recalibrate(); break;
    case 'Digit1': setDifficulty('CHILL'); break;
    case 'Digit2': setDifficulty('NORMAL'); break;
    case 'Digit3': setDifficulty('SPICY'); break;
    case 'KeyX':
      debugOn = !debugOn;
      debugPanel.visible = debugOn;
      hud.setDebug(debugOn);
      break;
    case 'KeyM': hud.toast(audio.toggleMute() ? '🔇 Muted' : '🔊 Sound on'); break;
    case 'KeyN': hud.toast(audio.toggleMusic() ? '🎵 Music on' : 'Music off'); break;
    case 'KeyF':
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
      break;
    case 'Escape': setPaused(!paused); break;
    case 'Enter': if (game.phase === PHASE.LOBBY) startMatch(); break;
  }
}

function setDifficulty(name, persist = true) {
  if (!DIFFICULTIES[name]) return;
  if (persist) setConfig('DIFFICULTY', name);
  hud.setDifficulty(name);
  hud.toast(`Difficulty: ${name}`);
  termLog('info', `difficulty → ${name}`);
  debugPanel.refresh();
}
hud.setDifficulty(CFG.DIFFICULTY);

function recalibrate() {
  if (!phone.connected) { hud.toast('No phone connected'); return; }
  phone.calibrate();
  hud.toast('Calibrating — hold the phone still like a paddle');
}

// ---------------------------------------------------------------- start overlay / pause
let started = false;
let paused = false;
function begin() {
  if (started) return;
  started = true;
  audio.unlock();
  $('start-overlay').classList.add('hidden');
}
$('start-overlay').addEventListener('click', begin);
document.addEventListener('pointerdown', () => audio.unlock(), { once: false });

function setPaused(p) {
  if (game.phase === PHASE.LOBBY) p = false;
  if (p !== paused) termLog('info', p ? '⏸ paused' : '▶ resumed');
  paused = p;
  $('pause').classList.toggle('show', p);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.phase !== PHASE.LOBBY && game.phase !== PHASE.MATCH_END) setPaused(true);
});

// ---------------------------------------------------------------- state machine
let robotServeAt = 0;
let matchEndConfettiAt = 0;
let slowmoUntil = 0;
let hitStopUntil = 0;
let gameTime = 0; // ms of simulated time

function startMatch() {
  game.resetMatch();
  game.firstServer = 1;
  hud.setScore(0, 0);
  hideConnectPanel(false);
  S.resetFocus();
  S.setZoom(0);
  game.enter(PHASE.SERVE);
  termLog('match', `▶ MATCH START · ${CFG.DIFFICULTY} · input: ${phone.connected ? 'phone' : 'keyboard'}`);
}

game.onEnter((phase) => {
  switch (phase) {
    case PHASE.CALIBRATE:
      hud.banner('HOLD STILL', 'calibrating — screen toward you, top edge up');
      phone.status('CALIBRATING', '#22e5ff');
      phone.calibrate();
      break;

    case PHASE.SERVE: {
      rules.reset();
      game.newRally();
      hud.setCombo(0, 0);
      arena.setFire(0);
      ai.reset();
      ball.active = false;
      ball.dead = false;
      ball.gold = false;
      ball.held = true;
      ballView.clearTrail();
      robot.setEmote('determined');
      hud.reason('');
      const srv = game.server;
      hud.setServer(srv);
      hud.setMatchPoint(game.matchPoint);
      S.dolly(0.25);
      if (srv > 0) {
        hud.banner('SWING TO SERVE', phone.connected ? '' : 'press SPACE', 'serve');
        phone.status('YOUR SERVE', '#ff2e88');
      } else {
        hud.banner('ROBOT SERVES', '', 'serve robot small');
        phone.status('GET READY', '#22e5ff');
        robotServeAt = gameTime + 1000;
      }
      break;
    }

    case PHASE.RALLY:
      hud.hideBanner();
      S.dolly(0);
      break;

    case PHASE.POINT_END:
      hud.hideBanner();
      break;

    case PHASE.MATCH_END: {
      const w = game.winner;
      termLog('match', `🏆 MATCH OVER · ${w > 0 ? 'YOU WIN' : 'ROBOT WINS'} · ${scoreStr()}`);
      hud.setMatchPoint(false);
      hud.reason('');
      if (w > 0) {
        hud.banner('YOU WIN!', 'REMATCH — SWING!', 'gold');
        audio.fanfare();
        robot.setEmote('dizzy', 999);
        S.setFocus(0, 1.0, -0.4);
        phone.haptic([60, 40, 60, 40, 120]);
        phone.status('YOU WIN! SWING TO REMATCH', '#ffd23f');
      } else {
        hud.banner('ROBOT WINS', 'REMATCH — SWING!', 'robot');
        audio.sadTrombone();
        robot.setEmote('happy', 999);
        S.setFocus(robot.root.position.x, 1.3, -2.0);
        phone.haptic([300]);
        phone.status('ROBOT WINS — SWING TO REMATCH', '#22e5ff');
      }
      S.setZoom(w > 0 ? 0.35 : 0.9);
      matchEndConfettiAt = performance.now();
      bigConfetti(w);
      break;
    }
  }
});

function bigConfetti(w) {
  const color = w > 0 ? C.pink : C.cyan;
  fx.confettiBurst(w > 0 ? { x: 0, y: 1.3, z: 1.0 } : { x: robot.root.position.x, y: 1.6, z: -2.0 }, color, 300, 1.6);
  arena.celebrate(color, 1.5);
}

// ---------------------------------------------------------------- swings & hits
let lastSwing = null;

function handleSwing(ev, source) {
  if (!started || paused) return;
  lastSwing = { ...ev, source, grade: '', dtMs: null };
  const phaseAtSwing = game.phase;
  queueMicrotask(logSwing.bind(null, lastSwing, phaseAtSwing)); // after the phase handler has graded it
  audio.whoosh(ev.power);
  playerPaddle.swing(ev.power, ev.aim >= 0 ? 1 : -1);

  switch (game.phase) {
    case PHASE.LOBBY:
      if (source === 'keyboard') startMatch();
      else hud.toast('Calibrate first (tap CALIBRATE or press R)');
      return;
    case PHASE.SERVE:
      if (game.server > 0 && ball.held && game.inPhase > 0.35) playerServe(ev);
      return;
    case PHASE.RALLY:
      tryHit(ev);
      return;
    case PHASE.MATCH_END:
      if (game.inPhase > 1.5) startMatch();
      return;
    default:
      hud.showSwing({ ...ev, grade: '' });
  }
}

function logSwing(sw, phase) {
  const g = sw.grade || (phase === PHASE.RALLY ? '' : `(${phase.toLowerCase()})`);
  const timing = sw.dtMs == null ? '' : ` · ${Math.abs(sw.dtMs)} ms ${sw.dtMs > 0 ? 'early' : 'late'}`;
  const peak = sw.peak ? ` · peak ${sw.peak.toFixed(1)} m/s²` : '';
  const kind = g === 'PERFECT' ? 'perfect' : g === 'WHIFF' ? 'whiff' : g ? 'hit' : 'info';
  termLog(kind, `swing [${sw.source}] power ${sw.power.toFixed(2)} · aim ${sgn(sw.aim)} · loft ${sgn(sw.loft)}${peak} → ${g || '—'}${timing}`);
}

function playerServe(ev) {
  const shot = solveShot({
    from: ball.pos, dir: 1, power: Math.max(0.35, ev.power) * 0.85, aim: ev.aim, loft: ev.loft, quality: 0.9,
    baseLandTime: DIFFICULTIES[CFG.DIFFICULTY].landTime * 1.05, rallyCount: 0, gravity: CFG.GRAVITY,
  });
  ball.launch(shot.vel);
  rules.onHit(1);
  game.rally = 1;
  game.enter(PHASE.RALLY);
  juiceHit(ball.pos, ev.power * 0.7, false, 1);
  lastSwing.grade = 'SERVE';
  hud.showSwing({ ...ev, grade: 'SERVE' });
  phone.haptic([25]);
}

function tryHit(ev) {
  const b = ball;
  const eligible = b.active && !b.dead && rules.lastHitter === -1 && b.vel.z > 0 && b.pos.z > 0.4 &&
    (rules.bounces[1] > 0 || b.pos.z > TABLE_L / 2);
  const tToSweet = b.vel.z > 0 ? (PADDLE_Z - b.pos.z) / b.vel.z : Infinity;
  if (Number.isFinite(tToSweet) && b.active && !b.dead) lastSwing.dtMs = Math.round(tToSweet * 1000);

  if (!eligible || tToSweet < CFG.HIT_WINDOW_EARLY || tToSweet > CFG.HIT_WINDOW_LATE) {
    // whiff: no cooldown penalty
    phone.detector.forgiveCooldown();
    let label = 'WHIFF';
    if (b.active && !b.dead && b.vel.z > 0 && rules.lastHitter === -1) {
      if (tToSweet > CFG.HIT_WINDOW_LATE || !eligible) label = 'TOO EARLY';
      else if (tToSweet < CFG.HIT_WINDOW_EARLY) label = 'TOO LATE';
    }
    hud.floatText(label, { x: playerPaddle.x, y: 1.05, z: 1.5 }, 'whiff', 0.7);
    lastSwing.grade = 'WHIFF';
    hud.showSwing({ ...ev, grade: 'WHIFF' });
    return;
  }

  const absT = Math.abs(tToSweet);
  const quality = 1 - Math.min(1, absT / 0.30);
  const grade = absT <= CFG.PERFECT_SEC ? 'PERFECT' : absT <= CFG.GOOD_SEC ? 'GOOD' : tToSweet > 0 ? 'EARLY' : 'LATE';
  const perfect = grade === 'PERFECT';

  playerPaddle.snapTo(b.pos.x, b.pos.y, b.pos.z);
  const shot = solveShot({
    from: b.pos, dir: 1, power: ev.power, aim: ev.aim, loft: ev.loft, quality, perfect,
    baseLandTime: DIFFICULTIES[CFG.DIFFICULTY].landTime, rallyCount: game.rally, gravity: CFG.GRAVITY,
  });
  b.launch(shot.vel);
  b.gold = perfect;
  rules.onHit(1);
  ai.reset();
  game.rally++;
  game.combo++;
  juiceHit(b.pos, ev.power, perfect, 1, grade);
  lastSwing.grade = grade;
  hud.showSwing({ ...ev, grade });
  phone.haptic(perfect ? [20, 30, 40] : [25]);
  phone.status(perfect ? 'PERFECT!' : grade, perfect ? '#ffd23f' : grade === 'GOOD' ? '#7dffb2' : '#ff8a1f');

  // combo / ON FIRE
  const lvl = game.combo >= 15 ? 3 : game.combo >= 10 ? 2 : game.combo >= 5 ? 1 : 0;
  if (lvl > game.fireLevel) {
    game.fireLevel = lvl;
    arena.setFire(lvl);
    hud.floatText(lvl === 1 ? 'ON FIRE!' : lvl === 2 ? 'BLAZING!' : 'INFERNO!', { x: 0, y: 1.5, z: 0 }, 'smash', 1.2);
    termLog('perfect', `🔥 ${lvl === 1 ? 'ON FIRE' : lvl === 2 ? 'BLAZING' : 'INFERNO'} · combo ${game.combo}`);
  }
  hud.setCombo(game.combo, game.fireLevel);
}

/** All the juice for a paddle hit (§10). side: +1 player, -1 robot. */
function juiceHit(pos, p, perfect, side, grade = '') {
  const scale = side > 0 ? 1 : 0.55;
  hitStopUntil = performance.now() + (30 + 50 * p) * scale;
  S.shake((0.01 + 0.05 * p) * scale, 0.18);
  S.kickFov((2 + 4 * p) * scale);
  const count = Math.round((18 + 30 * p) * (side > 0 ? 1 : 0.7));
  let a, b;
  if (side < 0) { a = C.cyan; b = C.lightCyan; }
  else if (perfect) { a = C.gold; b = C.white; }
  else if (p > 0.8) { a = C.magenta; b = C.pink; }
  else { a = C.white; b = C.cyan; }
  fx.burst(pos, count, 2 + 3 * p, a, b, -side);
  fx.shockwave(pos, perfect ? C.gold : side > 0 ? C.pink : C.cyan, 0.3 + 0.4 * p);
  ballView.hitSquash(p);
  post.pulse((0.35 + 0.65 * p) * scale);
  audio.hit(p, perfect);
  if (side > 0) {
    playerPaddle.flashColor(perfect ? 0xffd23f : p > 0.8 ? 0xff2ed1 : 0xff8a1f);
    if (grade) {
      const cls = grade === 'PERFECT' ? 'perfect' : grade === 'GOOD' ? 'good' : 'meh';
      hud.floatText(grade === 'PERFECT' ? 'PERFECT!' : grade, { x: pos.x, y: pos.y + 0.25, z: pos.z - 0.3 }, cls, 0.9);
    }
    if (p > 0.85 && perfect) {
      hud.flash(60);
      fx.shockwave(pos, C.white, 1.4, 0.5);
      hud.floatText('SMASH!!', { x: 0, y: 1.45, z: 0.4 }, 'smash', 1.1);
      S.shake(0.08, 0.25);
      post.pulse(1);
    }
  } else {
    robot.flick(1);
  }
}

function robotHit() {
  const shot = ai.shoot(ball, game.rally);
  robotPaddle.snapTo(ball.pos.x, ball.pos.y, ball.pos.z);
  robotPaddle.swing(0.6, ball.pos.x > ai.x ? -1 : 1);
  ball.launch(shot.vel);
  ball.gold = false;
  rules.onHit(-1);
  game.rally++;
  const p = Math.min(1, Math.max(0, (Math.hypot(shot.vel.x, shot.vel.y, shot.vel.z) - 4) / 5));
  juiceHit(ball.pos, p, false, -1);
}

function robotWhiff() {
  termLog('info', 'robot whiffed');
  setTimeout(() => {
    robotPaddle.swing(0.8, 1);
    audio.whoosh(0.6);
    hud.floatText('WHIFF!', { x: ai.x, y: 1.35, z: -1.9 }, 'whiff', 0.8);
  }, 110);
}

function robotServe() {
  const shot = ai.serve(ball);
  robotPaddle.swing(0.5, 1);
  ball.launch(shot.vel);
  rules.onHit(-1);
  game.rally = 1;
  game.enter(PHASE.RALLY);
  juiceHit(ball.pos, 0.4, false, -1);
}

const REASONS = {
  'own-side': (w) => (w > 0 ? 'ROBOT FAULT' : 'FAULT — BOUNCED ON YOUR SIDE'),
  double: (w) => (w > 0 ? 'ROBOT MISSED' : 'MISSED IT'),
  missed: (w) => (w > 0 ? 'ROBOT MISSED' : 'MISSED IT'),
  net: (w) => (w > 0 ? 'ROBOT HIT THE NET' : 'NET'),
  out: (w) => (w > 0 ? 'ROBOT HIT IT OUT' : 'OUT'),
  floor: (w) => (w > 0 ? 'ROBOT HIT IT OUT' : 'OUT'),
};

function endPoint(result) {
  if (game.phase !== PHASE.RALLY || ball.dead) return;
  ball.dead = true;
  const w = result.winner;
  game.award(w);
  slowmoUntil = performance.now() + 900;
  const color = w > 0 ? C.pink : C.cyan;
  fx.confettiBurst(w > 0 ? { x: 0, y: 1.2, z: 1.3 } : { x: robot.root.position.x, y: 1.5, z: -2.0 }, color, 150);
  arena.celebrate(color, 1);
  hud.setScore(game.score[1], game.score[-1], w);
  robot.setEmote(w > 0 ? 'dizzy' : 'happy', 1.8);
  S.dolly(0.4);
  hud.floatText(w > 0 ? 'POINT!' : 'OUCH', { x: 0, y: 1.35, z: 0.3 }, w > 0 ? 'point' : 'ouch', 1.4);
  hud.reason(REASONS[result.reason]?.(w) || '');
  termLog('point', `● POINT ${w > 0 ? 'YOU' : 'ROBOT'} (${(REASONS[result.reason]?.(w) || result.reason).toLowerCase()}) · rally ${game.rally} · ${scoreStr()}` +
    `${game.matchPoint ? ' · MATCH POINT' : ''}`);
  if (w > 0) audio.pointWon(); else audio.pointLost();
  phone.haptic(w > 0 ? [60, 40, 60] : [200]);
  phone.status(w > 0 ? 'POINT!' : 'OUCH', w > 0 ? '#ff2e88' : '#22e5ff');
  game.combo = 0;
  game.fireLevel = 0;
  hud.setCombo(0, 0);
  arena.setFire(0);
  game.enter(PHASE.POINT_END);
}

// ---------------------------------------------------------------- physics events
function onBallEvent(type, side) {
  const live = game.phase === PHASE.RALLY && !ball.dead;
  switch (type) {
    case 'bounce': {
      fx.ripple(ball.pos, side > 0 ? C.pink : C.cyan);
      fx.puff(ball.pos, 8, C.lightCyan);
      table.pulseEdge(side);
      audio.bounce();
      if (!live) return;
      const res = rules.onBounce(side);
      if (res) { endPoint(res); return; }
      if (side < 0 && rules.lastHitter === 1) ai.onOwnBounce(ball, gameTime, game.rally);
      return;
    }
    case 'net':
      table.hitNet(ball.pos.x, Math.min(1.5, ball.speed() / 5));
      fx.sparks(ball.pos, 14, C.pink);
      audio.net();
      hud.floatText('NET!', { x: ball.pos.x, y: TABLE_Y + 0.35, z: 0 }, 'net', 0.8);
      if (live) endPoint(rules.onDead('net') || { winner: -rules.lastHitter, reason: 'net' });
      return;
    case 'floor':
      if (ball.vel.y > 0.8) audio.bounce();
      if (live) endPoint(rules.onDead('floor') || { winner: -rules.lastHitter, reason: 'floor' });
      return;
    case 'out':
      ball.active = false;
      if (live) endPoint(rules.onDead('out') || { winner: -rules.lastHitter, reason: 'out' });
      return;
  }
}

function physicsStep(dt) {
  gameTime += dt * 1000;
  if (ball.active) stepBall(ball, dt, onBallEvent);
  if (game.phase === PHASE.RALLY && ball.active && !ball.dead) {
    const r = ai.check(ball, rules.lastHitter === 1 && rules.bounces[-1] > 0, gameTime);
    if (r === 'hit') robotHit();
    else if (r === 'whiff') robotWhiff();
  }
  if (game.phase === PHASE.SERVE && game.server < 0 && ball.held && gameTime >= robotServeAt) robotServe();
}

// ---------------------------------------------------------------- render loop
const tilt = { pitch: 0, roll: 0 };
const renderPos = { x: 0, y: 1, z: 0 };
let acc = 0;
let last = performance.now();
let elapsed = 0;
let fpsFrames = 0, fpsT = performance.now(), fps = 60, lastReduce = 0, lastStatsLog = 0;
let debugT = 0;
const ctx = { ballX: 0, ballZ: 0, ballVz: 0, halfWidth: TABLE_W / 2, phase: '' };

function frame(now) {
  requestAnimationFrame(frame);
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  elapsed += realDt;

  // time scale: hit-stop, slow-mo, pause
  let scale = 1;
  if (paused) scale = 0;
  else if (now < hitStopUntil) scale = 0;
  else if (now < slowmoUntil) scale = 0.35;
  const simDt = realDt * scale;

  // held ball (serve) follows the server's paddle
  if (game.phase === PHASE.SERVE && ball.held) {
    const bob = Math.sin(elapsed * 4) * 0.03;
    if (game.server > 0) ball.place(playerPaddle.x, 1.17 + bob, PADDLE_Z - 0.03);
    else ball.place(ai.x, 1.12 + bob, -PADDLE_Z + 0.03);
  }

  acc += simDt;
  let steps = 0;
  while (acc >= STEP && steps < 24) { physicsStep(STEP); acc -= STEP; steps++; }
  if (steps >= 24) acc = 0;
  const alpha = acc / STEP;
  renderPos.x = ball.prev.x + (ball.pos.x - ball.prev.x) * alpha;
  renderPos.y = ball.prev.y + (ball.pos.y - ball.prev.y) * alpha;
  renderPos.z = ball.prev.z + (ball.pos.z - ball.prev.z) * alpha;

  // phase timers (real time)
  if (game.phase === PHASE.POINT_END && game.inPhase > 1.8) {
    if (game.winner) game.enter(PHASE.MATCH_END);
    else game.enter(PHASE.SERVE);
  }
  if (game.phase === PHASE.CALIBRATE && game.inPhase > 7) {
    hud.toast('Calibration skipped — press R any time');
    termLog('warn', 'calibration timed out (no "calibrated" from the phone) — starting anyway');
    startMatch();
  }
  if (game.phase === PHASE.MATCH_END && now - matchEndConfettiAt > 900 && game.inPhase < 4) {
    matchEndConfettiAt = now;
    bigConfetti(game.winner);
  }

  // input-driven visuals
  phone.tick(now);
  if (phone.connected && phone.streaming) phone.tilt(tilt);
  else { tilt.pitch = kb.loft * 0.25; tilt.roll = -kb.aim * 0.2; }

  // AI & paddles (sim time so they slow down with slow-mo)
  ai.update(simDt, ball, gameTime, game.phase);
  ctx.ballX = ball.pos.x; ctx.ballZ = ball.pos.z; ctx.ballVz = ball.vel.z; ctx.phase = game.phase;
  const approaching = ball.active && ball.vel.z > 0 && !ball.dead;
  const px = game.phase === PHASE.SERVE && game.server > 0 ? 0.2 : paddlePosition.getX(ctx) * (TABLE_W / 2);
  if (game.phase === PHASE.SERVE && game.server > 0 && Math.abs(playerPaddle.x - 0.2) > 0.3) playerPaddle.x = 0.2;
  const py = game.phase === PHASE.SERVE && game.server > 0 ? 0.95 : approaching ? Math.min(1.35, Math.max(0.9, ball.pos.y)) : 1.0;
  playerPaddle.tiltPitch = tilt.pitch;
  playerPaddle.tiltRoll = tilt.roll;
  const visDt = Math.max(simDt, realDt * 0.35);
  playerPaddle.update(visDt, px, py);
  robotPaddle.update(visDt, ai.x, ai.y);
  robot.update(visDt, { x: ai.x, handX: robotPaddle.root.position.x, handY: robotPaddle.root.position.y, handZ: robotPaddle.root.position.z });

  // ball view
  const fire = game.fireLevel > 0 && ball.active && !ball.dead;
  ballView.update(renderPos, ball.vel, {
    visible: ball.active || ball.held || ball.dead, gold: ball.gold, fire, dt: visDt, held: ball.held,
  });
  if (fire && simDt > 0) { fx.flame(renderPos); fx.flame(renderPos); }

  // world
  arena.update(realDt, elapsed);
  table.update(visDt);
  fx.update(visDt);
  if (game.phase !== PHASE.POINT_END && game.phase !== PHASE.SERVE && game.phase !== PHASE.MATCH_END) S.dolly(0);
  if (game.phase === PHASE.POINT_END && game.inPhase > 1.2) S.dolly(0);
  S.update(realDt, tilt);
  hud.update(realDt, S.camera);
  post.render(realDt);

  // HUD status + FPS / auto-reduce
  hud.setPhone({ connected: phone.connected, streaming: phone.streaming, rtt: phone.rtt, hz: phone.hz });
  fpsFrames++;
  if (now - fpsT >= 1000) {
    fps = Math.round((fpsFrames * 1000) / (now - fpsT));
    fpsFrames = 0; fpsT = now;
    if (fps < 45 && elapsed > 5 && !document.hidden && now - lastReduce > 4000 && post.reduce()) {
      lastReduce = now;
      console.info(`[motion-pong] FPS ${fps} < 45: bloom resolution → ${post.bloomScale}`);
      termLog('warn', `laptop FPS ${fps} < 45 → bloom resolution lowered to ×${post.bloomScale}`);
    }
    if (started && now - lastStatsLog > 30000) {
      lastStatsLog = now;
      termLog('stats', `📊 laptop ${fps} fps${post.enabled ? ` · bloom ×${post.bloomScale}` : ' · lowfx'} · phase ${game.phase} · ` +
        (phone.connected ? `phone ${phone.hz} Hz, RTT ${Math.round(phone.rtt)} ms` : 'no phone'));
    }
  }
  if (debugOn && now - debugT > 100) {
    debugT = now;
    hud.debugText(debugString());
  }
}

function f3(v) { return v ? v.map((x) => x.toFixed(2).padStart(6)).join(' ') : '   –'; }
function debugString() {
  const f = phone.lastFrame;
  const d = phone.detector;
  const s = lastSwing;
  return [
    `FPS        ${fps}${post.enabled ? `   bloom ×${post.bloomScale}` : '   lowfx'}`,
    `phase      ${game.phase}${paused ? ' (paused)' : ''}   rally ${game.rally}   combo ${game.combo}`,
    `phone      ${phone.connected ? 'connected' : '—'}  ${phone.sensorMode || ''}  ${phone.hz} Hz  RTT ${Math.round(phone.rtt)} ms`,
    `|a|        ${d.lastMag.toFixed(2)}   detector ${d.state}${d.armed ? '' : ' (re-arm)'}`,
    `a  [m/s²]  ${f3(f?.a)}`,
    `g  [m/s²]  ${f3(f?.g)}`,
    `w  [rad/s] ${f3(f?.w)}`,
    `g0         ${f3(d.g0)}`,
    `tilt       pitch ${tilt.pitch.toFixed(2)}  roll ${tilt.roll.toFixed(2)}`,
    `last swing ${s ? `${s.source}  power ${s.power.toFixed(2)}  aim ${s.aim.toFixed(2)}  loft ${s.loft.toFixed(2)}  ${s.grade || ''}` : '—'}`,
    `ball       ${ball.pos.x.toFixed(2)} ${ball.pos.y.toFixed(2)} ${ball.pos.z.toFixed(2)}  v ${ball.speed().toFixed(1)} m/s`,
    `difficulty ${CFG.DIFFICULTY}   room ${room}`,
  ].join('\n');
}

window.addEventListener('resize', () => { S.resize(); post.resize(); });

// boot
hud.setScore(0, 0);
hud.setServer(1);
requestAnimationFrame(frame);

// Expose a tiny handle for automated testing / console tinkering.
window.__motionPong = { game, ball, rules, ai, phone, CFG, PHASE, startMatch, handleSwing, begin, scene: S.scene, camera: S.camera, renderer: S.renderer };
