import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { anItem, aSnapshot } from "../../test/fixtures";

const commands = vi.hoisted(() => ({
  getSnapshot: vi.fn(),
  ensureSnapshot: vi.fn(),
  setItemEnabled: vi.fn(),
  closePopover: vi.fn(),
  showMainWindow: vi.fn(),
  quit: vi.fn(),
}));
vi.mock("../../bindings", () => ({ commands }));

/** What the host emits to this window, by event name. */
const listeners = vi.hoisted(() => new Map<string, () => void>());
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: (event: string, handler: () => void) => {
      listeners.set(event, handler);
      return Promise.resolve(() => listeners.delete(event));
    },
    // Never called on the real panel, whose delegate is not Tauri's.
    onFocusChanged: () => Promise.resolve(() => {}),
  }),
}));

import { Popover } from "./Popover";

const ok = <T,>(data: T) => ({ status: "ok" as const, data });
const favourite = anItem({ name: "writing", favorite: true });

/** The host showing the panel. */
async function open() {
  const opened = listeners.get("popover:opened");
  if (!opened) throw new Error("the popover is not listening for being opened");
  await act(async () => opened());
}

describe("the menubar popover", () => {
  beforeEach(() => {
    listeners.clear();
    commands.getSnapshot.mockResolvedValue(ok(null));
    commands.ensureSnapshot.mockResolvedValue(ok(aSnapshot([favourite])));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads when the host opens it, though nothing was cached when it mounted", async () => {
    // At start-up the window is still scanning, so the cache is empty.
    render(<Popover />);
    expect(await screen.findByText("Scanning…")).toBeTruthy();
    expect(commands.ensureSnapshot).not.toHaveBeenCalled();

    await open();

    expect(commands.ensureSnapshot).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("writing")).toBeTruthy();
    expect(screen.queryByText("Scanning…")).toBeNull();
  });

  it("shows what is cached at once, without scanning", async () => {
    commands.getSnapshot.mockResolvedValue(ok(aSnapshot([favourite])));
    render(<Popover />);

    expect(await screen.findByText("writing")).toBeTruthy();
    expect(commands.ensureSnapshot).not.toHaveBeenCalled();
  });

  it("picks up what changed each time it is opened again", async () => {
    render(<Popover />);
    await open();
    expect(await screen.findByText("writing")).toBeTruthy();

    commands.ensureSnapshot.mockResolvedValue(
      ok(aSnapshot([favourite, anItem({ name: "reviewing", favorite: true })])),
    );
    await open();

    expect(await screen.findByText("reviewing")).toBeTruthy();
    expect(commands.ensureSnapshot).toHaveBeenCalledTimes(2);
  });

  it("asks for a notes folder when none is chosen", async () => {
    commands.ensureSnapshot.mockResolvedValue(ok(null));
    render(<Popover />);
    await open();

    expect(await screen.findByText(/No notes folder yet/)).toBeTruthy();
  });
});
