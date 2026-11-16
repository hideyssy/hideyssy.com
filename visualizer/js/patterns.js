'use strict';

/**
 * Pattern registry. create() returns an instance with
 *   draw(ctx, audio, dt, t, palette, w, h)
 * Canvas patterns get a 2D context; patterns with `gl: true` get a WebGL
 * context (and are rendered at `resScale` of the layer size, since their
 * soft look tolerates upscaling). Motion should follow the slow* values and
 * beats should only drive `accent`, so nothing jitters.
 */

const TAU = Math.PI * 2;

/** Very dark, palette-tinted background colour (never pure black). */
function darkTint(pal, t, k, alpha = 1) {
  const c = palRgb(pal, t);
  return `rgba(${(5 + c[0] * k) | 0},${(5 + c[1] * k) | 0},${(9 + c[2] * k) | 0},${alpha})`;
}

/** Radial sprite in a palette colour; stops: [[offset, alpha, whiten 0..1], ...]. */
function makeSprite(rgb, size, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, a, wh = 0] of stops) {
    const r = rgb[0] + (255 - rgb[0]) * wh, gg = rgb[1] + (255 - rgb[1]) * wh, b = rgb[2] + (255 - rgb[2]) * wh;
    grad.addColorStop(o, `rgba(${r | 0},${gg | 0},${b | 0},${a})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

function spriteSet(cache, pal, size, stops) {
  if (cache.pal !== pal) {
    cache.pal = pal;
    cache.sprites = pal.rgb.map(rgb => makeSprite(rgb, size, stops));
  }
  return cache.sprites;
}

const PATTERNS = {
  /** No visual: only the background image / colour (or black) shows. */
  none: {
    name: 'なし（背景のみ）',
    empty: true,
    resScale: 0.1,
    create() { return { draw() {} }; },
  },

  // ---------------------------------------------------------------- Canvas
  blobs: {
    name: 'グラデーション',
    create() {
      const B = 6;
      const blobs = Array.from({ length: B }, (_, i) => ({
        ph: Math.random() * TAU, fx: 0.3 + Math.random() * 0.5, fy: 0.25 + Math.random() * 0.5, hue: i / B,
      }));
      const back = Array.from({ length: 3 }, (_, i) => ({ ph: Math.random() * TAU, hue: i / 3 + 0.15 }));
      const sm = new Float32Array(B);
      let clock = 0;
      return {
        draw(g, a, dt, t, pal, w, h) {
          clock += dt * (0.12 + a.slowLevel * 0.35);
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = darkTint(pal, 0.5 + t * 0.01, 0.045);
          g.fillRect(0, 0, w, h);
          const m = Math.min(w, h);
          const bands = a.getBands(B);
          const k = 1 - Math.exp(-dt * 3);
          g.globalCompositeOperation = 'lighter';
          for (const b of back) {
            const px = w / 2 + Math.cos(clock * 0.13 + b.ph) * w * 0.3;
            const py = h / 2 + Math.sin(clock * 0.11 + b.ph * 1.7) * h * 0.25;
            const r = m * 0.75;
            const grad = g.createRadialGradient(px, py, 0, px, py, r);
            grad.addColorStop(0, palColor(pal, b.hue + t * 0.008, 0.16 + a.slowLevel * 0.08));
            grad.addColorStop(1, palColor(pal, b.hue + t * 0.008, 0));
            g.fillStyle = grad;
            g.fillRect(px - r, py - r, r * 2, r * 2);
          }
          for (let i = 0; i < B; i++) {
            sm[i] += (bands[i] - sm[i]) * k;
            const b = blobs[i];
            const px = w / 2 + Math.cos(clock * b.fx + b.ph) * w * 0.35;
            const py = h / 2 + Math.sin(clock * b.fy + b.ph * 1.3) * h * 0.32;
            const r = m * (0.32 + sm[i] * 0.28 + a.accent * 0.06);
            const grad = g.createRadialGradient(px, py, 0, px, py, r);
            grad.addColorStop(0, palColor(pal, b.hue + t * 0.01, 0.36 + sm[i] * 0.22 + a.accent * 0.08));
            grad.addColorStop(1, palColor(pal, b.hue + t * 0.01, 0));
            g.fillStyle = grad;
            g.fillRect(px - r, py - r, r * 2, r * 2);
          }
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },

  smoke: {
    name: 'スモーク',
    gl: true,
    resScale: 0.5,
    create(gl) {
      const pass = new GLPass(gl, `
uniform vec2 u_plume;
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.045;
  vec2 p = uv * 1.5;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.8));
  float warp = 2.2 + u_bass * 1.6;
  vec2 r = vec2(fbm(p + warp * q + vec2(1.7, 9.2) + t * 0.6), fbm(p + warp * q + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm(p + 3.0 * r);
  vec3 base = vec3(0.006, 0.006, 0.012) + pal(0.6) * 0.02;
  float dens = smoothstep(0.18, 0.78, f);
  vec3 col = mix(base, pal(f * 0.7 + q.x * 0.4) * 0.85, dens);
  col += pal(r.y * 0.8 + 0.3) * pow(f, 3.0) * 0.9;
  col += pal(q.y + 0.2) * smoothstep(0.5, 0.9, length(r)) * 0.15;
  vec2 dp = uv - u_plume;
  col += pal(0.5 + u_plume.x) * u_accent * 0.55 * exp(-dot(dp, dp) * 5.0) * dens;
  col *= 0.75 + u_level * 0.45;
  gl_FragColor = vec4(col, 1.0);
}`);
      let px = 0, py = 0;
      return {
        draw(gl, a, dt, t, pal, w, h) {
          if (a.beat) { px = (Math.random() - 0.5) * 1.2; py = (Math.random() - 0.5) * 0.8; }
          pass.draw(w, h, a, t, pal, (gl, p) => gl.uniform2f(p.loc('u_plume'), px, py));
        },
        dispose() { pass.dispose(); },
      };
    },
  },

  bokeh: {
    name: 'ボケ',
    create() {
      const N = 48;
      const items = Array.from({ length: N }, () => ({
        x: Math.random(), y: Math.random(), z: Math.random(),
        vx: (Math.random() - 0.5) * 0.02, vy: -(0.004 + Math.random() * 0.012),
        ph: Math.random() * TAU, ci: (Math.random() * 4) | 0, flash: 0,
      })).sort((p, q) => p.z - q.z);
      const cache = {};
      return {
        draw(g, a, dt, t, pal, w, h) {
          const sprites = spriteSet(cache, pal, 256, [[0, 0.32, 0.1], [0.7, 0.42], [0.88, 0.55], [0.96, 0.22], [1, 0]]);
          const m = Math.min(w, h);
          const bg = g.createRadialGradient(w / 2, h * 0.6, 0, w / 2, h * 0.6, Math.max(w, h) * 0.8);
          bg.addColorStop(0, darkTint(pal, 0.6, 0.1));
          bg.addColorStop(1, darkTint(pal, 0.6, 0.02));
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = bg;
          g.fillRect(0, 0, w, h);

          if (a.beat) for (let k = 0; k < 3; k++) items[(Math.random() * N) | 0].flash = 1;
          const sp = 0.5 + a.slowLevel * 0.8;
          g.globalCompositeOperation = 'lighter';
          for (const b of items) {
            b.x += b.vx * dt * sp * (0.4 + b.z);
            b.y += b.vy * dt * sp * (0.4 + b.z);
            if (b.y < -0.2) { b.y = 1.2; b.x = Math.random(); }
            if (b.x < -0.2) b.x = 1.2; else if (b.x > 1.2) b.x = -0.2;
            b.flash *= Math.exp(-dt * 1.2);
            const size = m * (0.04 + b.z * b.z * 0.22) * (1 + a.slowBass * 0.08);
            const tw = 0.75 + 0.25 * Math.sin(t * (0.3 + b.z * 0.4) + b.ph);
            g.globalAlpha = Math.min(1, (0.7 - 0.35 * b.z) * tw * (0.7 + a.slowLevel * 0.6) + b.flash * 0.5);
            g.drawImage(sprites[b.ci], b.x * w - size / 2, b.y * h - size / 2, size, size);
          }
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },

  liquid: {
    name: 'リキッド',
    gl: true,
    resScale: 0.75,
    create(gl) {
      const pass = new GLPass(gl, `
uniform vec3 u_balls[8];
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float f = 0.0; vec2 g = vec2(0.0); vec3 c = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec3 b = u_balls[i];
    vec2 d = p - b.xy;
    float d2 = dot(d, d) + 1e-4;
    float w = b.z * b.z / d2;
    f += w;
    g += -2.0 * w / d2 * d;
    c += pal(float(i) / 8.0) * w;
  }
  c /= max(f, 1e-4);
  float inside = smoothstep(0.92, 1.12, f);
  vec3 n = normalize(vec3(-g * 0.06, 1.0));
  vec3 L = normalize(vec3(-0.4, 0.6, 0.7));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 36.0);
  float rim = pow(1.0 - n.z, 1.5);
  vec3 bg = mix(vec3(0.01, 0.008, 0.02), pal(0.6) * 0.06, 1.0 - gl_FragCoord.y / u_res.y);
  vec3 body = c * (0.25 + 0.75 * diff) + vec3(spec * 0.55) + c * rim * (0.5 + u_accent * 0.6);
  vec3 col = mix(bg, body, inside);
  col += c * smoothstep(0.35, 0.95, f) * (1.0 - inside) * (0.22 + u_level * 0.2);
  gl_FragColor = vec4(col, 1.0);
}`);
      const balls = Array.from({ length: 8 }, () => ({
        fx: 0.04 + Math.random() * 0.06, fy: 0.05 + Math.random() * 0.07,
        px: Math.random() * TAU, py: Math.random() * TAU, r: 0.075 + Math.random() * 0.06,
      }));
      const buf = new Float32Array(24);
      return {
        draw(gl, a, dt, t, pal, w, h) {
          const asp = w / h;
          const grow = 1 + a.slowBass * 0.25 + a.accent * 0.05;
          balls.forEach((b, i) => {
            buf[i * 3] = Math.sin(t * b.fx + b.px) * asp * 0.32;
            buf[i * 3 + 1] = Math.sin(t * b.fy + b.py) * 0.36;
            buf[i * 3 + 2] = b.r * grow;
          });
          pass.draw(w, h, a, t, pal, (gl, p) => gl.uniform3fv(p.loc('u_balls[0]'), buf));
        },
        dispose() { pass.dispose(); },
      };
    },
  },

  nebula: {
    name: '星雲',
    gl: true,
    resScale: 0.5,
    create(gl) {
      const pass = new GLPass(gl, `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time;
  float an = t * 0.008;
  mat2 R = mat2(cos(an), -sin(an), sin(an), cos(an));
  vec2 p = R * uv * (1.1 + 0.15 * sin(t * 0.017)) + vec2(t * 0.012, t * 0.007);
  float w = fbm(p * 1.8 + t * 0.02);
  float n1 = fbm(p * 1.4 + w * 1.6);
  float n2 = fbm(p * 2.6 - w + 7.3 - t * 0.01);
  float lanes = smoothstep(0.25, 0.65, fbm(p * 3.5 + 13.1));
  vec3 col = vec3(0.004, 0.004, 0.01);
  col += pal(n1 * 0.9) * pow(n1, 2.6) * 1.9;
  col += pal(n2 * 0.7 + 0.45) * pow(n2, 3.2) * 1.2;
  col *= 0.45 + 0.55 * lanes;
  float core = exp(-length(uv - vec2(0.12 * sin(t * 0.01), 0.08 * cos(t * 0.013))) * 2.2);
  col += pal(0.15) * core * (0.12 + u_level * 0.25 + u_accent * 0.45);
  for (int L = 0; L < 2; L++) {
    float fl = float(L);
    vec2 sp = (uv * (1.0 + fl * 0.6) + vec2(t * 0.004 * (1.0 + fl), 0.0)) * (70.0 + fl * 60.0);
    vec2 c = floor(sp);
    float h = hash(c + fl * 17.0);
    if (h > 0.975) {
      vec2 o = vec2(hash(c + 1.3), hash(c + 5.1)) * 0.8 + 0.1;
      float d = length(fract(sp) - o);
      float tw = 0.6 + 0.4 * sin(t * (0.7 + h) + h * 40.0);
      col += vec3(0.9, 0.92, 1.0) * smoothstep(0.1, 0.0, d) * tw * (0.6 - fl * 0.25);
    }
  }
  col *= 0.85 + u_level * 0.35;
  gl_FragColor = vec4(col, 1.0);
}`);
      return {
        draw(gl, a, dt, t, pal, w, h) { pass.draw(w, h, a, t, pal); },
        dispose() { pass.dispose(); },
      };
    },
  },

  rays: {
    name: '光芒',
    gl: true,
    resScale: 0.5,
    create(gl) {
      const pass = new GLPass(gl, `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  float t = u_time;
  vec2 src = vec2(0.5 * asp + 0.18 * sin(t * 0.031), 1.35);
  vec2 d = vec2(uv.x * asp, uv.y) - src;
  float ang = atan(d.x, -d.y);
  float dist = length(d);
  float r = noise(vec2(ang * 7.0, t * 0.06)) * 0.55 + noise(vec2(ang * 19.0 + 3.0, t * 0.1)) * 0.3
          + noise(vec2(ang * 43.0 + 7.0, t * 0.16)) * 0.15;
  r = pow(r, 2.4) * 2.2;
  float beam = r * smoothstep(1.9, 0.3, dist) * (0.45 + u_level * 0.75 + u_accent * 0.35);
  vec3 col = mix(pal(0.6) * 0.025 + vec3(0.004, 0.005, 0.01), pal(0.05) * 0.1, uv.y * uv.y);
  col += pal(0.1 + ang * 0.15) * beam * 0.9;
  float cl = fbm(vec2(uv.x * asp * 1.6 + t * 0.012, uv.y * 3.5 - t * 0.004));
  col += pal(0.05) * pow(cl, 2.0) * smoothstep(0.55, 1.0, uv.y) * (0.5 + u_level * 0.4);
  vec2 g = vec2(uv.x * asp, uv.y) * 28.0 + vec2(t * 0.05, t * 0.12);
  vec2 c = floor(g);
  float h = hash(c);
  if (h > 0.9) {
    vec2 o = vec2(0.5 + 0.35 * sin(t * 0.3 + h * 20.0), 0.5 + 0.35 * cos(t * 0.27 + h * 30.0));
    col += vec3(1.0, 0.95, 0.85) * smoothstep(0.09, 0.0, length(fract(g) - o)) * beam * 1.4;
  }
  gl_FragColor = vec4(col, 1.0);
}`);
      return {
        draw(gl, a, dt, t, pal, w, h) { pass.draw(w, h, a, t, pal); },
        dispose() { pass.dispose(); },
      };
    },
  },

  ripple: {
    name: '波紋',
    gl: true,
    resScale: 0.6,
    create(gl) {
      const DROPS = 12;
      const pass = new GLPass(gl, `
uniform vec3 u_drops[12];
float height(vec2 p) {
  float h = 0.012 * sin(p.x * 3.0 + u_time * 0.35) * sin(p.y * 2.3 - u_time * 0.27)
          + 0.008 * (noise(p * 4.0 + u_time * 0.1) - 0.5);
  for (int i = 0; i < 12; i++) {
    vec3 d = u_drops[i];
    float age = u_time - d.z;
    if (age < 0.0 || age > 9.0) continue;
    float r = length(p - d.xy);
    float x = r - age * 0.22;
    h += sin(x * 55.0) * exp(-x * x * 90.0) * exp(-age * 0.45) / (1.0 + r * 3.0) * 0.05;
  }
  return h;
}
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float e = 1.5 / u_res.y;
  float dx = (height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0))) / (2.0 * e);
  float dy = (height(p + vec2(0.0, e)) - height(p - vec2(0.0, e))) / (2.0 * e);
  vec3 n = normalize(vec3(-dx * 0.35, -dy * 0.35, 1.0));
  vec3 col = pal(0.55) * 0.035 + vec3(0.004, 0.006, 0.012);
  vec2 q = p + n.xy * 0.25;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 lp = vec2((fi - 1.0) * 0.55 + 0.1 * sin(u_time * 0.05 + fi * 2.0), 0.28 + 0.05 * cos(u_time * 0.04 + fi));
    float d = length((q - lp) * vec2(1.0, 0.45));
    col += pal(fi * 0.3 + 0.1) * exp(-d * d * 18.0) * (0.35 + u_level * 0.5 + u_accent * 0.25);
  }
  vec3 L = normalize(vec3(-0.2, 0.6, 0.75));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 80.0);
  col += pal(0.15) * spec * 0.6;
  col += pal(0.3) * length(n.xy) * 0.25;
  gl_FragColor = vec4(col, 1.0);
}`);
      const buf = new Float32Array(DROPS * 3).fill(-1000);
      let next = 0, idle = 0;
      return {
        draw(gl, a, dt, t, pal, w, h) {
          idle += dt;
          // Drops only while sound is coming in; in silence the water just drifts.
          if (a.presence > 0.3 && (a.beat || (idle > 3.5 && a.presence > 0.6))) {
            idle = 0;
            buf[next * 3] = (Math.random() - 0.5) * (w / h) * 0.9;
            buf[next * 3 + 1] = (Math.random() - 0.5) * 0.8;
            buf[next * 3 + 2] = t;
            next = (next + 1) % DROPS;
          }
          pass.draw(w, h, a, t, pal, (gl, p) => gl.uniform3fv(p.loc('u_drops[0]'), buf));
        },
        dispose() { pass.dispose(); },
      };
    },
  },

  fireflies: {
    name: '蛍',
    create() {
      const N = 140;
      const f = Array.from({ length: N }, () => ({
        x: Math.random(), y: Math.random(), z: Math.random(), head: Math.random() * TAU,
        ph: Math.random() * TAU, rate: 0.4 + Math.random() * 0.9, ci: (Math.random() * 4) | 0, flash: 0,
      }));
      const cache = {};
      return {
        draw(g, a, dt, t, pal, w, h) {
          const sprites = spriteSet(cache, pal, 64, [[0, 1, 0.85], [0.1, 0.85, 0.3], [0.3, 0.25], [1, 0]]);
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = darkTint(pal, 0.4, 0.045, 0.3);
          g.fillRect(0, 0, w, h);
          const m = Math.min(w, h);
          const sp = 0.025 * (0.6 + a.slowLevel * 1.2);
          g.globalCompositeOperation = 'lighter';
          for (let i = 0; i < N; i++) {
            const p = f[i];
            p.head += (Math.random() - 0.5) * dt * 1.5;
            const ang = p.head + Math.sin(p.x * 6 + t * 0.21 + i) * 1.2 + Math.cos(p.y * 5 - t * 0.17) * 1.2;
            p.x += Math.cos(ang) * sp * dt * (0.5 + p.z);
            p.y += Math.sin(ang) * sp * dt * (0.5 + p.z) * 0.8;
            if (p.x < -0.05) p.x = 1.05; else if (p.x > 1.05) p.x = -0.05;
            if (p.y < -0.05) p.y = 1.05; else if (p.y > 1.05) p.y = -0.05;
            if (a.beat && Math.random() < 0.3) p.flash = 1;
            p.flash *= Math.exp(-dt * 2);
            const blink = Math.pow(Math.max(0, Math.sin(t * p.rate + p.ph)), 4);
            const br = 0.12 + 0.88 * Math.max(blink, p.flash);
            const size = m * (0.012 + p.z * 0.03) * (0.8 + 0.4 * br) * 3;
            g.globalAlpha = br * (0.4 + 0.6 * p.z);
            g.drawImage(sprites[p.ci], p.x * w - size / 2, p.y * h - size / 2, size, size);
          }
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },

  silk: {
    name: 'シルク',
    gl: true,
    resScale: 0.6,
    create(gl) {
      // Each ribbon is a twisting sheet of 110 threads. Instead of stroking every thread,
      // the shader inverts the sheet per pixel: thread density follows from how much the
      // sheet is foreshortened, which gives the bright folds for free.
      const pass = new GLPass(gl, `
uniform float u_T;
const float L = 110.0;
vec3 ribbon(vec2 q, float r, float hpx, float lw, float A) {
  float u = (q.x + 0.05) / 1.1;
  float T = u_T;
  float cy = 0.5 + mix(0.1, -0.12, r) + 0.16 * sin(u * 2.1 + T * 0.21 + r * 2.0) + 0.07 * sin(u * 4.7 - T * 0.33 + r);
  float th = u * 2.6 + T * 0.27 + r * 1.3 + 0.8 * sin(u * 1.9 + T * 0.17);
  float W = 0.2 * (0.65 + 0.35 * sin(u * 3.3 + T * 0.13 + r));
  float c = W * cos(th);
  float c2 = c >= 0.0 ? max(c, 1e-4) : min(c, -1e-4);
  float ac = abs(c2);
  float v = (q.y - cy) / c2;
  float y = q.y - sin(u * 38.0 - T * 3.0 + clamp(v, -1.0, 1.0) * 2.0) * 0.006 * u_treble * (1.0 - min(abs(v), 1.0));
  v = (y - cy) / c2;
  float inside = smoothstep(ac * hpx + 0.7, ac * hpx - 0.7, abs(y - cy) * hpx);
  float spacing = 2.0 * ac * hpx / (L - 1.0);
  float d = abs(fract((v + 1.0) * (L - 1.0) * 0.5 + 0.5) - 0.5) * spacing;
  float line = clamp(lw * 0.5 + 0.5 - d, 0.0, 1.0);
  float I = A * mix(lw / spacing, line, smoothstep(2.0, 5.0, spacing));
  I *= 0.75 + 0.6 * pow(0.5 + 0.5 * sin(v * 2.4 + u * 5.0 - T * 0.4 + r * 3.0), 3.0);
  return pal(r * 0.35 + (clamp(v, -1.0, 1.0) + 1.0) * 0.2 + u_time * 0.006) * min(I, 1.6) * inside;
}
void main() {
  vec2 q = vec2(gl_FragCoord.x / u_res.x, 1.0 - gl_FragCoord.y / u_res.y);
  float lw = max(1.0, min(u_res.x, u_res.y) * 0.002);
  float A = 0.075 + u_level * 0.03 + u_accent * 0.05;
  vec3 col = pal(0.6) * 0.05 + vec3(0.02, 0.02, 0.035);
  col += ribbon(q, 0.0, u_res.y, lw, A);
  col += ribbon(q, 1.0, u_res.y, lw, A * 0.6);
  gl_FragColor = vec4(col, 1.0);
}`);
      let clock = 0;
      return {
        draw(gl, a, dt, t, pal, w, h) {
          clock += dt * (0.5 + a.slowLevel * 0.8);
          pass.draw(w, h, a, t, pal, (gl, p) => gl.uniform1f(p.loc('u_T'), clock));
        },
        dispose() { pass.dispose(); },
      };
    },
  },

  aurora: {
    name: 'オーロラ',
    gl: true,
    resScale: 0.6,
    create(gl) {
      const pass = new GLPass(gl, `
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  float x = uv.x * asp;
  float t = u_time;
  vec3 col = mix(vec3(0.004, 0.008, 0.02), pal(0.6) * 0.05 + vec3(0.01, 0.015, 0.03), 1.0 - uv.y);
  vec2 sp = uv * vec2(asp, 1.0) * 90.0;
  vec2 cell = floor(sp);
  float h = hash(cell);
  if (h > 0.97) {
    vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7));
    float tw = 0.5 + 0.5 * sin(t * (0.5 + h * 2.0) + h * 50.0);
    col += vec3(0.8, 0.85, 1.0) * smoothstep(0.12, 0.0, length(fract(sp) - o)) * tw * 0.7;
  }
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float yc = 0.38 + fk * 0.08 + 0.07 * sin(x * 1.1 + t * 0.05 + fk * 2.1)
             + 0.05 * (fbm(vec2(x * 0.9 + t * 0.025, fk * 3.7)) - 0.5) * (1.0 + u_mid * 1.5);
    float dy = uv.y - yc;
    float H = 0.22 + 0.08 * u_level + fk * 0.03;
    float shape = dy > 0.0 ? exp(-dy / H) : exp(-dy * dy * 900.0) + 0.18 * exp(dy * 7.0);
    float rays = fbm(vec2(x * 14.0 + fk * 13.0 + t * 0.08, t * 0.04 + fk));
    rays = 0.35 + 1.1 * pow(rays, 1.6);
    float I = shape * rays * (0.35 + u_level * 0.55 + u_accent * 0.35) * (1.0 - fk * 0.2);
    col += pal(fk * 0.22 + clamp(dy, 0.0, 0.5) * 0.9) * I;
  }
  float glow = exp(-uv.y * 5.0);
  col += pal(0.08 + 0.1 * sin(x * 0.7 + t * 0.03)) * glow * (0.16 + u_level * 0.14 + u_accent * 0.08);
  col += pal(0.6) * glow * glow * 0.06;
  gl_FragColor = vec4(col, 1.0);
}`);
      return {
        draw(gl, a, dt, t, pal, w, h) { pass.draw(w, h, a, t, pal); },
        dispose() { pass.dispose(); },
      };
    },
  },

  spiral: {
    name: 'スパイラル',
    create() {
      const N = 320, GA = 2.39996323;
      const sm = new Float32Array(N);
      let rot = 0, waveR = 2, waveAmp = 0;
      return {
        draw(g, a, dt, t, pal, w, h) {
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = darkTint(pal, 0.6, 0.04, 0.28);
          g.fillRect(0, 0, w, h);
          rot += dt * (0.025 + a.slowMid * 0.12);
          if (a.beat) { waveR = 0; waveAmp = 1; }
          waveR += dt * 0.45;
          waveAmp *= Math.exp(-dt * 0.8);
          const cx = w / 2, cy = h / 2, m = Math.min(w, h);
          const bands = a.getBands(48);
          const k = 1 - Math.exp(-dt * 4);
          g.globalCompositeOperation = 'lighter';
          for (let i = 0; i < N; i++) {
            const f = i / N;
            sm[i] += (bands[(f * 47) | 0] - sm[i]) * k;
            const r = Math.sqrt(f) * m * 0.46 * (1 + a.slowBass * 0.08);
            const ang = i * GA + rot;
            const wv = waveAmp * Math.exp(-(((f - waveR) / 0.07) ** 2));
            const core = m * (0.0025 + sm[i] * 0.006 + wv * 0.006);
            const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
            const hue = f * 0.8 + t * 0.02;
            g.fillStyle = palColor(pal, hue, (0.07 + sm[i] * 0.1 + wv * 0.25) * (0.15 + 0.85 * f));
            g.beginPath();
            g.arc(x, y, core * (1.5 + 2.5 * Math.sqrt(f)), 0, TAU);
            g.fill();
            g.fillStyle = palColor(pal, hue, Math.min(1, (0.55 + sm[i] * 0.3 + wv * 0.4) * (0.4 + 0.6 * f)));
            g.beginPath();
            g.arc(x, y, core, 0, TAU);
            g.fill();
          }
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },
};

/** Patterns removed in the redesign, mapped to the closest new one. */
const LEGACY_PATTERNS = {
  bars: 'silk', radial: 'liquid', particles: 'fireflies', wave: 'silk',
  rings: 'ripple', starfield: 'nebula', synthwave: 'rays', line: 'smoke',
};
