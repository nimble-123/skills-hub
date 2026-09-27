import { type KeyboardEvent, type MouseEvent, useState } from "react";
import { commands, type ItemMetadata } from "../../bindings";
import { reportError } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { Icon, ToolIcon } from "../common/Icon";
import styles from "./Card.module.css";

type CardProps = {
  item: ItemMetadata;
  selected: boolean;
  /** The workspace this item belongs to, or undefined for the global scope. */
  projectName: string | undefined;
  onSelect: () => void;
};

/**
 * One item.
 *
 * The card is a `div` with a button role rather than a `button`, because it
 * holds controls of its own — a `button` inside a `button` is not valid, and
 * the switch has to be a real control since it performs a real action.
 */
export function Card({ item, selected, projectName, onSelect }: CardProps) {
  const patchItem = useLibrary((store) => store.patchItem);
  const [busy, setBusy] = useState(false);

  const fromPlugin = item.pluginId !== null;
  const isLink = item.sourcePath !== item.realPath;

  /** Runs a command without also opening the card underneath. */
  const act = async (event: MouseEvent, action: () => Promise<void>) => {
    event.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  const className = [styles.card, selected && styles.selected, !item.enabled && styles.off]
    .filter(Boolean)
    .join(" ");

  return (
    // biome-ignore lint/a11y/useSemanticElements: it contains its own controls
    <div
      className={className}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <div className={styles.head}>
        <span className={styles.name}>{item.name}</span>
        <span className={styles.typePill}>{TYPE_META[item.type].label}</span>
        <button
          type="button"
          className={`${styles.switch} ${item.enabled ? styles.switchOn : ""}`}
          disabled={busy || fromPlugin}
          title={
            fromPlugin
              ? "Part of an installed plugin — enable or disable the whole bundle instead"
              : item.enabled
                ? "Disable: moves the file out of where the tool reads it"
                : "Enable: moves the file back"
          }
          aria-label={item.enabled ? `Disable ${item.name}` : `Enable ${item.name}`}
          onClick={(event) =>
            void act(event, async () => {
              const result = await commands.setItemEnabled(item.entryId, !item.enabled);
              if (result.status === "error") reportError(result.error);
              else patchItem(result.data);
            })
          }
        />
      </div>

      <div className={styles.caption}>
        <ToolIcon toolId={item.tool} size={12} />
        {TOOL_META[item.tool]?.label ?? item.tool}
        {fromPlugin && " · plugin"}
      </div>

      {item.description && <p className={styles.description}>{item.description}</p>}

      {item.tags.length > 0 && (
        <div className={styles.tags}>
          {item.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className={styles.footer}>
        <span className={styles.origin} title={item.sourcePath}>
          <Icon name={isLink ? "link" : "globe"} size={11} />
          {isLink ? "Linked" : "Source"} · {projectName ?? "Global"}
        </span>
        <button
          type="button"
          className={`${styles.iconButton} ${item.favorite ? styles.starred : ""}`}
          title={item.favorite ? "Remove from favourites" : "Add to favourites"}
          aria-label={item.favorite ? "Remove from favourites" : "Add to favourites"}
          onClick={(event) =>
            void act(event, async () => {
              const result = await commands.setItemFavorite(item.entryId, !item.favorite);
              if (result.status === "error") reportError(result.error);
              else patchItem(result.data);
            })
          }
        >
          <Icon name={item.favorite ? "star" : "star-off"} size={13} />
        </button>
      </div>
    </div>
  );
}
