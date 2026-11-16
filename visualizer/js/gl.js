'use strict';

/**
 * Minimal WebGL1 helper: one full-screen triangle and a fragment shader.
 * Every shader gets the shared uniforms below plus pal(t) (cyclic palette
 * lookup) and noise/fbm helpers.
 */
const GL_VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const GL_COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_level, u_bass, u_mid, u_treble, u_accent;
uniform float u_mlevel, u_mbass, u_mmid, u_mtreble, u_energy;
uniform vec3 u_pal[4];
uniform float u_palShift;

vec3 pal(float t) {
  t = fract(t + u_palShift) * 4.0;
  vec3 c = mix(u_pal[0], u_pal[1], clamp(t, 0.0, 1.0));
  c = mix(c, u_pal[2], clamp(t - 1.0, 0.0, 1.0));
  c = mix(c, u_pal[3], clamp(t - 2.0, 0.0, 1.0));
  return mix(c, u_pal[0], clamp(t - 3.0, 0.0, 1.0));
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
  return v;
}
`;

class GLPass {
  constructor(gl, fragBody) {
    this.gl = gl;
    const vs = this._compile(gl.VERTEX_SHADER, GL_VERT);
    const fs = this._compile(gl.FRAGMENT_SHADER, GL_COMMON + fragBody);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.aPos = gl.getAttribLocation(prog, 'a_pos');
    this.locs = new Map();
    this.palBuf = new Float32Array(12);
  }

  _compile(type, src) {
    const gl = this.gl;
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  loc(name) {
    if (!this.locs.has(name)) this.locs.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.locs.get(name);
  }

  /** setExtra(gl, pass) can upload pattern-specific uniforms. */
  draw(w, h, a, t, pal, setExtra) {
    const gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.loc('u_res'), w, h);
    gl.uniform1f(this.loc('u_time'), t);
    gl.uniform1f(this.loc('u_level'), a.slowLevel);
    gl.uniform1f(this.loc('u_bass'), a.slowBass);
    gl.uniform1f(this.loc('u_mid'), a.slowMid);
    gl.uniform1f(this.loc('u_treble'), a.slowTreble);
    gl.uniform1f(this.loc('u_accent'), a.accent);
    gl.uniform1f(this.loc('u_mlevel'), a.medLevel);
    gl.uniform1f(this.loc('u_mbass'), a.medBass);
    gl.uniform1f(this.loc('u_mmid'), a.medMid);
    gl.uniform1f(this.loc('u_mtreble'), a.medTreble);
    gl.uniform1f(this.loc('u_energy'), a.energy);
    for (let i = 0; i < 4; i++) {
      const c = pal.rgb[i % pal.rgb.length];
      this.palBuf[i * 3] = c[0] / 255;
      this.palBuf[i * 3 + 1] = c[1] / 255;
      this.palBuf[i * 3 + 2] = c[2] / 255;
    }
    gl.uniform3fv(this.loc('u_pal[0]'), this.palBuf);
    gl.uniform1f(this.loc('u_palShift'), (t * 0.004) % 1);
    if (setExtra) setExtra(gl, this);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.gl.deleteProgram(this.prog);
    this.gl.deleteBuffer(this.buf);
  }
}
