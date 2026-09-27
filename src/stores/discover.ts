/**
 * Repositories being watched, and what was found in them.
 *
 * Every command here returns the whole catalogue, so there is one place that
 * accepts a result and nothing to keep in step by hand.
 */

import { create } from "zustand";
import { commands, type DiscoverCatalog } from "../bindings";
import { reportError, reportInfo } from "./errors";

/** The catalogue always has both lists; the generated type makes them optional. */
type Catalog = Required<DiscoverCatalog>;

type DiscoverStore = {
  catalog: Catalog;
  /** The id of whatever is being cloned, or null. */
  busy: string | null;
  load: () => Promise<void>;
  addSource: (repoUrl: string, refName: string, subpath: string) => Promise<boolean>;
  refreshSource: (sourceId: string) => Promise<void>;
  removeSource: (sourceId: string) => Promise<void>;
};

const EMPTY: Catalog = { sources: [], entries: [] };

export const useDiscover = create<DiscoverStore>((set, get) => {
  const accept = (result: Awaited<ReturnType<typeof commands.getDiscoverCatalog>>): boolean => {
    if (result.status === "error") {
      reportError(result.error);
      return false;
    }
    set({
      catalog: { sources: result.data.sources ?? [], entries: result.data.entries ?? [] },
    });
    return true;
  };

  return {
    catalog: EMPTY,
    busy: null,

    load: async () => {
      accept(await commands.getDiscoverCatalog());
    },

    addSource: async (repoUrl, refName, subpath) => {
      if (get().busy) return false;
      set({ busy: "new" });
      const before = get().catalog.entries.length;
      const ok = accept(await commands.discoverAddSource(repoUrl, refName, subpath));
      set({ busy: null });
      if (ok) {
        const found = get().catalog.entries.length - before;
        reportInfo(found > 0 ? `Found ${found} items` : "Nothing installable in there");
      }
      return ok;
    },

    refreshSource: async (sourceId) => {
      if (get().busy) return;
      set({ busy: sourceId });
      accept(await commands.discoverRefreshSource(sourceId));
      set({ busy: null });
    },

    removeSource: async (sourceId) => {
      accept(await commands.discoverRemoveSource(sourceId));
    },
  };
});
