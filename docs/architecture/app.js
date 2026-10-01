/**
 * The story around the scene: builds the text from content.js, maps scroll
 * onto what the scene shows (ScrollTrigger, smoothed by Lenis, all on the
 * GSAP ticker so scroll and render share one clock), runs the one load
 * sequence, and owns the explore mode's panels and keyboard.
 */

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";
import { animate } from "motion";
import { blob, LAYERS, MODULES, PATHS } from "./content.js";

gsap.registerPlugin(ScrollTrigger, SplitText);

const root = document.documentElement;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrowQuery = matchMedia("(max-width: 760px)");
const byId = new Map(MODULES.map((m) => [m.id, m]));
const pathById = new Map(PATHS.map((p) => [p.id, p]));
const $ = (s, el = document) => el.querySelector(s);

/** Relative weight of each step's scroll distance: the bold moment gets room. */
const weightOf = (s) => (s.long ? 2.6 : 1);
const STEP_H = { floors: 62, scan: 44, toggle: 52, seams: 56 };

const view = { mode: "hero", t: 0, floor: 0, filter: null, selected: null, hovered: null };
let scene = null;

// ------------------------------------------------------------------ theme

const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : darkQuery.matches);
const themeBtn = $("#theme");
function syncTheme() {
  const dark = isDark();
  root.classList.toggle("is-dark", dark);
  themeBtn.setAttribute("aria-label", dark ? "Switch to light" : "Switch to dark");
  scene?.applyPalette();
}
themeBtn.addEventListener("click", () => {
  root.dataset.theme = isDark() ? "light" : "dark";
  try {
    localStorage.setItem("arch-theme", root.dataset.theme);
  } catch {}
  syncTheme();
});
darkQuery.addEventListener("change", () => {
  if (!root.dataset.theme) syncTheme();
});
syncTheme();

// ---------------------------------------------------------------- the text

const floorName = (i) => LAYERS[i].name;
const layerVar = (i) => `var(--l${i})`;

function buildFloors() {
  const list = $("#floor-list");
  list.innerHTML = [...LAYERS]
    .map((l, i) => ({ l, i }))
    .reverse()
    .map(
      ({ l, i }) => `
      <li data-floor="${i}" style="--c: ${layerVar(i)}">
        <div class="name">${l.name}<code>${l.path}</code></div>
        <div class="knows">${l.knows}</div>
        <div class="about">${l.about} ${l.more ?? ""}</div>
      </li>`,
    )
    .join("");
}

function buildPaths() {
  for (const path of PATHS) {
    const sec = document.getElementById(path.id);
    const weights = path.steps.map(weightOf);
    const total = weights.reduce((a, b) => a + b, 0);
    sec.style.setProperty("--steps", total);
    sec.style.setProperty("--step-h", `${STEP_H[path.id]}svh`);
    const n = path.steps.length;
    const steps = path.steps
      .map((s, i) => {
        const m = byId.get(s.m);
        return `
        <li>
          <button class="tick" type="button" data-step="${i}" aria-label="Step ${i + 1} of ${n}: ${escapeHtml(m.title)}"></button>
          <div class="step-body">
            <div class="step-meta">
              <span class="n">${i + 1} / ${n}</span>
              <span class="who${m.mono === false ? " is-sans" : ""}">${escapeHtml(m.title)}</span>
              <span class="floor" style="--fc: ${m.ghost ? "var(--ban)" : layerVar(m.layer)}"><i></i>${m.annex === "cli" ? "CLI" : m.annex === "popover" ? "Popover" : floorName(m.layer)}</span>
            </div>
            <p class="step-text">${s.text}</p>
          </div>
        </li>`;
      })
      .join("");
    sec.innerHTML = `
      <div class="pin">
        <div class="panel" style="--c: var(--${path.color})">
          <h2><span class="swatch" aria-hidden="true"></span>${path.name}: ${path.tagline.toLowerCase()}</h2>
          <p class="summary">${path.summary}</p>
          <ol class="steps${reduced ? "" : ""}" style="--n: ${n}">${steps}</ol>
        </div>
      </div>`;
    const go = (i) => {
      const before = weights.slice(0, i).reduce((a, c) => a + c, 0);
      scrollToProgress(sec, (before + weights[i] * 0.6) / total);
    };
    sec.querySelectorAll(".tick").forEach((b) => {
      b.addEventListener("click", () => go(Number(b.dataset.step)));
      b.addEventListener("keydown", (e) => {
        // Walk from the focused tick, not the step the scroll has reached yet.
        const i = Number(b.dataset.step);
        const next =
          e.key === "ArrowRight" || e.key === "ArrowDown"
            ? i + 1
            : e.key === "ArrowLeft" || e.key === "ArrowUp"
              ? i - 1
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? n - 1
                  : null;
        if (next === null || next < 0 || next >= n) return;
        e.preventDefault();
        const target = sec.querySelector(`.tick[data-step="${next}"]`);
        target.tabIndex = 0;
        b.tabIndex = -1;
        target.focus({ preventScroll: true });
        go(next);
      });
    });
  }
}

// ----------------------------------------------------------------- scroll

let lenis = null;

function scrollToY(y) {
  if (lenis) lenis.scrollTo(y, { duration: 1.1 });
  else window.scrollTo({ top: y, behavior: reduced ? "auto" : "smooth" });
}
function scrollToProgress(sec, p) {
  const top = sec.getBoundingClientRect().top + window.scrollY;
  const span = sec.offsetHeight - window.innerHeight;
  scrollToY(top + span * p + 1);
}

/** Maps a section's scroll progress onto steps of unequal length. */
function stepTime(path, p) {
  const w = path.steps.map(weightOf);
  const total = w.reduce((a, b) => a + b, 0);
  let u = p * total;
  for (let i = 0; i < w.length; i++) {
    if (u < w[i] || i === w.length - 1) return i + Math.min(0.9999, u / w[i]);
    u -= w[i];
  }
  return 0;
}

const current = { floors: -1, scan: -1, toggle: -1, seams: -1 };
function markStep(id, i) {
  if (current[id] === i) return;
  current[id] = i;
  if (id === "floors") {
    document.querySelectorAll("#floor-list li").forEach((li) => {
      li.classList.toggle("is-current", Number(li.dataset.floor) === i);
    });
    return;
  }
  // One tab stop per rail: the current step. Arrow keys walk the rest.
  const ticks = document.querySelectorAll(`#${id} .tick`);
  ticks.forEach((b, j) => {
    b.classList.toggle("is-current", j === i);
    b.classList.toggle("is-past", j < i);
    b.tabIndex = j === i ? 0 : -1;
    if (j === i) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  });
}

function setMode(mode) {
  if (view.mode === mode) return;
  view.mode = mode;
  const live = mode === "explore";
  $("#stage").classList.toggle("is-live", live);
  scene?.setExplore(live);
  if (live && !view.selected) scene?.resetExploreCamera(reduced ? null : gsap);
  if (!live) {
    view.hovered = null;
    $("#stage").classList.remove("is-hovering");
  }
  layoutOffset();
}

function setupScroll() {
  if (!reduced) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  // In-page links scroll (smoothly, unless motion is reduced) and move focus
  // with them, so the next Tab starts where the reader now is.
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener("click", (e) => {
      const t = document.querySelector(a.getAttribute("href"));
      if (!t) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(t, { duration: 1.4 });
      else t.scrollIntoView();
      if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
      t.focus({ preventScroll: true });
    });
  });

  const sections = ["hero", "floors", "scan", "toggle", "seams", "explore"];
  for (const id of sections) {
    const el = document.getElementById(id);
    ScrollTrigger.create({
      trigger: el,
      start: "top 50%",
      end: "bottom 50%",
      onToggle: (self) => self.isActive && setMode(id),
    });
  }
  ScrollTrigger.create({
    trigger: "#floors",
    start: "top top",
    end: "bottom bottom",
    onUpdate: (self) => {
      if (view.mode !== "floors") return;
      view.t = Math.min(3, Math.max(0, self.progress * 4 - 0.5));
      markStep("floors", Math.round(view.t));
    },
  });
  for (const path of PATHS) {
    ScrollTrigger.create({
      trigger: `#${path.id}`,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        const t = stepTime(path, self.progress);
        if (view.mode === path.id) view.t = t;
        markStep(path.id, Math.floor(t));
      },
    });
  }
  // A step list starts on its first step even before it is scrolled to.
  for (const path of PATHS) markStep(path.id, 0);
  markStep("floors", 0);
  // Modes switch at the section edges; progress needs to be right on entry.
  ScrollTrigger.addEventListener("refresh", () => ScrollTrigger.update());
}

/** Where the building sits: clear of whichever panels are on screen. */
function layoutOffset() {
  if (!scene) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const narrow = narrowQuery.matches;
  let x = 0;
  let y = 0;
  if (narrow) {
    y = view.mode === "explore" ? -H * 0.08 : view.mode === "hero" ? -H * 0.24 : -H * 0.2;
  } else if (view.mode === "explore") {
    const left = W > 1100 ? 336 : 306;
    const right = view.selected ? (W > 1100 ? 396 : 356) : 0;
    x = (left - right) / 2;
  } else {
    const col = Number.parseFloat(getComputedStyle(root).getPropertyValue("--col")) || 440;
    x = Math.min(W * 0.22, (col + 40) / 2 + 50);
  }
  scene.setOffset({ x, y });
}

// ---------------------------------------------------------------- explore

function buildExplore() {
  const filter = $("#filter");
  const options = [
    { id: null, name: "All paths" },
    ...PATHS.map((p) => ({ id: p.id, name: p.name, color: p.color })),
  ];
  filter.insertAdjacentHTML(
    "beforeend",
    options
      .map(
        (o) =>
          `<button class="chip" type="button" role="radio" aria-checked="${o.id === null}" data-path="${o.id ?? ""}" tabindex="${o.id === null ? 0 : -1}"${o.color ? ` style="--c: var(--${o.color})"` : ""}>${o.color ? "<i></i>" : ""}${o.name}</button>`,
      )
      .join(""),
  );
  const chips = [...filter.querySelectorAll(".chip")];
  chips.forEach((c, i) => {
    c.addEventListener("click", () => setFilter(c.dataset.path || null));
    c.addEventListener("keydown", (e) => {
      const d =
        e.key === "ArrowRight" || e.key === "ArrowDown"
          ? 1
          : e.key === "ArrowLeft" || e.key === "ArrowUp"
            ? -1
            : 0;
      if (!d) return;
      e.preventDefault();
      const next = chips[(i + d + chips.length) % chips.length];
      next.focus();
      setFilter(next.dataset.path || null);
    });
  });

  const index = $("#index");
  index.setAttribute("data-lenis-prevent", "");
  index.innerHTML = [3, 2, 1, 0]
    .map((li) => {
      const mods = MODULES.filter((m) => m.layer === li);
      return `
        <h3 style="--c: ${layerVar(li)}">${LAYERS[li].name}<code>${LAYERS[li].path}</code></h3>
        <ul>${mods
          .map(
            (m) =>
              `<li><button type="button" data-id="${m.id}" aria-pressed="false" class="${m.mono === false ? "is-sans" : ""}" style="--c: ${m.ghost ? "var(--ban)" : layerVar(li)}; --c-bg: var(--l${li}-bg)">${escapeHtml(m.title)}</button></li>`,
          )
          .join("")}</ul>`;
    })
    .join("");
  index.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => select(b.dataset.id, true));
    b.addEventListener("pointerenter", () => hover(b.dataset.id));
    b.addEventListener("pointerleave", () => hover(null));
  });
  $("#detail").setAttribute("data-lenis-prevent", "");

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && view.selected) {
      const id = view.selected;
      select(null);
      index.querySelector(`[data-id="${id}"]`)?.focus();
    }
  });

  // Pick in the scene: a click that did not turn into a drag.
  const canvas = $("#scene");
  // A plain wheel always scrolls the page, so explore never traps the
  // reader; pinch (which arrives as ctrl + wheel) or Ctrl/⌘ + wheel zooms.
  $("#stage").addEventListener(
    "wheel",
    (e) => {
      if (view.mode !== "explore" || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      scene?.zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)));
    },
    { passive: false },
  );
  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || view.mode !== "explore") return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    down = null;
    if (moved > 5) return;
    const id = scene.pickAt(e.clientX, e.clientY);
    select(id, true);
  });
  let pending = null;
  canvas.addEventListener("pointermove", (e) => {
    if (view.mode !== "explore" || e.pointerType !== "mouse") return;
    pending = e;
  });
  canvas.addEventListener("pointerleave", () => hover(null));
  gsap.ticker.add(() => {
    if (!pending) return;
    const id = scene.pickAt(pending.clientX, pending.clientY);
    pending = null;
    hover(id);
  });

  requestAnimationFrame(() => moveIndicator(false));
}

function moveIndicator(animated = true) {
  const chip = $(`#filter .chip[aria-checked="true"]`);
  const ind = $("#filter .filter-indicator");
  if (!chip || !ind) return;
  const to = { x: chip.offsetLeft, y: chip.offsetTop, width: chip.offsetWidth };
  if (!animated || reduced) {
    ind.style.transform = `translate(${to.x}px, ${to.y}px)`;
    ind.style.width = `${to.width}px`;
    return;
  }
  animate(
    ind,
    { x: to.x, y: to.y, width: to.width },
    { type: "spring", duration: 0.35, bounce: 0 },
  );
}

function setFilter(id) {
  view.filter = id;
  document.querySelectorAll("#filter .chip").forEach((c) => {
    const on = (c.dataset.path || null) === id;
    c.setAttribute("aria-checked", String(on));
    c.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll("#index button").forEach((b) => {
    const m = byId.get(b.dataset.id);
    b.classList.toggle("is-off", !!id && !m.paths.includes(id));
  });
  moveIndicator();
}

function hover(id) {
  if (view.hovered === id) return;
  view.hovered = id;
  $("#stage").classList.toggle("is-hovering", !!id);
  document.querySelectorAll("#index button").forEach((b) => {
    b.classList.toggle("is-hover", b.dataset.id === id);
  });
}

function select(id, fly = false) {
  const was = view.selected;
  view.selected = id;
  document.querySelectorAll("#index button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.id === id));
  });
  const panel = $("#detail");
  if (!id) {
    panel.hidden = true;
    layoutOffset();
    return;
  }
  const m = byId.get(id);
  const layerColour = m.ghost ? "var(--ban)" : layerVar(m.layer);
  const where =
    m.annex === "cli"
      ? "Beside the domain"
      : m.annex === "popover"
        ? "Beside the interface"
        : `${LAYERS[m.layer].name} floor`;
  panel.style.setProperty("--c", layerColour);
  panel.innerHTML = `
    <div class="detail-top">
      <div>
        <span class="floor"><i></i>${where}</span>
        <h3 class="${m.mono === false ? "is-sans" : ""}">${escapeHtml(m.title)}</h3>
        <p class="line">${m.lineMono ? `<code>${escapeHtml(m.line)}</code>` : escapeHtml(m.line ?? "")}</p>
      </div>
      <button class="icon-btn close" type="button" aria-label="Close ${escapeHtml(m.title)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
    </div>
    <ul class="points">${m.points.map((p) => `<li>${p}</li>`).join("")}</ul>
    ${m.aside ? `<p class="aside">${m.aside}</p>` : ""}
    ${
      m.paths.length
        ? `<h4>On the paths</h4><div class="on">${m.paths
            .map(
              (p) =>
                `<button type="button" data-path="${p}" style="--c: var(--${pathById.get(p).color})"><i></i>${pathById.get(p).name}</button>`,
            )
            .join("")}</div>`
        : ""
    }
    <h4>Source</h4>
    <ul class="files">${m.files.map((f) => `<li><a href="${blob(f)}">${f}</a></li>`).join("")}</ul>
    <p class="hint">Esc closes this. The module list reaches every block by keyboard.</p>`;
  panel.querySelector(".close").addEventListener("click", () => {
    select(null);
    document.querySelector(`#index [data-id="${id}"]`)?.focus();
  });
  panel.querySelectorAll(".on button").forEach((b) => {
    b.addEventListener("click", () => setFilter(b.dataset.path));
  });
  const opening = panel.hidden || !was;
  panel.hidden = false;
  panel.scrollTop = 0;
  if (!reduced) {
    if (opening)
      animate(panel, { opacity: [0, 1], x: [16, 0] }, { type: "spring", duration: 0.4, bounce: 0 });
    else animate(panel, { opacity: [0.4, 1] }, { duration: 0.18, ease: "easeOut" });
  }
  layoutOffset();
  if (fly && scene && view.mode === "explore") scene.focusOn(id, gsap);
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// -------------------------------------------------------------------- load

function intro() {
  const copy = $(".hero-copy");
  root.classList.remove("js-intro");
  if (reduced || !scene) {
    if (scene) {
      scene.intro.dots = 1;
      scene.intro.floors.fill(1);
      scene.intro.edges = 1;
    }
    return;
  }
  const split = SplitText.create("#headline", { type: "words", wordsClass: "word" });
  const rest = [...copy.children].filter((el) => el.id !== "headline");
  const i = scene.intro;
  i.dots = 0;
  i.floors.fill(0);
  i.edges = 0;
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.set(copy, { autoAlpha: 1 })
    .to(i, { dots: 1, duration: 1.5, ease: "power2.inOut" }, 0)
    .to(i.floors, { 0: 1, duration: 0.6 }, 0);
  for (let f = 1; f < 4; f++)
    tl.to(i.floors, { [f]: 1, duration: 0.9, ease: "power3.out" }, 0.35 + (f - 1) * 0.2);
  tl.to(i, { edges: 1, duration: 0.8, ease: "power1.out" }, 1.2)
    .from(
      split.words,
      { yPercent: 40, autoAlpha: 0, filter: "blur(6px)", duration: 0.8, stagger: 0.06 },
      0.25,
    )
    .from(rest, { y: 12, autoAlpha: 0, filter: "blur(4px)", duration: 0.7, stagger: 0.1 }, 0.8);
}

// ------------------------------------------------------------------- start

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

async function start() {
  buildFloors();
  buildPaths();
  buildExplore();

  if (webglAvailable()) {
    try {
      const { createScene } = await import("./scene.js");
      scene = createScene({
        canvas: $("#scene"),
        labels: $("#labels"),
        reduced,
        view,
        onPick: (id) => view.mode === "explore" && select(id, true),
        onHover: (id) => view.mode === "explore" && hover(id),
      });
      layoutOffset();
      await scene.build();
      // The scene reads the same object the story writes.
      // A handle for the screenshot script; nothing on the page uses it.
      Object.defineProperty(window, "__arch", {
        value: {
          scene,
          view,
          select,
          setFilter,
          get lenis() {
            return lenis;
          },
          jump(id, p) {
            const sec = document.getElementById(id);
            const y =
              sec.getBoundingClientRect().top +
              window.scrollY +
              (sec.offsetHeight - window.innerHeight) * p +
              1;
            if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
            else window.scrollTo(0, y);
          },
        },
        configurable: true,
      });
    } catch (err) {
      console.warn("The scene could not start; showing the static figure instead.", err);
      scene = null;
    }
  }
  if (!scene) root.classList.add("no-webgl");

  setupScroll();
  layoutOffset();
  window.addEventListener("resize", () => {
    scene?.resize();
    layoutOffset();
    moveIndicator(false);
  });
  narrowQuery.addEventListener("change", layoutOffset);

  if (scene) {
    gsap.ticker.add((_, deltaMs) => scene.frame(Math.min(0.05, deltaMs / 1000)));
  }
  intro();
  ScrollTrigger.refresh();
}

start();
