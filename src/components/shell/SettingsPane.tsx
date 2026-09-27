import { open } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import {
  type AppSettings,
  type Capabilities,
  commands,
  type EnabledFilter,
  type SortOrder,
  type ThemePref,
} from "../../bindings";
import { reportError } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { useSettings } from "../../stores/settings";
import styles from "./Pane.module.css";

export function SettingsPane() {
  const settings = useSettings((store) => store.settings);
  const update = useSettings((store) => store.update);
  const setMetadataFolder = useSettings((store) => store.setMetadataFolder);
  const rescan = useLibrary((store) => store.rescan);
  const capabilities = useCapabilities();

  if (!settings) return <div className={styles.empty}>Loading…</div>;

  const change = (patch: Partial<AppSettings>) => void update({ ...settings, ...patch });

  const chooseFolder = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Where should skills-hub keep its notes?",
    });
    if (typeof folder !== "string") return;
    if (await setMetadataFolder(folder)) await rescan();
  };

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>
          Your skills are never moved or copied by anything here. Only where this application keeps
          its own notes, and how it presents what it finds.
        </p>
      </div>

      <div className={styles.scroll}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Notes</h2>
          <div className={styles.field}>
            <div className={styles.fieldText}>
              <div className={styles.fieldName}>Folder</div>
              <p className={`${styles.fieldHint} ${styles.mono}`}>
                {settings.metadataFolder ?? "not chosen yet"}
              </p>
            </div>
            <button type="button" className={styles.control} onClick={() => void chooseFolder()}>
              Change…
            </button>
          </div>
          <p className={styles.fieldHint}>
            One small markdown file per item, holding your tags, favourites and collections. Inside
            an Obsidian vault they sync with everything else you have and stay queryable from
            Dataview.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Library</h2>

          <label className={styles.field}>
            <span className={styles.fieldText}>
              <span className={styles.fieldName}>
                Show tools and workspaces with nothing in them
              </span>
              <p className={styles.fieldHint}>
                Off by default, so the sidebar lists only what you actually have.
              </p>
            </span>
            <input
              type="checkbox"
              checked={settings.showEmptySidebarRows ?? false}
              onChange={(event) => change({ showEmptySidebarRows: event.target.checked })}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldText}>
              <span className={styles.fieldName}>Sort order</span>
            </span>
            <select
              className={styles.control}
              value={settings.defaultSortOrder ?? "name-asc"}
              onChange={(event) => change({ defaultSortOrder: event.target.value as SortOrder })}
            >
              <option value="name-asc">Name A→Z</option>
              <option value="name-desc">Name Z→A</option>
              <option value="modified-desc">Newest first</option>
              <option value="modified-asc">Oldest first</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldText}>
              <span className={styles.fieldName}>Show by default</span>
            </span>
            <select
              className={styles.control}
              value={settings.defaultEnabledFilter ?? "all"}
              onChange={(event) =>
                change({ defaultEnabledFilter: event.target.value as EnabledFilter })
              }
            >
              <option value="all">Everything</option>
              <option value="enabled">Only what is on</option>
              <option value="disabled">Only what is off</option>
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldText}>
              <span className={styles.fieldName}>Theme</span>
            </span>
            <select
              className={styles.control}
              value={settings.theme ?? "system"}
              onChange={(event) => change({ theme: event.target.value as ThemePref })}
            >
              <option value="system">Follow the system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>This machine</h2>
          <div className={styles.field}>
            <div className={styles.fieldText}>
              <div className={styles.fieldName}>Version</div>
            </div>
            <span className={styles.fieldHint}>{capabilities?.appVersion ?? "…"}</span>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldText}>
              <div className={styles.fieldName}>Home directory</div>
              <p className={`${styles.fieldHint} ${styles.mono}`}>{capabilities?.home ?? "…"}</p>
            </div>
          </div>
          <div className={styles.field}>
            <div className={styles.fieldText}>
              <div className={styles.fieldName}>Symlinks</div>
              <p className={styles.fieldHint}>
                {capabilities?.symlinksSupported === false
                  ? "Unavailable, so a global item cannot be linked into a project. On Windows this needs Developer Mode."
                  : "Available, so global items can be linked into projects."}
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** What this machine lets the application do. Probed once. */
function useCapabilities(): Capabilities | null {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);

  useEffect(() => {
    void commands.probeCapabilities().then((result) => {
      if (result.status === "ok") setCapabilities(result.data);
      else reportError(result.error);
    });
  }, []);

  return capabilities;
}
