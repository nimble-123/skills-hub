import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  countChanges,
  formatDate,
  parseChangelog,
  scopesOf,
  splitSections,
  summarise,
  withScope,
} from "./changelog";

const SAMPLE = `# Changelog

## [0.5.0](https://github.com/o/r/compare/v0.4.0...v0.5.0) (2026-09-30)


### Features

* add a menubar companion ([3d30ba7](https://github.com/o/r/commit/3d30ba7dcf43b3d678603ac073d234b85c4e6c79))
* **ui:** add EnBW palettes ([#28](https://github.com/o/r/issues/28)) ([cb378dc](https://github.com/o/r/commit/cb378dc5f8c34cf5b0aa4969e04185022a46af45))


### Documentation

* add CLAUDE.md ([#21](https://github.com/o/r/issues/21)) ([d1fbef6](https://github.com/o/r/commit/d1fbef6))


### Fixes

* **menubar:** let the first scan run ([de2c2c6](https://github.com/o/r/commit/de2c2c6))

## 0.1.0 (2026-09-20)


### Features

* the first cut
`;

/** The element at `index`, or a failed test rather than an `undefined` later. */
function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`nothing at ${index}`);
  return found;
}

describe("reading the changelog", () => {
  const releases = parseChangelog(SAMPLE);
  const latest = at(releases, 0);
  const first = at(releases, 1);

  it("finds every release, newest first", () => {
    expect(releases.map((r) => r.version)).toEqual(["0.5.0", "0.1.0"]);
    expect(latest.date).toBe("2026-09-30");
    expect(latest.compareUrl).toBe("https://github.com/o/r/compare/v0.4.0...v0.5.0");
  });

  it("reads a heading with no link, as release-please writes the first release", () => {
    expect(first).toMatchObject({ version: "0.1.0", date: "2026-09-20", compareUrl: null });
  });

  it("separates the scope, the text, the pull request and the commit", () => {
    const changes = at(latest.sections, 0).changes;
    const plain = at(changes, 0);
    const scoped = at(changes, 1);
    expect(plain).toEqual({
      scope: null,
      text: "add a menubar companion",
      pr: null,
      commit: {
        sha: "3d30ba7",
        url: "https://github.com/o/r/commit/3d30ba7dcf43b3d678603ac073d234b85c4e6c79",
      },
    });
    expect(scoped.scope).toBe("ui");
    expect(scoped.text).toBe("add EnBW palettes");
    expect(scoped.pr).toEqual({ number: 28, url: "https://github.com/o/r/issues/28" });
  });

  it("puts what users care about first, and folds the project's own changes away", () => {
    const { main, other } = splitSections(latest);
    expect(main.map((s) => s.title)).toEqual(["Features", "Fixes"]);
    expect(other.map((s) => s.title)).toEqual(["Documentation"]);
  });

  it("summarises a folded release in words", () => {
    expect(summarise(latest)).toBe("2 features · 1 fix · 1 other");
    expect(summarise(first)).toBe("1 feature");
    expect(summarise({ version: "0", date: null, compareUrl: null, sections: [] })).toBe(
      "No listed changes",
    );
  });

  it("lists the scopes in use, most used first", () => {
    const releases = parseChangelog(`${SAMPLE}
## 0.0.1 (2026-09-01)

### Fixes

* **ui:** an older fix
`);
    expect(scopesOf(releases)).toEqual([
      { scope: "ui", count: 2 },
      { scope: "menubar", count: 1 },
    ]);
  });

  it("keeps only a scope's changes, and drops the sections left empty", () => {
    const ui = withScope(latest, "ui");
    expect(ui.sections.map((s) => s.title)).toEqual(["Features"]);
    expect(countChanges(ui)).toBe(1);
    expect(countChanges(withScope(first, "ui"))).toBe(0);
    expect(countChanges(latest)).toBe(4);
  });

  it("formats a date the way the interface writes one", () => {
    expect(formatDate("2026-09-30")).toBe("30 Sep 2026");
    expect(formatDate(null)).toBeNull();
  });

  it("reads the real changelog without losing a release", () => {
    const source = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
    const real = parseChangelog(source);
    const headings = source.split("\n").filter((line) => line.startsWith("## ")).length;
    expect(real).toHaveLength(headings);
    for (const release of real) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(release.sections.length).toBeGreaterThan(0);
      for (const section of release.sections) {
        for (const change of section.changes) {
          expect(change.text).not.toMatch(/\]\(|\*\*/);
        }
      }
    }
  });
});
