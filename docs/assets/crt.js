// Phosphor — the hero terminal.
//
// A small shell is drawn as a character grid onto a 2D canvas. That canvas is
// the texture for a WebGL post-process: phosphor persistence (a feedback
// buffer, so moving glyphs leave trails), bloom, barrel curvature, scanlines,
// an aperture-grille mask, a little chromatic aberration and flicker.
// Without WebGL the 2D canvas is shown as it is. Everything the shell prints is
// also announced to screen readers through a live region.

const root = document.documentElement;
root.classList.add("js-crt");

const screenEl = document.getElementById("screen");
const glCanvas = document.getElementById("crt");
const input = document.getElementById("term-input");
const liveLog = document.getElementById("term-log");
const toggleKey = document.getElementById("key-toggle");
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
let reduce = motionQuery.matches;
// ?slow=10 stretches the gather animation, for inspecting it frame by frame.
const SLOW = Math.max(1, Number(new URLSearchParams(location.search).get("slow")) || 1);

/* ───────────────────────────── the library ───────────────────────────── */

const TYPES = ["skill", "agent", "command", "rule"];
const ITEMS = [
  { id: "pdf-extract", type: "skill", tool: "claude-code", dir: "~/.claude/skills", file: "pdf-extract/", proj: ".claude/skills" },
  { id: "review-sql", type: "skill", tool: "global", dir: "~/.agents/skills", file: "review-sql/", proj: ".agents/skills" },
  { id: "triage", type: "skill", tool: "goose", dir: "~/.config/goose/skills", file: "triage/", proj: ".goose/skills" },
  { id: "planner", type: "agent", tool: "claude-code", dir: "~/.claude/agents", file: "planner.md", proj: ".claude/agents" },
  { id: "reviewer", type: "agent", tool: "opencode", dir: "~/.config/opencode/agents", file: "reviewer.md", proj: ".opencode/agents" },
  { id: "ship", type: "command", tool: "claude-code", dir: "~/.claude/commands", file: "ship.md", proj: ".claude/commands" },
  { id: "commit", type: "command", tool: "codex", dir: "~/.codex/prompts", file: "commit.md", proj: null },
  { id: "typescript", type: "rule", tool: "cursor", dir: "~/.cursor/rules", file: "typescript.mdc", proj: ".cursor/rules" },
  { id: "house-style", type: "rule", tool: "windsurf", dir: "~/.windsurf/rules", file: "house-style.md", proj: ".windsurf/rules" },
];
// The order `ls` prints them in: by folder, the way the disk has them.
const LS_ORDER = ["pdf-extract", "planner", "ship", "review-sql", "triage", "reviewer", "commit", "typescript", "house-style"];
const byId = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
const TOOLS = [
  "claude-code", "cursor", "codex", "opencode", "antigravity", "copilot", "cline", "trae",
  "windsurf", "goose", "hermes", "pi", "gemini-cli", "roo-code", "continue", "global",
];
const PALETTES = [
  "light", "dark", "quiet-light", "solarized-light", "solarized-dark", "monokai", "abyss",
  "kimbie-dark", "tomorrow-night-blue", "red", "high-contrast", "tokyo-night", "aura",
  "synthwave-84", "panda", "overnight", "horizon-morning", "horizon-evening",
];

const state = {
  entries: [],
  cmdline: "",
  suggest: "",
  off: new Set(),
  gathered: false,
  busy: false,
  history: [],
  hist: -1,
};

/* ───────────────────────────── palette ───────────────────────────── */

let PAL = {};
function hex(c) {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [255, 180, 65];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function readPalette() {
  const cs = getComputedStyle(root);
  const v = (n) => cs.getPropertyValue(n).trim();
  PAL = {
    fg: v("--fg"), hi: v("--hi"), dim: v("--dim"), faint: v("--faint"), ghost: v("--ghost"),
    bg: v("--crt-bg"), skill: v("--skill"), agent: v("--agent"), command: v("--command"), rule: v("--rule"),
  };
  PAL.rgb = Object.fromEntries(Object.entries(PAL).map(([k, c]) => [k, hex(c)]));
}

/* ───────────────────────────── metrics ───────────────────────────── */

const src = document.createElement("canvas");
const ctx = src.getContext("2d");
let W = 0, H = 0, dpr = 1, cssW = 0, cols = 60, rows = 20, cw = 10, lh = 20, fs = 20, padX = 0, padY = 0, bannerPx = 8;
const FONT = '"VT323", ui-monospace, monospace';

function measure() {
  const r = screenEl.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssW = r.width;
  W = Math.round(r.width * dpr);
  H = Math.round(r.height * dpr);
  src.width = W;
  src.height = H;
  cols = cssW < 420 ? 34 : cssW < 600 ? 44 : 54;
  padX = W * 0.065;
  padY = H * 0.07;
  ctx.font = `100px ${FONT}`;
  const ratio = ctx.measureText("M").width / 100 || 0.5;
  cw = (W - 2 * padX) / cols;
  fs = cw / ratio;
  lh = Math.round(fs * 1.02);
  rows = Math.max(8, Math.floor((H - 2 * padY) / lh));
  padY = (H - rows * lh) / 2;
  bannerPx = Math.min(cw * 0.95, (W - 2 * padX) / 47);
  return true;
}

/* ───────────────────────────── lines ───────────────────────────── */
// A line is { segs: [{ t, c, a?, id? }] }, or { banner: true }.

const seg = (t, c = "fg", extra) => ({ t, c, ...extra });
const line = (...segs) => ({ segs });
const blank = () => ({ segs: [] });
const padEnd = (s, n) => (s.length >= n ? s + " " : s + " ".repeat(n - s.length));

function wrap(text, c = "fg", indent = 0) {
  const out = [];
  const width = cols - indent;
  for (const para of text.split("\n")) {
    let cur = "";
    for (const word of para.split(" ")) {
      if (!cur.length) cur = word;
      else if ((cur + " " + word).length <= width) cur += " " + word;
      else {
        out.push(cur);
        cur = word;
      }
      while (cur.length > width) {
        out.push(cur.slice(0, width));
        cur = cur.slice(width);
      }
    }
    out.push(cur);
  }
  return out.map((t) => line(seg(" ".repeat(indent) + t, c)));
}

// A command echoed after the prompt, wrapped like a real terminal wraps it.
function echo(cmd) {
  const full = `$ ${cmd}`;
  const out = [];
  for (let i = 0; i < full.length; i += cols) out.push(full.slice(i, i + cols));
  return out.map((t, i) => (i === 0 ? line(seg("$ ", "dim"), seg(t.slice(2), "hi")) : line(seg(t, "hi"))));
}

function bannerLines() {
  const h = Math.ceil((bannerPx * 6) / lh);
  return [{ banner: true }, ...Array.from({ length: h }, blank)];
}

function motd() {
  const a = "skills-hub · tty1 · 16 tools · no account, no telemetry";
  return wrap(a, "dim");
}

function listingLines() {
  const out = [];
  const groups = [];
  for (const id of LS_ORDER) {
    const it = byId[id];
    const g = groups.find((x) => x.dir === it.dir);
    if (g) g.items.push(it);
    else groups.push({ dir: it.dir, items: [it] });
  }
  const dirW = cols >= 44 ? 27 : 0;
  for (const g of groups) {
    const names = g.items.map((it) => it.file).join("  ");
    const head = `${g.dir}:`;
    if (dirW && head.length + 1 + names.length <= cols) {
      const segs = [seg(padEnd(head, dirW), "faint")];
      g.items.forEach((it, k) => {
        if (k) segs.push(seg("  "));
        segs.push(seg(it.file, "fg", { id: it.id }));
      });
      out.push(line(...segs));
    } else {
      out.push(line(seg(head, "faint")));
      const segs = [seg("  ")];
      g.items.forEach((it, k) => {
        if (k) segs.push(seg("  "));
        segs.push(seg(it.file, "fg", { id: it.id }));
      });
      out.push(line(...segs));
    }
  }
  out.push(blank());
  out.push(...wrap("9 items, 9 folders, 7 tools. none of them can see the others.", "dim"));
  return out;
}

function tableLines() {
  const wide = cols >= 44;
  const typeW = 9;
  const nameW = wide ? 14 : 12;
  const out = [];
  out.push(...wrap(wide ? `16 tools scanned · ${ITEMS.length} items · 4 types · 0 copies` : `16 tools · ${ITEMS.length} items · 0 copies`, "dim"));
  out.push(blank());
  out.push(line(seg(`  ${padEnd("TYPE", typeW)}${padEnd("NAME", nameW)}TOOL`, "faint")));
  for (const type of TYPES) {
    for (const it of ITEMS.filter((i) => i.type === type)) {
      const on = !state.off.has(it.id);
      const a = on ? 1 : 0.4;
      const segs = [
        seg(on ? "▪ " : "▫ ", type),
        seg(padEnd(type, typeW), type, { a }),
        seg(it.id, type, { id: it.id, a }),
        seg(" ".repeat(Math.max(1, nameW - it.id.length)), "fg"),
        seg(it.tool, on ? "fg" : "faint"),
      ];
      if (!on) segs.push(seg(wide ? "  off" : " off", "faint"));
      out.push(line(...segs));
    }
  }
  return out;
}

function helpLines() {
  const rowsDef = [
    ["gather", "one library from every folder"],
    ["ls", "the folders, the way the tools see them"],
    ["disable <item>", "move it aside · enable puts it back"],
    ["link <item>", "symlink it into a project"],
    ["tag <item> <tag>", "a note in your vault"],
    ["cost", "what it costs per turn"],
    ["tools · themes · install", ""],
    ["phosphor green · clear", ""],
  ];
  const out = [];
  for (const [c, d] of rowsDef) {
    if (!d) out.push(line(seg(c, "hi")));
    else if (cols >= 44) out.push(line(seg(padEnd(c, 18), "hi"), seg(d, "dim")));
    else {
      out.push(line(seg(c, "hi")));
      out.push(...wrap(d, "dim", 2));
    }
  }
  return out;
}

// Entries keep what was printed as functions of the width, so a resize reflows.
function push(fn, limit) {
  const e = { fn, limit };
  state.entries.push(e);
  return e;
}

function allLines() {
  const out = [];
  for (const e of state.entries) {
    const ls = e.fn();
    out.push(...(e.limit == null ? ls : ls.slice(0, e.limit)));
  }
  return out;
}

function promptLine() {
  return { prompt: true, segs: [seg("$ ", "dim"), seg(state.cmdline, "hi")] };
}

function view() {
  const ls = [...allLines(), promptLine()];
  return ls.slice(Math.max(0, ls.length - rows));
}

/* ───────────────────────────── drawing ───────────────────────────── */

const BANNER = {
  S: [".###", "#...", ".##.", "...#", "###."],
  K: ["#..#", "#.#.", "##..", "#.#.", "#..#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  L: ["#...", "#...", "#...", "#...", "####"],
  H: ["#..#", "#..#", "####", "#..#", "#..#"],
  U: ["#..#", "#..#", "#..#", "#..#", ".##."],
  B: ["###.", "#..#", "###.", "#..#", "###."],
  "-": ["...", "...", "###", "...", "..."],
};

function drawBanner(row, alpha) {
  const word = "SKILLS-HUB";
  let x = padX;
  const y0 = padY + row * lh + bannerPx * 0.4;
  const s = bannerPx;
  ctx.globalAlpha = alpha;
  for (const ch of word) {
    const g = BANNER[ch];
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < g[r].length; c++) {
        if (g[r][c] !== "#") continue;
        const t = r / 4;
        ctx.fillStyle = mix(PAL.rgb.hi, PAL.rgb.fg, t);
        ctx.fillRect(x + c * s + s * 0.08, y0 + r * s + s * 0.08, s * 0.84, s * 0.84);
      }
    }
    x += (g[0].length + 1) * s;
  }
}

function mix(a, b, t) {
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

const X = (col) => padX + col * cw;
const Y = (row) => padY + row * lh + lh * 0.8;

function drawText(t, col, row, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  let c = col;
  for (const ch of t) {
    if (ch !== " ") ctx.fillText(ch, X(c), Y(row));
    c++;
  }
}

function drawLines(lines, alpha = 1, hideIds = false, rowAlpha) {
  lines.forEach((ln, r) => {
    const ra = rowAlpha ? rowAlpha(r) : 1;
    if (ra <= 0) return;
    if (ln.banner) return drawBanner(r, alpha * ra);
    let col = 0;
    for (const s of ln.segs) {
      if (!(hideIds && s.id)) drawText(s.t, col, r, PAL[s.c] || s.c, alpha * ra * (s.a ?? 1));
      col += [...s.t].length;
    }
    if (ln.prompt) drawPrompt(r, col, alpha * ra);
  });
}

let blinkOn = true;
function drawPrompt(r, col, alpha) {
  const typing = performance.now() - lastKey < 500;
  if (blinkOn || reduce || typing || state.busy) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = PAL.fg;
    ctx.fillRect(X(col), padY + r * lh + lh * 0.12, cw * 0.92, lh * 0.8);
  }
  if (!state.cmdline && state.suggest && !state.busy) {
    const hint = cols >= 44 ? `  ${state.suggest}   ⏎ to run` : `  ${state.suggest} ⏎`;
    drawText(hint, col + 1, r, PAL.faint, alpha);
  }
}

function tokenPositions(lines) {
  const pos = {};
  lines.forEach((ln, r) => {
    if (!ln.segs) return;
    let col = 0;
    for (const s of ln.segs) {
      if (s.id) pos[s.id] = { col, row: r, t: s.t, c: s.c };
      col += [...s.t].length;
    }
  });
  return pos;
}

let anim = null;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function drawSource(now) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.font = `${fs}px ${FONT}`;
  ctx.textBaseline = "alphabetic";

  if (!anim) {
    drawLines(view());
    return;
  }
  const p = clamp01((now - anim.t0) / anim.dur);
  const after = view();
  drawLines(anim.before, 1 - clamp01(p / 0.3), true);
  drawLines(after, 1, true, (r) => clamp01((p - 0.45 - r * 0.018) / 0.2));
  const dst = tokenPositions(after);
  const ids = Object.keys(dst);
  ids.forEach((id, i) => {
    const d = dst[id];
    const s = anim.src[id] || { col: d.col, row: -2, t: d.t, c: "fg" };
    const q = ease(clamp01((p - 0.06 - i * 0.035) / 0.55));
    const x = X(s.col + (d.col - s.col) * q);
    const lift = Math.sin(q * Math.PI) * lh * (i % 2 ? 1.2 : -1.2);
    const y = Y(s.row + (d.row - s.row) * q) + lift;
    const text = q < 0.5 ? s.t : d.t;
    const from = PAL.rgb[s.c] || PAL.rgb.fg;
    const to = PAL.rgb[d.c] || PAL.rgb.fg;
    ctx.globalAlpha = 1;
    ctx.fillStyle = mix(from, to, q);
    let k = 0;
    for (const ch of text) {
      ctx.fillText(ch, x + k * cw, y);
      k++;
    }
  });
  if (p >= 1) anim = null;
}

/* ───────────────────────────── WebGL ───────────────────────────── */

const VERT = `attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const PERSIST = `precision mediump float; varying vec2 v;
uniform sampler2D src; uniform sampler2D prev; uniform float decay;
void main(){
  vec3 a = texture2D(src, v).rgb;
  vec3 b = texture2D(prev, v).rgb * decay;
  gl_FragColor = vec4(max(a, b), 1.0);
}`;

const BLUR = `precision mediump float; varying vec2 v;
uniform sampler2D t; uniform vec2 dir;
void main(){
  vec3 c = texture2D(t, v).rgb * 0.2270;
  c += (texture2D(t, v + dir * 1.3846).rgb + texture2D(t, v - dir * 1.3846).rgb) * 0.3162;
  c += (texture2D(t, v + dir * 3.2308).rgb + texture2D(t, v - dir * 3.2308).rgb) * 0.0703;
  gl_FragColor = vec4(c, 1.0);
}`;

const FINAL = `precision mediump float; varying vec2 v;
uniform sampler2D img; uniform sampler2D bloom;
uniform vec2 res; uniform float time; uniform float dpr; uniform float flick;
uniform float curve; uniform float scan; uniform vec3 surround; uniform vec3 base;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 c0 = v - 0.5;
  vec2 uv = v + c0 * dot(c0, c0) * curve;
  vec2 c = uv - 0.5;
  // rounded screen edge, in pixels so the corners stay round on any aspect
  vec2 px = abs(c) * res;
  float rad = 0.045 * min(res.x, res.y);
  vec2 q = px - (0.5 * res - rad);
  float edge = length(max(q, 0.0)) - rad;
  float m = 1.0 - smoothstep(-1.5 * dpr, 0.5 * dpr, edge);

  vec2 ca = c * (0.004 + 0.002 * flick);
  vec3 col;
  col.r = texture2D(img, uv + ca).r;
  col.g = texture2D(img, uv).g;
  col.b = texture2D(img, uv - ca).b;
  vec3 b = texture2D(bloom, uv).rgb;
  col += b * 1.1;

  float r2 = dot(c, c);
  col += base * (1.0 - r2 * 2.2);                   // the glass is never quite black

  float y = uv.y * res.y / dpr;                      // scanlines every 3 css px
  float s = 0.5 + 0.5 * sin(y * 6.28318 / 3.0);
  col *= 1.0 - scan * s * s;

  float mx = mod(gl_FragCoord.x, 3.0);               // aperture grille
  vec3 grille = vec3(mx < 1.0 ? 1.0 : 0.93, (mx >= 1.0 && mx < 2.0) ? 1.0 : 0.93, mx >= 2.0 ? 1.0 : 0.93);
  col *= grille;

  float bar = fract(time * 0.06);                   // slow rolling bar
  col += base * 2.2 * exp(-pow((uv.y - (1.1 - bar * 1.2)) * 9.0, 2.0)) * flick;

  col *= 1.0 + flick * (0.018 * sin(time * 113.0) + 0.035 * (hash(v * res + fract(time)) - 0.5));
  col *= 1.0 - smoothstep(0.2, 0.78, length(c * vec2(1.0, 1.1))) * 0.55;

  // a soft reflection on the glass, upper left
  col += vec3(1.0) * 0.028 * smoothstep(0.38, 0.0, length((v - vec2(0.24, 0.8)) * vec2(1.0, 1.6)));

  gl_FragColor = vec4(mix(surround, col, m), 1.0);
}`;

let gl = null;
let G = null;

function initGL() {
  try {
    gl = glCanvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: "low-power" });
  } catch {
    gl = null;
  }
  if (!gl) return false;
  const compile = (type, text) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, text);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const program = (fsText, uniforms) => {
    const pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, compile(gl.FRAGMENT_SHADER, fsText));
    gl.bindAttribLocation(pr, 0, "p");
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || "link");
    const u = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(pr, n);
    return { pr, u };
  };
  try {
    G = {
      persist: program(PERSIST, ["src", "prev", "decay"]),
      blur: program(BLUR, ["t", "dir"]),
      final: program(FINAL, ["img", "bloom", "res", "time", "dpr", "flick", "curve", "scan", "surround", "base"]),
    };
  } catch (err) {
    console.info("crt: falling back to 2D —", err.message);
    gl = null;
    return false;
  }
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  G.srcTex = texture();
  glCanvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    stop();
  });
  glCanvas.addEventListener("webglcontextrestored", () => {
    initGL();
    resizeGL();
    kick();
  });
  return true;
}

function texture() {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function target(w, h) {
  const t = texture();
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const f = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { t, f, w, h };
}

function resizeGL() {
  if (!gl) return;
  glCanvas.width = W;
  glCanvas.height = H;
  for (const k of ["pA", "pB", "b1", "b2"]) {
    if (G[k]) {
      gl.deleteTexture(G[k].t);
      gl.deleteFramebuffer(G[k].f);
    }
  }
  G.pA = target(W, H);
  G.pB = target(W, H);
  const bw = Math.max(1, Math.round(W / 4));
  const bh = Math.max(1, Math.round(H / 4));
  G.b1 = target(bw, bh);
  G.b2 = target(bw, bh);
}

function pass(prog, fbo, w, h) {
  gl.useProgram(prog.pr);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo ? fbo.f : null);
  gl.viewport(0, 0, w, h);
}
function bindTex(unit, tex, loc) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(loc, unit);
}

function renderGL(now, dt, uploaded) {
  if (uploaded) {
    gl.bindTexture(gl.TEXTURE_2D, G.srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }
  // persistence
  const decay = reduce ? 0 : Math.exp(-dt / 0.06);
  pass(G.persist, G.pB, W, H);
  bindTex(0, G.srcTex, G.persist.u.src);
  bindTex(1, G.pA.t, G.persist.u.prev);
  gl.uniform1f(G.persist.u.decay, decay);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  [G.pA, G.pB] = [G.pB, G.pA];

  // bloom, quarter resolution, two rounds
  let from = G.pA;
  for (let i = 0; i < 2; i++) {
    pass(G.blur, G.b1, G.b1.w, G.b1.h);
    bindTex(0, from.t, G.blur.u.t);
    gl.uniform2f(G.blur.u.dir, (1 + i) / from.w, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    pass(G.blur, G.b2, G.b2.w, G.b2.h);
    bindTex(0, G.b1.t, G.blur.u.t);
    gl.uniform2f(G.blur.u.dir, 0, (1 + i) / G.b1.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    from = G.b2;
  }

  // composite
  const u = G.final.u;
  pass(G.final, null, W, H);
  bindTex(0, G.pA.t, u.img);
  bindTex(1, G.b2.t, u.bloom);
  gl.uniform2f(u.res, W, H);
  gl.uniform1f(u.time, now / 1000);
  gl.uniform1f(u.dpr, dpr);
  gl.uniform1f(u.flick, reduce ? 0 : 1);
  gl.uniform1f(u.curve, cssW < 500 ? 0.07 : 0.1);
  gl.uniform1f(u.scan, cssW < 500 ? 0.22 : 0.3);
  const sr = hex(getComputedStyle(root).getPropertyValue("--crt-bg"));
  gl.uniform3f(u.surround, sr[0] / 255, sr[1] / 255, sr[2] / 255);
  const f = PAL.rgb.fg;
  gl.uniform3f(u.base, (f[0] / 255) * 0.035, (f[1] / 255) * 0.035, (f[2] / 255) * 0.035);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/* ───────────────────────────── loop ───────────────────────────── */

let raf = 0;
let visible = false;
let dirty = true;
let last = 0;
let lastKey = 0;

function running() {
  return visible && !document.hidden;
}
function kick() {
  dirty = true;
  if (!raf && running()) raf = requestAnimationFrame(frame);
}
function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function frame(now) {
  raf = 0;
  if (!running()) return;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  const b = Math.floor(now / 530) % 2 === 0;
  if (b !== blinkOn) {
    blinkOn = b;
    dirty = true;
  }
  const upload = dirty || !!anim;
  if (upload) drawSource(now);
  dirty = false;
  if (gl) renderGL(now, dt, upload);
  // Reduced motion: no flicker, no idle loop. Draw only when something changed.
  if (!reduce || anim) raf = requestAnimationFrame(frame);
}

/* ───────────────────────────── the shell ───────────────────────────── */

let script = 0; // bumps to cancel the autoplay
const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

function say(text) {
  if (liveLog) liveLog.textContent = text;
}
function linesText(fn) {
  return fn()
    .map((l) => (l.segs ? l.segs.map((s) => s.t).join("") : ""))
    .join("\n")
    .trim();
}

async function reveal(fn, per = 28) {
  const total = fn().length;
  if (reduce || per === 0) {
    push(fn);
    kick();
    return;
  }
  const e = push(fn, 0);
  for (let i = 1; i <= total; i++) {
    e.limit = i;
    kick();
    await sleep(per);
  }
  e.limit = undefined;
}

async function typeInto(text, speed = 34, token = script) {
  for (const ch of text) {
    if (token !== script) return false;
    state.cmdline += ch;
    kick();
    await sleep(speed + Math.random() * speed * 0.8);
  }
  return token === script;
}

function parse(raw) {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words[0] === "skills-hub" && words.length > 1) words.shift();
  return words;
}

async function run(raw) {
  const cmd = raw.trim();
  state.cmdline = "";
  input.value = "";
  state.suggest = "";
  if (cmd) {
    state.history.push(cmd);
    state.hist = -1;
  }
  const [name = "", ...args] = parse(cmd);
  state.busy = true;

  if (name === "gather" || name === "skills-hub") {
    await gather(cmd || "skills-hub gather");
  } else if (name === "clear") {
    state.entries = [];
  } else {
    push(() => echo(cmd));
    kick();
    const out = commandOutput(name, args);
    if (out) {
      await reveal(out, 22);
      say(linesText(out));
    }
  }
  state.busy = false;
  nextSuggestion();
  syncKeys();
  kick();
}

function findItem(arg) {
  if (!arg) return null;
  const a = arg.replace(/\/$/, "").replace(/\.(md|mdc)$/, "");
  return byId[a] || null;
}

function commandOutput(name, args) {
  const item = findItem(args[0]);
  switch (name) {
    case "":
      return null;
    case "help":
    case "?":
    case "man":
      return helpLines;
    case "ls":
      return listingLines;
    case "disable":
    case "enable": {
      if (!item) return () => wrap(`usage: ${name} <item> · e.g. ${name} review-sql`, "dim");
      const on = name === "enable";
      const already = on ? !state.off.has(item.id) : state.off.has(item.id);
      if (already) return () => wrap(`${item.id} is already ${on ? "on" : "off"}. nothing moved.`, "dim");
      if (on) state.off.delete(item.id);
      else state.off.add(item.id);
      const here = `${item.dir}/${item.file.replace(/\/$/, "")}`;
      const away = `${item.dir}/.skillmanager-disabled/${item.file.replace(/\/$/, "")}`;
      const fromTo = on ? [away, here] : [here, away];
      return () => [
        line(seg("mv ", "faint"), seg(fromTo[0], "dim")),
        ...wrap(fromTo[1], "dim", 3),
        ...wrap(
          on
            ? `${item.id} is back exactly where it was.`
            : `${item.id} is off: ${item.tool} no longer sees it, because it is no longer there.`,
          "fg",
        ),
      ];
    }
    case "link": {
      if (!item) return () => wrap("usage: link <item> · e.g. link pdf-extract", "dim");
      if (!item.proj) return () => wrap(`${item.tool} has no project folder for ${item.type}s to link into.`, "dim");
      const unit = item.file.replace(/\/$/, "");
      return () => [
        line(seg("ln -s ", "faint"), seg(`${item.dir}/${unit}`, "dim")),
        ...wrap(`~/code/app/${item.proj}/${unit}`, "dim", 6),
        ...wrap(`linked into ~/code/app. a link, not a copy: it cannot drift from the original.`, "fg"),
      ];
    }
    case "tag": {
      if (!item) return () => wrap("usage: tag <item> <tag> · e.g. tag pdf-extract docs", "dim");
      const t = args[1] || "docs";
      return () => [
        ...wrap(`tags: [${t}] written to ${item.id}'s note, in the notes folder you chose.`, "fg"),
        ...wrap("put that folder in an Obsidian vault and Dataview can query it.", "dim"),
      ];
    }
    case "cost":
      return () => {
        const wide = cols >= 44;
        const out = [];
        const row = (k, v) => {
          if (wide) {
            const w = wrap(v, "dim", 15);
            w[0] = line(seg(padEnd(k, 15), "hi"), seg(w[0].segs[0].t.slice(15), "dim"));
            out.push(...w);
          } else {
            out.push(line(seg(k, "hi")));
            out.push(...wrap(v, "dim", 2));
          }
        };
        row("per turn", "each item's name and description, in every request");
        row("on invocation", "the body, only when the item is used");
        row("history", "Claude Code + Codex sessions, 459 MB read in 284 ms");
        return out;
      };
    case "tools":
      return () => wrap(TOOLS.join("  "), "fg");
    case "themes":
    case "palettes":
      return () => [...wrap(PALETTES.join("  "), "fg"), ...wrap("18 palettes. this screen is none of them.", "dim")];
    case "install":
      return () => [
        ...wrap("brew install --cask nimble-123/tap/skills-hub", "hi"),
        ...wrap("winget install nimble-123.skills-hub", "hi"),
        ...wrap("or a .deb / .AppImage from the latest release.", "dim"),
      ];
    case "phosphor": {
      const want = args[0] === "green" || args[0] === "amber" ? args[0] : root.dataset.phosphor === "green" ? "amber" : "green";
      window.dispatchEvent(new CustomEvent("phosphor", { detail: want }));
      return () => wrap(`phosphor: ${want === "green" ? "P1 green" : "P3 amber"}`, "fg");
    }
    case "whoami":
      return () => wrap("you. there is no account, and nothing is sent anywhere.", "fg");
    case "sudo":
      return () => wrap("no need. it only touches folders you already own.", "fg");
    case "exit":
    case "logout":
      return () => wrap("the app keeps running in the menubar when you close it, too.", "fg");
    default:
      return () => wrap(`sh: ${name}: command not found · try help`, "dim");
  }
}

async function gather(cmd) {
  push(() => echo(cmd));
  kick();
  await sleep(reduce ? 0 : 260);
  const before = view().filter((l) => !l.prompt);
  const src0 = tokenPositions(before);
  state.entries = [];
  push(() => echo(cmd));
  push(tableLines);
  state.gathered = true;
  if (!reduce) {
    anim = { t0: performance.now(), dur: 1900 * SLOW, before, src: src0 };
  }
  kick();
  say(`${linesText(tableLines)}`);
  await sleep(reduce ? 0 : 1900);
}

function nextSuggestion() {
  if (!state.gathered) state.suggest = "gather";
  else if (!state.off.has("review-sql")) state.suggest = "disable review-sql";
  else state.suggest = "enable review-sql";
}

function syncKeys() {
  if (!toggleKey) return;
  const cmd = state.off.has("review-sql") ? "enable review-sql" : "disable review-sql";
  toggleKey.dataset.run = cmd;
  toggleKey.textContent = cmd;
}

async function boot() {
  const token = ++script;
  state.entries = [];
  if (reduce) {
    push(() => echo("skills-hub gather"));
    push(tableLines);
    state.gathered = true;
    nextSuggestion();
    kick();
    return;
  }
  await sleep(250);
  await reveal(bannerLines, 60);
  await reveal(motd, 60);
  push(() => [blank()]);
  await sleep(500);
  const lsCmd = cols >= 44 ? "ls ~/.claude/* ~/.agents/skills ~/.codex/prompts …" : "ls ~/.claude/* ~/.agents/skills …";
  if (!(await typeInto(lsCmd, 26, token))) return;
  await sleep(240);
  if (token !== script) return;
  state.cmdline = "";
  push(() => echo(lsCmd));
  await reveal(listingLines, 70);
  state.suggest = "gather";
  kick();
  await sleep(3200);
  if (token !== script) return;
  state.suggest = "";
  if (!(await typeInto("skills-hub gather", 55, token))) return;
  await sleep(380);
  if (token !== script) return;
  await run(state.cmdline);
}

// A button runs its command: typed quickly, so the screen shows what happened.
async function runFromButton(cmd) {
  script++; // stop the autoplay
  while (state.busy) await sleep(60);
  const token = ++script;
  state.cmdline = "";
  state.suggest = "";
  await typeInto(cmd, 16, token);
  if (token !== script) return;
  await sleep(90);
  await run(cmd);
}

/* ───────────────────────────── input ───────────────────────────── */

function bindInput() {
  screenEl.addEventListener("click", () => input.focus({ preventScroll: true }));
  input.addEventListener("input", () => {
    if (state.busy) {
      input.value = state.cmdline;
      return;
    }
    script++; // the visitor has the keyboard: stop the autoplay
    state.suggest = state.gathered ? state.suggest : "gather";
    state.cmdline = input.value.slice(0, 60);
    lastKey = performance.now();
    kick();
  });
  input.addEventListener("keydown", (e) => {
    lastKey = performance.now();
    if (e.key === "Enter") {
      e.preventDefault();
      if (state.busy) return;
      script++;
      const cmd = state.cmdline.trim() || state.suggest;
      if (!state.cmdline.trim() && state.suggest) {
        runFromButton(state.suggest);
        return;
      }
      run(cmd);
    } else if (e.key === "Tab") {
      const words = state.cmdline.split(" ");
      const lastW = words[words.length - 1];
      if (!lastW) return;
      const pool = words.length === 1
        ? ["gather", "ls", "disable", "enable", "link", "tag", "cost", "tools", "themes", "install", "phosphor", "clear", "help"]
        : ITEMS.map((i) => i.id);
      const hit = pool.find((w) => w.startsWith(lastW));
      if (hit) {
        e.preventDefault();
        words[words.length - 1] = hit + (words.length === 1 ? " " : "");
        state.cmdline = input.value = words.join(" ");
        kick();
      }
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!state.history.length) return;
      e.preventDefault();
      const n = state.history.length;
      if (e.key === "ArrowUp") state.hist = state.hist < 0 ? n - 1 : Math.max(0, state.hist - 1);
      else state.hist = state.hist < 0 ? -1 : state.hist + 1 >= n ? -1 : state.hist + 1;
      state.cmdline = input.value = state.hist < 0 ? "" : state.history[state.hist];
      kick();
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      state.entries = [];
      kick();
    }
  });
  input.addEventListener("focus", kick);
  input.addEventListener("blur", kick);

  for (const b of document.querySelectorAll("[data-run]")) {
    b.addEventListener("click", () => runFromButton(b.dataset.run));
  }
}

/* ───────────────────────────── start ───────────────────────────── */

async function start() {
  try {
    await Promise.race([document.fonts.load(`20px ${FONT}`), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* draw with the fallback face */
  }
  readPalette();
  if (!measure()) return;
  const hasGL = initGL();
  if (hasGL) {
    root.classList.add("has-gl");
    resizeGL();
  } else {
    // No WebGL: show the 2D terminal itself, glass added in CSS.
    root.classList.add("no-gl");
    src.setAttribute("aria-hidden", "true");
    glCanvas.replaceWith(src);
  }
  bindInput();

  let booted = false;
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) {
      last = 0;
      kick();
      if (!booted) {
        booted = true;
        boot();
      }
    } else stop();
  }).observe(screenEl);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else {
      last = 0;
      kick();
    }
  });

  let rt = 0;
  new ResizeObserver(() => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (!measure()) return;
      if (gl) resizeGL();
      kick();
    }, 60);
  }).observe(screenEl);

  motionQuery.addEventListener("change", (e) => {
    reduce = e.matches;
    kick();
  });
  window.addEventListener("phosphor-changed", () => {
    readPalette();
    kick();
  });
}

start();
