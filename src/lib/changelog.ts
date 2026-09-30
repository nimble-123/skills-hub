/**
 * The changelog, read out of `CHANGELOG.md` as release-please writes it.
 *
 * The file is bundled with the application at build time, so the dialog shows
 * the history of the build that is running and needs no network. The format
 * is release-please's own: a `## [version](compare-url) (date)` heading per
 * release, `### Section` headings, and one `* **scope:** text ([#pr](url))
 * ([sha](url))` line per change.
 */

export type SectionKind = "features" | "fixes" | "performance" | "other";

export type Change = {
  scope: string | null;
  text: string;
  /** The pull request it came in, when release-please recorded one. */
  pr: { number: number; url: string } | null;
  commit: { sha: string; url: string } | null;
};

export type Section = {
  title: string;
  kind: SectionKind;
  changes: Change[];
};

export type Release = {
  version: string;
  /** ISO date as written, `2026-09-30`, or null when the heading had none. */
  date: string | null;
  compareUrl: string | null;
  sections: Section[];
};

const RELEASE = /^## \[?([0-9][^\]\s)]*)\]?(?:\(([^)]+)\))?(?:\s+\((\d{4}-\d{2}-\d{2})\))?/;
const SECTION = /^### (.+)$/;
const CHANGE = /^\* (.+)$/;
const SCOPE = /^\*\*([^*:]+):\*\*\s+/;
const LINK = /\s*\(\[([^\]]+)\]\(([^)]+)\)\)\s*$/;

/** Parses the whole file, newest release first, as the file already is. */
export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let release: Release | null = null;
  let section: Section | null = null;

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();

    const heading = RELEASE.exec(line);
    if (heading) {
      const [, version = "", compareUrl, date] = heading;
      const next: Release = {
        version,
        compareUrl: compareUrl ?? null,
        date: date ?? null,
        sections: [],
      };
      releases.push(next);
      release = next;
      section = null;
      continue;
    }
    if (!release) continue;

    const title = SECTION.exec(line)?.[1]?.trim();
    if (title) {
      section = { title, kind: kindOf(title), changes: [] };
      release.sections.push(section);
      continue;
    }

    const change = CHANGE.exec(line)?.[1];
    if (change && section) section.changes.push(parseChange(change));
  }

  return releases.map((r) => ({ ...r, sections: r.sections.filter((s) => s.changes.length > 0) }));
}

function parseChange(body: string): Change {
  let text = body;
  let pr: Change["pr"] = null;
  let commit: Change["commit"] = null;

  // Trailing `([label](url))` groups, peeled off from the end.
  for (let match = LINK.exec(text); match; match = LINK.exec(text)) {
    const [whole, label = "", url = ""] = match;
    if (/^#\d+$/.test(label)) pr = { number: Number(label.slice(1)), url };
    else if (/^[0-9a-f]{7,40}$/.test(label)) commit = { sha: label.slice(0, 7), url };
    text = text.slice(0, text.length - whole.length);
  }

  const scope = SCOPE.exec(text);
  if (scope) text = text.slice(scope[0].length);

  return { scope: scope?.[1] ?? null, text: text.trim(), pr, commit };
}

function kindOf(title: string): SectionKind {
  switch (title.trim().toLowerCase()) {
    case "features":
      return "features";
    case "fixes":
    case "bug fixes":
      return "fixes";
    case "performance":
    case "performance improvements":
      return "performance";
    default:
      return "other";
  }
}

/**
 * Every scope the history uses, most used first, then by name.
 *
 * Scopes are the `(scope)` of a Conventional Commit, which release-please
 * writes as `**scope:**`. Changes without one are not counted here; see
 * `countUnscoped`.
 */
export function scopesOf(releases: Release[]): { scope: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const release of releases) {
    for (const section of release.sections) {
      for (const change of section.changes) {
        if (change.scope) counts.set(change.scope, (counts.get(change.scope) ?? 0) + 1);
      }
    }
  }
  return [...counts]
    .map(([scope, count]) => ({ scope, count }))
    .sort((a, b) => b.count - a.count || a.scope.localeCompare(b.scope));
}

/** How many changes, across the history, were committed without a scope. */
export function countUnscoped(releases: Release[]): number {
  return releases.reduce(
    (n, release) =>
      n +
      release.sections.reduce(
        (m, section) => m + section.changes.filter((change) => change.scope === null).length,
        0,
      ),
    0,
  );
}

/**
 * The release with only the changes in `scope`, or with only those without
 * one when `scope` is null; sections left empty go.
 */
export function withScope(release: Release, scope: string | null): Release {
  return {
    ...release,
    sections: release.sections
      .map((section) => ({
        ...section,
        changes: section.changes.filter((change) => change.scope === scope),
      }))
      .filter((section) => section.changes.length > 0),
  };
}

/** How many changes a release lists, across its sections. */
export function countChanges(release: Release): number {
  return release.sections.reduce((n, section) => n + section.changes.length, 0);
}

const ORDER: Record<SectionKind, number> = { features: 0, fixes: 1, performance: 2, other: 3 };

/**
 * What someone using the application cares about first, and the rest.
 *
 * Features, fixes and performance are theirs; documentation, build and CI are
 * the project's, still there but folded away.
 */
export function splitSections(release: Release): { main: Section[]; other: Section[] } {
  const sorted = [...release.sections].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  return {
    main: sorted.filter((s) => s.kind !== "other"),
    other: sorted.filter((s) => s.kind === "other"),
  };
}

/** `3 features · 4 fixes · 2 other`, short enough for a release's folded row. */
export function summarise(release: Release): string {
  const count = (kind: SectionKind) =>
    release.sections.filter((s) => s.kind === kind).reduce((n, s) => n + s.changes.length, 0);
  const parts = [
    plural(count("features"), "feature"),
    plural(count("fixes"), "fix", "fixes"),
    labelled(count("performance"), "performance"),
    labelled(count("other"), "other"),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "No listed changes";
}

/** A count with a word that does not change with it: `2 performance`. */
function labelled(n: number, word: string): string | null {
  return n === 0 ? null : `${n} ${word}`;
}

function plural(n: number, one: string, many = `${one}s`): string | null {
  if (n === 0) return null;
  return `${n} ${n === 1 ? one : many}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `2026-09-30` → `30 Sep 2026`.
 *
 * Written out by hand rather than through `Intl`: the webview's ICU decides
 * whether September is "Sep" or "Sept", and the same build should read the
 * same on every machine.
 */
export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || !month) return iso;
  return `${Number(match[3])} ${month} ${match[1]}`;
}
