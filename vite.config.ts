import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri drives the dev server; it needs a fixed port and must fail loudly
// rather than silently moving to another one.
// The pages live in src/ beside the code they load, so src/ is the root and the
// repository's own root holds no HTML. URLs are unchanged: /, /popover.html.
export default defineConfig({
  root: "src",
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
    // Outside the root, where tauri.conf.json's frontendDist looks for it.
    outDir: "../dist",
    emptyOutDir: true,
    // Two pages, because the menubar popover is a second webview. Sharing one
    // bundle would make it load the whole window shell to show a search field.
    rollupOptions: {
      input: {
        // fileURLToPath, not `.pathname`: this checkout's path has a space in
        // it, which `.pathname` percent-encodes into a file that is not there.
        main: fileURLToPath(new URL("./src/index.html", import.meta.url)),
        popover: fileURLToPath(new URL("./src/popover.html", import.meta.url)),
      },
    },
    target: "esnext",
    // Only for `tauri dev`. A release bundle would otherwise carry tens of
    // megabytes of maps for grammars nobody is going to debug.
    sourcemap: process.env.TAURI_ENV_DEBUG === "true",
  },
});
