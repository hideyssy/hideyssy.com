'use strict';

/**
 * Microphone input + analysis. Patterns read the normalized values:
 *   level / bass / mid / treble : 0..1 (smoothed)
 *   beat       : true on the frame a beat is detected
 *   beatPulse  : 1 on beat, decays to 0
 *   slowLevel / slowBass / slowMid / slowTreble : heavily smoothed (~1s), for calm motion
 *   accent     : soft swell on each beat (eases in, fades out over ~1.5s)
 *   freq       : Float32Array 0..1 per FFT bin
 *   wave       : Float32Array -1..1 time-domain samples
 *   getBands(n): n log-spaced bands (40Hz - 12kHz), 0..1
 * When the mic is not running every value decays to silence, so patterns keep idling.
 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.analyser = null;
    this.running = false;

    this.fftSize = 2048;
    this.binCount = this.fftSize / 2;
    this.rawFreq = new Uint8Array(this.binCount);
    this.rawWave = new Uint8Array(this.fftSize);
    this.freq = new Float32Array(this.binCount);
    this.wave = new Float32Array(this.fftSize);
    this.sampleRate = 48000;

    this.sensitivity = 1;
    this.autoGain = true;

    this.level = 0;
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
    this.beat = false;
    this.beatPulse = 0;
    this.slowLevel = 0;
    this.slowBass = 0;
    this.slowMid = 0;
    this.slowTreble = 0;
    this.accent = 0;
    this._accentTarget = 0;
    /** 0..1, how surely something louder than the room's background noise is playing. */
    this.presence = 0;
    /** 0..1, loudness above the background noise, independent of auto gain. */
    this.energy = 0;
    this._energyTarget = 0;
    // Envelopes between the fast and slow ones: follow the music, without jitter.
    this.medLevel = 0;
    this.medBass = 0;
    this.medMid = 0;
    this.medTreble = 0;

    this._agcLevel = 0.2;
    this._noiseFloor = 0.05;
    this._bassAvg = 0;
    this._sinceBeat = 0;
    this._edgeCache = new Map();
    this._bandOut = new Map();
    this._flatTime = 0;

    /** Called when the mic stream stops delivering audio (unplugged, ended, silent stream). */
    this.onLost = null;
  }

  async start(deviceId) {
    this.stop();
    const audio = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio });

    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate;

    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.analyser.smoothingTimeConstant = 0.6;
    this.analyser.minDecibels = -85;
    this.analyser.maxDecibels = -20;
    src.connect(this.analyser);
    this.source = src;
    this.running = true;
    this._flatTime = 0;
    this._edgeCache.clear();

    const stream = this.stream;
    stream.getAudioTracks().forEach(track => {
      track.addEventListener('ended', () => { if (this.stream === stream) this._lost(); });
    });
    this.ctx.onstatechange = () => {
      if (this.running && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {});
    };
  }

  _lost() {
    this.stop();
    if (this.onLost) this.onLost();
  }

  /**
   * The stream is still open but delivers nothing: rebuild the audio graph on
   * the same stream. This never asks the browser for permission again, so it
   * cannot pop up a dialog (which would end fullscreen).
   */
  _reattach() {
    this._flatTime = 0;
    const track = this.stream?.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') { this._lost(); return; }
    try { this.source.disconnect(); } catch (_) {}
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
  }

  stop() {
    if (this.source) { try { this.source.disconnect(); } catch (_) {} }
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.running = false;
  }

  async listDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter(d => d.kind === 'audioinput');
  }

  _binOf(hz) {
    return Math.max(1, Math.min(this.binCount - 1, Math.round(hz / (this.sampleRate / 2) * this.binCount)));
  }

  _avgRaw(fromHz, toHz) {
    const a = this._binOf(fromHz), b = this._binOf(toHz);
    let s = 0;
    for (let i = a; i <= b; i++) s += this.rawFreq[i];
    return s / ((b - a + 1) * 255);
  }

  update(dt) {
    this._updateFast(dt);
    const k = 1 - Math.exp(-dt / 0.9);
    this.slowLevel += (this.level - this.slowLevel) * k;
    this.slowBass += (this.bass - this.slowBass) * k;
    this.slowMid += (this.mid - this.slowMid) * k;
    this.slowTreble += (this.treble - this.slowTreble) * k;
    const km = 1 - Math.exp(-dt / 0.25);
    this.medLevel += (this.level - this.medLevel) * km;
    this.medBass += (this.bass - this.medBass) * km;
    this.medMid += (this.mid - this.medMid) * km;
    this.medTreble += (this.treble - this.medTreble) * km;
    this.energy += (this._energyTarget - this.energy) * (1 - Math.exp(-dt / (this._energyTarget > this.energy ? 0.2 : 0.8)));
    if (this.beat) this._accentTarget = 1;
    this._accentTarget *= Math.exp(-dt * 1.8);
    this.accent += (this._accentTarget - this.accent) * (1 - Math.exp(-dt * 9));
  }

  _updateFast(dt) {
    this.beat = false;
    this._sinceBeat += dt;
    const decay = Math.exp(-dt * 6);
    this.beatPulse *= decay;

    if (!this.running || !this.analyser) {
      const d = Math.exp(-dt * 3);
      this.level *= d; this.bass *= d; this.mid *= d; this.treble *= d; this.presence *= d;
      this._energyTarget = 0;
      for (let i = 0; i < this.binCount; i++) this.freq[i] *= d;
      for (let i = 0; i < this.fftSize; i++) this.wave[i] *= d;
      return;
    }

    this.analyser.getByteFrequencyData(this.rawFreq);
    this.analyser.getByteTimeDomainData(this.rawWave);

    // A live mic always carries some noise; a perfectly flat signal means the audio path stalled.
    let flat = true;
    for (let i = 0; i < this.fftSize; i += 8) if (this.rawWave[i] !== 128) { flat = false; break; }
    this._flatTime = flat ? this._flatTime + dt : 0;
    if (this._flatTime > 10) { this._reattach(); return; }

    const bassRaw = this._avgRaw(30, 250);
    const midRaw = this._avgRaw(250, 2000);
    const trebleRaw = this._avgRaw(2000, 10000);
    const levelRaw = bassRaw * 0.45 + midRaw * 0.35 + trebleRaw * 0.2;

    // The floor follows quiet moments quickly and loud ones slowly; the cap keeps a long,
    // continuous loud section from being mistaken for background noise.
    const floorTau = levelRaw < this._noiseFloor ? 0.5 : 30;
    this._noiseFloor = Math.min(0.12, this._noiseFloor + (levelRaw - this._noiseFloor) * (1 - Math.exp(-dt / floorTau)));
    const above = levelRaw * this.sensitivity - this._noiseFloor;
    const present = above > 0.05 ? 1 : 0;
    // Real loudness (before auto gain), so quiet input moves the geometric visuals only a little.
    this._energyTarget = clamp((above - 0.03) / 0.2, 0, 1);
    this.presence += (present - this.presence) * (1 - Math.exp(-dt / (present ? 0.3 : 1.5)));

    this._agcLevel += (levelRaw - this._agcLevel) * (1 - Math.exp(-dt / 4));
    const agc = this.autoGain ? clamp(0.32 / Math.max(this._agcLevel, 0.03), 0.6, 4) : 1;
    const g = this.sensitivity * agc;

    for (let i = 0; i < this.binCount; i++) this.freq[i] = Math.min(1, this.rawFreq[i] / 255 * g);
    for (let i = 0; i < this.fftSize; i++) this.wave[i] = clamp((this.rawWave[i] - 128) / 128 * g, -1, 1);

    const follow = (cur, target) => target > cur
      ? cur + (target - cur) * (1 - Math.exp(-dt * 25))
      : cur + (target - cur) * (1 - Math.exp(-dt * 5));
    this.level = follow(this.level, Math.min(1, levelRaw * g));
    this.bass = follow(this.bass, Math.min(1, bassRaw * g));
    this.mid = follow(this.mid, Math.min(1, midRaw * g));
    this.treble = follow(this.treble, Math.min(1, trebleRaw * g));

    const bassNow = bassRaw * g;
    this._bassAvg += (bassNow - this._bassAvg) * (1 - Math.exp(-dt / 0.6));
    if (bassNow > this._bassAvg * 1.25 + 0.04 && this._sinceBeat > 0.22 && bassNow > 0.15) {
      this.beat = true;
      this.beatPulse = 1;
      this._sinceBeat = 0;
    }
  }

  bandEdges(n) {
    let edges = this._edgeCache.get(n);
    if (!edges) {
      edges = [];
      const lo = 40, hi = 12000;
      for (let i = 0; i <= n; i++) edges.push(this._binOf(lo * Math.pow(hi / lo, i / n)));
      this._edgeCache.set(n, edges);
    }
    return edges;
  }

  getBands(n) {
    return bandsFrom(this.freq, this.bandEdges(n), bandBuffer(this._bandOut, n));
  }
}

/** Read-only copy of an AudioEngine with every value scaled, for per-visual reaction strength. */
class AudioView {
  constructor(src) {
    this.src = src;
    this.freq = new Float32Array(src.binCount);
    this.wave = new Float32Array(src.fftSize);
    this._bandOut = new Map();
  }

  update(k) {
    const s = this.src;
    this.level = Math.min(1, s.level * k);
    this.bass = Math.min(1, s.bass * k);
    this.mid = Math.min(1, s.mid * k);
    this.treble = Math.min(1, s.treble * k);
    this.beat = k > 0.05 && s.beat;
    this.beatPulse = Math.min(1, s.beatPulse * k);
    this.slowLevel = Math.min(1, s.slowLevel * k);
    this.slowBass = Math.min(1, s.slowBass * k);
    this.slowMid = Math.min(1, s.slowMid * k);
    this.slowTreble = Math.min(1, s.slowTreble * k);
    this.accent = Math.min(1, s.accent * k);
    this.presence = k > 0.05 ? s.presence : 0;
    this.energy = Math.min(1, s.energy * k);
    this.medLevel = Math.min(1, s.medLevel * k);
    this.medBass = Math.min(1, s.medBass * k);
    this.medMid = Math.min(1, s.medMid * k);
    this.medTreble = Math.min(1, s.medTreble * k);
    for (let i = 0; i < this.freq.length; i++) this.freq[i] = Math.min(1, s.freq[i] * k);
    for (let i = 0; i < this.wave.length; i++) this.wave[i] = clamp(s.wave[i] * k, -1, 1);
  }

  getBands(n) {
    return bandsFrom(this.freq, this.src.bandEdges(n), bandBuffer(this._bandOut, n));
  }
}

function bandBuffer(map, n) {
  let out = map.get(n);
  if (!out) { out = new Float32Array(n); map.set(n, out); }
  return out;
}

function bandsFrom(freq, edges, out) {
  for (let i = 0; i < out.length; i++) {
    const a = edges[i];
    const b = Math.max(a, edges[i + 1] - 1);
    let s = 0;
    for (let k = a; k <= b; k++) s += freq[k];
    out[i] = s / (b - a + 1);
  }
  return out;
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
