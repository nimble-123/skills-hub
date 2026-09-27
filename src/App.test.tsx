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
