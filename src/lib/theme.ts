/**
 * Choosing a palette, and telling the rest of the page which one it is.
 *
 * The palettes are defined under `:root[data-theme="…"]` rather than a media
 * query, because the choice is the user's to override — so something has to
 * set the attribute, and it may as well be the one place that also knows what
 * they picked.
 *
 * Two attributes, not one. `data-theme` names the palette; `data-appearance`
 * says whether it is a light or a dark one. Anything that only needs to know
 * "is this dark" — the syntax highlighting, the webview's own scrollbars —
 * asks the second and does not grow a new case per theme.
 */

import type { ThemePref } from "../bindings";

export type Appearance = "light" | "dark";

/** A palette that exists, as opposed to `system`, which is a wish for one. */
export type ThemeId = Exclude<ThemePref, "system">;

export type ThemeChoice = {
  id: ThemeId;
  label: string;
  appearance: Appearance;
};

/** The dropdown's own order, grouped the way it is offered. */
export const THEME_GROUPS: { label: string; themes: ThemeChoice[] }[] = [
  {
    label: "Default",
    themes: [
      { id: "light", label: "Light", appearance: "light" },
      { id: "dark", label: "Dark", appearance: "dark" },
    ],
  },
  {
    // What VS Code ships with.
    label: "VS Code",
    themes: [
      { id: "quiet-light", label: "Quiet Light", appearance: "light" },
      { id: "solarized-light", label: "Solarized Light", appearance: "light" },
      { id: "solarized-dark", label: "Solarized Dark", appearance: "dark" },
      { id: "monokai", label: "Monokai", appearance: "dark" },
      { id: "abyss", label: "Abyss", appearance: "dark" },
      { id: "kimbie-dark", label: "Kimbie Dark", appearance: "dark" },
      { id: "tomorrow-night-blue", label: "Tomorrow Night Blue", appearance: "dark" },
      { id: "red", label: "Red", appearance: "dark" },
      { id: "high-contrast", label: "High Contrast", appearance: "dark" },
    ],
  },
  {
    // These five are installed from the marketplace rather than shipped, which
    // is the only reason they are a group of their own.
    label: "Community",
    themes: [
      { id: "tokyo-night", label: "Tokyo Night", appearance: "dark" },
      { id: "aura", label: "Aura", appearance: "dark" },
      { id: "synthwave-84", label: "SynthWave '84", appearance: "dark" },
      { id: "panda", label: "Panda", appearance: "dark" },
      { id: "overnight", label: "Overnight", appearance: "dark" },
    ],
  },
  {
    label: "SAP Fiori Horizon",
    themes: [
      { id: "horizon-morning", label: "Morning Horizon", appearance: "light" },
      { id: "horizon-evening", label: "Evening Horizon", appearance: "dark" },
    ],
  },
  {
    label: "EnBW",
    themes: [
      { id: "enbw-light", label: "EnBW Light", appearance: "light" },
      { id: "enbw-dark", label: "EnBW Dark", appearance: "dark" },
    ],
  },
];

const BY_ID = new Map(THEME_GROUPS.flatMap((group) => group.themes).map((t) => [t.id, t]));

export function isThemeId(value: string | null | undefined): value is ThemeId {
  return value !== null && value !== undefined && BY_ID.has(value as ThemeId);
}

/**
 * Which palette to draw, given what the user asked for.
 *
 * Anything unrecognised — a preference written by a newer version, or none at
 * all yet — follows the system rather than refusing to render.
 */
export function resolveTheme(preference: string | null | undefined, prefersDark: boolean): ThemeId {
  if (isThemeId(preference)) return preference;
  return prefersDark ? "dark" : "light";
}

export function appearanceOf(theme: ThemeId): Appearance {
  return BY_ID.get(theme)?.appearance ?? "light";
}

export function applyTheme(theme: ThemeId): void {
  const appearance = appearanceOf(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.appearance = appearance;
  // Tells the webview to draw form controls and scrollbars to match.
  document.documentElement.style.colorScheme = appearance;
}
