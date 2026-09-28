import { useEffect, useState } from "react";
import type { DiscoverEntry } from "../../bindings";
import { parseGitHubUrl, repoLabel } from "../../lib/github";
import { useDiscover } from "../../stores/discover";
import { useItems } from "../../stores/library";
import { TYPE_META } from "../../toolMeta";
import { Icon } from "../common/Icon";
import paneStyles from "../shell/Pane.module.css";
import styles from "./Discover.module.css";
import { InstallDialog } from "./InstallDialog";
import { RegistrySearch } from "./RegistrySearch";

/** Somewhere to start, for an empty library of sources. */
const STARTERS = [
  { url: "https://github.com/anthropics/skills", hint: "Anthropic's own skills" },
  { url: "https://github.com/obra/superpowers", hint: "A large community collection" },
  { url: "https://github.com/kepano/obsidian-skills", hint: "Obsidian-flavoured skills" },
];

export function DiscoverPane() {
  const { catalog, busy, load, addSource, refreshSource, removeSource } = useDiscover();
  const installed = useItems();
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<DiscoverEntry | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (raw: string) => {
    const parsed = parseGitHubUrl(raw);
    if (!parsed) return;
    if (await addSource(parsed.repoUrl, parsed.refName, parsed.subpath)) setUrl("");
  };

  /** Something already installed from the same place is not offered again. */
  const isInstalled = (entry: DiscoverEntry) =>
    installed.some(
      (item) => item.sourceRepo === entry.repoUrl && item.sourceSubpath === entry.subpath,
    );

  return (
    <div className={paneStyles.pane}>
      <div className={paneStyles.header}>
        <h1 className={paneStyles.title}>
          Discover
          {catalog.entries.length > 0 && (
            <span className={paneStyles.badge}>{catalog.entries.length} available</span>
          )}
        </h1>
        <p className={paneStyles.subtitle}>
          Search the registry, or point this straight at a repository. Either way it is cloned,
          walked for skills, agents, commands and rules, and thrown away again — no account, no
          token, and any host git can reach.
        </p>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          value={url}
          placeholder="https://github.com/owner/repo — or a link to a subfolder"
          aria-label="Repository to watch"
          onChange={(event) => setUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void add(url);
          }}
        />
        <button
          type="button"
          className={styles.primary}
          disabled={busy !== null || url.trim() === ""}
          onClick={() => void add(url)}
        >
          {busy === "new" ? "Cloning…" : "Watch"}
        </button>
      </div>

      <div className={paneStyles.scroll}>
        <RegistrySearch />

        {catalog.sources.length === 0 ? (
          <div>
            <p className={paneStyles.fieldHint}>
              Nothing watched yet. Search above, paste a repository, or start from one of these. A
              link to a subfolder works too — the branch and the path are read out of it.
            </p>
            <div className={styles.starters}>
              {STARTERS.map((starter) => (
                <button
                  key={starter.url}
                  type="button"
                  className={styles.starter}
                  disabled={busy !== null}
                  onClick={() => void add(starter.url)}
                >
                  <span className={styles.starterName}>{repoLabel(starter.url)}</span>
                  <span className={styles.starterHint}>{starter.hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          catalog.sources.map((source) => {
            const entries = catalog.entries.filter((entry) => entry.sourceId === source.id);
            return (
              <section key={source.id} className={styles.source}>
                <div className={styles.sourceHead}>
                  <Icon name="folder-git-2" size={15} />
                  <span className={styles.sourceName}>{repoLabel(source.repoUrl)}</span>
                  <span className={styles.sourceMeta}>
                    {source.subpath && `${source.subpath} · `}
                    {source.refName || "default branch"} · {entries.length} items
                    {source.stars !== null && source.stars !== undefined && ` · ★ ${source.stars}`}
                  </span>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Clone it again and see what changed"
                    aria-label={`Refresh ${repoLabel(source.repoUrl)}`}
                    disabled={busy !== null}
                    onClick={() => void refreshSource(source.id)}
                  >
                    <Icon
                      name="refresh-cw"
                      size={14}
                      className={busy === source.id ? paneStyles.spinning : undefined}
                    />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    title="Stop watching"
                    aria-label={`Stop watching ${repoLabel(source.repoUrl)}`}
                    onClick={() => void removeSource(source.id)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>

                {entries.length === 0 ? (
                  <p className={paneStyles.fieldHint}>Nothing installable found in this one.</p>
                ) : (
                  <div className={styles.grid}>
                    {entries.map((entry) => (
                      <article key={entry.id} className={styles.card}>
                        <div className={styles.cardHead}>
                          <span className={styles.cardName}>{entry.name}</span>
                          <span className={styles.typePill}>{TYPE_META[entry.type].label}</span>
                        </div>
                        {entry.description && (
                          <p className={styles.description}>{entry.description}</p>
                        )}
                        <div className={styles.cardFoot}>
                          <span className={styles.subpath} title={entry.subpath}>
                            {entry.subpath}
                          </span>
                          {isInstalled(entry) ? (
                            <span className={styles.typePill}>installed</span>
                          ) : (
                            <button
                              type="button"
                              className={styles.install}
                              onClick={() => setChosen(entry)}
                            >
                              Install
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {chosen && <InstallDialog entry={chosen} onClose={() => setChosen(null)} />}
    </div>
  );
}
