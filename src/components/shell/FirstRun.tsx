import { open } from "@tauri-apps/plugin-dialog";
import { useLibrary } from "../../stores/library";
import { useSettings } from "../../stores/settings";
import styles from "./Shell.module.css";

/**
 * Asking where the notes should live.
 *
 * Deliberately the first thing, and deliberately the user's choice: these are
 * plain markdown files, and putting them inside a vault is what makes them
 * sync and stay queryable from Dataview.
 */
export function FirstRun() {
  const setMetadataFolder = useSettings((store) => store.setMetadataFolder);
  const rescan = useLibrary((store) => store.rescan);

  const choose = async () => {
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Where should skills-hub keep its notes?",
    });
    if (typeof folder !== "string") return;
    if (await setMetadataFolder(folder)) await rescan();
  };

  return (
    <div className={styles.centred}>
      <h1>Choose a folder for your notes</h1>
      <p>
        skills-hub keeps your tags, favourites and collections as one small markdown file per item.
        Put that folder inside an Obsidian vault and they sync with everything else you have, and
        stay queryable from Dataview.
      </p>
      <p className={styles.muted}>
        Your skills themselves are never moved or copied. Only these notes live here.
      </p>
      <button type="button" className={styles.primary} onClick={() => void choose()}>
        Choose a folder…
      </button>
    </div>
  );
}
