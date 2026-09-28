import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // macOS writes an AppleDouble "._" sidecar beside every file on
    // filesystems such as exFAT. They are binary and would fail to parse.
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
