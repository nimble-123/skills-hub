/**
 * What this machine lets the application do, probed once per window.
 *
 * The settings pane and the sidebar both want it, so the probe is shared
 * rather than asked twice. A failed probe is reported and forgotten, so the
 * next caller tries again.
 */

import { useEffect, useState } from "react";
import type { Capabilities } from "../bindings";
import { commands } from "../bindings";
import { reportError } from "../stores/errors";

let probe: Promise<Capabilities | null> | null = null;

function probeOnce(): Promise<Capabilities | null> {
  probe ??= commands.probeCapabilities().then((result) => {
    if (result.status === "ok") return result.data;
    probe = null;
    reportError(result.error);
    return null;
  });
  return probe;
}

export function useCapabilities(): Capabilities | null {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  useEffect(() => {
    let live = true;
    void probeOnce().then((found) => {
      if (live) setCapabilities(found);
    });
    return () => {
      live = false;
    };
  }, []);

  return capabilities;
}

/** Tests start each case from a fresh probe. */
export function forgetCapabilities() {
  probe = null;
}
