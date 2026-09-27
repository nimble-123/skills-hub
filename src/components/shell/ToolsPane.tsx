import { useCallback, useEffect, useState } from "react";
import { commands, type ItemType, type ToolOverride, type ToolReport } from "../../bindings";
import type { Facets } from "../../lib/library";
import { reportError, reportInfo } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { useWorkspaces } from "../../stores/selectors";
import { useSettings } from "../../stores/settings";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { Icon, ToolIcon } from "../common/Icon";
import paneStyles from "./Pane.module.css";
import { PathField } from "./PathField";
import styles from "./Tools.module.css";

const TYPES: ItemType[] = ["skill", "agent", "command", "rule"];

type ToolsPaneProps = {
  facets: Facets;
};

/**
 * Every tool, where it looks, and whether that is right.
 *
 * Editable, because the registry that ships with the application is a set of
 * defaults and not the truth: tools move their folders, and someone with a
 * nonstandard setup should not have to wait for a release.
 *
 * What is stored is only the difference from the default, per path — so
 * changing where one tool keeps its commands leaves its skills free to be
 * corrected by an update, and any field can be put back.
 */
export function ToolsPane({ facets }: ToolsPaneProps) {
  const [reports, setReports] = useState<ToolReport[] | null>(null);
  const rescan = useLibrary((store) => store.rescan);
  const loadSettings = useSettings((store) => store.load);
  const workspaces = useWorkspaces();

  const reload = useCallback(async () => {
    const result = await commands.describeTools();
    if (result.status === "ok") setReports(result.data);
    else reportError(result.error);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Every change writes the settings and rescans: the library has moved. */
  const apply = async (toolId: string, overrides: ToolOverride) => {
    const result = await commands.setToolOverride(toolId, overrides);
    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    await loadSettings();
    await reload();
    await rescan();
  };

  if (!reports) return <div className={paneStyles.empty}>Looking…</div>;

  const detected = reports.filter((report) => report.detected);
  const rest = reports.filter((report) => !report.detected);

  return (
    <div className={paneStyles.pane}>
      <div className={paneStyles.header}>
        <h1 className={paneStyles.title}>
          Tools
          <span className={paneStyles.badge}>
            {detected.length} of {reports.length} found
          </span>
        </h1>
        <p className={paneStyles.subtitle}>
          Where each tool keeps its skills, agents, commands and rules. The paths that ship are
          defaults, not the truth — change any of them, and only the difference is stored, so
          everything you leave alone stays free to be corrected by an update.
        </p>
      </div>

      <div className={paneStyles.scroll}>
        <section className={paneStyles.section} style={{ maxWidth: "none" }}>
          <h2 className={paneStyles.sectionTitle}>Found on this machine</h2>
          <div className={paneStyles.rows}>
            {detected.map((report) => (
              <ToolCard
                key={report.tool.id}
                report={report}
                count={facets.byTool.get(report.tool.id) ?? 0}
                hasWorkspaces={workspaces.length > 0}
                onApply={apply}
                onRemoved={() => void Promise.all([loadSettings(), reload(), rescan()])}
              />
            ))}
          </div>
        </section>

        <section className={paneStyles.section} style={{ maxWidth: "none" }}>
          <h2 className={paneStyles.sectionTitle}>Nothing here yet</h2>
          <p className={paneStyles.fieldHint}>
            Still scanned, in case you install one — and still editable, if it keeps its things
            somewhere other than where this expects.
          </p>
          <div className={paneStyles.rows}>
            {rest.map((report) => (
              <ToolCard
                key={report.tool.id}
                report={report}
                count={facets.byTool.get(report.tool.id) ?? 0}
                hasWorkspaces={workspaces.length > 0}
                onApply={apply}
                onRemoved={() => void Promise.all([loadSettings(), reload(), rescan()])}
              />
            ))}
          </div>
        </section>

        <AddTool onAdded={() => void Promise.all([loadSettings(), reload(), rescan()])} />
      </div>
    </div>
  );
}

function ToolCard({
  report,
  count,
  hasWorkspaces,
  onApply,
  onRemoved,
}: {
  report: ToolReport;
  count: number;
  hasWorkspaces: boolean;
  onApply: (toolId: string, overrides: ToolOverride) => Promise<void>;
  onRemoved: () => void;
}) {
  const { tool, shipped, overrides } = report;
  const label = TOOL_META[tool.id]?.label ?? tool.id;

  /** Replaces one path, leaving every other override as it was. */
  const setPath = (scope: "paths" | "projectPaths", type: ItemType, value: string) => {
    const shippedValue = shipped?.[scope]?.[type];
    const next = { ...(overrides[scope] ?? {}) };

    if (value.trim() === (shippedValue ?? "").trim()) {
      // Back to the default: stop storing a difference at all.
      delete next[type];
    } else {
      next[type] = value.trim();
    }
    void onApply(tool.id, { ...overrides, [scope]: next });
  };

  const remove = async () => {
    const result = await commands.removeCustomTool(tool.id);
    if (result.status === "error") reportError(result.error);
    else {
      reportInfo(`Removed ${label}`);
      onRemoved();
    }
  };

  return (
    <details className={styles.tool}>
      <summary className={styles.toolHead}>
        <ToolIcon toolId={tool.id} size={15} />
        <span className={styles.toolName}>{label}</span>
        {count > 0 && <span className={paneStyles.badge}>{count} items</span>}
        {tool.custom && <span className={paneStyles.badge}>yours</span>}
        {tool.disabled && <span className={paneStyles.badge}>hidden</span>}
        <span className={styles.grow} />
        <Icon name="chevron-down" size={14} />
      </summary>

      <div className={styles.body}>
        <div className={styles.group}>
          <div className={styles.groupTitle}>In your home directory</div>
          {TYPES.map((type) => (
            <PathField
              key={type}
              id={`${tool.id}-home-${type}`}
              label={TYPE_META[type].plural}
              value={tool.paths?.[type] ?? ""}
              shipped={shipped?.paths?.[type] ?? ""}
              onSave={(value) => setPath("paths", type, value)}
            />
          ))}
          <p className={styles.note}>
            Leave one empty and that kind stops being scanned for this tool.
          </p>
        </div>

        {hasWorkspaces && (
          <div className={styles.group}>
            <div className={styles.groupTitle}>Inside a project</div>
            {TYPES.map((type) => (
              <PathField
                key={type}
                id={`${tool.id}-project-${type}`}
                label={TYPE_META[type].plural}
                value={tool.projectPaths?.[type] ?? ""}
                shipped={shipped?.projectPaths?.[type] ?? ""}
                placeholder={derivedProjectPath(tool.paths?.[type])}
                onSave={(value) => setPath("projectPaths", type, value)}
              />
            ))}
            <p className={styles.note}>
              Empty means the home path with its leading <code>~/</code> dropped, which is what most
              tools do.
            </p>
          </div>
        )}

        <div className={styles.group}>
          <label className={paneStyles.field} style={{ borderBottom: 0, padding: "4px 0" }}>
            <span className={paneStyles.fieldText}>
              <span className={paneStyles.fieldName}>Show in the sidebar</span>
              <p className={paneStyles.fieldHint}>
                Hiding it only hides it. Its items are still scanned, so your tags and favourites
                for them are not thrown away.
              </p>
            </span>
            <input
              type="checkbox"
              checked={!tool.disabled}
              onChange={(event) =>
                void onApply(tool.id, { ...overrides, disabled: !event.target.checked })
              }
            />
          </label>

          {tool.custom && (
            <button type="button" className={styles.reset} onClick={() => void remove()}>
              Remove this tool
            </button>
          )}
        </div>
      </div>
    </details>
  );
}

/** What a project path falls back to when none is given. */
function derivedProjectPath(homePath: string | undefined): string {
  if (!homePath) return "not scanned";
  return homePath.replace(/^~\/?/, "");
}

function AddTool({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [skills, setSkills] = useState("");

  const add = async () => {
    if (name.trim() === "") return;
    const result = await commands.addCustomTool(name, skills.trim() ? { skill: skills } : {});
    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    setName("");
    setSkills("");
    reportInfo(`Added ${name}`);
    onAdded();
  };

  return (
    <section className={paneStyles.section}>
      <h2 className={paneStyles.sectionTitle}>Add a tool</h2>
      <p className={paneStyles.fieldHint}>
        For something this does not ship yet. Give it a name and where it keeps its skills; the rest
        can be filled in afterwards.
      </p>
      <div className={styles.newTool} style={{ marginTop: 8 }}>
        <div className={styles.newField}>
          <label className={styles.newLabel} htmlFor="new-tool-name">
            Name
          </label>
          <input
            id="new-tool-name"
            className={styles.newInput}
            value={name}
            placeholder="my-tool"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className={styles.newField} style={{ flex: 1, minWidth: 240 }}>
          <label className={styles.newLabel} htmlFor="new-tool-skills">
            Skills folder
          </label>
          <input
            id="new-tool-skills"
            className={styles.newInput}
            value={skills}
            placeholder="~/.my-tool/skills"
            spellCheck={false}
            onChange={(event) => setSkills(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={styles.reset}
          disabled={name.trim() === ""}
          onClick={() => void add()}
        >
          Add
        </button>
      </div>
    </section>
  );
}
