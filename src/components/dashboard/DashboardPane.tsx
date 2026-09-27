import { Channel } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  commands,
  type DashboardReport,
  type PruneCandidate,
  type UsageProgress,
  type UsageStats,
} from "../../bindings";
import { estimateTokens, formatDate } from "../../lib/format";
import { reportError } from "../../stores/errors";
import { useLibrary } from "../../stores/library";
import { useUi } from "../../stores/ui";
import { TOOL_META } from "../../toolMeta";
import paneStyles from "../shell/Pane.module.css";
import styles from "./Dashboard.module.css";

/** Only these two keep a history worth reading. */
const TOOLS_WITH_HISTORY = ["claude-code", "codex"] as const;

const SHOWN = 12;

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

  const maxCost = useMemo(
    () => report?.costs.reduce((most, cost) => Math.max(most, cost.sourceChars), 1) ?? 1,
    [report],
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
        <h1 className={paneStyles.title}>Cost</h1>
        <p className={paneStyles.subtitle}>
          Roughly four characters to a token. Not a tokeniser — the figures are here to compare
          items against each other, not to predict a bill.
        </p>
      </div>

      <div className={paneStyles.scroll}>
        <div className={styles.stats}>
          <Stat
            label="Enabled"
            value={String(report.costs.length)}
            hint="Disabled items cost nothing, which is the point of disabling them."
          />
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
            label="Total on disk"
            value={estimateTokens(report.totalSourceChars)}
            hint="Every file in full, whether it is ever loaded or not."
          />
          <Stat
            label="Worth a look"
            value={String(report.prune.length)}
            warn={report.prune.length > 0}
          />
          <Stat
            label="Possible overlaps"
            value={String(report.overlaps.length)}
            warn={report.overlaps.length > 0}
          />
        </div>

        <section className={paneStyles.section} style={{ maxWidth: "none" }}>
          <h2 className={paneStyles.sectionTitle}>Largest items</h2>
          <div className={styles.bars}>
            {report.costs.slice(0, SHOWN).map((cost) => (
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
                    style={{ width: `${Math.max(2, (cost.sourceChars / maxCost) * 100)}%` }}
                  />
                </span>
                <span className={styles.barValue}>{estimateTokens(cost.sourceChars)}</span>
              </button>
            ))}
          </div>
        </section>

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
    <div className={styles.stat}>
      <div
        className={`${styles.statValue} ${accent ? styles.accent : ""} ${warn ? styles.warn : ""}`}
      >
        {value}
      </div>
      <div className={styles.statLabel}>{label}</div>
      {hint && <div className={styles.statHint}>{hint}</div>}
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
