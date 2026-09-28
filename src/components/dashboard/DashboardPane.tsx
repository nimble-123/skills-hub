import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commands,
  type DashboardReport,
  type ItemCost,
  type ItemType,
  type PruneCandidate,
  type UsageProgress,
  type UsageStats,
} from "../../bindings";
import { estimateTokens, formatDate } from "../../lib/format";
import { reportError } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { useUi } from "../../stores/ui";
import { TOOL_META, TYPE_META } from "../../toolMeta";
import { Icon, ToolIcon } from "../common/Icon";
import paneStyles from "../shell/Pane.module.css";
import styles from "./Dashboard.module.css";

/** Only these two keep a history worth reading. */
const TOOLS_WITH_HISTORY = ["claude-code", "codex"] as const;

const SHOWN = 12;

/** The order the type filter and the stacked bars follow. */
const TYPES = ["skill", "agent", "command", "rule"] as const;

export function DashboardPane() {
  const version = useLibrary((store) => store.snapshot?.version ?? 0);
  const select = useUi((ui) => ui.select);
  const go = useUi((ui) => ui.go);

  const [report, setReport] = useState<DashboardReport | null>(null);
  const [usage, setUsage] = useState<Record<string, UsageStats>>({});
  const [usageTool, setUsageTool] = useState<string | null>(null);
  const [reading, setReading] = useState<UsageProgress | null>(null);

  const compute = useCallback(async (withUsage: Record<string, UsageStats>) => {
    const result = await commands.computeDashboard(withUsage);
    if (result.status === "ok") setReport(result.data);
    else reportError(result.error);
  }, []);

  /**
   * Whatever usage has been read, without making it a dependency.
   *
   * Recomputing after a scan should use it, but a change to it must not
   * trigger a recompute: reading a tool's history already recomputes at the
   * end, and doing it twice is a second pass over the whole library.
   */
  const latestUsage = useRef(usage);
  useEffect(() => {
    latestUsage.current = usage;
  }, [usage]);

  useEffect(() => {
    if (version === 0) return;
    void compute(latestUsage.current);
  }, [version, compute]);

  /**
   * Reading a tool's history is hundreds of megabytes, so it is asked for
   * rather than done on every scan.
   */
  const readHistory = async (toolId: string) => {
    setReading({ done: 0, total: 0 });
    const progress = new Channel<UsageProgress>();
    progress.onmessage = setReading;

    const result = await commands.loadUsage(toolId, progress);
    setReading(null);

    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    setUsage(result.data);
    setUsageTool(toolId);
    await compute(result.data);
  };

  const open = (entryId: string) => {
    select(entryId);
    go({ kind: "library" });
  };

  /** Both narrow the ranked list; `null` means "everything". */
  const [tool, setTool] = useState<string | null>(null);
  const [type, setType] = useState<ItemType | null>(null);

  /** One entry per tool that actually has items, largest first. */
  const byTool = useMemo(() => {
    type Row = {
      chars: number;
      available: number;
      modelled: boolean;
      byType: Map<ItemType, number>;
    };
    const totals = new Map<string, Row>();
    for (const cost of report?.costs ?? []) {
      const row = totals.get(cost.tool) ?? {
        chars: 0,
        available: 0,
        modelled: false,
        byType: new Map(),
      };
      row.chars += cost.sourceChars;
      row.available += cost.availableChars ?? 0;
      // A tool holding only commands and rules has nothing modelled, which is
      // not the same as costing nothing.
      row.modelled ||= cost.availableChars !== null;
      row.byType.set(cost.type, (row.byType.get(cost.type) ?? 0) + cost.sourceChars);
      totals.set(cost.tool, row);
    }
    return [...totals.entries()]
      .map(([id, row]) => ({ id, ...row }))
      .sort((a, b) => b.chars - a.chars);
  }, [report]);

  /** The biggest tool sets the scale, so a bar's length is its share. */
  const maxTool = byTool[0]?.chars ?? 1;

  const ranked = useMemo(() => {
    const all = report?.costs ?? [];
    return all.filter((cost) => (!tool || cost.tool === tool) && (!type || cost.type === type));
  }, [report, tool, type]);

  /** Scaled within what is shown, so filtering does not leave the bars stunted. */
  const maxCost = useMemo(
    () => ranked.reduce((most, cost) => Math.max(most, cost.sourceChars), 1),
    [ranked],
  );

  /**
   * Items a tool's history says were actually run, busiest first.
   *
   * Empty until a history has been read, which is also when the section is
   * worth showing at all.
   */
  const topUsed = useMemo(() => {
    const costs = new Map((report?.costs ?? []).map((cost) => [cost.entryId, cost]));
    return Object.entries(usage)
      .filter(([entryId, stats]) => stats.count > 0 && costs.has(entryId))
      .map(([entryId, stats]) => ({ cost: costs.get(entryId) as ItemCost, stats }))
      .sort((a, b) => b.stats.count - a.stats.count)
      .slice(0, SHOWN);
  }, [report, usage]);

  const maxRuns = useMemo(
    () => topUsed.reduce((most, row) => Math.max(most, row.stats.count), 1),
    [topUsed],
  );

  if (!report) {
    return (
      <div className={paneStyles.pane}>
        <div className={paneStyles.header}>
          <h1 className={paneStyles.title}>Cost</h1>
        </div>
        <div className={paneStyles.empty}>Nothing scanned yet.</div>
      </div>
    );
  }

  return (
    <div className={paneStyles.pane}>
      <div className={paneStyles.header}>
        <div className={styles.headRow}>
          <div>
            <h1 className={paneStyles.title}>Cost</h1>
            <p className={paneStyles.subtitle}>
              Roughly four characters to a token. Not a tokeniser — the figures are here to compare
              items against each other, not to predict a bill.
            </p>
          </div>
          <div className={styles.stats}>
            <Stat label="Enabled" value={String(report.costs.length)} />
            <Stat
              label="Always available"
              value={estimateTokens(report.totalAvailableChars)}
              accent
              hint="Names and descriptions, carried every turn so the model knows these exist."
            />
            <Stat
              label="On invocation"
              value={estimateTokens(report.totalInvocationChars)}
              hint="The instructions loaded once something is actually used."
            />
            <Stat
              label="On disk"
              value={estimateTokens(report.totalSourceChars)}
              hint="Every file in full, whether it is ever loaded or not."
            />
            <Stat
              label="Worth a look"
              value={String(report.prune.length)}
              warn={report.prune.length > 0}
            />
            <Stat
              label="Overlaps"
              value={String(report.overlaps.length)}
              warn={report.overlaps.length > 0}
            />
          </div>
        </div>
      </div>

      <div className={paneStyles.scroll}>
        <section className={paneStyles.section} style={{ maxWidth: "none" }}>
          <div className={styles.sectionHead}>
            <h2 className={paneStyles.sectionTitle}>Source size by tool</h2>
            <div className={styles.legend}>
              {TYPES.map((t) => (
                <span key={t} className={styles.legendItem}>
                  <span className={styles.swatch} data-type={t} />
                  {TYPE_META[t].label}
                </span>
              ))}
            </div>
          </div>
          <div className={styles.toolCards}>
            {byTool.map((row) => (
              <button
                key={row.id}
                type="button"
                className={
                  tool === row.id ? `${styles.toolCard} ${styles.toolCardOn}` : styles.toolCard
                }
                aria-pressed={tool === row.id}
                title={
                  tool === row.id
                    ? "Show every tool again"
                    : `Show only ${TOOL_META[row.id]?.label ?? row.id}`
                }
                onClick={() => setTool(tool === row.id ? null : row.id)}
              >
                <span className={styles.toolName}>
                  <ToolIcon toolId={row.id} size={13} />
                  {TOOL_META[row.id]?.label ?? row.id}
                </span>
                <span className={styles.toolTotal}>{estimateTokens(row.chars)}</span>
                <span className={styles.toolAvailable}>
                  {row.modelled
                    ? `${estimateTokens(row.available)} every turn`
                    : "carried-cost not modelled"}
                </span>
                <span className={styles.stack}>
                  <span
                    className={styles.stackInner}
                    style={{ width: `${(row.chars / maxTool) * 100}%` }}
                  >
                    {TYPES.filter((t) => row.byType.has(t)).map((t) => (
                      <span
                        key={t}
                        className={styles.stackPart}
                        data-type={t}
                        style={{ width: `${((row.byType.get(t) ?? 0) / row.chars) * 100}%` }}
                        title={`${TYPE_META[t].plural}: ${estimateTokens(row.byType.get(t) ?? 0)}`}
                      />
                    ))}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className={paneStyles.section} style={{ maxWidth: "none" }}>
          <div className={styles.sectionHead}>
            <h2 className={paneStyles.sectionTitle}>
              Largest items
              {tool && ` · ${TOOL_META[tool]?.label ?? tool}`}
            </h2>
            <div className={styles.tabs}>
              <button
                type="button"
                className={type === null ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                onClick={() => setType(null)}
              >
                All
              </button>
              {TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={type === t ? `${styles.tab} ${styles.tabOn}` : styles.tab}
                  onClick={() => setType(type === t ? null : t)}
                >
                  {TYPE_META[t].plural}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.bars}>
            {ranked.slice(0, SHOWN).map((cost) => (
              <button
                key={cost.entryId}
                type="button"
                className={styles.bar}
                onClick={() => open(cost.entryId)}
              >
                <span className={styles.barName}>
                  {cost.name}
                  <span className={styles.barMeta}>
                    {" "}
                    · {TOOL_META[cost.tool]?.label ?? cost.tool}
                    {cost.availableChars === null && " · context not modelled"}
                  </span>
                </span>
                <span className={styles.barTrack}>
                  <span
                    className={styles.barFill}
                    data-type={cost.type}
                    style={{ width: `${Math.max(2, (cost.sourceChars / maxCost) * 100)}%` }}
                  />
                </span>
                <span className={styles.barValue}>{estimateTokens(cost.sourceChars)}</span>
              </button>
            ))}
          </div>
          {ranked.length === 0 && (
            <p className={paneStyles.fieldHint}>Nothing matches that combination.</p>
          )}
        </section>

        {topUsed.length > 0 && (
          <section className={paneStyles.section} style={{ maxWidth: "none" }}>
            <h2 className={paneStyles.sectionTitle}>Most used</h2>
            <p className={paneStyles.fieldHint}>
              From {TOOL_META[usageTool ?? ""]?.label ?? usageTool}'s own history. Cost buys nothing
              until something is actually run.
            </p>
            <div className={styles.bars}>
              {topUsed.map(({ cost, stats }) => (
                <button
                  key={cost.entryId}
                  type="button"
                  className={styles.bar}
                  onClick={() => open(cost.entryId)}
                >
                  <span className={styles.barName}>
                    {cost.name}
                    <span className={styles.barMeta}>
                      {" "}
                      · {stats.lastUsed ? `last used ${formatDate(stats.lastUsed)}` : "never"}
                    </span>
                  </span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      data-type={cost.type}
                      style={{ width: `${Math.max(2, (stats.count / maxRuns) * 100)}%` }}
                    />
                  </span>
                  <span className={styles.barValue}>
                    {stats.count} {stats.count === 1 ? "run" : "runs"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className={paneStyles.section} style={{ maxWidth: "none" }}>
          <h2 className={paneStyles.sectionTitle}>Worth a second look</h2>
          <div className={styles.toolbar}>
            <span className={paneStyles.fieldHint}>
              {usageTool
                ? `Using ${TOOL_META[usageTool]?.label ?? usageTool}'s own history.`
                : "Without a tool's history this falls back to what a file looks like."}
            </span>
            {TOOLS_WITH_HISTORY.map((toolId) => (
              <button
                key={toolId}
                type="button"
                className={styles.small}
                disabled={reading !== null}
                onClick={() => void readHistory(toolId)}
              >
                {reading && usageTool === toolId
                  ? `Reading ${reading.done}/${reading.total}`
                  : `Read ${TOOL_META[toolId]?.label ?? toolId} history`}
              </button>
            ))}
          </div>

          {report.prune.length === 0 ? (
            <p className={paneStyles.fieldHint}>Nothing stands out.</p>
          ) : (
            <div className={paneStyles.rows}>
              {report.prune.slice(0, SHOWN).map((candidate) => (
                <PruneRow
                  key={candidate.entryId}
                  candidate={candidate}
                  onOpen={() => open(candidate.entryId)}
                  onDisregard={() => {
                    void commands.disregard(candidate.entryId).then(() => compute(usage));
                  }}
                />
              ))}
            </div>
          )}
        </section>

        <section className={paneStyles.section} style={{ maxWidth: "none" }}>
          <h2 className={paneStyles.sectionTitle}>Possible overlaps</h2>
          <p className={paneStyles.fieldHint}>
            Two items that look like they are after the same request. Both still work — but the
            model has to choose, and it may not choose the one you meant.
          </p>
          {report.overlaps.length === 0 ? (
            <p className={paneStyles.fieldHint}>Nothing looks duplicated.</p>
          ) : (
            <div className={paneStyles.rows}>
              {report.overlaps.slice(0, SHOWN).map((overlap) => (
                <div key={overlap.pairId} className={paneStyles.row}>
                  <div className={paneStyles.rowText}>
                    <div className={paneStyles.rowTitle}>
                      <button
                        type="button"
                        className={styles.small}
                        onClick={() => open(overlap.a)}
                      >
                        {overlap.aName}
                      </button>
                      ↔
                      <button
                        type="button"
                        className={styles.small}
                        onClick={() => open(overlap.b)}
                      >
                        {overlap.bName}
                      </button>
                      <span className={styles.reason}>
                        {overlap.reason === "same-name"
                          ? "same name"
                          : `${Math.round((overlap.similarity ?? 0) * 100)}% alike`}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.small}
                    onClick={() => {
                      void commands.disregard(overlap.pairId).then(() => compute(usage));
                    }}
                  >
                    Disregard
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * One figure in the header strip.
 *
 * The explanation is a `title` rather than a line of its own: six of these
 * with a paragraph each cost a quarter of the window before any content.
 */
function Stat({
  label,
  value,
  hint,
  accent = false,
  warn = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className={styles.stat} title={hint}>
      <div className={styles.statLabel}>
        {label}
        {hint && <Icon name="info" size={10} className={styles.statInfo} />}
      </div>
      <div
        className={`${styles.statValue} ${accent ? styles.accent : ""} ${warn ? styles.warn : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function PruneRow({
  candidate,
  onOpen,
  onDisregard,
}: {
  candidate: PruneCandidate;
  onOpen: () => void;
  onDisregard: () => void;
}) {
  const reason = {
    "never-used": "never used",
    "not-used-lately": `last used ${formatDate(candidate.lastUsed)}`,
    "large-and-old": `large, untouched since ${formatDate(candidate.modified)}`,
  }[candidate.reason];

  return (
    <div className={paneStyles.row}>
      <div className={paneStyles.rowText}>
        <div className={paneStyles.rowTitle}>
          <button type="button" className={styles.small} onClick={onOpen}>
            {candidate.name}
          </button>
          <span className={styles.reason}>{reason}</span>
          <span className={styles.barMeta}>{estimateTokens(candidate.sourceChars)}</span>
        </div>
      </div>
      <button type="button" className={styles.small} onClick={onDisregard}>
        Disregard
      </button>
    </div>
  );
}
