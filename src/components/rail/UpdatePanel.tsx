import { Channel } from "@tauri-apps/api/core";
import { useState } from "react";
import { type CheckProgress, commands, type ItemMetadata, type ReviewHandle } from "../../bindings";
import { repoLabel } from "../../lib/github";
import { reportError, reportInfo } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { Icon } from "../common/Icon";
import { DiffView } from "./DiffView";
import styles from "./Rail.module.css";

type UpdatePanelProps = {
  item: ItemMetadata;
};

type State =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "reviewing"; handle: ReviewHandle }
  | { kind: "applying"; handle: ReviewHandle };

/**
 * Updating an item that was installed from a repository.
 *
 * Three steps, not one: ask whether the remote moved, show what would change,
 * and only then overwrite. Applying destroys whatever is in the local copy,
 * so nothing gets there without the diff having been offered first.
 */
export function UpdatePanel({ item }: UpdatePanelProps) {
  const patchItem = useLibrary((store) => store.patchItem);
  const [state, setState] = useState<State>({ kind: "idle" });

  if (!item.sourceRepo) return null;

  const review = async (mode: "update" | "restore") => {
    setState({ kind: "checking" });
    const result = await commands.prepareReview(item.entryId, mode);
    if (result.status === "error") {
      reportError(result.error);
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "reviewing", handle: result.data });
  };

  const check = async () => {
    setState({ kind: "checking" });
    const progress = new Channel<CheckProgress>();
    const result = await commands.checkForUpdates([item.entryId], progress);

    if (result.status === "error") {
      reportError(result.error);
      setState({ kind: "idle" });
      return;
    }
    const check = result.data[0];
    if (check?.error) {
      reportError({ code: "git-failed", message: check.error });
      setState({ kind: "idle" });
      return;
    }
    if (check?.status === "stale") {
      await review("update");
      return;
    }
    setState({ kind: "current" });
  };

  const apply = async (handle: ReviewHandle) => {
    setState({ kind: "applying", handle });
    const result = await commands.applyReview(handle.reviewId);
    if (result.status === "error") {
      reportError(result.error);
      setState({ kind: "reviewing", handle });
      return;
    }
    patchItem(result.data);
    reportInfo(handle.unchanged ? "Already up to date" : `Updated ${item.name}`);
    setState({ kind: "idle" });
  };

  const cancel = (handle: ReviewHandle) => {
    void commands.cancelReview(handle.reviewId);
    setState({ kind: "idle" });
  };

  return (
    <>
      <div className={styles.sectionTitle}>Source</div>
      <div className={styles.sourceRow}>
        <Icon name="folder-git-2" size={13} />
        <span className={styles.sourceName}>{repoLabel(item.sourceRepo)}</span>
        {item.sourceCommit && (
          <span className={styles.commit} title={item.sourceCommit}>
            {item.sourceCommit.slice(0, 7)}
          </span>
        )}
      </div>

      {state.kind === "idle" && (
        <div className={styles.editorActions}>
          <button type="button" className={styles.save} onClick={() => void check()}>
            Check for updates
          </button>
          <button type="button" className={styles.cancel} onClick={() => void review("restore")}>
            Restore installed version
          </button>
        </div>
      )}

      {state.kind === "checking" && <p className={styles.hint}>Asking the repository…</p>}

      {state.kind === "current" && (
        <div className={styles.editorActions}>
          <span className={styles.shortcutHint}>Already up to date.</span>
          <button
            type="button"
            className={styles.cancel}
            onClick={() => setState({ kind: "idle" })}
          >
            Close
          </button>
        </div>
      )}

      {(state.kind === "reviewing" || state.kind === "applying") && (
        <DiffView
          handle={state.handle}
          busy={state.kind === "applying"}
          onApply={() => void apply(state.handle)}
          onCancel={() => cancel(state.handle)}
        />
      )}
    </>
  );
}
