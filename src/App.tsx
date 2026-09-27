import { useEffect, useMemo, useRef } from "react";
import { FirstRun } from "./components/shell/FirstRun";
import { LibraryPane } from "./components/shell/LibraryPane";
import styles from "./components/shell/Shell.module.css";
import { Toasts } from "./components/shell/Toasts";
import { Sidebar } from "./components/sidebar/Sidebar";
import { deriveLibrary } from "./lib/library";
import { useFilters } from "./stores/filters";
import { useItems, useLibrary } from "./stores/library";
import { useSettings } from "./stores/settings";

export function App() {
  const loadSettings = useSettings((store) => store.load);
  const loadLibrary = useLibrary((store) => store.load);
  const state = useLibrary((store) => store.state);
  const items = useItems();
  const searchRef = useRef<HTMLInputElement>(null);

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

  return (
    <>
      <div className={styles.dragRegion} />
      <div className={styles.shell}>
        {state === "needs-folder" ? (
          <FirstRun />
        ) : (
          <>
            <Sidebar facets={facets} />
            <LibraryPane visible={visible} facets={facets} searchRef={searchRef} />
          </>
        )}
      </div>
      <Toasts />
    </>
  );
}
