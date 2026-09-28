/**
 * The bits of Tauri the window and the popover touch directly.
 *
 * `@tauri-apps/api` talks to a host that is not there in a browser, so the
 * demo build swaps these modules out rather than letting a constructor throw
 * mid-render.
 */

/** A channel nothing ever sends on. */
export class Channel<T> {
  onmessage: ((message: T) => void) | null = null;
}

/** The file picker, which the demo never opens. */
export async function open(): Promise<string | null> {
  return null;
}

/** An event nothing ever emits. */
export async function listen(): Promise<() => void> {
  return () => {};
}

/**
 * The popover's own window. In the demo it is a page in a browser, so the
 * two things it asks for — focus changes and host events — never arrive.
 */
export function getCurrentWindow() {
  return {
    onFocusChanged: async () => () => {},
    listen: async () => () => {},
  };
}
