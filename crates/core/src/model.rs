//! The data the whole application is about.
//!
//! Field names crossing the IPC boundary and the ones written into metadata
//! frontmatter are `camelCase`, matching the Obsidian plugin this is derived
//! from — so the same notes stay readable by both, and Dataview queries written
//! against one keep working against the other.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// What a discovered file *is*, from the point of view of the tool that reads it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, specta::Type,
)]
#[serde(rename_all = "lowercase")]
pub enum ItemType {
    Skill,
    Agent,
    Command,
    Rule,
}

impl ItemType {
    /// Every type, in the order the UI presents them.
    pub const ALL: [Self; 4] = [Self::Skill, Self::Agent, Self::Command, Self::Rule];

    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Skill => "skill",
            Self::Agent => "agent",
            Self::Command => "command",
            Self::Rule => "rule",
        }
    }
}

impl std::fmt::Display for ItemType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Paths a tool reads, keyed by what it expects to find there.
pub type TypePaths = BTreeMap<ItemType, String>;

/// An extra rule location beyond the tool's single configured one.
///
/// `single_file` is recorded when the entry is added and never re-derived: a
/// disabled single-file rule no longer exists at its own path, so asking the
/// filesystem later would give the wrong answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RulePathEntry {
    pub path: String,
    pub single_file: bool,
}

/// One AI coding tool and where it keeps things.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolConfig {
    pub id: String,
    /// Paths at the global (home directory) scope. May start with `~`.
    pub paths: TypePaths,
    /// Project-scoped overrides. Where a type is absent here but present in
    /// `paths`, the project path is derived by stripping the leading `~/`.
    pub project_paths: TypePaths,
    /// Documented but unverified locations. **Never scanned** — these exist so
    /// the tool editor can offer them as a suggestion the user opts into.
    pub unconfirmed_paths: TypePaths,
    /// Hidden from the tool grid. Still scanned: skipping it would make the
    /// metadata store treat every one of its items as gone.
    pub disabled: bool,
    /// Added by the user rather than shipped with the app, and therefore removable.
    pub custom: bool,
    /// `paths[Rule]` names one file, not a directory — `CLAUDE.md`, `AGENTS.md`.
    pub single_file_rule: bool,
    pub rule_additional_paths: Vec<RulePathEntry>,
    pub rule_additional_project_paths: Vec<RulePathEntry>,
    /// Subfolder names the vendor ships and the user did not write.
    pub built_in_dirnames: Vec<String>,
    /// JSON registry of installed plugins (Claude Code).
    pub plugins_registry: Option<String>,
    /// Roots of a versioned plugin bundle cache (Codex).
    pub plugins_paths: Vec<String>,
    /// JSON file holding an `enabledPlugins` map.
    pub plugins_settings_path: Option<String>,
    /// Per-bundle subfolder override, where a bundle lays things out differently
    /// from the tool's own global paths.
    pub plugin_paths: TypePaths,
    pub mcp_config_path: Option<String>,
    pub project_mcp_config_path: Option<String>,
    /// Key holding the server map. Defaults to `mcpServers` (JSON) or
    /// `mcp_servers` (TOML).
    pub mcp_config_key: Option<String>,
    pub mcp_config_format: McpConfigFormat,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum McpConfigFormat {
    #[default]
    Json,
    Toml,
}

/// A folder outside the home directory that is also scanned for items.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProjectWorkspace {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
}

/// A plugin bundle installed into one of the tools.
///
/// The items inside it are scanned like any others, but are not individually
/// toggleable: a bundle is enabled or disabled as a whole, by its own tool.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginSource {
    pub id: String,
    pub name: String,
    /// The marketplace or registry the bundle came from.
    pub group: Option<String>,
    /// Where this version is installed.
    pub path: PathBuf,
    pub tool_id: String,
    pub enabled: bool,
    /// Repository from the bundle manifest, GitHub only.
    pub repo_url: Option<String>,
}

/// What a scan found on disk, before any user metadata is attached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredItem {
    pub entry_id: String,
    /// The `SKILL.md` for a folder skill, otherwise the file itself.
    pub source_path: PathBuf,
    /// `source_path` with symlinks resolved. Equal to `source_path` when it is
    /// not a link.
    pub real_path: PathBuf,
    pub tool: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    /// `None` means the global (home directory) scope.
    pub project_id: Option<String>,
    /// `None` means the item was not shipped inside an installed plugin.
    pub plugin_id: Option<String>,
    pub name: String,
    pub description: String,
    /// Derived purely from which folder the item physically sits in.
    pub enabled: bool,
}

/// A discovered item plus everything the user has said about it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemMetadata {
    #[serde(flatten)]
    pub discovered: DiscoveredItem,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub collections: Vec<String>,
    /// Where this item was installed from, set at install, update or restore.
    #[serde(flatten)]
    pub source: InstallSource,
}

/// Provenance for an item installed through the application.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct InstallSource {
    pub source_repo: Option<String>,
    /// Empty string means "track the default branch".
    pub source_ref: Option<String>,
    /// Empty string means the repository root is the item.
    pub source_subpath: Option<String>,
    pub source_commit: Option<String>,
}

/// A symlink whose target no longer resolves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BrokenSymlink {
    pub path: PathBuf,
    /// The link target exactly as written, which may be relative.
    pub target: String,
    /// That target resolved to an absolute path.
    pub target_path: PathBuf,
    pub tool: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub project_id: Option<String>,
}

/// Something the scan could not do.
///
/// Carried through to the UI rather than logged and forgotten, because a scan
/// that silently returned less than it should must never be allowed to look
/// like a scan that found nothing — that is the difference between a warning
/// and deleting the user's metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ScanWarning {
    pub path: PathBuf,
    pub tool: Option<String>,
    pub message: String,
    pub kind: ScanWarningKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum ScanWarningKind {
    /// The operating system refused access. On macOS this is usually a consent
    /// prompt that was declined.
    PermissionDenied,
    /// The path could not be read for some other reason.
    Unreadable,
    /// A file was found but could not be understood.
    Malformed,
}

/// A named grouping of items.
///
/// Only the definition lives in settings. Which items belong is recorded in
/// each item's own note, so there is one answer to the question rather than
/// two that can disagree — and `contains(collections, "work")` in Dataview is
/// the real answer, not a shadow of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDef {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum SortOrder {
    #[default]
    NameAsc,
    NameDesc,
    ModifiedDesc,
    ModifiedAsc,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum EnabledFilter {
    #[default]
    All,
    Enabled,
    Disabled,
}
