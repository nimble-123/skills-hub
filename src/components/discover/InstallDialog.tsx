import { useState } from "react";
import { commands, type DiscoverEntry } from "../../bindings";
import { reportError, reportInfo } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { useSettings } from "../../stores/settings";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import paletteStyles from "../shell/Palette.module.css";
import styles from "./Discover.module.css";

type InstallDialogProps = {
  entry: DiscoverEntry;
  onClose: () => void;
};

/**
 * Where an item should land.
 *
 * The type comes from the repository and is not offered for editing: it is
 * what the folder it sits in says it is, and installing an agent into a
 * commands folder would only put it somewhere nothing reads.
 */
export function InstallDialog({ entry, onClose }: InstallDialogProps) {
  const tools = useSettings((store) => store.tools);
  const workspaces = useSettings((store) => store.settings?.projectWorkspaces ?? []);
  const rescan = useLibrary((store) => store.rescan);

  // Only tools that have somewhere to put this type.
  const candidates = tools.filter(
    (tool) => entry.type in (tool.paths ?? {}) || entry.type in (tool.projectPaths ?? {}),
  );

  const [toolId, setToolId] = useState(candidates[0]?.id ?? "");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    const result = await commands.installFromGithub({
      repoUrl: entry.repoUrl,
      refName: entry.refName,
      subpath: entry.subpath,
      toolId,
      type: entry.type,
      projectId,
    });
    setBusy(false);

    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    reportInfo(`Installed ${result.data.name}`);
    onClose();
    await rescan();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: decorative click-away
    <div className={paletteStyles.backdrop} onMouseDown={onClose}>
      <div
        className={paletteStyles.palette}
        role="dialog"
        aria-modal="true"
        aria-label={`Install ${entry.name}`}
        onMouseDown={(event) => event.stopPropagation()}
        style={{ padding: 18, gap: 12 }}
      >
        <div>
          <strong>{entry.name}</strong>
          <span className={styles.typePill} style={{ marginLeft: 8 }}>
            {TYPE_META[entry.type].label}
          </span>
        </div>
        {entry.description && <p className={styles.description}>{entry.description}</p>}

        <label>
          <div className={styles.starterHint}>Which tool should read it?</div>
          <select
            className={styles.input}
            value={toolId}
            onChange={(event) => setToolId(event.target.value)}
          >
            {candidates.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {TOOL_META[tool.id]?.label ?? tool.id}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div className={styles.starterHint}>Where?</div>
          <select
            className={styles.input}
            value={projectId ?? ""}
            onChange={(event) =>
              setProjectId(event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">Globally, for every project</option>
            {workspaces.map((project) => (
              <option key={project.id} value={project.id}>
                Only in {project.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className={styles.iconButton} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={busy || toolId === ""}
            onClick={() => void install()}
          >
            {busy ? "Installing…" : "Install"}
          </button>
        </div>
      </div>
    </div>
  );
}
