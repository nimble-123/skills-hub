import { useState } from "react";
import { commands, type RegistryHit } from "../../bindings";
import { repoLabel } from "../../lib/github";
import { useDiscover } from "../../stores/discover";
import { reportError } from "../../stores/errors";
import { Icon } from "../common/Icon";
import paneStyles from "../shell/Pane.module.css";
import styles from "./Discover.module.css";

/** Enough to be useful, few enough to read. */
const SHOWN_REPOS = 20;

type Group = {
  source: string;
  repoUrl: string;
  /** The matching skills in this repository, most installed first. */
  skills: RegistryHit[];
  installs: number;
};

/**
 * Searching skills.sh, which indexes skills across GitHub.
 *
 * A hit names a repository rather than a package of its own, so it becomes an
 * ordinary watched source — which is also why the button says so. Everything
 * downstream is unaffected, and a library built this way keeps working if the
 * registry ever goes away.
 *
 * Results are grouped by repository because that is what watching acts on:
 * one search often returns a dozen skills from the same place.
 */
export function RegistrySearch() {
  const catalog = useDiscover((store) => store.catalog);
  const addSource = useDiscover((store) => store.addSource);
  const busy = useDiscover((store) => store.busy);

  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [searching, setSearching] = useState(false);

  const search = async () => {
    if (query.trim() === "") return;
    setSearching(true);
    const result = await commands.searchRegistry(query);
    setSearching(false);

    if (result.status === "error") {
      reportError(result.error);
      return;
    }
    setGroups(group(result.data));
  };

  const watched = (repoUrl: string) => catalog.sources.some((source) => source.repoUrl === repoUrl);

  return (
    <section className={styles.source}>
      <div className={styles.toolbar} style={{ padding: "0 0 10px" }}>
        <input
          className={styles.input}
          value={query}
          placeholder="Search skills.sh — 57,000 skills indexed from GitHub"
          aria-label="Search the skills.sh registry"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
        />
        <button
          type="button"
          className={styles.primary}
          disabled={searching || query.trim() === ""}
          onClick={() => void search()}
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {groups !== null && groups.length === 0 && (
        <p className={paneStyles.fieldHint}>Nothing matches that.</p>
      )}

      {groups !== null && groups.length > 0 && (
        <>
          <p className={paneStyles.fieldHint}>
            Each result is a repository. Watching one clones it, lists everything installable in it,
            and records the commit — so what you install from it can be updated and put back later,
            whatever happens to the registry.
          </p>
          <div className={styles.grid} style={{ marginTop: 10 }}>
            {groups.slice(0, SHOWN_REPOS).map((entry) => (
              <article key={entry.source} className={styles.card}>
                <div className={styles.cardHead}>
                  <span className={styles.cardName}>{repoLabel(entry.repoUrl)}</span>
                  <span className={styles.typePill}>
                    <Icon name="download" size={10} /> {formatInstalls(entry.installs)}
                  </span>
                </div>
                <p className={styles.description}>
                  {entry.skills
                    .slice(0, 6)
                    .map((skill) => skill.name)
                    .join(" · ")}
                  {entry.skills.length > 6 && ` · and ${entry.skills.length - 6} more`}
                </p>
                <div className={styles.cardFoot}>
                  <span className={styles.subpath}>
                    {entry.skills.length} matching {entry.skills.length === 1 ? "skill" : "skills"}
                  </span>
                  {watched(entry.repoUrl) ? (
                    <span className={styles.typePill}>watched</span>
                  ) : (
                    <button
                      type="button"
                      className={styles.install}
                      disabled={busy !== null}
                      onClick={() => void addSource(entry.repoUrl, "", "")}
                    >
                      Watch
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** One card per repository, busiest first. */
function group(hits: RegistryHit[]): Group[] {
  const byRepo = new Map<string, Group>();

  for (const hit of hits) {
    const existing = byRepo.get(hit.source);
    if (existing) {
      existing.skills.push(hit);
      existing.installs = Math.max(existing.installs, hit.installs);
    } else {
      byRepo.set(hit.source, {
        source: hit.source,
        repoUrl: hit.repoUrl,
        skills: [hit],
        installs: hit.installs,
      });
    }
  }

  const groups = [...byRepo.values()];
  for (const entry of groups) entry.skills.sort((a, b) => b.installs - a.installs);
  return groups.sort((a, b) => b.installs - a.installs);
}

function formatInstalls(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k`;
  return String(count);
}
