/*
 * Ink on paper: a small stable-fluids solver (semi-Lagrangian advection,
 * vorticity confinement, Jacobi pressure) whose dye is stored as absorbance
 * rather than colour. The paper is lit, the ink subtracts from it — so two
 * inks crossing darken the way real ones do instead of glowing.
 *
 * No dependencies. WebGL2 first, WebGL1 with half-float textures second,
 * otherwise the page keeps its static fallback.
 */

const PAPER = [0.969, 0.961, 0.941];

// The four item types, as they would look soaked into this paper at full
// strength. Converted to absorbance once: a = -ln(target / paper).
const INK_RGB = {
  skill: [0.36, 0.27, 0.84],
  agent: [0.06, 0.56, 0.49],
  command: [0.86, 0.6, 0.16],
  rule: [0.86, 0.27, 0.42],
};
export const INKS = Object.fromEntries(
  Object.entries(INK_RGB).map(([k, rgb]) => [k, rgb.map((c, i) => -Math.log(c / PAPER[i]))]),
);
export const INK_ORDER = ["skill", "agent", "command", "rule"];

const VERT = `
attribute vec2 aPosition;
varying vec2 vUv, vL, vR, vT, vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const P = "precision highp float; precision highp sampler2D;\n";

const FRAG = {
  splat: `${P}
varying vec2 vUv;
uniform sampler2D uTarget;
uniform float aspectRatio, radius;
uniform vec3 color;
uniform vec2 point;
void main () {
  vec2 p = vUv - point;
  p.x *= aspectRatio;
  vec3 s = exp(-dot(p, p) / radius) * color;
  gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + s, 1.0);
}`,
  advection: `${P}
varying vec2 vUv;
uniform sampler2D uVelocity, uSource;
uniform vec2 texelSize, dyeTexelSize, shift;
uniform float dt, dissipation;
vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);
  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}
void main () {
#ifdef MANUAL_FILTERING
  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize - shift;
  vec4 result = bilerp(uSource, coord, dyeTexelSize);
#else
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize - shift;
  vec4 result = texture2D(uSource, coord);
#endif
  // Whatever scrolls in from off the sheet is clean paper.
  float inside = step(0.0, coord.y) * step(coord.y, 1.0);
  gl_FragColor = inside * result / (1.0 + dissipation * dt);
}`,
  divergence: `${P}
varying vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;
  vec2 C = texture2D(uVelocity, vUv).xy;
  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }
  gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}`,
  curl: `${P}
varying vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uVelocity;
void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;
  gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}`,
  vorticity: `${P}
varying vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uVelocity, uCurl;
uniform float curl, dt;
void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;
  vec2 v = texture2D(uVelocity, vUv).xy + force * dt;
  gl_FragColor = vec4(clamp(v, -1000.0, 1000.0), 0.0, 1.0);
}`,
  pressure: `${P}
varying vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uPressure, uDivergence;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float d = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - d) * 0.25, 0.0, 0.0, 1.0);
}`,
  gradient: `${P}
varying vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uPressure, uVelocity;
void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  vec2 v = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
  gl_FragColor = vec4(v, 0.0, 1.0);
}`,
  clear: `${P}
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float value;
void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`,
  // Paper, then ink subtracted from it. Two touches of realism: a fibre grain
  // that the ink settles into, and darker edges where the density changes
  // fast — the rim a drop of ink leaves as it dries.
  display: `${P}
varying vec2 vUv, vL, vR, vT, vB;
uniform sampler2D uDye;
uniform vec3 paper;
uniform vec2 resolution;
float hash (vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise (vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main () {
  vec3 a = texture2D(uDye, vUv).rgb;
  vec3 aL = texture2D(uDye, vL).rgb, aR = texture2D(uDye, vR).rgb;
  vec3 aT = texture2D(uDye, vT).rgb, aB = texture2D(uDye, vB).rgb;
  float edge = length(vec2(dot(aR - aL, vec3(0.333)), dot(aT - aB, vec3(0.333))));
  vec2 px = vUv * resolution;
  float fibre = noise(px * 0.35) * 0.6 + noise(px * 1.3) * 0.4;
  a = max(a, 0.0);
  a *= 0.82 + 0.36 * fibre;
  a += a * clamp(edge * 2.2, 0.0, 0.9);
  // Soft ceiling: however much ink pools, text over it stays legible.
  a = 1.15 * (1.0 - exp(-a / 1.15));
  vec3 c = paper * exp(-a);
  c -= (hash(px) - 0.5) * 0.018;
  gl_FragColor = vec4(c, 1.0);
}`,
};

export function createInk(canvas, opts = {}) {
  const params = {
    simRes: opts.simRes ?? 128,
    dyeRes: opts.dyeRes ?? 640,
    velocityDissipation: 0.28,
    dyeDissipation: opts.dyeDissipation ?? 0.42,
    pressureIters: 18,
    curl: 22,
    radius: opts.radius ?? 0.0022,
    dpr: Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2),
  };

  const attrs = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false, powerPreference: "low-power" };
  let gl = canvas.getContext("webgl2", attrs);
  const isGL2 = !!gl;
  if (!gl) gl = canvas.getContext("webgl", attrs) || canvas.getContext("experimental-webgl", attrs);
  if (!gl) return null;

  let halfFloat;
  let linear;
  if (isGL2) {
    if (!gl.getExtension("EXT_color_buffer_float")) return null;
    linear = gl.getExtension("OES_texture_float_linear") || true; // half-float linear is core in WebGL2
    halfFloat = gl.HALF_FLOAT;
  } else {
    const hf = gl.getExtension("OES_texture_half_float");
    if (!hf) return null;
    halfFloat = hf.HALF_FLOAT_OES;
    linear = gl.getExtension("OES_texture_half_float_linear");
  }

  function supports(internal, format) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, halfFloat, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    return ok;
  }
  function pick(internal, format) {
    if (!isGL2) return supports(gl.RGBA, gl.RGBA) ? { internal: gl.RGBA, format: gl.RGBA } : null;
    if (supports(internal, format)) return { internal, format };
    if (internal === gl.R16F) return pick(gl.RG16F, gl.RG);
    if (internal === gl.RG16F) return pick(gl.RGBA16F, gl.RGBA);
    return null;
  }
  const fmtRGBA = pick(isGL2 ? gl.RGBA16F : gl.RGBA, gl.RGBA);
  const fmtRG = pick(isGL2 ? gl.RG16F : gl.RGBA, isGL2 ? gl.RG : gl.RGBA);
  const fmtR = pick(isGL2 ? gl.R16F : gl.RGBA, isGL2 ? gl.RED : gl.RGBA);
  if (!fmtRGBA || !fmtRG || !fmtR) return null;
  const filtering = linear ? gl.LINEAR : gl.NEAREST;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, VERT);
  function program(src, defines = "") {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, defines + src));
    gl.bindAttribLocation(p, 0, "aPosition");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  let prog;
  try {
    prog = {
      splat: program(FRAG.splat),
      advection: program(FRAG.advection, linear ? "" : "#define MANUAL_FILTERING\n"),
      divergence: program(FRAG.divergence),
      curl: program(FRAG.curl),
      vorticity: program(FRAG.vorticity),
      pressure: program(FRAG.pressure),
      gradient: program(FRAG.gradient),
      clear: program(FRAG.clear),
      display: program(FRAG.display),
    };
  } catch {
    return null;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  function blit(target) {
    if (target) {
      gl.viewport(0, 0, target.w, target.h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    } else {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  function fbo(w, h, fmt, filter) {
    gl.activeTexture(gl.TEXTURE0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt.internal, w, h, 0, fmt.format, halfFloat, null);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      tex, fbo: f, w, h, tx: 1 / w, ty: 1 / h,
      attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, tex); return id; },
      dispose() { gl.deleteTexture(tex); gl.deleteFramebuffer(f); },
    };
  }
  function double(w, h, fmt, filter) {
    let a = fbo(w, h, fmt, filter);
    let b = fbo(w, h, fmt, filter);
    return {
      get read() { return a; }, get write() { return b; },
      w, h, tx: 1 / w, ty: 1 / h,
      swap() { [a, b] = [b, a]; },
      dispose() { a.dispose(); b.dispose(); },
    };
  }

  function res(r) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const ar = w > h ? w / h : h / w;
    const min = Math.round(r), max = Math.round(r * ar);
    return w > h ? { w: max, h: min } : { w: min, h: max };
  }

  let dye, velocity, divergence, curlFbo, pressure;
  function initFbos() {
    for (const f of [dye, velocity, divergence, curlFbo, pressure]) f?.dispose();
    const s = res(params.simRes), d = res(params.dyeRes);
    gl.disable(gl.BLEND);
    dye = double(d.w, d.h, fmtRGBA, filtering);
    velocity = double(s.w, s.h, fmtRG, filtering);
    divergence = fbo(s.w, s.h, fmtR, gl.NEAREST);
    curlFbo = fbo(s.w, s.h, fmtR, gl.NEAREST);
    pressure = double(s.w, s.h, fmtR, gl.NEAREST);
  }

  let lastCssW = 0;
  function resize() {
    const cssW = canvas.clientWidth || innerWidth;
    const cssH = canvas.clientHeight || innerHeight;
    const w = Math.max(1, Math.round(cssW * params.dpr));
    const h = Math.max(1, Math.round(cssH * params.dpr));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    // A phone's toolbar changes the height on every scroll, and a slow device
    // lowers its own resolution; only a real change of width is worth losing
    // the ink over.
    if (!dye || Math.abs(cssW - lastCssW) > 2) {
      lastCssW = cssW;
      initFbos();
    }
    return true;
  }

  let pendingShift = 0;
  function step(dt) {
    gl.disable(gl.BLEND);
    const v = velocity;
    gl.useProgram(prog.curl.p);
    gl.uniform2f(prog.curl.u.texelSize, v.tx, v.ty);
    gl.uniform1i(prog.curl.u.uVelocity, v.read.attach(0));
    blit(curlFbo);

    gl.useProgram(prog.vorticity.p);
    gl.uniform2f(prog.vorticity.u.texelSize, v.tx, v.ty);
    gl.uniform1i(prog.vorticity.u.uVelocity, v.read.attach(0));
    gl.uniform1i(prog.vorticity.u.uCurl, curlFbo.attach(1));
    gl.uniform1f(prog.vorticity.u.curl, params.curl);
    gl.uniform1f(prog.vorticity.u.dt, dt);
    blit(v.write);
    v.swap();

    gl.useProgram(prog.divergence.p);
    gl.uniform2f(prog.divergence.u.texelSize, v.tx, v.ty);
    gl.uniform1i(prog.divergence.u.uVelocity, v.read.attach(0));
    blit(divergence);

    gl.useProgram(prog.clear.p);
    gl.uniform1i(prog.clear.u.uTexture, pressure.read.attach(0));
    gl.uniform1f(prog.clear.u.value, 0.8);
    blit(pressure.write);
    pressure.swap();

    gl.useProgram(prog.pressure.p);
    gl.uniform2f(prog.pressure.u.texelSize, v.tx, v.ty);
    gl.uniform1i(prog.pressure.u.uDivergence, divergence.attach(0));
    for (let i = 0; i < params.pressureIters; i++) {
      gl.uniform1i(prog.pressure.u.uPressure, pressure.read.attach(1));
      blit(pressure.write);
      pressure.swap();
    }

    gl.useProgram(prog.gradient.p);
    gl.uniform2f(prog.gradient.u.texelSize, v.tx, v.ty);
    gl.uniform1i(prog.gradient.u.uPressure, pressure.read.attach(0));
    gl.uniform1i(prog.gradient.u.uVelocity, v.read.attach(1));
    blit(v.write);
    v.swap();

    // The sheet moves with the page: scrolling carries both the ink and the
    // current up and off the top, the way a printed page would.
    const shift = pendingShift / Math.max(1, canvas.clientHeight);
    pendingShift = 0;
    const a = prog.advection;
    gl.useProgram(a.p);
    gl.uniform2f(a.u.texelSize, v.tx, v.ty);
    if (!linear) gl.uniform2f(a.u.dyeTexelSize, v.tx, v.ty);
    // Content moving up by dy means each point now shows what sat dy below it.
    gl.uniform2f(a.u.shift, 0, shift);
    const vid = v.read.attach(0);
    gl.uniform1i(a.u.uVelocity, vid);
    gl.uniform1i(a.u.uSource, vid);
    gl.uniform1f(a.u.dt, dt);
    gl.uniform1f(a.u.dissipation, params.velocityDissipation);
    blit(v.write);
    v.swap();

    if (!linear) gl.uniform2f(a.u.dyeTexelSize, dye.tx, dye.ty);
    gl.uniform1i(a.u.uVelocity, v.read.attach(0));
    gl.uniform1i(a.u.uSource, dye.read.attach(1));
    gl.uniform1f(a.u.dissipation, params.dyeDissipation);
    blit(dye.write);
    dye.swap();
  }

  function render() {
    const d = prog.display;
    gl.useProgram(d.p);
    gl.uniform2f(d.u.texelSize, 1.4 / dye.w, 1.4 / dye.h);
    gl.uniform3f(d.u.paper, PAPER[0], PAPER[1], PAPER[2]);
    gl.uniform2f(d.u.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1i(d.u.uDye, dye.read.attach(0));
    blit(null);
  }

  /** x, y in CSS pixels of the canvas; dx, dy a velocity in CSS px. */
  function splat(x, y, dx, dy, ink, amount = 1, radiusScale = 1) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const u = x / w, vv = 1 - y / h;
    const ar = w / h;
    const r = params.radius * radiusScale * (ar > 1 ? ar : 1);
    const s = prog.splat;
    gl.useProgram(s.p);
    gl.uniform1i(s.u.uTarget, velocity.read.attach(0));
    gl.uniform1f(s.u.aspectRatio, ar);
    gl.uniform2f(s.u.point, u, vv);
    gl.uniform3f(s.u.color, dx * 6, -dy * 6, 0);
    gl.uniform1f(s.u.radius, r);
    blit(velocity.write);
    velocity.swap();

    const c = INKS[ink] || INKS.skill;
    gl.uniform1i(s.u.uTarget, dye.read.attach(0));
    gl.uniform3f(s.u.color, c[0] * amount, c[1] * amount, c[2] * amount);
    gl.uniform1f(s.u.radius, r * 0.9);
    blit(dye.write);
    dye.swap();
  }

  resize();

  return {
    resize,
    step,
    render,
    splat,
    /** Lower (or restore) the drawing resolution; the simulation is untouched. */
    setScale(dpr) {
      params.dpr = dpr;
      return resize();
    },
    scroll(dy) { pendingShift += dy; },
    get params() { return params; },
    lost() { return gl.isContextLost(); },
  };
}
