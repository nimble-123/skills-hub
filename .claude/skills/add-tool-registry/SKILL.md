---
name: add-tool-registry
description: Use when adding an AI coding tool (Claude Code, Cursor, etc.) to the tool registry. Paths and behaviour live in crates/core/src/tools.rs; the display name, icon and brand mark live separately in src/toolMeta.ts. Only toolMeta.test.ts notices when the two lists disagree.
---

# Adding a tool to the registry

The registry is deliberately split: `crates/core/src/tools.rs` knows paths
and behaviour, `src/toolMeta.ts` knows how it is presented. Nothing keeps
them in step but a test.

1. In `crates/core/src/tools.rs`, inside `build()`, add an entry:

   ```rust
   Tool::new("<kebab-id>")
       .paths(&[(Skill, "~/.example/skills"), (Agent, "~/.example/agents")])
       .done(),
   ```

   Only paths confirmed from the tool's own docs or behaviour go in
   `.paths()`; anything plausible but unverified goes in `.unconfirmed()`
   instead — it is offered in the tool editor but never scanned. Other
   builder methods available as needed: `.project_paths()`, `.single_file_rule()`,
   `.plugins_registry()`, `.plugins_settings_path()`, `.built_in_dirnames()`,
   `.mcp_config_path()`, `.mcp_config_format()`. Every chain ends `.done()`.

2. In `src/toolMeta.ts`, add the same id as a key of `TOOL_META`:

   ```ts
   "<kebab-id>": { label: "<Display Name>", icon: "<lucide-icon-name>" },
   ```

   `icon` must be a real `lucide-react` icon name in kebab-case (falls back to
   it whenever there is no brand mark). For a brand mark, add `svg` instead of
   or alongside `icon` — it must use `fill="currentColor"` and no hard-coded
   colour, so the mark stays monochrome across palettes.

3. The id must match exactly: `toolMeta.test.ts` reads `tools.rs` with a
   regex over `Tool::new("...")` calls and compares the sorted id list against
   `Object.keys(TOOL_META)`.

## Check

```sh
pnpm vitest run src/toolMeta.test.ts
```

Passes when the id sets match exactly, every tool has a non-empty label and
icon, and every `svg` is monochrome (`currentColor`, no `fill="#..."`).
