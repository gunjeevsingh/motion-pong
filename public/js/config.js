// All tunables. Overrides are persisted to localStorage and editable live in the debug panel (X).
const STORAGE_KEY = 'motionpong.config.v1';

export const DEFAULTS = Object.freeze({
  // swing detector
  START_THRESH: 10,     // m/s², swing trigger
  FULL_POWER: 32,       // m/s², peak mapped to power 1
  COOLDOWN: 250,        // ms between detected swings
  MAX_WINDOW: 220,      // ms max analysis window
  PEAK_DROP: 0.85,      // emit when |a| < PEAK_DROP × peak
  AIM_GAIN: 1.4,
  LOFT_GAIN: 1.5,
  AIM_DEADZONE: 0.08,
  INVERT_AIM: false,
  INVERT_LOFT: false,
  // forehand / backhand (face rule: the side of the phone facing the table, relative to the calibration pose)
  HANDEDNESS: 'RIGHT',  // RIGHT | LEFT — only used when the face is edge-on and the swing direction decides
  FH_MAX_DEG: 70,       // |face heading| ≤ this → forehand (back of phone toward the table, like calibration)
  BH_MIN_DEG: 110,      // |face heading| ≥ this → backhand (screen toward the table)
  SWAP_STROKES: false,  // flip the face rule (for a thumb-on-the-back grip)
  BH_POWER: 0.85,       // backhand: compact stroke, less top speed…
  BH_PERFECT: 0.85,     // …and a slightly tighter PERFECT window
  WRONG_SIDE_PENALTY: true, // forehand on a backhand-side ball (or vice versa) → weak shot
  // hit timing
  HIT_WINDOW_EARLY: -0.25, // s (tToSweet lower bound)
  HIT_WINDOW_LATE: 0.35,   // s (upper bound)
  PERFECT_SEC: 0.06,
  GOOD_SEC: 0.15,
  // physics / rules
  GRAVITY: 9.0,
  WIN_SCORE: 11,
  DIFFICULTY: 'NORMAL',
  // graphics (threshold 0.2 from the spec washes out this HDR scene; 0.9 keeps only neon glowing)
  BLOOM_STRENGTH: 0.9,
  BLOOM_RADIUS: 0.6,
  BLOOM_THRESHOLD: 0.9,
  // misc
  MASTER_VOLUME: 0.7,
  MUSIC: false,
});

// Ranges for the debug panel sliders.
export const RANGES = {
  START_THRESH: [3, 30, 0.5],
  FULL_POWER: [12, 60, 1],
  COOLDOWN: [50, 800, 10],
  MAX_WINDOW: [60, 500, 10],
  PEAK_DROP: [0.5, 0.98, 0.01],
  AIM_GAIN: [0, 4, 0.05],
  LOFT_GAIN: [0, 4, 0.05],
  AIM_DEADZONE: [0, 0.4, 0.01],
  FH_MAX_DEG: [30, 89, 1],
  BH_MIN_DEG: [91, 160, 1],
  BH_POWER: [0.5, 1.2, 0.01],
  BH_PERFECT: [0.5, 1.5, 0.01],
  HIT_WINDOW_EARLY: [-0.6, 0, 0.01],
  HIT_WINDOW_LATE: [0, 0.8, 0.01],
  PERFECT_SEC: [0.01, 0.2, 0.005],
  GOOD_SEC: [0.05, 0.4, 0.005],
  GRAVITY: [4, 15, 0.1],
  WIN_SCORE: [3, 21, 1],
  MASTER_VOLUME: [0, 1, 0.01],
  BLOOM_STRENGTH: [0, 3, 0.05],
  BLOOM_RADIUS: [0, 1, 0.01],
  BLOOM_THRESHOLD: [0, 2, 0.01],
};

export const DIFFICULTIES = {
  CHILL:  { miss: 0.15, aimErr: 0.30, landTime: 1.05, reaction: 0.25 },
  NORMAL: { miss: 0.08, aimErr: 0.20, landTime: 0.85, reaction: 0.18 },
  SPICY:  { miss: 0.03, aimErr: 0.12, landTime: 0.65, reaction: 0.12 },
};

function load() {
  try {
    const raw = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

/** Live config object: read `CFG.X` anywhere; changes via set() persist. */
export const CFG = { ...DEFAULTS, ...pick(load()) };

function pick(obj) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) if (k in obj && typeof obj[k] === typeof DEFAULTS[k]) out[k] = obj[k];
  return out;
}

export function saveConfig() {
  try {
    const diff = {};
    for (const k of Object.keys(DEFAULTS)) if (CFG[k] !== DEFAULTS[k]) diff[k] = CFG[k];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch { /* storage unavailable */ }
}

export function setConfig(key, value) {
  CFG[key] = value;
  saveConfig();
}

export function resetConfig() {
  Object.assign(CFG, DEFAULTS);
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

// World constants (not tunable: geometry).
export const WORLD = Object.freeze({
  TABLE_W: 1.525,
  TABLE_L: 2.74,
  TABLE_Y: 0.76,
  NET_H: 0.1525,
  BALL_R: 0.04,
  PADDLE_Z: 1.75,
  STEP: 1 / 120,
});
