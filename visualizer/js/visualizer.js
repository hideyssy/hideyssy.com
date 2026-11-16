'use strict';

/**
 * Holds the active layer and crossfades to a new one. A layer is a container
 * with an optional background image and the pattern <canvas> blended on top,
 * so image and pattern always switch together. Opacity is animated so both
 * layers keep moving while the fade runs.
 */
class Visualizer {
  constructor(container) {
    this.container = container;
    this.scale = 1;
    this.bg = null;
    this.effect = 'fade';
    this.current = null;
    this.incoming = null;
    this.fadeDur = 0;
    this.fadeT = 0;
    window.addEventListener('resize', () => this.resize());
  }

  /** Create the pattern on a fresh canvas; WebGL patterns fall back to the gradient if WebGL is unavailable. */
  _createPattern(def) {
    if (def.gl) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
      if (gl) {
        try {
          return { canvas, gl, ctx: gl, inst: def.create(gl), res: def.resScale || 1 };
        } catch (e) {
          console.warn('WebGL の映像を作成できませんでした', e);
          gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
      }
      def = PATTERNS.blobs;
    }
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d');
    return { canvas, gl: null, ctx: g, inst: def.create(), res: def.resScale || 1 };
  }

  _makeLayer(entry) {
    const def = PATTERNS[entry.pattern] || PATTERNS.blobs;
    const el = document.createElement('div');
    el.className = 'layer';
    const bgEl = document.createElement('div');
    bgEl.className = 'layer-bg';
    const made = this._createPattern(def);
    const canvas = made.canvas;
    el.append(bgEl, canvas);
    const layer = {
      entry,
      el,
      bgEl,
      canvas,
      gl: made.gl,
      ctx: made.ctx,
      inst: made.inst,
      res: made.res,
      lost: false,
      disposed: false,
      palette: getPalette(entry.palette),
      imageUrl: ImageStore.url(entry.image),
      phase: Math.random() * 100,
      clock: 0,
      view: null,
      brightness: 1,
    };
    if (layer.imageUrl) bgEl.style.backgroundImage = `url("${layer.imageUrl}")`;
    if (layer.gl) {
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); layer.lost = true; });
    }
    this._size(layer);
    this._styleLayer(layer);
    if (!layer.gl) {
      layer.ctx.fillStyle = '#000';
      layer.ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    this.container.appendChild(el);
    return layer;
  }

  _dispose(layer) {
    layer.disposed = true;
    try { layer.inst.dispose?.(); } catch (_) { /* context may already be gone */ }
    if (layer.gl) layer.gl.getExtension('WEBGL_lose_context')?.loseContext();
    layer.el.remove();
  }

  _size(layer) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const k = dpr * this.scale * layer.res;
    const w = Math.max(1, Math.round(window.innerWidth * k));
    const h = Math.max(1, Math.round(window.innerHeight * k));
    if (layer.canvas.width !== w || layer.canvas.height !== h) {
      layer.canvas.width = w;
      layer.canvas.height = h;
    }
  }

  /** CSS colour behind the visual, or '' for plain black. */
  _backdropColor(layer) {
    const e = layer.entry;
    if (e.backdrop === 'color') return e.backdropColor;
    if (e.backdrop !== 'palette' && e.backdrop !== 'paletteLight') return '';
    // A single palette colour: averaging all four turns most palettes grey.
    const k = e.backdrop === 'palette' ? 0.28 : 0.5;
    const c = layer.palette.rgb[1].map(x => Math.round(x * k));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  _styleLayer(layer) {
    const b = this.bg;
    if (!b) return;
    const has = !!layer.imageUrl;
    const backdrop = this._backdropColor(layer);
    layer.el.style.backgroundColor = backdrop;
    layer.bgEl.style.display = has ? '' : 'none';
    layer.bgEl.style.backgroundSize = b.fit;
    const blurPx = b.blur * window.innerHeight / 100;
    layer.bgEl.style.filter = `brightness(${(1 - b.dim).toFixed(2)})` + (blurPx > 0 ? ` blur(${blurPx.toFixed(1)}px)` : '');
    layer.canvas.style.mixBlendMode = has ? b.blend : (backdrop ? 'screen' : 'normal');
    layer.canvas.style.opacity = has ? b.visualOpacity : 1;
    layer.canvas.style.display = PATTERNS[layer.entry.pattern]?.empty ? 'none' : '';
    if (!b.motion && !b.react) layer.bgEl.style.transform = b.blur > 0 ? 'scale(1.06)' : '';
  }

  _layers() {
    return [this.current, this.incoming].filter(Boolean);
  }

  resize() {
    for (const l of this._layers()) { this._size(l); this._styleLayer(l); }
  }

  setScale(s) {
    this.scale = s;
    this.resize();
  }

  setBackground(bg) {
    this.bg = bg;
    this.restyle();
  }

  restyle() {
    for (const l of this._layers()) this._styleLayer(l);
  }

  setEffect(effect) {
    this.effect = effect;
  }

  get palette() {
    return (this.incoming && this.fadeT / Math.max(this.fadeDur, 1e-6) > 0.5 ? this.incoming : this.current)?.palette || PALETTES.neon;
  }

  show(entry, fadeSec) {
    if (this.incoming) this._finishFade();
    const layer = this._makeLayer(entry);
    if (!this.current || fadeSec <= 0) {
      if (this.current) this._dispose(this.current);
      this.current = layer;
      layer.el.style.opacity = 1;
      return;
    }
    layer.el.style.opacity = 0;
    this.incoming = layer;
    this.fadeDur = fadeSec;
    this.fadeT = 0;
  }

  _finishFade() {
    this._dispose(this.current);
    this.current = this.incoming;
    const st = this.current.el.style;
    st.opacity = 1;
    st.transform = '';
    st.filter = '';
    this.incoming = null;
  }

  /** e: eased progress 0..1 of the incoming layer. */
  _applyTransition(e) {
    const inS = this.incoming.el.style, curS = this.current.el.style;
    switch (this.effect) {
      case 'zoom':
        inS.opacity = e;
        inS.transform = `scale(${(1.25 - 0.25 * e).toFixed(4)})`;
        curS.transform = `scale(${(1 + 0.15 * e).toFixed(4)})`;
        curS.opacity = 1 - e * 0.5;
        break;
      case 'blur':
        inS.opacity = e;
        inS.filter = `blur(${((1 - e) * 24).toFixed(1)}px)`;
        curS.filter = `blur(${(e * 24).toFixed(1)}px)`;
        curS.opacity = 1 - e * 0.35;
        break;
      case 'slide':
        inS.opacity = Math.min(1, e * 1.5);
        inS.transform = `translateX(${((1 - e) * 100).toFixed(2)}%)`;
        curS.transform = `translateX(${(-e * 30).toFixed(2)}%)`;
        curS.opacity = 1 - e * 0.6;
        break;
      default:
        inS.opacity = e;
        curS.opacity = 1 - e * 0.35;
    }
  }

  _drawLayer(layer, audio, dt, t) {
    const c = layer.canvas;
    const entry = layer.entry;
    const speed = entry.speed ?? 1;
    const intensity = entry.intensity ?? 1;
    const brightness = entry.brightness ?? 1;

    let a = audio;
    if (intensity !== 1) {
      if (!layer.view) layer.view = new AudioView(audio);
      layer.view.update(intensity);
      a = layer.view;
    }
    if (layer.brightness !== brightness) {
      layer.brightness = brightness;
      c.style.filter = brightness === 1 ? '' : `brightness(${brightness})`;
    }
    layer.clock += dt * speed;
    if (layer.lost) return;
    layer.inst.draw(layer.ctx, a, dt * speed, layer.clock, layer.palette, c.width, c.height);

    const b = this.bg;
    if (!layer.imageUrl || !b || (!b.motion && !b.react)) return;
    let sc = b.blur > 0 ? 1.06 : 1;
    let tx = 0, ty = 0;
    if (b.motion) {
      const p = layer.phase;
      sc = Math.max(sc, 1.08 + 0.04 * Math.sin(t * 0.05 + p));
      tx = 1.5 * Math.sin(t * 0.031 + p);
      ty = 1.0 * Math.cos(t * 0.023 + p * 0.7);
    }
    if (b.react) sc += audio.level * 0.04 + audio.beatPulse * 0.025;
    layer.bgEl.style.transform = `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${sc.toFixed(4)})`;
  }

  frame(audio, dt, t) {
    // GPU reset (driver update, sleep, etc.): rebuild the visible pattern instead of leaving it blank.
    if (this.current && this.current.lost && !this.incoming) this.show(this.current.entry, 1);
    if (this.current) this._drawLayer(this.current, audio, dt, t);
    if (this.incoming) {
      this._drawLayer(this.incoming, audio, dt, t);
      this.fadeT += dt;
      const p = Math.min(1, this.fadeT / this.fadeDur);
      this._applyTransition(p * p * (3 - 2 * p));
      if (p >= 1) this._finishFade();
    }
  }
}
