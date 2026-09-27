//! The tool registry: which tools exist and where each one keeps things.
//!
//! This is source, not data, on purpose. Most of these paths were established by
//! reading a tool's documentation and then checking what is actually on disk, and
//! several are deliberate exceptions that look like mistakes without the reason
//! written beside them. A JSON file cannot hold those reasons; the compiler also
//! cannot check it.
//!
//! Names, icons and brand marks are **not** here — those are presentation and
//! live in `src/toolMeta.ts`. This module knows only paths and behaviour.

use std::sync::LazyLock;

use crate::model::{ItemType, McpConfigFormat, ToolConfig, TypePaths};

use ItemType::{Agent, Command, Rule, Skill};

/// The tools shipped with the application.
///
/// Read fresh from here on every start. User changes are stored as a separate
/// overlay (see `settings`), never as a copy of this list — otherwise a stale
/// copy on disk would shadow a corrected path or a newly added tool.
#[must_use]
pub fn default_tools() -> &'static [ToolConfig] {
    static TOOLS: LazyLock<Vec<ToolConfig>> = LazyLock::new(build);
    &TOOLS
}

#[must_use]
pub fn find<'a>(tools: &'a [ToolConfig], id: &str) -> Option<&'a ToolConfig> {
    tools.iter().find(|tool| tool.id == id)
}

// One flat declaration per tool. Splitting this into helpers would scatter the
// registry across the file and make it harder, not easier, to read.
#[allow(clippy::too_many_lines)]
fn build() -> Vec<ToolConfig> {
    vec![
        Tool::new("claude-code")
            .paths(&[
                (Skill, "~/.claude/skills"),
                (Agent, "~/.claude/agents"),
                (Command, "~/.claude/commands"),
                (Rule, "~/.claude/CLAUDE.md"),
            ])
            // A project's CLAUDE.md sits at the project root. Deriving the project
            // path by stripping "~/" would put it at ".claude/CLAUDE.md", which is
            // wrong, so it has to be stated.
            .project_paths(&[(Rule, "CLAUDE.md")])
            .single_file_rule()
            .plugins_registry("~/.claude/plugins/installed_plugins.json")
            .plugins_settings_path("~/.claude/settings.json")
            // ~/.claude/skills/synced/<workspace>_<user>/ is Claude Code's own
            // vendor-managed catalogue, not something the user wrote.
            .built_in_dirnames(&["synced"])
            .mcp_config_path("~/.claude.json")
            .project_mcp_config_path(".mcp.json")
            .done(),
        Tool::new("cursor")
            .paths(&[
                (Skill, "~/.cursor/skills"),
                (Agent, "~/.cursor/agents"),
                (Rule, "~/.cursor/rules"),
            ])
            .done(),
        Tool::new("gemini-cli")
            // Only commands are confirmed: Gemini CLI's TOML slash commands live
            // in ~/.gemini/commands. Note those are .toml files, which the scanner
            // does not pick up — it only knows .md.
            .paths(&[(Command, "~/.gemini/commands")])
            // Antigravity's docs describe ~/.gemini/config/skills as shared with
            // the CLI. Plausible, unconfirmed from the CLI's own docs.
            .unconfirmed(&[(Skill, "~/.gemini/config/skills")])
            .done(),
        Tool::new("antigravity")
            .paths(&[(Skill, "~/.gemini/config/skills")])
            .unconfirmed(&[
                (Agent, "~/.gemini/config/agents"),
                (Command, "~/.gemini/config/workflows"),
            ])
            // Skill is deliberately absent: Antigravity's project convention IS
            // the shared <project>/.agents/skills path that the "global" tool
            // below already derives. Declaring it twice would list every skill
            // in that folder under two tools.
            .project_paths(&[
                (Agent, ".agents/agents"),
                (Command, ".agents/workflows"),
                (Rule, ".agents/rules"),
            ])
            .done(),
        Tool::new("codex")
            .paths(&[
                (Skill, "~/.codex/skills"),
                (Agent, "~/.codex/agents"),
                (Command, "~/.codex/prompts"),
            ])
            .plugins_paths(&["~/.codex/plugins/cache"])
            // Inside a bundle, commands live in "commands" rather than the
            // "prompts" the global path would imply.
            .plugin_paths(&[(Command, "commands")])
            .built_in_dirnames(&[".system"])
            .mcp_config_path("~/.codex/config.toml")
            .mcp_config_format(McpConfigFormat::Toml)
            .done(),
        Tool::new("windsurf")
            .paths(&[
                (Skill, "~/.codeium/windsurf/skills"),
                (Rule, "~/.windsurf/rules"),
            ])
            .done(),
        Tool::new("cline")
            .paths(&[(Rule, "~/Documents/Cline/Rules")])
            .unconfirmed(&[
                (Skill, "~/Documents/Cline/Skills"),
                (Command, "~/Documents/Cline/Workflows"),
            ])
            // .clinerules is a directory in current versions and was a single
            // file in older ones; the scanner tolerates finding a file there.
            .project_paths(&[
                (Skill, ".cline/skills"),
                (Command, ".clinerules/workflows"),
                (Rule, ".clinerules"),
            ])
            .done(),
        Tool::new("roo-code")
            .paths(&[(Rule, "~/.roo/rules")])
            .done(),
        // Project-only: Continue's global rules live inside ~/.continue/config.yaml
        // rather than in a directory that can be scanned.
        Tool::new("continue")
            .project_paths(&[(Command, ".continue/prompts"), (Rule, ".continue/rules")])
            .done(),
        Tool::new("opencode")
            .paths(&[
                (Skill, "~/.config/opencode/skills"),
                (Agent, "~/.config/opencode/agents"),
                (Command, "~/.config/opencode/commands"),
            ])
            .project_paths(&[
                (Skill, ".opencode/skills"),
                (Agent, ".opencode/agents"),
                (Command, ".opencode/commands"),
            ])
            .done(),
        Tool::new("trae")
            .paths(&[(Skill, "~/.trae/skills"), (Rule, "~/.trae/user_rules")])
            .unconfirmed(&[(Agent, "~/.trae/agents")])
            .project_paths(&[(Skill, ".trae/skills"), (Rule, ".trae/rules")])
            .done(),
        Tool::new("goose")
            .paths(&[(Skill, "~/.config/goose/skills")])
            .project_paths(&[(Skill, ".goose/skills")])
            .done(),
        Tool::new("hermes")
            .paths(&[(Skill, "~/.hermes/skills")])
            .unconfirmed(&[
                (Agent, "~/.hermes/agents"),
                (Command, "~/.hermes/commands"),
                (Rule, "~/.hermes/rules"),
            ])
            .done(),
        Tool::new("copilot")
            .paths(&[(Skill, "~/.copilot/skills")])
            .project_paths(&[
                (Command, ".github/prompts"),
                (Rule, ".github/instructions"),
            ])
            // VS Code names the map "servers", not "mcpServers".
            .project_mcp_config_path(".vscode/mcp.json")
            .mcp_config_key("servers")
            .done(),
        Tool::new("pi")
            .paths(&[(Skill, "~/.pi/agent/skills")])
            .project_paths(&[(Skill, ".pi/skills"), (Rule, "AGENTS.md")])
            .single_file_rule()
            .done(),
        // The cross-tool convention. Other tools' folders symlink into this one,
        // which is why the same file legitimately shows up under several tools.
        Tool::new("global")
            .paths(&[(Skill, "~/.agents/skills")])
            .done(),
    ]
}

/// Builder for a [`ToolConfig`].
///
/// Exists so each entry above reads as a short, commentable block rather than a
/// struct literal repeating a dozen defaults.
struct Tool(ToolConfig);

impl Tool {
    fn new(id: &str) -> Self {
        Self(ToolConfig {
            id: id.to_owned(),
            paths: TypePaths::new(),
            project_paths: TypePaths::new(),
            unconfirmed_paths: TypePaths::new(),
            disabled: false,
            custom: false,
            single_file_rule: false,
            rule_additional_paths: Vec::new(),
            rule_additional_project_paths: Vec::new(),
            built_in_dirnames: Vec::new(),
            plugins_registry: None,
            plugins_paths: Vec::new(),
            plugins_settings_path: None,
            plugin_paths: TypePaths::new(),
            mcp_config_path: None,
            project_mcp_config_path: None,
            mcp_config_key: None,
            mcp_config_format: McpConfigFormat::Json,
        })
    }

    fn paths(mut self, entries: &[(ItemType, &str)]) -> Self {
        self.0.paths = collect(entries);
        self
    }

    fn project_paths(mut self, entries: &[(ItemType, &str)]) -> Self {
        self.0.project_paths = collect(entries);
        self
    }

    fn unconfirmed(mut self, entries: &[(ItemType, &str)]) -> Self {
        self.0.unconfirmed_paths = collect(entries);
        self
    }

    fn plugin_paths(mut self, entries: &[(ItemType, &str)]) -> Self {
        self.0.plugin_paths = collect(entries);
        self
    }

    fn single_file_rule(mut self) -> Self {
        self.0.single_file_rule = true;
        self
    }

    fn built_in_dirnames(mut self, names: &[&str]) -> Self {
        self.0.built_in_dirnames = names.iter().map(|n| (*n).to_owned()).collect();
        self
    }

    fn plugins_registry(mut self, path: &str) -> Self {
        self.0.plugins_registry = Some(path.to_owned());
        self
    }

    fn plugins_paths(mut self, paths: &[&str]) -> Self {
        self.0.plugins_paths = paths.iter().map(|p| (*p).to_owned()).collect();
        self
    }

    fn plugins_settings_path(mut self, path: &str) -> Self {
        self.0.plugins_settings_path = Some(path.to_owned());
        self
    }

    fn mcp_config_path(mut self, path: &str) -> Self {
        self.0.mcp_config_path = Some(path.to_owned());
        self
    }

    fn project_mcp_config_path(mut self, path: &str) -> Self {
        self.0.project_mcp_config_path = Some(path.to_owned());
        self
    }

    fn mcp_config_key(mut self, key: &str) -> Self {
        self.0.mcp_config_key = Some(key.to_owned());
        self
    }

    fn mcp_config_format(mut self, format: McpConfigFormat) -> Self {
        self.0.mcp_config_format = format;
        self
    }

    fn done(self) -> ToolConfig {
        self.0
    }
}

fn collect(entries: &[(ItemType, &str)]) -> TypePaths {
    entries
        .iter()
        .map(|(item_type, path)| (*item_type, (*path).to_owned()))
        .collect()
}
