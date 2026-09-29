// The cabinet: sixteen drawers, one per tool, lit like a reading room.
//
// Everything is drawn from code — the wood grain, the brass, the typed cards —
// so the scene costs no image downloads. It renders only while something is
// moving, and not at all while the tab is hidden or the stage is off screen.

import * as THREE from "../vendor/three/three.min.js";
import { TOOLS, TYPES, cardsFor, guideLines } from "./data.js";

const COLS = 4;
const ROWS = 4;
const DW = 0.36; // drawer front
const DH = 0.26;
const GAP = 0.034;
const W = COLS * DW + (COLS + 1) * GAP;
const H = ROWS * DH + (ROWS + 1) * GAP;
const D = 0.74;
const PLINTH = 0.14;
const CW = 0.3; // card, including its tab
const CH = 0.21;
const TAB = 0.032;
const PULL_OUT = 0.5;
const STEP = 0.062; // how much of each card shows above the one in front
const LIFT = DH / 2 + 0.012; // the front card clears the drawer front

const PAPER = "#f3ead3";
const INK = "#2b2219";
const RED = "#b8483a";
const BLUE = "rgba(70, 110, 160, 0.28)";

const CARD_TINT = 0xc9bfad; // keeps lamp-lit paper off pure white

const TYPEWRITER = '"Courier Prime", "Courier New", monospace';

// ---------------------------------------------------------------- textures

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function woodCanvas(base, dark, seed, size = 1024) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size / 2;
  const g = c.getContext("2d");
  const r = rand(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, c.width, c.height);
  // broad colour bands
  for (let i = 0; i < 14; i++) {
    const y = r() * c.height;
    const h = 20 + r() * 80;
    const grad = g.createLinearGradient(0, y, 0, y + h);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, r() > 0.5 ? "rgba(255,210,150,0.07)" : "rgba(40,18,6,0.12)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, y, c.width, h);
  }
  // grain
  for (let i = 0; i < 420; i++) {
    const y0 = r() * c.height;
    const amp = 2 + r() * 10;
    const f = 0.002 + r() * 0.006;
    const p = r() * 6.28;
    g.strokeStyle = dark;
    g.globalAlpha = 0.04 + r() * 0.16;
    g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 16) {
      const y = y0 + Math.sin(x * f + p) * amp + Math.sin(x * f * 3.1 + p * 2) * amp * 0.25;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  // pores
  g.globalAlpha = 0.18;
  g.fillStyle = dark;
  for (let i = 0; i < 2600; i++) {
    g.fillRect(r() * c.width, r() * c.height, 1 + r() * 3, 1);
  }
  g.globalAlpha = 1;
  return c;
}

function texture(canvas, repeatX = 1, repeatY = 1) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

function paperNoise(g, w, h, r, top = 0) {
  g.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() > 0.5 ? "#7a5a30" : "#ffffff";
    g.fillRect(r() * w, top + r() * (h - top), 1 + r() * 2, 1 + r() * 2);
  }
  g.globalAlpha = 1;
}

function roundRect(g, x, y, w, h, rad) {
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

function fitText(g, text, max, size, weight = "400") {
  let s = size;
  g.font = `${weight} ${s}px ${TYPEWRITER}`;
  while (g.measureText(text).width > max && s > 10) {
    s -= 1;
    g.font = `${weight} ${s}px ${TYPEWRITER}`;
  }
  return s;
}

// A card is 600 × 420 px: a 64 px band for the tab, then the card itself.
const PX = 2000; // pixels per world unit
const CARD_W = Math.round(CW * PX);
const CARD_H = Math.round(CH * PX);
const TAB_H = Math.round(TAB * PX);

function cardBase(g, seed, tab) {
  const r = rand(seed);
  g.clearRect(0, 0, CARD_W, CARD_H);
  // tab
  if (tab) {
    roundRect(g, tab.x, 2, tab.w, TAB_H + 12, 10);
    g.fillStyle = tab.color;
    g.fill();
    g.fillStyle = INK;
    g.font = `700 26px ${TYPEWRITER}`;
    g.textBaseline = "middle";
    g.textAlign = "center";
    const label = tab.label.toUpperCase();
    fitText(g, label, tab.w - 18, 26, "700");
    g.fillText(label, tab.x + tab.w / 2, 4 + TAB_H / 2);
    g.textAlign = "left";
  }
  // body
  roundRect(g, 2, TAB_H, CARD_W - 4, CARD_H - TAB_H - 2, 8);
  g.fillStyle = PAPER;
  g.fill();
  g.save();
  g.clip();
  paperNoise(g, CARD_W, CARD_H, r, TAB_H);
  // ruling: one red line, then blue
  g.fillStyle = RED;
  g.globalAlpha = 0.55;
  g.fillRect(0, TAB_H + 64, CARD_W, 2);
  g.globalAlpha = 1;
  g.fillStyle = BLUE;
  for (let y = TAB_H + 64 + 38; y < CARD_H - 8; y += 38) g.fillRect(0, y, CARD_W, 1.5);
  // edge wear
  const grad = g.createLinearGradient(0, TAB_H, 0, CARD_H);
  grad.addColorStop(0, "rgba(120, 80, 30, 0.10)");
  grad.addColorStop(0.2, "rgba(120, 80, 30, 0)");
  grad.addColorStop(0.9, "rgba(120, 80, 30, 0)");
  grad.addColorStop(1, "rgba(120, 80, 30, 0.14)");
  g.fillStyle = grad;
  g.fillRect(0, TAB_H, CARD_W, CARD_H);
  g.restore();
  g.textBaseline = "alphabetic";
}

function tabFor(type) {
  const slotW = (CARD_W - 20) / 4;
  const t = TYPES[type];
  return { x: 10 + t.slot * slotW + 4, w: slotW - 8, color: t.color, label: t.label };
}

function ellipsize(g, text, max) {
  if (g.measureText(text).width <= max) return text;
  // keep the end of a path: it is the part that differs
  let s = text;
  while (s.length > 4 && g.measureText(`…${s}`).width > max) s = s.slice(1);
  return `…${s}`;
}

function itemCard(card, tool, seed) {
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext("2d");
  cardBase(g, seed, tabFor(card.type));
  g.fillStyle = INK;
  const size = fitText(g, card.name, CARD_W - 190, 40, "700");
  g.fillText(card.name, 24, TAB_H + 50);
  g.font = `700 21px ${TYPEWRITER}`;
  g.fillStyle = "rgba(43,34,25,0.72)";
  g.textAlign = "right";
  g.fillText(tool.name, CARD_W - 22, TAB_H + 48 - (40 - size) / 2);
  g.textAlign = "left";
  g.fillStyle = INK;
  g.font = `700 24px ${TYPEWRITER}`;
  g.fillText(ellipsize(g, card.description, CARD_W - 48), 24, TAB_H + 64 + 30);
  g.font = `400 22px ${TYPEWRITER}`;
  g.fillText(ellipsize(g, card.path, CARD_W - 48), 24, TAB_H + 64 + 30 + 38);
  g.fillStyle = "rgba(43,34,25,0.7)";
  g.fillText(`${TYPES[card.type].label.toLowerCase()} · enabled`, 24, TAB_H + 64 + 30 + 76);
  // a hole punch for the rod
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.arc(CARD_W / 2, CARD_H - 26, 11, 0, Math.PI * 2);
  g.fill();
  g.globalCompositeOperation = "source-over";
  return c;
}

function guideCard(tool, seed) {
  const c = document.createElement("canvas");
  c.width = CARD_W;
  c.height = CARD_H;
  const g = c.getContext("2d");
  cardBase(g, seed, { x: 120, w: CARD_W - 240, color: "#cfb27a", label: tool.name });
  g.fillStyle = INK;
  g.font = `700 28px ${TYPEWRITER}`;
  g.fillText("GUIDE · folders it reads", 26, TAB_H + 48);
  const lines = guideLines(tool);
  let y = TAB_H + 64 + 30;
  const max = lines.length > 6 ? 6 : lines.length;
  for (let i = 0; i < max; i++) {
    const l = lines[i];
    g.fillStyle = TYPES[l.type].color;
    g.fillRect(26, y - 16, 16, 16);
    g.strokeStyle = "rgba(43,34,25,0.5)";
    g.lineWidth = 1;
    g.strokeRect(26.5, y - 15.5, 15, 15);
    g.fillStyle = l.note === "unconfirmed" ? "rgba(43,34,25,0.55)" : INK;
    g.font = `700 ${lines.length > 4 ? 20 : 22}px ${TYPEWRITER}`;
    const text = l.note === "unconfirmed" ? `${l.path} (?)` : l.path;
    g.fillText(ellipsize(g, text, CARD_W - 80), 52, y);
    y += lines.length > 4 ? 30 : 38;
  }
  if (lines.length > max) {
    g.font = `italic 400 19px ${TYPEWRITER}`;
    g.fillText(`and ${lines.length - max} more`, 52, y);
  }
  return c;
}

function blankCard(type, seed) {
  const c = document.createElement("canvas");
  c.width = CARD_W / 2;
  c.height = CARD_H / 2;
  const g = c.getContext("2d");
  g.scale(0.5, 0.5);
  cardBase(g, seed, tabFor(type));
  return c;
}

function labelCanvas(tool) {
  const c = document.createElement("canvas");
  c.width = 400;
  c.height = 160;
  const g = c.getContext("2d");
  const r = rand(tool.name.length * 97 + 3);
  g.fillStyle = "#f2e8cf";
  g.fillRect(0, 0, c.width, c.height);
  paperNoise(g, c.width, c.height, r);
  g.fillStyle = INK;
  g.textAlign = "center";
  const name = tool.name.toUpperCase();
  fitText(g, name, c.width - 30, 58, "700");
  g.fillText(name, c.width / 2, 82);
  g.fillStyle = "rgba(43,34,25,0.8)";
  fitText(g, tool.root, c.width - 36, 30, "700");
  g.fillText(tool.root, c.width / 2, 128);
  return c;
}

// ---------------------------------------------------------------- scene

export async function mountCatalogue(canvas, opts) {
  const { reduced, onSelect } = opts;
  try {
    await Promise.all([
      document.fonts.load(`700 30px "Courier Prime"`),
      document.fonts.load(`400 30px "Courier Prime"`),
      document.fonts.load(`italic 400 30px "Courier Prime"`),
    ]);
  } catch {
    // fall back to whatever monospace the system has
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40);

  // light: a reading lamp high and to the left, a warm fill, a cool rim
  const lamp = new THREE.SpotLight(0xffd6a0, 60, 12, 0.62, 0.75, 1.6);
  lamp.position.set(-1.9, H + 2.4, 2.6);
  lamp.target.position.set(0.1, H * 0.55, 0.2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0004;
  lamp.shadow.radius = 4;
  scene.add(lamp, lamp.target);
  scene.add(new THREE.HemisphereLight(0xffe2bc, 0x1a0e06, 0.55));
  const rim = new THREE.DirectionalLight(0x9fb4ff, 0.35);
  rim.position.set(3, 2, -2);
  scene.add(rim);

  // materials
  const walnut = texture(woodCanvas("#5a3720", "#1e0f06", 7), 1, 1);
  const walnutEnd = texture(woodCanvas("#4a2c18", "#170a04", 9), 1, 1);
  const maple = texture(woodCanvas("#c79a62", "#6b4424", 13, 512), 1, 1);
  const carcassMat = new THREE.MeshStandardMaterial({ map: walnutEnd, roughness: 0.62, metalness: 0 });
  const topMat = new THREE.MeshStandardMaterial({ map: walnut, roughness: 0.42, metalness: 0 });
  const bodyMat = new THREE.MeshStandardMaterial({ map: maple, roughness: 0.75 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a35e, metalness: 1, roughness: 0.32 });
  const darkBrass = new THREE.MeshStandardMaterial({ color: 0x8a6a36, metalness: 1, roughness: 0.45 });

  const cabinet = new THREE.Group();
  scene.add(cabinet);
  cabinet.position.y = PLINTH;

  const box = (w, h, d, mat, x, y, z, cast = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    m.receiveShadow = true;
    return m;
  };

  // carcass: sides, back, top slab, plinth, and the grid of dividers
  cabinet.add(box(GAP, H, D, carcassMat, -W / 2 + GAP / 2, H / 2, -D / 2));
  cabinet.add(box(GAP, H, D, carcassMat, W / 2 - GAP / 2, H / 2, -D / 2));
  cabinet.add(box(W, H, 0.02, carcassMat, 0, H / 2, -D + 0.01));
  cabinet.add(box(W + 0.07, 0.05, D + 0.07, topMat, 0, H + 0.025, -D / 2 + 0.015));
  cabinet.add(box(W + 0.03, 0.012, D + 0.03, darkBrass, 0, H + 0.004, -D / 2 + 0.015, false));
  cabinet.add(box(W - 0.02, PLINTH - 0.02, D - 0.04, carcassMat, 0, -PLINTH / 2 - 0.01, -D / 2));
  cabinet.add(box(W + 0.04, 0.03, D + 0.04, topMat, 0, -0.015, -D / 2 + 0.01));
  for (let r = 0; r <= ROWS; r++) {
    cabinet.add(box(W, GAP, D, carcassMat, 0, r * (DH + GAP) + GAP / 2, -D / 2, false));
  }
  for (let c = 1; c < COLS; c++) {
    cabinet.add(box(GAP, H, D, carcassMat, -W / 2 + c * (DW + GAP) + GAP / 2, H / 2, -D / 2, false));
  }

  // floor that only catches the shadow
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.42 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // shared geometry
  const frontGeo = new THREE.BoxGeometry(DW - 0.006, DH - 0.006, 0.026);
  const labelGeo = new THREE.PlaneGeometry(0.19, 0.076);
  const cardGeo = new THREE.PlaneGeometry(CW, CH);
  cardGeo.translate(0, CH / 2, 0);
  const ringGeo = new THREE.TorusGeometry(0.03, 0.0055, 10, 32);
  const bossGeo = new THREE.CylinderGeometry(0.009, 0.011, 0.018, 16);
  const rodGeo = new THREE.CylinderGeometry(0.004, 0.004, D - 0.1, 8);
  const knobGeo = new THREE.SphereGeometry(0.011, 16, 12);

  const blankTextures = {};
  for (const t of Object.keys(TYPES)) {
    blankTextures[t] = texture(blankCard(t, t.length * 31), 1, 1);
    blankTextures[t].wrapS = blankTextures[t].wrapT = THREE.ClampToEdgeWrapping;
  }
  const blankMats = {};
  for (const t of Object.keys(TYPES)) {
    blankMats[t] = new THREE.MeshStandardMaterial({ map: blankTextures[t], alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, color: CARD_TINT });
  }

  const drawers = [];
  const fronts = [];

  TOOLS.forEach((tool, i) => {
    const col = i % COLS;
    const row = ROWS - 1 - Math.floor(i / COLS);
    const x = -W / 2 + GAP + DW / 2 + col * (DW + GAP);
    const y = GAP + DH / 2 + row * (DH + GAP);

    const g = new THREE.Group();
    g.position.set(x, y, 0);
    cabinet.add(g);

    const frontTex = walnut.clone();
    frontTex.repeat.set(0.34, 0.5);
    frontTex.offset.set((i * 0.37) % 1, (i * 0.21) % 1);
    frontTex.needsUpdate = true;
    const frontMat = new THREE.MeshStandardMaterial({ map: frontTex, roughness: 0.42, emissive: 0xffb060, emissiveIntensity: 0 });
    const front = new THREE.Mesh(frontGeo, frontMat);
    front.position.z = -0.003;
    front.castShadow = true;
    front.receiveShadow = true;
    front.userData.drawer = i;
    g.add(front);
    fronts.push(front);

    // label holder: brass frame round a typed card
    const lt = texture(labelCanvas(tool));
    lt.wrapS = lt.wrapT = THREE.ClampToEdgeWrapping;
    const label = new THREE.Mesh(labelGeo, new THREE.MeshStandardMaterial({ map: lt, roughness: 0.9 }));
    label.position.set(0, 0.052, 0.0105);
    g.add(label);
    const fw = 0.208;
    const fh = 0.094;
    const t = 0.009;
    g.add(box(fw, t, 0.006, brass, 0, 0.052 + fh / 2 - t / 2, 0.012, false));
    g.add(box(fw, t, 0.006, brass, 0, 0.052 - fh / 2 + t / 2, 0.012, false));
    g.add(box(t, fh, 0.006, brass, -fw / 2 + t / 2, 0.052, 0.012, false));
    g.add(box(t, fh, 0.006, brass, fw / 2 - t / 2, 0.052, 0.012, false));

    // ring pull
    const boss = new THREE.Mesh(bossGeo, brass);
    boss.rotation.x = Math.PI / 2;
    boss.position.set(0, -0.03, 0.018);
    g.add(boss);
    const ring = new THREE.Mesh(ringGeo, brass);
    ring.position.set(0, -0.06, 0.03);
    ring.rotation.x = -0.35;
    ring.castShadow = true;
    g.add(ring);
    // rod knob
    const knob = new THREE.Mesh(knobGeo, darkBrass);
    knob.position.set(0, -0.104, 0.014);
    g.add(knob);

    // the body and the cards, hidden while shut
    const inside = new THREE.Group();
    inside.visible = false;
    g.add(inside);
    const bh = DH * 0.55;
    const by = -DH / 2 + bh / 2 + 0.006;
    const bd = D - 0.06;
    inside.add(box(0.01, bh, bd, bodyMat, -DW / 2 + 0.012, by, -bd / 2 - 0.016));
    inside.add(box(0.01, bh, bd, bodyMat, DW / 2 - 0.012, by, -bd / 2 - 0.016));
    inside.add(box(DW - 0.02, 0.008, bd, bodyMat, 0, -DH / 2 + 0.01, -bd / 2 - 0.016));
    inside.add(box(DW - 0.02, bh, 0.01, bodyMat, 0, by, -bd - 0.01));
    const rod = new THREE.Mesh(rodGeo, darkBrass);
    rod.rotation.x = Math.PI / 2;
    rod.position.set(0, -DH / 2 + 0.034, -bd / 2 - 0.02);
    inside.add(rod);

    const items = cardsFor(tool, i);
    const cards = [];
    const baseY = -DH / 2 + 0.014;
    const addCard = (mat, data, k) => {
      const m = new THREE.Mesh(cardGeo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData = { drawer: i, data, k };
      m.position.set(0, baseY, -0.05 - k * 0.022);
      inside.add(m);
      return m;
    };
    const guideTex = texture(guideCard(tool, i * 13 + 1));
    guideTex.wrapS = guideTex.wrapT = THREE.ClampToEdgeWrapping;
    const guide = addCard(
      new THREE.MeshStandardMaterial({ map: guideTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, color: CARD_TINT }),
      { guide: true, tool },
      0,
    );
    cards.push(guide);
    items.forEach((it, k) => {
      const tex = texture(itemCard(it, tool, i * 31 + k * 7));
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, color: CARD_TINT });
      cards.push(addCard(mat, it, k + 1));
    });
    // the rest of the drawer: blank cards, so it reads as full
    const fillTypes = items.length ? items.map((c) => c.type) : ["skill"];
    const fillers = [];
    for (let k = cards.length; k < 20; k++) {
      const m = addCard(blankMats[fillTypes[k % fillTypes.length]], null, k);
      m.rotation.x = -0.05 + ((k * 37) % 10) / 180;
      m.castShadow = false;
      fillers.push(m);
    }

    drawers.push({
      tool,
      group: g,
      inside,
      front,
      cards,
      fillers,
      open: 0,
      openTarget: 0,
      fan: 0,
      fanTarget: 0,
      hover: 0,
      hoverTarget: 0,
      top: 0, // which live card is at the front
      baseY,
    });
  });

  // ------------------------------------------------------------ state

  let width = 1;
  let height = 1;
  let layout = "wide";
  let current = -1;
  let running = false;
  let visible = true;
  let last = performance.now();
  const camPos = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const wantPos = new THREE.Vector3();
  const wantLook = new THREE.Vector3();
  const parallax = new THREE.Vector2();
  const parallaxWant = new THREE.Vector2();
  let first = true;

  function frame() {
    const aspect = width / height;
    const dir = current < 0 ? new THREE.Vector3(0.28, 0.36, 1).normalize() : new THREE.Vector3(0.08, 0.3, 1).normalize();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const tan = Math.tan(fov / 2);
    // how much of the viewport the scene may use
    const useW = layout === "wide" ? 0.46 : 0.9;
    const useH = layout === "wide" ? 0.78 : 0.52;
    let look;
    let fitW;
    let fitH;
    if (current < 0) {
      look = new THREE.Vector3(0, PLINTH + H * 0.5, 0);
      fitW = W + 0.25;
      fitH = H + PLINTH + 0.2;
    } else {
      const d = drawers[current];
      const wp = new THREE.Vector3();
      d.group.getWorldPosition(wp);
      const stackTop = LIFT + CH + (d.cards.length - 1) * STEP;
      look = new THREE.Vector3(wp.x * 0.9, PLINTH + d.group.position.y + stackTop * 0.45, PULL_OUT * 0.6);
      fitW = layout === "wide" ? 0.85 : 0.72;
      fitH = stackTop + 0.35;
    }
    const dist = Math.max(fitH / (2 * tan * useH), fitW / (2 * tan * aspect * useW)) + (current < 0 ? 0.6 : 0.2);
    wantLook.copy(look);
    wantPos.copy(look).addScaledVector(dir, dist);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    layout = width / height > 1.05 ? "wide" : "tall";
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    if (layout === "wide") camera.setViewOffset(width, height, -width * 0.2, 0, width, height);
    else camera.setViewOffset(width, height, 0, height * 0.19, width, height);
    camera.updateProjectionMatrix();
    frame();
    if (first) {
      camPos.copy(wantPos);
      camLook.copy(wantLook);
    }
    wake();
  }

  function approach(v, target, rate, dt) {
    if (reduced) return target;
    return v + (target - v) * (1 - Math.exp(-rate * dt));
  }

  function smooth(t) {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
  }

  function place(d, dt) {
    // sequence: slide out, then fan up; fold down, then slide in
    const wantOpen = d.openTarget;
    if (wantOpen) {
      d.open = approach(d.open, 1, 6.5, dt);
      d.fanTarget = d.open > 0.82 ? 1 : 0;
    } else {
      d.fanTarget = 0;
      if (d.fan < 0.2) d.open = approach(d.open, 0, 7, dt);
    }
    d.fan = approach(d.fan, d.fanTarget, 4.2, dt);
    d.hover = approach(d.hover, d.hoverTarget, 14, dt);
    d.group.position.z = d.open * PULL_OUT + d.hover * 0.018;
    d.inside.visible = d.open > 0.002;
    d.front.material.emissiveIntensity = d.hover * 0.05;

    const n = d.cards.length;
    const stagger = 0.12;
    const span = 1 + stagger * (n - 1);
    const mid = (n - 1) / 2;
    for (let k = 0; k < n; k++) {
      const card = d.cards[k];
      // the chosen card in front and lowest, the rest behind and above it
      const depth = (k - d.top + n) % n;
      const t = smooth(d.fan * span - depth * stagger);
      const restZ = -0.05 - k * 0.022;
      const fanY = LIFT + depth * STEP;
      const fanZ = -0.035 - depth * 0.03;
      // a gentle fan: the further back, the further the card leans out
      const lean = (depth - mid) / Math.max(1, mid);
      card.position.set(lean * 0.03 * t, d.baseY + (fanY - d.baseY) * t, restZ + (fanZ - restZ) * t);
      card.rotation.set(-0.04 - 0.1 * t, 0, -lean * 0.07 * t);
    }
  }

  function settled(d) {
    return (
      Math.abs(d.open - d.openTarget) < 0.001 &&
      Math.abs(d.fan - d.fanTarget) < 0.001 &&
      Math.abs(d.hover - d.hoverTarget) < 0.001
    );
  }

  function tick(now) {
    running = false;
    if (!visible || document.hidden) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    let moving = false;
    for (const d of drawers) {
      place(d, dt);
      if (!settled(d)) moving = true;
    }
    frame();
    const lp = approach(0, 1, 3.2, dt);
    camPos.lerp(wantPos, lp);
    camLook.lerp(wantLook, lp);
    parallax.lerp(parallaxWant, reduced ? 1 : 1 - Math.exp(-4 * dt));
    if (camPos.distanceTo(wantPos) > 0.0005 || camLook.distanceTo(wantLook) > 0.0005) moving = true;
    if (parallax.distanceTo(parallaxWant) > 0.0005) moving = true;
    camera.position.copy(camPos);
    camera.position.x += parallax.x * 0.12;
    camera.position.y += parallax.y * 0.06;
    camera.lookAt(camLook);
    renderer.render(scene, camera);
    first = false;
    if (moving) wake();
  }

  function wake() {
    if (running || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ input

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = -1;

  function pick(ev) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const live = current >= 0 ? drawers[current].cards : [];
    const hits = ray.intersectObjects([...live, ...fronts], false);
    return hits[0]?.object ?? null;
  }

  function onMove(ev) {
    if (ev.pointerType === "mouse" && !reduced) {
      const rect = canvas.getBoundingClientRect();
      parallaxWant.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -(((ev.clientY - rect.top) / rect.height) * 2 - 1));
    }
    const hit = pick(ev);
    const next = hit && hit.userData.drawer !== undefined && hit === fronts[hit.userData.drawer] ? hit.userData.drawer : -1;
    canvas.style.cursor = hit ? "pointer" : "";
    if (next !== hovered) {
      if (hovered >= 0) drawers[hovered].hoverTarget = 0;
      hovered = next;
      if (hovered >= 0 && hovered !== current) drawers[hovered].hoverTarget = 1;
    }
    wake();
  }

  function onLeave() {
    parallaxWant.set(0, 0);
    if (hovered >= 0) drawers[hovered].hoverTarget = 0;
    hovered = -1;
    wake();
  }

  function onClick(ev) {
    const hit = pick(ev);
    if (!hit) return;
    const { drawer, k } = hit.userData;
    if (hit === fronts[drawer]) {
      api.open(drawer === current ? -1 : drawer, "pointer");
    } else if (drawer === current && k !== undefined) {
      const d = drawers[current];
      d.top = k;
      onSelect?.(current, k, "card");
      wake();
    }
  }

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  const io = new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    wake();
  });
  io.observe(canvas);
  document.addEventListener("visibilitychange", wake);

  const api = {
    open(index, source = "api") {
      if (index === current) return;
      if (current >= 0) drawers[current].openTarget = 0;
      current = index;
      if (current >= 0) {
        const d = drawers[current];
        d.openTarget = 1;
        d.hoverTarget = 0;
        d.top = 0;
      }
      onSelect?.(current, 0, source);
      wake();
    },
    showCard(k) {
      if (current < 0) return;
      drawers[current].top = k;
      wake();
    },
    get current() {
      return current;
    },
  };

  resize();
  return api;
}
