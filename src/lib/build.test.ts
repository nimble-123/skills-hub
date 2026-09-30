import { describe, expect, it } from "vitest";
import { commitUrl, formatBuild } from "./build";

describe("formatting the build", () => {
  it("puts the version and the commit on one line", () => {
    expect(formatBuild("0.5.0", "53580a7")).toBe("v0.5.0 · 53580a7");
  });

  it("keeps a dirty or unknown commit as it is", () => {
    expect(formatBuild("0.5.0", "53580a7-dirty")).toBe("v0.5.0 · 53580a7-dirty");
    expect(formatBuild("0.5.0", "unknown")).toBe("v0.5.0 · unknown");
  });
});

describe("linking the commit", () => {
  it("links a clean build to its commit", () => {
    expect(commitUrl("53580a7")).toBe("https://github.com/nimble-123/skills-hub/commit/53580a7");
  });

  it("links a dirty build to the commit it started from", () => {
    expect(commitUrl("53580a7-dirty")).toBe(
      "https://github.com/nimble-123/skills-hub/commit/53580a7",
    );
  });

  it("has nothing to link when the commit is unknown or not a SHA", () => {
    expect(commitUrl("unknown")).toBeNull();
    expect(commitUrl("")).toBeNull();
    expect(commitUrl("53580a7; rm -rf")).toBeNull();
  });
});
