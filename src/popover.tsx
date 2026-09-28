import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { commands } from "./bindings";
import { Popover } from "./components/popover/Popover";
import { applyFonts, resolveFonts } from "./lib/fonts";
import { applyTheme, resolveTheme } from "./lib/theme";
import "./styles/tokens.css";
import "./styles/themes.css";
import "./styles/fonts.css";
import "./styles/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from popover.html");

// The popover has no settings of its own, but it must not open in the wrong
// theme for the half-second before the first paint settles.
void (async () => {
  const result = await commands.getSettings();
  const settings = result.status === "ok" ? result.data.settings : null;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(resolveTheme(settings?.theme, prefersDark));
  const fonts = resolveFonts(settings?.uiFont, settings?.monoFont);
  applyFonts(fonts.ui, fonts.mono);
})();

createRoot(root).render(
  <StrictMode>
    <Popover />
  </StrictMode>,
);
