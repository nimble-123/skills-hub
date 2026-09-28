---
name: add-theme-palette
description: Use when adding a new theme palette (colour scheme) to the application. The palette id lives in a Rust enum, is exported to TypeScript, listed in a TS dropdown, and defined as a CSS block — four places across three files. No single test checks all of it; theme.test.ts and the bindings test each cover part.
---

# Adding a theme palette

The id has to be spelled identically in four places: the Rust enum, the
generated TypeScript type, the dropdown list, and the CSS block. Follow this
order so each step can be checked before the next.

1. **`crates/core/src/settings.rs`** — add a variant to `pub enum ThemePref`.
   `#[serde(rename_all = "kebab-case")]` on the enum turns most variant names
   into their id automatically (`HorizonEvening` → `"horizon-evening"`); add
   an explicit `#[serde(rename = "...")]` on the variant only where the
   automatic form would be wrong (e.g. `Synthwave84` needed
   `#[serde(rename = "synthwave-84")]`).

2. **Regenerate bindings**: `cargo test -p skills-hub export_typescript_bindings`.
   This adds the new literal to the `ThemePref` union in `src/bindings.ts`.

3. **`src/lib/theme.ts`** — add `{ id, label, appearance }` to the appropriate
   group's `themes` array in `THEME_GROUPS`. `id` must be exactly the
   serialised string from step 1 (TypeScript enforces this: `ThemeChoice.id`
   is typed as `Exclude<ThemePref, "system">`, so a mismatched id fails
   `pnpm typecheck` rather than silently doing nothing). `appearance` is
   `"light"` or `"dark"` — it drives `data-appearance`, which anything that
   only cares about light-vs-dark reads instead of the palette name.

4. **`src/styles/themes.css`** — add a `:root[data-theme="<id>"] { … }` block.
   Copy an existing block (e.g. `solarized-light`) as the template: every
   custom property another palette sets, this one must set too, or the
   missing ones fall through to `:root`'s light-mode default.

## Check

```sh
pnpm vitest run src/lib/theme.test.ts
cargo test -p skills-hub export_typescript_bindings && git diff --exit-code src/bindings.ts
```

The first fails if the id has no CSS block, if `appearanceOf` disagrees with
what you declared, or if an id is duplicated. The second fails if the Rust
enum and the generated TypeScript type have drifted.

Note: nothing checks the reverse — that every `ThemePref` variant is actually
offered in `THEME_GROUPS`. A palette added to the Rust enum but never added to
`theme.ts` compiles and passes every test; it is just unreachable from the
dropdown.
