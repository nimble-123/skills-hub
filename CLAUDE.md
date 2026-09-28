# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Tauri desktop application that manages the skills, agents, commands and rules
AI coding tools keep in a dozen folders. It acts on the real folders — enabling
moves the file, linking makes a symlink — so a mistake here costs someone their
files rather than a redraw.

Three layers, dependencies pointing inwards only:

| Layer | Where | Knows about |
| --- | --- | --- |
| UI | `src/` | the generated bindings, and nothing else |
| Adapter | `src-tauri/` | Tauri and the domain |
| Domain | `crates/core/` | neither of the above |

`deny.toml` bans `tauri` from the domain crate, so the boundary is enforced
rather than agreed, and `crates/cli` is the proof it holds — it links the domain
and nothing else. `$HOME` is injected into the domain rather than read, which is
what makes the scanner testable against temporary directories.

`ARCHITECTURE.md` carries the depth and `SPEC.md` what the application
guarantees on disk. Read them before changing behaviour rather than inferring it
from one file.

## How to work here

- **Lead, do not labour.** Plan the work, split it, review what comes back.
  Hand mechanical parts to cheaper workers when there is genuinely parallel
  labour — not for one file or one edit, where a worker is overhead.
- **One worker, one lane.** Disjoint files per worker. The crates, the frontend
  areas and `docs/` split cleanly; two workers in `src/styles/` do not.
- **Do not overguide a worker.** Outcome, constraints, reason; it picks the
  route. Writing the diff into the prompt means you did not need a worker.
- **IMPORTANT: no progress claim without evidence.** Show the command and what
  it returned. For anything visual, render it and look — the demo build exists
  for that, and visual defects fail no test. Say up front which check must pass
  and what would make you stop, then honour it.
- **Keep this file light.** What the project is, the commands, the known
  mistakes. Procedures belong in `.claude/skills/`, which load on demand.

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

- **`src/bindings.ts` is generated** by tauri-specta from `specta_builder()` in
  `src-tauri/src/lib.rs`, which is also what `main` mounts. Change the Rust and
  regenerate; never hand-edit it.
- **Several lists exist on both sides** — the tool registry, the palettes, the
  fonts, the icons. Adding to one side only still compiles, and a test is what
  notices. `.claude/skills/` holds the procedures.
- **No colour outside `src/styles/`.** There is not one, and eighteen palettes
  depend on that staying true. `data-theme` names the palette; anything that
  only needs "is this dark" reads `data-appearance`.
- **`unwrap`, `expect` and `panic` are `deny`** workspace-wide. Test files opt
  out with `#![allow(clippy::expect_used, clippy::panic)]`.
- **A second window needs its own capability.** `src-tauri/capabilities/` is
  scoped per window label, so the menubar popover has `popover.json`. Leave a
  window out and it builds, starts, and then fails every API call at runtime
  with `not allowed on window "…"` — nothing catches it before you run it.
- **Skip `._*` when walking a directory.** This checkout is on exFAT, where
  macOS writes a binary AppleDouble sidecar beside every file.
- **The pull request title becomes the commit message** on a squash merge, and
  release-please reads it, so it has to be a Conventional Commit. The
  `commit-msg` hook enforces the form locally.
- **Screenshots are generated**, not edited: `pnpm screenshots` drives the demo
  build, which swaps three host modules for fixtures and captures the shipping
  components.
- **`plan.md` is kept by moving closed items out,** not by ticking them off.
