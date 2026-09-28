---
name: add-bundled-font
description: Use when adding a new bundled typeface (UI or monospace font) to the application. The procedure spans an npm package, a generator script's family list, a Rust enum, and a TS list — four places across four files, regenerating a committed CSS file along the way.
---

# Adding a bundled font

1. **Install the package**: `pnpm add -D @fontsource-variable/<name>` (a
   variable-weight family — preferred), or `@fontsource/<name>` for a family
   that only ships fixed weights.

2. **`scripts/sync-fonts.mjs`** — add an entry to the `FAMILIES` array:

   ```js
   { id: "<kebab-id>", role: "ui" | "mono", name: "<Family> Variable", pkg: "@fontsource-variable/<name>" },
   ```

   Add `weights: [400, 600, ...]` only for a static (non-variable) package —
   it changes which files `sourceFiles()` looks for. `id` is what everything
   else keys on; it must be kebab-case.

3. **Regenerate**: `pnpm fonts`. This copies the Latin and Latin Extended
   `.woff2` files into `src/fonts/`, rewrites `src/styles/fonts.css` (an
   `@font-face` block per file plus a `:root[data-font-ui="<id>"]` or
   `data-font-mono` stack rule), and rewrites `src/fonts/LICENSES.md`. All
   three are committed.

4. **`crates/core/src/settings.rs`** — add a variant to `pub enum UiFont` (for
   `role: "ui"`) or `pub enum MonoFont` (for `role: "mono"`).
   `#[serde(rename_all = "kebab-case")]` on the enum covers most names
   automatically; add an explicit `#[serde(rename = "...")]` on the variant
   where the automatic form is wrong (e.g. `JetBrainsMono` needed
   `#[serde(rename = "jetbrains-mono")]` — kebab-case alone would have made
   `jet-brains-mono`).

5. **Regenerate bindings**: `cargo test -p skills-hub export_typescript_bindings`.

6. **`src/lib/fonts.ts`** — add `{ id, label }` to `UI_FONTS` or `MONO_FONTS`
   (matching the enum you edited). `id` must equal the serialised value from
   step 4, which is also the id `pnpm fonts` used in `fonts.css`.

## Check

```sh
pnpm vitest run src/lib/fonts.test.ts
cargo test -p skills-hub export_typescript_bindings && git diff --exit-code src/bindings.ts
```

The first fails if the font has no CSS stack, no `@font-face`, or no
`unicode-range`. The second fails if the Rust enum and the generated
TypeScript type have drifted.

Note: as with themes, nothing checks the reverse — a variant added to
`UiFont`/`MonoFont` but never added to `fonts.ts` compiles and passes every
test; it is just unreachable from the picker.
