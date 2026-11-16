// Debug panel (X): lil-gui with live sliders for every tunable; overrides persist to localStorage.
import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { CFG, DEFAULTS, RANGES, DIFFICULTIES, saveConfig, resetConfig } from './config.js';

export function createDebugPanel({ onDifficulty, onVolume, onRecalibrate }) {
  const gui = new GUI({ title: 'Motion Pong — tuning (X)' });
  gui.domElement.style.zIndex = '60';

  const folders = {
    'Swing detector': ['START_THRESH', 'FULL_POWER', 'COOLDOWN', 'MAX_WINDOW', 'PEAK_DROP', 'AIM_GAIN', 'LOFT_GAIN', 'AIM_DEADZONE', 'INVERT_AIM', 'INVERT_LOFT'],
    'Forehand / backhand': ['HANDEDNESS', 'FH_MAX_DEG', 'BH_MIN_DEG', 'SWAP_STROKES', 'BH_POWER', 'BH_PERFECT', 'WRONG_SIDE_PENALTY'],
    'Hit timing': ['HIT_WINDOW_EARLY', 'HIT_WINDOW_LATE', 'PERFECT_SEC', 'GOOD_SEC'],
    'Game': ['GRAVITY', 'WIN_SCORE', 'DIFFICULTY', 'MASTER_VOLUME'],
    'Graphics': ['BLOOM_STRENGTH', 'BLOOM_RADIUS', 'BLOOM_THRESHOLD'],
  };

  for (const [name, keys] of Object.entries(folders)) {
    const f = gui.addFolder(name);
    for (const k of keys) {
      let c;
      if (k === 'DIFFICULTY') c = f.add(CFG, k, Object.keys(DIFFICULTIES));
      else if (k === 'HANDEDNESS') c = f.add(CFG, k, ['RIGHT', 'LEFT']);
      else if (typeof DEFAULTS[k] === 'boolean') c = f.add(CFG, k);
      else { const [mn, mx, st] = RANGES[k]; c = f.add(CFG, k, mn, mx, st); }
      c.onChange((v) => {
        saveConfig();
        if (k === 'DIFFICULTY') onDifficulty?.(v);
        if (k === 'MASTER_VOLUME') onVolume?.(v);
      });
    }
  }
  const actions = {
    recalibrate: () => onRecalibrate?.(),
    reset: () => { resetConfig(); gui.controllersRecursive().forEach((c) => c.updateDisplay()); onDifficulty?.(CFG.DIFFICULTY); onVolume?.(CFG.MASTER_VOLUME); },
  };
  gui.add(actions, 'recalibrate').name('Recalibrate phone (R)');
  gui.add(actions, 'reset').name('Reset all to defaults');
  gui.hide();

  return {
    gui,
    set visible(v) { v ? gui.show() : gui.hide(); },
    get visible() { return !gui._hidden; },
    refresh() { gui.controllersRecursive().forEach((c) => c.updateDisplay()); },
  };
}
