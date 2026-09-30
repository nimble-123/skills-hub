import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The build the screenshots are taken from.
 *
 * The same components, the same stylesheet — only the modules that talk to
 * the host are swapped, so what is captured is the real interface rather than
 * a mock-up of it.
 */
function swapHostModules(): Plugin {
  // Absolute paths, so they resolve the same whatever the root is.
  const mockBindings = fileURLToPath(new URL("./src/demo/mockBindings.ts", import.meta.url));
  const tauriStubs = fileURLToPath(new URL("./src/demo/tauriStubs.ts", import.meta.url));
  const swaps: Array<[RegExp, string]> = [
    [/\/src\/bindings\.ts$/, mockBindings],
    [/^@tauri-apps\/api\/core$/, tauriStubs],
    [/^@tauri-apps\/plugin-dialog$/, tauriStubs],
    [/^@tauri-apps\/api\/event$/, tauriStubs],
    [/^@tauri-apps\/api\/window$/, tauriStubs],
    [/^@tauri-apps\/plugin-opener$/, tauriStubs],
  ];

  return {
    name: "skills-hub:fixtures",
    enforce: "pre",
    async resolveId(source, importer, options) {
      for (const [pattern, replacement] of swaps) {
        // Bare specifiers match as written; a relative import has to be
        // resolved first, since every file reaches bindings.ts by a
        // different number of `../`.
        if (pattern.source.startsWith("^")) {
          if (pattern.test(source)) return this.resolve(replacement, importer, options);
          continue;
        }
        const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
        if (resolved && pattern.test(resolved.id)) {
          return this.resolve(replacement, importer, options);
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  // Like the application's own config: the pages live in src/.
  root: "src",
  plugins: [swapHostModules(), react()],
  server: { port: 1421, strictPort: true },
  build: {
    rollupOptions: { input: fileURLToPath(new URL("./src/demo.html", import.meta.url)) },
    outDir: "../dist-demo",
    emptyOutDir: true,
    sourcemap: false,
  },
});
