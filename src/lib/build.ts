/**
 * Which build this is, as the sidebar and the settings show it.
 *
 * The commit label comes from `build.rs`: a short SHA, the same with `-dirty`
 * when the tree had uncommitted changes, or `unknown` when git could not be
 * asked.
 */

const REPOSITORY = "https://github.com/nimble-123/skills-hub";

const SHA = /^([0-9a-f]{7,40})(-dirty)?$/;

/** `0.5.0` and `53580a7` → `v0.5.0 · 53580a7`. */
export function formatBuild(version: string, commit: string): string {
  return `v${version} · ${commit}`;
}

/**
 * The commit's page on GitHub, or null when there is nothing to link to.
 *
 * A dirty build still links to the commit it started from: that is the
 * nearest thing to it anyone else can look at.
 */
export function commitUrl(commit: string): string | null {
  const match = SHA.exec(commit);
  return match ? `${REPOSITORY}/commit/${match[1]}` : null;
}
