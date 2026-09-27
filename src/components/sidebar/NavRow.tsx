import type { ReactNode } from "react";
import styles from "./Sidebar.module.css";

type NavRowProps = {
  icon: ReactNode;
  label: string;
  count?: number | undefined;
  active?: boolean;
  /** Draws an attention dot, for things the user should look at. */
  attention?: boolean;
  title?: string | undefined;
  onClick: () => void;
};

export function NavRow({
  icon,
  label,
  count,
  active = false,
  attention = false,
  title,
  onClick,
}: NavRowProps) {
  return (
    <button
      type="button"
      className={active ? `${styles.row} ${styles.rowActive}` : styles.row}
      onClick={onClick}
      title={title ?? label}
      aria-current={active ? "page" : undefined}
    >
      <span className={styles.rowIcon}>{icon}</span>
      <span className={styles.rowLabel}>{label}</span>
      {attention && <span className={styles.dot} role="img" aria-label="needs attention" />}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
}
