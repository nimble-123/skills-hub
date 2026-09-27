/**
 * Syntax highlighting for the code in a skill.
 *
 * Shiki's core rather than its bundled build, and an explicit set of grammars
 * rather than all of them. Shipping every grammar shiki has costs 65 MB of
 * JavaScript, which is absurd beside a 5 MB application; the languages below
 * are the ones that actually appear in these files, counted across a real
 * skills library, plus a margin.
 *
 * The engine is the JavaScript one, so there is no WebAssembly to fetch. Each
 * grammar is a separate chunk and costs nothing until a code fence asks for
 * it, and this whole module is imported lazily by the block that needs it, so
 * none of shiki is in the startup bundle.
 *
 * Both themes are rendered at once into CSS custom properties, so switching
 * between light and dark is a CSS change rather than a re-highlight.
 */

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/**
 * Grammar per language, each its own lazily-loaded chunk.
 *
 * Chosen by counting the fences in a real skills library and weighing each
 * grammar's size against how often it turns up. Ruby's grammar alone is
 * 850 kB and appeared once; C++'s is 785 kB. Those read perfectly well
 * unhighlighted.
 */
const GRAMMARS = {
  abap: () => import("shiki/langs/abap.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  groovy: () => import("shiki/langs/groovy.mjs"),
  hcl: () => import("shiki/langs/hcl.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  http: () => import("shiki/langs/http.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  properties: () => import("shiki/langs/properties.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
} as const;

type Language = keyof typeof GRAMMARS;

/** What people actually write on a fence, mapped to a grammar we have. */
const ALIASES: Record<string, Language> = {
  "c#": "csharp",
  cds: "typescript", // SAP CDS is close enough to read as TypeScript
  console: "bash",
  dotenv: "properties",
  hdbtable: "sql",
  js: "javascript",
  md: "markdown",
  mjs: "javascript",
  ps1: "powershell",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  shellsession: "bash",
  terraform: "hcl",
  ts: "typescript",
  yml: "yaml",
  zsh: "bash",
};

const LIGHT = "github-light";
const DARK = "github-dark";

let highlighter: Promise<HighlighterCore> | null = null;
const loaded = new Set<Language>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

/**
 * Highlights one block, or returns `null` when it cannot.
 *
 * A language we have no grammar for is not worth an error: the caller falls
 * back to plain text, which is what an unhighlighted block looks like anyway.
 */
export async function highlight(code: string, language: string): Promise<string | null> {
  const lang = resolve(language);
  if (!lang) return null;

  try {
    const shiki = await getHighlighter();
    if (!loaded.has(lang)) {
      await shiki.loadLanguage(await GRAMMARS[lang]());
      loaded.add(lang);
    }

    return shiki.codeToHtml(code, {
      lang,
      themes: { light: LIGHT, dark: DARK },
      // Emits both themes as custom properties instead of committing to one.
      defaultColor: false,
    });
  } catch {
    return null;
  }
}

function resolve(language: string): Language | null {
  const lower = language.trim().toLowerCase();
  if (lower in ALIASES) return ALIASES[lower] as Language;
  return lower in GRAMMARS ? (lower as Language) : null;
}
