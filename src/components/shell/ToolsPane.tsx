import { useEffect, useState } from "react";
import { commands, type ToolReport } from "../../bindings";
import type { Facets } from "../../lib/library";
import { reportError } from "../../stores/errors";
import { useSettings } from "../../stores/settings";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { ToolIcon } from "../common/Icon";
import styles from "./Pane.module.css";

type ToolsPaneProps = {
  facets: Facets;
};

/**
 * Every tool, where it looks, and whether it is there.
 *
 * Read-only for now: the registry ships with the application and is corrected
 * by updating it, not by each person fixing their own copy. Per-tool path
 * overrides exist in the settings file and belong on this page eventually.
 */
export function ToolsPane({ facets }: ToolsPaneProps) {
  const [reports, setReports] = useState<ToolReport[] | null>(null);
  const settings = useSettings((store) => store.settings);
  const projectNames = new Map(
    (settings?.projectWorkspaces ?? []).map((project) => [project.id, project.name]),
  );

  useEffect(() => {
    void commands.describeTools().then((result) => {
      if (result.status === "ok") setReports(result.data);
      else reportError(result.error);
    });
  }, []);

  if (!reports) return <div className={styles.empty}>Looking…</div>;

  const detected = reports.filter((report) => report.detected);
  const rest = reports.filter((report) => !report.detected);

  return (
    <div className={styles.pane}>
      <div className={styles.header}>
        <h1 className={styles.title}>
          Tools
          <span className={styles.badge}>
            {detected.length} of {reports.length} found
          </span>
        </h1>
        <p className={styles.subtitle}>
          Where each tool keeps its skills, agents, commands and rules — and which of those folders
          exist on this machine.
        </p>
      </div>

      <div className={styles.scroll}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Found here</h2>
          <div className={styles.rows}>
            {detected.map((report) => (
              <ToolRow
                key={report.tool.id}
                report={report}
                count={facets.byTool.get(report.tool.id) ?? 0}
                projectNames={projectNames}
              />
            ))}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Not on this machine</h2>
          <div className={styles.rows}>
            {rest.map((report) => (
              <ToolRow
                key={report.tool.id}
                report={report}
                count={facets.byTool.get(report.tool.id) ?? 0}
                projectNames={projectNames}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ToolRow({
  report,
  count,
  projectNames,
}: {
  report: ToolReport;
  count: number;
  projectNames: Map<string, string>;
}) {
  const label = TOOL_META[report.tool.id]?.label ?? report.tool.id;

  return (
    <details className={styles.row} style={{ display: "block" }}>
      <summary className={styles.rowTitle} style={{ cursor: "pointer" }}>
        <ToolIcon toolId={report.tool.id} size={15} />
        {label}
        {count > 0 && <span className={styles.badge}>{count} items</span>}
        {!report.detected && <span className={styles.badge}>no folders here</span>}
      </summary>

      <div className={styles.toolPaths}>
        {report.paths.map((path) => (
          <div key={`${path.type}-${path.path}`} style={{ display: "contents" }}>
            <span className={path.exists ? styles.pathFound : styles.pathMissing}>
              {path.exists ? "found" : "—"}
            </span>
            <span className={styles.badge}>
              {TYPE_META[path.type].label}
              {path.projectId && ` · ${projectNames.get(path.projectId) ?? "project"}`}
            </span>
            <span className={`${styles.mono} ${path.exists ? "" : styles.pathMissing}`}>
              {path.path}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
