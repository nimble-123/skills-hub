/** Reading what someone pasted. */

export type ParsedRepo = {
  repoUrl: string;
  refName: string;
  subpath: string;
};

/**
 * Splits a GitHub URL into the three things an install needs.
 *
 * People paste what is in the address bar, which for a subfolder is
 * `…/tree/<branch>/<path>`. Pulling the branch and the path out of it is the
 * difference between one field to fill in and three.
 */
export function parseGitHubUrl(raw: string): ParsedRepo | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  const match = /^(https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+?)(?:\.git)?(?:\/(.*))?$/.exec(
    trimmed,
  );
  if (!match) {
    // Not a GitHub URL, but git can clone plenty of other things.
    return { repoUrl: trimmed.replace(/\/$/, ""), refName: "", subpath: "" };
  }

  const repoUrl = match[1] as string;
  const rest = match[2] ?? "";
  const tree = /^tree\/([^/]+)(?:\/(.*))?$/.exec(rest);
  if (!tree) return { repoUrl, refName: "", subpath: "" };

  return {
    repoUrl,
    refName: tree[1] as string,
    subpath: (tree[2] ?? "").replace(/\/$/, ""),
  };
}

/** `owner/repo`, for showing which repository something came from. */
export function repoLabel(repoUrl: string): string {
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/.exec(repoUrl);
  if (match?.[1]) return match[1];
  return (
    repoUrl
      .replace(/\.git$/, "")
      .split("/")
      .slice(-2)
      .join("/") || repoUrl
  );
}
