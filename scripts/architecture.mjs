/**
 * Draws the architecture figure in the README, once per colour scheme.
 *
 * A matrix rather than a box-and-arrow cloud: the columns are the four places
 * code and data live, with dependencies pointing inwards, and the rows are the
 * three paths that cross them — a scan, a toggle, and the seams that keep the
 * layers apart. Every name in a cell is a real module, so the figure is the
 * overview and a map into the source at once.
 *
 * Written as a script, not by hand, so the light and dark figures are one
 * drawing and cannot drift apart. The palettes are the application's own
 * (`src/styles/tokens.css` and the dark block in `themes.css`), and the four
 * layer colours are its four item-type colours.
 *
 * SVG, animated with CSS only: GitHub renders a README's images without
 * script, and an SVG's own stylesheet still plays.
 */

import { writeFile } from "node:fs/promises";

const OUT = new URL("../docs/images/", import.meta.url);

const PALETTES = {
  light: {
    ground: "#f7f7f9",
    dot: "#d9dbe1",
    panel: "#ffffff",
    border: "#dcdee3",
    text: "#1f2124",
    muted: "#5c6068",
    faint: "#8a8f98",
    accent: "#5b6ef5",
    toggle: "#1f8b4c",
    ban: "#c0392b",
    layers: ["#8a5c0a", "#5546b8", "#146054", "#a23048"],
    tint: 0.045,
    glow: 0.18,
  },
  dark: {
    ground: "#111215",
    dot: "#26282d",
    panel: "#1a1b1f",
    border: "#2e3137",
    text: "#e4e6ea",
    muted: "#a0a5ae",
    faint: "#6f757e",
    accent: "#7c8cff",
    toggle: "#4cc38a",
    ban: "#e06c5f",
    layers: ["#e0b070", "#b9a6ff", "#64d6c2", "#f09aad"],
    tint: 0.05,
    glow: 0.3,
  },
};

const W = 1760;
const H = 1330;

const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** The four columns: where each starts, and how wide it is. */
const COL = [0, 1, 2, 3].map((i) => ({ x: 200 + i * 405, w: 305 }));

/** The middle of the gutter between column `i` and the next. */
const gutter = (i) => COL[i].x + COL[i].w + 50;

const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function text(x, y, value, { size = 15, fill, weight = 400, font = SANS, anchor = "start", opacity, spacing } = {}) {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-family="${font}"`,
    `font-size="${size}"`,
    `font-weight="${weight}"`,
    `fill="${fill}"`,
    anchor === "start" ? "" : `text-anchor="${anchor}"`,
    opacity === undefined ? "" : `opacity="${opacity}"`,
    spacing === undefined ? "" : `letter-spacing="${spacing}"`,
  ].filter(Boolean);
  return `<text ${attrs.join(" ")}>${escape(value)}</text>`;
}

/**
 * A component: a title in the monospace of the code it names, and a line or
 * two of what it guarantees underneath.
 */
function box(p, { x, y, w, h, title, lines = [], edge, mono = true, titleSize = 17.5 }) {
  const parts = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${p.panel}" stroke="${p.border}"/>`,
  ];
  if (edge) {
    parts.push(`<rect x="${x}" y="${y + 10}" width="3" height="${h - 20}" rx="1.5" fill="${edge}"/>`);
  }
  parts.push(
    text(x + 16, y + 27, title, { size: titleSize, fill: p.text, weight: 600, font: mono ? MONO : SANS }),
  );
  lines.forEach((line, i) => {
    parts.push(text(x + 16, y + 50 + i * 20, line, { size: 15.5, fill: p.muted }));
  });
  return parts.join("\n");
}

/** A labelled arrow along `d`; `flow` makes it one of the animated paths. */
function arrow(p, d, { color, label, lx, ly, anchor = "middle", flow, dashed, marker = true }) {
  const id = `m-${color.slice(1)}`;
  const dash = dashed ? `stroke-dasharray="5 6"` : "";
  const parts = [];
  if (flow) {
    // A soft halo, the line itself, and dashes of light running along it.
    parts.push(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" opacity="${p.glow * 0.4}" class="halo"/>`,
    );
  }
  parts.push(
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="${flow ? 2 : 1.5}" stroke-linecap="round" stroke-linejoin="round" ${dash} ${marker ? `marker-end="url(#${id})"` : ""}/>`,
  );
  if (flow) {
    parts.push(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="flow ${flow}"/>`,
    );
    parts.push(spark(p, d, color, flow === "toggle" ? "1.8s" : "2.4s", `${(sparkSeed++ % 5) * 0.37}s`));
  }
  if (label) {
    parts.push(labelChip(p, lx, ly, label, color, anchor));
  }
  return parts.join("\n");
}

/** A label that sits on its line with the ground cut out behind it. */
function labelChip(p, x, y, value, color, anchor = "middle") {
  const width = value.length * 8.1 + 16;
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return [
    `<rect x="${left}" y="${y - 14}" width="${width}" height="23" rx="11.5" fill="${p.ground}" stroke="${color}" stroke-opacity="0.45"/>`,
    text(left + width / 2, y + 2.5, value, { size: 13.5, fill: color, font: MONO, anchor: "middle" }),
  ].join("\n");
}

let sparkSeed = 0;

/** A travelling spark along a flow, so the direction reads at a glance. */
function spark(p, d, color, dur, begin = "0s") {
  return `<circle r="4" fill="${color}" class="spark"><animateMotion dur="${dur}" begin="${begin}" repeatCount="indefinite" path="${d}" rotate="auto"/></circle>
<circle r="10" fill="${color}" opacity="${p.glow}" class="spark"><animateMotion dur="${dur}" begin="${begin}" repeatCount="indefinite" path="${d}"/></circle>`;
}

function markers(p) {
  const colors = [p.accent, p.toggle, p.ban, p.faint, p.muted];
  return colors
    .map(
      (c) =>
        `<marker id="m-${c.slice(1)}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1.5 L9 5 L1 8.5 z" fill="${c}"/></marker>`,
    )
    .join("\n");
}

function columns(p) {
  const heads = [
    { name: "ON DISK", path: "~, projects, your vault", knows: "the real files, never a copy" },
    { name: "DOMAIN", path: "crates/core", knows: "no Tauri, no window, no IPC" },
    { name: "ADAPTER", path: "src-tauri", knows: "Tauri and the domain" },
    { name: "INTERFACE", path: "src/", knows: "the generated bindings only" },
  ];
  return COL.map((c, i) => {
    const color = p.layers[i];
    return [
      `<rect x="${c.x - 12}" y="160" width="${c.w + 24}" height="${H - 190}" rx="18" fill="${color}" fill-opacity="${p.tint}" stroke="${color}" stroke-opacity="0.18"/>`,
      `<rect x="${c.x}" y="176" width="46" height="4" rx="2" fill="${color}"/>`,
      text(c.x, 204, heads[i].name, { size: 14.5, fill: color, weight: 700, spacing: 1.8 }),
      text(c.x, 229, heads[i].path, { size: 19, fill: p.text, weight: 650, font: MONO }),
      text(c.x, 251, heads[i].knows, { size: 15, fill: p.faint }),
    ].join("\n");
  }).join("\n");
}

/** Between the headers: which way the dependencies point. */
function dependsOn(p) {
  return [2, 3]
    .map((i) => {
      const from = COL[i].x - 4;
      const to = COL[i - 1].x + COL[i - 1].w + 4;
      const y = 214;
      return [
        arrow(p, `M${from} ${y} L${to + 4} ${y}`, { color: p.faint }),
        text((from + to) / 2, y - 10, "uses", { size: 13, fill: p.faint, anchor: "middle", font: MONO }),
      ].join("\n");
    })
    .join("\n");
}

function rowLabel(p, y, n, title, lines) {
  return [
    `<circle cx="58" cy="${y + 8}" r="15" fill="none" stroke="${p.muted}" stroke-opacity="0.6"/>`,
    text(58, y + 13.5, String(n), { size: 14, fill: p.text, weight: 700, anchor: "middle", font: MONO }),
    text(40, y + 54, title, { size: 22, fill: p.text, weight: 700 }),
    ...lines.map((l, i) => text(40, y + 80 + i * 20, l, { size: 15, fill: p.muted })),
  ].join("\n");
}

function separator(p, y) {
  return `<line x1="40" y1="${y}" x2="${W - 40}" y2="${y}" stroke="${p.border}" stroke-dasharray="2 6"/>`;
}

/** A miniature of the card grid: the end of the scan, as the user sees it. */
function cards(p, x, y) {
  const types = [p.layers[1], p.layers[2], p.layers[0], p.layers[3], p.layers[1], p.layers[2]];
  const out = [
    `<rect x="${x}" y="${y}" width="305" height="118" rx="10" fill="${p.panel}" stroke="${p.border}"/>`,
    text(x + 16, y + 27, "ItemGrid → Card", { size: 17.5, fill: p.text, weight: 600, font: MONO }),
  ];
  types.forEach((color, i) => {
    const cx = x + 16 + (i % 3) * 93;
    const cy = y + 40 + Math.floor(i / 3) * 36;
    out.push(
      `<rect x="${cx}" y="${cy}" width="85" height="30" rx="6" fill="${p.ground}" stroke="${p.border}"/>`,
      `<rect x="${cx + 8}" y="${cy + 9}" width="32" height="4" rx="2" fill="${p.muted}" opacity="0.7"/>`,
      `<rect x="${cx + 8}" y="${cy + 18}" width="20" height="4" rx="2" fill="${p.faint}" opacity="0.5"/>`,
      `<rect x="${cx + 48}" y="${cy + 10}" width="24" height="10" rx="5" fill="${color}" opacity="0.85"/>`,
    );
  });
  return out.join("\n");
}

/** The folder tree a tool reads, with the disabled sibling beside it. */
function toolFolders(p, x, y) {
  const rows = [
    ["~/.claude/skills/", p.text, 0],
    ["tdd/SKILL.md", p.muted, 16],
    ["engineering/review/SKILL.md", p.muted, 16],
    [".skillmanager-disabled/", p.toggle, 16],
    ["old-idea/SKILL.md", p.faint, 32],
    ["~/.cursor/rules/house-style.md", p.text, 0],
    ["<project>/.codex/prompts/", p.text, 0],
  ];
  const out = [
    `<rect x="${x}" y="${y}" width="305" height="232" rx="10" fill="${p.panel}" stroke="${p.border}"/>`,
    text(x + 16, y + 27, "Tool folders", { size: 17.5, fill: p.text, weight: 600 }),
    text(x + 289, y + 26, "16 tools", { size: 13.5, fill: p.faint, anchor: "end", font: MONO }),
  ];
  rows.forEach(([name, color, indent], i) => {
    out.push(text(x + 16 + indent, y + 56 + i * 22, name, { size: 14.5, fill: color, font: MONO }));
  });
  out.push(text(x + 16, y + 218, "global and per project", { size: 15.5, fill: p.faint }));
  return out.join("\n");
}

function notes(p, x, y) {
  return [
    `<rect x="${x}" y="${y}" width="305" height="148" rx="10" fill="${p.panel}" stroke="${p.border}"/>`,
    text(x + 16, y + 27, "Notes folder", { size: 17.5, fill: p.text, weight: 600 }),
    text(x + 289, y + 26, "your vault", { size: 13.5, fill: p.faint, anchor: "end", font: MONO }),
    text(x + 16, y + 54, "<entry_id>.md, one per item", { size: 14.5, fill: p.muted, font: MONO }),
    text(x + 16, y + 82, "your tags live here", { size: 15.5, fill: p.muted }),
    text(x + 16, y + 104, "rewritten only when changed", { size: 15.5, fill: p.muted }),
    text(x + 16, y + 126, "never pruned while it holds tags", { size: 15.5, fill: p.muted }),
  ].join("\n");
}

/** A straight or elbowed path through the given points. */
const via = (...points) => points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");

function draw(scheme) {
  const p = PALETTES[scheme];
  const [c1, c2, c3, c4] = COL;
  const right = (c) => c.x + c.w;
  const [g1, g2, g3] = [0, 1, 2].map(gutter);
  const R1 = 290; // scan
  const R2 = 800; // toggle
  const R3 = 1060; // seams

  // ---------------------------------------------------------------- 1 · scan
  const chips = [
    ["scan::Walk", "pairs enabled and disabled halves"],
    ["rescan::perform_rescan", "a rayon task per tool and project"],
    ["MetaStore::ensure", "a note per item, in parallel"],
    ["store::prune", "refused on a partial or noisy scan"],
    ["LibrarySnapshot", "items · plugins · broken links"],
  ];
  const chipY = (i) => R1 + i * 78;
  const mid = (i) => chipY(i) + 31;
  const scanDomain = chips
    .map(([title, line], i) =>
      box(p, { x: c2.x, y: chipY(i), w: c2.w, h: 62, title, lines: [line], edge: i === 3 ? p.ban : p.layers[1] }),
    )
    .join("\n");
  const chipLinks = chips
    .slice(0, -1)
    .map((_, i) => arrow(p, via([c2.x + 145, chipY(i) + 63], [c2.x + 145, chipY(i + 1) - 3]), { color: p.accent }))
    .join("\n");

  const scanDisk = [toolFolders(p, c1.x, R1), notes(p, c1.x, R1 + 250)].join("\n");

  const scanAdapter = [
    box(p, { x: c3.x, y: R1, w: c3.w, h: 62, title: "commands::rescan", lines: ["#[tauri::command], async"], edge: p.layers[2] }),
    box(p, { x: c3.x, y: R1 + 84, w: c3.w, h: 62, title: "Channel<Progress>", lines: ["streams while it walks"], edge: p.layers[2] }),
    box(p, {
      x: c3.x,
      y: R1 + 168,
      w: c3.w,
      h: 138,
      title: "AppState",
      lines: ["one Mutex per field", "snapshot: a cache, not the truth", "scanning: try_lock — a second", "scan is refused, never queued"],
      edge: p.layers[2],
    }),
  ].join("\n");

  const scanUi = [
    box(p, { x: c4.x, y: R1, w: c4.w, h: 62, title: "commands.rescan()", lines: ["the Rescan button"], edge: p.layers[3] }),
    box(p, { x: c4.x, y: R1 + 84, w: c4.w, h: 62, title: "Progress bar", lines: ["tool by tool, as it walks"], edge: p.layers[3], mono: false }),
    box(p, { x: c4.x, y: R1 + 168, w: c4.w, h: 62, title: "useLibrary", lines: ["replaces the snapshot whole"], edge: p.layers[3] }),
    box(p, { x: c4.x, y: R1 + 252, w: c4.w, h: 62, title: "deriveLibrary()", lines: ["grid and counts in one pass"], edge: p.layers[3] }),
    cards(p, c4.x, R1 + 336),
    arrow(p, via([c4.x + 145, R1 + 231], [c4.x + 145, R1 + 249]), { color: p.accent }),
    arrow(p, via([c4.x + 145, R1 + 315], [c4.x + 145, R1 + 333]), { color: p.accent }),
  ].join("\n");

  const scanFlows = [
    arrow(p, via([c4.x - 2, R1 + 31], [right(c3) + 4, R1 + 31]), { color: p.accent, flow: "scan", label: "invoke", lx: g3, ly: R1 + 31 }),
    arrow(p, via([c3.x - 2, R1 + 31], [g2, R1 + 31], [g2, mid(1)], [right(c2) + 4, mid(1)]), { color: p.accent, flow: "scan", label: "calls", lx: g2, ly: R1 + 72 }),
    arrow(p, via([right(c1) + 2, R1 + 31], [c2.x - 4, R1 + 31]), { color: p.accent, flow: "scan", label: "reads", lx: g1, ly: R1 + 31 }),
    arrow(p, via([c2.x - 2, mid(2)], [g1, mid(2)], [g1, R1 + 307], [right(c1) + 4, R1 + 307]), { color: p.accent, flow: "scan", label: "writes", lx: g1, ly: R1 + 250 }),
    arrow(p, via([right(c2) + 2, mid(4)], [g2, mid(4)], [g2, R1 + 237], [c3.x - 4, R1 + 237]), { color: p.accent, flow: "scan", label: "caches", lx: g2, ly: R1 + 292 }),
    arrow(p, via([right(c3) + 2, R1 + 115], [c4.x - 4, R1 + 115]), { color: p.accent, flow: "scan", label: "streams", lx: g3, ly: R1 + 115 }),
    arrow(p, via([right(c3) + 2, R1 + 237], [g3, R1 + 237], [g3, R1 + 199], [c4.x - 4, R1 + 199]), { color: p.accent, flow: "scan", label: "IPC", lx: g3, ly: R1 + 252 }),
  ].join("\n");

  // -------------------------------------------------------------- 2 · toggle
  const toggleDisk = [
    `<rect x="${c1.x}" y="${R2}" width="305" height="190" rx="10" fill="${p.panel}" stroke="${p.border}"/>`,
    text(c1.x + 16, R2 + 27, "The unit moves", { size: 17.5, fill: p.text, weight: 600 }),
    text(c1.x + 16, R2 + 58, "skills/tdd/", { size: 14.5, fill: p.text, font: MONO }),
    `<path d="M${c1.x + 30} ${R2 + 68} C ${c1.x + 30} ${R2 + 100}, ${c1.x + 36} ${R2 + 104}, ${c1.x + 56} ${R2 + 106}" fill="none" stroke="${p.toggle}" stroke-width="1.8" marker-end="url(#m-${p.toggle.slice(1)})"/>`,
    text(c1.x + 62, R2 + 111, ".skillmanager-disabled/", { size: 14.5, fill: p.toggle, font: MONO }),
    text(c1.x + 78, R2 + 131, "tdd/", { size: 14.5, fill: p.muted, font: MONO }),
    text(c1.x + 16, R2 + 158, "moved, not copied: the tool", { size: 15.5, fill: p.muted }),
    text(c1.x + 16, R2 + 179, "genuinely stops seeing it", { size: 15.5, fill: p.muted }),
  ].join("\n");

  const toggleDomain = [
    box(p, {
      x: c2.x,
      y: R2,
      w: c2.w,
      h: 104,
      title: "toggle::set_item_enabled",
      lines: ["new place created and verified", "before the old one goes;", "relative symlinks re-pointed"],
      edge: p.toggle,
    }),
    box(p, { x: c2.x, y: R2 + 126, w: c2.w, h: 64, title: "MetaStore::ensure", lines: ["the note follows the new path"], edge: p.toggle }),
    arrow(p, via([c2.x + 145, R2 + 105], [c2.x + 145, R2 + 123]), { color: p.toggle }),
  ].join("\n");

  const toggleAdapter = [
    box(p, { x: c3.x, y: R2, w: c3.w, h: 62, title: "set_item_enabled", lines: ["one item, no rescan"], edge: p.toggle }),
    box(p, { x: c3.x, y: R2 + 128, w: c3.w, h: 62, title: "emit item:changed", lines: ["after replace_in_snapshot"], edge: p.toggle }),
    arrow(p, via([c3.x + 145, R2 + 63], [c3.x + 145, R2 + 125]), { color: p.toggle }),
  ].join("\n");

  const toggleUi = [
    box(p, { x: c4.x, y: R2, w: c4.w, h: 62, title: "Card switch", lines: ["in the window; patchItem() on ok"], edge: p.toggle, mono: false }),
    box(p, { x: c4.x, y: R2 + 128, w: c4.w, h: 62, title: "Menubar popover", lines: ["a second webview, macOS NSPanel"], edge: p.toggle, mono: false }),
  ].join("\n");

  const toggleFlows = [
    arrow(p, via([c4.x - 2, R2 + 31], [right(c3) + 4, R2 + 31]), { color: p.toggle, flow: "toggle", label: "invoke", lx: g3, ly: R2 + 31 }),
    arrow(p, via([c3.x - 2, R2 + 31], [right(c2) + 4, R2 + 31]), { color: p.toggle, flow: "toggle", label: "calls", lx: g2, ly: R2 + 31 }),
    arrow(p, via([c2.x - 2, R2 + 52], [right(c1) + 4, R2 + 52]), { color: p.toggle, flow: "toggle", label: "renames", lx: g1, ly: R2 + 52 }),
    arrow(p, via([right(c3) + 2, R2 + 159], [c4.x - 4, R2 + 159]), { color: p.toggle, flow: "toggle", label: "tells", lx: g3, ly: R2 + 159 }),
  ].join("\n");

  // --------------------------------------------------------------- 3 · seams
  const seamDisk = box(p, {
    x: c1.x,
    y: R3,
    w: c1.w,
    h: 146,
    title: "Install · update",
    lines: ["git clone --depth 1, .git stripped", "the commit it came from recorded", "an update arrives as a diff,", "applied only when you say so"],
    mono: false,
    edge: p.layers[0],
  });

  const seamDomain = [
    box(p, { x: c2.x, y: R3, w: c2.w, h: 62, title: "deny.toml", lines: ['[[bans.deny]] name = "tauri"'], edge: p.ban }),
    `<rect x="${c2.x + 170}" y="${R3 + 86}" width="120" height="40" rx="8" fill="none" stroke="${p.ban}" stroke-dasharray="4 5"/>`,
    text(c2.x + 230, R3 + 111, "tauri", { size: 15, fill: p.ban, font: MONO, anchor: "middle" }),
    `<line x1="${c2.x + 184}" y1="${R3 + 96}" x2="${c2.x + 276}" y2="${R3 + 116}" stroke="${p.ban}" stroke-width="1.6"/>`,
    arrow(p, via([c2.x + 40, R3 + 63], [c2.x + 40, R3 + 106], [c2.x + 166, R3 + 106]), { color: p.ban, dashed: true }),
    text(c2.x + 54, R3 + 98, "cargo deny", { size: 13.5, fill: p.ban, font: MONO }),
    box(p, { x: c2.x, y: R3 + 146, w: 145, h: 62, title: "crates/cli", lines: ["links core only"], titleSize: 15 }),
    box(p, { x: c2.x + 160, y: R3 + 146, w: 145, h: 62, title: "$HOME", lines: ["passed in"], titleSize: 15 }),
  ].join("\n");

  const seamAdapter = box(p, {
    x: c3.x,
    y: R3,
    w: c3.w,
    h: 104,
    title: "specta_builder()",
    lines: ["every command in one list;", "errors cross as a stable code,", "never a raw Rust string"],
    edge: p.layers[2],
  });

  const seamUi = box(p, {
    x: c4.x,
    y: R3,
    w: c4.w,
    h: 104,
    title: "src/bindings.ts",
    lines: ["generated, never hand-edited;", "CI fails on drift, and the demo", "build swaps it for fixtures"],
    edge: p.layers[3],
  });

  const seamFlows = arrow(p, via([right(c3) + 2, R3 + 40], [c4.x - 4, R3 + 40]), {
    color: p.muted,
    dashed: true,
    label: "generates",
    lx: g3,
    ly: R3 + 40,
  });

  const legend = [
    ["scan", p.accent, false],
    ["toggle", p.toggle, false],
    ["generated", p.muted, true],
    ["banned", p.ban, true],
  ]
    .map(([name, color, dashed], i) => {
      const x = W - 600 + i * 145;
      return [
        `<line x1="${x}" y1="84" x2="${x + 34}" y2="84" stroke="${color}" stroke-width="2.2" ${dashed ? `stroke-dasharray="5 5"` : ""}/>`,
        text(x + 44, 90, name, { size: 16, fill: p.muted }),
      ].join("\n");
    })
    .join("\n");

  const summary =
    "The architecture of skills-hub: four layers — the real folders on disk, the domain crate, the Tauri adapter and the React interface — with dependencies pointing inwards, crossed by three paths: a scan from folder to card, a toggle that moves the file and tells both webviews, and the seams (a banned tauri dependency, generated bindings) that keep the layers apart.";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escape(summary)}">
<title>skills-hub architecture</title>
<desc>${escape(summary)}</desc>
<style>
  .flow { stroke-dasharray: 1 31; animation: march 1.6s linear infinite; }
  .flow.toggle { animation-duration: 1.2s; }
  .halo { animation: breathe 3.6s ease-in-out infinite; }
  @keyframes march { to { stroke-dashoffset: -32; } }
  @keyframes breathe { 50% { opacity: ${(p.glow * 0.12).toFixed(3)}; } }
  @media (prefers-reduced-motion: reduce) {
    .flow, .halo { animation: none; }
    .flow, .spark { display: none; }
  }
</style>
<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.2" fill="${p.dot}"/></pattern>
  <radialGradient id="bloom" cx="0.42" cy="0.36" r="0.62"><stop offset="0" stop-color="${p.accent}" stop-opacity="${(p.glow * 0.35).toFixed(3)}"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>
  ${markers(p)}
</defs>
<rect width="${W}" height="${H}" rx="24" fill="${p.ground}"/>
<rect width="${W}" height="${H}" rx="24" fill="url(#dots)"/>
<rect width="${W}" height="${H}" rx="24" fill="url(#bloom)"/>

${text(40, 76, "skills-hub, end to end", { size: 42, fill: p.text, weight: 750, spacing: -0.8 })}
${text(40, 112, "Four layers, dependencies pointing inwards, and the three paths that cross them. Every name is a real module.", { size: 19, fill: p.muted })}
${legend}

${columns(p)}
${dependsOn(p)}

${separator(p, R2 - 32)}
${separator(p, R3 - 32)}

${rowLabel(p, R1, 1, "Scan", ["a folder becomes", "a card"])}
${rowLabel(p, R2, 2, "Toggle", ["one item, the real", "file, both webviews"])}
${rowLabel(p, R3, 3, "Seams", ["what keeps the", "layers honest"])}

${scanDisk}
${scanDomain}
${scanAdapter}
${scanUi}
${chipLinks}
${scanFlows}

${toggleDisk}
${toggleDomain}
${toggleAdapter}
${toggleUi}
${toggleFlows}

${seamDisk}
${seamDomain}
${seamAdapter}
${seamUi}
${seamFlows}
</svg>
`;
}

for (const scheme of ["light", "dark"]) {
  const name = scheme === "light" ? "architecture.svg" : "architecture-dark.svg";
  const svg = draw(scheme);
  await writeFile(new URL(name, OUT), svg);
  console.log(`  ${name}: ${(svg.length / 1024).toFixed(0)} KB`);
}
