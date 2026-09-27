import { describe, expect, it } from "vitest";
import { highlight } from "./highlight";

/**
 * Highlighting is decoration, so what matters is that it never gets in the
 * way: an unknown language falls back rather than throwing, and the output is
 * markup we generated, not markup that came out of the file.
 */
describe("highlighting", () => {
  it("highlights a language it has a grammar for", async () => {
    const html = await highlight("SELECT * FROM users;", "sql");
    expect(html).toContain("<pre");
    expect(html).toContain("SELECT");
  });

  it("renders both themes, so switching is a CSS change", async () => {
    const html = await highlight("const x = 1;", "typescript");
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
  });

  it.each([
    ["sh", "bash"],
    ["py", "python"],
    ["yml", "yaml"],
    ["ts", "typescript"],
  ])("understands %s as %s", async (alias) => {
    expect(await highlight("x", alias)).not.toBeNull();
  });

  it("gives up quietly on a language it does not have", async () => {
    expect(await highlight("int main() {}", "brainfuck")).toBeNull();
    expect(await highlight("plain words", "")).toBeNull();
    expect(await highlight("plain words", "text")).toBeNull();
  });

  it("escapes what came out of the file", async () => {
    const html = await highlight('const a = "<img src=x onerror=alert(1)>";', "javascript");
    expect(html).not.toContain("<img");
    expect(html).toContain("&#x3C;img");
  });
}, 30_000);
