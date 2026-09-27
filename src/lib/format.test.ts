import { describe, expect, it } from "vitest";
import { estimateTokens, formatBytes, formatDate } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1024 * 1024, "1.0 MB"],
  ])("formats %i as %s", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("estimateTokens", () => {
  it("rounds to a readable figure", () => {
    expect(estimateTokens(400)).toBe("~100");
    expect(estimateTokens(8000)).toBe("~2.0k");
  });
});

describe("formatDate", () => {
  it("says so rather than showing a broken date", () => {
    expect(formatDate(null)).toBe("unknown");
    expect(formatDate("not a date")).toBe("unknown");
  });

  it("renders a real timestamp", () => {
    expect(formatDate("2026-03-14T09:00:00Z")).toMatch(/2026/);
  });
});
