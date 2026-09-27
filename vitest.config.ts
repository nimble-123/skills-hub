import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // This checkout sits on exFAT, where macOS writes an AppleDouble "._"
    // sidecar beside every file. They are binary and would fail to parse.
    exclude: ["**/node_modules/**", "**/._*"],
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/._*"],
          environment: "node",
        },
      },
      {
        test: {
          name: "ui",
          include: ["src/**/*.test.tsx"],
          exclude: ["**/._*"],
          environment: "jsdom",
          setupFiles: ["src/test/setup.ts"],
        },
      },
    ],
  },
});
