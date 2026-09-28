---
name: add-tauri-command
description: Use when adding a new Tauri command (an IPC endpoint the frontend calls into Rust). The procedure touches the domain crate, the src-tauri adapter, and the generated TypeScript bindings, in that order — miss the registration step and the command compiles but is silently unreachable from the frontend.
---

# Adding a Tauri command

Three layers, in order. Each command already in `src-tauri/src/commands/` is a
worked example — copy the shape of a neighbour in the same file rather than
inventing one.

1. **Domain logic**, only if the command makes a decision rather than just
   reading state. Add it to the matching module in `crates/core/src/`, tested
   there directly against `CoreError`. Pure adapter work (resolving a path,
   reading `State`) skips this step.

2. **Adapter.** Add a `#[tauri::command]` `#[specta::specta]` function to the
   file in `src-tauri/src/commands/` for that area (`tools.rs`, `settings.rs`,
   `items.rs`, …). Take owned arguments plus `State<'_, AppState>` if it needs
   shared state (see `crate::commands::lock` for locking a mutex inside
   `AppState`). Return `CommandResult<T>` (`= Result<T, CommandError>`,
   defined in `src-tauri/src/error.rs`) unless the command truly cannot fail —
   `?` converts a `CoreError` automatically via the `From` impl there; use
   `CommandError::new("code", "message")` for adapter-only failures.

3. **Register it.** Add `commands::<module>::<fn_name>,` to the
   `collect_commands![...]` list inside `specta_builder()` in
   `src-tauri/src/lib.rs`. This is the one list `main` mounts
   (`builder.invoke_handler()`) and the bindings test exports from — a command
   left out of it cannot be invoked and never appears in `bindings.ts`, with
   nothing else flagging the omission.

4. **Regenerate the bindings**: `cargo test -p skills-hub export_typescript_bindings`.
   This rewrites `src/bindings.ts`, adding a camelCase entry (e.g.
   `probe_capabilities` → `probeCapabilities`) to `export const commands`,
   carrying over the function's doc comment.

5. **Call it from the frontend** as `commands.<camelCaseName>(...)`. It
   resolves to `{ status: "ok", data: T } | { status: "error", error:
   CommandError }`. Stores follow the `accept(result)` pattern — check
   `result.status`, call `reportError(result.error)` from `src/stores/errors.ts`
   on failure — see `src/stores/settings.ts` for the pattern.

## Check

```sh
cargo test -p skills-hub export_typescript_bindings && git diff --exit-code src/bindings.ts
pnpm typecheck
```

The first regenerates the bindings and fails if the working tree then
differs — the same check `lefthook` runs on push. The second fails if the
frontend calls a command with the wrong name or argument shape.
