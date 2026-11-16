'use strict';

const STORAGE_KEY = 'sound-visualizer.settings.v1';

const DEFAULT_TEXT_STYLE = {
  font: '"Yu Gothic", "YuGothic", "Meiryo", sans-serif',
  weight: '700',
  size: 10,
  x: 50,
  y: 50,
  align: 'center',
  letterSpacing: 0.08,
  lineHeight: 1.3,
  color: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 0,
  shadowColor: '#000000',
  shadowBlur: 0.25,
  opacity: 1,
};

/** Colour behind each visual; the visual is screen-blended over it. */
const BACKDROPS = {
  black: '黒',
  palette: 'パレット色（深い）',
  paletteLight: 'パレット色（明るい）',
  color: '色を指定',
};
const DEFAULT_BACKDROP_COLOR = '#1c2850';

function defaultSettings() {
  return {
    texts: ['WELCOME', 'Sound Visualizer', 'ようこそ'],
    /** Per-text size, as a multiple of textStyle.size (kept parallel to texts). */
    textScales: [],
    textIndex: 0,
    showText: true,
    visuals: [
      { pattern: 'blobs', palette: 'aurora' },
      { pattern: 'smoke', palette: 'neon' },
      { pattern: 'bokeh', palette: 'sunset' },
      { pattern: 'liquid', palette: 'ocean' },
      { pattern: 'nebula', palette: 'neon' },
      { pattern: 'rays', palette: 'gold' },
      { pattern: 'ripple', palette: 'ocean' },
      { pattern: 'fireflies', palette: 'forest' },
      { pattern: 'silk', palette: 'sakura' },
      { pattern: 'aurora', palette: 'aurora' },
      { pattern: 'spiral', palette: 'pastel' },
    ],
    visualIndex: 0,
    textStyle: { ...DEFAULT_TEXT_STYLE },
    reactions: { pulse: false, glow: false, shake: false, color: false, strength: 1 },
    fade: { text: 1.5, visual: 3 },
    spaceTarget: 'both',
    audio: { sensitivity: 1, autoGain: true, deviceId: '' },
    autoVisual: { enabled: false, minutes: 5 },
    autoText: { enabled: false, seconds: 10 },
    transition: { visual: 'fade', text: 'fade' },
    clock: { seconds: false },
    countdown: { hours: 0, minutes: 5, seconds: 0, endText: 'まもなく開始します' },
    renderScale: '1',
    finish: true,
    background: {
      fit: 'cover',
      blend: 'screen',
      dim: 0.3,
      blur: 0,
      visualOpacity: 0.85,
      motion: true,
      react: false,
    },
    logo: {
      image: '',
      enabled: true,
      position: 'bottom-right',
      size: 12,
      margin: 3,
      opacity: 0.9,
    },
  };
}

/** Fill in keys missing from saved/imported data so older files keep working. */
function mergeDefaults(def, data) {
  if (Array.isArray(def)) return Array.isArray(data) ? data : def;
  if (def && typeof def === 'object') {
    const out = {};
    for (const k of Object.keys(def)) out[k] = mergeDefaults(def[k], data ? data[k] : undefined);
    return out;
  }
  return data === undefined || data === null ? def : data;
}

function sanitize(s) {
  // Older versions wrote line breaks as a typed "\n".
  s.texts = s.texts.map(t => String(t ?? '').replace(/\\n/g, '\n'));
  s.textScales = s.texts.map((_, i) => clamp(finiteOr(Number(s.textScales[i]), 1), 0.2, 5));
  s.visuals = s.visuals
    .filter(v => v && typeof v === 'object')
    .map(v => ({
      pattern: PATTERNS[v.pattern] ? v.pattern : (LEGACY_PATTERNS[v.pattern] || 'blobs'),
      palette: PALETTES[v.palette] ? v.palette : 'neon',
      image: typeof v.image === 'string' ? v.image : '',
      speed: finiteOr(v.speed, 1),
      intensity: finiteOr(v.intensity, 1),
      brightness: finiteOr(v.brightness, 1),
      backdrop: BACKDROPS[v.backdrop] ? v.backdrop : 'black',
      backdropColor: /^#[0-9a-f]{6}$/i.test(v.backdropColor) ? v.backdropColor : DEFAULT_BACKDROP_COLOR,
    }));
  if (!s.visuals.length) s.visuals = defaultSettings().visuals;
  s.textIndex = Math.min(Math.max(0, s.textIndex | 0), Math.max(0, s.texts.length - 1));
  s.visualIndex = Math.min(Math.max(0, s.visualIndex | 0), s.visuals.length - 1);
  return s;
}

const Store = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitize(mergeDefaults(defaultSettings(), JSON.parse(raw)));
    } catch (e) {
      console.warn('設定の読み込みに失敗しました', e);
    }
    return sanitize(defaultSettings());
  },

  fromJSON(text) {
    return sanitize(mergeDefaults(defaultSettings(), JSON.parse(text)));
  },

  _timer: 0,
  save(settings) {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { console.warn(e); }
    }, 300);
  },
};

function finiteOr(v, def) {
  return Number.isFinite(v) ? v : def;
}

const PRESET_KEY = 'sound-visualizer.presets.v1';

/** Named snapshots of the settings (mic settings are kept per PC, so they are left out). */
const PresetStore = {
  list() {
    try {
      const list = JSON.parse(localStorage.getItem(PRESET_KEY) || '[]');
      return Array.isArray(list) ? list.filter(p => p && typeof p.name === 'string' && p.data) : [];
    } catch (_) {
      return [];
    }
  },

  _write(list) {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
  },

  save(name, settings) {
    const data = JSON.parse(JSON.stringify(settings));
    delete data.audio;
    const list = this.list().filter(p => p.name !== name);
    list.push({ name, savedAt: Date.now(), data });
    this._write(list);
  },

  remove(name) {
    this._write(this.list().filter(p => p.name !== name));
  },

  /** Merge presets from an imported settings file (same name is overwritten). */
  merge(presets) {
    const list = this.list();
    for (const p of presets) {
      if (!p || typeof p.name !== 'string' || !p.data) continue;
      const i = list.findIndex(q => q.name === p.name);
      if (i >= 0) list[i] = p; else list.push(p);
    }
    this._write(list);
  },

  toSettings(preset, current) {
    return Store.fromJSON(JSON.stringify({ ...preset.data, audio: current.audio }));
  },
};

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}
