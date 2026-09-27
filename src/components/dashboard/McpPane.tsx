import { useEffect, useState } from "react";
import { commands, type McpServer, type ScanWarning } from "../../bindings";
import { reportError } from "../../stores/errors";
import { useWorkspaces } from "../../stores/selectors";
import { TOOL_META } from "../../toolMeta";
import { Icon } from "../common/Icon";
import paneStyles from "../shell/Pane.module.css";
import styles from "./Dashboard.module.css";

/**
 * Every MCP server every tool is configured with.
 *
 * Read-only, deliberately. These are the tools' own configuration files in
 * their own formats, and editing them from here would mean understanding each
 * schema well enough not to corrupt it. Showing what is there — and where —
 * is the useful part; changing it is one click away in the file itself.
 */
export function McpPane() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [warnings, setWarnings] = useState<ScanWarning[]>([]);
  const workspaces = useWorkspaces();

  useEffect(() => {
    void commands.listMcpServers().then((result) => {
      if (result.status === "ok") {
        setServers(result.data.servers);
        setWarnings(result.data.warnings);
      } else {
        reportError(result.error);
      }
    });
  }, []);

  if (!servers) return <div className={paneStyles.empty}>Reading configuration…</div>;

  const scopeName = (projectId: string | null) =>
    projectId === null
      ? "global"
      : (workspaces.find((project) => project.id === projectId)?.name ?? "project");

  return (
    <div className={paneStyles.pane}>
      <div className={paneStyles.header}>
        <h1 className={paneStyles.title}>
          MCP servers
          <span className={paneStyles.badge}>{servers.length}</span>
        </h1>
        <p className={paneStyles.subtitle}>
          Read straight from each tool's own configuration. Nothing here changes anything — but the
          file is one click away. A server defined both globally and in a project appears twice,
          because knowing the project overrides your global setup is the point.
        </p>
      </div>

      <div className={paneStyles.scroll}>
        {warnings.length > 0 && (
          <section className={paneStyles.section}>
            <h2 className={paneStyles.sectionTitle}>Could not be read</h2>
            <div className={paneStyles.rows}>
              {warnings.map((warning) => (
                <div key={warning.path} className={paneStyles.row}>
                  <Icon name="circle-alert" size={15} />
                  <div className={paneStyles.rowText}>
                    <div className={`${paneStyles.fieldHint} ${paneStyles.mono}`}>
                      {warning.path}
                    </div>
                    <div className={paneStyles.fieldHint}>{warning.message}</div>
                  </div>
                  <button
                    type="button"
                    className={styles.small}
                    onClick={() => void open(warning.path)}
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {servers.length === 0 ? (
          <p className={paneStyles.fieldHint}>No tool on this machine has one configured.</p>
        ) : (
          <div className={paneStyles.rows}>
            {servers.map((server) => (
              <ServerRow key={server.id} server={server} scope={scopeName(server.projectId)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServerRow({ server, scope }: { server: McpServer; scope: string }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const env = Object.entries(server.config.env ?? {});
  const command = server.config.url
    ? server.config.url
    : [server.config.command, ...(server.config.args ?? [])].filter(Boolean).join(" ");

  return (
    <div className={paneStyles.row} style={{ display: "block" }}>
      <div className={paneStyles.rowTitle}>
        <Icon name="plug" size={14} />
        <strong>{server.name}</strong>
        <span className={paneStyles.badge}>{TOOL_META[server.tool]?.label ?? server.tool}</span>
        <span className={paneStyles.badge}>{scope}</span>
        {server.config.type && <span className={paneStyles.badge}>{server.config.type}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" className={styles.small} onClick={() => void open(server.sourcePath)}>
          Open config
        </button>
      </div>

      <div className={`${paneStyles.fieldHint} ${paneStyles.mono}`}>{command}</div>

      {env.length > 0 && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          {env.map(([key, value]) => (
            <div key={key} className={styles.envRow}>
              <span className={styles.envKey}>{key}</span>
              <span className={styles.masked}>
                {/* These routinely hold tokens; they are not shown until asked for. */}
                {revealed === key ? value : "•".repeat(Math.min(value.length, 20))}
              </span>
              <button
                type="button"
                className={styles.small}
                onClick={() => setRevealed(revealed === key ? null : key)}
              >
                {revealed === key ? "Hide" : "Show"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`${paneStyles.fieldHint} ${paneStyles.mono}`} style={{ marginTop: 4 }}>
        {server.sourcePath}
      </div>
    </div>
  );
}

async function open(path: string) {
  const result = await commands.openPath(path);
  if (result.status === "error") reportError(result.error);
}
