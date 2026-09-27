/**
 * Which shortcut a key event is, if any.
 *
 * Kept as a pure function so the rules can be tested without a window, and so
 * that one place decides when a shortcut should be ignored — most importantly
 * while the user is typing into a field, where `/` is a slash.
 */

export type Shortcut =
  | "focus-search"
  | "close-rail"
  | "rescan"
  | "command-palette"
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "open";

type KeyLike = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

export function shortcutFor(event: KeyLike): Shortcut | null {
  const modified = event.metaKey || event.ctrlKey;

  // A modified key is a command wherever it is pressed; an unmodified one is
  // text as soon as there is somewhere to type it.
  if (modified) {
    if (event.key === "k") return "command-palette";
    if (event.key === "r") return "rescan";
    return null;
  }
  if (event.altKey) return null;
  if (isTyping(event.target)) {
    // Escape still gets out of a field, and that is all.
    return event.key === "Escape" ? "close-rail" : null;
  }

  switch (event.key) {
    case "/":
      return "focus-search";
    case "Escape":
      return "close-rail";
    case "ArrowLeft":
      return "move-left";
    case "ArrowRight":
      return "move-right";
    case "ArrowUp":
      return "move-up";
    case "ArrowDown":
      return "move-down";
    case "Enter":
      return "open";
    default:
      return null;
  }
}

/**
 * Whether the event came from somewhere the user is entering text.
 *
 * Duck-typed rather than `instanceof HTMLElement`, so this module needs no DOM
 * and can be tested as the pure function it is.
 */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  return (
    element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT"
  );
}

/**
 * Where an arrow key moves the selection within a grid.
 *
 * Returns the index to move to, clamped, or the current one when the move
 * would leave the grid — so holding an arrow at an edge does nothing rather
 * than wrapping to the far side.
 */
export function moveWithin(
  index: number,
  count: number,
  columns: number,
  direction: "move-left" | "move-right" | "move-up" | "move-down",
): number {
  if (count === 0) return -1;
  if (index < 0) return 0;

  const next = (() => {
    switch (direction) {
      case "move-left":
        return index - 1;
      case "move-right":
        return index + 1;
      case "move-up":
        return index - columns;
      case "move-down":
        return index + columns;
    }
  })();

  return next < 0 || next >= count ? index : next;
}
