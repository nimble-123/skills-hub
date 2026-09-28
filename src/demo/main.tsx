/**
 * The demo build's entry point.
 *
 * The same `App` the application runs, against fixtures instead of a
 * filesystem. `?screen=` picks which view the screenshot wants, and the
 * stores are seeded directly so nothing is mid-flight when the picture is
 * taken.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../App";
import { applyTheme } from "../lib/theme";
import { useFilters } from "../stores/filters";
import { useUi } from "../stores/ui";
import "../styles/tokens.css";
import "../styles/base.css";

type Screen = "library" | "discover" | "cost" | "tools" | "mcp" | "diff";

const params = new URLSearchParams(window.location.search);
const screen = (params.get("screen") ?? "library") as Screen;
applyTheme(params.get("theme") === "dark" ? "dark" : "light");

/** Everything the chosen screen needs to be showing when it is captured. */
function seed(): void {
  const ui = useUi.getState();

  switch (screen) {
    case "library":
      ui.go({ kind: "library" });
      // The rail is open on a skill with a code block, so the screenshot
      // shows the markdown and the highlighting doing their job.
      ui.select("sap-abap-cds-000000");
      break;
    case "diff":
      ui.go({ kind: "library" });
      // An item that was installed from a repository — only those have
      // anything to update.
      ui.select("deep-research-000006");
      break;
    case "discover":
      ui.go({ kind: "discover" });
      break;
    case "cost":
      ui.go({ kind: "dashboard" });
      break;
    case "tools":
      ui.go({ kind: "tools" });
      break;
    case "mcp":
      ui.go({ kind: "mcp" });
      break;
  }

  if (screen === "library") {
    const filters = useFilters.getState();
    filters.setScope({ kind: "type", type: "skill" });
    // Puts the selected item in the first row rather than scrolled to, so the
    // picture does not open on a card cut in half — and shows the search and
    // the counts following it at the same time.
    filters.setSearch("sap");
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

seed();
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
