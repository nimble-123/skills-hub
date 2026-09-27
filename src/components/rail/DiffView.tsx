import type { ReviewHandle } from "../../bindings";
import styles from "./Rail.module.css";

type DiffViewProps = {
  handle: ReviewHandle;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
};

/**
 * What an update would change, before it changes it.
 *
 * The manifest gets a line diff with the changed words picked out; the other
 * files in a skill's folder get a verdict each, because a side-by-side of a
 * PNG helps nobody.
 */
export function DiffView({ handle, busy, onApply, onCancel }: DiffViewProps) {
  return (
    <div className={styles.review}>
      {handle.unchanged ? (
        <p className={styles.hint}>
          The repository has moved on, but nothing about this item did — which happens when one
          repository holds many. Applying only records the newer commit, so it stops being reported
          as out of date.
        </p>
      ) : (
        <>
          <div className={styles.diffStats}>
            <span className={styles.added}>+{handle.stats.added}</span>
            <span className={styles.removed}>−{handle.stats.removed}</span>
            <span className={styles.shortcutHint}>moving to {handle.commit.slice(0, 7)}</span>
          </div>

          {handle.lines.length > 0 && (
            <div className={styles.diff}>
              {handle.lines.map((line, index) => (
                <div
                  // Lines have no id of their own, and the list is static
                  // once rendered.
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  key={index}
                  className={`${styles.diffLine} ${markerClass(line.marker)}`}
                >
                  <span className={styles.diffNumber}>{line.number ?? ""}</span>
                  <span className={styles.diffMarker}>{line.marker}</span>
                  <span className={styles.diffText}>
                    {line.segments.map((segment, segmentIndex) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: static list
                        key={segmentIndex}
                        className={segment.emphasis ? styles.emphasis : undefined}
                      >
                        {segment.text}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          )}

          {handle.companions.length > 0 && (
            <>
              <div className={styles.sectionTitle}>
                {handle.companions.length} other files change
              </div>
              <div className={styles.files}>
                {handle.companions.map((companion) => (
                  <div key={companion.path} className={styles.file}>
                    <span className={`${styles.companionStatus} ${statusClass(companion.status)}`}>
                      {companion.status}
                    </span>
                    <span className={styles.fileName}>{companion.path}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div className={styles.editorActions}>
        <button type="button" className={styles.save} disabled={busy} onClick={onApply}>
          {busy ? "Applying…" : handle.unchanged ? "Record the newer commit" : "Apply"}
        </button>
        <button type="button" className={styles.cancel} onClick={onCancel}>
          Cancel
        </button>
        {!handle.unchanged && (
          <span className={styles.shortcutHint}>This replaces your local copy.</span>
        )}
      </div>
    </div>
  );
}

function markerClass(marker: string): string {
  if (marker === "+") return styles.lineAdded as string;
  if (marker === "-") return styles.lineRemoved as string;
  return "";
}

function statusClass(status: string): string {
  if (status === "added") return styles.statusAdded as string;
  if (status === "removed") return styles.statusRemoved as string;
  return styles.statusModified as string;
}
