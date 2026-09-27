import { useState } from "react";
import { commands, type ItemMetadata } from "../../bindings";
import { reportError } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { useCollections } from "../../stores/selectors";
import { useSettings } from "../../stores/settings";
import styles from "./Rail.module.css";

type CollectionsProps = {
  item: ItemMetadata;
};

/**
 * Which collections this item is in.
 *
 * Membership is written into the item's own note, so there is one answer to
 * the question rather than two that can disagree — and `contains(collections,
 * "work")` in Dataview is the real answer, not a shadow of it.
 */
export function Collections({ item }: CollectionsProps) {
  const collections = useCollections();
  const loadSettings = useSettings((store) => store.load);
  const patchItem = useLibrary((store) => store.patchItem);
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");

  const setMember = async (collectionId: string, member: boolean) => {
    const result = await commands.setItemInCollection(item.entryId, collectionId, member);
    if (result.status === "error") reportError(result.error);
    else patchItem(result.data);
  };

  const create = async () => {
    const name = draft.trim();
    setDraft("");
    setNaming(false);
    if (name === "") return;

    const id = `col-${Date.now()}`;
    const saved = await commands.saveCollection({ id, name, icon: null });
    if (saved.status === "error") {
      reportError(saved.error);
      return;
    }
    await loadSettings();
    await setMember(id, true);
  };

  return (
    <>
      <div className={styles.sectionTitle}>Collections</div>
      <div className={styles.checkList}>
        {collections.map((collection) => (
          <label key={collection.id} className={styles.check}>
            <input
              type="checkbox"
              checked={item.collections.includes(collection.id)}
              onChange={(event) => void setMember(collection.id, event.target.checked)}
            />
            <span className={styles.checkLabel}>{collection.name}</span>
          </label>
        ))}
      </div>

      {naming ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: the field replaced the button just clicked
          autoFocus
          className={styles.tagInput}
          style={{ width: "100%", marginTop: 6 }}
          value={draft}
          placeholder="Name it"
          aria-label="New collection"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
            if (event.key === "Escape") {
              setDraft("");
              setNaming(false);
            }
          }}
          onBlur={() => void create()}
        />
      ) : (
        <button
          type="button"
          className={styles.addTag}
          style={{ marginTop: 6 }}
          onClick={() => setNaming(true)}
        >
          + collection
        </button>
      )}
    </>
  );
}
