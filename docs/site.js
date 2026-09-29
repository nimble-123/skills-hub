/*
 * Everything on the page that moves, except the field itself.
 *
 * Interactive state changes are CSS transitions, so they can be interrupted;
 * the only keyframes are one-shot entrances. Reduced motion keeps every
 * static cue and drops the movement.
 */

import { createField } from "./field.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, value));

/* ------------------------------------------------------------------ field */

let field = null;
try {
  field = createField(document.getElementById("field"), document.getElementById("field-labels"), {
    reducedMotion,
  });
  if (field) document.documentElement.classList.add("has-gl");
} catch (error) {
  console.warn("The field did not start; the page works without it.", error);
}

/* ----------------------------------------------------------------- scroll */

const nav = document.getElementById("nav");
const gather = document.getElementById("gather");
const steps = [...document.querySelectorAll(".gather-step")];
const progress = document.querySelector(".gather-progress");
const STEP_AT = [0, 0.3, 0.6];
const KEEP_OUT = ".hero .eyebrow, .hero h1, .hero .lede, .hero-actions, .gather-step[data-state=active]";

function onScroll() {
  const vh = window.innerHeight;
  const y = window.scrollY;
  nav.dataset.scrolled = String(y > 12);

  const rect = gather.getBoundingClientRect();
  const travel = gather.offsetHeight - vh;
  const p = clamp(-rect.top / travel);

  let active = -1;
  if (rect.top < vh * 0.35 && rect.bottom > vh * 0.6) {
    active = STEP_AT.findLastIndex((at) => p >= at);
  }
  steps.forEach((step, i) => {
    step.dataset.state = i === active ? "active" : i < active ? "past" : "future";
  });
  progress.style.setProperty("--progress", p.toFixed(3));

  field?.setKeepOut(
    [...document.querySelectorAll(KEEP_OUT)]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.bottom > 0 && r.top < vh),
  );
  field?.setScene({
    hero: clamp(1 - y / (vh * 1.1)) * 0.6 + 0.4,
    gather: clamp((p - 0.22) / 0.5),
    recede: clamp(-rect.bottom / (vh * 0.9) + 1.05),
  });
}

let ticking = false;
window.addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      onScroll();
      ticking = false;
    });
  },
  { passive: true },
);
window.addEventListener("resize", onScroll);
onScroll();

/* The nav marks the section being read. */
const navLinks = new Map(
  [...document.querySelectorAll(".nav-links a")].map((a) => [a.getAttribute("href").slice(1), a]),
);
const sectionWatcher = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const link = navLinks.get(entry.target.id);
      if (!link) continue;
      if (entry.isIntersecting) {
        for (const other of navLinks.values()) other.removeAttribute("aria-current");
        link.setAttribute("aria-current", "true");
      }
    }
  },
  { rootMargin: "-45% 0px -50% 0px" },
);
for (const id of navLinks.keys()) {
  const section = document.getElementById(id);
  if (section) sectionWatcher.observe(section);
}

/* --------------------------------------------------------------- reveals */

const counters = new Set(document.querySelectorAll("[data-count]"));

const revealer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-in");
      revealer.unobserve(entry.target);
      for (const counter of entry.target.querySelectorAll("[data-count]")) countUp(counter);
    }
  },
  { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
);
for (const el of document.querySelectorAll(".reveal")) revealer.observe(el);

function countUp(el) {
  if (!counters.delete(el)) return;
  const to = Number(el.dataset.count);
  if (reducedMotion || to === 0) {
    el.textContent = String(to);
    return;
  }
  const start = performance.now();
  const duration = 1400;
  const step = (now) => {
    const t = clamp((now - start) / duration);
    el.textContent = String(Math.round(to * (1 - (1 - t) ** 4)));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ------------------------------------------------------------------ copy */

for (const command of document.querySelectorAll(".command[data-copy]")) {
  const button = command.querySelector(".copy");
  const label = button.getAttribute("aria-label");
  let timer = 0;
  button.addEventListener("click", async () => {
    const text = command.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(command.querySelector("code"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    button.dataset.copied = "true";
    button.setAttribute("aria-label", "Copied");
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.dataset.copied = "false";
      button.setAttribute("aria-label", label);
    }, 1800);
  });
}

/* ------------------------------------------------------------ disk demo */

const live = document.getElementById("tree-live");
const off = document.getElementById("tree-off");
const log = document.getElementById("disk-log");

function flip(mutate) {
  const rows = [...document.querySelectorAll(".tree-row")];
  const before = new Map(rows.map((row) => [row, row.getBoundingClientRect()]));
  mutate();
  if (reducedMotion) return;
  for (const row of rows) {
    const a = before.get(row);
    const b = row.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if (!dx && !dy) continue;
    row.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
      duration: 420,
      easing: "cubic-bezier(0.2, 0, 0, 1)",
    });
  }
}

function stamp() {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

for (const toggle of document.querySelectorAll(".switch[data-item]")) {
  toggle.addEventListener("click", () => {
    const item = toggle.dataset.item;
    const on = toggle.getAttribute("aria-checked") !== "true";
    toggle.setAttribute("aria-checked", String(on));
    const row = document.querySelector(`.tree-row[data-item="${item}"]`);
    flip(() => (on ? live : off).append(row));

    row.dataset.fresh = "true";
    requestAnimationFrame(() => requestAnimationFrame(() => row.removeAttribute("data-fresh")));

    const entry = document.createElement("li");
    const time = document.createElement("span");
    time.className = "tnum";
    time.textContent = `${stamp()}  `;
    const verb = document.createElement("b");
    verb.textContent = "mv ";
    if (!on) verb.className = "off";
    // Relative to the folder the panel is titled with, so a line fits.
    entry.append(time, verb, on ? `.skillmanager-disabled/${item} .` : `${item} .skillmanager-disabled/`);
    log.append(entry);
    while (log.children.length > 3) log.firstElementChild.remove();
  });
}

/* -------------------------------------------------------------- palettes */

const PALETTES = [
  ["dark", "Dark", "Default", ["#1e1f22", "#b9a6ff", "#64d6c2", "#e0b070", "#f09aad"]],
  ["light", "Light", "Default", ["#ffffff", "#5546b8", "#146054", "#8a5c0a", "#a23048"]],
  ["quiet-light", "Quiet Light", "VS Code", ["#f5f5f5", "#7a3e9d", "#3c7a22", "#9a6700", "#ad0000"]],
  ["solarized-light", "Solarized Light", "VS Code", ["#fdf6e3", "#6c71c4", "#157f76", "#a37c00", "#d33682"]],
  ["solarized-dark", "Solarized Dark", "VS Code", ["#002b36", "#9a9fe0", "#3fc2b7", "#cba116", "#e0609c"]],
  ["monokai", "Monokai", "VS Code", ["#272822", "#ae81ff", "#a6e22e", "#e6db74", "#f92672"]],
  ["abyss", "Abyss", "VS Code", ["#000c18", "#9b85ff", "#5fd93a", "#ffc66d", "#f280d0"]],
  ["kimbie-dark", "Kimbie Dark", "VS Code", ["#221a0f", "#b48ad8", "#8ab1b0", "#f79a32", "#e5566c"]],
  ["tomorrow-night-blue", "Tomorrow Night Blue", "VS Code", ["#002451", "#ebbbff", "#99ffff", "#ffc58f", "#ff9da4"]],
  ["red", "Red", "VS Code", ["#390000", "#e6a3ff", "#a8ff60", "#fb9a4b", "#ff6b6b"]],
  ["high-contrast", "High Contrast", "VS Code", ["#000000", "#d6a2ff", "#89d185", "#ffb454", "#f48771"]],
  ["tokyo-night", "Tokyo Night", "Community", ["#1a1b26", "#bb9af7", "#73daca", "#e0af68", "#f7768e"]],
  ["aura", "Aura", "Community", ["#15141b", "#a277ff", "#61ffca", "#ffca85", "#f694ff"]],
  ["synthwave-84", "SynthWave '84", "Community", ["#262335", "#ff7edb", "#36f9f6", "#fede5d", "#f97e72"]],
  ["panda", "Panda", "Community", ["#292a2b", "#b084eb", "#19f9d8", "#ffb86c", "#ff75b5"]],
  ["overnight", "Overnight", "Community", ["#011627", "#c792ea", "#80cbc4", "#ecc48d", "#ff5874"]],
  ["horizon-morning", "Morning Horizon", "SAP Fiori Horizon", ["#ffffff", "#6a45e8", "#046c7a", "#c35500", "#b00041"]],
  ["horizon-evening", "Evening Horizon", "SAP Fiori Horizon", ["#1d232a", "#c0a5ff", "#7fd9de", "#ffc847", "#ff8af0"]],
];

const picker = document.getElementById("palette-picker");
const stage = document.getElementById("palette-stage");
const [imgA, imgB] = stage.querySelectorAll("img");
const nameEl = document.getElementById("palette-name");
const fromEl = document.getElementById("palette-from");
let shown = imgA;
let wanted = "dark";

const swatches = PALETTES.map(([id, name, , colors], i) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "swatch";
  button.setAttribute("role", "radio");
  button.setAttribute("aria-checked", String(i === 0));
  button.tabIndex = i === 0 ? 0 : -1;
  button.dataset.id = id;
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.setAttribute("aria-hidden", "true");
  chip.style.background = colors[0];
  for (const c of colors.slice(1)) {
    const dot = document.createElement("i");
    dot.style.background = c;
    chip.append(dot);
  }
  const label = document.createElement("span");
  label.textContent = name;
  button.append(chip, label);
  button.addEventListener("click", () => choose(i));
  button.addEventListener("pointerenter", () => {
    new Image().src = `images/themes/${id}.png`;
  });
  picker.append(button);
  return button;
});

function choose(index, focus = false) {
  const [id, name, from] = PALETTES[index];
  swatches.forEach((swatch, i) => {
    swatch.setAttribute("aria-checked", String(i === index));
    swatch.tabIndex = i === index ? 0 : -1;
  });
  if (focus) swatches[index].focus();
  nameEl.textContent = name;
  fromEl.textContent = from;
  wanted = id;

  const next = shown === imgA ? imgB : imgA;
  next.onload = () => {
    if (wanted !== id) return;
    next.alt = `The library in the ${name} palette`;
    next.removeAttribute("aria-hidden");
    shown.alt = "";
    shown.setAttribute("aria-hidden", "true");
    next.classList.add("is-shown");
    shown.classList.remove("is-shown");
    shown = next;
  };
  next.src = `images/themes/${id}.png`;
}

picker.addEventListener("keydown", (event) => {
  const current = swatches.findIndex((s) => s.getAttribute("aria-checked") === "true");
  const cols = getComputedStyle(picker).gridTemplateColumns.split(" ").length;
  const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[event.key];
  if (move === undefined) return;
  event.preventDefault();
  choose((current + move + swatches.length) % swatches.length, true);
});

/* ------------------------------------------------------------------ tabs */

const tablist = document.querySelector(".tabs");
const tabs = [...tablist.querySelectorAll("[role=tab]")];
const indicator = tablist.querySelector(".tab-indicator");

function placeIndicator() {
  const tab = tabs.find((t) => t.getAttribute("aria-selected") === "true");
  indicator.style.setProperty("--x", `${tab.offsetLeft}px`);
  indicator.style.setProperty("--w", `${tab.offsetWidth}px`);
  indicator.style.top = `${tab.offsetTop}px`;
}

function select(tab, focus = false) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
  if (focus) tab.focus();
  placeIndicator();
}

for (const tab of tabs) tab.addEventListener("click", () => select(tab));
tablist.addEventListener("keydown", (event) => {
  const i = tabs.indexOf(document.activeElement);
  if (i < 0) return;
  const move = { ArrowRight: 1, ArrowLeft: -1, Home: -i, End: tabs.length - 1 - i }[event.key];
  if (move === undefined) return;
  event.preventDefault();
  select(tabs[(i + move + tabs.length) % tabs.length], true);
});

// Pick the visitor's platform first — a guess, and only a default.
const platform = navigator.userAgentData?.platform ?? navigator.platform ?? "";
if (/win/i.test(platform)) select(tabs[1]);
else if (/linux/i.test(platform) && !/android/i.test(navigator.userAgent)) select(tabs[2]);
else placeIndicator();
document.fonts?.ready.then(placeIndicator);
window.addEventListener("resize", placeIndicator);
