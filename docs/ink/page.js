import { createInk, INK_ORDER } from "./fluid.js";

const root = document.documentElement;
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;
const narrow = () => innerWidth < 761;

/* ---------------------------------------------------------------- data */

const TOOLS = [
  ["Claude Code", [["skill", "~/.claude/skills"], ["agent", "~/.claude/agents"], ["command", "~/.claude/commands"], ["rule", "~/.claude/CLAUDE.md"]]],
  ["Cursor", [["skill", "~/.cursor/skills"], ["agent", "~/.cursor/agents"], ["rule", "~/.cursor/rules"]]],
  ["Codex", [["skill", "~/.codex/skills"], ["agent", "~/.codex/agents"], ["command", "~/.codex/prompts"]]],
  ["OpenCode", [["skill", "~/.config/opencode/skills"], ["agent", "~/.config/opencode/agents"], ["command", "~/.config/opencode/commands"]]],
  ["Antigravity", [["skill", "~/.gemini/config/skills"]]],
  ["GitHub Copilot", [["skill", "~/.copilot/skills"], ["command", ".github/prompts", true], ["rule", ".github/instructions", true]]],
  ["Cline", [["rule", "~/Documents/Cline/Rules"], ["rule", ".clinerules", true]]],
  ["Trae", [["skill", "~/.trae/skills"], ["rule", "~/.trae/user_rules"]]],
  ["Windsurf", [["skill", "~/.codeium/windsurf/skills"], ["rule", "~/.windsurf/rules"]]],
  ["Goose", [["skill", "~/.config/goose/skills"]]],
  ["Hermes", [["skill", "~/.hermes/skills"]]],
  ["Pi", [["skill", "~/.pi/agent/skills"], ["rule", "AGENTS.md", true]]],
  ["Gemini CLI", [["command", "~/.gemini/commands"]]],
  ["Roo Code", [["rule", "~/.roo/rules"]]],
  ["Continue", [["command", ".continue/prompts", true], ["rule", ".continue/rules", true]]],
  ["Shared", [["skill", "~/.agents/skills"]]],
];

const PALETTES = [
  ["light", "Light", "light"], ["dark", "Dark", "dark"],
  ["quiet-light", "Quiet Light", "light"], ["solarized-light", "Solarized Light", "light"],
  ["solarized-dark", "Solarized Dark", "dark"], ["monokai", "Monokai", "dark"],
  ["abyss", "Abyss", "dark"], ["kimbie-dark", "Kimbie Dark", "dark"],
  ["tomorrow-night-blue", "Tomorrow Night Blue", "dark"], ["red", "Red", "dark"],
  ["high-contrast", "High Contrast", "dark"], ["tokyo-night", "Tokyo Night", "dark"],
  ["aura", "Aura", "dark"], ["synthwave-84", "SynthWave ’84", "dark"],
  ["panda", "Panda", "dark"], ["overnight", "Overnight", "dark"],
  ["horizon-morning", "Morning Horizon", "light"], ["horizon-evening", "Evening Horizon", "dark"],
];

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) n.append(k);
  return n;
}

const rows = document.getElementById("tool-rows");
TOOLS.forEach(([name, paths], i) => {
  const cell = el("td", { class: "paths" });
  for (const [type, p, project] of paths) {
    const s = el("span", {}, el("span", { class: `tsq ${type}`, "aria-hidden": "true" }), p);
    s.setAttribute("title", `${type[0].toUpperCase()}${type.slice(1)}s${project ? ", in each project" : ""}`);
    if (project) s.append(el("em", {}, "project"));
    cell.append(s);
  }
  rows.append(el("tr", {}, el("td", {}, String(i + 1).padStart(2, "0")), el("td", { class: "tool" }, name), cell));
});

const sw = document.getElementById("swatches");
for (const [id, label, appearance] of PALETTES) {
  sw.append(
    el("li", {},
      el("figure", {},
        el("img", { src: `images/themes/${id}.png`, width: "760", height: "480", loading: "lazy", decoding: "async", alt: `The library in the ${label} palette` }),
        el("figcaption", {}, label, el("span", {}, appearance)),
      ),
    ),
  );
}

/* ---------------------------------------------------------------- ink */

const canvas = document.getElementById("ink");
let ink = null;
// Shown first, so the canvas has a size to be measured by.
root.classList.add("has-gl");
try {
  // A phone gets a coarser sheet and fatter drops: fewer pixels to push, and
  // a thumb is a broader brush than a cursor.
  ink = createInk(canvas, narrow()
    ? { simRes: 96, dyeRes: 400, maxDpr: 1.5, radius: 0.004, dyeDissipation: 0.26 }
    : { simRes: 128, dyeRes: 560, maxDpr: 2 });
} catch {
  ink = null;
}
if (!ink) {
  root.classList.remove("has-gl");
  root.classList.add("no-gl");
}

let current = "mixed";
let cycle = 0;
let travelled = 0;
function pickInk() {
  if (current !== "mixed") return current;
  return INK_ORDER[cycle % 4];
}

// Lay the headline's own colours down behind it: each word in its ink.
function inkTheHeadline(stagger) {
  const words = [...document.querySelectorAll("#hero-title .w")];
  const base = canvas.getBoundingClientRect();
  words.forEach((w, i) => {
    const type = INK_ORDER[i];
    const r = w.getBoundingClientRect();
    const go = () => {
      const n = narrow() ? 3 : 4;
      for (let k = 0; k < n; k++) {
        const x = r.left - base.left + r.width * (0.12 + (0.76 * k) / (n - 1));
        const y = r.top - base.top + r.height * (0.45 + (Math.random() - 0.5) * 0.2);
        const a = Math.random() * Math.PI * 2;
        ink.splat(x, y, Math.cos(a) * 14, Math.sin(a) * 14 + 6, type, 0.45, narrow() ? 1.6 : 2.2);
      }
    };
    if (stagger) setTimeout(() => { go(); wake(); }, 260 + i * 220);
    else go();
  });
}

let raf = 0;
let last = 0;
let lastInput = performance.now();
let lastActivity = performance.now();
let lastAmbient = 0;
let heroVisible = true;
let lastScrollY = scrollY;
let lastScrollSplat = 0;

function frame(now) {
  raf = 0;
  if (!ink || document.hidden) return;
  const interval = now - last;
  const dt = Math.min(interval / 1000, 1 / 30);
  last = now;
  adapt(interval);

  const scrolled = scrollY - lastScrollY;
  if (scrolled) {
    ink.scroll(scrolled);
    lastScrollY = scrollY;
  }

  // Idle in the hero: a drop now and then, so the page is never dry.
  if (heroVisible && now - lastInput > 3200 && now - lastAmbient > (coarse ? 2200 : 2800)) {
    lastAmbient = now;
    const h1 = document.getElementById("hero-title").getBoundingClientRect();
    const x = h1.left + Math.random() * Math.min(h1.width, innerWidth - h1.left);
    const y = h1.top + Math.random() * h1.height;
    const a = Math.random() * Math.PI * 2;
    ink.splat(x, y, Math.cos(a) * 30, Math.sin(a) * 30, INK_ORDER[Math.floor(Math.random() * 4)], 0.5, narrow() ? 1.5 : 1.8);
    lastActivity = now;
  }

  ink.step(dt);
  ink.render();

  // Nothing moving and nothing to add: let the GPU rest until something happens.
  if (heroVisible || now - lastActivity < 9000) raf = requestAnimationFrame(frame);
}

// A device that cannot keep up draws the same ink at a lower resolution
// rather than stuttering. It only ever steps down.
const SCALES = [2, 1.5, 1, 0.75, 0.5];
let slow = 0;
let measured = 0;
function adapt(interval) {
  if (interval > 200) return; // a paused tab, not a slow one
  measured++;
  if (measured < 30) return;
  slow = interval > 26 ? slow + 1 : Math.max(0, slow - 1);
  if (slow < 45) return;
  slow = 0;
  const next = SCALES.find((v) => v < ink.params.dpr);
  if (next) ink.setScale(next);
  ink.params.pressureIters = Math.max(8, ink.params.pressureIters - 4);
}

function wake() {
  lastActivity = performance.now();
  if (!raf && ink && !still && !document.hidden) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}

function paintStill() {
  // One print, no press run: the ink is laid down, settled, and left.
  ink.resize();
  inkTheHeadline(false);
  for (let i = 0; i < 90; i++) ink.step(1 / 60);
  ink.render();
}

if (ink) {
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    raf = 0;
    ink = null;
    root.classList.remove("has-gl");
    root.classList.add("no-gl");
  });

  const start = () => {
    if (still) {
      paintStill();
      let t = 0;
      addEventListener("resize", () => {
        clearTimeout(t);
        t = setTimeout(() => ink && paintStill(), 200);
      });
      return;
    }
    ink.resize();
    inkTheHeadline(true);
    wake();
  };
  (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(start));

  if (!still) {
    addEventListener("resize", () => { if (ink?.resize()) wake(); });

    let px = null, py = null;
    const move = (x, y, strength) => {
      if (px === null) { px = x; py = y; return; }
      const dx = x - px, dy = y - py;
      px = x; py = y;
      const d = Math.hypot(dx, dy);
      if (d < 0.5) return;
      travelled += d;
      if (travelled > 520) { travelled = 0; cycle++; }
      ink.splat(x, y, dx, dy, pickInk(), strength * Math.min(1, 0.2 + d / 80), 0.8);
      lastInput = performance.now();
      wake();
    };

    addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      move(e.clientX, e.clientY, 0.2);
    }, { passive: true });
    document.addEventListener("pointerleave", () => { px = py = null; });

    // Touch: a finger drags ink as it scrolls; a tap leaves a drop.
    addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      px = t.clientX; py = t.clientY;
      ink.splat(t.clientX, t.clientY, 0, 0, pickInk(), 0.5, 1.4);
      lastInput = performance.now();
      wake();
    }, { passive: true });
    addEventListener("touchmove", (e) => {
      const t = e.touches[0];
      move(t.clientX, t.clientY, 0.3);
    }, { passive: true });
    addEventListener("touchend", () => { px = py = null; cycle++; }, { passive: true });

    // Scrolling drags the sheet; a fast scroll also stirs it.
    addEventListener("scroll", () => {
      const now = performance.now();
      const d = scrollY - lastScrollY;
      if (Math.abs(d) > 6 && now - lastScrollSplat > (coarse ? 70 : 110)) {
        lastScrollSplat = now;
        const x = innerWidth * (0.08 + Math.random() * 0.84);
        const y = d > 0 ? innerHeight * (0.72 + Math.random() * 0.2) : innerHeight * (0.1 + Math.random() * 0.2);
        const speed = Math.min(Math.abs(d), 90);
        travelled += speed * 3;
        if (travelled > 520) { travelled = 0; cycle++; }
        ink.splat(x, y, (Math.random() - 0.5) * 20, -Math.sign(d) * speed * 0.7, pickInk(), 0.08 + speed / 700, coarse ? 1.5 : 1.2);
      }
      wake();
    }, { passive: true });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else wake();
    });

    const hero = document.getElementById("top");
    new IntersectionObserver(([e]) => {
      heroVisible = e.isIntersecting;
      if (heroVisible) wake();
    }).observe(hero);
  }
}

if (coarse) {
  const hint = document.getElementById("draw-hint");
  if (hint) hint.textContent = "Tap, drag and scroll — the four item types are the four inks.";
}

for (const chip of document.querySelectorAll(".chip[data-ink]")) {
  chip.addEventListener("click", () => {
    current = chip.dataset.ink;
    for (const c of document.querySelectorAll(".chip[data-ink]")) c.setAttribute("aria-pressed", String(c === chip));
    if (ink && !still) {
      const r = chip.getBoundingClientRect();
      ink.splat(r.left + r.width / 2, r.top - 30, 0, -40, pickInk(), 0.7, 1.6);
      wake();
    }
  });
}

/* ---------------------------------------------------------------- disk demo */

const disk = document.getElementById("disk-demo");
const sw1 = document.getElementById("disk-switch");
const state = document.getElementById("disk-state");
sw1.addEventListener("click", () => {
  const on = sw1.getAttribute("aria-checked") !== "true";
  sw1.setAttribute("aria-checked", String(on));
  disk.dataset.on = String(on);
  state.textContent = on ? "Enabled" : "Disabled · moved";
  if (ink && !still) {
    const r = sw1.getBoundingClientRect();
    ink.splat(r.left + r.width / 2, r.top + r.height / 2, 0, on ? -30 : 30, "skill", 0.6, 1.3);
    wake();
  }
});

/* ---------------------------------------------------------------- copy */

for (const b of document.querySelectorAll(".copy")) {
  let t = 0;
  const label = b.getAttribute("aria-label");
  b.addEventListener("click", async () => {
    const text = b.dataset.copy;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el("textarea", { readonly: "", style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* nothing more to try */ }
      ta.remove();
    }
    b.classList.add("done");
    b.setAttribute("aria-label", "Copied");
    clearTimeout(t);
    t = setTimeout(() => { b.classList.remove("done"); b.setAttribute("aria-label", label); }, 1600);
  });
}

/* ---------------------------------------------------------------- tabs */

const tabs = [...document.querySelectorAll('[role="tab"]')];
function select(tab, focus) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
  }
  if (focus) tab.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener("click", () => select(t, false));
  t.addEventListener("keydown", (e) => {
    const k = e.key;
    let j = null;
    if (k === "ArrowRight") j = (i + 1) % tabs.length;
    else if (k === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
    else if (k === "Home") j = 0;
    else if (k === "End") j = tabs.length - 1;
    if (j !== null) { e.preventDefault(); select(tabs[j], true); }
  });
});
// Offer the visitor's own platform first.
const ua = navigator.userAgent;
if (/Windows/i.test(ua)) select(document.getElementById("tab-win"), false);
else if (/Linux/i.test(ua) && !/Android/i.test(ua)) select(document.getElementById("tab-linux"), false);
