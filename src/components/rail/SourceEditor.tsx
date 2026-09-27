import { type KeyboardEvent, useState } from "react";
import { commands, type ItemMetadata } from "../../bindings";
import { reportError, reportInfo } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import styles from "./Rail.module.css";

type SourceEditorProps = {
  item: ItemMetadata;
  initial: string;
  onDone: () => void;
};

/**
 * Editing an item's own file.
 *
 * This writes to the file the tool reads, not to a copy — so the scanner's
 * view of the item's name and description is refreshed from what was saved,
 * rather than waiting for the next scan to notice.
 */
export function SourceEditor({ item, initial, onDone }: SourceEditorProps) {
  const patchItem = useLibrary((store) => store.patchItem);
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);

  const unchanged = draft === initial;

  const save = async () => {
    if (saving) return;
    setSaving(true);
    const result = await commands.writeItemContent(item.entryId, draft);
    setSaving(false);

    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    patchItem(result.data);
    reportInfo(`Saved ${item.name}`);
    onDone();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onDone();
      return;
    }
    // A markdown file is indented with spaces; Tab should not leave the field.
    if (event.key === "Tab") {
      event.preventDefault();
      const target = event.currentTarget;
      const { selectionStart, selectionEnd } = target;
      setDraft(`${draft.slice(0, selectionStart)}  ${draft.slice(selectionEnd)}`);
      requestAnimationFrame(() => {
        target.selectionStart = selectionStart + 2;
        target.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the field replaced the button just clicked
        autoFocus
        className={styles.editor}
        value={draft}
        aria-label={`Source of ${item.name}`}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.editorActions}>
        <button
          type="button"
          className={styles.save}
          disabled={unchanged || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className={styles.cancel} onClick={onDone}>
          Cancel
        </button>
        <span className={styles.shortcutHint}>⌘S to save, Esc to cancel</span>
      </div>
    </>
  );
}
