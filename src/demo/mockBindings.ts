/**
 * The command surface, answered from fixtures.
 *
 * Stands in for `bindings.ts` in the demo build the screenshots are taken
 * from. Everything the window can ask for has an answer, so a screenshot
 * never catches a loading state or an error toast.
 */

import type { commands as real } from "../bindings";
import {
  CATALOG,
  DASHBOARD,
  ITEM_CONTENT,
  ITEMS,
  MCP_SERVERS,
  REVIEW,
  SETTINGS,
  SNAPSHOT,
  TOOL_REPORTS,
} from "./fixtures";

const ok = <T>(data: T) => Promise.resolve({ status: "ok" as const, data });
const nothing = () => ok(null);

export const commands: typeof real = {
  probeCapabilities: () =>
    ok({
      home: "/Users/you",
      symlinksSupported: true,
      appVersion: "0.1.0",
      platform: "macos",
    }),

  getSettings: () => ok(SETTINGS),
  updateSettings: () => ok(SETTINGS),
  setToolOverride: () => ok(SETTINGS),
  setMetadataFolder: () => ok(SETTINGS),
  addProjectWorkspace: () => ok(SETTINGS),
  removeProjectWorkspace: () => ok(SETTINGS),

  getSnapshot: () => ok(SNAPSHOT),
  rescan: () => ok(SNAPSHOT),
  listOrphanedMetadata: () => ok([]),
  forgetOrphanedMetadata: () => ok(0),

  readItemContent: () => ok(ITEM_CONTENT),
  writeItemContent: (entryId) => ok(byId(entryId)),
  setItemEnabled: (entryId, enabled) => ok({ ...byId(entryId), enabled }),
  setItemFavorite: (entryId, favorite) => ok({ ...byId(entryId), favorite }),
  setItemTags: (entryId, tags) => ok({ ...byId(entryId), tags }),
  setItemCollections: (entryId, collections) => ok({ ...byId(entryId), collections }),
  setItemInCollection: (entryId) => ok(byId(entryId)),
  linkIntoProject: () => ok("/Users/you/work/demo/.claude/skills/linked"),
  unlinkFromProject: nothing,
  deleteItem: nothing,
  setPluginEnabled: nothing,

  describeTools: () => ok(TOOL_REPORTS),
  checkPath: () =>
    Promise.resolve({ expanded: "/Users/you/.claude/skills", exists: true, isDirectory: true }),
  addCustomTool: nothing,
  removeCustomTool: nothing,

  revealInFileManager: nothing,
  openPath: nothing,

  getDiscoverCatalog: () => ok(CATALOG),
  discoverAddSource: () => ok(CATALOG),
  discoverRefreshSource: () => ok(CATALOG),
  discoverRemoveSource: () => ok(CATALOG),
  installFromGithub: () => ok(ITEMS[0] as (typeof ITEMS)[number]),

  checkForUpdates: () =>
    ok([
      {
        entryId: REVIEW.entryId,
        status: "stale" as const,
        remoteCommit: REVIEW.commit,
        error: null,
      },
    ]),
  prepareReview: () => ok(REVIEW),
  applyReview: (_reviewId) => ok(byId(REVIEW.entryId)),
  cancelReview: nothing,

  loadUsage: () => ok({}),
  computeDashboard: () => ok(DASHBOARD),
  disregard: nothing,
  undisregard: nothing,
  listDisregarded: () => ok([]),
  listMcpServers: () => ok({ servers: MCP_SERVERS, warnings: [] }),

  saveCollection: () => ok(SETTINGS.settings.collections ?? []),
  deleteCollection: () => ok(SETTINGS.settings.collections ?? []),
};

function byId(entryId: string) {
  return ITEMS.find((item) => item.entryId === entryId) ?? (ITEMS[0] as (typeof ITEMS)[number]);
}
