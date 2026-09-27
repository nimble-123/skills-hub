/**
 * Choosing between the light and dark token sets.
 *
 * The tokens are defined under `:root[data-theme="dark"]` rather than a media
 * query, because the choice is the user's to override — so something has to
 * set the attribute, and it may as well be the one place that also knows what
 * they picked.
 */

export type Resolved = "light" | "dark";

export function resolveTheme(
  preference: string | null | undefined,
  prefersDark: boolean,
): Resolved {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return prefersDark ? "dark" : "light";
}

export function applyTheme(theme: Resolved): void {
  document.documentElement.dataset.theme = theme;
  // Tells the webview to draw form controls and scrollbars to match.
  document.documentElement.style.colorScheme = theme;
}
