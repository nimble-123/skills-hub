import type { ReactNode } from "react";
import type { ItemType } from "../../bindings";
import { Icon } from "../common/Icon";
import styles from "./Sidebar.module.css";

type NavRowProps = {
  icon: ReactNode;
  label: string;
  /** The item type this row stands for, which tints its icon. */
  type?: ItemType | undefined;
  count?: number | undefined;
  active?: boolean;
  /** Draws an attention dot, for things the user should look at. */
  attention?: boolean;
  title?: string | undefined;
  /** An optional remove control, shown on hover. */
  onRemove?: { label: string; onClick: () => void } | undefined;
  onClick: () => void;
};

export function NavRow({
  icon,
  label,
  type,
  count,
  active = false,
  attention = false,
  title,
  onRemove,
  onClick,
}: NavRowProps) {
  return (
    <div className={styles.rowWrap}>
      <button
        type="button"
        className={active ? `${styles.row} ${styles.rowActive}` : styles.row}
        onClick={onClick}
        title={title ?? label}
        aria-current={active ? "page" : undefined}
      >
        <span className={styles.rowIcon} data-type={type}>
          {icon}
        </span>
        <span className={styles.rowLabel}>{label}</span>
        {attention && <span className={styles.dot} role="img" aria-label="needs attention" />}
        {count !== undefined && <span className={styles.count}>{count}</span>}
      </button>
      {onRemove && (
        <button
          type="button"
          className={styles.rowRemove}
          title={onRemove.label}
          aria-label={onRemove.label}
          onClick={onRemove.onClick}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}
