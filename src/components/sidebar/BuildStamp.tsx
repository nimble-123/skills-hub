import { useState } from "react";
import { commitUrl } from "../../lib/build";
import { useCapabilities } from "../../lib/capabilities";
import { openExternal } from "../../lib/external";
import { WhatsNew } from "../shell/WhatsNew";
import styles from "./Sidebar.module.css";

/**
 * The version and commit, in one faint line under the footer.
 *
 * The version opens what changed in it; the commit opens on GitHub when there
 * is one to open, and `unknown` is only text. Nothing is drawn until the
 * probe has answered, so the line never flickers through a placeholder.
 */
export function BuildStamp() {
  const capabilities = useCapabilities();
  const [open, setOpen] = useState(false);
  if (!capabilities) return null;

  const { appVersion, commit } = capabilities;
  const url = commitUrl(commit);

  // The dialog is a sibling, not a child: inside the stamp it would inherit
  // its monospace and its `white-space: pre`, top layer or not.
  return (
    <>
      <div className={styles.build}>
        <button
          type="button"
          className={styles.buildLink}
          title="What’s new in this version"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          v{appVersion}
        </button>
        <span aria-hidden="true"> · </span>
        {url ? (
          <button
            type="button"
            className={styles.buildLink}
            title={`Open commit ${commit} on GitHub`}
            aria-label={`Commit ${commit}, open on GitHub`}
            onClick={() => openExternal(url)}
          >
            {commit}
          </button>
        ) : (
          <span>{commit}</span>
        )}
      </div>
      <WhatsNew
        open={open}
        onClose={() => setOpen(false)}
        installedVersion={appVersion}
        commit={commit}
      />
    </>
  );
}
