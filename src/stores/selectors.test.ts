import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A zustand selector runs on every store update and its result is compared by
 * reference, so `store.thing ?? []` builds a fresh array each time and the
 * component re-renders forever. React catches it — "the result of getSnapshot
 * should be cached" — but only once something renders, which in a rarely
 * visited page could be much later.
 *
 * `stores/selectors.ts` holds the shared empty values; this makes sure nobody
 * reintroduces an inline one.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry.startsWith("._")) return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("store selectors", () => {
  it("never build a fresh empty array or object inline", () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const offenders: string[] = [];

    for (const file of sourceFiles(root)) {
      if (file.endsWith("stores/selectors.ts")) continue;
      const source = readFileSync(file, "utf8");

      for (const [index, line] of source.split("\n").entries()) {
        const isSelector = /\buse[A-Z]\w*\(\s*\(\w+\)\s*=>/.test(line);
        if (isSelector && /\?\?\s*(\[\]|\{\})/.test(line)) {
          offenders.push(`${file.slice(root.length)}:${index + 1}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
