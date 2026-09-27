import { useEffect, useState } from "react";
import { commands } from "../../bindings";
import { Icon } from "../common/Icon";
import styles from "./Tools.module.css";

type PathFieldProps = {
  /** Unique across the page: every tool card renders the same four labels. */
  id: string;
  label: string;
  value: string;
  /** What the application ships, so the field can offer to go back to it. */
  shipped: string | undefined;
  placeholder?: string | undefined;
  onSave: (value: string) => void;
};

/**
 * One editable path, checked against this machine as it is typed.
 *
 * Checked live because a path that is nearly right looks exactly like one
 * that is right, and finding out on the next scan is finding out too late.
 * Saved on blur rather than per keystroke: every save writes the settings
 * file and rescans.
 */
export function PathField({ id, label, value, shipped, placeholder, onSave }: PathFieldProps) {
  const [draft, setDraft] = useState(value);
  const status = usePathStatus(draft);

  // Adopt a value changed elsewhere — a reset, or another edit.
  useEffect(() => setDraft(value), [value]);

  const changed = draft !== value;
  const overridden = shipped !== undefined && value !== shipped;
  const empty = draft.trim() === "";

  return (
    <div className={styles.pathField}>
      <label className={styles.pathLabel} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={styles.pathInput}
        value={draft}
        placeholder={placeholder ?? "not scanned"}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => changed && onSave(draft)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setDraft(value);
        }}
      />
      <span className={styles.pathState}>
        {empty ? (
          <span className={styles.pathOff}>not scanned</span>
        ) : status === null ? (
          ""
        ) : status.exists ? (
          <span className={styles.pathFound}>
            <Icon name="check" size={12} /> found
          </span>
        ) : (
          <span className={styles.pathMissing}>not here yet</span>
        )}
      </span>
      {overridden && shipped !== undefined && (
        <button
          type="button"
          className={styles.reset}
          title={`Back to ${shipped || "not scanned"}`}
          onClick={() => onSave(shipped)}
        >
          Reset
        </button>
      )}
    </div>
  );
}

type Status = { exists: boolean; isDirectory: boolean } | null;

/** Whether what is in the field is actually on disk, debounced. */
function usePathStatus(path: string): Status {
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    if (path.trim() === "") {
      setStatus(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      void commands.checkPath(path).then((result) => {
        if (current) setStatus(result);
      });
    }, 180);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [path]);

  return status;
}
