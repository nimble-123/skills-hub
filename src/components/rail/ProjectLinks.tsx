import { commands, type ItemMetadata } from "../../bindings";
import { reportError, reportInfo } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { useSettings } from "../../stores/settings";
import styles from "./Rail.module.css";

type ProjectLinksProps = {
  item: ItemMetadata;
};

/**
 * Which projects this item is linked into.
 *
 * A checkbox per workspace, because the answer is yes or no per workspace and
 * the action is immediate. Linking is by symlink, so the original can never
 * drift out of step and unlinking takes nothing away from it.
 */
export function ProjectLinks({ item }: ProjectLinksProps) {
  const workspaces = useSettings((store) => store.settings?.projectWorkspaces ?? []);
  const items = useLibrary((store) => store.snapshot?.items ?? []);
  const rescan = useLibrary((store) => store.rescan);

  // Only a global item can be linked into a project; a project's own item is
  // already where it belongs.
  if (workspaces.length === 0 || item.projectId !== null) return null;

  /** The linked copy of this item inside a given project, if there is one. */
  const linkIn = (projectId: string) =>
    items.find(
      (candidate) => candidate.projectId === projectId && candidate.realPath === item.realPath,
    );

  const toggle = async (projectId: string) => {
    const existing = linkIn(projectId);
    const result = existing
      ? await commands.unlinkFromProject(existing.entryId)
      : await commands.linkIntoProject(item.entryId, projectId);

    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    reportInfo(existing ? `Unlinked ${item.name}` : `Linked ${item.name}`);
    await rescan();
  };

  return (
    <>
      <div className={styles.sectionTitle}>Workspaces</div>
      <div className={styles.checkList}>
        {workspaces.map((project) => {
          const linked = linkIn(project.id) !== undefined;
          return (
            <label key={project.id} className={styles.check}>
              <input type="checkbox" checked={linked} onChange={() => void toggle(project.id)} />
              <span className={styles.checkLabel}>{project.name}</span>
            </label>
          );
        })}
      </div>
      <p className={styles.hint}>
        Linked by symlink, never copied — so it cannot drift out of step, and unlinking leaves the
        original alone.
      </p>
    </>
  );
}
