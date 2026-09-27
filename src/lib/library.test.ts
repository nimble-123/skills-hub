import { describe, expect, it } from "vitest";
import type { ItemMetadata } from "../bindings";
import { deriveLibrary, GLOBAL, NO_FILTERS, type Scope, tagsByFrequency } from "./library";

function item(overrides: Partial<ItemMetadata> = {}): ItemMetadata {
  return {
    entryId: overrides.name ?? "item",
    sourcePath: `/home/.claude/skills/${overrides.name ?? "item"}/SKILL.md`,
    realPath: `/home/.claude/skills/${overrides.name ?? "item"}/SKILL.md`,
    tool: "claude-code",
    type: "skill",
    projectId: null,
    pluginId: null,
    name: "item",
    description: "",
    enabled: true,
    modified: "2026-01-01T00:00:00Z",
    tags: [],
    favorite: false,
    collections: [],
    sourceRepo: null,
    sourceRef: null,
    sourceSubpath: null,
    sourceCommit: null,
    ...overrides,
  };
}

const ALL: Scope = { kind: "all" };

const library = [
  item({ name: "writing", type: "skill", tags: ["prose"], favorite: true }),
  item({ name: "review", type: "command", tool: "codex", tags: ["prose", "code"] }),
  item({ name: "tdd", type: "skill", tool: "cursor", enabled: false }),
  item({ name: "house-style", type: "rule", projectId: "p1" }),
  item({ name: "linting", type: "skill", pluginId: "kit@acme" }),
  item({ name: "installed", type: "skill", sourceRepo: "https://github.com/a/b" }),
];

describe("scopes", () => {
  it("shows everything when nothing is scoped", () => {
    expect(deriveLibrary(library, ALL, NO_FILTERS).visible).toHaveLength(6);
  });

  it.each([
    [{ kind: "type", type: "skill" } as Scope, ["installed", "linting", "tdd", "writing"]],
    [{ kind: "tool", toolId: "codex" } as Scope, ["review"]],
    [{ kind: "project", projectId: "p1" } as Scope, ["house-style"]],
    [{ kind: "plugin", pluginId: "kit@acme" } as Scope, ["linting"]],
    [{ kind: "favourites" } as Scope, ["writing"]],
  ])("narrows to %o", (scope, expected) => {
    const names = deriveLibrary(library, scope, NO_FILTERS).visible.map((i) => i.name);
    expect(names).toEqual(expected);
  });

  it("treats the global scope as its own project", () => {
    const names = deriveLibrary(library, { kind: "project", projectId: null }, NO_FILTERS).visible;
    expect(names).toHaveLength(5);
    expect(names.every((i) => i.projectId === null)).toBe(true);
  });

  it("finds members of a collection", () => {
    const withCollection = [...library, item({ name: "daily", collections: ["work"] })];
    const scope: Scope = { kind: "collection", collectionId: "work" };
    expect(deriveLibrary(withCollection, scope, NO_FILTERS).visible.map((i) => i.name)).toEqual([
      "daily",
    ]);
  });
});

describe("filters", () => {
  it("matches the search against name and description alike, ignoring case", () => {
    const items = [
      item({ name: "writing", description: "" }),
      item({ name: "other", description: "Helps you WRITE well" }),
      item({ name: "unrelated", description: "" }),
    ];
    const found = deriveLibrary(items, ALL, { ...NO_FILTERS, search: "  WRIT  " }).visible;
    expect(found.map((i) => i.name)).toEqual(["other", "writing"]);
  });

  it("filters by enabled state", () => {
    expect(
      deriveLibrary(library, ALL, { ...NO_FILTERS, enabled: "disabled" }).visible.map(
        (i) => i.name,
      ),
    ).toEqual(["tdd"]);
    expect(deriveLibrary(library, ALL, { ...NO_FILTERS, enabled: "enabled" }).visible).toHaveLength(
      5,
    );
  });

  it("filters by tag, and separately by having no tags", () => {
    expect(
      deriveLibrary(library, ALL, { ...NO_FILTERS, tag: "prose" }).visible.map((i) => i.name),
    ).toEqual(["review", "writing"]);
    expect(deriveLibrary(library, ALL, { ...NO_FILTERS, untagged: true }).visible).toHaveLength(4);
  });

  it.each([
    ["tracked", ["installed"]],
    ["plugin", ["linting"]],
    ["local", ["house-style", "review", "tdd", "writing"]],
  ] as const)("filters by source %s", (source, expected) => {
    const names = deriveLibrary(library, ALL, { ...NO_FILTERS, source }).visible.map((i) => i.name);
    expect(names).toEqual(expected);
  });

  it("compounds filters with the scope", () => {
    const scope: Scope = { kind: "type", type: "skill" };
    const found = deriveLibrary(library, scope, { ...NO_FILTERS, enabled: "disabled" }).visible;
    expect(found.map((i) => i.name)).toEqual(["tdd"]);
  });
});

describe("facet counts", () => {
  it("counts every dimension in the same pass", () => {
    const { facets } = deriveLibrary(library, { kind: "tool", toolId: "codex" }, NO_FILTERS);

    // The scope narrows the list, not the counts: the sidebar still shows
    // where everything is.
    expect(facets.all).toBe(6);
    expect(facets.byType.get("skill")).toBe(4);
    expect(facets.byTool.get("claude-code")).toBe(4);
    expect(facets.byProject.get(GLOBAL)).toBe(5);
    expect(facets.byProject.get("p1")).toBe(1);
    expect(facets.byPlugin.get("kit@acme")).toBe(1);
    expect(facets.favourites).toBe(1);
    expect(facets.untagged).toBe(4);
  });

  it("does follow the compounding filters, so a search shows where the matches are", () => {
    const { facets } = deriveLibrary(library, ALL, { ...NO_FILTERS, search: "tdd" });
    expect(facets.all).toBe(1);
    expect(facets.byTool.get("cursor")).toBe(1);
    expect(facets.byTool.has("codex")).toBe(false);
  });

  it("ranks tags by how often they are used", () => {
    const { facets } = deriveLibrary(library, ALL, NO_FILTERS);
    expect(tagsByFrequency(facets)).toEqual([
      { tag: "prose", count: 2 },
      { tag: "code", count: 1 },
    ]);
  });
});

describe("sorting", () => {
  const dated = [
    item({ name: "beta", modified: "2026-03-01T00:00:00Z" }),
    item({ name: "Alpha", modified: "2026-01-01T00:00:00Z" }),
    item({ name: "gamma", modified: "2026-02-01T00:00:00Z" }),
  ];

  it("sorts by name without being distracted by case", () => {
    const names = (sort: "name-asc" | "name-desc") =>
      deriveLibrary(dated, ALL, { ...NO_FILTERS, sort }).visible.map((i) => i.name);
    expect(names("name-asc")).toEqual(["Alpha", "beta", "gamma"]);
    expect(names("name-desc")).toEqual(["gamma", "beta", "Alpha"]);
  });

  it("sorts by when the file was last written", () => {
    const names = (sort: "modified-asc" | "modified-desc") =>
      deriveLibrary(dated, ALL, { ...NO_FILTERS, sort }).visible.map((i) => i.name);
    expect(names("modified-desc")).toEqual(["beta", "gamma", "Alpha"]);
    expect(names("modified-asc")).toEqual(["Alpha", "gamma", "beta"]);
  });

  it("puts an item with no date last, whichever way round", () => {
    const withUnknown = [...dated, item({ name: "undated", modified: null })];
    for (const sort of ["modified-asc", "modified-desc"] as const) {
      const names = deriveLibrary(withUnknown, ALL, { ...NO_FILTERS, sort }).visible.map(
        (i) => i.name,
      );
      expect(names.at(-1)).toBe("undated");
    }
  });
});
