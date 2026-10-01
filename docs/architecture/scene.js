/**
 * The building: four floors stacked in dependency order, the real folders on
 * the ground floor drawn as the dots of their own directory listings, every
 * module a block on its floor, and the three paths drawn as light between
 * them. This file owns everything WebGL plus the HTML tags pinned to the
 * scene; app.js owns the story and tells it, each frame, what to show.
 */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { LAYERS, MODULES, PATHS } from "./content.js";

// ---------------------------------------------------------------- geometry

export const FLOOR_Y = [0, 3.4, 6.8, 10.2];
const FW = 15.6; // floor width (x)
const FD = 7.6; // floor depth (z)
const COL_X = [-5.2, 0, 5.2];
const BW = 4.3; // block
const BH = 0.26;
const BD = 0.72;
const rowZ = (r) => -2.8 + r * 1.4;

const ANNEX = {
  cli: { x: 10.2, y: FLOOR_Y[1], z: 1.4, w: 3.8, d: 2, layer: 1, name: "crates/cli" },
  popover: {
    x: 10.2,
    y: FLOOR_Y[3] + 1.5,
    z: -1.2,
    w: 3.8,
    d: 2,
    layer: 3,
    name: "a second webview",
  },
};
const GHOST = new THREE.Vector3(COL_X[2], 5.75, rowZ(0));
const MEMBRANE_Y = FLOOR_Y[1] + 1.15;

/** Directory listings for the ground floor, drawn as dot-matrix text. */
const LISTINGS = {
  folders: {
    x: COL_X[0] - 2.05,
    z: 0.6,
    lines: [
      "~/.claude/skills/",
      "  engineering/tdd/SKILL.md",
      "  writing/SKILL.md",
      "~/.claude/agents/planner.md",
      "~/.cursor/rules/house-style.md",
      "~/.codex/prompts/review.md",
      "<project>/.claude/skills/",
      "  release/SKILL.md",
    ],
  },
  notes: {
    x: COL_X[0] - 2.05,
    z: -3.1,
    lines: [
      "<notes folder>/",
      "  tdd-5e0c91a4f27b83d6.md",
      "  writing-0b7de2c84a19f35e.md",
      "  planner-9a41c07fe3d6b528.md",
      "  house-style-37f8e...md",
    ],
  },
  // The toggle's folder: `rows` is where each line sits before and after
  // tdd/ moves; `shift` indents a line by that many characters afterwards.
  skills: {
    x: COL_X[1] - 2.1,
    z: 1.05,
    scale: 1.3,
    lines: [
      { t: "~/.claude/skills/engineering/", rows: [0, 0] },
      { t: "  tdd/", rows: [1, 5], shift: 2, mover: true },
      { t: "    SKILL.md", rows: [2, 6], shift: 2, mover: true },
      { t: "  review/", rows: [3, 1] },
      { t: "    SKILL.md", rows: [4, 2] },
      { t: "  .skillmanager-disabled/", rows: [5, 4] },
    ],
    gapAfter: 3, // an empty row opens under the disabled folder
  },
  repo: {
    x: COL_X[2] - 2.05,
    z: -3.0,
    lines: [
      "github.com/<owner>/<repo>",
      "  skills/",
      "    tdd/SKILL.md",
      "  agents/",
      "    planner.md",
      "",
      "git clone --depth 1",
      "rm -rf .git",
    ],
  },
};
const CLUSTER_INDEX = { folders: 0, notes: 1, skills: 2, repo: 3 };

const PX = 0.0165; // world units per sampled pixel
const LINE_PX = 16;
const FONT_PX = 11;

// ------------------------------------------------------------------ shaders

const DOT_VERT = /* glsl */ `
  attribute vec3 aTo;
  attribute float aDelay;
  attribute float aKind;
  attribute float aCluster;
  attribute float aDist;
  uniform float uMove;
  uniform float uIntro;
  uniform float uPx;
  uniform vec4 uActive;
  uniform vec4 uFound;
  uniform vec3 uSweep;
  uniform float uMoverGlow;
  varying float vHot;
  varying float vAlpha;
  float pick(vec4 v, float i) {
    return i < 0.5 ? v.x : i < 1.5 ? v.y : i < 2.5 ? v.z : v.w;
  }
  void main() {
    float t = clamp((uMove - aDelay) / 0.55, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);
    vec3 p = mix(position, aTo, e);
    float mover = step(0.5, aKind) * step(aKind, 1.5);
    p.y += mover * sin(e * 3.14159) * 0.85;
    float here = 1.0 - step(0.1, abs(aCluster - uSweep.x));
    float band = here * uSweep.z * smoothstep(0.45, 0.0, abs(p.x - uSweep.y));
    float passed = here * uSweep.z * step(p.x, uSweep.y) * 0.75;
    vHot = max(max(pick(uActive, aCluster), pick(uFound, aCluster) * 0.75), max(band, passed));
    vHot = max(vHot, mover * uMoverGlow);
    vAlpha = smoothstep(aDist - 1.2, aDist, uIntro * 14.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = max(1.35, uPx * (0.02 + band * 0.012 + mover * uMoverGlow * 0.006) * (1.0 + step(1.5, aCluster) * step(aCluster, 2.5) * 0.3) / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const DOT_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform float uBase;
  uniform float uDim;
  varying float vHot;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.28, d);
    vec3 c = mix(uColor, uHot, clamp(vHot, 0.0, 1.0));
    float alpha = a * mix(uBase, 1.0, clamp(vHot, 0.0, 1.0)) * vAlpha * (1.0 - uDim * 0.65);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(c, alpha);
  }
`;

const FLOOR_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOOR_FRAG = /* glsl */ `
  uniform vec3 uFill;
  uniform vec3 uLine;
  uniform vec2 uSize;
  uniform float uFillA;
  uniform float uLineA;
  uniform float uEdgeA;
  uniform float uDim;
  uniform float uAlpha;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * uSize;
    vec2 q = p / 0.6;
    vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q);
    float grid = 1.0 - min(min(g.x, g.y), 1.0);
    vec2 d = min(p, uSize - p);
    float m = min(d.x, d.y);
    float edge = 1.0 - smoothstep(0.0, 0.035 + fwidth(p.x) * 1.5, m);
    float a = uFillA + grid * uLineA + edge * uEdgeA;
    vec3 c = mix(uFill, uLine, clamp(grid * 0.6 + edge, 0.0, 1.0));
    gl_FragColor = vec4(c, a * (1.0 - uDim * 0.6) * uAlpha);
  }
`;

const TUBE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TUBE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uHead;
  uniform float uLit;
  uniform float uCurrent;
  uniform float uBase;
  uniform float uDash;
  uniform float uLen;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uGlow;
  varying vec2 vUv;
  void main() {
    float x = vUv.x;
    float travelled = uCurrent * step(x, uHead);
    float head = uCurrent * smoothstep(uHead - 0.22, uHead, x) * step(x, uHead + 0.002);
    float flow = uLit * pow(fract(x * uLen * 0.28 - uTime * 0.55), 10.0) * 0.6;
    float a = uBase + max(uLit, travelled) * 0.62 + head * 0.5 + flow * uGlow;
    if (uDash > 0.5) a *= step(0.42, fract(x * uLen / 0.32));
    a *= uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * (1.0 + head * 0.35 * uGlow), a);
  }
`;

const MEMBRANE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOn;
  uniform float uHit;
  uniform vec2 uHitAt;
  uniform vec2 uSize;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * uSize;
    float stripes = step(0.5, fract((p.x + p.y) / 0.35));
    vec2 d = min(p, uSize - p);
    float edge = 1.0 - smoothstep(0.0, 0.05, min(d.x, d.y));
    float r = length(p - uHitAt);
    float ring = uHit * smoothstep(0.35, 0.0, abs(r - (1.0 - uHit) * 3.2)) ;
    float a = uOn * (0.05 + stripes * 0.07 + edge * 0.55) + ring * 0.6;
    gl_FragColor = vec4(uColor, a);
  }
`;

// ---------------------------------------------------------------- helpers

const byId = new Map(MODULES.map((m) => [m.id, m]));
const pathById = new Map(PATHS.map((p) => [p.id, p]));
const smooth = (t) => t * t * (3 - 2 * t);
/** Every module a module talks to, along any path. */
const NEIGHBOURS = new Map(MODULES.map((m) => [m.id, new Set()]));
for (const p of PATHS)
  for (const [a, b] of p.edges) {
    NEIGHBOURS.get(a).add(b);
    NEIGHBOURS.get(b).add(a);
  }
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function readPalette() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  const dark = cs.colorScheme === "dark" || v("color-scheme") === "dark";
  return {
    dark,
    ground: new THREE.Color(v("--ground")),
    panel: new THREE.Color(v("--panel")),
    border: new THREE.Color(v("--border")),
    text: new THREE.Color(v("--text")),
    muted: new THREE.Color(v("--muted")),
    scan: new THREE.Color(v("--scan")),
    toggle: new THREE.Color(v("--toggle")),
    ban: new THREE.Color(v("--ban")),
    seam: new THREE.Color(v("--seam")),
    layers: [0, 1, 2, 3].map((i) => new THREE.Color(v(`--l${i}`))),
    slab: Number.parseFloat(v("--slab")) || 0.55,
    glow: Number.parseFloat(v("--glow")) || 0.6,
  };
}

/** Sample a line of monospace text into dot positions, in canvas pixels. */
function sampleText(text) {
  if (!sampleText.canvas) sampleText.canvas = document.createElement("canvas");
  const c = sampleText.canvas;
  const w = Math.max(8, Math.ceil(text.length * FONT_PX * 0.62) + 4);
  c.width = w;
  c.height = LINE_PX;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.clearRect(0, 0, w, LINE_PX);
  g.fillStyle = "#000";
  g.font = `600 ${FONT_PX}px "IBM Plex Mono", ui-monospace, monospace`;
  g.textBaseline = "middle";
  g.fillText(text, 0, LINE_PX / 2);
  const charW = g.measureText("m").width;
  const data = g.getImageData(0, 0, w, LINE_PX).data;
  const out = [];
  for (let y = 0; y < LINE_PX; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 120) out.push([x, y]);
    }
  }
  return { dots: out, charW };
}

// -------------------------------------------------------------------- scene

export function createScene({ canvas, labels, onPick, onHover, reduced, view }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 300);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x9098a8, 1.6);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(6, 20, 12);
  scene.add(hemi, sun);

  let pal = readPalette();

  // ------------------------------------------------------------ floors
  const floors = [];
  const floorGroups = LAYERS.map((_, i) => {
    const group = new THREE.Group();
    group.position.y = FLOOR_Y[i];
    scene.add(group);
    return group;
  });

  function makeSlab(w, d, layerIndex, group, x = 0, y = 0, z = 0) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uFill: { value: new THREE.Color() },
        uLine: { value: new THREE.Color() },
        uSize: { value: new THREE.Vector2(w, d) },
        uFillA: { value: 0.5 },
        uLineA: { value: 0.12 },
        uEdgeA: { value: 0.8 },
        uDim: { value: 0 },
        uAlpha: { value: 1 },
      },
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(x, y, z);
    plane.renderOrder = 0;
    group.add(plane);
    // A thin edge underneath gives the floor a thickness.
    const under = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, 0.14, d)),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 }),
    );
    under.position.set(x, y - 0.07, z);
    group.add(under);
    const slab = { mat, under, layerIndex, w, d };
    floors.push(slab);
    return slab;
  }

  for (let i = 0; i < LAYERS.length; i++) makeSlab(FW, FD, i, floorGroups[i]);
  for (const a of Object.values(ANNEX)) {
    makeSlab(a.w, a.d, a.layer, floorGroups[a.layer], a.x, a.y - FLOOR_Y[a.layer], a.z);
  }

  // ------------------------------------------------------------ blocks
  const blockGeo = new THREE.BoxGeometry(BW, BH, BD);
  const annexBlockGeo = new THREE.BoxGeometry(a0w(), BH, BD);
  function a0w() {
    return ANNEX.cli.w - 0.5;
  }
  const stripGeo = new THREE.BoxGeometry(0.08, BH + 0.01, BD + 0.01);
  const blocks = new Map(); // id -> { mesh, mat, strip, edges, anchor (local), group }
  const pickables = [];

  for (const m of MODULES) {
    if (m.cluster) continue;
    const group = floorGroups[m.layer];
    let local;
    let geo = blockGeo;
    let width = BW;
    if (m.annex) {
      const a = ANNEX[m.annex];
      local = new THREE.Vector3(a.x, a.y - FLOOR_Y[a.layer] + BH / 2, a.z);
      geo = annexBlockGeo;
      width = a0w();
    } else if (m.ghost) {
      local = GHOST.clone().sub(new THREE.Vector3(0, FLOOR_Y[m.layer], 0));
    } else {
      local = new THREE.Vector3(COL_X[m.col], BH / 2, rowZ(m.row));
    }
    if (m.ghost) {
      const gg = new THREE.BoxGeometry(BW * 0.62, BH * 1.6, BD * 1.1);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(gg),
        new THREE.LineDashedMaterial({ dashSize: 0.12, gapSize: 0.08, transparent: true }),
      );
      edges.computeLineDistances();
      const fill = new THREE.Mesh(
        gg,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.08, depthWrite: false }),
      );
      const holder = new THREE.Group();
      holder.add(edges, fill);
      holder.position.copy(local);
      group.add(holder);
      fill.userData.id = m.id;
      pickables.push(fill);
      blocks.set(m.id, {
        mesh: holder,
        fill,
        edges,
        ghost: true,
        anchor: local.clone(),
        group,
        width: BW * 0.62,
      });
      continue;
    }
    const mat = new THREE.MeshLambertMaterial({ transparent: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(local);
    mesh.userData.id = m.id;
    group.add(mesh);
    pickables.push(mesh);
    const strip = new THREE.Mesh(stripGeo, new THREE.MeshBasicMaterial({ transparent: true }));
    strip.position.set(local.x - width / 2 + 0.04, local.y, local.z);
    group.add(strip);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0.4 }),
    );
    edges.position.copy(local);
    group.add(edges);
    blocks.set(m.id, {
      mesh,
      mat,
      strip,
      edges,
      anchor: local.clone().add(new THREE.Vector3(0, BH / 2, 0)),
      group,
      width,
    });
  }

  // ---------------------------------------------------------- the files
  const dotPositions = [];
  const dotTo = [];
  const dotDelay = [];
  const dotKind = [];
  const dotCluster = [];
  const dotDist = [];
  const clusterBounds = {};

  function pushDot(x, z, tx, tz, delay, kind, cluster) {
    dotPositions.push(x, 0.03, z);
    dotTo.push(tx, 0.03, tz);
    dotDelay.push(delay);
    dotKind.push(kind);
    dotCluster.push(cluster);
    dotDist.push(Math.hypot(x, z));
  }

  function buildListings() {
    for (const [key, L] of Object.entries(LISTINGS)) {
      const ci = CLUSTER_INDEX[key];
      const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
      L.lines.forEach((line, i) => {
        const spec = typeof line === "string" ? { t: line, rows: [i, i] } : line;
        if (!spec.t) return;
        const { dots, charW } = sampleText(spec.t);
        for (const [px, py] of dots) {
          const S = PX * (L.scale || 1);
          const x = L.x + px * S;
          const z = L.z + (spec.rows[0] * LINE_PX + py) * S;
          const tx = x + (spec.shift || 0) * charW * S;
          const tz = L.z + (spec.rows[1] * LINE_PX + py) * S;
          const kind = spec.mover ? 1 : spec.rows[0] !== spec.rows[1] ? 2 : 0;
          const delay = spec.mover ? (px / 200) * 0.18 : kind === 2 ? 0.42 + (px / 400) * 0.05 : 0;
          pushDot(x, z, tx, tz, delay, kind, ci);
          b.minX = Math.min(b.minX, x, tx);
          b.maxX = Math.max(b.maxX, x, tx);
          b.minZ = Math.min(b.minZ, z, tz);
          b.maxZ = Math.max(b.maxZ, z, tz);
        }
      });
      clusterBounds[key] = b;
    }
  }

  const dotGeo = new THREE.BufferGeometry();
  const dotMat = new THREE.ShaderMaterial({
    vertexShader: DOT_VERT,
    fragmentShader: DOT_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uMove: { value: 0 },
      uIntro: { value: 1 },
      uPx: { value: 800 },
      uActive: { value: new THREE.Vector4() },
      uFound: { value: new THREE.Vector4() },
      uSweep: { value: new THREE.Vector3(-1, 0, 0) },
      uMoverGlow: { value: 0 },
      uColor: { value: new THREE.Color() },
      uHot: { value: new THREE.Color() },
      uBase: { value: 0.55 },
      uDim: { value: 0 },
    },
  });
  const dots = new THREE.Points(dotGeo, dotMat);
  dots.frustumCulled = false;
  dots.renderOrder = 2;
  floorGroups[0].add(dots);

  // Invisible pick targets over each listing.
  const clusterAnchors = {};
  function buildClusterPicks() {
    for (const m of MODULES) {
      if (!m.cluster) continue;
      const b = clusterBounds[m.cluster];
      const w = b.maxX - b.minX + 0.3;
      const d = b.maxZ - b.minZ + 0.3;
      const hit = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.2, d),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      hit.position.set((b.minX + b.maxX) / 2, 0.1, (b.minZ + b.maxZ) / 2);
      hit.userData.id = m.id;
      floorGroups[0].add(hit);
      pickables.push(hit);
      clusterAnchors[m.id] = new THREE.Vector3((b.minX + b.maxX) / 2, 0.05, (b.minZ + b.maxZ) / 2);
      blocks.set(m.id, {
        cluster: m.cluster,
        anchor: new THREE.Vector3(b.minX + 0.05, 0.05, b.minZ - 0.12),
        center: clusterAnchors[m.id],
        group: floorGroups[0],
      });
    }
  }

  // ------------------------------------------------------------- edges
  const edges = []; // { path, index, from, to, verb, curve, mesh, mat, len }
  function worldAnchor(id, dir = 0) {
    const b = blocks.get(id);
    const m = byId.get(id);
    if (b.cluster) return b.center.clone();
    const p = b.anchor.clone();
    p.y += FLOOR_Y[m.layer];
    if (b.ghost) return p;
    p.y -= BH / 2; // the block's centre
    p.y += dir * (BH / 2);
    return p;
  }
  function buildEdges() {
    for (const path of PATHS) {
      path.edges.forEach(([from, to, verb, style], index) => {
        const a0 = worldAnchor(from);
        const b0 = worldAnchor(to);
        const dy = b0.y - a0.y;
        const dir = Math.abs(dy) < 0.5 ? 1 : Math.sign(dy);
        const a = worldAnchor(from, dir);
        const b = worldAnchor(to, Math.abs(dy) < 0.5 ? 1 : -dir);
        let curve;
        if (Math.abs(dy) < 0.5) {
          const h = 0.55 + a.distanceTo(b) * 0.12;
          curve = new THREE.CubicBezierCurve3(
            a,
            a.clone().add(new THREE.Vector3(0, h, 0)),
            b.clone().add(new THREE.Vector3(0, h, 0)),
            b,
          );
        } else {
          const k = Math.abs(dy) * 0.5;
          curve = new THREE.CubicBezierCurve3(
            a,
            a.clone().add(new THREE.Vector3(0, dir * k, 0)),
            b.clone().add(new THREE.Vector3(0, -dir * k, 0)),
            b,
          );
        }
        const len = curve.getLength();
        const mat = new THREE.ShaderMaterial({
          vertexShader: TUBE_VERT,
          fragmentShader: TUBE_FRAG,
          transparent: true,
          depthWrite: false,
          uniforms: {
            uColor: { value: new THREE.Color() },
            uHead: { value: 0 },
            uLit: { value: 0 },
            uCurrent: { value: 0 },
            uBase: { value: 0 },
            uDash: { value: style === "dashed" || style === "ban" ? 1 : 0 },
            uLen: { value: len },
            uTime: { value: 0 },
            uAlpha: { value: 1 },
            uGlow: { value: 1 },
          },
        });
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.max(24, Math.round(len * 10)), 0.028, 6, false),
          mat,
        );
        mesh.renderOrder = 3;
        scene.add(mesh);
        edges.push({
          path: path.id,
          index,
          from,
          to,
          verb,
          style,
          curve,
          mesh,
          mat,
          len,
          lit: 0,
          current: 0,
          head: 0,
          base: 0,
        });
      });
    }
  }

  // The bead that carries light along the current edge.
  const bead = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 16, 12),
    new THREE.MeshBasicMaterial({ transparent: true }),
  );
  bead.renderOrder = 4;
  scene.add(bead);

  // ----------------------------------------------------------- set pieces
  // deny.toml as a membrane over the domain.
  const membraneMat = new THREE.ShaderMaterial({
    vertexShader: FLOOR_VERT,
    fragmentShader: MEMBRANE_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color() },
      uOn: { value: 0 },
      uHit: { value: 0 },
      uHitAt: { value: new THREE.Vector2(GHOST.x + FW / 2, FD / 2 - GHOST.z) },
      uSize: { value: new THREE.Vector2(FW, FD) },
    },
  });
  const membrane = new THREE.Mesh(new THREE.PlaneGeometry(FW, FD), membraneMat);
  membrane.rotation.x = -Math.PI / 2;
  membrane.position.y = MEMBRANE_Y;
  membrane.renderOrder = 1;
  scene.add(membrane);

  // Cards landing on the grid at the end of the scan.
  const cards = [];
  const cardGeo = new THREE.BoxGeometry(0.62, 0.05, 0.42);
  const grid = blocks.get("grid");
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshBasicMaterial({ transparent: true });
    const card = new THREE.Mesh(cardGeo, mat);
    card.position.set(grid.anchor.x - BW / 2 + 0.55 + i * 0.66, grid.anchor.y + 0.2, grid.anchor.z);
    grid.group.add(card);
    cards.push({ card, mat, layer: [1, 0, 2, 1, 3, 0][i] });
  }

  // ------------------------------------------------------------- labels
  const tags = new Map();
  const floorTags = [];
  const verbEl = document.createElement("span");
  verbEl.className = "verb";
  labels.append(verbEl);

  for (const m of MODULES) {
    const el = document.createElement("button");
    el.type = "button";
    el.tabIndex = -1;
    el.className = `tag${m.mono === false ? " is-sans" : ""}`;
    el.textContent = m.title;
    el.style.setProperty("--c", `var(--l${m.ghost ? "ban" : m.layer})`);
    if (m.ghost) el.style.setProperty("--c", "var(--ban)");
    el.addEventListener("click", () => onPick?.(m.id));
    el.addEventListener("pointerenter", () => onHover?.(m.id));
    el.addEventListener("pointerleave", () => onHover?.(null));
    labels.append(el);
    tags.set(m.id, { el, shown: false, cls: "" });
  }
  LAYERS.forEach((layer, i) => {
    const el = document.createElement("div");
    el.className = "floor-tag";
    el.style.setProperty("--c", `var(--l${i})`);
    el.innerHTML = `<b>${layer.name}</b><span>${layer.path}</span>`;
    labels.append(el);
    floorTags.push({ el, shown: false });
  });

  // ------------------------------------------------------------- camera
  // Starts where the hero frames it, so the first frame needs no correction.
  const HERO = { target: new THREE.Vector3(1.6, 5.6, 0), dist: 43, az: 0.6, el: 0.33 };
  const rig = { target: HERO.target.clone(), dist: HERO.dist, az: HERO.az, el: HERO.el };
  const want = { target: rig.target.clone(), dist: rig.dist, az: rig.az, el: rig.el };
  let viewOffset = { x: 0, y: 0 };
  const offsetWant = { x: 0, y: 0 };

  // Touch pinch zooms through the controls; the wheel is handled by the page
  // (see app.js), so it is switched on only while fingers are down.
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch") controls.enableZoom = true;
  });
  const controls = new OrbitControls(camera, canvas);
  controls.enableZoom = false;
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 6;
  controls.maxDistance = 70;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

  function placeCamera() {
    const { target, dist, az, el } = rig;
    camera.position.set(
      target.x + dist * Math.cos(el) * Math.sin(az),
      target.y + dist * Math.sin(el),
      target.z + dist * Math.cos(el) * Math.cos(az),
    );
    camera.lookAt(target);
  }

  // ------------------------------------------------------------- sizing
  let W = 1;
  let H = 1;
  function resize(offset = viewOffset) {
    viewOffset = offset;
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    applyOffset();
    dotMat.uniforms.uPx.value =
      (H / (2 * Math.tan((camera.fov * Math.PI) / 360))) * renderer.getPixelRatio();
  }

  function applyOffset() {
    camera.setViewOffset(W, H, -viewOffset.x, -viewOffset.y, W, H);
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ palette
  function applyPalette() {
    pal = readPalette();
    const dark = pal.dark;
    hemi.intensity = dark ? 0.9 : 1.55;
    hemi.groundColor.set(dark ? 0x20242c : 0x9aa2b2);
    sun.intensity = dark ? 0.85 : 1.35;
    for (const f of floors) {
      const c = pal.layers[f.layerIndex];
      f.mat.uniforms.uFill.value.copy(pal.ground).lerp(c, dark ? 0.1 : 0.07);
      f.mat.uniforms.uLine.value.copy(c);
      f.mat.uniforms.uFillA.value = pal.slab;
      f.mat.uniforms.uLineA.value = dark ? 0.1 : 0.12;
      f.under.material.color.copy(c);
    }
    for (const [id, b] of blocks) {
      if (b.cluster) continue;
      const m = byId.get(id);
      if (b.ghost) {
        b.edges.material.color.copy(pal.ban);
        b.fill.material.color.copy(pal.ban);
        continue;
      }
      b.mat.color.copy(pal.panel);
      if (dark) b.mat.color.lerp(pal.layers[m.layer], 0.1);
      b.mat.emissive.copy(pal.layers[m.layer]);
      b.strip.material.color.copy(pal.layers[m.layer]);
      b.edges.material.color.copy(pal.layers[m.layer]);
    }
    dotMat.uniforms.uColor.value.copy(pal.layers[0]);
    dotMat.uniforms.uBase.value = dark ? 0.5 : 0.62;
    membraneMat.uniforms.uColor.value.copy(pal.ban);
    for (const e of edges) {
      const p = pathById.get(e.path);
      e.mat.uniforms.uColor.value.copy(e.style === "ban" ? pal.ban : pal[p.color]);
      e.mat.uniforms.uGlow.value = dark ? 1 : 0.55;
    }
    // The cards wear the four item-type colours, as they do in the app.
    for (const c of cards) c.mat.color.copy(pal.layers[c.layer]);
    bead.material.color.copy(pal.scan);
  }

  // -------------------------------------------------------------- intro
  const intro = { dots: 1, floors: [1, 1, 1, 1], edges: 1 };

  // --------------------------------------------------------------- state
  const blockState = new Map();
  let time = 0;
  let built = false;
  let explore = false;

  /** What the current view asks of every block and edge. */
  function computeTargets() {
    const out = {
      hot: new Map(),
      dim: new Map(),
      labels: new Map(), // id -> "shown" | "dim" | "current" | "hidden"
      edges: new Map(), // edge -> { lit, current, head, base, alpha }
      floorDim: [0, 0, 0, 0],
      floorTags: true,
      cluster: {
        active: [0, 0, 0, 0],
        found: [0, 0, 0, 0],
        sweep: [-1, 0, 0],
        move: 0,
        moverGlow: 0,
        hot: pal.scan,
      },
      membrane: 0,
      hit: 0,
      ghostDrop: 0,
      cards: 0,
      bead: null,
      camera: null,
    };
    const all = [...blocks.keys()];
    const mode = view.mode;
    for (const e of edges) out.edges.set(e, { lit: 0, current: 0, head: 0, base: 0, alpha: 0 });

    const moveDone = ["seams", "explore"].includes(mode) ? 1 : 0;
    out.cluster.move = moveDone;

    if (mode === "hero") {
      for (const id of all) out.dim.set(id, 0);
      for (const e of edges)
        out.edges.set(e, { lit: 0, current: 0, head: 0, base: pal.dark ? 0.26 : 0.2, alpha: 1 });
      out.camera = HERO;
      return out;
    }

    if (mode === "floors") {
      const f = Math.min(3, Math.max(0, view.t));
      const fi = Math.round(f);
      out.floorDim = [0, 1, 2, 3].map((i) => (i === fi ? 0 : 0.55));
      for (const id of all) {
        const m = byId.get(id);
        const on = m.layer === fi;
        out.dim.set(id, on ? 0 : 0.6);
        out.labels.set(id, on ? "shown" : "hidden");
      }
      if (fi === 0) out.cluster.active = [0.35, 0.35, 0.35, 0.35];
      for (const e of edges)
        out.edges.set(e, { lit: 0, current: 0, head: 0, base: 0.06, alpha: 1 });
      const y = FLOOR_Y[0] + f * (FLOOR_Y[1] - FLOOR_Y[0]);
      out.camera = { target: new THREE.Vector3(1.6, y + 0.8, 0), dist: 38, az: 0.52, el: 0.46 };
      out.cluster.move = 0;
      return out;
    }

    if (mode === "explore") {
      const filter = view.filter ? pathById.get(view.filter) : null;
      for (const id of all) {
        const m = byId.get(id);
        const onPath = !filter || m.paths.includes(filter.id);
        const sel = view.selected === id || view.hovered === id;
        // With a module picked, name only it and what it talks to.
        const near = view.selected ? NEIGHBOURS.get(view.selected).has(id) : true;
        out.dim.set(id, onPath && (near || !view.selected) ? 0 : 0.65);
        out.hot.set(id, sel ? 1 : 0);
        out.labels.set(
          id,
          sel ? "current" : view.selected ? (near ? "shown" : "hidden") : onPath ? "shown" : "dim",
        );
      }
      for (const e of edges) {
        const on = filter ? e.path === filter.id : false;
        const touches = view.selected && (e.from === view.selected || e.to === view.selected);
        out.edges.set(e, {
          lit: on || touches ? 1 : 0,
          current: 0,
          head: 0,
          base: filter ? 0.03 : 0.16,
          alpha: 1,
        });
      }
      if (view.selected && byId.get(view.selected).cluster) {
        out.cluster.active[CLUSTER_INDEX[byId.get(view.selected).cluster]] = 1;
      }
      if (filter) out.cluster.hot = pal[filter.color];
      out.membrane = !filter || filter.id === "seams" ? 0.5 : 0.15;
      out.cards = !filter || filter.id === "scan" ? 1 : 0;
      return out;
    }

    // A path.
    const path = pathById.get(mode);
    const n = path.steps.length;
    const t = Math.min(n - 0.0001, Math.max(0, view.t));
    const si = Math.floor(t);
    const f = t - si;
    const colour = pal[path.color];
    out.cluster.hot = colour;
    const visited = new Set();
    path.steps.forEach((s, i) => {
      if (i <= si) visited.add(s.m);
      const es = s.e === undefined ? [] : Array.isArray(s.e) ? s.e : [s.e];
      for (const ei of es) {
        const e = edges.find((x) => x.path === path.id && x.index === ei);
        if (!e) continue;
        if (i < si) out.edges.set(e, { lit: 1, current: 0, head: 1, base: 0.12, alpha: 1 });
        else if (i === si) {
          const head = reduced ? 1 : smooth(clamp01(f * 1.6));
          out.edges.set(e, { lit: reduced ? 1 : 0, current: 1, head, base: 0.12, alpha: 1 });
          if (!reduced && head < 1 && !out.bead) out.bead = { e, head };
        } else out.edges.set(e, { lit: 0, current: 0, head: 0, base: 0.12, alpha: 1 });
      }
    });
    for (const e of edges) {
      if (e.path !== path.id)
        out.edges.set(e, { lit: 0, current: 0, head: 0, base: 0.025, alpha: 1 });
    }
    const current = path.steps[si].m;
    for (const id of all) {
      const m = byId.get(id);
      const on = m.paths.includes(path.id) || path.steps.some((s) => s.m === id);
      out.dim.set(id, on ? 0 : 0.72);
      out.hot.set(id, id === current ? 1 : 0);
      out.labels.set(id, id === current ? "current" : visited.has(id) ? "shown" : "hidden");
    }
    out.floorDim = [0.2, 0.2, 0.2, 0.2];

    // Set pieces.
    const fx = path.steps[si].fx;
    const cur = byId.get(current);
    if (cur.cluster) out.cluster.active[CLUSTER_INDEX[cur.cluster]] = 1;
    if (path.id === "scan") {
      if (si > 4) out.cluster.found[0] = 1;
      if (si > 5) out.cluster.found[2] = 1;
      if (fx === "sweep-folders" || fx === "sweep-skills") {
        const key = fx === "sweep-folders" ? "folders" : "skills";
        const b = clusterBounds[key];
        out.cluster.active[CLUSTER_INDEX[key]] = 0;
        out.cluster.sweep = [
          CLUSTER_INDEX[key],
          reduced ? b.maxX + 1 : b.minX - 0.3 + (b.maxX - b.minX + 0.6) * f,
          1,
        ];
      }
      if (fx === "notes" || si > 8) out.cluster.found[1] = fx === "notes" ? 1 : 0.6;
      out.cards = si === n - 1 ? (reduced ? 1 : smooth(clamp01(f * 1.5))) : 0;
      out.cluster.move = 0;
    }
    if (path.id === "toggle") {
      const moveStep = path.steps.findIndex((s) => s.fx === "move");
      out.cluster.move =
        si > moveStep
          ? 1
          : si < moveStep
            ? 0
            : reduced
              ? f > 0.5
                ? 1
                : 0
              : smooth(clamp01((f - 0.08) / 0.8));
      out.cluster.moverGlow = si === moveStep ? 1 : si > moveStep && si < moveStep + 2 ? 0.5 : 0;
      if (si === moveStep) out.cluster.active[2] = 0.25;
      if (fx === "notes") out.cluster.active[1] = 1;
    }
    if (path.id === "seams") {
      out.membrane = 1;
      if (fx === "repel") {
        const k = reduced ? 0 : f;
        // Down towards the line, stopped at it, and back.
        out.ghostDrop = k < 0.5 ? smooth(k / 0.5) : 1 - smooth((k - 0.5) / 0.5) * 0.85;
        out.hit = reduced ? 0.6 : k > 0.42 ? Math.max(0, 1 - (k - 0.42) / 0.45) : 0;
      } else if (si > 1) out.ghostDrop = 0.15;
    }

    // Camera: follow the current module within the path's column.
    const cols = { scan: -1.4, toggle: 1.6, seams: 4.2 };
    const focus = worldAnchor(current);
    const target = new THREE.Vector3(
      cols[path.id] * 0.8 + focus.x * 0.2,
      5.3 + (focus.y - 5.3) * 0.3,
      focus.z * 0.3,
    );
    const cam = { target, dist: 33, az: { scan: 0.22, toggle: 0.3, seams: 0.5 }[path.id], el: 0.5 };
    if (fx === "move") {
      const b = clusterBounds.skills;
      cam.target = new THREE.Vector3((b.minX + b.maxX) / 2 + 0.2, 0.5, (b.minZ + b.maxZ) / 2 + 0.1);
      cam.dist = 8.6;
      cam.el = 0.64;
      cam.az = 0.04;
    }
    if (fx === "sweep-folders" || fx === "sweep-skills") {
      const b = clusterBounds[fx === "sweep-folders" ? "folders" : "skills"];
      cam.target = new THREE.Vector3((b.minX + b.maxX) / 2 + 1.5, 1.2, (b.minZ + b.maxZ) / 2);
      cam.dist = 17;
      cam.el = 0.55;
      cam.az = 0.12;
    }
    if (current === "popover" || (path.id === "toggle" && si > 7)) target.x += 2.2;
    if (path.id === "seams" && (current === "cli" || current === "home")) {
      cam.target = new THREE.Vector3(8, 5, 0.4);
      cam.az = 0.7;
    }
    out.camera = cam;
    return out;
  }

  // -------------------------------------------------------------- frame
  const tmp = new THREE.Vector3();

  function project(v) {
    tmp.copy(v).project(camera);
    return { x: (tmp.x * 0.5 + 0.5) * W, y: (-tmp.y * 0.5 + 0.5) * H, z: tmp.z };
  }

  function setTag(t, state, x, y) {
    if (state !== t.cls) {
      t.el.classList.toggle("is-shown", state !== "hidden");
      t.el.classList.toggle("is-dim", state === "dim");
      t.el.classList.toggle("is-current", state === "current");
      t.cls = state;
    }
    if (state !== "hidden")
      t.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  }

  function frame(dt) {
    time += reduced ? 0 : dt;
    const k = reduced ? 1000 : 1;
    const T = computeTargets();

    // Floors (intro offsets and dimming)
    floorGroups.forEach((g, i) => {
      const p = intro.floors[i];
      g.position.y = FLOOR_Y[i] + (1 - p) * 3.2;
    });
    for (const f of floors) {
      const target = T.floorDim[f.layerIndex] ?? 0;
      f.mat.uniforms.uDim.value = damp(f.mat.uniforms.uDim.value, target, 6 * k, dt);
      const a = intro.floors[f.layerIndex];
      f.mat.uniforms.uAlpha.value = a;
      f.under.material.opacity = 0.35 * a;
    }

    // Blocks
    for (const [id, b] of blocks) {
      let s = blockState.get(id);
      if (!s) {
        s = { hot: 0, dim: 0 };
        blockState.set(id, s);
      }
      s.hot = damp(s.hot, T.hot.get(id) ?? 0, 8 * k, dt);
      s.dim = damp(s.dim, T.dim.get(id) ?? 0, 6 * k, dt);
      const m = byId.get(id);
      const a = intro.floors[m.layer];
      if (b.cluster) continue;
      if (b.ghost) {
        const drop = T.ghostDrop;
        b.mesh.position.y = b.anchor.y - drop * (GHOST.y - MEMBRANE_Y - 0.3);
        b.edges.material.opacity = (0.9 - s.dim * 0.7) * a;
        b.fill.material.opacity = (0.08 + s.hot * 0.12) * a;
        continue;
      }
      b.mat.opacity = (1 - s.dim * 0.7) * a;
      b.mat.emissiveIntensity = s.hot * (pal.dark ? 0.55 : 0.28);
      b.strip.material.opacity = (1 - s.dim * 0.7) * a;
      b.edges.material.opacity = (0.35 + s.hot * 0.6) * (1 - s.dim * 0.8) * a;
      const lift = s.hot * 0.14;
      b.mesh.position.y = b.anchor.y - BH / 2 + lift;
      b.strip.position.y = b.mesh.position.y;
      b.edges.position.y = b.mesh.position.y;
    }

    // Dots
    const u = dotMat.uniforms;
    u.uIntro.value = intro.dots;
    u.uMove.value = reduced ? T.cluster.move : damp(u.uMove.value, T.cluster.move, 9, dt);
    u.uMoverGlow.value = damp(u.uMoverGlow.value, T.cluster.moverGlow, 6 * k, dt);
    const act = T.cluster.active;
    u.uActive.value.set(
      damp(u.uActive.value.x, act[0], 6 * k, dt),
      damp(u.uActive.value.y, act[1], 6 * k, dt),
      damp(u.uActive.value.z, act[2], 6 * k, dt),
      damp(u.uActive.value.w, act[3], 6 * k, dt),
    );
    const fo = T.cluster.found;
    u.uFound.value.set(
      damp(u.uFound.value.x, fo[0], 4 * k, dt),
      damp(u.uFound.value.y, fo[1], 4 * k, dt),
      damp(u.uFound.value.z, fo[2], 4 * k, dt),
      damp(u.uFound.value.w, fo[3], 4 * k, dt),
    );
    u.uSweep.value.set(...T.cluster.sweep);
    u.uHot.value.lerp(T.cluster.hot, 1 - Math.exp(-6 * k * dt));
    u.uDim.value = damp(u.uDim.value, T.floorDim[0] ?? 0, 6 * k, dt);

    // Edges
    for (const e of edges) {
      const s = T.edges.get(e);
      const U = e.mat.uniforms;
      U.uLit.value = damp(U.uLit.value, s.lit, 7 * k, dt);
      U.uCurrent.value = s.current;
      U.uHead.value = s.head;
      U.uBase.value = damp(U.uBase.value, s.base, 5 * k, dt);
      U.uAlpha.value = intro.edges * s.alpha;
      U.uTime.value = time;
    }

    // The bead and its verb
    if (T.bead) {
      const p = T.bead.e.curve.getPointAt(Math.min(0.999, T.bead.head));
      bead.position.copy(p);
      bead.material.color.copy(T.bead.e.mat.uniforms.uColor.value);
      bead.visible = true;
      const s = project(p);
      verbEl.textContent = T.bead.e.verb;
      verbEl.style.setProperty("--c", `var(--${pathById.get(T.bead.e.path).color})`);
      verbEl.style.transform = `translate3d(${(s.x + 12).toFixed(1)}px, ${(s.y + 4).toFixed(1)}px, 0)`;
      verbEl.classList.add("is-shown");
    } else {
      bead.visible = false;
      verbEl.classList.remove("is-shown");
    }

    // Set pieces
    membraneMat.uniforms.uOn.value =
      damp(membraneMat.uniforms.uOn.value, T.membrane, 5 * k, dt) * intro.edges;
    membraneMat.uniforms.uHit.value = T.hit;
    cards.forEach((c, i) => {
      const p = clamp01(T.cards * 1.6 - i * 0.12);
      const sc = reduced ? (T.cards > 0 ? 1 : 0) : p;
      c.card.scale.setScalar(Math.max(0.0001, sc));
      c.mat.opacity = sc;
      c.card.visible = sc > 0.01;
    });

    // Camera
    if (Math.abs(viewOffset.x - offsetWant.x) + Math.abs(viewOffset.y - offsetWant.y) > 0.1) {
      viewOffset = {
        x: damp(viewOffset.x, offsetWant.x, reduced ? 1000 : 4, dt),
        y: damp(viewOffset.y, offsetWant.y, reduced ? 1000 : 4, dt),
      };
      applyOffset();
    }
    if (!explore && T.camera) {
      want.target.copy(T.camera.target);
      want.dist = T.camera.dist;
      want.az = T.camera.az;
      want.el = T.camera.el;
      const kc = reduced ? 1000 : 2.6;
      rig.target.x = damp(rig.target.x, want.target.x, kc, dt);
      rig.target.y = damp(rig.target.y, want.target.y, kc, dt);
      rig.target.z = damp(rig.target.z, want.target.z, kc, dt);
      rig.dist = damp(rig.dist, want.dist * fitScale(), kc, dt);
      rig.az = damp(rig.az, want.az, kc, dt);
      rig.el = damp(rig.el, want.el, kc, dt);
      placeCamera();
    } else if (explore) {
      controls.update(dt);
    }

    renderer.render(scene, camera);

    // Tags
    for (const [id, t] of tags) {
      const b = blocks.get(id);
      const m = byId.get(id);
      let state = T.labels.get(id) ?? "hidden";
      if (intro.floors[m.layer] < 0.95) state = "hidden";
      const p = b.anchor.clone();
      p.y += b.group.position.y;
      if (b.ghost) p.y = b.mesh.position.y + b.group.position.y + 0.3;
      else if (!b.cluster) p.y = b.mesh.position.y + b.group.position.y + BH / 2;
      const s = project(p);
      if (s.z > 1 || s.y < 64) state = "hidden"; // behind the camera, or under the header
      t.el.classList.toggle("is-selected", view.selected === id);
      t.el.classList.toggle("is-hover", view.hovered === id);
      if (b.cluster) {
        // A listing is labelled at its top-left corner, not its middle.
        if (state !== t.cls) {
          t.el.classList.toggle("is-shown", state !== "hidden");
          t.el.classList.toggle("is-dim", state === "dim");
          t.el.classList.toggle("is-current", state === "current");
          t.cls = state;
        }
        if (state !== "hidden")
          t.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(0, -100%)`;
      } else setTag(t, state, s.x, s.y);
    }
    const showFloor = view.mode === "hero" || view.mode === "floors" || view.mode === "explore";
    floorTags.forEach((f, i) => {
      const y = floorGroups[i].position.y;
      const s = project(new THREE.Vector3(-FW / 2 - 0.3, y + 0.05, FD / 2));
      // Off the left edge, or under the explore panel once zoomed in: leave it out.
      const clear = s.x - 120 > (view.mode === "explore" ? 360 : 0);
      const on = showFloor && intro.floors[i] > 0.9 && s.z < 1 && clear;
      if (on !== f.shown) {
        f.el.classList.toggle("is-shown", on);
        f.shown = on;
      }
      f.el.style.transform = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(-100%, -50%)`;
    });
  }

  /** Pull the camera back on narrow or short viewports so the building fits. */
  function fitScale() {
    const aspect = (W - Math.abs(viewOffset.x) * 1.2) / H;
    return aspect < 1.35 ? Math.min(2.1, 1.35 / Math.max(aspect, 0.4)) : 1;
  }

  // -------------------------------------------------------------- picking
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables, false);
    return hits.length ? hits[0].object.userData.id : null;
  }

  // ---------------------------------------------------------------- api
  return {
    async build() {
      try {
        await document.fonts.load(`600 ${FONT_PX}px "IBM Plex Mono"`);
      } catch {}
      buildListings();
      dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));
      dotGeo.setAttribute("aTo", new THREE.Float32BufferAttribute(dotTo, 3));
      dotGeo.setAttribute("aDelay", new THREE.Float32BufferAttribute(dotDelay, 1));
      dotGeo.setAttribute("aKind", new THREE.Float32BufferAttribute(dotKind, 1));
      dotGeo.setAttribute("aCluster", new THREE.Float32BufferAttribute(dotCluster, 1));
      dotGeo.setAttribute("aDist", new THREE.Float32BufferAttribute(dotDist, 1));
      buildClusterPicks();
      buildEdges();
      applyPalette();
      resize();
      rig.dist = HERO.dist * fitScale();
      placeCamera();
      built = true;
      return { dots: dotDelay.length };
    },
    intro,
    frame,
    setOffset(o) {
      offsetWant.x = o.x;
      offsetWant.y = o.y;
      if (!built) {
        viewOffset = { ...o };
        applyOffset();
      }
    },
    resize,
    applyPalette,
    pickAt,
    get dotCount() {
      return dotDelay.length;
    },
    /** Hand the camera to the orbit controls, or take it back. */
    setExplore(on) {
      if (on === explore) return;
      explore = on;
      controls.enabled = on;
      if (on) {
        controls.target.copy(rig.target);
        controls.update();
      } else {
        // Carry on from wherever the visitor left the camera.
        const off = camera.position.clone().sub(controls.target);
        rig.target.copy(controls.target);
        rig.dist = off.length();
        rig.el = Math.asin(off.y / rig.dist);
        rig.az = Math.atan2(off.x, off.z);
      }
    },
    /** Fly the orbit camera to a module (explore). */
    focusOn(id, gsap) {
      const b = blocks.get(id);
      const m = byId.get(id);
      const p = b.cluster
        ? b.center.clone()
        : b.anchor.clone().add(new THREE.Vector3(0, FLOOR_Y[m.layer], 0));
      const off = camera.position.clone().sub(controls.target);
      const dist = b.cluster ? 19 : 30;
      off.setLength(dist);
      const dest = p.clone().add(off);
      if (reduced || !gsap) {
        controls.target.copy(p);
        camera.position.copy(dest);
        controls.update();
        return;
      }
      gsap.to(controls.target, { x: p.x, y: p.y, z: p.z, duration: 0.9, ease: "power3.inOut" });
      gsap.to(camera.position, {
        x: dest.x,
        y: dest.y,
        z: dest.z,
        duration: 0.9,
        ease: "power3.inOut",
      });
    },
    zoomBy(factor) {
      if (!explore) return;
      const off = camera.position.clone().sub(controls.target);
      off.setLength(
        Math.min(controls.maxDistance, Math.max(controls.minDistance, off.length() * factor)),
      );
      camera.position.copy(controls.target).add(off);
    },
    resetExploreCamera(gsap) {
      const target = new THREE.Vector3(1.4, 5.4, 0);
      const dist = 40 * fitScale();
      const dest = new THREE.Vector3(
        target.x + dist * Math.cos(0.36) * Math.sin(0.6),
        target.y + dist * Math.sin(0.36),
        target.z + dist * Math.cos(0.36) * Math.cos(0.6),
      );
      if (reduced || !gsap) {
        controls.target.copy(target);
        camera.position.copy(dest);
        return;
      }
      gsap.to(controls.target, {
        x: target.x,
        y: target.y,
        z: target.z,
        duration: 1,
        ease: "power3.inOut",
      });
      gsap.to(camera.position, {
        x: dest.x,
        y: dest.y,
        z: dest.z,
        duration: 1,
        ease: "power3.inOut",
      });
    },
    /** Where a module sits on screen, for tests and screenshots. */
    screenOf(id) {
      const b = blocks.get(id);
      const m = byId.get(id);
      const p = b.cluster
        ? b.center.clone()
        : b.anchor.clone().add(new THREE.Vector3(0, FLOOR_Y[m.layer], 0));
      return project(p);
    },
    get info() {
      return renderer.info;
    },
  };
}
