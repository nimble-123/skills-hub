/**
 * Turning a snapshot into what the window shows.
 *
 * One pass produces both the visible list and the counts beside every sidebar
 * row, because they answer the same question and computing them separately is
 * how the counts end up disagreeing with the list.
 *
 * Two kinds of narrowing, deliberately different:
 *
 * - a **scope** is exclusive. Picking "Skills" replaces picking "Cursor".
 * - the **filters** compound and survive navigation, so a tag or a search term
 *   stays applied while you move around.
 *
 * Counts are computed after the filters but before the scope, so that typing
 * into the search box shows you where the matches are rather than freezing the
 * sidebar at totals.
 */

import type { EnabledFilter, ItemMetadata, ItemType, SortOrder } from "../bindings";

/** The one exclusive choice, normally made in the sidebar. */
export type Scope =
  | { kind: "all" }
  | { kind: "favourites" }
  | { kind: "type"; type: ItemType }
  | { kind: "tool"; toolId: string }
  /** `projectId: null` is the global (home directory) scope. */
  | { kind: "project"; projectId: string | null }
  | { kind: "plugin"; pluginId: string }
  | { kind: "collection"; collectionId: string };

/** Where an item came from. */
export type SourceFilter = "all" | "tracked" | "plugin" | "local";

export type Filters = {
  search: string;
  enabled: EnabledFilter;
  /** `null` means no tag filter; `untagged` means items with no tags at all. */
  tag: string | null;
  untagged: boolean;
  source: SourceFilter;
  sort: SortOrder;
};

export const NO_FILTERS: Filters = {
  search: "",
  enabled: "all",
  tag: null,
  untagged: false,
  source: "all",
  sort: "name-asc",
};

/** How many items sit behind each sidebar row. */
export type Facets = {
  all: number;
  favourites: number;
  byType: Map<ItemType, number>;
  byTool: Map<string, number>;
  /** Keyed by project id; the global scope is under `GLOBAL`. */
  byProject: Map<string, number>;
  byPlugin: Map<string, number>;
  byCollection: Map<string, number>;
  byTag: Map<string, number>;
  untagged: number;
};

/** The key used for the global scope, which has no project id of its own. */
export const GLOBAL = "__global__";

export type DerivedLibrary = {
  visible: ItemMetadata[];
  facets: Facets;
};

export function deriveLibrary(
  items: readonly ItemMetadata[],
  scope: Scope,
  filters: Filters,
): DerivedLibrary {
  const facets = emptyFacets();
  const visible: ItemMetadata[] = [];
  const needle = filters.search.trim().toLowerCase();

  for (const item of items) {
    if (!passesFilters(item, filters, needle)) continue;

    count(facets, item);
    if (inScope(item, scope)) visible.push(item);
  }

  visible.sort(comparator(filters.sort));
  return { visible, facets };
}

/**
 * Whether an item matches a search term, which is already lowercased and
 * trimmed. An empty term matches everything.
 *
 * Exported because the menubar popover searches the same library and must
 * agree with the window about what "matching" means.
 */
export function matchesSearch(item: ItemMetadata, needle: string): boolean {
  if (needle === "") return true;
  return `${item.name}\n${item.description}`.toLowerCase().includes(needle);
}

/** Whether an item survives the compounding filters. */
function passesFilters(item: ItemMetadata, filters: Filters, needle: string): boolean {
  if (filters.enabled === "enabled" && !item.enabled) return false;
  if (filters.enabled === "disabled" && item.enabled) return false;

  if (filters.untagged && item.tags.length > 0) return false;
  if (filters.tag !== null && !item.tags.includes(filters.tag)) return false;

  if (!matchesSource(item, filters.source)) return false;

  if (!matchesSearch(item, needle)) return false;

  return true;
}

function matchesSource(item: ItemMetadata, source: SourceFilter): boolean {
  switch (source) {
    case "all":
      return true;
    case "tracked":
      return item.sourceRepo !== null;
    case "plugin":
      return item.pluginId !== null;
    case "local":
      return item.sourceRepo === null && item.pluginId === null;
  }
}

function inScope(item: ItemMetadata, scope: Scope): boolean {
  switch (scope.kind) {
    case "all":
      return true;
    case "favourites":
      return item.favorite;
    case "type":
      return item.type === scope.type;
    case "tool":
      return item.tool === scope.toolId;
    case "project":
      return item.projectId === scope.projectId;
    case "plugin":
      return item.pluginId === scope.pluginId;
    case "collection":
      return item.collections.includes(scope.collectionId);
  }
}

function count(facets: Facets, item: ItemMetadata): void {
  facets.all += 1;
  if (item.favorite) facets.favourites += 1;

  bump(facets.byType, item.type);
  bump(facets.byTool, item.tool);
  bump(facets.byProject, item.projectId ?? GLOBAL);
  if (item.pluginId !== null) bump(facets.byPlugin, item.pluginId);

  for (const collection of item.collections) bump(facets.byCollection, collection);

  if (item.tags.length === 0) facets.untagged += 1;
  for (const tag of item.tags) bump(facets.byTag, tag);
}

function bump<K>(counter: Map<K, number>, key: K): void {
  counter.set(key, (counter.get(key) ?? 0) + 1);
}

function emptyFacets(): Facets {
  return {
    all: 0,
    favourites: 0,
    byType: new Map(),
    byTool: new Map(),
    byProject: new Map(),
    byPlugin: new Map(),
    byCollection: new Map(),
    byTag: new Map(),
    untagged: 0,
  };
}

function comparator(sort: SortOrder): (a: ItemMetadata, b: ItemMetadata) => number {
  switch (sort) {
    case "name-asc":
      return (a, b) => byName(a, b);
    case "name-desc":
      return (a, b) => byName(b, a);
    case "modified-desc":
      return (a, b) => byModified(a, b, true) || byName(a, b);
    case "modified-asc":
      return (a, b) => byModified(a, b, false) || byName(a, b);
  }
}

function byName(a: ItemMetadata, b: ItemMetadata): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/**
 * RFC 3339 in UTC sorts correctly as a string, which is one reason the
 * timestamps cross the boundary in that form.
 *
 * An item whose date could not be read sorts last in *both* directions. The
 * direction is applied here rather than by swapping the arguments, because
 * swapping would carry the unknowns to the front along with everything else.
 */
function byModified(a: ItemMetadata, b: ItemMetadata, descending: boolean): number {
  if (a.modified === null && b.modified === null) return 0;
  if (a.modified === null) return 1;
  if (b.modified === null) return -1;
  if (a.modified === b.modified) return 0;

  const ascending = a.modified < b.modified ? -1 : 1;
  return descending ? -ascending : ascending;
}

/** Every tag in the library, most used first, then alphabetical. */
export function tagsByFrequency(facets: Facets): Array<{ tag: string; count: number }> {
  return [...facets.byTag.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
