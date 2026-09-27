import { useCallback, useEffect, useMemo, useRef } from "react";
import { DetailRail } from "./components/rail/DetailRail";
import { CommandPalette } from "./components/shell/CommandPalette";
import { FirstRun } from "./components/shell/FirstRun";
import { LibraryPane } from "./components/shell/LibraryPane";
import styles from "./components/shell/Shell.module.css";
import { Toasts } from "./components/shell/Toasts";
import { Sidebar } from "./components/sidebar/Sidebar";
import { moveWithin, shortcutFor } from "./lib/keyboard";
import { deriveLibrary } from "./lib/library";
import { useFilters } from "./stores/filters";
import { useItems, useLibrary } from "./stores/library";
import { useSettings } from "./stores/settings";
import { useUi } from "./stores/ui";

export function App() {
  const loadSettings = useSettings((store) => store.load);
  const loadLibrary = useLibrary((store) => store.load);
  const rescan = useLibrary((store) => store.rescan);
  const state = useLibrary((store) => store.state);
  const items = useItems();

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
            <LibraryPane
              visible={visible}
              facets={facets}
              searchRef={searchRef}
              onColumnsChange={(columns) => {
                columnsRef.current = columns;
              }}
            />
            {selected && <DetailRail key={selected.entryId} item={selected} />}
          </>
        )}
      </div>
      <CommandPalette items={items} />
      <Toasts />
    </>
  );
}
