'use strict';

/** Start state of the incoming text (from) and end state of the outgoing text (out). */
const TEXT_EFFECTS = {
  fade: { from: {}, out: {} },
  blur: { from: { filter: 'blur(0.3em)' }, out: { filter: 'blur(0.3em)' } },
  zoom: { from: { transform: 'scale(0.8)' }, out: { transform: 'scale(1.2)' } },
  rise: { from: { transform: 'translateY(0.6em)' }, out: { transform: 'translateY(-0.6em)' } },
};

/**
 * Two stacked layers inside one wrapper: the style lives on the wrapper so it
 * carries over to every message, and switching just crossfades the layers.
 * Templates containing {tokens} are re-rendered every frame via `formatter`.
 */
class TextOverlay {
  constructor(wrap) {
    this.wrap = wrap;
    this.layers = [document.createElement('div'), document.createElement('div')];
    this.layers.forEach(l => { l.className = 'text-layer'; wrap.appendChild(l); });
    this.active = 0;
    this.template = '';
    this.rendered = '';
    this.formatter = s => s;
    this.effect = 'fade';
    this.style = null;
    this.baseShadow = 'none';
    this.reactive = false;
    this.shakeX = 0; this.shakeY = 0;
    this.shakeTX = 0; this.shakeTY = 0;
  }

  _render(template) {
    return this.formatter(template || '').replace(/\\n/g, '\n');
  }

  /** scale: size of this text relative to the common style size. */
  show(text, fadeSec, scale = 1) {
    const next = 1 - this.active;
    const inEl = this.layers[next];
    const outEl = this.layers[this.active];
    const fx = TEXT_EFFECTS[this.effect] || TEXT_EFFECTS.fade;
    const d = Math.max(0, fadeSec);

    this.template = text || '';
    this.rendered = this._render(this.template);
    inEl.textContent = this.rendered;
    this._scaleLayer(inEl, scale);

    inEl.style.transition = 'none';
    inEl.style.opacity = 0;
    inEl.style.transform = fx.from.transform || 'none';
    inEl.style.filter = fx.from.filter || 'none';
    void inEl.offsetWidth;

    const tr = `opacity ${d}s ease-in-out, transform ${d}s ease-out, filter ${d}s ease-in-out`;
    inEl.style.transition = tr;
    outEl.style.transition = tr;
    inEl.style.opacity = 1;
    inEl.style.transform = 'none';
    inEl.style.filter = 'none';
    outEl.style.opacity = 0;
    outEl.style.transform = fx.out.transform || 'none';
    outEl.style.filter = fx.out.filter || 'none';
    this.active = next;
  }

  _scaleLayer(el, scale) {
    el.style.fontSize = scale === 1 ? '' : scale + 'em';
  }

  /** Resize the text currently on screen (while editing its size). */
  setScale(scale) {
    this._scaleLayer(this.layers[this.active], scale);
  }

  /** Re-render live tokens such as {clock}; cheap no-op for plain text. */
  tick() {
    if (!this.template.includes('{')) return;
    const s = this._render(this.template);
    if (s !== this.rendered) {
      this.rendered = s;
      this.layers[this.active].textContent = s;
    }
  }

  setVisible(v) {
    this.wrap.classList.toggle('off', !v);
  }

  applyStyle(s) {
    this.style = s;
    const w = this.wrap.style;
    w.left = s.x + '%';
    w.top = s.y + '%';
    w.fontFamily = s.font;
    w.fontWeight = s.weight;
    w.fontSize = s.size + 'vh';
    w.color = s.color;
    w.textAlign = s.align;
    w.letterSpacing = s.letterSpacing + 'em';
    w.lineHeight = s.lineHeight;
    w.opacity = s.opacity;
    w.webkitTextStroke = s.outlineWidth > 0 ? `${s.outlineWidth * 2}em ${s.outlineColor}` : '0';
    this.baseShadow = s.shadowBlur > 0 ? `0 0 ${s.shadowBlur}em ${s.shadowColor}, 0 0 ${s.shadowBlur * 0.4}em ${s.shadowColor}` : '';
    w.textShadow = this.baseShadow || 'none';
    w.transform = 'translate(-50%, -50%)';
  }

  update(audio, dt, palette, reactions, t) {
    this.tick();
    const s = this.style;
    if (!s) return;
    const on = reactions.pulse || reactions.glow || reactions.shake || reactions.color;
    const w = this.wrap.style;
    if (!on) {
      if (this.reactive) { this.reactive = false; this.applyStyle(s); }
      return;
    }
    this.reactive = true;
    const k = reactions.strength;

    let scale = 1;
    if (reactions.pulse) scale = 1 + (audio.level * 0.12 + audio.beatPulse * 0.05) * k;

    let dx = 0, dy = 0;
    if (reactions.shake) {
      if (audio.beat) {
        const ang = Math.random() * Math.PI * 2;
        const mag = (0.4 + audio.bass) * 0.8 * k;
        this.shakeTX = Math.cos(ang) * mag;
        this.shakeTY = Math.sin(ang) * mag;
      }
      this.shakeTX *= Math.exp(-dt * 8);
      this.shakeTY *= Math.exp(-dt * 8);
      const f = 1 - Math.exp(-dt * 30);
      this.shakeX += (this.shakeTX - this.shakeX) * f;
      this.shakeY += (this.shakeTY - this.shakeY) * f;
      dx = this.shakeX; dy = this.shakeY;
    }
    w.transform = `translate(-50%, -50%) translate(${dx.toFixed(3)}vh, ${dy.toFixed(3)}vh) scale(${scale.toFixed(4)})`;

    if (reactions.glow) {
      const r = (0.04 + audio.level * 0.35 * k + audio.beatPulse * 0.1 * k).toFixed(3);
      const gc = palColor(palette, t * 0.05, Math.min(1, 0.5 + audio.level * k));
      const glow = `0 0 ${r}em ${gc}, 0 0 ${(r * 0.4).toFixed(3)}em ${gc}`;
      w.textShadow = this.baseShadow ? `${this.baseShadow}, ${glow}` : glow;
    } else {
      w.textShadow = this.baseShadow || 'none';
    }

    if (reactions.color) {
      const base = hexToRgb(s.color);
      const pc = palRgb(palette, t * 0.08);
      const m = Math.min(1, (audio.level * 1.3 + audio.beatPulse * 0.3) * k);
      const c = base.map((b, i) => Math.round(b + (pc[i] - b) * m));
      w.color = `rgb(${c[0]},${c[1]},${c[2]})`;
    } else {
      w.color = s.color;
    }
  }
}
