import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rendering smoke test.
 *
 * The one thing that cannot be checked from the terminal is whether the window
 * actually draws, so it is checked here instead: the shell mounts, the sidebar
 * counts agree with the grid, and the controls do what they say.
 *
 * The IPC layer is mocked. What is under test is the window's own behaviour;
 * everything behind the commands has its own tests in Rust.
 */

const commands = vi.hoisted(() => ({
  getSettings: vi.fn(),
  readItemContent: vi.fn(),
  setItemTags: vi.fn(),
  revealInFileManager: vi.fn(),
  writeItemContent: vi.fn(),
  describeTools: vi.fn(),
  listOrphanedMetadata: vi.fn(),
  forgetOrphanedMetadata: vi.fn(),
  probeCapabilities: vi.fn(),
  getDiscoverCatalog: vi.fn(),
  discoverAddSource: vi.fn(),
  discoverRefreshSource: vi.fn(),
  discoverRemoveSource: vi.fn(),
  installFromGithub: vi.fn(),
  checkForUpdates: vi.fn(),
  prepareReview: vi.fn(),
  applyReview: vi.fn(),
  cancelReview: vi.fn(),
  computeDashboard: vi.fn(),
  loadUsage: vi.fn(),
  disregard: vi.fn(),
  undisregard: vi.fn(),
  listDisregarded: vi.fn(),
  listMcpServers: vi.fn(),
  setPluginEnabled: vi.fn(),
  checkPath: vi.fn(),
  addCustomTool: vi.fn(),
  removeCustomTool: vi.fn(),
  setToolOverride: vi.fn(),
  saveCollection: vi.fn(),
  deleteCollection: vi.fn(),
  setItemInCollection: vi.fn(),
  getSnapshot: vi.fn(),
  rescan: vi.fn(),
  setItemEnabled: vi.fn(),
  setItemFavorite: vi.fn(),
  setMetadataFolder: vi.fn(),
  updateSettings: vi.fn(),
  addProjectWorkspace: vi.fn(),
  removeProjectWorkspace: vi.fn(),
}));

vi.mock("./bindings", () => ({ commands }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: unknown = null;
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { App } from "./App";
import { useToasts } from "./stores/errors";
import { useFilters } from "./stores/filters";
import { useLibrary } from "./stores/library";
import { useUi } from "./stores/ui";
import { anItem, aSettingsView, aSnapshot } from "./test/fixtures";

const ok = <T,>(data: T) => ({ status: "ok" as const, data });

const LIBRARY = [
  anItem({ name: "writing", type: "skill" }),
  anItem({ name: "review", type: "command", tool: "codex" }),
  anItem({ name: "tdd", type: "skill", enabled: false, tags: ["testing"] }),
  anItem({ name: "starred", type: "agent", favorite: true }),
];

beforeEach(() => {
  vi.clearAllMocks();
  commands.getSettings.mockResolvedValue(ok(aSettingsView()));
  commands.getSnapshot.mockResolvedValue(ok(aSnapshot(LIBRARY)));
  commands.listOrphanedMetadata.mockResolvedValue(ok([]));
  commands.getDiscoverCatalog.mockResolvedValue(ok({ sources: [], entries: [] }));
  commands.listMcpServers.mockResolvedValue(ok({ servers: [], warnings: [] }));
  commands.computeDashboard.mockResolvedValue(
    ok({
      costs: [],
      prune: [],
      overlaps: [],
      totalSourceChars: 0,
      totalAvailableChars: 0,
      totalInvocationChars: 0,
    }),
  );
  commands.probeCapabilities.mockResolvedValue(
    ok({
      home: "/home/someone",
      symlinksSupported: true,
      appVersion: "0.1.0",
      platform: "macos",
    }),
  );
  commands.checkPath.mockResolvedValue({ expanded: "/home/x", exists: true, isDirectory: true });
  commands.describeTools.mockResolvedValue(
    ok([
      {
        tool: aSettingsView().tools[0],
        shipped: aSettingsView().tools[0],
        overrides: { paths: {}, projectPaths: {} },
        detected: true,
        paths: [
          {
            type: "skill",
            configured: "~/.claude/skills",
            path: "/home/.claude/skills",
            exists: true,
            projectId: null,
          },
        ],
      },
    ]),
  );
  commands.readItemContent.mockResolvedValue(
    ok({
      raw: "---\nname: writing\n---\n\n# Writing\n\nSome guidance.\n",
      frontmatter: [{ key: "name", value: "writing" }],
      body: "\n# Writing\n\nSome guidance.\n",
      bytes: 48,
      modified: "2026-01-01T00:00:00Z",
      isSymlink: false,
      realPath: "/home/.claude/skills/writing/SKILL.md",
      siblingFiles: [{ path: "helper.py", bytes: 120 }],
    }),
  );
  // Zustand stores outlive a single render, so they are reset between tests.
  resetStores();
});

afterEach(cleanup);

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(screen.getByText("Everything")).toBeTruthy());
}

function cards(): string[] {
  return screen
    .getAllByRole("button")
    .filter((node) => node.getAttribute("aria-pressed") !== null && node.tagName === "DIV")
    .map((node) => within(node).getAllByText(/./)[0]?.textContent ?? "");
}

describe("the shell", () => {
  it("shows every item once the snapshot has loaded", async () => {
    await renderApp();
    expect(cards().sort()).toEqual(["review", "starred", "tdd", "writing"]);
  });

  it("counts the same things in the sidebar as it shows in the grid", async () => {
    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    const rowText = (label: string) =>
      within(sidebar)
        .getAllByRole("button")
        .find((node) => node.textContent?.startsWith(label))?.textContent;

    expect(rowText("All")).toBe("All4");
    expect(rowText("Skills")).toBe("Skills2");
    expect(rowText("Favourites")).toBe("Favourites1");
    // What the sidebar says and what the grid shows are one computation.
    expect(cards()).toHaveLength(4);
  });

  it("narrows to a type when its sidebar row is picked", async () => {
    const user = userEvent.setup();
    await renderApp();

    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: /^Skills/ }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Skills");
    expect(cards().sort()).toEqual(["tdd", "writing"]);
  });

  it("searches across name and description", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.type(screen.getByRole("searchbox", { name: /search/i }), "review");
    await waitFor(() => expect(cards()).toEqual(["review"]));
  });

  it("filters to the disabled items", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: "Off", pressed: false }));
    await waitFor(() => expect(cards()).toEqual(["tdd"]));
  });

  it("filters by a tag chip", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByRole("button", { name: /testing 1/ }));
    await waitFor(() => expect(cards()).toEqual(["tdd"]));
  });

  it("turns an item off through the switch, and shows the new state", async () => {
    const user = userEvent.setup();
    const disabled = { ...LIBRARY[0], enabled: false } as (typeof LIBRARY)[number];
    commands.setItemEnabled.mockResolvedValue(ok(disabled));

    await renderApp();
    await user.click(screen.getByRole("button", { name: "Disable writing" }));

    expect(commands.setItemEnabled).toHaveBeenCalledWith("writing-abc123", false);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Enable writing" })).toBeTruthy(),
    );
  });

  it("surfaces a failed command instead of swallowing it", async () => {
    const user = userEvent.setup();
    commands.setItemEnabled.mockResolvedValue({
      status: "error" as const,
      error: { code: "destination-exists", message: "something called writing is already there" },
    });

    await renderApp();
    await user.click(screen.getByRole("button", { name: "Disable writing" }));

    await waitFor(() =>
      expect(screen.getByText(/something called writing is already there/)).toBeTruthy(),
    );
  });

  it("opens the detail rail on a card, and closes it with escape", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.click(screen.getByText("writing"));
    const rail = await screen.findByRole("complementary", { name: /details for writing/i });
    // The body is rendered as markdown, not shown as source.
    expect(within(rail).getByRole("heading", { name: "Writing" })).toBeTruthy();
    expect(within(rail).getByText("Some guidance.")).toBeTruthy();
    expect(within(rail).getByText("helper.py")).toBeTruthy();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("complementary")).toBeNull());
  });

  it("adds a tag from the rail", async () => {
    const user = userEvent.setup();
    const tagged = { ...LIBRARY[0], tags: ["prose"] } as (typeof LIBRARY)[number];
    commands.setItemTags.mockResolvedValue(ok(tagged));

    await renderApp();
    await user.click(screen.getByText("writing"));
    await screen.findByRole("complementary", { name: /details for writing/i });

    await user.click(screen.getByRole("button", { name: "+ tag" }));
    await user.type(screen.getByRole("textbox", { name: "New tag" }), "prose{Enter}");

    expect(commands.setItemTags).toHaveBeenCalledWith("writing-abc123", ["prose"]);
  });

  it("moves the selection with the arrow keys", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard("{ArrowDown}");
    // Sorted by name: review, starred, tdd, writing.
    await screen.findByRole("complementary", { name: /details for review/i });

    await user.keyboard("{ArrowRight}");
    await screen.findByRole("complementary", { name: /details for starred/i });
  });

  it("focuses the search box on slash, and leaves the slash out of it", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard("/");
    const box = screen.getByRole("searchbox", { name: /search/i });
    expect(document.activeElement).toBe(box);
    expect((box as HTMLInputElement).value).toBe("");
  });

  it("opens the command palette and jumps to what is picked", async () => {
    const user = userEvent.setup();
    await renderApp();

    await user.keyboard("{Meta>}k{/Meta}");
    const palette = await screen.findByRole("dialog", { name: /find an item/i });

    await user.type(within(palette).getByRole("textbox"), "tdd");
    await user.keyboard("{Enter}");

    await screen.findByRole("complementary", { name: /details for tdd/i });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("edits the file and saves it with the keyboard", async () => {
    const user = userEvent.setup();
    const renamed = {
      ...LIBRARY[0],
      description: "now says something else",
    } as (typeof LIBRARY)[0];
    commands.writeItemContent.mockResolvedValue(ok(renamed));

    await renderApp();
    await user.click(screen.getByText("writing"));
    await screen.findByRole("complementary", { name: /details for writing/i });

    await user.click(screen.getByRole("button", { name: "Edit the file" }));
    const editor = screen.getByRole("textbox", { name: /source of writing/i });
    await user.clear(editor);
    await user.type(editor, "rewritten");
    await user.keyboard("{Meta>}s{/Meta}");

    expect(commands.writeItemContent).toHaveBeenCalledWith("writing-abc123", "rewritten");
    // Back to the rendered view once it has saved.
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /source of/i })).toBeNull());
  });

  it("reveals the link, or what it points at when alt is held", async () => {
    const user = userEvent.setup();
    commands.revealInFileManager.mockResolvedValue(ok(null));

    await renderApp();
    await user.click(screen.getByText("writing"));
    await screen.findByRole("complementary", { name: /details for writing/i });

    const reveal = screen.getByRole("button", { name: "Show in Finder" });
    await user.click(reveal);
    expect(commands.revealInFileManager).toHaveBeenLastCalledWith(
      "/home/.claude/skills/writing/SKILL.md",
      false,
    );

    await user.keyboard("{Alt>}");
    await user.click(reveal);
    await user.keyboard("{/Alt}");
    expect(commands.revealInFileManager).toHaveBeenLastCalledWith(
      "/home/.claude/skills/writing/SKILL.md",
      true,
    );
  });

  it("opens the settings page from the sidebar", async () => {
    const user = userEvent.setup();
    await renderApp();

    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "Settings" }));

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    // It shows what it found out about this machine, not just what was saved.
    await waitFor(() => expect(screen.getByText("/home/someone")).toBeTruthy());
  });

  it("opens the tools page and shows each path as an editable field", async () => {
    const user = userEvent.setup();
    await renderApp();

    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "All tools" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Tools"),
    );
    const field = screen.getByLabelText("Skills") as HTMLInputElement;
    expect(field.value).toBe("~/.claude/skills");
  });

  /// Every tool card renders the same four labels, so the ids have to differ.
  it("gives every path field its own id, across tools and scopes", async () => {
    const user = userEvent.setup();
    commands.describeTools.mockResolvedValue(
      ok(
        ["claude-code", "cursor"].map((id) => ({
          tool: { ...aSettingsView().tools[0], id },
          shipped: { ...aSettingsView().tools[0], id },
          overrides: { paths: {}, projectPaths: {} },
          detected: true,
          paths: [],
        })),
      ),
    );

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "All tools" }));
    await waitFor(() => expect(screen.getAllByLabelText("Skills").length).toBe(2));

    const ids = screen.getAllByLabelText("Skills").map((field) => field.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stores only the difference when a path is changed", async () => {
    const user = userEvent.setup();
    commands.setToolOverride.mockResolvedValue(ok(aSettingsView()));
    commands.rescan.mockResolvedValue(ok(aSnapshot(LIBRARY)));

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "All tools" }));
    await screen.findByLabelText("Skills");

    const field = screen.getByLabelText("Skills");
    await user.clear(field);
    await user.type(field, "~/elsewhere/skills");
    await user.tab();

    expect(commands.setToolOverride).toHaveBeenCalledWith("claude-code", {
      paths: { skill: "~/elsewhere/skills" },
      projectPaths: {},
    });
  });

  /** Typing the shipped value back should stop storing a difference at all. */
  it("stops storing an override once a path is back to the default", async () => {
    const user = userEvent.setup();
    commands.describeTools.mockResolvedValue(
      ok([
        {
          tool: { ...aSettingsView().tools[0], paths: { skill: "~/elsewhere/skills" } },
          shipped: aSettingsView().tools[0],
          overrides: { paths: { skill: "~/elsewhere/skills" }, projectPaths: {} },
          detected: true,
          paths: [],
        },
      ]),
    );
    commands.setToolOverride.mockResolvedValue(ok(aSettingsView()));
    commands.rescan.mockResolvedValue(ok(aSnapshot(LIBRARY)));

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "All tools" }));
    await screen.findByLabelText("Skills");

    await user.click(screen.getAllByRole("button", { name: "Reset" })[0] as HTMLElement);

    expect(commands.setToolOverride).toHaveBeenCalledWith("claude-code", {
      paths: {},
      projectPaths: {},
    });
  });

  it("hides a tool from the sidebar without stopping it being scanned", async () => {
    const user = userEvent.setup();
    commands.setToolOverride.mockResolvedValue(ok(aSettingsView()));
    commands.rescan.mockResolvedValue(ok(aSnapshot(LIBRARY)));

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "All tools" }));
    await screen.findByLabelText("Skills");

    await user.click(screen.getByRole("checkbox", { name: /show in the sidebar/i }));

    expect(commands.setToolOverride).toHaveBeenCalledWith("claude-code", {
      paths: {},
      projectPaths: {},
      disabled: true,
    });
  });

  it("adds a tool it does not ship", async () => {
    const user = userEvent.setup();
    commands.addCustomTool.mockResolvedValue(ok(null));
    commands.rescan.mockResolvedValue(ok(aSnapshot(LIBRARY)));

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "All tools" }));
    await screen.findByLabelText("Name");

    await user.type(screen.getByLabelText("Name"), "my-tool");
    await user.type(screen.getByLabelText("Skills folder"), "~/.my-tool/skills");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(commands.addCustomTool).toHaveBeenCalledWith("my-tool", {
      skill: "~/.my-tool/skills",
    });
  });

  it("shows broken links and orphaned notes on their own page", async () => {
    const user = userEvent.setup();
    commands.getSnapshot.mockResolvedValue(
      ok({
        ...aSnapshot(LIBRARY),
        brokenSymlinks: [
          {
            path: "/home/.claude/skills/gone/SKILL.md",
            target: "../../elsewhere",
            targetPath: "/home/elsewhere",
            tool: "claude-code",
            type: "skill",
            projectId: null,
          },
        ],
        orphanCount: 1,
      }),
    );
    commands.listOrphanedMetadata.mockResolvedValue(
      ok([
        {
          entryId: "old-abc",
          name: "old",
          tool: "codex",
          orphanedAt: "2026-09-01T00:00:00Z",
          hasUserData: true,
          path: "/home/.codex/skills/old/SKILL.md",
        },
      ]),
    );

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: /Broken links/ }));

    expect(screen.getByRole("heading", { level: 1, name: "Needs a look" })).toBeTruthy();
    expect(screen.getByText("/home/.claude/skills/gone/SKILL.md")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("old")).toBeTruthy());
    // A note with the user's own tags in it says so rather than being removed.
    expect(screen.getByText(/has your tags/)).toBeTruthy();
  });

  it("suggests somewhere to start when nothing is watched yet", async () => {
    const user = userEvent.setup();
    await renderApp();

    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "Discover" }));

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Discover");
    expect(screen.getByRole("button", { name: /anthropics\/skills/ })).toBeTruthy();
  });

  it("watches a repository, splitting a pasted subfolder link apart", async () => {
    const user = userEvent.setup();
    commands.discoverAddSource.mockResolvedValue(ok({ sources: [], entries: [] }));

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "Discover" }));

    await user.type(
      screen.getByRole("textbox", { name: /repository to watch/i }),
      "https://github.com/acme/skills/tree/next/packs/writing{Enter}",
    );

    expect(commands.discoverAddSource).toHaveBeenCalledWith(
      "https://github.com/acme/skills",
      "next",
      "packs/writing",
    );
  });

  it("lists what a watched repository holds, and marks what is already installed", async () => {
    const user = userEvent.setup();
    const entry = (name: string, subpath: string) => ({
      id: `${name}-1`,
      sourceId: "src-1",
      repoUrl: "https://github.com/acme/skills",
      refName: "",
      subpath,
      type: "skill" as const,
      name,
      description: `${name} does things`,
      tags: [],
      commit: "abc1234",
      manifest: "---\n---\n",
      discoveredAt: "2026-09-27T12:00:00Z",
    });
    commands.getDiscoverCatalog.mockResolvedValue(
      ok({
        sources: [
          {
            id: "src-1",
            repoUrl: "https://github.com/acme/skills",
            refName: "",
            subpath: "",
            addedAt: "2026-09-27T12:00:00Z",
            stars: 42,
            starsFetchedAt: "2026-09-27T12:00:00Z",
          },
        ],
        entries: [entry("fresh", "skills/fresh"), entry("already", "skills/already")],
      }),
    );
    commands.getSnapshot.mockResolvedValue(
      ok(
        aSnapshot([
          ...LIBRARY,
          anItem({
            name: "already",
            sourceRepo: "https://github.com/acme/skills",
            sourceSubpath: "skills/already",
          }),
        ]),
      ),
    );

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "Discover" }));

    await waitFor(() => expect(screen.getByText("acme/skills")).toBeTruthy());
    expect(screen.getByText(/★ 42/)).toBeTruthy();
    // One can be installed; the other already is.
    expect(screen.getAllByRole("button", { name: "Install" })).toHaveLength(1);
    expect(screen.getByText("installed")).toBeTruthy();
  });

  it("shows a diff before replacing anything, and applies it on request", async () => {
    const user = userEvent.setup();
    const tracked = anItem({
      name: "writing",
      sourceRepo: "https://github.com/acme/skills",
      sourceSubpath: "skills/writing",
      sourceCommit: "1111111aaaa",
    });
    commands.getSnapshot.mockResolvedValue(ok(aSnapshot([tracked])));
    commands.checkForUpdates.mockResolvedValue(
      ok([{ entryId: tracked.entryId, status: "stale", remoteCommit: "2222222bbbb", error: null }]),
    );
    commands.prepareReview.mockResolvedValue(
      ok({
        reviewId: "rev-1",
        entryId: tracked.entryId,
        lines: [
          { marker: "-", number: 1, segments: [{ text: "First version.", emphasis: true }] },
          { marker: "+", number: 1, segments: [{ text: "Second version.", emphasis: true }] },
        ],
        stats: { added: 1, removed: 1 },
        companions: [{ path: "scripts/check.py", status: "added" }],
        commit: "2222222bbbb",
        unchanged: false,
      }),
    );
    commands.applyReview.mockResolvedValue(ok({ ...tracked, sourceCommit: "2222222bbbb" }));

    await renderApp();
    await user.click(screen.getByText("writing"));
    await screen.findByRole("complementary", { name: /details for writing/i });

    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    // The diff is shown and nothing has been written yet.
    await waitFor(() => expect(screen.getByText("Second version.")).toBeTruthy());
    expect(screen.getByText("scripts/check.py")).toBeTruthy();
    expect(screen.getByText(/replaces your local copy/i)).toBeTruthy();
    expect(commands.applyReview).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(commands.applyReview).toHaveBeenCalledWith("rev-1");
  });

  it("says so when the repository moved but the item did not", async () => {
    const user = userEvent.setup();
    const tracked = anItem({
      name: "writing",
      sourceRepo: "https://github.com/acme/skills",
      sourceSubpath: "skills/writing",
      sourceCommit: "1111111aaaa",
    });
    commands.getSnapshot.mockResolvedValue(ok(aSnapshot([tracked])));
    commands.checkForUpdates.mockResolvedValue(
      ok([{ entryId: tracked.entryId, status: "stale", remoteCommit: "2222222bbbb", error: null }]),
    );
    commands.prepareReview.mockResolvedValue(
      ok({
        reviewId: "rev-2",
        entryId: tracked.entryId,
        lines: [],
        stats: { added: 0, removed: 0 },
        companions: [],
        commit: "2222222bbbb",
        unchanged: true,
      }),
    );

    await renderApp();
    await user.click(screen.getByText("writing"));
    await screen.findByRole("complementary", { name: /details for writing/i });
    await user.click(screen.getByRole("button", { name: "Check for updates" }));

    await waitFor(() => expect(screen.getByText(/nothing about this item did/i)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Record the newer commit" })).toBeTruthy();
  });

  it("throws the review away when it is cancelled, so its clone goes too", async () => {
    const user = userEvent.setup();
    const tracked = anItem({
      name: "writing",
      sourceRepo: "https://github.com/acme/skills",
      sourceCommit: "1111111aaaa",
    });
    commands.getSnapshot.mockResolvedValue(ok(aSnapshot([tracked])));
    commands.prepareReview.mockResolvedValue(
      ok({
        reviewId: "rev-3",
        entryId: tracked.entryId,
        lines: [],
        stats: { added: 0, removed: 0 },
        companions: [],
        commit: "3333333cccc",
        unchanged: false,
      }),
    );
    commands.cancelReview.mockResolvedValue(ok(null));

    await renderApp();
    await user.click(screen.getByText("writing"));
    await screen.findByRole("complementary", { name: /details for writing/i });
    await user.click(screen.getByRole("button", { name: "Restore installed version" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy());
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(commands.cancelReview).toHaveBeenCalledWith("rev-3");
  });

  it("shows what the library costs, and what stands out", async () => {
    const user = userEvent.setup();
    commands.computeDashboard.mockResolvedValue(
      ok({
        costs: [
          {
            entryId: "writing-abc123",
            name: "writing",
            tool: "claude-code",
            type: "skill",
            sourceChars: 8000,
            availableChars: 200,
            invocationChars: 7600,
            modified: "2026-01-01T00:00:00Z",
          },
          {
            entryId: "deploy-abc",
            name: "deploy",
            tool: "claude-code",
            type: "command",
            sourceChars: 400,
            availableChars: null,
            invocationChars: null,
            modified: "2026-01-01T00:00:00Z",
          },
        ],
        prune: [
          {
            entryId: "stale-abc",
            name: "stale",
            tool: "claude-code",
            reason: "never-used",
            sourceChars: 5000,
            lastUsed: null,
            modified: "2024-01-01T00:00:00Z",
          },
        ],
        overlaps: [
          {
            a: "a",
            b: "b",
            aName: "review",
            bName: "Review",
            pairId: "a::b",
            reason: "same-name",
            similarity: 1,
          },
        ],
        totalSourceChars: 8400,
        totalAvailableChars: 200,
        totalInvocationChars: 7600,
      }),
    );

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "Cost" }));

    await waitFor(() => expect(screen.getByText("writing")).toBeTruthy());
    // A command's per-turn cost is not guessed at.
    expect(screen.getByText(/context not modelled/)).toBeTruthy();
    expect(screen.getByText("never used")).toBeTruthy();
    expect(screen.getByText("same name")).toBeTruthy();
  });

  it("waves a suggestion away without touching the item", async () => {
    const user = userEvent.setup();
    commands.computeDashboard.mockResolvedValue(
      ok({
        costs: [],
        prune: [
          {
            entryId: "stale-abc",
            name: "stale",
            tool: "claude-code",
            reason: "never-used",
            sourceChars: 5000,
            lastUsed: null,
            modified: null,
          },
        ],
        overlaps: [],
        totalSourceChars: 0,
        totalAvailableChars: 0,
        totalInvocationChars: 0,
      }),
    );
    commands.disregard.mockResolvedValue(ok(null));

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "Cost" }));

    await waitFor(() => expect(screen.getByText("never used")).toBeTruthy());
    await user.click(screen.getAllByRole("button", { name: "Disregard" })[0] as HTMLElement);

    expect(commands.disregard).toHaveBeenCalledWith("stale-abc");
    expect(commands.setItemEnabled).not.toHaveBeenCalled();
  });

  it("lists MCP servers and keeps their secrets covered until asked", async () => {
    const user = userEvent.setup();
    commands.listMcpServers.mockResolvedValue(
      ok({
        servers: [
          {
            id: "claude-code:global:obsidian",
            name: "obsidian",
            tool: "claude-code",
            projectId: null,
            config: {
              command: "npx",
              args: ["-y", "obsidian-mcp"],
              env: { TOKEN: "super-secret" },
              url: null,
              type: null,
            },
            sourcePath: "/home/.claude.json",
          },
        ],
        warnings: [],
      }),
    );

    await renderApp();
    const sidebar = screen.getByRole("navigation", { name: "Library" });
    await user.click(within(sidebar).getByRole("button", { name: "MCP servers" }));

    await waitFor(() => expect(screen.getByText("obsidian")).toBeTruthy());
    expect(screen.getByText("npx -y obsidian-mcp")).toBeTruthy();
    expect(screen.queryByText("super-secret")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByText("super-secret")).toBeTruthy();
  });

  it("switches a whole bundle when the item came from one", async () => {
    const user = userEvent.setup();
    const bundled = anItem({ name: "bundled", pluginId: "toolkit@acme" });
    commands.getSnapshot.mockResolvedValue(
      ok({
        ...aSnapshot([bundled]),
        plugins: [
          {
            id: "toolkit@acme",
            name: "toolkit",
            group: "acme",
            path: "/home/.claude/plugins/cache/acme/toolkit/1.0.0",
            toolId: "claude-code",
            enabled: true,
            repoUrl: null,
          },
        ],
      }),
    );
    commands.setPluginEnabled.mockResolvedValue(ok(null));
    commands.rescan.mockResolvedValue(ok(aSnapshot([])));

    await renderApp();
    await user.click(screen.getByRole("button", { name: "Disable bundled" }));

    // Not the item: the bundle is the unit its own tool understands.
    expect(commands.setItemEnabled).not.toHaveBeenCalled();
    expect(commands.setPluginEnabled).toHaveBeenCalledWith("claude-code", "toolkit@acme", false);
  });

  it("puts an item into a collection", async () => {
    const user = userEvent.setup();
    commands.getSettings.mockResolvedValue(
      ok({
        ...aSettingsView(),
        settings: {
          ...aSettingsView().settings,
          collections: [{ id: "col-1", name: "Daily", icon: null }],
        },
      }),
    );
    commands.setItemInCollection.mockResolvedValue(ok({ ...LIBRARY[0], collections: ["col-1"] }));

    await renderApp();
    await user.click(screen.getByText("writing"));
    await screen.findByRole("complementary", { name: /details for writing/i });

    await user.click(screen.getByRole("checkbox", { name: "Daily" }));

    expect(commands.setItemInCollection).toHaveBeenCalledWith("writing-abc123", "col-1", true);
  });

  it("asks for a folder when there is nowhere to keep the notes", async () => {
    commands.getSnapshot.mockResolvedValue(ok(null));
    commands.rescan.mockResolvedValue({
      status: "error" as const,
      error: { code: "no-metadata-folder", message: "choose a folder" },
    });

    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /choose a folder/i })).toBeTruthy(),
    );
  });
});

/** Zustand stores are module singletons; each test starts from a clean one. */
function resetStores() {
  useFilters.getState().clearAll();
  useFilters.setState({ scope: { kind: "all" } });
  useLibrary.setState({ snapshot: null, state: "idle", progress: null });
  useUi.setState({ route: { kind: "library" }, selected: null });
  useToasts.setState({ toasts: [] });
}
