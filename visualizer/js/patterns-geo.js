'use strict';

/**
 * Geometric patterns. Base motion stays slow; reactions follow the med* envelopes
 * (quicker than slow*, still smooth) scaled by `energy`, so quiet input barely moves them.
 */

const GEO_GLSL = `
const float TAU = 6.2831853;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
/** Distance-like radius of a regular n-gon (flat edges at angles k*TAU/n). */
float poly(vec2 p, float n) {
  float s = TAU / n;
  float a = atan(p.y, p.x);
  return cos(floor(0.5 + a / s) * s - a) * length(p);
}
/** Bright core of width w plus a soft halo. */
float glowLine(float d, float w) { return smoothstep(w, 0.0, d) + 0.35 * exp(-d * 28.0); }
/** Hex tiling: xy = offset from the cell centre, zw = cell id (centre = id * vec2(1, sqrt3)). */
vec4 hexCell(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec4 hC = floor(vec4(p, p - vec2(0.5, 1.0)) / s.xyxy) + 0.5;
  vec4 h = vec4(p - hC.xy * s, p - (hC.zw + 0.5) * s);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + 0.5);
}
`;

/** Beat-triggered pulse that only fires when the music is actually loud enough. */
function geoPulse() {
  return {
    pos: 9, amp: 0,
    update(a, dt, speed, decay) {
      if (a.beat && a.energy > 0.15) { this.pos = 0; this.amp = Math.min(1, 0.4 + a.energy); }
      this.pos += dt * speed;
      this.amp *= Math.exp(-dt * decay);
    },
  };
}

/** Polyhedron edges: every vertex pair at the shortest distance. */
function polyEdges(verts) {
  let min = Infinity;
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    min = Math.min(min, Math.hypot(...verts[i].map((v, k) => v - verts[j][k])));
  }
  const edges = [];
  for (let i = 0; i < verts.length; i++) for (let j = i + 1; j < verts.length; j++) {
    if (Math.hypot(...verts[i].map((v, k) => v - verts[j][k])) < min * 1.01) edges.push([i, j]);
  }
  const r = Math.hypot(...verts[0]);
  return { verts: verts.map(v => v.map(x => x / r)), edges };
}

function icosahedron() {
  const p = (1 + Math.sqrt(5)) / 2, v = [];
  for (const a of [-1, 1]) for (const b of [-p, p]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
  return polyEdges(v);
}

function dodecahedron() {
  const p = (1 + Math.sqrt(5)) / 2, q = 1 / p, v = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    for (const c of [-1, 1]) v.push([a, b, c]);
    v.push([0, a * q, b * p], [a * q, b * p, 0], [a * p, 0, b * q]);
  }
  return polyEdges(v);
}

/** Stroke the same path as a wide faint halo and a narrow bright core. */
function glowStroke(g, path, color, glowW, coreW, glowA, coreA) {
  g.strokeStyle = color;
  g.globalAlpha = glowA; g.lineWidth = glowW; g.stroke(path);
  g.globalAlpha = coreA; g.lineWidth = coreW; g.stroke(path);
  g.globalAlpha = 1;
}

Object.assign(PATTERNS, {
  mandala: {
    name: 'マンダラ',
    gl: true,
    resScale: 0.6,
    create(gl) {
      const pass = new GLPass(gl, GEO_GLSL + `
uniform float u_T, u_pulse, u_pulseAmp;
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float r = length(p);
  float px = 1.0 / u_res.y;
  float drive = u_energy;
  float ring = exp(-pow((r - u_pulse) / 0.05, 2.0)) * u_pulseAmp;
  vec3 col = pal(0.6) * 0.03 + vec3(0.01, 0.01, 0.02);
  col += pal(0.5) * exp(-r * 3.0) * (0.06 + 0.12 * u_mlevel * drive);
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    float n = 3.0 + mod(fk * 2.0, 5.0);
    float dir = mod(fk, 2.0) * 2.0 - 1.0;
    float R = (0.07 + fk * 0.07) * (1.0 + (0.06 + 0.05 * fk / 5.0) * u_mbass * drive * 2.0);
    vec2 q = rot(u_T * (0.05 + 0.015 * fk) * dir) * p;
    float I = glowLine(abs(poly(q, n) - R), px * (1.6 + fk * 0.25)) * (0.45 + 0.4 * u_mlevel * drive + ring * 1.2);
    col += pal(fk * 0.13 + u_time * 0.01) * I * (1.0 - fk * 0.13);
    vec2 q2 = rot(3.14159 / n) * q;
    col += pal(fk * 0.13 + 0.4) * glowLine(abs(poly(q2, n) - R * 0.82), px * 1.2) * (0.18 + 0.25 * u_mmid * drive + ring * 0.6);
  }
  float s = TAU / 12.0;
  float af = abs(mod(atan(p.y, p.x) + u_T * 0.03, s) - 0.5 * s);
  vec2 f = vec2(cos(af), sin(af)) * r;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float d = abs(length(f - vec2(0.14 + fk * 0.13, 0.0)) - (0.035 + fk * 0.012) * (1.0 + 0.4 * u_mtreble * drive));
    col += pal(0.25 + fk * 0.2) * glowLine(d, px * 1.2) * (0.22 + 0.3 * u_mlevel * drive + ring * 0.5);
  }
  col *= 1.0 - smoothstep(0.5, 0.95, r) * 0.6;
  gl_FragColor = vec4(col, 1.0);
}`);
      const pulse = geoPulse();
      let T = 0;
      return {
        draw(gl, a, dt, t, pal, w, h) {
          T += dt * (0.6 + 0.8 * a.medLevel * a.energy);
          pulse.update(a, dt, 0.35, 1.2);
          pass.draw(w, h, a, t, pal, (gl, p) => {
            gl.uniform1f(p.loc('u_T'), T);
            gl.uniform1f(p.loc('u_pulse'), pulse.pos);
            gl.uniform1f(p.loc('u_pulseAmp'), pulse.amp);
          });
        },
        dispose() { pass.dispose(); },
      };
    },
  },

  tunnel: {
    name: 'トンネル',
    gl: true,
    resScale: 0.6,
    create(gl) {
      const pass = new GLPass(gl, GEO_GLSL + `
uniform float u_T, u_Z, u_pulse, u_pulseAmp;
void main() {
  vec2 p = rot(u_T * 0.02) * ((gl_FragCoord.xy - 0.5 * u_res) / u_res.y);
  float px = 1.0 / u_res.y;
  float s = TAU / 6.0;
  float a = atan(p.y, p.x);
  float rh = max(poly(p, 6.0), 1e-3);
  float z = 0.25 / rh;
  float zz = z + u_Z;
  float ringD = abs(fract(zz * 2.5 + 0.5) - 0.5) / 2.5 * rh * rh / 0.25;
  float ringI = smoothstep(px * 1.5, 0.0, ringD) + 0.4 * exp(-ringD * 60.0);
  float dl = abs(mod(a, s) - 0.5 * s) * length(p);
  float lineI = smoothstep(px * 1.2, 0.0, dl) + 0.3 * exp(-dl * 80.0);
  float fog = smoothstep(0.02, 0.3, rh);
  float pulse = exp(-pow((z - u_pulse) * 2.0, 2.0)) * u_pulseAmp;
  float drive = u_energy;
  vec3 c = pal(zz * 0.08 + u_time * 0.01);
  vec3 col = pal(0.6) * 0.025 + vec3(0.008, 0.008, 0.016);
  col += pal(0.5) * exp(-rh * 12.0) * 0.2 * (0.5 + u_mlevel * drive);
  col += c * ringI * fog * (0.5 + 0.45 * u_mlevel * drive + pulse * 1.5);
  col += pal(zz * 0.08 + 0.3) * lineI * fog * 0.25 * (0.6 + 0.6 * u_mmid * drive);
  col += c * 0.03 * fog * (0.5 + 0.5 * sin(a * 3.0 + zz));
  gl_FragColor = vec4(col, 1.0);
}`);
      const pulse = geoPulse();
      let T = 0, Z = 0;
      return {
        draw(gl, a, dt, t, pal, w, h) {
          T += dt;
          Z += dt * (0.25 + 0.9 * a.medLevel * a.energy);
          pulse.update(a, dt, 1, 0.9);
          pass.draw(w, h, a, t, pal, (gl, p) => {
            gl.uniform1f(p.loc('u_T'), T);
            gl.uniform1f(p.loc('u_Z'), Z);
            gl.uniform1f(p.loc('u_pulse'), 3 - pulse.pos * 1.5);
            gl.uniform1f(p.loc('u_pulseAmp'), pulse.amp);
          });
        },
        dispose() { pass.dispose(); },
      };
    },
  },

  polyhedron: {
    name: 'ポリヘドロン',
    create() {
      const solids = [icosahedron(), dodecahedron()];
      const pulse = geoPulse();
      const cache = {};
      let rx = 0, ry = 0, rz = 0;
      const proj = [];
      const drawSolid = (g, solid, S, ax, ay, az, cx, cy, m, pal, hue, k, sprites) => {
        const [ca, sa, cb, sb, cc, sc] = [Math.cos(ax), Math.sin(ax), Math.cos(ay), Math.sin(ay), Math.cos(az), Math.sin(az)];
        solid.verts.forEach(([x, y, z], i) => {
          let y1 = y * ca - z * sa, z1 = y * sa + z * ca;
          let x2 = x * cb + z1 * sb, z2 = -x * sb + z1 * cb;
          let x3 = x2 * cc - y1 * sc, y3 = x2 * sc + y1 * cc;
          const f = 3 / (3 + z2);
          proj[i] = [cx + x3 * S * f, cy + y3 * S * f, z2];
        });
        for (const [i, j] of solid.edges) {
          const p = proj[i], q = proj[j];
          const front = 0.5 - (p[2] + q[2]) * 0.25;
          const path = new Path2D();
          path.moveTo(p[0], p[1]);
          path.lineTo(q[0], q[1]);
          glowStroke(g, path, palColor(pal, hue + front * 0.25), m * 0.014, m * 0.0035,
            0.1 * k * (0.3 + front), Math.min(1, 0.75 * k * (0.25 + front)));
        }
        const size = m * 0.05;
        for (let i = 0; i < solid.verts.length; i++) {
          const p = proj[i];
          g.globalAlpha = Math.min(1, k * (0.35 + 0.5 * (0.5 - p[2] * 0.5)));
          g.drawImage(sprites[i % sprites.length], p[0] - size / 2, p[1] - size / 2, size, size);
        }
        g.globalAlpha = 1;
      };
      return {
        draw(g, a, dt, t, pal, w, h) {
          const sprites = spriteSet(cache, pal, 64, [[0, 1, 0.8], [0.15, 0.7, 0.2], [0.4, 0.15], [1, 0]]);
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = darkTint(pal, 0.6, 0.04, 0.35);
          g.fillRect(0, 0, w, h);
          const drive = a.energy;
          const sp = 0.6 + 0.8 * a.medLevel * drive;
          rx += dt * 0.07 * sp; ry += dt * 0.11 * sp; rz += dt * 0.03 * sp;
          pulse.update(a, dt, 1, 1.5);
          const m = Math.min(w, h);
          const S = m * 0.3 * (1 + 0.12 * a.medBass * drive + 0.05 * pulse.amp);
          const k = 0.7 + 0.3 * a.medLevel * drive + 0.4 * pulse.amp;
          g.globalCompositeOperation = 'lighter';
          g.lineCap = 'round';
          drawSolid(g, solids[0], S, rx, ry, rz, w / 2, h / 2, m, pal, 0.05 + t * 0.01, k, sprites);
          drawSolid(g, solids[1], S * 0.55, -ry * 1.3, -rx, rz * 2, w / 2, h / 2, m, pal, 0.5 + t * 0.01, k * 0.8, sprites);
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },

  terrain: {
    name: 'グリッド',
    resScale: 0.75,
    create() {
      const COLS = 41, ROWS = 34, HALF = 20;
      const hist = Array.from({ length: ROWS }, () => new Float32Array(COLS));
      const sm = new Float32Array(HALF);
      let scroll = 0, T = 0;
      const fillRow = row => {
        for (let j = 0; j < COLS; j++) {
          const c = Math.abs(j - HALF) / HALF;
          row[j] = sm[Math.min(HALF - 1, Math.floor(c * HALF))] * (1 - c * 0.3);
        }
        for (let j = 1; j < COLS - 1; j++) row[j] = (row[j - 1] + row[j] * 2 + row[j + 1]) / 4;
      };
      return {
        draw(g, a, dt, t, pal, w, h) {
          const m = Math.min(w, h);
          const hy = h * 0.4;
          g.globalCompositeOperation = 'source-over';
          const bg = g.createLinearGradient(0, 0, 0, h);
          bg.addColorStop(0, darkTint(pal, 0.6, 0.03));
          bg.addColorStop(0.4, darkTint(pal, 0.5, 0.16));
          bg.addColorStop(1, darkTint(pal, 0.6, 0.03));
          g.fillStyle = bg;
          g.fillRect(0, 0, w, h);

          const bands = a.getBands(HALF);
          const k = 1 - Math.exp(-dt * 6);
          for (let i = 0; i < HALF; i++) sm[i] += (bands[i] * a.energy - sm[i]) * k;
          T += dt;
          scroll += dt * (0.8 + 1.2 * a.medLevel * a.energy);
          while (scroll >= 1) {
            scroll -= 1;
            const row = hist.pop();
            hist.unshift(row);
            fillRow(row);
          }
          fillRow(hist[0]);

          const f = h * 0.9, camH = 0.9, dz = 0.32, Z0 = 1;
          const pts = hist.map((row, r) => {
            const Z = Z0 + (r + scroll) * dz;
            return Array.from(row, (v, j) => {
              const X = (j / (COLS - 1) - 0.5) * 9;
              const ht = v * 1.4 + 0.1 * Math.sin(X * 0.9 + T * 0.3 + r * 0.35) + 0.08 * Math.sin(X * 0.4 - T * 0.2);
              return [w / 2 + X / Z * f, hy + (camH - ht) / Z * f, ht];
            });
          });
          g.globalCompositeOperation = 'lighter';
          g.lineJoin = 'round';
          const gw = m * 0.006, cw = Math.max(1, m * 0.0018);
          for (let r = ROWS - 1; r >= 0; r--) {
            const fog = Math.pow(1 - (r + scroll) / ROWS, 1.6);
            const path = new Path2D();
            let peak = 0;
            pts[r].forEach(([x, y, ht], j) => { if (j) path.lineTo(x, y); else path.moveTo(x, y); peak = Math.max(peak, ht); });
            glowStroke(g, path, palColor(pal, 0.1 + peak * 0.35 + r * 0.008 + t * 0.01), gw, cw, 0.08 * fog, 0.55 * fog);
          }
          for (let j = 0; j < COLS; j += 2) {
            const path = new Path2D();
            for (let r = 0; r < ROWS - 8; r++) {
              const [x, y] = pts[r][j];
              if (r) path.lineTo(x, y); else path.moveTo(x, y);
            }
            glowStroke(g, path, palColor(pal, 0.45 + t * 0.01), gw, cw, 0.04, 0.22);
          }
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },

  circle: {
    name: 'サークル',
    create() {
      const B = 48, N = B * 2;
      const sm = new Float32Array(B);
      const pulse = geoPulse();
      let rot = 0;
      const ringPath = (cx, cy, R, scale, spin) => {
        const pts = [];
        for (let i = 0; i < N; i++) {
          const bi = i < B ? i : N - 1 - i;
          const v = (sm[bi] * 2 + sm[Math.max(0, bi - 1)] + sm[Math.min(B - 1, bi + 1)]) / 4;
          const th = rot * spin + (i / N) * TAU - Math.PI / 2;
          const r = R * scale * (1 + 0.55 * v);
          pts.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r]);
        }
        const path = new Path2D();
        for (let i = 0; i <= N; i++) {
          const p = pts[i % N], q = pts[(i + 1) % N];
          const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
          if (i === 0) path.moveTo(mx, my); else path.quadraticCurveTo(p[0], p[1], mx, my);
        }
        path.closePath();
        return path;
      };
      return {
        draw(g, a, dt, t, pal, w, h) {
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = darkTint(pal, 0.6, 0.04, 0.22);
          g.fillRect(0, 0, w, h);
          const bands = a.getBands(B);
          const k = 1 - Math.exp(-dt * 7);
          for (let i = 0; i < B; i++) sm[i] += (bands[i] * a.energy - sm[i]) * k;
          rot += dt * (0.03 + 0.05 * a.medLevel * a.energy);
          pulse.update(a, dt, 0.6, 1.4);
          const m = Math.min(w, h), cx = w / 2, cy = h / 2;
          const R = m * 0.22 * (1 + 0.08 * a.medBass * a.energy + 0.04 * pulse.amp);
          const grad = g.createConicGradient(rot, cx, cy);
          for (let i = 0; i <= 8; i++) grad.addColorStop(i / 8, palColor(pal, i / 8 + t * 0.01));

          g.globalCompositeOperation = 'lighter';
          const main = ringPath(cx, cy, R, 1, 1);
          const fill = g.createRadialGradient(cx, cy, 0, cx, cy, R * 1.4);
          fill.addColorStop(0, palColor(pal, 0.5 + t * 0.01, 0.06 + 0.08 * a.medLevel * a.energy));
          fill.addColorStop(1, palColor(pal, 0.5 + t * 0.01, 0));
          g.fillStyle = fill;
          g.fill(main);
          glowStroke(g, ringPath(cx, cy, R, 1.26, -0.6), grad, m * 0.01, m * 0.002, 0.05, 0.2);
          glowStroke(g, ringPath(cx, cy, R, 1.12, -0.3), grad, m * 0.012, m * 0.0025, 0.08, 0.35);
          glowStroke(g, main, grad, m * 0.016, m * 0.004, 0.14, 0.85);
          g.strokeStyle = grad;
          g.globalAlpha = 0.25;
          g.lineWidth = Math.max(1, m * 0.0015);
          g.beginPath(); g.arc(cx, cy, R * 0.9, 0, TAU); g.stroke();
          if (pulse.amp > 0.01) {
            g.globalAlpha = pulse.amp * 0.4;
            g.lineWidth = m * 0.004;
            g.beginPath(); g.arc(cx, cy, R * (1 + pulse.pos * 1.2), 0, TAU); g.stroke();
          }
          g.globalAlpha = 1;
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },

  dots: {
    name: 'ドット',
    gl: true,
    resScale: 0.6,
    create(gl) {
      const pass = new GLPass(gl, GEO_GLSL + `
uniform float u_T, u_pulse, u_pulseAmp;
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float drive = u_energy;
  vec2 pp = rot(0.15 * sin(u_T * 0.05) * (1.0 - length(p))) * p;
  float scale = 26.0;
  vec4 hc = hexCell(pp * scale);
  vec2 cpos = hc.zw * vec2(1.0, 1.7320508) / scale;
  float cr = length(cpos);
  float ang = atan(cpos.y, cpos.x);
  float wave = 0.5 + 0.5 * sin(cr * 14.0 - u_T * 1.2 + sin(ang * 3.0 + u_T * 0.2) * 1.2);
  float ring = exp(-pow((cr - u_pulse) / 0.06, 2.0)) * u_pulseAmp;
  float react = u_mlevel * drive;
  float size = min(0.48, 0.12 + 0.18 * wave * (0.4 + 0.9 * react) + 0.25 * ring + 0.1 * u_mbass * drive * exp(-cr * 3.0));
  float d = length(hc.xy);
  float aa = scale * 1.5 / u_res.y;
  float dotM = smoothstep(size + aa, size - aa, d);
  float halo = exp(-max(d - size, 0.0) * 10.0) * 0.15;
  float bright = 0.35 + 0.65 * wave * (0.3 + 0.7 * react) + ring;
  vec3 col = pal(0.6) * 0.025 + vec3(0.008, 0.008, 0.016);
  col += pal(cr * 0.8 + ang * 0.08 + u_time * 0.01) * (dotM * 0.85 + halo) * bright * (1.0 - smoothstep(0.4, 1.0, cr) * 0.7);
  gl_FragColor = vec4(col, 1.0);
}`);
      const pulse = geoPulse();
      let T = 0;
      return {
        draw(gl, a, dt, t, pal, w, h) {
          T += dt * (0.5 + 0.7 * a.medLevel * a.energy);
          pulse.update(a, dt, 0.45, 1.1);
          pass.draw(w, h, a, t, pal, (gl, p) => {
            gl.uniform1f(p.loc('u_T'), T);
            gl.uniform1f(p.loc('u_pulse'), pulse.pos);
            gl.uniform1f(p.loc('u_pulseAmp'), pulse.amp);
          });
        },
        dispose() { pass.dispose(); },
      };
    },
  },

  lissajous: {
    name: 'リサージュ',
    create() {
      const N = 900, SEG = 6;
      let T = 0;
      const curve = (cx, cy, R, A, B, delta, wob, from, to) => {
        const path = new Path2D();
        for (let i = from; i <= to; i++) {
          const u = (i / N) * TAU;
          const rr = R * (1 + Math.sin(u * 40 + T * 4) * wob);
          const x = cx + Math.sin(A * u + delta) * rr * 1.25, y = cy + Math.sin(B * u) * rr;
          if (i === from) path.moveTo(x, y); else path.lineTo(x, y);
        }
        return path;
      };
      return {
        draw(g, a, dt, t, pal, w, h) {
          g.globalCompositeOperation = 'source-over';
          g.fillStyle = darkTint(pal, 0.6, 0.04, 0.12);
          g.fillRect(0, 0, w, h);
          const drive = a.energy;
          T += dt * (0.25 + 0.4 * a.medLevel * drive);
          const m = Math.min(w, h), cx = w / 2, cy = h / 2;
          const R = m * 0.34 * (0.85 + 0.2 * a.medBass * drive);
          const wob = 0.012 * a.medTreble * drive;
          const k = 0.6 + 0.4 * a.medLevel * drive + 0.3 * a.accent;
          g.globalCompositeOperation = 'lighter';
          g.lineCap = g.lineJoin = 'round';
          for (let s = 0; s < SEG; s++) {
            const from = Math.floor(s * N / SEG), to = Math.floor((s + 1) * N / SEG);
            const color = palColor(pal, s / SEG + t * 0.01);
            const main = curve(cx, cy, R, 3, 2, T * 0.35, wob, from, to);
            g.strokeStyle = color;
            g.globalAlpha = 0.05 * k; g.lineWidth = m * 0.022; g.stroke(main);
            glowStroke(g, main, color, m * 0.008, Math.max(1, m * 0.0025), 0.22 * k, 0.75 * k);
            glowStroke(g, curve(cx, cy, R * 0.62, 5, 4, -T * 0.27, wob, from, to), palColor(pal, s / SEG + 0.5 + t * 0.01),
              m * 0.006, Math.max(1, m * 0.0018), 0.12 * k, 0.4 * k);
          }
          g.globalCompositeOperation = 'source-over';
        },
      };
    },
  },

  honeycomb: {
    name: 'ハニカム',
    gl: true,
    resScale: 0.6,
    create(gl) {
      const WAVES = 4;
      const pass = new GLPass(gl, GEO_GLSL + `
uniform float u_T;
uniform vec3 u_waves[4];
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float scale = 9.0;
  vec4 hc = hexCell(p * scale);
  vec2 cpos = hc.zw * vec2(1.0, 1.7320508) / scale;
  float hd = max(abs(hc.x), dot(abs(hc.xy), vec2(0.5, 0.8660254)));
  float drive = u_energy;
  float field = smoothstep(0.35, 0.9, noise(cpos * 2.5 + vec2(u_T * 0.08, -u_T * 0.05)));
  float lit = field * (0.25 + 0.5 * u_mlevel * drive);
  for (int i = 0; i < 4; i++) {
    vec3 wv = u_waves[i];
    float age = u_time - wv.z;
    if (age < 0.0 || age > 6.0) continue;
    float dd = length(cpos - wv.xy);
    lit += exp(-pow((dd - age * 0.35) / 0.07, 2.0)) * exp(-age * 0.6) * 0.9;
  }
  float id = hash(hc.zw + 0.37);
  lit += 0.08 * step(0.92, id) * (0.5 + 0.5 * sin(u_time * 0.6 + id * 30.0));
  float gap = 0.06;
  float aa = scale * 1.5 / u_res.y;
  float inner = 0.5 - gap;
  float fillM = smoothstep(inner + aa, inner - aa, hd);
  float edge = exp(-abs(hd - inner) * 40.0);
  vec3 c = pal(length(cpos) * 0.5 + id * 0.15 + u_time * 0.01);
  vec3 col = pal(0.6) * 0.025 + vec3(0.008, 0.008, 0.016);
  col += c * fillM * (0.04 + lit * 0.75 + lit * 0.25 * (1.0 - hd * 1.6));
  col += c * edge * (0.06 + lit * 0.5);
  col *= 1.0 - 0.5 * smoothstep(0.5, 1.1, length(p));
  gl_FragColor = vec4(col, 1.0);
}`);
      const buf = new Float32Array(WAVES * 3).fill(-1000);
      let next = 0, T = 0;
      return {
        draw(gl, a, dt, t, pal, w, h) {
          T += dt * (0.6 + 0.6 * a.medLevel * a.energy);
          if (a.beat && a.energy > 0.15) {
            buf[next * 3] = (Math.random() - 0.5) * (w / h) * 0.8;
            buf[next * 3 + 1] = (Math.random() - 0.5) * 0.7;
            buf[next * 3 + 2] = t;
            next = (next + 1) % WAVES;
          }
          pass.draw(w, h, a, t, pal, (gl, p) => {
            gl.uniform1f(p.loc('u_T'), T);
            gl.uniform3fv(p.loc('u_waves[0]'), buf);
          });
        },
        dispose() { pass.dispose(); },
      };
    },
  },
});
