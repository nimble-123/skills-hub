import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { ICONS } from "./icons";

/**
 * Icons are named as strings and looked up at runtime, so nothing but a test
 * catches a name the registry does not have — and the registry exists only
 * because importing lucide wholesale costs a megabyte.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry.startsWith("._")) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function namesUsedInMarkup(): string[] {
  // fileURLToPath, not `.pathname`: this checkout's path contains a space.
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const found = new Set<string>();
  for (const file of sourceFiles(root)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<Icon\s[^>]*name="([a-z0-9-]+)"/g)) {
      found.add(match[1] as string);
    }
    for (const match of source.matchAll(/name={[^}]*\?\s*"([a-z0-9-]+)"\s*:\s*"([a-z0-9-]+)"}/g)) {
      found.add(match[1] as string);
      found.add(match[2] as string);
    }
  }
  return [...found];
}

describe("icon registry", () => {
  it("has every icon the metadata asks for", () => {
    const names = [
      ...Object.values(TOOL_META).map((meta) => meta.icon),
      ...Object.values(TYPE_META).map((meta) => meta.icon),
    ];
    expect(names.filter((name) => !(name in ICONS))).toEqual([]);
  });

  it("has every icon drawn in the markup", () => {
    const used = namesUsedInMarkup();
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter((name) => !(name in ICONS))).toEqual([]);
  });
});
