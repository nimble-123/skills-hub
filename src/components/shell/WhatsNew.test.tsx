import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Release } from "../../lib/changelog";

const opener = vi.hoisted(() => ({ openUrl: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/plugin-opener", () => opener);

import { WhatsNew } from "./WhatsNew";

/** A long history: the newest in full, and nineteen older ones. */
function history(count: number): Release[] {
  return Array.from({ length: count }, (_, index) => {
    const minor = count - index;
    return {
      version: `0.${minor}.0`,
      date: `2026-01-${String((minor % 28) + 1).padStart(2, "0")}`,
      compareUrl: null,
      sections: [
        {
          title: "Documentation",
          kind: "other",
          changes: [{ scope: null, text: `docs for ${minor}`, pr: null, commit: null }],
        },
        {
          title: "Features",
          kind: "features",
          changes: [
            {
              scope: "ui",
              text: `feature number ${minor}`,
              pr: { number: 100 + minor, url: `https://github.com/o/r/issues/${100 + minor}` },
              commit: { sha: "abcdef1", url: "https://github.com/o/r/commit/abcdef1" },
            },
          ],
        },
        {
          title: "Fixes",
          kind: "fixes",
          changes: [
            {
              scope: null,
              text: `fix number ${minor}`,
              pr: null,
              commit: { sha: "1234567", url: "https://github.com/o/r/commit/1234567" },
            },
          ],
        },
      ],
    } satisfies Release;
  });
}

const onClose = vi.fn();

function open(releases = history(20), installedVersion = "0.20.0") {
  render(
    <WhatsNew
      open
      onClose={onClose}
      installedVersion={installedVersion}
      commit="53580a7"
      releases={releases}
    />,
  );
  return screen.getByRole("dialog", { name: "What’s new" });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("what's new", () => {
  it("lays the newest release out in full, and says it is the one installed", () => {
    const dialog = open();
    const latest = within(dialog).getByRole("article", { name: "Release 0.20.0" });

    expect(within(latest).getByText("This version")).toBeTruthy();
    expect(within(latest).getByText("Feature number 20")).toBeTruthy();
    expect(within(latest).getByText("Fix number 20")).toBeTruthy();
    expect(within(dialog).getByText(/You’re on/).textContent).toContain("0.20.0 · 53580a7");
  });

  it("puts features before fixes, and folds documentation away", () => {
    const dialog = open();
    const latest = within(dialog).getByRole("article", { name: "Release 0.20.0" });
    const titles = within(latest)
      .getAllByRole("heading", { level: 4 })
      .map((heading) => heading.textContent);

    expect(titles.slice(0, 2)).toEqual(["Features", "Fixes"]);
    const fold = within(latest).getByText("1 more change to documentation").closest("details");
    expect(fold?.open).toBe(false);
  });

  it("lists older releases folded, one page at a time", async () => {
    const user = userEvent.setup();
    const dialog = open();

    const rows = () =>
      within(dialog)
        .getAllByRole("listitem")
        .filter((li) => li.querySelector("details"));
    expect(rows()).toHaveLength(8);
    expect(within(rows()[0] as HTMLElement).getByText("1 feature · 1 fix · 1 other")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: /Show 8 older releases/ }));
    expect(rows()).toHaveLength(16);

    await user.click(within(dialog).getByRole("button", { name: /Show 3 older releases/ }));
    expect(rows()).toHaveLength(19);
    expect(within(dialog).queryByRole("button", { name: /older release/ })).toBeNull();
  });

  it("marks the installed release even when it is not the newest", () => {
    const dialog = open(history(5), "0.3.0");
    const badges = within(dialog).getAllByText("This version");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.closest("summary")?.textContent).toContain("0.3.0");
  });

  it("opens a change's pull request, or its commit when there is no pull request", async () => {
    const user = userEvent.setup();
    const dialog = open();

    await user.click(
      within(dialog).getByRole("button", { name: "Open pull request 120 on GitHub" }),
    );
    expect(opener.openUrl).toHaveBeenLastCalledWith("https://github.com/o/r/issues/120");

    const latest = within(dialog).getByRole("article", { name: "Release 0.20.0" });
    await user.click(within(latest).getByRole("button", { name: "Open commit 1234567 on GitHub" }));
    expect(opener.openUrl).toHaveBeenLastCalledWith("https://github.com/o/r/commit/1234567");
  });

  it("closes from its button, and from a click on the backdrop but not on its content", async () => {
    const user = userEvent.setup();
    const dialog = open();

    await user.click(within(dialog).getByText("Feature number 20"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("says so when the build carries no releases", () => {
    const dialog = open([]);
    expect(within(dialog).getByText("No releases are recorded in this build.")).toBeTruthy();
  });

  it("reads the changelog bundled with the application when given none", () => {
    render(<WhatsNew open onClose={onClose} installedVersion="0.0.0" commit="unknown" />);
    const dialog = screen.getByRole("dialog", { name: "What’s new" });
    expect(within(dialog).getAllByRole("article")).toHaveLength(1);
  });
});
