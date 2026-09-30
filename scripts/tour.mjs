/**
 * Records the animated tour at the top of the README.
 *
 * Like `pnpm screenshots`, it drives the demo build — the real components
 * against fixtures — so the tour regenerates with the interface rather than
 * going quietly out of date. One pass per colour scheme, each written as a
 * GIF, because that is what a README on GitHub will play inline.
 *
 * The pointer is drawn into the page: a headless browser has none, and a
 * tour where things open by themselves is hard to follow.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import gifenc from "gifenc";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import { createServer } from "vite";

// A CommonJS package without named ESM exports.
const { applyPalette, GIFEncoder, quantize } = gifenc;

const OUT = new URL("../docs/images/", import.meta.url);

/** Wide enough for the sidebar, grid and rail; small enough to stay a few MB. */
const VIEWPORT = { width: 1280, height: 800 };

/** How long a pointer glide lasts, and in how many frames. */
const GLIDE = { frames: 8, ms: 40 };

const server = await createServer({
  // fileURLToPath, not `.pathname`: this checkout's path has a space in it.
  configFile: fileURLToPath(new URL("../vite.demo.config.ts", import.meta.url)),
  logLevel: "warn",
});
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? "http://localhost:1421/";
const browser = await chromium.launch();

/** A captured frame and how long it stays up. */
class Recorder {
  frames = [];

  constructor(page) {
    this.page = page;
  }

  async capture(delay) {
    const png = PNG.sync.read(await this.page.screenshot());
    this.frames.push({ rgba: new Uint8Array(png.data), delay });
  }

  /** The screen as it is now, held for `ms`. */
  async hold(ms) {
    await this.capture(ms);
  }

  /** A few frames while something animates in on its own. */
  async settle(count = 4, ms = 60) {
    for (let i = 0; i < count; i++) {
      await this.page.waitForTimeout(ms);
      await this.capture(ms);
    }
  }
}

/** Puts a pointer into the page, in the top layer so dialogs stay beneath it. */
async function installPointer(page) {
  await page.evaluate(() => {
    const pointer = document.createElement("div");
    pointer.id = "tour-pointer";
    pointer.setAttribute("popover", "manual");
    pointer.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 11-7 1.2L9.5 21z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    Object.assign(pointer.style, {
      position: "fixed",
      inset: "auto",
      left: "0",
      top: "0",
      margin: "0",
      padding: "0",
      border: "0",
      background: "none",
      overflow: "visible",
      pointerEvents: "none",
      filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.35))",
      transformOrigin: "4px 2px",
    });
    document.body.append(pointer);
    pointer.showPopover();
  });
}

/** Brings the pointer back above whatever entered the top layer after it. */
async function raisePointer(page) {
  await page.evaluate(() => {
    const pointer = document.getElementById("tour-pointer");
    pointer?.hidePopover();
    pointer?.showPopover();
  });
}

async function placePointer(page, x, y, pressed = false) {
  await page.evaluate(
    ([x, y, pressed]) => {
      const pointer = document.getElementById("tour-pointer");
      if (!pointer) return;
      pointer.style.transform = `translate(${x - 4}px, ${y - 2}px) scale(${pressed ? 0.85 : 1})`;
    },
    [x, y, pressed],
  );
}

let at = { x: 640, y: 420 };

/** Glides the pointer to the middle of `locator`, a frame at a time. */
async function glide(rec, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`nothing to point at: ${locator}`);
  const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 };
  for (let i = 1; i <= GLIDE.frames; i++) {
    const t = i / GLIDE.frames;
    const ease = 1 - (1 - t) ** 3;
    await placePointer(rec.page, at.x + (to.x - at.x) * ease, at.y + (to.y - at.y) * ease);
    await rec.capture(GLIDE.ms);
  }
  at = to;
  await rec.page.mouse.move(to.x, to.y);
}

/** Points at `locator` and clicks it, with a press you can see. */
async function click(rec, locator) {
  await glide(rec, locator);
  await placePointer(rec.page, at.x, at.y, true);
  await rec.capture(90);
  await locator.click();
  await placePointer(rec.page, at.x, at.y, false);
}

/** Types into the focused field a character at a time. */
async function type(rec, text) {
  for (const char of text) {
    await rec.page.keyboard.type(char);
    await rec.capture(70);
  }
}

async function tour(scheme) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));

  await page.goto(`${base}demo.html?screen=types&theme=${scheme}`);
  await page.waitForSelector("text=Every skill, agent, command and rule", { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await installPointer(page);
  await placePointer(page, at.x, at.y);
  const rec = new Recorder(page);

  // The whole library, every tool at once.
  await rec.hold(1600);

  // Search it.
  await click(rec, page.getByRole("searchbox", { name: "Search the library" }));
  await type(rec, "sap");
  await rec.hold(900);

  // Open one: the rail shows the file as the tool reads it.
  await click(rec, page.locator("[role=button]", { hasText: "sap-abap-cds" }).first());
  await rec.settle();
  await rec.hold(2200);

  // Find more, from a registry or any repository.
  await click(rec, page.getByRole("button", { name: /^Discover/ }).first());
  await rec.settle(2);
  await click(rec, page.getByRole("textbox", { name: /search the skills.sh registry/i }));
  await type(rec, "pdf");
  await click(rec, page.getByRole("button", { name: "Search" }));
  await page.waitForSelector("text=anthropics/skills");
  await rec.settle(2);
  await rec.hold(2000);

  // What it all costs, per turn and once invoked.
  await click(rec, page.getByRole("button", { name: /^Cost/ }).first());
  await rec.settle(2);
  await click(rec, page.getByRole("button", { name: "Read Claude Code history" }));
  await page.waitForSelector("text=Top skills & agents");
  await rec.settle(2);
  await rec.hold(2000);

  // And what changed, from the version at the foot of the sidebar.
  await click(rec, page.getByRole("button", { name: /^v\d/ }));
  await raisePointer(page);
  await rec.settle(4, 50);
  await rec.hold(1400);
  await click(rec, page.getByRole("button", { name: /^ui,/ }));
  await rec.settle(2);
  await rec.hold(2200);

  if (failures.length > 0) throw new Error(`tour (${scheme}): ${failures.join("; ")}`);
  await context.close();
  at = { x: 640, y: 420 };
  return rec.frames;
}

/**
 * Encodes the frames as a GIF.
 *
 * Each frame after the first carries only the pixels that changed, the rest
 * transparent over the one before. Most of a tour stands still, so this is
 * what keeps a thirty-second recording to a few megabytes.
 */
function encode(frames) {
  const { width, height } = VIEWPORT;
  const gif = GIFEncoder();
  let previous = null;

  // Identical neighbours become one longer frame.
  const merged = [];
  for (const frame of frames) {
    const last = merged.at(-1);
    if (last && Buffer.compare(last.rgba, frame.rgba) === 0) last.delay += frame.delay;
    else merged.push({ ...frame });
  }

  for (const { rgba, delay } of merged) {
    if (!previous) {
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay, repeat: 0 });
      previous = rgba;
      continue;
    }

    const pixels = width * height;
    const changed = new Uint8Array(pixels);
    let count = 0;
    for (let i = 0; i < pixels; i++) {
      const o = i * 4;
      if (
        rgba[o] !== previous[o] ||
        rgba[o + 1] !== previous[o + 1] ||
        rgba[o + 2] !== previous[o + 2]
      ) {
        changed[i] = 1;
        count++;
      }
    }

    const sample = new Uint8Array(count * 4);
    for (let i = 0, j = 0; i < pixels; i++) {
      if (!changed[i]) continue;
      sample.set(rgba.subarray(i * 4, i * 4 + 4), j * 4);
      j++;
    }
    const palette = quantize(sample, 255);
    const index = applyPalette(rgba, palette);
    const transparentIndex = palette.length;
    palette.push([0, 0, 0]);
    for (let i = 0; i < pixels; i++) if (!changed[i]) index[i] = transparentIndex;

    gif.writeFrame(index, width, height, {
      palette,
      delay,
      transparent: true,
      transparentIndex,
      // Leave this frame in place: the next one only paints what it changes.
      dispose: 1,
    });
    previous = rgba;
  }

  gif.finish();
  return { bytes: gif.bytes(), frames: merged.length };
}

try {
  for (const scheme of ["light", "dark"]) {
    const frames = await tour(scheme);
    const { bytes, frames: count } = encode(frames);
    const name = scheme === "light" ? "tour.gif" : "tour-dark.gif";
    await writeFile(new URL(name, OUT), bytes);
    const seconds = frames.reduce((n, f) => n + f.delay, 0) / 1000;
    console.log(
      `  ${name}: ${count} frames, ${seconds.toFixed(1)} s, ${(bytes.length / 1e6).toFixed(1)} MB`,
    );
  }
} finally {
  await browser.close();
  await server.close();
}
