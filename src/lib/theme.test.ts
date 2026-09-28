import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appearanceOf, isThemeId, resolveTheme, THEME_GROUPS } from "./theme";

const THEMES = THEME_GROUPS.flatMap((group) => group.themes);

/**
 * Every id the backend can hold, read from the generated bindings.
 *
 * The other direction: `themes.css` is checked against what the picker offers,
 * but nothing checked that the picker offers everything the enum can be. A
 * variant added in Rust and forgotten here compiles, passes the bindings-drift
 * check, and is simply unreachable. The generated union is the honest source —
 * it is written from the Rust, and it carries the serialised spelling.
 */
function idsInBindings(union: string): string[] {
  const source = readFileSync(new URL("../bindings.ts", import.meta.url), "utf8");
  const line = source.match(new RegExp(`export type ${union} = ([^;]+);`))?.[1];
  if (!line) throw new Error(`no ${union} in bindings.ts`);
  return [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1] as string);
}

describe("resolving the theme", () => {
  it("honours an explicit choice whatever the system says", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("horizon-evening", false)).toBe("horizon-evening");
  });

  it("follows the system when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("follows the system before any setting has loaded", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(undefined, false)).toBe("light");
  });

  it("follows the system rather than blanking on a palette it does not know", () => {
    // A settings file written by a newer version, opened by an older one.
    expect(resolveTheme("dracula", true)).toBe("dark");
    expect(isThemeId("dracula")).toBe(false);
  });
});

describe("the palettes on offer", () => {
  const css = readFileSync(new URL("../styles/themes.css", import.meta.url), "utf8");

  it("each have a block to draw with", () => {
    // Light is the `:root` default in tokens.css; every other palette has to
    // say what it changes, or picking it would quietly leave you on light.
    for (const theme of THEMES) {
      if (theme.id === "light") continue;
      expect(css, theme.id).toContain(`:root[data-theme="${theme.id}"]`);
    }
  });

  it("say whether they are light or dark, which is what the rest of the page reads", () => {
    for (const theme of THEMES) {
      expect(appearanceOf(theme.id), theme.id).toBe(theme.appearance);
    }
  });

  it("offer every palette the backend can hold", () => {
    for (const id of idsInBindings("ThemePref")) {
      if (id === "system") continue;
      expect(
        THEMES.map((theme) => theme.id),
        `${id} is a ThemePref but not on offer`,
      ).toContain(id);
    }
  });

  it("offer each palette once", () => {
    const ids = THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
