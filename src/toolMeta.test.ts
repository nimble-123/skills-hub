import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOL_META } from "./toolMeta";

/**
 * The registry lives in Rust and its presentation lives here, so nothing but a
 * test keeps the two sets of ids in step. Reading the Rust source is blunt, but
 * it is the only check that actually fails when someone adds a tool on one side
 * and forgets the other.
 */
function registryToolIds(): string[] {
  const source = readFileSync(
    fileURLToPath(new URL("../crates/core/src/tools.rs", import.meta.url)),
    "utf8",
  );
  return [...source.matchAll(/Tool::new\("([^"]+)"\)/g)].map((match) => match[1] as string);
}

describe("tool metadata", () => {
  it("covers every tool in the Rust registry, and no others", () => {
    expect([...registryToolIds()].sort()).toEqual(Object.keys(TOOL_META).sort());
  });

  it("finds a non-trivial registry, so a broken regex cannot pass silently", () => {
    expect(registryToolIds().length).toBeGreaterThanOrEqual(16);
  });

  it("gives every tool a label and an icon", () => {
    for (const [id, meta] of Object.entries(TOOL_META)) {
      expect(meta.label, `${id} label`).toBeTruthy();
      expect(meta.icon, `${id} icon`).toBeTruthy();
    }
  });

  it("keeps brand marks monochrome, so they follow the theme", () => {
    for (const [id, meta] of Object.entries(TOOL_META)) {
      if (!meta.svg) continue;
      expect(meta.svg, `${id} svg`).toContain("currentColor");
      expect(meta.svg, `${id} svg must not hard-code a colour`).not.toMatch(/fill="#/);
    }
  });
});
