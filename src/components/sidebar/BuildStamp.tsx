import { openUrl } from "@tauri-apps/plugin-opener";
import { commitUrl } from "../../lib/build";
import { useCapabilities } from "../../lib/capabilities";
import { reportError } from "../../stores/errors";
import styles from "./Sidebar.module.css";

/**
 * The version and commit, in one faint line under the footer.
 *
 * The commit opens on GitHub when there is one to open; `unknown` is only
 * text. Nothing is drawn until the probe has answered, so the line never
 * flickers through a placeholder.
 */
export function BuildStamp() {
  const capabilities = useCapabilities();
  if (!capabilities) return null;

  const { appVersion, commit } = capabilities;
  const url = commitUrl(commit);

  return (
    <div className={styles.build}>
      <span>v{appVersion}</span>
      <span aria-hidden="true"> · </span>
      {url ? (
        <button
          type="button"
          className={styles.buildLink}
          title={`Open commit ${commit} on GitHub`}
          aria-label={`Commit ${commit}, open on GitHub`}
          onClick={() =>
            void openUrl(url).catch((error: unknown) =>
              reportError({ code: "open", message: String(error) }),
            )
          }
        >
          {commit}
        </button>
      ) : (
        <span>{commit}</span>
      )}
    </div>
  );
}
