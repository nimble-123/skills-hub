/**
 * Where the window is and what is selected.
 *
 * A discriminated union rather than a router: there is one window, the routes
 * are few, and this is directly serialisable for restoring a session.
 */

import { create } from "zustand";

export type Route =
  | { kind: "library" }
  | { kind: "discover" }
  | { kind: "dashboard" }
  | { kind: "mcp" }
  | { kind: "tools" }
  | { kind: "orphans" }
  | { kind: "settings" };

type UiStore = {
  route: Route;
  /** Entry id of the item shown in the detail rail. */
  selected: string | null;
  collapsedSections: Set<string>;
  commandPaletteOpen: boolean;

  go: (route: Route) => void;
  select: (entryId: string | null) => void;
  toggleSection: (name: string) => void;
  setCommandPaletteOpen: (open: boolean) => void;
};

export const useUi = create<UiStore>((set) => ({
  route: { kind: "library" },
  selected: null,
  collapsedSections: new Set(),
  commandPaletteOpen: false,

  go: (route) => set({ route }),
  select: (selected) => set({ selected }),

  toggleSection: (name) =>
    set((current) => {
      const next = new Set(current.collapsedSections);
      if (!next.delete(name)) next.add(name);
      return { collapsedSections: next };
    }),

  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
}));
