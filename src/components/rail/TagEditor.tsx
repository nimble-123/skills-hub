import { type KeyboardEvent, useState } from "react";
import { commands, type ItemMetadata } from "../../bindings";
import { reportError } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { Icon } from "../common/Icon";
import styles from "./Rail.module.css";

type TagEditorProps = {
  item: ItemMetadata;
};

/** Tags, edited in place. They are written straight into the item's note. */
export function TagEditor({ item }: TagEditorProps) {
  const patchItem = useLibrary((store) => store.patchItem);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const save = async (tags: string[]) => {
    const result = await commands.setItemTags(item.entryId, tags);
    if (result.status === "error") reportError(result.error);
    else patchItem(result.data);
  };

  const commit = () => {
    const tag = draft.trim();
    setDraft("");
    setAdding(false);
    if (tag !== "" && !item.tags.includes(tag)) void save([...item.tags, tag]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setDraft("");
      setAdding(false);
    }
  };

  return (
    <div className={styles.tags}>
      {item.tags.map((tag) => (
        <span key={tag} className={styles.tag}>
          {tag}
          <button
            type="button"
            className={styles.tagRemove}
            aria-label={`Remove the tag ${tag}`}
            onClick={() => void save(item.tags.filter((existing) => existing !== tag))}
          >
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}

      {adding ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: the field replaced the button that was just clicked
          autoFocus
          className={styles.tagInput}
          value={draft}
          placeholder="tag"
          aria-label="New tag"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
        />
      ) : (
        <button type="button" className={styles.addTag} onClick={() => setAdding(true)}>
          + tag
        </button>
      )}
    </div>
  );
}
