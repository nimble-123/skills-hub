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
              // Every other release's fix is the menubar's.
              scope: minor % 2 === 0 ? "menubar" : null,
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

  it("offers each scope as a filter, most used first", () => {
    const dialog = open();
    const filter = within(dialog).getByRole("group", { name: "Filter by scope" });
    const chips = within(filter).getAllByRole("button");

    expect(chips.map((chip) => chip.getAttribute("aria-label") ?? chip.textContent)).toEqual([
      "All",
      "No scope, 30 changes",
      "ui, 20 changes",
      "menubar, 10 changes",
    ]);
    expect(chips[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("narrows to a scope's changes, in the releases that have any, unfolded", async () => {
    const user = userEvent.setup();
    const dialog = open();

    await user.click(within(dialog).getByRole("button", { name: "menubar, 10 changes" }));

    expect(within(dialog).getByText(/10 changes in/).textContent).toBe(
      "10 changes in menubar across 10 releasesClear",
    );
    expect(within(dialog).queryByText("Feature number 20")).toBeNull();
    expect(within(dialog).getByText("Fix number 20")).toBeTruthy();
    expect(within(dialog).queryByText("Fix number 19")).toBeNull();

    // The older matches are open to read, not folded behind a click each.
    const rows = within(dialog)
      .getAllByRole("listitem")
      .map((li) => li.querySelector("details"))
      .filter((d): d is HTMLDetailsElement => d !== null);
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.open)).toBe(true);
    expect(within(dialog).getByText("Fix number 18")).toBeTruthy();
  });

  it("keeps the full card for the newest release, and says when a scope skips it", async () => {
    const user = userEvent.setup();
    const releases = history(4);
    const newest = releases[0];
    if (!newest) throw new Error("no history");
    // The newest release has no menubar change; two of the older ones do.
    newest.sections = newest.sections.filter((section) => section.kind !== "fixes");
    const dialog = open(releases, "0.4.0");

    await user.click(within(dialog).getByRole("button", { name: /^menubar,/ }));

    expect(within(dialog).queryByRole("article")).toBeNull();
    expect(within(dialog).getByText(/changes in 0\.4\.0, the latest release/).textContent).toBe(
      "No menubar changes in 0.4.0, the latest release.",
    );
    expect(within(dialog).getByText("Fix number 2")).toBeTruthy();
  });

  it("drops the scope label from each change while filtering to it", async () => {
    const user = userEvent.setup();
    const dialog = open();
    const latest = () => within(dialog).getByRole("article", { name: "Release 0.20.0" });
    expect(within(latest()).getByText("ui")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: /^ui,/ }));
    expect(within(latest()).queryByText("ui")).toBeNull();
  });

  it("goes back to everything from Clear, or by picking the scope again", async () => {
    const user = userEvent.setup();
    const dialog = open();
    const ui = within(dialog).getByRole("button", { name: "ui, 20 changes" });

    await user.click(ui);
    expect(ui.getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).queryByText("Fix number 20")).toBeNull();

    await user.click(ui);
    expect(ui.getAttribute("aria-pressed")).toBe("false");
    expect(within(dialog).getByText("Fix number 20")).toBeTruthy();

    await user.click(within(dialog).getByRole("button", { name: "menubar, 10 changes" }));
    await user.click(within(dialog).getByRole("button", { name: "Clear" }));
    expect(within(dialog).queryByText(/changes in/)).toBeNull();
    expect(within(dialog).getByText("Feature number 20")).toBeTruthy();
  });

  it("narrows to the changes committed without a scope", async () => {
    const user = userEvent.setup();
    const dialog = open();
    const bare = within(dialog).getByRole("button", { name: "No scope, 30 changes" });

    await user.click(bare);

    expect(bare.getAttribute("aria-pressed")).toBe("true");
    expect(within(dialog).getByText(/30 changes/).textContent).toBe(
      "30 changes without a scope across 20 releasesClear",
    );
    expect(within(dialog).queryByText("Feature number 20")).toBeNull();
    expect(within(dialog).queryByText("Fix number 20")).toBeNull();
    expect(within(dialog).getByText("Fix number 19")).toBeTruthy();
    expect(within(dialog).getByText("Docs for 20")).toBeTruthy();

    await user.click(bare);
    expect(within(dialog).getByText("Feature number 20")).toBeTruthy();
  });

  it("says when the latest release has nothing without a scope", async () => {
    const user = userEvent.setup();
    const releases = history(2);
    const newest = releases[0];
    if (!newest) throw new Error("no history");
    newest.sections = newest.sections.filter((section) => section.kind === "features");
    const dialog = open(releases, "0.2.0");

    await user.click(within(dialog).getByRole("button", { name: /^No scope,/ }));

    expect(within(dialog).queryByRole("article")).toBeNull();
    expect(within(dialog).getByText(/the latest release/).textContent).toBe(
      "No changes without a scope in 0.2.0, the latest release.",
    );
  });

  it("keeps All and no scope in place, and scrolls only the scopes", () => {
    const dialog = open();
    const ui = within(dialog).getByRole("button", { name: /^ui,/ });
    const all = within(dialog).getByRole("button", { name: "All" });
    const bare = within(dialog).getByRole("button", { name: /^No scope,/ });
    expect(ui.parentElement?.contains(all)).toBe(false);
    expect(ui.parentElement?.contains(bare)).toBe(false);
  });

  it("fades the chip row only on a side with more to scroll to", () => {
    const dialog = open();
    const row = within(dialog).getByRole("button", { name: /^ui,/ }).parentElement;
    if (!row) throw new Error("no chip row");
    // jsdom lays nothing out, so the row is given a width and a scroll range.
    Object.defineProperty(row, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(row, "scrollWidth", { value: 500, configurable: true });
    const scrollTo = (left: number) => {
      row.scrollLeft = left;
      fireEvent.scroll(row);
      return [row.hasAttribute("data-more-before"), row.hasAttribute("data-more-after")];
    };

    expect(scrollTo(0)).toEqual([false, true]);
    expect(scrollTo(100)).toEqual([true, true]);
    expect(scrollTo(200)).toEqual([true, false]);

    Object.defineProperty(row, "scrollWidth", { value: 300, configurable: true });
    expect(scrollTo(0)).toEqual([false, false]);
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
