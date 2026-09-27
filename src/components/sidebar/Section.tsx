import type { ReactNode } from "react";
import { useUi } from "../../stores/ui";
import { Icon } from "../common/Icon";
import styles from "./Sidebar.module.css";

type SectionProps = {
  name: string;
  label: string;
  children: ReactNode;
};

/** A collapsible group of sidebar rows. */
export function Section({ name, label, children }: SectionProps) {
  const collapsed = useUi((ui) => ui.collapsedSections.has(name));
  const toggle = useUi((ui) => ui.toggleSection);

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeading}
        onClick={() => toggle(name)}
        aria-expanded={!collapsed}
      >
        <Icon
          name="chevron-down"
          size={12}
          className={collapsed ? `${styles.chevron} ${styles.chevronCollapsed}` : styles.chevron}
        />
        {label}
      </button>
      {!collapsed && children}
    </div>
  );
}
