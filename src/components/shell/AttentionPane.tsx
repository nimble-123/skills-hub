import { useCallback, useEffect, useState } from "react";
import { commands, type Orphan } from "../../bindings";
import { reportError, reportInfo } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { Icon } from "../common/Icon";
import styles from "./Pane.module.css";

/**
 * The two things the application will not decide on its own.
 *
 * A link that no longer resolves might be a tool you uninstalled or a folder
 * you moved, and a note whose item is gone might be a skill you deleted or a
 * volume that is not mounted. Both are shown rather than acted on.
 */
export function AttentionPane() {
  const snapshot = useLibrary((store) => store.snapshot);
  const rescan = useLibrary((store) => store.rescan);
  const [orphans, setOrphans] = useState<Orphan[]>([]);
  const version = snapshot?.version ?? 0;

  const reload = useCallback(() => {
    // A scan is what marks a note as orphaned, so before the first one there
    // is nothing to ask about.
    if (version === 0) {
      setOrphans([]);
      return;
    }
    void commands.listOrphanedMetadata().then((result) => {
      if (result.status === "ok") setOrphans(result.data);
      else reportError(result.error);
    });
  }, [version]);

  useEffect(reload, [reload]);

  const broken = snapshot?.brokenSymlinks ?? [];

  const forget = async (orphan: Orphan) => {
    const result = await commands.forgetOrphanedMetadata([orphan.entryId]);
    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    reportInfo(`Forgot the notes for ${orphan.name}`);
    reload();
  };

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <h1 className={styles.title}>Needs a look</h1>
        <p className={styles.subtitle}>
          Things this application will not decide for you: links that no longer resolve, and notes
          whose item was not found. Nothing here has been changed or removed.
        </p>
      </div>

      <div className={styles.scroll}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Broken links ({broken.length})</h2>
          {broken.length === 0 ? (
            <p className={styles.fieldHint}>Every link resolves.</p>
          ) : (
            <div className={styles.rows}>
              {broken.map((link) => (
                <div key={link.path} className={styles.row}>
                  <Icon name="unlink" size={15} />
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle}>
                      <span className={styles.mono}>{link.path}</span>
                      <span className={styles.badge}>{link.tool}</span>
                    </div>
                    <p className={`${styles.fieldHint} ${styles.mono}`}>→ {link.target}</p>
                  </div>
                  <button
                    type="button"
                    className={styles.control}
                    onClick={() => void reveal(link.path)}
                  >
                    Show in Finder
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Orphaned notes ({orphans.length})</h2>
          <p className={styles.fieldHint}>
            A note is kept for a fortnight after its item stops being found, and kept indefinitely
            if you put anything in it. A scan that could not read a folder never marks anything.
          </p>
          {orphans.length === 0 ? (
            <p className={styles.fieldHint}>Nothing orphaned.</p>
          ) : (
            <div className={styles.rows}>
              {orphans.map((orphan) => (
                <div key={orphan.entryId} className={styles.row}>
                  <Icon name="file-question" size={15} />
                  <div className={styles.rowText}>
                    <div className={styles.rowTitle}>
                      {orphan.name}
                      <span className={styles.badge}>{orphan.tool}</span>
                      {orphan.hasUserData && (
                        <span className={styles.badgeOk}>has your tags — kept</span>
                      )}
                    </div>
                    <p className={`${styles.fieldHint} ${styles.mono}`}>{orphan.path}</p>
                  </div>
                  <button
                    type="button"
                    className={styles.control}
                    onClick={() => void forget(orphan)}
                  >
                    Forget
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <button type="button" className={styles.control} onClick={() => void rescan()}>
          Scan again
        </button>
      </div>
    </div>
  );
}

async function reveal(path: string) {
  const result = await commands.revealInFileManager(path, false);
  if (result.status === "error") reportError(result.error);
}
