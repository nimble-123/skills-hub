import type { ReactNode } from "react";
import { useUi } from "../../stores/ui";
import { Icon } from "../common/Icon";
import styles from "./Sidebar.module.css";

type SectionProps = {
  name: string;
  label: string;
  /** An action for the heading, such as adding a workspace. */
  action?: { icon: string; label: string; onClick: () => void } | undefined;
  children: ReactNode;
};

/** A collapsible group of sidebar rows. */
export function Section({ name, label, action, children }: SectionProps) {
  const collapsed = useUi((ui) => ui.collapsedSections.has(name));
  const toggle = useUi((ui) => ui.toggleSection);

  return (
    <div className={styles.section}>
      <div className={styles.sectionRow}>
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
        {action && (
          <button
            type="button"
            className={styles.sectionAction}
            title={action.label}
            aria-label={action.label}
            onClick={action.onClick}
          >
            <Icon name={action.icon} size={13} />
          </button>
        )}
      </div>
      {!collapsed && children}
    </div>
  );
}
