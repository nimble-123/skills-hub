/**
 * The user's configuration, and the tool registry it resolves to.
 *
 * Kept together because the frontend always needs both: an override means
 * nothing without the tool it applies to.
 */

import { create } from "zustand";
import { type AppSettings, commands, type ToolConfig } from "../bindings";
import { reportError } from "./errors";

type SettingsStore = {
  settings: AppSettings | null;
  tools: ToolConfig[];
  load: () => Promise<void>;
  setMetadataFolder: (folder: string) => Promise<boolean>;
  addProjectWorkspace: (path: string, name?: string) => Promise<boolean>;
  removeProjectWorkspace: (id: string) => Promise<void>;
  update: (settings: AppSettings) => Promise<void>;
};

export const useSettings = create<SettingsStore>((set) => {
  /** Every command here returns the whole view, so one handler serves them all. */
  const accept = (result: Awaited<ReturnType<typeof commands.getSettings>>): boolean => {
    if (result.status === "error") {
      reportError(result.error);
      return false;
    }
    set({ settings: result.data.settings, tools: result.data.tools });
    return true;
  };

  return {
    settings: null,
    tools: [],

    load: async () => {
      accept(await commands.getSettings());
    },
    setMetadataFolder: async (folder) => accept(await commands.setMetadataFolder(folder)),
    addProjectWorkspace: async (path, name) =>
      accept(await commands.addProjectWorkspace(path, name ?? null)),
    removeProjectWorkspace: async (id) => {
      accept(await commands.removeProjectWorkspace(id));
    },
    update: async (settings) => {
      accept(await commands.updateSettings(settings));
    },
  };
});

/** Tools the user has not switched off, in registry order. */
export function useVisibleTools(): ToolConfig[] {
  return useSettings((store) => store.tools);
}
