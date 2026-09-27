import { useEffect, useMemo, useState } from "react";
import type { ItemMetadata } from "../../bindings";
import { useUi } from "../../stores/ui";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import styles from "./Palette.module.css";

type CommandPaletteProps = {
  items: ItemMetadata[];
};

const LIMIT = 40;

/** Jump straight to an item by name. */
export function CommandPalette({ items }: CommandPaletteProps) {
  const open = useUi((ui) => ui.commandPaletteOpen);
  const setOpen = useUi((ui) => ui.setCommandPaletteOpen);
  const select = useUi((ui) => ui.select);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle === "" ? items : items.filter((item) => matchesName(item, needle));
    return pool.slice(0, LIMIT);
  }, [items, query]);

  if (!open) return null;

  const choose = (item: ItemMetadata | undefined) => {
    if (!item) return;
    select(item.entryId);
    setOpen(false);
  };

  return (
    // The backdrop is a click-away surface, not a control: everything it does
    // is also reachable with Escape, which the dialog and the window both
    // handle.
    // biome-ignore lint/a11y/noStaticElementInteractions: decorative click-away
    <div className={styles.backdrop} onMouseDown={() => setOpen(false)}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="Find an item"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          // biome-ignore lint/a11y/noAutofocus: the palette exists to be typed into
          autoFocus
          className={styles.input}
          value={query}
          placeholder="Find an item by name…"
          aria-label="Find an item by name"
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, matches.length - 1));
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              choose(matches[cursor]);
            }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <ul className={styles.results}>
          {matches.map((item, index) => (
            <li key={item.entryId}>
              <button
                type="button"
                className={index === cursor ? `${styles.result} ${styles.active}` : styles.result}
                onMouseEnter={() => setCursor(index)}
                onClick={() => choose(item)}
              >
                <span className={styles.resultName}>{item.name}</span>
                <span className={styles.resultMeta}>
                  {TYPE_META[item.type].label} · {TOOL_META[item.tool]?.label ?? item.tool}
                </span>
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className={styles.none}>Nothing matches.</li>}
        </ul>
      </div>
    </div>
  );
}

function matchesName(item: ItemMetadata, needle: string): boolean {
  return item.name.toLowerCase().includes(needle);
}
