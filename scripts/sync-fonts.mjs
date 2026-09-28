/**
 * Copies the bundled fonts out of their packages and regenerates
 * `src/styles/fonts.css`.
 *
 * The packages ship every subset they have — Cyrillic, Greek, Vietnamese and
 * the rest — which is about 3 MB of woff2 for the nine families here. The
 * application's own text is Latin, and anything outside it falls back to the
 * system font per glyph, so only the Latin files are taken. That is the whole
 * reason this is a copy rather than an import: importing the packages' own
 * stylesheets would put all of it in the bundle.
 *
 * Run with `pnpm fonts`. `fonts.test.ts` fails if a font on offer has no
 * block here.
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FILES = join(ROOT, "src/fonts");
const CSS = join(ROOT, "src/styles/fonts.css");

/** The system stacks, used when nothing is chosen and as every stack's tail. */
const SYSTEM_UI =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif';
const SYSTEM_MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace';

/**
 * One entry per family on offer.
 *
 * `weights` is what a static family needs faces for; a variable one covers the
 * range in a single file and says nothing.
 */
const FAMILIES = [
  { id: "inter", role: "ui", name: "Inter Variable", pkg: "@fontsource-variable/inter" },
  { id: "geist", role: "ui", name: "Geist Variable", pkg: "@fontsource-variable/geist" },
  { id: "figtree", role: "ui", name: "Figtree Variable", pkg: "@fontsource-variable/figtree" },
  {
    id: "ibm-plex-sans",
    role: "ui",
    name: "IBM Plex Sans Variable",
    pkg: "@fontsource-variable/ibm-plex-sans",
  },
  { id: "roboto", role: "ui", name: "Roboto Variable", pkg: "@fontsource-variable/roboto" },
  {
    id: "jetbrains-mono",
    role: "mono",
    name: "JetBrains Mono Variable",
    pkg: "@fontsource-variable/jetbrains-mono",
  },
  { id: "fira-code", role: "mono", name: "Fira Code Variable", pkg: "@fontsource-variable/fira-code" },
  {
    id: "geist-mono",
    role: "mono",
    name: "Geist Mono Variable",
    pkg: "@fontsource-variable/geist-mono",
  },
  {
    id: "ibm-plex-mono",
    role: "mono",
    name: "IBM Plex Mono",
    pkg: "@fontsource/ibm-plex-mono",
    weights: [400, 600],
  },
];

/** Latin and Latin Extended, in the weight-axis cut where there is a choice. */
function sourceFiles(family) {
  const dir = join(ROOT, "node_modules", family.pkg, "files");
  const all = readdirSync(dir).filter((name) => !name.startsWith("._"));
  const wanted = family.weights
    ? family.weights.flatMap((weight) => [
        `${family.id}-latin-${weight}-normal.woff2`,
        `${family.id}-latin-ext-${weight}-normal.woff2`,
      ])
    : [`${family.id}-latin-wght-normal.woff2`, `${family.id}-latin-ext-wght-normal.woff2`];

  return wanted.map((name) => {
    if (!all.includes(name)) throw new Error(`${family.pkg} has no ${name}`);
    return { name, from: join(dir, name) };
  });
}

/**
 * The subset's range, read out of the package's own stylesheet.
 *
 * Without it the Latin Extended face, declared second, would simply replace
 * the Latin one — same family, same weight — and the letters actually in use
 * would come from a file that does not have them.
 */
function unicodeRange(family, fileName) {
  const dir = join(ROOT, "node_modules", family.pkg);
  const sheets = readdirSync(dir).filter((name) => name.endsWith(".css"));
  for (const sheet of sheets) {
    const css = readFileSync(join(dir, sheet), "utf8");
    const at = css.indexOf(fileName);
    if (at === -1) continue;
    const range = css.slice(at).match(/unicode-range:\s*([^;]+);/);
    if (range) return range[1].trim();
  }
  throw new Error(`no unicode-range for ${fileName}`);
}

function licence(family) {
  const path = join(ROOT, "node_modules", family.pkg, "LICENSE");
  const first = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return first ?? "see the package";
}

rmSync(FILES, { recursive: true, force: true });
mkdirSync(FILES, { recursive: true });

const faces = [];
const stacks = { ui: [], mono: [] };
const credits = [];
let bytes = 0;

for (const family of FAMILIES) {
  const version = JSON.parse(
    readFileSync(join(ROOT, "node_modules", family.pkg, "package.json"), "utf8"),
  ).version;

  for (const file of sourceFiles(family)) {
    copyFileSync(file.from, join(FILES, file.name));
    bytes += readFileSync(file.from).length;

    // A static family names its weight in the file; a variable one carries the
    // whole range and declares it, so one face covers every weight in use.
    const weight = family.weights
      ? (file.name.match(/-(\d{3})-normal/)?.[1] ?? "400")
      : "100 900";

    faces.push(
      `@font-face {\n` +
        `  font-family: "${family.name}";\n` +
        `  font-style: normal;\n` +
        `  font-weight: ${weight};\n` +
        `  font-display: swap;\n` +
        `  src: url("../fonts/${file.name}") format("woff2");\n` +
        `  unicode-range: ${unicodeRange(family, file.name)};\n` +
        `}`,
    );
  }

  const tail = family.role === "ui" ? SYSTEM_UI : SYSTEM_MONO;
  stacks[family.role].push(
    `:root[data-font-${family.role}="${family.id}"] {\n` +
      `  --font-${family.role}: "${family.name}", ${tail};\n` +
      `}`,
  );
  credits.push(`| ${family.name.replace(" Variable", "")} | ${licence(family)} | \`${family.pkg}\` ${version} |`);
}

writeFileSync(
  CSS,
  `/*\n` +
    ` * The bundled fonts, and the stack each one names.\n` +
    ` *\n` +
    ` * Generated by \`pnpm fonts\` from the packages in package.json — do not\n` +
    ` * edit. Only the Latin cuts are copied; see \`scripts/sync-fonts.mjs\` for\n` +
    ` * why, and \`src/fonts/LICENSES.md\` for whose fonts these are.\n` +
    ` */\n\n` +
    `${faces.join("\n\n")}\n\n` +
    `/* ------------------------------------------------------------ interface */\n\n` +
    `${stacks.ui.join("\n\n")}\n\n` +
    `/* ----------------------------------------------------------------- code */\n\n` +
    `${stacks.mono.join("\n\n")}\n`,
);

writeFileSync(
  join(FILES, "LICENSES.md"),
  `# Bundled fonts\n\n` +
    `Copied out of the packages below by \`pnpm fonts\`. Each is free to\n` +
    `redistribute under its own licence; the full text ships with the package.\n\n` +
    `| Family | Licence | From |\n| --- | --- | --- |\n${credits.join("\n")}\n`,
);

// Biome owns the formatting of everything in src/, generated or not.
execFileSync("pnpm", ["biome", "format", "--write", CSS], { stdio: "ignore" });

console.log(
  `${FAMILIES.length} families, ${faces.length} files, ${Math.round(bytes / 1024)} KB`,
);
