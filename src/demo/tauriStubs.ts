/**
 * The bits of Tauri the window touches directly.
 *
 * `@tauri-apps/api` talks to a host that is not there in a browser, so the
 * demo build swaps these two modules out rather than letting a constructor
 * throw mid-render.
 */

/** A channel nothing ever sends on. */
export class Channel<T> {
  onmessage: ((message: T) => void) | null = null;
}

/** The file picker, which the demo never opens. */
export async function open(): Promise<string | null> {
  return null;
}
