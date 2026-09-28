import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { commands, type ItemMetadata } from "../../bindings";
import { matchesSearch } from "../../lib/library";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { ToolIcon } from "../common/Icon";
import styles from "./Popover.module.css";

/** Event name, matching `ITEM_CHANGED` in `src-tauri/src/commands/items.rs`. */
const ITEM_CHANGED = "item:changed";

/** Beyond this the list stops being something you scan with your eyes. */
const LIMIT = 40;

type Phase = "loading" | "ready" | "needs-folder" | "failed";

/**
 * The menubar popover.
 *
 * A second webview over the same library, holding no state the window also
 * holds: it asks for the snapshot when it opens and patches single items as
 * they change. What it does *not* do is scan on every open — the first open of
 * a session pays for a scan, the rest read what is already there.
 */
export function Popover() {
  const [items, setItems] = useState<ItemMetadata[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const result = await commands.ensureSnapshot();
    if (result.status === "error") {
      setMessage(result.error.message);
      setPhase("failed");
      return;
    }
    if (result.data === null) {
      setPhase("needs-folder");
      return;
    }
    setItems(result.data.items);
    setPhase("ready");
  }, []);

  // The popover's webview loads when the application starts, hidden, at the
  // same moment the window starts its own scan. Scanning here as well would
  // race it for the scan lock, and whichever lost would be refused — so this
  // only reads what is cached. Opening the popover is what may scan.
  useEffect(() => {
    void (async () => {
      const result = await commands.getSnapshot();
      if (result.status === "ok" && result.data !== null) {
        setItems(result.data.items);
        setPhase("ready");
      }
    })();
  }, []);

  // The panel is shown and hidden natively, so the webview is never torn down.
  // Opening it again should feel like opening a menu: caret in the field, last
  // search forgotten, and whatever changed meanwhile picked up.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      setQuery("");
      search.current?.focus();
      void load();
    });
    return () => void unlisten.then((off) => off());
  }, [load]);

  // The window can toggle the same item. One card, not another scan.
  useEffect(() => {
    const unlisten = getCurrentWindow().listen<ItemMetadata>(ITEM_CHANGED, ({ payload }) => {
      setItems((current) =>
        current.map((item) => (item.entryId === payload.entryId ? payload : item)),
      );
    });
    return () => void unlisten.then((off) => off());
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // With nothing typed there is no useful ordering of two hundred items, so
    // the favourites stand in — they are the ones chosen as worth reaching for.
    const pool = needle === "" ? items.filter((item) => item.favorite) : items;
    return pool
      .filter((item) => matchesSearch(item, needle))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, LIMIT);
  }, [items, query]);

  // Escape closes the popover from anywhere in it, including the search field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void commands.closePopover();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggle = async (item: ItemMetadata) => {
    if (busy !== null) return;
    setBusy(item.entryId);
    try {
      const result = await commands.setItemEnabled(item.entryId, !item.enabled);
      if (result.status === "error") {
        setMessage(result.error.message);
        return;
      }
      const updated = result.data;
      setItems((current) =>
        current.map((existing) => (existing.entryId === updated.entryId ? updated : existing)),
      );
      setMessage("");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.popover}>
      <div className={styles.header}>
        <input
          ref={search}
          // The popover exists to be typed into the moment it opens.
          // biome-ignore lint/a11y/noAutofocus: the panel has one field and opens for it
          autoFocus
          type="search"
          className={styles.search}
          placeholder="Search skills, agents, commands, rules"
          aria-label="Search the library"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className={styles.list}>
        {phase === "loading" && <p className={styles.note}>Scanning…</p>}

        {phase === "needs-folder" && (
          <p className={styles.note}>
            No notes folder yet. Open the window to choose one — that is the only thing the popover
            cannot do for you.
          </p>
        )}

        {phase === "failed" && <p className={styles.note}>{message}</p>}

        {phase === "ready" &&
          shown.map((item) => (
            <div key={item.entryId} className={`${styles.row} ${item.enabled ? "" : styles.off}`}>
              <span className={styles.name} title={item.name}>
                {item.name}
              </span>
              <span className={styles.typePill} data-type={item.type}>
                {TYPE_META[item.type].label}
              </span>
              <span className={styles.tool}>
                <ToolIcon toolId={item.tool} size={12} />
                {TOOL_META[item.tool]?.label ?? item.tool}
              </span>
              <button
                type="button"
                className={`${styles.switch} ${item.enabled ? styles.switchOn : ""}`}
                // A bundled item is not individually toggleable: the bundle is
                // the unit its own tool understands, and switching a bundle is
                // a decision for the window, where its consequences are shown.
                disabled={busy !== null || item.pluginId !== null}
                title={
                  item.pluginId !== null
                    ? "Part of a plugin — switch the bundle in the window"
                    : item.enabled
                      ? "Disable: moves the file out of where the tool reads it"
                      : "Enable: moves the file back"
                }
                aria-label={item.enabled ? `Disable ${item.name}` : `Enable ${item.name}`}
                onClick={() => void toggle(item)}
              />
            </div>
          ))}

        {phase === "ready" && shown.length === 0 && (
          <p className={styles.note}>
            {query.trim() === ""
              ? "Nothing marked as a favourite yet. Type to search the whole library."
              : `Nothing matches “${query.trim()}”.`}
          </p>
        )}
      </div>

      <div className={styles.footer}>
        <button type="button" className={styles.action} onClick={() => void openWindow()}>
          Open the window
        </button>
        <button type="button" className={styles.action} onClick={() => void commands.quit()}>
          Quit
        </button>
      </div>
    </div>
  );
}

async function openWindow() {
  const result = await commands.showMainWindow();
  if (result.status === "error") console.error(result.error.message);
}
