/**
 * The library itself: one snapshot, replaced wholesale by a scan.
 *
 * `version` comes from the snapshot and increments with every scan. Everything
 * derived keys on it, so "a scan happened" invalidates all of it at once
 * instead of through a dozen hand-maintained call sites.
 */

import { Channel } from "@tauri-apps/api/core";
import { create } from "zustand";
import { commands, type ItemMetadata, type LibrarySnapshot, type Progress } from "../bindings";
import { reportError } from "./errors";

export type LoadState = "idle" | "loading" | "scanning" | "ready" | "needs-folder";

type LibraryStore = {
  snapshot: LibrarySnapshot | null;
  state: LoadState;
  progress: Progress | null;
  /** Reads the last scan without touching the disk. */
  load: () => Promise<void>;
  rescan: () => Promise<void>;
  /** Replaces one item after a command returned its new state. */
  patchItem: (item: ItemMetadata) => void;
  removeItem: (entryId: string) => void;
};

export const useLibrary = create<LibraryStore>((set, get) => ({
  snapshot: null,
  state: "idle",
  progress: null,

  load: async () => {
    set({ state: "loading" });
    const result = await commands.getSnapshot();
    if (result.status === "error") {
      reportError(result.error);
      set({ state: "idle" });
      return;
    }
    if (result.data === null) {
      // Nothing scanned yet this session.
      await get().rescan();
      return;
    }
    set({ snapshot: result.data, state: "ready" });
  },

  rescan: async () => {
    if (get().state === "scanning") return;
    set({ state: "scanning", progress: null });

    const channel = new Channel<Progress>();
    channel.onmessage = (progress) => set({ progress });

    const result = await commands.rescan({ skipPlugins: false }, channel);
    if (result.status === "error") {
      // Without a folder to keep notes in there is nothing to scan into; the
      // window shows the first-run prompt rather than an error.
      if (result.error.code === "no-metadata-folder") {
        set({ state: "needs-folder", progress: null });
        return;
      }
      reportError(result.error);
      set({ state: get().snapshot ? "ready" : "idle", progress: null });
      return;
    }
    set({ snapshot: result.data, state: "ready", progress: null });
  },

  patchItem: (item) =>
    set((current) => {
      if (!current.snapshot) return current;
      return {
        snapshot: {
          ...current.snapshot,
          items: current.snapshot.items.map((existing) =>
            existing.entryId === item.entryId ? item : existing,
          ),
        },
      };
    }),

  removeItem: (entryId) =>
    set((current) => {
      if (!current.snapshot) return current;
      return {
        snapshot: {
          ...current.snapshot,
          items: current.snapshot.items.filter((item) => item.entryId !== entryId),
        },
      };
    }),
}));

/** The items in the current snapshot, or an empty list before the first scan. */
export function useItems(): ItemMetadata[] {
  return useLibrary((store) => store.snapshot?.items ?? EMPTY);
}

/** Stable reference, so an empty library does not re-render on every change. */
const EMPTY: ItemMetadata[] = [];
