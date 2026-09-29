// Everything on the page that is not the cabinet, and the wiring between the
// cabinet and the captions that scroll past it.

import { TOOLS, TYPES, cardsFor, guideLines } from "./data.js";

const root = document.documentElement;
const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

// ------------------------------------------------------------ the guide

const guide = document.querySelector(".guide");
const slipTitle = document.querySelector(".slip-title");
const slipLines = document.querySelector(".slip-lines");
const buttons = TOOLS.map((tool, i) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "drawer-btn";
  b.setAttribute("aria-pressed", "false");
  b.dataset.index = String(i);
  const plate = document.createElement("span");
  plate.className = "plate";
  plate.textContent = tool.name;
  b.append(plate);
  b.addEventListener("click", () => choose(i === selected ? -1 : i, "button"));
  guide.append(b);
  return b;
});

const cardList = document.createElement("ul");
cardList.className = "no-gl-cards";
document.querySelector(".cap-guide").append(cardList);

let selected = -1;
let scene = null;

function renderSlip(i) {
  slipLines.replaceChildren();
  cardList.replaceChildren();
  if (i < 0) {
    slipTitle.textContent = "Choose a drawer to read its guide card.";
    return;
  }
  const tool = TOOLS[i];
  slipTitle.textContent = `${tool.name} — folders it reads`;
  for (const l of guideLines(tool)) {
    const li = document.createElement("li");
    li.dataset.type = l.type;
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.title = TYPES[l.type].plural;
    const p = document.createElement("span");
    p.className = "p";
    p.textContent = l.path;
    const sr = document.createElement("span");
    sr.className = "sr-only";
    sr.textContent = `${TYPES[l.type].plural}: `;
    li.append(chip, sr, p);
    if (l.note) {
      const n = document.createElement("span");
      n.className = "note";
      n.textContent = l.note === "unconfirmed" ? "unconfirmed" : "per project";
      li.append(n);
    }
    slipLines.append(li);
  }
  for (const c of cardsFor(tool, i)) {
    const li = document.createElement("li");
    li.dataset.type = c.type;
    const b = document.createElement("b");
    b.textContent = `${c.name} · ${TYPES[c.type].label}`;
    li.append(b, document.createTextNode(c.path));
    cardList.append(li);
  }
}

function choose(i, source) {
  selected = i;
  buttons.forEach((b, k) => b.setAttribute("aria-pressed", String(k === i)));
  renderSlip(i);
  if (source !== "scene" && scene) scene.open(i, source);
  if (source === "pointer" || source === "button") manual = true;
}

// ------------------------------------------------------------ scroll steps

const catalogue = document.querySelector(".catalogue");
const caps = [...document.querySelectorAll(".cap")];
const rail = [...document.querySelectorAll(".rail li")];
// what each step shows; the last one leaves the choice to the reader
const STEP_DRAWER = [-1, 0, 1, -2];
let step = -1;
let manual = false;

function currentStep() {
  const rect = catalogue.getBoundingClientRect();
  const total = catalogue.offsetHeight - window.innerHeight;
  const p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 0;
  if (p < 0.16) return 0;
  if (p < 0.44) return 1;
  if (p < 0.7) return 2;
  return 3;
}

function applyStep(next) {
  if (next === step) return;
  step = next;
  caps.forEach((c, k) => {
    c.classList.toggle("is-active", k === step);
    c.classList.toggle("is-past", k < step);
    c.inert = k !== step;
  });
  rail.forEach((r, k) => r.classList.toggle("is-active", k === step));
  const want = STEP_DRAWER[step];
  if (want === -2) {
    // the guide: keep what is open, or open the shared folder
    if (selected < 0) choose(TOOLS.length - 1, "step");
  } else {
    manual = false;
    choose(want, "step");
  }
}

let ticking = false;
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    applyStep(currentStep());
  });
}

// ------------------------------------------------------------ WebGL

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

async function startScene() {
  const canvas = document.getElementById("cabinet");
  if (!canvas || !hasWebGL()) return false;
  try {
    root.classList.add("has-gl");
    const { mountCatalogue } = await import("./scene.js");
    scene = await mountCatalogue(canvas, {
      reduced: reducedQuery.matches,
      onSelect(i, _k, source) {
        if (source === "pointer" || source === "card") {
          if (i !== selected) choose(i, "scene");
          manual = true;
        }
      },
    });
    if (selected >= 0) scene.open(selected, "step");
    return true;
  } catch (err) {
    console.warn("catalogue: falling back to the plain guide", err);
    root.classList.remove("has-gl");
    return false;
  }
}

startScene().then((gl) => {
  if (gl) {
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    applyStep(currentStep());
  } else {
    caps.forEach((c) => c.classList.add("is-active"));
    choose(0, "step");
  }
});

// ------------------------------------------------------------ withdraw

const card = document.querySelector("#withdraw .index-card");
const withdrawBtn = document.getElementById("withdraw-btn");
const withdrawnText = card?.querySelector(".withdrawn-text");
withdrawBtn?.addEventListener("click", () => {
  const out = card.dataset.state !== "out";
  card.dataset.state = out ? "out" : "in";
  withdrawBtn.setAttribute("aria-pressed", String(out));
  if (withdrawnText) withdrawnText.textContent = out ? ".skillmanager-disabled/" : "";
});

// ------------------------------------------------------------ bindings

const PALETTES = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["quiet-light", "Quiet Light"],
  ["solarized-light", "Solarized Light"],
  ["solarized-dark", "Solarized Dark"],
  ["horizon-morning", "Horizon Morning"],
  ["horizon-evening", "Horizon Evening"],
  ["tokyo-night", "Tokyo Night"],
  ["tomorrow-night-blue", "Tomorrow Night Blue"],
  ["abyss", "Abyss"],
  ["aura", "Aura"],
  ["monokai", "Monokai"],
  ["kimbie-dark", "Kimbie Dark"],
  ["overnight", "Overnight"],
  ["panda", "Panda"],
  ["red", "Red"],
  ["synthwave-84", "SynthWave ’84"],
  ["high-contrast", "High Contrast"],
];
const bindings = document.querySelector(".bindings");
for (const [id, name] of PALETTES) {
  const li = document.createElement("li");
  const fig = document.createElement("figure");
  const img = document.createElement("img");
  img.src = `images/themes/${id}.png`;
  img.width = 760;
  img.height = 480;
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = `skills-hub in the ${name} palette`;
  const cap = document.createElement("figcaption");
  cap.textContent = name;
  fig.append(img, cap);
  li.append(fig);
  bindings.append(li);
}

// ------------------------------------------------------------ install tabs

const tabs = [...document.querySelectorAll('.loan-tabs [role="tab"]')];
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
  t.addEventListener("click", () => selectTab(t, false));
  t.addEventListener("keydown", (e) => {
    const k = e.key;
    let n = -1;
    if (k === "ArrowRight") n = (i + 1) % tabs.length;
    else if (k === "ArrowLeft") n = (i - 1 + tabs.length) % tabs.length;
    else if (k === "Home") n = 0;
    else if (k === "End") n = tabs.length - 1;
    if (n >= 0) {
      e.preventDefault();
      selectTab(tabs[n], true);
    }
  });
});
const ua = navigator.userAgent;
if (/Windows/.test(ua)) selectTab(tabs[1], false);
else if (/Linux/.test(ua) && !/Android/.test(ua)) selectTab(tabs[2], false);

for (const btn of document.querySelectorAll(".copy")) {
  btn.addEventListener("click", async () => {
    const text = btn.previousElementSibling.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(btn.previousElementSibling);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      btn.textContent = "Selected";
    }
    clearTimeout(btn._t);
    btn._t = setTimeout(() => {
      btn.textContent = "Copy";
    }, 1600);
  });
}
