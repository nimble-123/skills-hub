/**
 * Takes the screenshots the README and the product page use.
 *
 * The real interface, against fixtures: the demo build swaps only the three
 * modules that talk to the host, so what is captured is the same components
 * and the same stylesheet the application ships.
 *
 * What it cannot capture is the native window — no title bar, no traffic
 * lights. That is the trade for having pictures that regenerate with
 * `pnpm screenshots` and never quietly show an interface that no longer
 * exists.
 */

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const OUT = new URL("../docs/images/", import.meta.url);

/** Retina, and wide enough for the sidebar, the grid and the rail together. */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

const SHOTS = [
  {
    file: "library",
    screen: "library",
    /** Waited for before the picture is taken, so nothing is mid-render. */
    ready: "text=When to use this",
  },
  {
    file: "types",
    screen: "types",
    /** The four type chips only appear together in the unfiltered library. */
    ready: "text=Every skill, agent, command and rule",
  },
  {
    file: "discover",
    screen: "discover",
    ready: "text=mcp-builder",
    /** The registry search is the point of the page; show it having run. */
    async prepare(page) {
      await page.getByRole("textbox", { name: /search the skills.sh registry/i }).fill("pdf");
      await page.getByRole("button", { name: "Search" }).click();
      await page.waitForSelector("text=anthropics/skills");
    },
  },
  {
    file: "cost",
    screen: "cost",
    ready: "text=Always available",
    /** Usage is read on request, and the most-used section only exists after. */
    async prepare(page) {
      await page.getByRole("button", { name: "Read Claude Code history" }).click();
      await page.waitForSelector("text=Top skills & agents");
    },
  },
  { file: "tools", screen: "tools", ready: "text=Found on this machine" },
  /** The palette and the two typefaces are chosen here; the page shows that. */
  { file: "settings", screen: "settings", ready: "text=Interface font" },
  { file: "mcp", screen: "mcp", ready: "text=obsidian" },
  {
    file: "diff",
    screen: "diff",
    ready: "text=Check for updates",
    /** The diff only exists once it has been asked for. */
    async prepare(page) {
      await page.getByRole("button", { name: "Check for updates" }).click();
      await page.waitForSelector("text=This replaces your local copy");
    },
  },
];

/**
 * The palette gallery, one tile each.
 *
 * Small and at one device pixel per CSS pixel: eighteen of these sit on one
 * page, and what a tile has to show is the colour, not the type. The list is
 * the application's own, read out of the bundle rather than repeated here, so
 * a palette added to the product cannot be missing from the gallery.
 */
const TILE = { width: 900, height: 620 };
const TILE_CLIP = { x: 0, y: 0, width: 760, height: 480 };

/**
 * The menubar popover, at the size of the panel it lives in.
 *
 * Its own viewport, because the panel is 360×480 and a picture of it inside a
 * 1440-wide page would be a picture of mostly nothing.
 */
const PANEL = { width: 360, height: 480 };

const server = await createServer({
  // fileURLToPath, not `.pathname`: this checkout's path has a space in it.
  configFile: fileURLToPath(new URL("../vite.demo.config.ts", import.meta.url)),
  logLevel: "warn",
});
await server.listen();
const base = server.resolvedUrls?.local?.[0] ?? "http://localhost:1421/";

// The application's own list, loaded through the dev server rather than
// copied: a palette it offers and the gallery does not would be a lie.
const { THEME_GROUPS } = await server.ssrLoadModule("/lib/theme.ts");
const THEMES = THEME_GROUPS.flatMap((group) => group.themes);

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();

try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      colorScheme: theme,
      // Otherwise every screenshot is mid-animation.
      reducedMotion: "reduce",
    });

    for (const shot of SHOTS) {
      const page = await context.newPage();
      const failures = [];
      page.on("pageerror", (error) => failures.push(error.message));

      await page.goto(`${base}demo.html?screen=${shot.screen}&theme=${theme}`);
      await page.waitForSelector(shot.ready, { timeout: 15_000 });
      await shot.prepare?.(page);

      // Web fonts and the lazily-loaded grammar for the code block.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);

      if (failures.length > 0) {
        throw new Error(`${shot.file} (${theme}): ${failures.join("; ")}`);
      }

      const name = theme === "light" ? `${shot.file}.png` : `${shot.file}-dark.png`;
      await page.screenshot({ path: fileURLToPath(new URL(name, OUT)) });
      console.log(`  ${name}`);
      await page.close();
    }
    await context.close();
  }
  // One context, because a tile is the same page with a different palette.
  const gallery = await browser.newContext({
    viewport: TILE,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await mkdir(new URL("themes/", OUT), { recursive: true });

  for (const theme of THEMES) {
    const page = await gallery.newPage();
    await page.goto(`${base}demo.html?screen=library&theme=${theme.id}`);
    await page.waitForSelector("text=When to use this", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({
      path: fileURLToPath(new URL(`themes/${theme.id}.png`, OUT)),
      clip: TILE_CLIP,
    });
    console.log(`  themes/${theme.id}.png`);
    await page.close();
  }
  await gallery.close();

  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: PANEL,
      deviceScaleFactor: SCALE,
      colorScheme: theme,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));

    await page.goto(`${base}demo.html?screen=popover&theme=${theme}`);
    // Typed into, because an empty popover shows only favourites and the
    // point of the picture is the search.
    await page.getByRole("searchbox", { name: /search the library/i }).fill("a");
    await page.waitForSelector("text=abap-repo-assessment", { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    if (failures.length > 0) {
      throw new Error(`popover (${theme}): ${failures.join("; ")}`);
    }

    const name = theme === "light" ? "popover.png" : "popover-dark.png";
    await page.screenshot({ path: fileURLToPath(new URL(name, OUT)) });
    console.log(`  ${name}`);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(`\nwrote ${SHOTS.length * 2 + THEMES.length + 2} screenshots to docs/images/`);
