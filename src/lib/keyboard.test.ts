import { describe, expect, it } from "vitest";
import { moveWithin, shortcutFor } from "./keyboard";

function press(key: string, options: Partial<Parameters<typeof shortcutFor>[0]> = {}) {
  return shortcutFor({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    target: null,
    ...options,
  });
}

describe("shortcuts", () => {
  it.each([
    ["/", "focus-search"],
    ["Escape", "close-rail"],
    ["ArrowDown", "move-down"],
    ["Enter", "open"],
  ] as const)("reads %s as %s", (key, expected) => {
    expect(press(key)).toBe(expected);
  });

  it("takes either modifier, so the same keys work on every platform", () => {
    expect(press("k", { metaKey: true })).toBe("command-palette");
    expect(press("k", { ctrlKey: true })).toBe("command-palette");
    expect(press("r", { metaKey: true })).toBe("rescan");
  });

  it("ignores an unknown key", () => {
    expect(press("q")).toBeNull();
    expect(press("F5")).toBeNull();
  });

  it("ignores anything with alt, which belongs to text entry", () => {
    expect(press("/", { altKey: true })).toBeNull();
  });
});

describe("while typing", () => {
  // Only the two properties `isTyping` looks at; no DOM needed.
  const input = () => ({ target: { tagName: "INPUT" } as unknown as EventTarget });

  it("leaves plain keys alone, because they are text", () => {
    expect(press("/", input())).toBeNull();
    expect(press("ArrowDown", input())).toBeNull();
    expect(press("Enter", input())).toBeNull();
  });

  it("still lets escape get out", () => {
    expect(press("Escape", input())).toBe("close-rail");
  });

  it("still takes a modified shortcut", () => {
    expect(press("k", { ...input(), metaKey: true })).toBe("command-palette");
  });
});

describe("moving within the grid", () => {
  // A 3-column grid of 7 items: indices 0..6.
  const move = (index: number, direction: Parameters<typeof moveWithin>[3]) =>
    moveWithin(index, 7, 3, direction);

  it("moves one along, and one row up or down", () => {
    expect(move(0, "move-right")).toBe(1);
    expect(move(1, "move-left")).toBe(0);
    expect(move(0, "move-down")).toBe(3);
    expect(move(3, "move-up")).toBe(0);
  });

  it("stays put rather than wrapping at an edge", () => {
    expect(move(0, "move-left")).toBe(0);
    expect(move(0, "move-up")).toBe(0);
    expect(move(6, "move-right")).toBe(6);
    expect(move(6, "move-down")).toBe(6);
  });

  it("does not fall off the end of a ragged last row", () => {
    // Index 5 is on the second row; one row down would be 8, past the end.
    expect(move(5, "move-down")).toBe(5);
  });

  it("starts at the first item when nothing is selected", () => {
    expect(move(-1, "move-down")).toBe(0);
  });

  it("selects nothing when there is nothing", () => {
    expect(moveWithin(-1, 0, 3, "move-down")).toBe(-1);
  });
});
