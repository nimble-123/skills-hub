import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ItemMetadata } from "./bindings";
import { DashboardPane } from "./components/dashboard/DashboardPane";
import { McpPane } from "./components/dashboard/McpPane";
import { DiscoverPane } from "./components/discover/DiscoverPane";
import { DetailRail } from "./components/rail/DetailRail";
import { AttentionPane } from "./components/shell/AttentionPane";
import { CommandPalette } from "./components/shell/CommandPalette";
import { FirstRun } from "./components/shell/FirstRun";
import { LibraryPane } from "./components/shell/LibraryPane";
import { SettingsPane } from "./components/shell/SettingsPane";
import styles from "./components/shell/Shell.module.css";
import { Toasts } from "./components/shell/Toasts";
import { ToolsPane } from "./components/shell/ToolsPane";
import { Sidebar } from "./components/sidebar/Sidebar";
import { applyFonts, resolveFonts } from "./lib/fonts";
import { moveWithin, shortcutFor } from "./lib/keyboard";
import { deriveLibrary } from "./lib/library";
import { applyTheme, resolveTheme } from "./lib/theme";
import { useFilters } from "./stores/filters";
import { useItems, useLibrary } from "./stores/library";
import { useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";

/** Event name, matching `ITEM_CHANGED` in `src-tauri/src/commands/items.rs`. */
const ITEM_CHANGED = "item:changed";

export function App() {
  const loadSettings = useSettings((store) => store.load);
  const loadLibrary = useLibrary((store) => store.load);
  const rescan = useLibrary((store) => store.rescan);
  const patchItem = useLibrary((store) => store.patchItem);
  const state = useLibrary((store) => store.state);
  const items = useItems();

  const themePreference = useSettings((store) => store.settings?.theme);
  const uiFont = useSettings((store) => store.settings?.uiFont);
  const monoFont = useSettings((store) => store.settings?.monoFont);
  const route = useUi((ui) => ui.route);
  const selectedId = useUi((ui) => ui.selected);
  const select = useUi((ui) => ui.select);
  const setPaletteOpen = useUi((ui) => ui.setCommandPaletteOpen);
  const searchRef = useRef<HTMLInputElement>(null);
  const columnsRef = useRef(1);

  const scope = useFilters((f) => f.scope);
  const search = useFilters((f) => f.search);
  const enabled = useFilters((f) => f.enabled);
  const tag = useFilters((f) => f.tag);
  const untagged = useFilters((f) => f.untagged);
  const source = useFilters((f) => f.source);
  const sort = useFilters((f) => f.sort);

  useEffect(() => {
    void (async () => {
      await loadSettings();
      await loadLibrary();
    })();
  }, [loadSettings, loadLibrary]);

  // The menubar popover toggles the same files. Without this, a card left open
  // here would go on showing the state it had before the popover changed it.
  useEffect(() => {
    const unlisten = listen<ItemMetadata>(ITEM_CHANGED, ({ payload }) => patchItem(payload));
    return () => void unlisten.then((off) => off());
  }, [patchItem]);

  // The system can change its mind while the window is open.
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyTheme(resolveTheme(themePreference, query.matches));
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [themePreference]);

  useEffect(() => {
    const fonts = resolveFonts(uiFont, monoFont);
    applyFonts(fonts.ui, fonts.mono);
  }, [uiFont, monoFont]);

  /**
   * One pass for the list and the counts, because they answer the same
   * question and computing them separately is how they end up disagreeing.
   *
   * The dependency is the array itself: a scan replaces it, and so does a
   * single-item command, since the store maps to a new array rather than
   * mutating in place. Depending on the snapshot version instead would miss
   * the latter.
   */
  const { visible, facets } = useMemo(
    () => deriveLibrary(items, scope, { search, enabled, tag, untagged, source, sort }),
    [items, scope, search, enabled, tag, untagged, source, sort],
  );

  const selected = items.find((item) => item.entryId === selectedId) ?? null;

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const shortcut = shortcutFor(event);
      if (!shortcut) return;

      switch (shortcut) {
        case "focus-search":
          event.preventDefault();
          searchRef.current?.focus();
          return;
        case "close-rail":
          if (useUi.getState().commandPaletteOpen) setPaletteOpen(false);
          else if (document.activeElement instanceof HTMLElement) {
            // Escape in a field means "leave the field"; outside one it
            // means "close the rail".
            document.activeElement.blur();
            select(null);
          } else {
            select(null);
          }
          return;
        case "rescan":
          event.preventDefault();
          void rescan();
          return;
        case "command-palette":
          event.preventDefault();
          setPaletteOpen(!useUi.getState().commandPaletteOpen);
          return;
        case "open":
          return;
        default: {
          if (visible.length === 0) return;
          event.preventDefault();
          const current = visible.findIndex((item) => item.entryId === selectedId);
          const next = moveWithin(current, visible.length, columnsRef.current, shortcut);
          const item = visible[next];
          if (item) select(item.entryId);
        }
      }
    },
    [rescan, select, setPaletteOpen, selectedId, visible],
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);

  return (
    <>
      <div className={styles.dragRegion} />
      <div className={styles.shell}>
        {state === "needs-folder" ? (
          <FirstRun />
        ) : (
          <>
            <Sidebar facets={facets} />
            {route.kind === "library" && (
              <LibraryPane
                visible={visible}
                facets={facets}
                searchRef={searchRef}
                onColumnsChange={(columns) => {
                  columnsRef.current = columns;
                }}
              />
            )}
            {route.kind === "discover" && <DiscoverPane />}
            {route.kind === "dashboard" && <DashboardPane />}
            {route.kind === "mcp" && <McpPane />}
            {route.kind === "tools" && <ToolsPane facets={facets} />}
            {route.kind === "orphans" && <AttentionPane />}
            {route.kind === "settings" && <SettingsPane />}
            {route.kind === "library" && selected && (
              <DetailRail key={selected.entryId} item={selected} />
            )}
          </>
        )}
      </div>
      <CommandPalette items={items} />
      <Toasts />
    </>
  );
}
