/**
 * What the user is narrowing the library down to.
 *
 * The scope is exclusive and the filters compound — see `lib/library.ts` for
 * why the two behave differently.
 */

import { create } from "zustand";
import type { EnabledFilter, SortOrder } from "../bindings";
import { type Filters, NO_FILTERS, type Scope, type SourceFilter } from "../lib/library";

type FilterStore = Filters & {
  scope: Scope;
  setScope: (scope: Scope) => void;
  setSearch: (search: string) => void;
  setEnabled: (enabled: EnabledFilter) => void;
  setSource: (source: SourceFilter) => void;
  setSort: (sort: SortOrder) => void;
  /** Selecting the tag already selected clears it, as a chip should. */
  toggleTag: (tag: string) => void;
  toggleUntagged: () => void;
  clearAll: () => void;
};

export const useFilters = create<FilterStore>((set) => ({
  ...NO_FILTERS,
  scope: { kind: "all" },

  setScope: (scope) => set({ scope }),
  setSearch: (search) => set({ search }),
  setEnabled: (enabled) => set({ enabled }),
  setSource: (source) => set({ source }),
  setSort: (sort) => set({ sort }),

  toggleTag: (tag) =>
    set((current) => ({
      tag: current.tag === tag ? null : tag,
      untagged: false,
    })),

  toggleUntagged: () => set((current) => ({ untagged: !current.untagged, tag: null })),

  clearAll: () => set({ ...NO_FILTERS }),
}));

/** Whether anything beyond the scope is narrowing the list. */
export function useHasActiveFilters(): boolean {
  return useFilters(
    (f) =>
      f.search.trim() !== "" ||
      f.enabled !== "all" ||
      f.tag !== null ||
      f.untagged ||
      f.source !== "all",
  );
}
