import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MONO_FONTS, resolveFonts, UI_FONTS } from "./fonts";

const css = readFileSync(new URL("../styles/fonts.css", import.meta.url), "utf8");

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

describe("the fonts on offer", () => {
  it("each have a stack to fall back through", () => {
    // `pnpm fonts` writes the blocks; a font added to the list without one
    // would silently stay on the system face.
    for (const font of UI_FONTS) {
      if (font.id === "system") continue;
      expect(css, font.id).toContain(`:root[data-font-ui="${font.id}"]`);
    }
    for (const font of MONO_FONTS) {
      if (font.id === "system") continue;
      expect(css, font.id).toContain(`:root[data-font-mono="${font.id}"]`);
    }
  });

  it("each have faces to load", () => {
    for (const font of [...UI_FONTS, ...MONO_FONTS]) {
      if (font.id === "system") continue;
      expect(css, font.id).toContain(`url("../fonts/${font.id}-latin-`);
    }
  });

  it("declare a range per face, so one subset cannot shadow another", () => {
    const faces = css.match(/@font-face/g)?.length ?? 0;
    const ranges = css.match(/unicode-range:/g)?.length ?? 0;
    expect(faces).toBeGreaterThan(0);
    expect(ranges).toBe(faces);
  });

  it("offer every face the backend can hold", () => {
    for (const [union, offered] of [
      ["UiFont", UI_FONTS],
      ["MonoFont", MONO_FONTS],
    ] as const) {
      for (const id of idsInBindings(union)) {
        expect(
          offered.map((font) => font.id),
          `${id} is a ${union} but not on offer`,
        ).toContain(id);
      }
    }
  });
});

describe("resolving the fonts", () => {
  it("honours a choice that exists", () => {
    expect(resolveFonts("inter", "fira-code")).toEqual({ ui: "inter", mono: "fira-code" });
  });

  it("falls back to the system face for anything else", () => {
    expect(resolveFonts("comic-sans", null)).toEqual({ ui: "system", mono: "system" });
    expect(resolveFonts(undefined, undefined)).toEqual({ ui: "system", mono: "system" });
  });
});
