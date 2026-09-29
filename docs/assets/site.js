// Phosphor — everything on the page that is not the hero terminal.

const root = document.documentElement;
root.classList.add("js");
const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/* phosphor: amber or green, remembered per viewer */
const toggle = document.getElementById("phos-toggle");
function setPhosphor(p) {
  root.dataset.phosphor = p;
  try {
    localStorage.setItem("phosphor", p);
  } catch {
    /* private window: it just won't be remembered */
  }
  const label = p === "green" ? "P1 green" : "P3 amber";
  toggle.querySelector(".phos-label").textContent = label;
  toggle.setAttribute("aria-label", `Phosphor colour: ${label}. Switch to ${p === "green" ? "amber" : "green"}`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue("--bg").trim();
  window.dispatchEvent(new Event("phosphor-changed"));
}
setPhosphor(root.dataset.phosphor === "green" ? "green" : "amber");
toggle.addEventListener("click", () => setPhosphor(root.dataset.phosphor === "green" ? "amber" : "green"));
window.addEventListener("phosphor", (e) => setPhosphor(e.detail));

/* copy buttons */
for (const b of document.querySelectorAll("[data-copy]")) {
  let t = 0;
  b.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = b.dataset.copy;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.append(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* nothing more to try */
      }
      ta.remove();
    }
    b.classList.add("done");
    b.setAttribute("aria-label", "Copied");
    clearTimeout(t);
    t = setTimeout(() => {
      b.classList.remove("done");
      b.setAttribute("aria-label", "Copy");
    }, 1600);
  });
}

/* screenshot viewers: phosphor by default, true colour on request */
for (const v of document.querySelectorAll("[data-viewer]")) {
  const b = v.querySelector(".viewer-toggle");
  b.addEventListener("click", () => {
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
    v.classList.toggle("true", on);
  });
}

/* palettes */
const PALETTES = [
  ["light", "Light"], ["dark", "Dark"], ["quiet-light", "Quiet Light"], ["solarized-light", "Solarized Light"],
  ["solarized-dark", "Solarized Dark"], ["monokai", "Monokai"], ["abyss", "Abyss"], ["kimbie-dark", "Kimbie Dark"],
  ["tomorrow-night-blue", "Tomorrow Night Blue"], ["red", "Red"], ["high-contrast", "High Contrast"],
  ["tokyo-night", "Tokyo Night"], ["aura", "Aura"], ["synthwave-84", "SynthWave ’84"], ["panda", "Panda"],
  ["overnight", "Overnight"], ["horizon-morning", "Morning Horizon"], ["horizon-evening", "Evening Horizon"],
];
const list = document.getElementById("themes");
if (list) {
  for (const [id, name] of PALETTES) {
    const li = document.createElement("li");
    li.className = "theme";
    li.innerHTML = `<button type="button" class="theme-btn" aria-pressed="false" data-id="${id}">
      <span class="theme-img"><img src="images/themes/${id}.png" width="760" height="480" loading="lazy" decoding="async" alt="The library in the ${name} palette"></span>
      <span class="theme-name">${name}</span></button>`;
    list.append(li);
  }
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".theme-btn");
    if (!b) return;
    const on = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(on));
  });
}

/* install tabs */
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
for (const t of tabs) {
  t.addEventListener("click", () => select(t));
  t.addEventListener("keydown", (e) => {
    const i = tabs.indexOf(t);
    if (e.key === "ArrowRight") select(tabs[(i + 1) % tabs.length], true);
    else if (e.key === "ArrowLeft") select(tabs[(i - 1 + tabs.length) % tabs.length], true);
    else if (e.key === "Home") select(tabs[0], true);
    else if (e.key === "End") select(tabs[tabs.length - 1], true);
    else return;
    e.preventDefault();
  });
}
if (/Win/.test(navigator.platform)) select(tabs[1]);
else if (/Linux/.test(navigator.platform) && !/Android/.test(navigator.userAgent)) select(tabs[2]);

/* each section's command types itself once, then its output appears */
const sections = [...document.querySelectorAll(".sec")];
for (const s of sections) {
  for (const el of s.querySelectorAll(":scope > :not(.cmd)")) el.classList.add("reveal");
}
function typeCommand(sec) {
  const el = sec.querySelector(".cmd-text");
  const outs = sec.querySelectorAll(".reveal");
  const show = () => outs.forEach((o, i) => setTimeout(() => o.classList.add("in"), i * 90));
  if (!el || reduce()) {
    outs.forEach((o) => o.classList.add("in"));
    return;
  }
  const text = el.textContent;
  el.textContent = "";
  el.classList.add("typing");
  let i = 0;
  const step = () => {
    el.textContent = text.slice(0, ++i);
    if (i < text.length) setTimeout(step, 22 + Math.random() * 30);
    else {
      setTimeout(() => el.classList.remove("typing"), 300);
      show();
    }
  };
  step();
}
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      typeCommand(e.target);
    }
  },
  { rootMargin: "0px 0px -15% 0px" },
);
for (const s of sections) io.observe(s);

/* the readout counts up once, on tabular figures */
const readout = document.querySelector(".readout");
if (readout && !reduce()) {
  const nums = [...readout.querySelectorAll("[data-count]")];
  for (const n of nums) n.textContent = "0";
  const ro = new IntersectionObserver((entries) => {
    if (!entries[0].isIntersecting) return;
    ro.disconnect();
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 900);
      const e = 1 - Math.pow(1 - p, 3);
      for (const n of nums) n.textContent = String(Math.round(Number(n.dataset.count) * e));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { threshold: 0.5 });
  ro.observe(readout);
}
