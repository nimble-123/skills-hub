import { type MouseEvent, useEffect, useRef, useState } from "react";
import changelogSource from "../../../CHANGELOG.md?raw";
import {
  type Change,
  formatDate,
  parseChangelog,
  type Release,
  type Section,
  splitSections,
  summarise,
} from "../../lib/changelog";
import { openExternal } from "../../lib/external";
import { Icon } from "../common/Icon";
import styles from "./WhatsNew.module.css";

/** Parsed once; the file is part of the bundle and cannot change under us. */
const RELEASES: Release[] = parseChangelog(changelogSource);

const RELEASES_URL = "https://github.com/nimble-123/skills-hub/releases";

/** Older releases listed before "show more": enough to scan, few enough to scroll. */
const PAGE = 8;

type WhatsNewProps = {
  open: boolean;
  onClose: () => void;
  installedVersion: string;
  commit: string;
  /** Defaults to the bundled changelog; tests hand in their own. */
  releases?: Release[];
};

/**
 * The changelog, as a dialog.
 *
 * The newest release is laid out in full, because that is what someone
 * clicking the version wants to know. Everything older is one folded row per
 * release, and only a page of those at first: a changelog that grows for
 * years still opens as quickly and reads as easily as it does today.
 */
export function WhatsNew({
  open,
  onClose,
  installedVersion,
  commit,
  releases = RELEASES,
}: WhatsNewProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  }, [open]);

  // A click that lands on the dialog itself, not its content, is on the backdrop.
  const clickAway = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes a modal dialog natively
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="whats-new-title"
      onClose={onClose}
      onClick={clickAway}
    >
      {open && (
        <Contents
          onClose={onClose}
          installedVersion={installedVersion}
          commit={commit}
          releases={releases}
        />
      )}
    </dialog>
  );
}

/** Only drawn while open, so a closed dialog holds no DOM and reopens fresh. */
function Contents({
  onClose,
  installedVersion,
  commit,
  releases,
}: Omit<WhatsNewProps, "open" | "releases"> & { releases: Release[] }) {
  const [shown, setShown] = useState(PAGE);
  const [latest, ...older] = releases;
  const hidden = older.length - shown;

  return (
    <div className={styles.frame}>
      <header className={styles.header}>
        <div>
          <h2 id="whats-new-title" className={styles.title}>
            What’s new
          </h2>
          <p className={styles.subtitle}>
            You’re on <strong>{installedVersion}</strong> ·{" "}
            <span className={styles.mono}>{commit}</span>
          </p>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>

      <div className={styles.body}>
        {latest ? (
          <LatestRelease release={latest} installed={latest.version === installedVersion} />
        ) : (
          <p className={styles.empty}>No releases are recorded in this build.</p>
        )}

        {older.length > 0 && (
          <section aria-labelledby="whats-new-earlier">
            <h3 id="whats-new-earlier" className={styles.earlierTitle}>
              Earlier releases
            </h3>
            <ul className={styles.earlier}>
              {older.slice(0, shown).map((release) => (
                <li key={release.version}>
                  <OlderRelease
                    release={release}
                    installed={release.version === installedVersion}
                  />
                </li>
              ))}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                className={styles.more}
                onClick={() => setShown((n) => n + PAGE)}
              >
                Show {Math.min(hidden, PAGE)} older{" "}
                {Math.min(hidden, PAGE) === 1 ? "release" : "releases"}
                <span className={styles.moreCount}>{hidden} left</span>
              </button>
            )}
          </section>
        )}
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.link} onClick={() => openExternal(RELEASES_URL)}>
          All releases on GitHub ↗
        </button>
      </footer>
    </div>
  );
}

function LatestRelease({ release, installed }: { release: Release; installed: boolean }) {
  const { main, other } = splitSections(release);
  const otherCount = other.reduce((n, s) => n + s.changes.length, 0);

  return (
    <article className={styles.latest} aria-label={`Release ${release.version}`}>
      <div className={styles.latestHead}>
        <span className={styles.latestVersion}>{release.version}</span>
        {installed && <span className={styles.badge}>This version</span>}
        <ReleaseDate release={release} />
      </div>
      {main.map((section) => (
        <SectionList key={section.title} section={section} />
      ))}
      {main.length === 0 && other.length > 0 && (
        <p className={styles.quiet}>No changes to the application itself in this release.</p>
      )}
      {other.length > 0 && (
        <details className={styles.fold}>
          <summary className={styles.foldSummary}>
            <Icon name="chevron-down" className={styles.chevron} />
            {otherCount} more {otherCount === 1 ? "change" : "changes"} to{" "}
            {other.map((s) => s.title.toLowerCase()).join(", ")}
          </summary>
          {other.map((section) => (
            <SectionList key={section.title} section={section} />
          ))}
        </details>
      )}
    </article>
  );
}

function OlderRelease({ release, installed }: { release: Release; installed: boolean }) {
  const { main, other } = splitSections(release);
  return (
    <details className={styles.row}>
      <summary className={styles.rowSummary}>
        <Icon name="chevron-down" className={styles.chevron} />
        <span className={styles.rowVersion}>{release.version}</span>
        {installed && <span className={styles.badge}>This version</span>}
        <span className={styles.rowCounts}>{summarise(release)}</span>
        <ReleaseDate release={release} />
      </summary>
      <div className={styles.rowBody}>
        {[...main, ...other].map((section) => (
          <SectionList key={section.title} section={section} />
        ))}
      </div>
    </details>
  );
}

function ReleaseDate({ release }: { release: Release }) {
  const date = formatDate(release.date);
  if (!date || !release.date) return null;
  return (
    <time className={styles.date} dateTime={release.date}>
      {date}
    </time>
  );
}

function SectionList({ section }: { section: Section }) {
  return (
    <section className={styles.section} data-kind={section.kind}>
      <h4 className={styles.sectionTitle}>{section.title}</h4>
      <ul className={styles.changes}>
        {section.changes.map((change) => (
          <ChangeRow key={`${change.commit?.sha ?? ""}${change.text}`} change={change} />
        ))}
      </ul>
    </section>
  );
}

function ChangeRow({ change }: { change: Change }) {
  const ref = change.pr
    ? {
        label: `#${change.pr.number}`,
        url: change.pr.url,
        what: `pull request ${change.pr.number}`,
      }
    : change.commit
      ? { label: change.commit.sha, url: change.commit.url, what: `commit ${change.commit.sha}` }
      : null;

  return (
    <li className={styles.change}>
      <span className={styles.changeText}>
        {change.scope && <span className={styles.scope}>{change.scope}</span>}
        {sentence(change.text)}
      </span>
      {ref && (
        <button
          type="button"
          className={styles.ref}
          title={`Open ${ref.what} on GitHub`}
          aria-label={`Open ${ref.what} on GitHub`}
          onClick={() => openExternal(ref.url)}
        >
          {ref.label}
        </button>
      )}
    </li>
  );
}

/** Commit subjects start lower-case; a list reads better when they do not. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
