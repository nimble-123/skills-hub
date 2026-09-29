// Topography — the terrain, its labels, and the page's few interactions.
// No dependencies. The height field is defined twice, once in GLSL and once
// here, so labels, the readout and the section profile agree with the pixels.

// ─── The survey: tool positions are cartographic choices; everything else is
//     crates/core/src/tools.rs (confirmed defaults only, global + project). ───
const TOOLS = [
  { id: "claude-code", label: "Claude Code", x: -4.6, y: 1.6, types: "sacr", global: ["~/.claude/skills", "~/.claude/agents", "~/.claude/commands", "~/.claude/CLAUDE.md"], project: ["CLAUDE.md"] },
  { id: "cursor", label: "Cursor", x: -2.4, y: -3.0, types: "sar", global: ["~/.cursor/skills", "~/.cursor/agents", "~/.cursor/rules"], project: [] },
  { id: "gemini-cli", label: "Gemini CLI", x: -7.2, y: 4.0, types: "c", global: ["~/.gemini/commands"], project: [] },
  { id: "antigravity", label: "Antigravity", x: -8.4, y: -0.6, types: "sacr", global: ["~/.gemini/config/skills"], project: [".agents/agents", ".agents/workflows", ".agents/rules"] },
  { id: "codex", label: "Codex", x: 3.8, y: 2.8, types: "sac", global: ["~/.codex/skills", "~/.codex/agents", "~/.codex/prompts"], project: [] },
  { id: "windsurf", label: "Windsurf", x: 1.2, y: 5.4, types: "sr", global: ["~/.codeium/windsurf/skills", "~/.windsurf/rules"], project: [] },
  { id: "cline", label: "Cline", x: 1.4, y: -4.4, types: "scr", global: ["~/Documents/Cline/Rules"], project: [".cline/skills", ".clinerules/workflows", ".clinerules"] },
  { id: "roo-code", label: "Roo Code", x: 4.8, y: -3.6, types: "r", global: ["~/.roo/rules"], project: [] },
  { id: "continue", label: "Continue", x: 9.2, y: 3.8, types: "cr", global: [], project: [".continue/prompts", ".continue/rules"] },
  { id: "opencode", label: "OpenCode", x: 7.2, y: -0.8, types: "sac", global: ["~/.config/opencode/skills", "~/.config/opencode/agents", "~/.config/opencode/commands"], project: [".opencode/skills", ".opencode/agents", ".opencode/commands"] },
  { id: "trae", label: "Trae", x: -11.0, y: 2.8, types: "sr", global: ["~/.trae/skills", "~/.trae/user_rules"], project: [".trae/skills", ".trae/rules"] },
  { id: "goose", label: "Goose", x: 10.6, y: -3.4, types: "s", global: ["~/.config/goose/skills"], project: [".goose/skills"] },
  { id: "hermes", label: "Hermes", x: -5.6, y: -5.0, types: "s", global: ["~/.hermes/skills"], project: [] },
  { id: "copilot", label: "GitHub Copilot", x: -2.6, y: 5.0, types: "scr", global: ["~/.copilot/skills"], project: [".github/prompts", ".github/instructions"] },
  { id: "pi", label: "Pi", x: 3.6, y: -0.6, types: "sr", global: ["~/.pi/agent/skills"], project: [".pi/skills", "AGENTS.md"] },
];
const LAKE = { id: "global", label: "Shared", x: -0.2, y: 0.4, global: ["~/.agents/skills"], project: [] };
const TRAILS = ["claude-code", "codex", "cursor", "opencode"]; // illustrative symlinks into the shared folder

for (const t of TOOLS) {
  t.folders = t.global.length + t.project.length;
  t.H = 0.8 + 0.5 * t.folders;
  t.S = 1.05 + 0.14 * t.folders;
}
LAKE.H = -1.7;
LAKE.S = 1.7;
const PEAKS = [...TOOLS, LAKE];

const PALETTES = [
  ["light", "Light", "Default"], ["dark", "Dark", "Default"],
  ["quiet-light", "Quiet Light", "VS Code"], ["solarized-light", "Solarized Light", "VS Code"],
  ["solarized-dark", "Solarized Dark", "VS Code"], ["monokai", "Monokai", "VS Code"],
  ["abyss", "Abyss", "VS Code"], ["kimbie-dark", "Kimbie Dark", "VS Code"],
  ["tomorrow-night-blue", "Tomorrow Night Blue", "VS Code"], ["red", "Red", "VS Code"],
  ["high-contrast", "High Contrast", "VS Code"], ["tokyo-night", "Tokyo Night", "Community"],
  ["aura", "Aura", "Community"], ["synthwave-84", "SynthWave '84", "Community"],
  ["panda", "Panda", "Community"], ["overnight", "Overnight", "Community"],
  ["horizon-morning", "Morning Horizon", "SAP Fiori Horizon"], ["horizon-evening", "Evening Horizon", "SAP Fiori Horizon"],
];

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const narrowQ = matchMedia("(max-width: 760px)");
const darkQ = matchMedia("(prefers-color-scheme: dark)");

// ─── The height field, in JS (mirrors the shader) ───
function hash(x, y) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function fract(v) { return v - Math.floor(v); }
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y) {
  let s = 0, a = 0.5;
  for (let i = 0; i < 3; i++) {
    s += a * vnoise(x, y);
    const nx = 1.6 * x - 1.2 * y, ny = 1.2 * x + 1.6 * y;
    x = nx; y = ny; a *= 0.5;
  }
  return s;
}
const state = { time: 0, ptr: { x: 0, y: 0, amt: 0, s: 1 } };
function height(x, y) {
  let h = 0;
  for (const k of PEAKS) {
    const dx = x - k.x, dy = y - k.y;
    h += k.H * Math.exp(-(dx * dx + dy * dy) / (2 * k.S * k.S));
  }
  h += 0.7 * (fbm(x * 0.32 + state.time * 0.012, y * 0.32 - state.time * 0.008) - 0.5);
  const px = x - state.ptr.x, py = y - state.ptr.y;
  h += state.ptr.amt * Math.exp(-(px * px + py * py) / (2 * state.ptr.s * state.ptr.s));
  return h;
}

// ─── Shader ───
const FRAG = `
uniform vec2 uRes; uniform vec2 uCenter; uniform float uScale; uniform float uDpr;
uniform float uTime; uniform vec4 uPtr; uniform vec4 uPeaks[16];
uniform vec4 uHatch; uniform vec4 uLine; uniform float uLineAmt; uniform vec3 uLake;
uniform vec3 uPaper, uTint, uContour, uIndex, uWater, uWaterLine, uGrid, uShade, uHatchC;
uniform float uIv; uniform float uDark;

float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1.,0.)), u.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), u.x), u.y); }
float fbm(vec2 p){ float s = 0., a = .5; for (int i = 0; i < 3; i++){ s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= .5; } return s; }
float height(vec2 p){
  float h = 0.;
  for (int i = 0; i < 16; i++){ vec4 k = uPeaks[i]; vec2 d = p - k.xy; h += k.z * exp(-dot(d,d) / (2.*k.w*k.w)); }
  h += 0.7 * (fbm(p * 0.32 + vec2(uTime * 0.012, -uTime * 0.008)) - 0.5);
  vec2 dp = p - uPtr.xy; h += uPtr.z * exp(-dot(dp,dp) / (2.*uPtr.w*uPtr.w));
  return h;
}
float lineAA(float v, float px){ float fw = max(fwidth(v), 1e-4); float d = abs(fract(v + .5) - .5) / fw; return 1. - smoothstep(px*.5, px*.5 + 1., d); }
float segDist(vec2 p, vec2 a, vec2 b){ vec2 pa = p-a, ba = b-a; float h = clamp(dot(pa,ba)/dot(ba,ba), 0., 1.); return length(pa - ba*h); }

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 p = uCenter + (frag - .5*uRes) * uScale;
  float h = height(p);
  vec3 n = normalize(vec3(-dFdx(h) / uScale, -dFdy(h) / uScale, 1.4));
  float shade = dot(n, normalize(vec3(-1., 1., 1.3)));

  vec3 col = mix(uPaper, uTint, clamp(h / 3.4, 0., 1.) * .55);
  col = mix(col, uShade, clamp(.62 - shade, 0., 1.) * (uDark > .5 ? .55 : .32));

  // lake: the shared ~/.agents/skills
  float ld = length(p - uLake.xy);
  float water = smoothstep(-.42, -.52, h) * (1. - smoothstep(2.6, 3.2, ld));
  col = mix(col, uWater, water * .85);

  // grid, every 2 map units
  vec2 g = abs(fract(p / 2. + .5) - .5) * 2. / uScale;
  float grid = 1. - smoothstep(.5*uDpr, 1.2*uDpr, min(g.x, g.y));
  col = mix(col, uGrid, grid * .14);

  // contours
  float v = h / uIv;
  float c1 = lineAA(v, 0.8 * uDpr);
  float c5 = lineAA(v / 5., 1.6 * uDpr);
  vec3 lc = mix(uContour, uWaterLine, water);
  col = mix(col, lc, c1 * (uDark > .5 ? .36 : .55));
  col = mix(col, mix(uIndex, uWaterLine, water), c5 * (uDark > .5 ? .6 : .72));

  // hatched region: .skillmanager-disabled/
  if (uHatch.w > .001) {
    float d = length(p - uHatch.xy);
    float inside = 1. - smoothstep(uHatch.z - uScale, uHatch.z + uScale, d);
    float s = abs(fract((frag.x + frag.y) / (7. * uDpr)) - .5) * 7. * uDpr;
    float hatch = 1. - smoothstep(.45 * uDpr, .45 * uDpr + 1., s);
    float ang = atan(p.y - uHatch.y, p.x - uHatch.x);
    float dash = step(.45, fract(ang * uHatch.z * 3.2));
    float ring = (1. - smoothstep(.6*uDpr, .6*uDpr + 1., abs(d - uHatch.z) / uScale)) * dash;
    col = mix(col, uHatchC, (hatch * inside * .5 + ring * .95) * uHatch.w);
  }
  // section line A–A'
  if (uLineAmt > .001) {
    float sd = segDist(p, uLine.xy, uLine.zw) / uScale;
    float t = dot(p - uLine.xy, uLine.zw - uLine.xy) / dot(uLine.zw - uLine.xy, uLine.zw - uLine.xy);
    float dash = step(.35, fract(t * 26.));
    float ln = (1. - smoothstep(.8*uDpr, .8*uDpr + 1., sd)) * dash;
    float ends = (1. - smoothstep(3.5*uDpr, 3.5*uDpr + 1., min(length(p - uLine.xy), length(p - uLine.zw)) / uScale));
    col = mix(col, uHatchC, max(ln, ends) * uLineAmt);
  }
  // paper grain
  col += (hash(frag * .731 + 17.) - .5) * (uDark > .5 ? .018 : .03);
  gl_FragColor = vec4(col, 1.);
}`;
const VERT = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0., 1.); }`;

function hexToRgb(s) {
  s = s.trim();
  if (s.startsWith("#")) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const m = s.match(/[\d.]+/g);
  return m ? m.slice(0, 3).map((v) => +v / 255) : [0.5, 0.5, 0.5];
}

// ─── Map setup ───
const canvas = document.getElementById("terrain");
let gl = null, prog = null, U = {};
function initGL() {
  const opts = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false };
  gl = canvas.getContext("webgl", opts);
  if (!gl) return false;
  if (!gl.getExtension("OES_standard_derivatives")) return false;
  const src = "#extension GL_OES_standard_derivatives : enable\nprecision highp float;\n" + FRAG;
  const vs = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(vs, VERT); gl.compileShader(vs);
  const fs = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(fs, src); gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(fs)); return false; }
  prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "aPos"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  for (const n of ["uRes", "uCenter", "uScale", "uDpr", "uTime", "uPtr", "uPeaks", "uHatch", "uLine", "uLineAmt", "uLake", "uPaper", "uTint", "uContour", "uIndex", "uWater", "uWaterLine", "uGrid", "uShade", "uHatchC", "uIv", "uDark"]) U[n] = gl.getUniformLocation(prog, n);
  const pk = new Float32Array(64);
  PEAKS.forEach((k, i) => pk.set([k.x, k.y, k.H, k.S], i * 4));
  gl.uniform4fv(U.uPeaks, pk);
  gl.uniform3f(U.uLake, LAKE.x, LAKE.y, 0);
  return true;
}

function applyColors() {
  const cs = getComputedStyle(root);
  const dark = isDark();
  root.setAttribute("data-appearance", dark ? "dark" : "light");
  document.querySelectorAll("source[data-dark]").forEach((s) => { s.media = dark ? "all" : "not all"; });
  if (!gl) return;
  const set = (u, v) => gl.uniform3fv(U[u], hexToRgb(cs.getPropertyValue(v)));
  set("uPaper", "--map-paper"); set("uTint", "--map-tint"); set("uContour", "--map-contour"); set("uIndex", "--map-index");
  set("uWater", "--map-water"); set("uWaterLine", "--map-water-line"); set("uGrid", "--map-grid"); set("uShade", "--map-shade"); set("uHatchC", "--map-hatch");
  gl.uniform1f(U.uDark, dark ? 1 : 0);
  dirty = true;
}
function isDark() {
  const t = root.getAttribute("data-theme");
  return t ? t === "dark" : darkQ.matches;
}

// ─── Camera, driven by the sections' data-view ───
const sections = [...document.querySelectorAll("[data-view]")];
const cam = { x: 0, y: 0, w: 26 };
const target = { x: 0, y: 0, w: 26, hatch: 0, line: 0, hx: 0, hy: 0, hr: 1, line4: [0, 0, 1, 1] };
let W = innerWidth, Hh = innerHeight, dpr = 1, dirty = true;

function parse(s) { return s ? s.trim().split(/\s+/).map(Number) : null; }
function viewOf(sec) {
  const v = parse(narrowQ.matches && sec.dataset.viewM ? sec.dataset.viewM : sec.dataset.view);
  return { x: v[0], y: v[1], w: v[2], hatch: parse(sec.dataset.hatch), line: parse(sec.dataset.line) };
}
function panelOffset() {
  // Keep the subject in the part of the screen the panels leave uncovered.
  if (narrowQ.matches) return 0;
  const colRight = Math.min(48 + 560, W * 0.5);
  return ((colRight + W) / 2 - W / 2);
}
function computeTarget() {
  const y = scrollY + Hh * 0.5;
  const anchors = sections.map((s) => s.offsetTop + Math.min(s.offsetHeight, Hh) * 0.35);
  let i = 0;
  while (i < anchors.length - 1 && y > anchors[i + 1]) i++;
  const a = viewOf(sections[i]), b = viewOf(sections[Math.min(i + 1, sections.length - 1)]);
  let t = anchors[i + 1] ? (y - anchors[i]) / (anchors[i + 1] - anchors[i]) : 0;
  t = Math.min(1, Math.max(0, t));
  t = t * t * (3 - 2 * t);
  if (y < anchors[0]) t = 0;
  const lw = Math.exp(Math.log(a.w) * (1 - t) + Math.log(b.w) * t);
  target.x = a.x + (b.x - a.x) * t;
  target.y = a.y + (b.y - a.y) * t;
  target.w = lw;
  const ha = a.hatch ? 1 - t : 0, hb = b.hatch ? t : 0;
  target.hatch = ha + hb;
  const hs = a.hatch || b.hatch;
  if (hs) { target.hx = hs[0]; target.hy = hs[1]; target.hr = hs[2]; }
  const la = a.line ? 1 - t : 0, lb = b.line ? t : 0;
  target.line = la + lb;
  const ls = a.line || b.line;
  if (ls) target.line4 = ls;
  // The hero is a special case: at the very top show the whole sheet.
}

// scale: map units per CSS px
function scaleCss() { return cam.w / Math.max(W, 1) * (narrowQ.matches ? 1 : 1); }
function camCenterX() { return cam.x - panelOffset() * scaleCss(); }
// On a phone the hero's map lives in the top third, above the headline.
function screenCy() {
  if (!narrowQ.matches) return Hh / 2;
  const t = Math.min(1, Math.max(0, scrollY / Hh));
  return Hh * (0.3 + 0.2 * t);
}
function camCenterY() { return cam.y + (screenCy() - Hh / 2) * scaleCss(); }
function project(x, y) {
  const s = scaleCss();
  return [W / 2 + (x - camCenterX()) / s, Hh / 2 - (y - camCenterY()) / s];
}
function unproject(sx, sy) {
  const s = scaleCss();
  return [camCenterX() + (sx - W / 2) * s, camCenterY() - (sy - Hh / 2) * s];
}

// ─── Labels & trails ───
const labelLayer = document.getElementById("labels");
const trailsSvg = document.getElementById("trails");
const typeClass = { s: "t-s", a: "t-a", c: "t-c", r: "t-r" };
const typeName = { s: "skill", a: "agent", c: "command", r: "rule" };
const labels = [];
function makeLabels() {
  const mk = (t, cls) => {
    const el = document.createElement("div");
    el.className = "lbl " + (cls || "");
    if (cls === "lake") {
      el.innerHTML = `<span class="lbl-name">~/.agents/skills</span><span class="lbl-meta">shared</span>`;
    } else if (cls === "hatchlbl") {
      el.innerHTML = `<span class="lbl-name">.skillmanager-disabled/</span>`;
    } else {
      const dots = [...t.types].map((c) => `<i class="${typeClass[c]}" title="${typeName[c]}"></i>`).join("");
      el.innerHTML = `<svg class="lbl-mark" viewBox="0 0 10 10"><path d="M5 0.5 9.5 9.5H0.5Z"/></svg><span class="lbl-name">${t.label}</span><span class="lbl-meta">${dots}<b>${t.folders}</b></span>`;
    }
    labelLayer.appendChild(el);
    const L = { el, t, cls, pri: cls === "lake" ? 99 : cls === "hatchlbl" ? 98 : t.folders + (t.id === "claude-code" ? 0.5 : 0), w: 0, h: 0, on: false };
    labels.push(L);
    return L;
  };
  mk(LAKE, "lake");
  mk({ x: 0, y: 0 }, "hatchlbl");
  TOOLS.forEach((t) => mk(t));
  labels.forEach((L) => { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; });
  labels.sort((a, b) => b.pri - a.pri);

  const ns = "http://www.w3.org/2000/svg";
  for (const id of TRAILS) {
    const p = document.createElementNS(ns, "path");
    p.dataset.id = id;
    trailsSvg.appendChild(p);
  }
  const g = document.createElementNS(ns, "g");
  g.id = "aa";
  g.innerHTML = `<text id="aa-a">A</text><text id="aa-b">A′</text>`;
  trailsSvg.appendChild(g);
}
const byId = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

let blockers = [];
function readBlockers() {
  blockers = [...document.querySelectorAll("[data-block], .topbar, .panel, .colophon-inner")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.bottom > 0 && r.top < Hh && r.width > 0);
}
function overlaps(a, b, pad) {
  return a.x < b.right + pad && a.x + a.w > b.left - pad && a.y < b.bottom + pad && a.y + a.h > b.top - pad;
}
function placeLabels() {
  const placed = [];
  for (const L of labels) {
    let x, y;
    if (L.cls === "hatchlbl") { [x, y] = project(target.hx, target.hy - target.hr); }
    else [x, y] = project(L.t.x, L.t.y);
    // The label hangs below the peak mark, centred.
    const bx = x - L.w / 2, by = L.cls === "lake" ? y - L.h / 2 : L.cls === "hatchlbl" ? y + 4 : y - 5;
    const box = { x: bx, y: by, w: L.w, h: L.h };
    let ok = bx > 14 && by > 64 && bx + L.w < W - 14 && by + L.h < Hh - 40;
    if (L.cls === "hatchlbl") ok = ok && cam.hatch > 0.5;
    if (ok) for (const r of blockers) if (overlaps(box, r, 6)) { ok = false; break; }
    if (ok) for (const b of placed) if (overlaps(box, { left: b.x, right: b.x + b.w, top: b.y, bottom: b.y + b.h }, 8)) { ok = false; break; }
    if (ok) placed.push(box);
    L.el.style.transform = `translate3d(${bx.toFixed(1)}px, ${by.toFixed(1)}px, 0)`;
    if (ok !== L.on) { L.on = ok; L.el.classList.toggle("on", ok); }
  }
  // trails: gentle curves from each peak's flank into the lake
  const [lx, ly] = project(LAKE.x, LAKE.y);
  for (const p of trailsSvg.querySelectorAll("path")) {
    const t = byId[p.dataset.id];
    const [tx, ty] = project(t.x + (LAKE.x - t.x) * 0.2, t.y + (LAKE.y - t.y) * 0.2);
    const ex = lx + (tx - lx) * 0.22, ey = ly + (ty - ly) * 0.22;
    const mx = (tx + ex) / 2 + (ty - ey) * 0.18, my = (ty + ey) / 2 - (tx - ex) * 0.18;
    p.setAttribute("d", `M${tx.toFixed(1)} ${ty.toFixed(1)}Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
  }
  const aa = document.getElementById("aa");
  aa.style.opacity = cam.line.toFixed(3);
  const [a1, a2] = project(target.line4[0], target.line4[1]);
  const [b1, b2] = project(target.line4[2], target.line4[3]);
  const A = document.getElementById("aa-a"), B = document.getElementById("aa-b");
  A.setAttribute("x", (a1 - 8).toFixed(1)); A.setAttribute("y", (a2 - 12).toFixed(1));
  B.setAttribute("x", (b1 - 4).toFixed(1)); B.setAttribute("y", (b2 - 14).toFixed(1));
}

// ─── HUD ───
const sbBar = document.getElementById("sb-bar");
const roGrid = document.getElementById("ro-grid"), roElev = document.getElementById("ro-elev"), roNear = document.getElementById("ro-near");
const reticle = document.getElementById("reticle");
const pointer = { sx: -1, sy: -1, over: false, fine: matchMedia("(pointer: fine)").matches };
function fmtGrid(x, y) {
  const e = Math.round((x + 20) * 100), n = Math.round((y + 20) * 100);
  return `E ${String(e).padStart(4, "0")}  N ${String(n).padStart(4, "0")}`;
}
function updateHud() {
  // one level of ../ = 2 map units
  const px = (3 * 2) / scaleCss();
  const w = Math.max(60, Math.min(px, 220));
  sbBar.style.width = w.toFixed(0) + "px";
  if (pointer.over) {
    const [x, y] = unproject(pointer.sx, pointer.sy);
    roGrid.textContent = fmtGrid(x, y);
    roElev.textContent = "elev " + height(x, y).toFixed(2);
    let best = null, bd = 1e9;
    for (const t of PEAKS) { const d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } }
    roNear.textContent = best === LAKE ? "~/.agents/skills" : best.global[0] || best.project[0];
  }
}

// ─── Ground truth demo ───
const tree = document.getElementById("tree");
const demo = { "pdf-extract": true, "shared-review": true };
let lastMoved = null;
function renderTree() {
  const rows = [];
  const on = Object.keys(demo).filter((k) => demo[k]);
  const off = Object.keys(demo).filter((k) => !demo[k]);
  const link = (d) => `<span class="link" style="padding-left:${d === 2 ? 4 : 8}ch">↳ ${"<b>../</b>".repeat(d)}.agents/skills/shared-review</span>`;
  const entries = on.map((k) => ({ k, depth: 0 }));
  const all = [...entries, { k: ".skillmanager-disabled/", folder: true }];
  all.forEach((e, i) => {
    const last = i === all.length - 1;
    if (e.folder) {
      rows.push(`<li><span class="br">${last ? "└── " : "├── "}</span><span class="nm dim">.skillmanager-disabled/</span>${off.length ? "" : '<span class="dim">(empty)</span>'}</li>`);
      off.forEach((k, j) => {
        const l2 = j === off.length - 1;
        rows.push(`<li class="dis ${k === lastMoved ? "moved" : ""}"><span class="br">    ${l2 ? "└── " : "├── "}</span><span class="nm">${k}${k === "shared-review" ? "" : "/"}</span>${k === "shared-review" ? link(3) : ""}</li>`);
      });
    } else {
      rows.push(`<li class="${e.k === lastMoved ? "moved" : ""}"><span class="br">${last ? "└── " : "├── "}</span><span class="nm">${e.k}${e.k === "shared-review" ? "" : "/"}</span>${e.k === "shared-review" ? link(2) : ""}</li>`);
    }
  });
  tree.innerHTML = rows.join("");
}
document.querySelectorAll(".switch").forEach((b) => {
  b.addEventListener("click", () => {
    const k = b.dataset.item;
    demo[k] = !demo[k];
    lastMoved = k;
    b.setAttribute("aria-checked", String(demo[k]));
    renderTree();
  });
});
renderTree();

// ─── Section profile A–A′ ───
const profile = document.getElementById("profile");
let profileVisible = false;
function initProfile() {
  profile.innerHTML = `
    <defs><pattern id="pf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v6" stroke="var(--map-contour)" stroke-width="1" opacity=".6"/></pattern></defs>
    <text class="cap" x="30" y="14">Carried every turn</text><text x="30" y="32">name + description</text>
    <path class="below" id="pf-below"/><path class="above" id="pf-above"/>
    <line class="datum" x1="30" x2="490" y1="92" y2="92"/>
    <line class="tick" x1="30" x2="30" y1="86" y2="98"/><line class="tick" x1="490" x2="490" y1="86" y2="98"/>
    <text class="aa" x="12" y="96">A</text><text class="aa" x="496" y="96">A′</text>
    <text class="cap" x="490" y="258" text-anchor="end">Loaded on invocation</text><text x="490" y="277" text-anchor="end">the body, once the item is used</text>`;
}
function updateProfile() {
  const [ax, ay, bx, by] = [-4.6, 1.6, 3.8, 2.8];
  const N = 90, x0 = 30, x1 = 490, datum = 92;
  let up = `M${x0} ${datum}`, dn = `M${x0} ${datum}`;
  for (let i = 0; i <= N; i++) {
    const t = i / N, h = Math.min(4, Math.max(0, height(ax + (bx - ax) * t, ay + (by - ay) * t) + 0.15));
    const x = x0 + (x1 - x0) * t;
    up += `L${x.toFixed(1)} ${(datum - h * 11).toFixed(1)}`;
    dn += `L${x.toFixed(1)} ${(datum + 10 + h * 33).toFixed(1)}`;
  }
  up += `L${x1} ${datum}Z`; dn += `L${x1} ${datum}Z`;
  document.getElementById("pf-above").setAttribute("d", up);
  document.getElementById("pf-below").setAttribute("d", dn);
}

// ─── Gazetteer & editions ───
function fillGazetteer() {
  const body = document.getElementById("gaz-body");
  const rows = [...TOOLS, { ...LAKE, types: "s", label: "Shared" }]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((t) => {
      const dots = [...t.types].map((c) => `<i class="${typeClass[c]}" title="${typeName[c]}"></i>`).join("");
      const list = (a) => (a.length ? a.map((p) => `<code>${p}</code>`).join("") : `<span class="none">—</span>`);
      const tn = [...t.types].map((c) => typeName[c]).join(", ");
      return `<tr><td>${t.label}</td><td class="grid">${fmtGrid(t.x, t.y).replace("  ", " ")}</td><td class="types"><span class="vh">${tn}</span><span aria-hidden="true">${dots}</span></td><td>${list(t.global)}</td><td>${list(t.project)}</td></tr>`;
    });
  body.innerHTML = rows.join("");
}
function fillSheets() {
  document.getElementById("sheets").innerHTML = PALETTES.map(([id, name, from]) =>
    `<li><figure><span class="frame"><img src="images/themes/${id}.png" width="760" height="480" loading="lazy" decoding="async" alt="The library in the ${name} palette" /></span><figcaption>${name}<small>${from}</small></figcaption></figure></li>`
  ).join("");
}
document.querySelectorAll("[data-ref]").forEach((el) => {
  const [x, y] = parse(el.dataset.ref);
  el.textContent = fmtGrid(x, y);
});

// ─── Install tabs & copy ───
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab, focus) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => selectTab(t));
  t.addEventListener("keydown", (e) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    if (e.key === "Home") { e.preventDefault(); selectTab(tabs[0], true); }
    if (e.key === "End") { e.preventDefault(); selectTab(tabs[tabs.length - 1], true); }
  });
});
if (/Win/.test(navigator.platform)) selectTab(document.getElementById("tab-win"));
else if (/Linux/.test(navigator.platform) && !/Android/.test(navigator.userAgent)) selectTab(document.getElementById("tab-linux"));
document.querySelectorAll(".copy").forEach((b) => {
  let timer;
  b.addEventListener("click", async () => {
    const text = b.parentElement.querySelector("code").textContent;
    try { await navigator.clipboard.writeText(text); } catch { return; }
    b.classList.add("done");
    b.setAttribute("aria-label", "Copied");
    clearTimeout(timer);
    timer = setTimeout(() => { b.classList.remove("done"); b.setAttribute("aria-label", "Copy command"); }, 1600);
  });
});

// ─── Edition toggle ───
const edBtn = document.getElementById("edition");
function syncEdBtn() {
  const d = isDark();
  edBtn.setAttribute("aria-label", d ? "Switch to the day edition" : "Switch to the night edition");
}
edBtn.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("topo-edition", next); } catch {}
  applyColors(); syncEdBtn();
});
darkQ.addEventListener("change", () => { applyColors(); syncEdBtn(); });

// ─── Loop ───
let raf = 0, last = performance.now(), hasGL = false, frame = 0;
function resize() {
  W = innerWidth; Hh = innerHeight;
  dpr = Math.min(devicePixelRatio || 1, 2);
  if (hasGL) {
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  labels.forEach((L) => { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; });
  dirty = true;
}
function tick(now) {
  raf = 0;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const still = reduced.matches;
  if (!still) state.time += dt;
  computeTarget();
  const k = still ? 1 : 1 - Math.exp(-dt * 3.2);
  cam.x += (target.x - cam.x) * k; cam.y += (target.y - cam.y) * k;
  cam.w = Math.exp(Math.log(cam.w) + (Math.log(target.w) - Math.log(cam.w)) * k);
  cam.hatch = (cam.hatch ?? 0) + (target.hatch - (cam.hatch ?? 0)) * k;
  cam.line = (cam.line ?? 0) + (target.line - (cam.line ?? 0)) * k;
  // pointer bump follows the pointer, eased; off over panels and when motion is reduced
  const [px, py] = unproject(pointer.sx, pointer.sy);
  const want = pointer.over && !still ? 0.75 : 0;
  state.ptr.x += (px - state.ptr.x) * (still ? 1 : 1 - Math.exp(-dt * 6));
  state.ptr.y += (py - state.ptr.y) * (still ? 1 : 1 - Math.exp(-dt * 6));
  state.ptr.amt += (want - state.ptr.amt) * (1 - Math.exp(-dt * 4));
  state.ptr.s = cam.w * 0.028;

  if (hasGL) {
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    const s = scaleCss() / dpr;
    gl.uniform2f(U.uCenter, camCenterX(), camCenterY());
    gl.uniform1f(U.uScale, s);
    gl.uniform1f(U.uDpr, dpr);
    gl.uniform1f(U.uTime, state.time);
    gl.uniform4f(U.uPtr, state.ptr.x, state.ptr.y, state.ptr.amt, state.ptr.s);
    gl.uniform4f(U.uHatch, target.hx, target.hy, target.hr, cam.hatch);
    gl.uniform4f(U.uLine, ...target.line4);
    gl.uniform1f(U.uLineAmt, cam.line);
    // A wider view gets a coarser interval, so the sheet never turns to mush.
    gl.uniform1f(U.uIv, 0.16);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  if (frame++ % 3 === 0) readBlockers();
  placeLabels();
  updateHud();
  if (pointer.over && pointer.fine) reticle.style.transform = `translate3d(${pointer.sx}px, ${pointer.sy}px, 0)`;
  if (profileVisible && frame % 2 === 0) updateProfile();

  const settling = Math.abs(target.x - cam.x) + Math.abs(target.y - cam.y) + Math.abs(target.w - cam.w) > 0.002 || Math.abs(target.hatch - cam.hatch) > 0.002 || Math.abs(target.line - cam.line) > 0.002 || state.ptr.amt > 0.001;
  dirty = false;
  if (!document.hidden && (!still || settling)) raf = requestAnimationFrame(tick);
}
function kick() { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } }

function start() {
  hasGL = !new URLSearchParams(location.search).has("nogl") && initGL();
  root.classList.add(hasGL ? "has-gl" : "no-gl");
  makeLabels();
  fillGazetteer(); fillSheets(); initProfile();
  applyColors(); syncEdBtn();
  resize();
  computeTarget();
  Object.assign(cam, { x: target.x, y: target.y, w: target.w, hatch: target.hatch, line: target.line });
  updateProfile();
  kick();

  addEventListener("resize", () => { resize(); kick(); });
  addEventListener("scroll", kick, { passive: true });
  narrowQ.addEventListener("change", () => { resize(); kick(); });
  reduced.addEventListener("change", kick);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) kick(); else if (raf) { cancelAnimationFrame(raf); raf = 0; } });
  addEventListener("pointermove", (e) => {
    pointer.sx = e.clientX; pointer.sy = e.clientY;
    const overMap = !e.target.closest(".panel, .topbar, .hero-copy, .titleblock, .colophon-inner, .hud");
    pointer.over = e.pointerType === "mouse" && overMap;
    document.querySelector(".readout").style.opacity = pointer.over ? "1" : "0";
    reticle.classList.toggle("on", pointer.over && pointer.fine);
    kick();
  }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer.over = false; reticle.classList.remove("on"); kick(); });
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); hasGL = false; root.classList.replace("has-gl", "no-gl"); });

  new IntersectionObserver((es) => { for (const e of es) profileVisible = e.isIntersecting; if (profileVisible) kick(); })
    .observe(document.getElementById("profile-fig"));
}
start();
