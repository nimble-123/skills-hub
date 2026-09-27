/**
 * Selectors whose result is stable between calls.
 *
 * A zustand selector runs on every store update and its result is compared by
 * reference, so `store.thing ?? []` builds a fresh array each time and the
 * component never stops re-rendering. Sharing one empty array per type is the
 * whole fix.
 */

import type { CollectionDef, ItemMetadata, PluginSource, ProjectWorkspace } from "../bindings";
import { useLibrary } from "./library";
import { useSettings } from "./settings";

const NO_ITEMS: ItemMetadata[] = [];
const NO_PLUGINS: PluginSource[] = [];
const NO_WORKSPACES: ProjectWorkspace[] = [];
const NO_COLLECTIONS: CollectionDef[] = [];

export function useSnapshotItems(): ItemMetadata[] {
  return useLibrary((store) => store.snapshot?.items ?? NO_ITEMS);
}

export function usePlugins(): PluginSource[] {
  return useLibrary((store) => store.snapshot?.plugins ?? NO_PLUGINS);
}

export function useWorkspaces(): ProjectWorkspace[] {
  return useSettings((store) => store.settings?.projectWorkspaces ?? NO_WORKSPACES);
}

export function useCollections(): CollectionDef[] {
  return useSettings((store) => store.settings?.collections ?? NO_COLLECTIONS);
}
