import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * The build the screenshots are taken from.
 *
 * The same components, the same stylesheet — only the three modules that
 * talk to the host are swapped, so what is captured is the real interface
 * rather than a mock-up of it.
 */
function swapHostModules(): Plugin {
  const swaps: Array<[RegExp, string]> = [
    [/\/src\/bindings\.ts$/, "/src/demo/mockBindings.ts"],
    [/^@tauri-apps\/api\/core$/, "/src/demo/tauriStubs.ts"],
    [/^@tauri-apps\/plugin-dialog$/, "/src/demo/tauriStubs.ts"],
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
  plugins: [swapHostModules(), react()],
  server: { port: 1421, strictPort: true },
  build: {
    rollupOptions: { input: "demo.html" },
    outDir: "dist-demo",
    sourcemap: false,
  },
});
