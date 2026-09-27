import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri drives the dev server; it needs a fixed port and must fail loudly
// rather than silently moving to another one.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/target/**"] },
  },
  build: {
    target: "esnext",
    // Only for `tauri dev`. A release bundle would otherwise carry tens of
    // megabytes of maps for grammars nobody is going to debug.
    sourcemap: process.env.TAURI_ENV_DEBUG === "true",
  },
});
