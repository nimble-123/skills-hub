/** Opening a page in the browser, with a failure said out loud. */

import { openUrl } from "@tauri-apps/plugin-opener";
import { reportError } from "../stores/errors";

export function openExternal(url: string): void {
  void openUrl(url).catch((error: unknown) =>
    reportError({ code: "open", message: `Could not open ${url}: ${String(error)}` }),
  );
}
