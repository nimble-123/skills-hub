/* skills-hub — "Liquid chrome".
 *
 * Sixteen droplets, one per tool, raymarched in a single fragment shader.
 * Scroll pours them into one mass; the disk demo pinches one back off.
 * No libraries: a full-screen triangle, one program, a few uniforms.
 */
(() => {
  "use strict";

  const root = document.documentElement;
  const reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reduceMQ.matches;

  const TOOLS = [
    "Claude Code", "Cursor", "Codex", "OpenCode",
    "Antigravity", "GitHub Copilot", "Cline", "Trae",
    "Windsurf", "Goose", "Hermes", "Pi",
    "Gemini CLI", "Roo Code", "Continue", "~/.agents/skills",
  ];
  const N = 16;
  const CAM_Z = 12;
  const HQ = /[?&]hq\b/.test(location.search);
  // Test hooks: ?hq pins full resolution, ?snap skips easing between poses.
  const SNAP = /[?&]snap\b/.test(location.search);

  /* ─────────────────────────── helpers ─────────────────────────── */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  /* ─────────────────────────── layouts ─────────────────────────── */

  // x, y, z, radius — one per entry in TOOLS.
  const DESK = [
    [-3.2, 1.45, 0.35, 0.3],
    [-4.35, 2.35, -0.3, 0.22],
    [-2.2, 2.45, -0.6, 0.21],
    [-1.25, 1.55, 0.15, 0.27],
    [-0.2, 2.5, -0.35, 0.22],
    [0.55, 1.35, 0.45, 0.24],
    [1.45, 2.3, -0.1, 0.29],
    [2.35, 1.2, 0.1, 0.21],
    [2.7, 2.55, -0.55, 0.23],
    [3.9, 1.6, 0.3, 0.28],
    [4.75, 2.5, -0.6, 0.19],
    [2.75, -0.15, 0.25, 0.27],
    [4.4, 0.3, -0.3, 0.22],
    [3.6, -1.3, 0.4, 0.3],
    [2.1, -2.15, -0.4, 0.21],
    [4.65, -2.3, 0.05, 0.25],
  ];

  const PHONE = [
    [-1.05, 2.5, 0.2, 0.19],
    [-0.3, 2.62, -0.3, 0.14],
    [0.45, 2.45, 0.15, 0.2],
    [1.15, 2.6, -0.4, 0.14],
    [-0.75, 1.95, -0.2, 0.16],
    [0.05, 1.92, 0.3, 0.2],
    [0.82, 2.0, -0.1, 0.15],
    [-1.25, 1.55, 0.1, 0.13],
    [1.25, 1.5, 0.25, 0.18],
    [-0.4, 1.38, 0.05, 0.15],
    [0.42, 1.35, -0.3, 0.16],
    [-1.0, 0.98, -0.2, 0.17],
    [-0.1, 0.85, 0.35, 0.13],
    [0.72, 0.92, 0.0, 0.18],
    [1.3, 1.02, -0.5, 0.12],
    [-0.62, 0.62, -0.4, 0.12],
  ];

  // Split layouts, in world units at z≈0 (camera at z=12, focal 1.8, so the
  // visible half-height is 3.33). Four staggered rows; the headline owns the
  // bottom of the viewport, so the droplets own the top.
  function splitLayout(aspect, portrait) {
    const out = [];
    const halfW = 3.33 * aspect;
    if (portrait) {
      // A phone gets its own arrangement: four loose rows above the headline,
      // smaller drops, and no labels — there is no room to name them.
      const fx = Math.min(halfW / 1.54, 1.3);
      for (const d of PHONE) out.push([d[0] * fx, d[1], d[2], d[3]]);
    } else {
      // Laid out by hand for a 16:10 viewport: a band across the top, and a
      // column falling down the right of the headline. Scaled for others.
      const fx = Math.min(halfW / 5.33, 1.25);
      for (const d of DESK) out.push([d[0] * fx, d[1], d[2], d[3]]);
    }
    return out;
  }

  // A tight cluster the droplets pour into — offsets on a Fibonacci sphere.
  const CLUSTER = Array.from({ length: N }, (_, i) => {
    const y = 1 - (i / (N - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    return [Math.cos(th) * rad, y, Math.sin(th) * rad];
  });

  // Poses the page scrolls between. x/y: where the mass sits; s: scale;
  // spread: 1 = sixteen droplets, 0 = one mass; o: canvas opacity.
  // spread: 1 = sixteen droplets, 0 = one mass; x/y: where the mass sits;
  // s: scale; o: canvas opacity; l: tool labels; dx/dy: where a switched-off
  // droplet goes. Every pose keeps the metal out from under running text.
  const P = (spread, x, y, s, o = 1, l = 0, dx = 2.1, dy = 0.2, tl = 0, pin = 0) => ({ spread, x, y, s, o, l, dx, dy, tl, pin });
  const POSES = {
    desk: {
      hero: P(1, 0, 0, 1, 1, 1),
      merge: P(0, -3.0, 0.15, 1.5),
      "edge-r": P(0, 6.25, 0.3, 1.7, 0.95),
      "edge-l": P(0, -6.25, -0.2, 1.7, 0.95),
      detach: P(0, -3.35, -1.75, 0.95, 1, 0, 2.3, 0.35),
      tiles: P(1, 0, 0, 1, 1, 0, 0, 0, 1),
      finale: P(0, 0, 1.75, 1.05, 1, 0, 2.1, 0.2, 0, 1),
    },
    phone: {
      hero: P(1, 0, 0, 1),
      merge: P(0, 0, 1.95, 0.72, 1, 0, 2.1, 0.2, 0, 1),
      "edge-r": P(0, 2.2, -2.7, 1.05, 0.8),
      "edge-l": P(0, -2.2, -2.7, 1.05, 0.8),
      detach: P(0, 2.2, -2.7, 1.05, 1, 0, -1.4, 0.55),
      tiles: P(1, 0, 0, 1, 1, 0, 0, 0, 1),
      finale: P(0, 0, 1.9, 0.9, 1, 0, 2.1, 0.2, 0, 1),
    },
  };
  const KEYS = ["spread", "x", "y", "s", "o", "l", "dx", "dy", "tl", "pin"];

  /* ─────────────────────────── state ─────────────────────────── */

  const state = {
    w: 1,
    h: 1,
    portrait: false,
    split: [],
    target: { ...P(1, 0, 0, 1, 1, 1), detach: 0 },
    cur: { ...P(1, 0, 0, 1, 1, 1), detach: 0 },
    ptr: [0, 0],
    ptrCur: [0, 0],
    ptrActive: 0,
    demoDetach: 0,
    t: 0,
  };
  const drops = new Float32Array(N * 4);
  const bound = new Float32Array(4);

  /* ─────────────────────────── scroll → pose ─────────────────────────── */

  let anchors = [];
  function measureAnchors() {
    const set = state.portrait ? POSES.phone : POSES.desk;
    anchors = [...document.querySelectorAll("[data-pose]")]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const top = rect.top + window.scrollY;
        const pose = set[el.dataset.pose] || set["edge-r"];
        // A pose with `pin` hangs the mass a set distance above this element
        // and lets it scroll with it.
        const pinEl = el.querySelector("[data-pin]");
        if (el.id === "top") return [{ at: 0, pose, pinEl }];
        if (el.classList.contains("merge-sticky")) {
          // Held for as long as the stage is pinned.
          const stage = el.parentElement.getBoundingClientRect();
          const start = stage.top + window.scrollY;
          return [
            { at: start + window.innerHeight * 0.45, pose, pinEl },
            { at: start + stage.height - window.innerHeight, pose, pinEl },
          ];
        }
        // Arrived when the section's middle meets the viewport's middle (or
        // its top reaches the top, for sections taller than the screen).
        const mid = top + Math.min(rect.height, window.innerHeight) / 2 - window.innerHeight / 2;
        return [{ at: mid, pose, pinEl }];
      })
      .flat()
      .sort((a, b) => a.at - b.at);
  }

  // Each pose holds until the next section is near, then pours into the next
  // over at most six tenths of a screen.
  function poseAt(y) {
    if (!anchors.length) return state.target;
    if (y <= anchors[0].at) return { ...anchors[0].pose, pinEl: anchors[0].pinEl };
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i];
      const b = anchors[i + 1];
      if (y < b.at) {
        const span = Math.min(window.innerHeight * 0.6, (b.at - a.at) * 0.65);
        const t = smooth(clamp((y - (b.at - span)) / Math.max(1, span), 0, 1));
        const out = {};
        for (const k of KEYS) out[k] = lerp(a.pose[k], b.pose[k], t);
        out.pinEl = (a.pose.pin > b.pose.pin ? a : b).pinEl;
        return out;
      }
    }
    const last = anchors[anchors.length - 1];
    return { ...last.pose, pinEl: last.pinEl };
  }

  function onScroll() {
    const { pinEl, ...p } = poseAt(window.scrollY);
    Object.assign(state.target, p);
    state.pinEl = pinEl || null;
    // The disk demo pinches a droplet off only while it is on screen.
    const demo = document.getElementById("disk-demo");
    let near = 0;
    if (demo) {
      const r = demo.getBoundingClientRect();
      near = r.bottom > 0 && r.top < window.innerHeight ? 1 : 0;
    }
    state.target.detach = near * state.demoDetach;
    kick();
  }

  /* ─────────────────────────── droplet positions ─────────────────────────── */

  // In the tools section each droplet settles into its own tile.
  const tiles = [...document.querySelectorAll("#tool-grid li")];
  const tilePos = Array.from({ length: N }, () => [0, 0, 0, 0]);
  function measureTiles() {
    const K = (1.8 / CAM_Z) * state.h;
    tiles.forEach((li, i) => {
      if (i >= N) return;
      const r = li.getBoundingClientRect();
      const inset = state.portrait ? 28 : 46;
      const px = r.right - inset;
      const py = state.portrait ? r.top + 38 : r.top + r.height / 2;
      tilePos[i][0] = (px - state.w / 2) / K;
      tilePos[i][1] = (state.h / 2 - py) / K;
      tilePos[i][2] = 0;
      tilePos[i][3] = state.portrait ? 0.12 : 0.2;
    });
  }

  // At the end the last drop hangs above the install heading and scrolls
  // with it, rather than floating over the footer.
  function pinnedY() {
    const el = state.pinEl;
    if (!el) return state.cur.y;
    const K = (1.8 / CAM_Z) * state.h;
    const [desk, phone] = (el.dataset.pin || "190,150").split(",").map(Number);
    const gap = state.portrait ? phone : desk;
    return (state.h / 2 - (el.getBoundingClientRect().top - gap)) / K;
  }

  function computeDrops(time) {
    const tl = state.cur.tl;
    if (tl > 0.001) measureTiles();
    const baseY = state.cur.pin > 0.001 ? lerp(state.cur.y, pinnedY(), state.cur.pin) : state.cur.y;
    const c = state.cur;
    const halfH = 3.33;
    const aspect = state.w / state.h;
    const ptrWorld = [state.ptrCur[0] * halfH * aspect, state.ptrCur[1] * halfH];
    const mergedR = 0.4;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < N; i++) {
      const sp = state.split[i];
      // Stagger the merge: droplets leave in order, so it reads as pouring.
      const lag = (i / (N - 1)) * 0.35;
      const e = smooth(clamp((c.spread - lag) / (1 - lag + 1e-3) * 1.0, 0, 1));
      const spread = reduced ? c.spread : e * 0.6 + c.spread * 0.4;

      const wob = reduced ? 0 : 1 - tl * 0.8;
      const tp = tilePos[i];
      const sx = lerp(sp[0], tp[0], tl) + Math.sin(time * 0.5 + i * 1.7) * 0.12 * wob;
      const sy = lerp(sp[1], tp[1], tl) + Math.cos(time * 0.43 + i * 2.3) * 0.1 * wob;
      const sz = lerp(sp[2], tp[2], tl) + Math.sin(time * 0.37 + i) * 0.2 * wob;

      const rot = time * 0.35 * wob;
      const cl = CLUSTER[i];
      const breath = 0.6 + 0.07 * Math.sin(time * 0.9 + i * 0.7) * wob;
      let mx = (cl[0] * Math.cos(rot) - cl[2] * Math.sin(rot)) * breath;
      const my = cl[1] * breath * 0.9;
      let mz = (cl[0] * Math.sin(rot) + cl[2] * Math.cos(rot)) * breath;

      // Droplet 0 is the one the disk demo switches off.
      let mr = mergedR;
      if (i === 0 && c.detach > 0.001) {
        const d = c.detach;
        mx = lerp(mx, c.dx / c.s, d);
        mz = lerp(mz, 0.2, d);
        mr = lerp(mergedR, 0.3, d);
      }

      let x = lerp(mx * c.s + c.x, sx, spread);
      let y = lerp(my * c.s + baseY + (i === 0 ? c.dy * c.detach : 0), sy, spread);
      const z = lerp(mz * c.s, sz, spread);
      const r = lerp(mr * c.s, lerp(sp[3], tilePos[i][3], tl), spread);

      // Pointer: droplets lean away from it, like mercury under a fingertip.
      if (state.ptrActive > 0.001) {
        const dx = x - ptrWorld[0];
        const dy = y - ptrWorld[1];
        const d2 = dx * dx + dy * dy;
        const f = Math.exp(-d2 * 0.9) * 0.45 * state.ptrActive * (0.4 + 0.6 * spread);
        const len = Math.sqrt(d2) + 1e-4;
        x += (dx / len) * f;
        y += (dy / len) * f;
      }

      drops[i * 4] = x;
      drops[i * 4 + 1] = y;
      drops[i * 4 + 2] = z;
      drops[i * 4 + 3] = r;
      cx += x;
      cy += y;
      cz += z;
    }
    cx /= N;
    cy /= N;
    cz /= N;
    let rad = 0;
    for (let i = 0; i < N; i++) {
      const dx = drops[i * 4] - cx;
      const dy = drops[i * 4 + 1] - cy;
      const dz = drops[i * 4 + 2] - cz;
      rad = Math.max(rad, Math.sqrt(dx * dx + dy * dy + dz * dz) + drops[i * 4 + 3]);
    }
    bound[0] = cx;
    bound[1] = cy;
    bound[2] = cz;
    bound[3] = rad + 0.25;
  }

  /* ─────────────────────────── labels ─────────────────────────── */

  const labelHost = document.getElementById("drop-labels");
  const labels = TOOLS.map((name) => {
    const el = document.createElement("span");
    el.className = "drop-label";
    el.textContent = name;
    el.style.opacity = "0";
    labelHost.appendChild(el);
    return el;
  });
  let labelsShown = false;

  function placeLabels() {
    const show = !state.portrait && state.cur.spread > 0.55 && state.cur.l > 0.05 && hasGL;
    const alpha = show ? clamp((state.cur.spread - 0.55) / 0.35, 0, 1) * state.cur.l : 0;
    if (!show && !labelsShown) return;
    labelsShown = alpha > 0;
    const H = state.h;
    const W = state.w;
    for (let i = 0; i < N; i++) {
      const x = drops[i * 4];
      const y = drops[i * 4 + 1];
      const z = drops[i * 4 + 2];
      const r = drops[i * 4 + 3];
      const k = 1.8 / (CAM_Z - z);
      const el = labels[i];
      if (!el._w) el._w = el.offsetWidth;
      let px = W / 2 + (x + r * 0.95) * k * H;
      const py = H / 2 - y * k * H;
      // Near the right edge, the label goes on the droplet's other side.
      const flip = px + el._w > W - 12;
      if (flip) px = W / 2 + (x - r * 0.95) * k * H - el._w;
      el.classList.toggle("flip", flip);
      el.style.transform = `translate3d(${px.toFixed(1)}px, ${(py - 6).toFixed(1)}px, 0)`;
      el.style.opacity = (alpha * (0.55 + 0.45 * clamp((z + 1) / 2, 0, 1))).toFixed(3);
    }
  }

  /* ─────────────────────────── WebGL ─────────────────────────── */

  const canvas = document.getElementById("liquid");
  let gl = null;
  let hasGL = false;
  let prog = null;
  let U = {};

  const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;

  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uD[16];
uniform float uK;
uniform vec4 uBound;
uniform vec2 uPtr;
uniform float uQuality;

const vec3 SKILL = vec3(0.725, 0.651, 1.0);
const vec3 AGENT = vec3(0.392, 0.839, 0.761);
const vec3 CMD   = vec3(0.878, 0.690, 0.439);
const vec3 RULE  = vec3(0.941, 0.604, 0.678);

float smin(float a, float b, float k){
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float map(vec3 p){
  float d = 1e5;
  for (int i = 0; i < 16; i++){
    vec4 s = uD[i];
    d = smin(d, length(p - s.xyz) - s.w, uK);
  }
  // a slow liquid ripple over the surface
  d += 0.014 * sin(p.x * 5.0 + uTime * 1.3) * sin(p.y * 5.3 - uTime * 1.1) * sin(p.z * 4.7 + uTime * 0.9);
  return d;
}

vec3 calcNormal(vec3 p){
  const vec2 e = vec2(1.0, -1.0) * 0.0015;
  return normalize(
    e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) +
    e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}

float lobe(vec3 r, vec3 d, float sharp){ return pow(max(dot(r, normalize(d)), 0.0), sharp); }

// A photographic studio, the only thing chrome ever shows: a bright sky, a
// hard horizon, a dark floor, and soft boxes in the app's four type colours.
float panel(vec2 q, vec2 c, vec2 h){
  vec2 d = abs(q - c) - h;
  return 1.0 - smoothstep(-0.02, 0.06, max(d.x, d.y));
}
vec3 env(vec3 r){
  float el = asin(clamp(r.y, -1.0, 1.0)) + uPtr.y * 0.06;
  float az = atan(r.x, r.z) + uPtr.x * 0.55 + uTime * 0.05;
  az = mod(az + 3.14159, 6.28318) - 3.14159;
  vec2 q = vec2(az, el);
  vec3 sky = mix(vec3(0.34, 0.35, 0.4), vec3(0.95, 0.96, 1.0), smoothstep(0.02, 0.9, el));
  vec3 ground = mix(vec3(0.03, 0.03, 0.04), vec3(0.16, 0.165, 0.19), smoothstep(-0.25, -1.3, el));
  vec3 col = el > 0.0 ? sky : ground;
  col += vec3(1.0) * (1.0 - smoothstep(0.0, 0.03, abs(el - 0.015))) * 1.1;
  col += SKILL * 2.4 * panel(q, vec2(-1.05, 0.42), vec2(0.34, 0.26));
  col += AGENT * 2.2 * panel(q, vec2(1.25, 0.22), vec2(0.28, 0.34));
  col += CMD   * 2.0 * panel(q, vec2(0.35, -0.42), vec2(0.62, 0.09));
  col += RULE  * 2.3 * panel(q, vec2(-2.2, 0.12), vec2(0.36, 0.3));
  col += vec3(1.0) * 3.0 * panel(q, vec2(2.55, 0.85), vec2(0.7, 0.16));
  col += vec3(1.0) * 1.6 * panel(q, vec2(0.0, 1.25), vec2(3.2, 0.12));
  col += vec3(0.8, 0.84, 0.95) * 0.9 * panel(q, vec2(0.0, 0.3), vec2(0.5, 0.1));
  return col;
}

vec3 iris(float t){ return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, 12.0);
  vec3 rd = normalize(vec3(uv, -1.8));

  vec3 oc = ro - uBound.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - uBound.w * uBound.w;
  float h = b * b - c;
  if (h < 0.0) { gl_FragColor = vec4(0.0); return; }
  h = sqrt(h);
  float t = max(-b - h, 0.0);
  float tmax = -b + h;

  float fp = 1.0 / (1.8 * uRes.y);
  float md = 1e5;
  float mt = t;
  bool hit = false;
  for (int i = 0; i < 90; i++){
    if (float(i) > uQuality) break;
    vec3 p = ro + rd * t;
    float d = map(p);
    float rel = d / (t * fp);
    if (rel < md) { md = rel; mt = t; }
    if (d < 0.0008 * t) { hit = true; break; }
    t += d * 0.92;
    if (t > tmax) break;
  }
  float alpha = hit ? 1.0 : 1.0 - smoothstep(0.0, 1.6, md);
  if (alpha <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float ts = hit ? t : mt;
  vec3 p = ro + rd * ts;
  vec3 n = calcNormal(p);
  vec3 r = reflect(rd, n);
  float ndv = clamp(dot(n, -rd), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 4.0);

  vec3 refl = env(r);
  vec3 film = iris(ndv * 1.25 + p.y * 0.12 + 0.15);
  vec3 base = mix(vec3(0.86, 0.87, 0.9), film, 0.16);
  vec3 col = refl * mix(base, vec3(1.0), fr);
  // a thin iridescent rim, the Y2K tell
  col += film * pow(1.0 - ndv, 3.0) * 0.28;
  // contact darkening where droplets meet
  float cav = clamp(map(p + n * 0.12) / 0.12, 0.0, 1.0);
  col *= mix(0.55, 1.0, cav);

  col = col / (1.0 + col * 0.35);
  col = pow(col, vec3(0.92));
  gl_FragColor = vec4(col * alpha, alpha);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
    }
    return s;
  }

  function initGL() {
    try {
      gl = canvas.getContext("webgl", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: "high-performance",
      });
      if (!gl) return false;
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "aPos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ["uRes", "uTime", "uD", "uK", "uBound", "uPtr", "uQuality"]) {
        U[n] = gl.getUniformLocation(prog, n);
      }
      canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        hasGL = false;
        root.classList.remove("has-gl");
        root.classList.add("no-gl");
      });
      return true;
    } catch (err) {
      gl = null;
      return false;
    }
  }

  // Render scale adapts to how long frames take: sharp where the GPU can
  // afford it, softer where it cannot. Never above a DPR of 2.
  let quality = 1;
  let frameTimes = [];
  function resize() {
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    state.portrait = state.w / state.h < 0.8 || state.w < 720;
    state.split = splitLayout(state.w / state.h, state.portrait);
    if (hasGL) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // Full resolution at DPR 1; three quarters of it on a retina screen.
      const scale = dpr * (dpr > 1.5 ? 0.75 : 1) * quality;
      canvas.width = Math.max(1, Math.round(state.w * scale));
      canvas.height = Math.max(1, Math.round(state.h * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    measureAnchors();
    onScroll();
  }

  /* ─────────────────────────── loop ─────────────────────────── */

  let raf = 0;
  let last = performance.now();
  let settleFrames = 0;
  let running = false;

  function kick() {
    settleFrames = 90;
    if (!running && !document.hidden) {
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!reduced) state.t += dt;

    // Ease toward the target pose — critically damped, so it never overshoots.
    const k = reduced || SNAP ? 1 : 1 - Math.exp(-dt * 4.2);
    const c = state.cur;
    const tg = state.target;
    let moving = 0;
    for (const key of [...KEYS, "detach"]) {
      const kk = key === "detach" && !SNAP ? (reduced ? 1 : 1 - Math.exp(-dt * 3)) : k;
      const d = tg[key] - c[key];
      c[key] += d * kk;
      moving += Math.abs(d);
    }
    const pk = 1 - Math.exp(-dt * 6);
    state.ptrCur[0] += (state.ptr[0] - state.ptrCur[0]) * pk;
    state.ptrCur[1] += (state.ptr[1] - state.ptrCur[1]) * pk;

    computeDrops(state.t);
    placeLabels();

    if (hasGL) {
      root.style.setProperty("--gl-opacity", c.o.toFixed(3));
      const spread = c.spread;
      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uTime, state.t);
      gl.uniform4fv(U.uD, drops);
      gl.uniform1f(U.uK, Math.max(0.08, lerp(0.42 * c.s, state.portrait ? 0.12 : 0.16, spread)));
      gl.uniform4fv(U.uBound, bound);
      gl.uniform2f(U.uPtr, state.ptrCur[0], state.ptrCur[1]);
      gl.uniform1f(U.uQuality, state.portrait ? 56 : 80);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Adaptive resolution from the first second of frames.
      if (!reduced && !HQ && frameTimes.length < 40) {
        frameTimes.push(dt);
        if (frameTimes.length === 40) {
          const avg = frameTimes.slice(10).reduce((a, b) => a + b, 0) / 30;
          if (avg > 0.028 && quality > 0.6) {
            quality = avg > 0.045 ? 0.55 : 0.75;
            resize();
          }
        }
      }
    }

    const keepGoing = !reduced || moving > 0.002 || settleFrames-- > 0;
    if (keepGoing && !document.hidden) {
      raf = requestAnimationFrame(frame);
    } else {
      running = false;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      running = false;
    } else {
      kick();
    }
  });

  reduceMQ.addEventListener?.("change", (e) => {
    reduced = e.matches;
    kick();
  });

  window.addEventListener(
    "pointermove",
    (e) => {
      if (reduced || e.pointerType === "touch") return;
      state.ptr[0] = (e.clientX / state.w) * 2 - 1;
      state.ptr[1] = -((e.clientY / state.h) * 2 - 1);
      state.ptrActive = 1;
      kick();
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    state.ptrActive = 0;
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  });
  window.addEventListener("load", () => {
    measureAnchors();
    onScroll();
  });

  hasGL = !/[?&]gl=0\b/.test(location.search) && initGL();
  root.classList.add(hasGL ? "has-gl" : "no-gl");
  resize();
  // Start already poured into the right pose rather than sweeping in.
  Object.assign(state.cur, state.target);
  kick();

  /* ─────────────────────────── fallback droplets ─────────────────────────── */

  if (!hasGL) {
    const spans = document.querySelectorAll(".fallback-drops span");
    const lay = splitLayout(state.w / state.h, state.portrait);
    spans.forEach((sp, i) => {
      const [x, y, z, r] = lay[i];
      const k = 1.8 / (CAM_Z - z);
      const size = r * 2 * k * state.h;
      sp.style.width = sp.style.height = `${size.toFixed(0)}px`;
      sp.style.left = `${(state.w / 2 + x * k * state.h - size / 2).toFixed(0)}px`;
      sp.style.top = `${(state.h / 2 - y * k * state.h - size / 2).toFixed(0)}px`;
    });
  }

  /* ─────────────────────────── disk demo ─────────────────────────── */

  const ITEMS = [
    { id: "pdf-extract", type: "skill", on: true },
    { id: "review-sql", type: "skill", on: true, link: ".agents/skills/review-sql" },
    { id: "release-notes", type: "skill", on: true },
  ];
  const tree = document.getElementById("tree");
  const log = document.getElementById("disk-log");
  const status = document.getElementById("disk-status");
  const colour = { skill: "var(--skill)" };

  function linkText(item) {
    // ~/.claude/skills/<id> is two below ~; the disabled folder adds a level.
    const ups = item.on ? 2 : 3;
    const prefix = "../".repeat(ups);
    return `→ <b>${prefix}</b>${item.link}`;
  }

  function renderTree(animate) {
    const before = new Map();
    if (animate && !reduced) {
      tree.querySelectorAll("li[data-id]").forEach((li) => before.set(li.dataset.id, li.getBoundingClientRect()));
    }
    const on = ITEMS.filter((i) => i.on);
    const off = ITEMS.filter((i) => !i.on);
    const row = (item) => `
      <li class="row${item.on ? "" : " off inside"}" data-id="${item.id}" style="--c:${colour[item.type]}">
        <span class="glyph" aria-hidden="true"></span>
        <span class="meta">
          <span class="name">${item.id}${item.link ? "" : "/"}</span>
          ${item.link ? `<span class="link">${linkText(item)}</span>` : ""}
        </span>
        <button class="switch" type="button" role="switch" data-item="${item.id}"
          aria-checked="${item.on}" aria-label="${item.id} enabled"></button>
      </li>`;
    tree.innerHTML = `${on.map(row).join("")}
      <li class="folder" data-id="__disabled">
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 6.75a1.5 1.5 0 0 1 1.5-1.5h4.1l2 2.25h7.4a1.5 1.5 0 0 1 1.5 1.5v8.25a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        .skillmanager-disabled/${off.length ? "" : " <span>(empty)</span>"}
      </li>
      ${off.map(row).join("")}`;
    status.textContent = `${on.length} enabled · ${off.length} disabled`;

    if (before.size) {
      tree.querySelectorAll("li[data-id]").forEach((li) => {
        const prev = before.get(li.dataset.id);
        if (!prev) return;
        const now = li.getBoundingClientRect();
        const dx = prev.left - now.left;
        const dy = prev.top - now.top;
        if (!dx && !dy) return;
        li.style.transition = "none";
        li.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => {
          li.style.transition = "transform 420ms cubic-bezier(0.22, 1, 0.36, 1), background-color 150ms ease-out";
          li.style.transform = "";
        });
      });
    }
  }

  if (tree) {
    renderTree(false);
    tree.addEventListener("click", (e) => {
      const btn = e.target.closest(".switch");
      if (!btn) return;
      const item = ITEMS.find((i) => i.id === btn.dataset.item);
      if (!item) return;
      item.on = !item.on;
      const from = item.on ? `.skillmanager-disabled/${item.id}` : item.id;
      const to = item.on ? item.id : `.skillmanager-disabled/${item.id}`;
      let msg = `<b>moved</b> ~/.claude/skills/${from} → ~/.claude/skills/${to}`;
      if (item.link) msg += ` · link rewritten to ${"../".repeat(item.on ? 2 : 3)}${item.link}`;
      log.innerHTML = `<code>${msg}</code>`;
      renderTree(true);
      const focusBtn = tree.querySelector(`.switch[data-item="${item.id}"]`);
      focusBtn?.focus({ preventScroll: true });
      state.demoDetach = ITEMS.some((i) => !i.on) ? 1 : 0;
      onScroll();
    });
  }

  /* ─────────────────────────── copy buttons ─────────────────────────── */

  document.querySelectorAll(".cmd").forEach((cmd) => {
    const btn = cmd.querySelector(".copy");
    if (!btn) return;
    let timer = 0;
    btn.addEventListener("click", async () => {
      const text = cmd.dataset.copy || "";
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const range = document.createRange();
        range.selectNodeContents(cmd.querySelector("code"));
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      btn.classList.add("done");
      const label = btn.getAttribute("aria-label") || "";
      btn.setAttribute("aria-label", "Copied");
      clearTimeout(timer);
      timer = setTimeout(() => {
        btn.classList.remove("done");
        btn.setAttribute("aria-label", label);
      }, 1600);
    });
  });

  /* ─────────────────────────── install tabs ─────────────────────────── */

  const tabs = [...document.querySelectorAll('.tabs [role="tab"]')];
  function selectTab(tab, focus) {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => selectTab(tab, false));
    tab.addEventListener("keydown", (e) => {
      let j = -1;
      if (e.key === "ArrowRight") j = (i + 1) % tabs.length;
      if (e.key === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = tabs.length - 1;
      if (j >= 0) {
        e.preventDefault();
        selectTab(tabs[j], true);
      }
    });
  });
  // Windows visitors land on their own tab.
  if (/Windows/i.test(navigator.userAgent)) selectTab(tabs[1], false);
  else if (/Linux/i.test(navigator.userAgent) && !/Android/i.test(navigator.userAgent)) selectTab(tabs[2], false);

  /* ─────────────────────────── palettes ─────────────────────────── */

  const PALETTES = [
    ["dark", "Dark", "#1e1f22", "#7c8cff"],
    ["light", "Light", "#ffffff", "#5b6ef5"],
    ["solarized-dark", "Solarized Dark", "#002b36", "#268bd2"],
    ["solarized-light", "Solarized Light", "#fdf6e3", "#268bd2"],
    ["monokai", "Monokai", "#272822", "#66d9ef"],
    ["quiet-light", "Quiet Light", "#f5f5f5", "#4b69c6"],
    ["abyss", "Abyss", "#000c18", "#6688cc"],
    ["kimbie-dark", "Kimbie Dark", "#221a0f", "#f79a32"],
    ["tomorrow-night-blue", "Tomorrow Night Blue", "#002451", "#bbdaff"],
    ["red", "Red", "#390000", "#fb9a4b"],
    ["high-contrast", "High Contrast", "#000000", "#6fc3df"],
    ["tokyo-night", "Tokyo Night", "#1a1b26", "#7aa2f7"],
    ["aura", "Aura", "#15141b", "#a277ff"],
    ["synthwave-84", "SynthWave '84", "#262335", "#ff7edb"],
    ["panda", "Panda", "#292a2b", "#19f9d8"],
    ["overnight", "Overnight", "#011627", "#82aaff"],
    ["horizon-morning", "Horizon Morning", "#ffffff", "#0070f2"],
    ["horizon-evening", "Horizon Evening", "#1d232a", "#1b90ff"],
  ];
  const picker = document.getElementById("palette-picker");
  const palImg = document.getElementById("pal-img");
  const palCap = document.getElementById("pal-cap");
  if (picker && palImg) {
    picker.innerHTML = PALETTES.map(
      ([id, name, a, b], i) =>
        `<button class="swatch" type="button" data-id="${id}" aria-pressed="${i === 0}" aria-label="${name}" title="${name}" style="--a:${a};--b:${b}"></button>`,
    ).join("");
    // Warm the cache once the section is near, so switching is instant.
    let warmed = false;
    const warm = () => {
      if (warmed) return;
      warmed = true;
      PALETTES.forEach(([id]) => {
        const im = new Image();
        im.src = `images/themes/${id}.png`;
      });
    };
    picker.addEventListener("pointerenter", warm, { once: true });
    picker.addEventListener("focusin", warm, { once: true });
    picker.addEventListener("click", (e) => {
      const btn = e.target.closest(".swatch");
      if (!btn) return;
      const p = PALETTES.find(([id]) => id === btn.dataset.id);
      if (!p) return;
      picker.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-pressed", String(s === btn)));
      const next = new Image();
      next.src = `images/themes/${p[0]}.png`;
      const swap = () => {
        palImg.src = next.src;
        palImg.alt = `skills-hub in the ${p[1]} palette`;
        palCap.textContent = p[1];
        palImg.style.opacity = "1";
      };
      if (reduced) {
        swap();
        return;
      }
      palImg.style.opacity = "0.25";
      (next.decode ? next.decode() : Promise.resolve()).then(swap, swap);
    });
  }

  /* ─────────────────────────── reveals & counters ─────────────────────────── */

  const revealables = document.querySelectorAll(
    ".feature-copy, .glass-frame, .disk, .note, .card, .tool-grid li, .rings, .install-card, .h-lg.center",
  );
  const countUp = (el) => {
    const to = Number(el.dataset.to);
    if (reduced || !to) return;
    const start = performance.now();
    const dur = 1100;
    const step = (now) => {
      const t = clamp((now - start) / dur, 0, 1);
      el.textContent = String(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    el.textContent = "0";
    requestAnimationFrame(step);
  };
  if ("IntersectionObserver" in window) {
    revealables.forEach((el) => el.classList.add("reveal"));
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          en.target.classList.add("in");
          en.target.querySelectorAll?.(".num[data-to]").forEach(countUp);
          io.unobserve(en.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    revealables.forEach((el) => io.observe(el));
  }
})();
