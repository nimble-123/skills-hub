# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tauri desktop application that manages the skills, agents, commands and rules
that AI coding tools keep in a dozen different folders. It works on those real
folders — enabling an item moves the file, linking one makes a symlink — so
every action has to be correct on disk, not merely in the interface.

Three layers, dependencies pointing inwards only:

| Layer | Where | Knows about |
| --- | --- | --- |
| UI | `src/` | the generated bindings, and nothing else |
| Adapter | `src-tauri/` | Tauri and the domain |
| Domain | `crates/core/` | neither of the above |

The boundary is enforced rather than trusted: `deny.toml` bans `tauri` as a
dependency of the domain crate. `crates/cli` drives the same domain from a
terminal and is the proof the decoupling is real — if it stops compiling,
something leaked. `$HOME` is injected into the domain rather than read, which
is what lets the scanner be tested against temporary directories.

## How to work here

**Lead, do not labour.** Plan the work, split it, review what comes back and
keep it coherent. Hand the mechanical parts to cheaper workers — but only when
there is genuinely parallel labour to hand over. One file, one edit, one
question: do it yourself; a worker there is overhead.

**One worker, one lane.** Each worker owns a set of files no other worker
touches. The crates, the frontend areas and `docs/` split cleanly; two workers
in `src/styles/` do not.

**Do not overguide a worker.** Give it the outcome, the constraints and the
reason, then let it choose the route. If you find yourself writing the diff
into the prompt, you did not need a worker.

**No progress claim without evidence.** Run the command and show what it said.
For anything visual, render it and look — the demo build exists so that the
real components can be captured headlessly, and defects there fail no test.
Before starting, write down the check that has to pass and the condition that
makes you stop and ask; then honour it. "Should work" is not a result.

**Keep this file light.** What the project is, the commands, the known
mistakes. Everything else belongs in the code, in `plan.md`, or nowhere.

## Commands

```bash
pnpm install
pnpm tauri dev                  # the app
pnpm tauri build                # .app and .dmg, or the platform equivalent

cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt

pnpm test                       # vitest
pnpm typecheck
pnpm check                      # biome, read-only · pnpm fix writes
```

A single test:

```bash
cargo test -p skills-core --test settings                  # one file
cargo test -p skills-core --test settings a_theme_written  # one test
pnpm vitest run src/lib/theme.test.ts
pnpm vitest run -t "resolving the theme"
```

Generated files — the output of each is committed, and a test fails on drift:

```bash
cargo test -p skills-hub        # src/bindings.ts
pnpm icons                      # src/components/common/icons.ts
pnpm fonts                      # src/fonts/ and src/styles/fonts.css
pnpm screenshots                # docs/images/, incl. the palette gallery
```

`lefthook` runs fmt, clippy, biome and typecheck on commit; on push,
`cargo test --workspace` and a `git diff --exit-code src/bindings.ts`.

## Known mistakes

- **Hand-editing `src/bindings.ts`.** tauri-specta writes it from
  `specta_builder()` in `src-tauri/src/lib.rs`, which is also what `main`
  mounts. Change the Rust, then regenerate.
- **Adding a tool, an icon, a palette or a font on one side only.**
  `src/toolMeta.ts` mirrors the registry in `crates/core/src/tools.rs`;
  `themes.css` and the generated `fonts.css` mirror the lists in
  `src/lib/theme.ts` and `src/lib/fonts.ts`. A test reads the other side in
  each case, so run them rather than eyeballing it.
- **Writing a colour anywhere but `src/styles/`.** There is not one outside it,
  and eighteen palettes depend on that staying true. `data-theme` names the
  palette; anything that only needs "is this dark" reads `data-appearance`, so
  it does not grow a case per theme.
- **Taking `unwrap`, `expect` or `panic` for granted.** All three are `deny` at
  workspace level. Test files opt out with
  `#![allow(clippy::expect_used, clippy::panic)]`.
- **Walking a directory without skipping `._*`.** This checkout lives on exFAT,
  where macOS writes a binary AppleDouble sidecar beside every file. They break
  any script that reads what it finds; `scripts/generate-icons.mjs` and
  `vitest.config.ts` already skip them.
- **Treating the pull request title as a label.** A squash merge makes it the
  commit message on `main`, and release-please reads that, so it has to be a
  Conventional Commit. Rebase merges are allowed too, and then every commit
  message stands on its own. The `commit-msg` hook enforces the form locally.
- **Editing the screenshots by hand.** `vite.demo.config.ts` swaps exactly
  three host modules for fixtures, so `pnpm screenshots` captures the shipping
  components. `docs/index.html` is one hand-written file with no build step.
- **Tidying `plan.md` by ticking things off.** It says at the top how it is
  kept: closed items move out rather than down, because the history is in git.
