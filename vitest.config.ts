import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // This checkout sits on exFAT, where macOS writes an AppleDouble "._"
    // sidecar beside every file. They are binary and would fail to parse.
    exclude: ["**/node_modules/**", "**/._*"],
    environment: "node",
  },
});
