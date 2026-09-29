/*
 * The field.
 *
 * Every point is a file. Sixteen constellations, one per tool, each in its own
 * corner of the sky and drifting — until the page is scrolled, and they fly
 * into one library: cards of the same four colours the application gives its
 * item types. Plain WebGL 1, one draw call, no dependencies.
 *
 * `setScene({ gather, recede, hero })` is all the page tells it; everything
 * else is its own business.
 */

const TYPE = {
  skill: [0.725, 0.651, 1.0],
  agent: [0.392, 0.839, 0.761],
  command: [0.878, 0.69, 0.439],
  rule: [0.941, 0.604, 0.678],
  dust: [0.93, 0.91, 0.87],
};
const TYPE_KEYS = ["skill", "agent", "command", "rule"];

// Where each tool keeps its things, how much it tends to hold, and where its
// constellation sits: x and y from -1 to 1 across the viewport, z into it.
const TOOLS = [
  { path: "~/.claude/skills", w: 1.0, mix: [5, 2, 2, 1], at: [0.6, 0.44, 0.25] },
  { path: "~/.cursor/rules", w: 0.62, mix: [3, 1, 0, 2], at: [0.9, -0.12, -0.3] },
  { path: "~/.codex/prompts", w: 0.56, mix: [3, 1, 2, 0], at: [0.44, -0.56, 0.12] },
  { path: "~/.config/opencode", w: 0.36, mix: [2, 1, 1, 0], at: [0.16, 0.8, -0.6] },
  { path: "~/.gemini/config", w: 0.34, mix: [2, 1, 1, 1], at: [-0.52, 0.84, -0.4] },
  { path: "~/.gemini/commands", w: 0.26, mix: [0, 0, 1, 0], at: [0.98, 0.74, -0.9] },
  { path: "~/.copilot/skills", w: 0.42, mix: [2, 0, 1, 1], at: [-0.84, -0.74, 0.05] },
  { path: "~/Documents/Cline/Rules", w: 0.3, mix: [1, 0, 1, 2], at: [0.14, -0.9, -0.5] },
  { path: "~/.trae/skills", w: 0.24, mix: [2, 0, 0, 1], at: [-0.22, 0.4, -1.5] },
  { path: "~/.codeium/windsurf", w: 0.32, mix: [2, 0, 0, 1], at: [0.8, -0.8, -0.7] },
  { path: "~/.config/goose/skills", w: 0.2, mix: [1, 0, 0, 0], at: [-0.96, 0.4, -1.0] },
  { path: "~/.hermes/skills", w: 0.26, mix: [2, 1, 1, 1], at: [0.34, 0.06, -1.3] },
  { path: "~/.pi/agent/skills", w: 0.18, mix: [2, 0, 0, 1], at: [-0.46, -0.34, -1.7] },
  { path: "~/.roo/rules", w: 0.22, mix: [0, 0, 0, 1], at: [1.02, 0.28, 0.2] },
  { path: ".continue/prompts", w: 0.22, mix: [0, 0, 1, 1], at: [-0.12, -0.62, -1.0] },
  { path: "~/.agents/skills", w: 0.4, mix: [1, 0, 0, 0], at: [-0.72, 0.02, -2.0] },
];

const DEPTH = 3.2; // camera distance; the z = 0 plane spans -1..1 vertically
const CARD = { cols: 6, rows: 4 }; // points per card in the gathered library
const DUST = 0.14; // share of points that belong to no tool and never gather

const VERT = `
precision highp float;
attribute vec3 aLocal;
attribute vec3 aGrid;
attribute vec3 aColor;
attribute vec4 aMeta; // cluster, seed, size, tilt

uniform vec3 uCenters[16];
uniform float uTime;
uniform float uAspect;
uniform float uGather;
uniform float uRecede;
uniform float uIntro;
uniform float uPx;
uniform vec2 uTilt;

varying vec3 vColor;
varying float vAlpha;
varying float vCrisp;

const float PI = 3.14159265;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main() {
  float seed = aMeta.y;
  float isDust = step(15.5, aMeta.x);
  vec3 centre = uCenters[int(min(aMeta.x, 15.0))];

  // Scattered: each constellation turns on its own tilted axis, the inside
  // faster than the rim, the way a small galaxy would.
  vec3 l = aLocal * mix(2.6, 1.0, uIntro);
  float r = length(l.xz) + 0.04;
  l.xz = rot(uTime * (0.05 + 0.03 * seed) / r * 0.12) * l.xz;
  l.yz = rot(aMeta.w) * l.yz;
  vec3 scattered = centre + l;
  scattered += 0.012 * vec3(sin(uTime * 0.7 + seed * 40.0), cos(uTime * 0.6 + seed * 31.0), 0.0);
  if (isDust > 0.5) scattered = aLocal + vec3(0.0, 0.0, sin(uTime * 0.05 + seed * 6.0) * 0.3);

  // Gathered: points leave in their own time and arc towards the viewer on
  // the way, so the library assembles rather than slides.
  float delay = seed * 0.45;
  float t = clamp((uGather - delay) / 0.55, 0.0, 1.0);
  t = t * t * (3.0 - 2.0 * t);
  vec3 p = mix(scattered, aGrid, t * (1.0 - isDust));
  p.z += sin(t * PI) * (0.35 + 0.5 * seed);

  // Receding: the finished library tips back and rises out with the page,
  // leaving only the dust behind the sections that follow.
  float leave = uRecede * (1.0 - isDust);
  p.yz = rot(-leave * 0.9) * p.yz;
  p.z -= leave * 1.2;
  p.y += leave * 1.1;

  // The pointer leans the whole sky, less so once it is a library.
  float lean = 1.0 - 0.6 * uGather;
  p.xz = rot(uTilt.x * 0.16 * lean) * p.xz;
  p.yz = rot(-uTilt.y * 0.1 * lean) * p.yz;

  float w = ${DEPTH.toFixed(2)} - p.z;
  gl_Position = vec4(p.x * ${DEPTH.toFixed(2)} / w / uAspect, p.y * ${DEPTH.toFixed(2)} / w, 0.0, 1.0);

  float size = mix(0.55 + aMeta.z * 1.6, 1.2, t * (1.0 - isDust));
  gl_PointSize = max(uPx * size * ${DEPTH.toFixed(2)} / w, 1.0);

  float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + seed * 1.8) + seed * 60.0);
  float alpha = mix(twinkle, 0.95, t);
  alpha *= mix(1.0, 1.0 - uGather, isDust);
  alpha *= smoothstep(0.0, 1.0, uIntro - seed * 0.3);
  alpha *= 1.0 - leave;
  alpha *= 1.0 - 0.45 * uRecede * isDust;
  alpha *= clamp(1.25 - p.z * -0.18, 0.35, 1.0);
  vAlpha = alpha;
  vColor = aColor;
  vCrisp = t * (1.0 - isDust);
}
`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
varying float vCrisp;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float glow = exp(-d * 3.2);
  float disc = smoothstep(1.0, 0.55, d);
  float a = mix(glow, disc, vCrisp) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}
`;

/** A small seeded generator, so the sky is the same one on every visit. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "shader did not compile");
  }
  return shader;
}

export function createField(canvas, labelLayer, { reducedMotion }) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);

  // ------------------------------------------------------------ the points
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const total = small ? 1900 : 3600;
  const rand = rng(1729);
  const weight = TOOLS.reduce((sum, tool) => sum + tool.w, 0);

  const points = []; // { cluster, local, type, seed, size, tilt }
  TOOLS.forEach((tool, cluster) => {
    const count = Math.round(((total * (1 - DUST)) / weight) * tool.w);
    const radius = 0.06 + 0.16 * Math.sqrt(tool.w);
    const tilt = (rand() - 0.5) * 1.6;
    const mixSum = tool.mix.reduce((a, b) => a + b, 0);
    tool.radius = radius;
    for (let i = 0; i < count; i++) {
      let pick = rand() * mixSum;
      let type = 0;
      while (pick > tool.mix[type]) pick -= tool.mix[type++];
      const r = radius * Math.abs(gauss(rand)) * 0.6;
      const a = rand() * Math.PI * 2;
      points.push({
        cluster,
        local: [Math.cos(a) * r, gauss(rand) * radius * 0.12, Math.sin(a) * r],
        type: TYPE_KEYS[type],
        seed: rand(),
        size: rand() ** 3,
        tilt,
      });
    }
  });
  const dustCount = Math.round(total * DUST);
  for (let i = 0; i < dustCount; i++) {
    points.push({
      cluster: 16,
      local: [(rand() - 0.5) * 5, (rand() - 0.5) * 2.6, -rand() * 3],
      type: "dust",
      seed: rand(),
      size: rand() ** 4 * 0.6,
      tilt: 0,
    });
  }

  const n = points.length;
  const local = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const meta = new Float32Array(n * 4);
  const grid = new Float32Array(n * 3);
  points.forEach((p, i) => {
    local.set(p.local, i * 3);
    color.set(TYPE[p.type], i * 3);
    meta.set([p.cluster, p.seed, p.size, p.tilt], i * 4);
  });

  // Cards: every card one type, like the application's own, and the cards in
  // a shuffled order so the library reads mixed rather than sorted.
  const perCard = CARD.cols * CARD.rows;
  const cards = [];
  for (const key of TYPE_KEYS) {
    const members = [];
    points.forEach((p, i) => {
      if (p.type === key) members.push(i);
    });
    for (let i = 0; i < members.length; i += perCard) cards.push(members.slice(i, i + perCard));
  }
  const shuffle = rng(42);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(shuffle() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  function layoutGrid(aspect) {
    const wide = aspect > 1.1;
    // The library takes the right-hand side on a wide screen, where the gather
    // copy is not, and the upper half on a narrow one, under the nav.
    const box = wide
      ? { w: Math.min(aspect * 1.05, 2.3), h: 1.35, x: aspect * 0.32, y: 0.08 }
      : { w: aspect * 1.8, h: 0.95, y: 0.4, x: 0 };
    const span = (count, per) => count * (per + 1.6) - 1.6;
    // The column count that gives the largest cards inside the box, with a
    // nudge towards a last row that is not left nearly empty.
    let best = { score: -1 };
    for (let cols = 3; cols <= 30; cols++) {
      const rows = Math.ceil(cards.length / cols);
      const unit = Math.min(box.w / span(cols, CARD.cols), box.h / span(rows, CARD.rows));
      const empty = rows * cols - cards.length;
      const score = unit * (1 - (0.4 * empty) / cols);
      if (score > best.score) best = { score, cols, rows, unit };
    }
    const { cols: cardCols, rows: cardRows, unit } = best;
    const cardW = CARD.cols * unit;
    const cardH = CARD.rows * unit;
    const gap = unit * 1.6;
    const width = span(cardCols, CARD.cols) * unit;
    const height = span(cardRows, CARD.rows) * unit;
    const left = box.x - width / 2 + unit / 2;
    const top = box.y + height / 2 - unit / 2;
    const lastRow = cardRows - 1;
    const lastCount = cards.length - lastRow * cardCols;
    cards.forEach((card, c) => {
      const row = Math.floor(c / cardCols);
      // A short last row sits centred under the others, not hard left.
      const indent = row === lastRow ? ((cardCols - lastCount) * (cardW + gap)) / 2 : 0;
      const cx = left + indent + (c % cardCols) * (cardW + gap);
      const cy = top - row * (cardH + gap);
      card.forEach((index, k) => {
        grid[index * 3] = cx + (k % CARD.cols) * unit;
        grid[index * 3 + 1] = cy - Math.floor(k / CARD.cols) * unit;
        grid[index * 3 + 2] = 0;
      });
    });
    return unit;
  }

  const buffers = {};
  function attribute(name, data, size, usage = gl.STATIC_DRAW) {
    const loc = gl.getAttribLocation(program, name);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    buffers[name] = buffer;
  }
  attribute("aLocal", local, 3);
  attribute("aColor", color, 3);
  attribute("aMeta", meta, 4);
  attribute("aGrid", grid, 3, gl.DYNAMIC_DRAW);

  const u = {};
  for (const name of [
    "uCenters",
    "uTime",
    "uAspect",
    "uGather",
    "uRecede",
    "uIntro",
    "uPx",
    "uTilt",
  ]) {
    u[name] = gl.getUniformLocation(program, name);
  }

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  gl.clearColor(0, 0, 0, 0);

  // ------------------------------------------------------------ the labels
  const labels = TOOLS.map((tool, i) => {
    const el = document.createElement("span");
    el.className = "field-label";
    const main = TYPE_KEYS[tool.mix.indexOf(Math.max(...tool.mix))];
    el.style.color = `var(--${main})`;
    el.innerHTML = `<i></i><b></b>`;
    el.querySelector("b").textContent = tool.path;
    // On a phone, half the labels would only collide.
    if (small && i % 2 === 1) el.hidden = true;
    labelLayer.append(el);
    return el;
  });

  // ------------------------------------------------------------ the state
  const state = {
    width: 0,
    height: 0,
    aspect: 1,
    dpr: 1,
    gather: 0,
    recede: 0,
    hero: 1,
    tilt: [0, 0],
    target: { gather: 0, recede: 0, hero: 1, tilt: [0, 0] },
    intro: reducedMotion ? 1 : 0,
    start: performance.now(),
    running: false,
  };

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.aspect = state.width / state.height;
    canvas.width = Math.round(state.width * state.dpr);
    canvas.height = Math.round(state.height * state.dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const unit = layoutGrid(state.aspect);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.aGrid);
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.DYNAMIC_DRAW);
    // Points sized so a gathered card reads as dots with air between them.
    const unitPx = (unit * state.height) / 2;
    state.px = Math.max(1.6, Math.min(unitPx * 0.62, 5)) * state.dpr;
  }

  const centres = new Float32Array(16 * 3);
  function placeCentres(time) {
    const spanX = state.aspect;
    const spanY = state.aspect < 1 ? 1.1 : 0.92;
    TOOLS.forEach((tool, i) => {
      const [x, y, z] = tool.at;
      const drift = reducedMotion ? 0 : 1;
      centres[i * 3] = x * spanX * 0.95 + drift * 0.04 * Math.sin(time * 0.11 + i * 1.7);
      centres[i * 3 + 1] = y * spanY + drift * 0.035 * Math.cos(time * 0.09 + i * 2.3);
      centres[i * 3 + 2] = z + drift * 0.08 * Math.sin(time * 0.07 + i);
    });
  }

  // The same projection the vertex shader makes, for the labels.
  function project(x, y, z) {
    const [tx, ty] = state.tilt;
    const lean = 1 - 0.6 * state.gather;
    let a = tx * 0.16 * lean;
    let px = x * Math.cos(a) - z * Math.sin(a);
    let pz = x * Math.sin(a) + z * Math.cos(a);
    a = -ty * 0.1 * lean;
    const py = y * Math.cos(a) - pz * Math.sin(a);
    pz = y * Math.sin(a) + pz * Math.cos(a);
    const w = DEPTH - pz;
    px = ((px * DEPTH) / w / state.aspect + 1) * 0.5 * state.width;
    return [px, (1 - ((py * DEPTH) / w + 1) * 0.5) * state.height, w];
  }

  // Labels give way to the page's own words rather than print over them.
  let keepOut = [];
  function clear(x, y, el) {
    const w = el.offsetWidth;
    return !keepOut.some(
      (r) => x < r.right + 12 && x + w > r.left - 12 && y < r.bottom + 8 && y + 16 > r.top - 8,
    );
  }

  function drawLabels() {
    const visible = Math.max(0, 1 - state.gather * 3) * state.hero * Math.min(1, state.intro * 1.4);
    labelLayer.style.opacity = visible.toFixed(3);
    if (visible <= 0.001) return;
    TOOLS.forEach((tool, i) => {
      const [x, y, w] = project(centres[i * 3], centres[i * 3 + 1], centres[i * 3 + 2]);
      const r = ((tool.radius * DEPTH) / w) * state.height * 0.5 * 0.55;
      const depth = Math.max(0.25, Math.min(1, 1.6 - w * 0.28));
      labels[i].style.transform = `translate3d(${(x + r * 0.6).toFixed(1)}px, ${(y + r * 0.7).toFixed(1)}px, 0)`;
      labels[i].style.opacity = clear(x + r * 0.6, y + r * 0.7, labels[i]) ? depth.toFixed(2) : "0";
    });
  }

  function frame(now) {
    if (!state.running) return;
    const time = reducedMotion ? 12 : (now - state.start) / 1000;
    const k = reducedMotion ? 1 : 0.085;
    state.gather += (state.target.gather - state.gather) * k;
    state.recede += (state.target.recede - state.recede) * k;
    state.hero += (state.target.hero - state.hero) * k;
    state.tilt[0] += (state.target.tilt[0] - state.tilt[0]) * 0.05;
    state.tilt[1] += (state.target.tilt[1] - state.tilt[1]) * 0.05;
    if (!reducedMotion) state.intro = Math.min(1, state.intro + 0.009);

    placeCentres(time);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform3fv(u.uCenters, centres);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uAspect, state.aspect);
    gl.uniform1f(u.uGather, state.gather);
    gl.uniform1f(u.uRecede, state.recede);
    gl.uniform1f(u.uIntro, easeOut(state.intro));
    gl.uniform1f(u.uPx, state.px);
    gl.uniform2f(u.uTilt, state.tilt[0], state.tilt[1]);
    gl.drawArrays(gl.POINTS, 0, n);
    drawLabels();
    requestAnimationFrame(frame);
  }

  function start() {
    if (state.running) return;
    state.running = true;
    requestAnimationFrame(frame);
  }

  function stop() {
    state.running = false;
  }

  resize();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
  if (!reducedMotion) {
    window.addEventListener(
      "pointermove",
      (event) => {
        state.target.tilt = [
          (event.clientX / state.width) * 2 - 1,
          (event.clientY / state.height) * 2 - 1,
        ];
      },
      { passive: true },
    );
  }
  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    stop();
    document.documentElement.classList.remove("has-gl");
    labelLayer.hidden = true;
  });

  start();

  return {
    setKeepOut(rects) {
      keepOut = rects;
    },
    setScene({ gather, recede, hero }) {
      state.target.gather = gather;
      state.target.recede = recede;
      state.target.hero = hero;
    },
  };
}

function easeOut(t) {
  return 1 - (1 - t) ** 3;
}
