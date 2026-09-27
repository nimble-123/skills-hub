import { describe, expect, it } from "vitest";
import { parseGitHubUrl, repoLabel } from "./github";

describe("reading a pasted URL", () => {
  it("takes a plain repository URL", () => {
    expect(parseGitHubUrl("https://github.com/acme/skills")).toEqual({
      repoUrl: "https://github.com/acme/skills",
      refName: "",
      subpath: "",
    });
  });

  it("drops a trailing .git or slash", () => {
    for (const url of ["https://github.com/acme/skills.git", "https://github.com/acme/skills/"]) {
      expect(parseGitHubUrl(url)?.repoUrl).toBe("https://github.com/acme/skills");
    }
  });

  /** What the address bar gives you when browsing a subfolder. */
  it("splits a tree URL into branch and path", () => {
    expect(parseGitHubUrl("https://github.com/acme/skills/tree/main/packs/writing")).toEqual({
      repoUrl: "https://github.com/acme/skills",
      refName: "main",
      subpath: "packs/writing",
    });
  });

  it("handles a tree URL with no path after the branch", () => {
    expect(parseGitHubUrl("https://github.com/acme/skills/tree/next")).toEqual({
      repoUrl: "https://github.com/acme/skills",
      refName: "next",
      subpath: "",
    });
  });

  it("passes through something that is not GitHub, since git can clone it", () => {
    expect(parseGitHubUrl("git@example.invalid:team/skills.git")).toEqual({
      repoUrl: "git@example.invalid:team/skills.git",
      refName: "",
      subpath: "",
    });
  });

  it("rejects nothing at all", () => {
    expect(parseGitHubUrl("   ")).toBeNull();
  });
});

describe("naming a repository", () => {
  it.each([
    ["https://github.com/acme/skills", "acme/skills"],
    ["https://github.com/acme/skills.git", "acme/skills"],
    ["https://gitlab.invalid/team/skills.git", "team/skills"],
  ])("shows %s as %s", (url, expected) => {
    expect(repoLabel(url)).toBe(expected);
  });
});
