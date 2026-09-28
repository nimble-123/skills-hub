//! What the user has configured.
//!
//! The tool registry is *not* stored here. Only the specific things a user can
//! override about a tool are, as an overlay applied to the registry that ships
//! with the application. That is a structural answer to a problem the Obsidian
//! plugin solved procedurally, with a whitelist of fields to carry across on
//! load — and its own comments record that the whitelist was once incomplete
//! and silently broke project paths for everyone.
//!
//! With an overlay, a field added to `ToolConfig` simply cannot be shadowed by
//! a stale file, because there is nowhere in the file for it to live.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, Result};
use crate::model::{
    CollectionDef, EnabledFilter, ProjectWorkspace, RulePathEntry, SortOrder, ToolConfig, TypePaths,
};

/// Bumped when the shape of the file changes in a way that needs migrating.
pub const SCHEMA_VERSION: u32 = 1;

/// The sidebar sections the user can reorder, in their default order.
///
/// "Library" is not among them: it is fixed at the top.
pub const DEFAULT_SECTION_ORDER: [&str; 5] =
    ["types", "extensions", "tools", "projects", "collections"];

/// What a user may change about a tool.
///
/// Absence means "whatever the application ships". Adding a field to
/// [`ToolConfig`] does not belong here unless the user is meant to be able to
/// override it.
///
/// The path maps merge per type rather than replacing wholesale, so changing
/// where one tool keeps its commands leaves its skills alone — and leaves them
/// free to be corrected by an update. An **empty string** is how a type is
/// turned off: it says "do not scan this at all", which is different from
/// saying nothing and getting the default.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ToolOverride {
    pub paths: TypePaths,
    pub project_paths: TypePaths,
    pub disabled: Option<bool>,
    pub rule_additional_paths: Option<Vec<RulePathEntry>>,
    pub rule_additional_project_paths: Option<Vec<RulePathEntry>>,
    pub plugins_registry: Option<String>,
    pub plugins_paths: Option<Vec<String>>,
    pub plugins_settings_path: Option<String>,
    pub mcp_config_path: Option<String>,
    pub project_mcp_config_path: Option<String>,
    pub mcp_config_key: Option<String>,
}

/// Applies a per-type override onto a tool's shipped paths.
///
/// An entry replaces that type's path; an empty one removes it, which is how
/// a type is turned off. Types not mentioned keep whatever shipped.
fn merge_paths(target: &mut TypePaths, overrides: &TypePaths) {
    for (item_type, path) in overrides {
        if path.trim().is_empty() {
            target.remove(item_type);
        } else {
            target.insert(*item_type, path.clone());
        }
    }
}

impl ToolOverride {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }

    fn apply_to(&self, tool: &mut ToolConfig) {
        merge_paths(&mut tool.paths, &self.paths);
        merge_paths(&mut tool.project_paths, &self.project_paths);
        if let Some(disabled) = self.disabled {
            tool.disabled = disabled;
        }
        if let Some(entries) = &self.rule_additional_paths {
            tool.rule_additional_paths.clone_from(entries);
        }
        if let Some(entries) = &self.rule_additional_project_paths {
            tool.rule_additional_project_paths.clone_from(entries);
        }
        if let Some(value) = &self.plugins_registry {
            tool.plugins_registry = Some(value.clone());
        }
        if let Some(value) = &self.plugins_paths {
            tool.plugins_paths.clone_from(value);
        }
        if let Some(value) = &self.plugins_settings_path {
            tool.plugins_settings_path = Some(value.clone());
        }
        if let Some(value) = &self.mcp_config_path {
            tool.mcp_config_path = Some(value.clone());
        }
        if let Some(value) = &self.project_mcp_config_path {
            tool.project_mcp_config_path = Some(value.clone());
        }
        if let Some(value) = &self.mcp_config_key {
            tool.mcp_config_key = Some(value.clone());
        }
    }
}

/// Everything the application remembers between runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub schema_version: u32,
    /// Where the metadata notes live. Empty until the user has chosen.
    pub metadata_folder: Option<PathBuf>,
    pub tool_overrides: BTreeMap<String, ToolOverride>,
    /// Tools the user added themselves.
    pub custom_tools: Vec<ToolConfig>,
    pub project_workspaces: Vec<ProjectWorkspace>,
    /// Collection definitions only. Membership lives in each item's note, so
    /// there is one answer to "is this item in that collection" rather than two
    /// that can disagree.
    pub collections: Vec<CollectionDef>,
    pub section_order: Vec<String>,
    pub show_empty_sidebar_rows: bool,
    pub default_sort_order: SortOrder,
    pub default_enabled_filter: EnabledFilter,
    pub theme: ThemePref,
}

/// The theme, or the wish to be told one by the system.
///
/// Every variant but `System` names a palette the frontend defines; the
/// backend only remembers which was chosen. `kebab-case` rather than
/// `lowercase` so the multi-word ones round-trip readably — the three that
/// existed before serialise the same under either.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum ThemePref {
    #[default]
    System,
    Light,
    Dark,
    SolarizedLight,
    SolarizedDark,
    Monokai,
    QuietLight,
    Abyss,
    KimbieDark,
    TomorrowNightBlue,
    Red,
    HighContrast,
    HorizonMorning,
    HorizonEvening,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            metadata_folder: None,
            tool_overrides: BTreeMap::new(),
            custom_tools: Vec::new(),
            project_workspaces: Vec::new(),
            collections: Vec::new(),
            section_order: DEFAULT_SECTION_ORDER.map(ToOwned::to_owned).to_vec(),
            show_empty_sidebar_rows: false,
            default_sort_order: SortOrder::default(),
            default_enabled_filter: EnabledFilter::default(),
            theme: ThemePref::default(),
        }
    }
}

/// The tool registry with the user's overrides applied.
///
/// Registry order first, then the user's own tools.
#[must_use]
pub fn effective_tools(defaults: &[ToolConfig], settings: &AppSettings) -> Vec<ToolConfig> {
    let mut tools: Vec<ToolConfig> = defaults
        .iter()
        .map(|default| {
            let mut tool = default.clone();
            if let Some(overlay) = settings.tool_overrides.get(&tool.id) {
                overlay.apply_to(&mut tool);
            }
            tool
        })
        .collect();

    for custom in &settings.custom_tools {
        // A custom tool that has since been adopted into the registry is the
        // registry's, not a duplicate.
        if tools.iter().any(|tool| tool.id == custom.id) {
            continue;
        }
        let mut tool = custom.clone();
        tool.custom = true;
        tools.push(tool);
    }

    tools
}

/// Reconciles a stored sidebar order with the sections that exist.
///
/// Unknown names are dropped and new ones appear at their default position, so
/// a section added by an update is not invisible to everyone who already had
/// settings.
#[must_use]
pub fn reconcile_section_order(stored: &[String]) -> Vec<String> {
    let known: Vec<&str> = DEFAULT_SECTION_ORDER.to_vec();
    let mut order: Vec<String> = stored
        .iter()
        .filter(|name| known.contains(&name.as_str()))
        .cloned()
        .collect();

    for (index, name) in known.iter().enumerate() {
        if order.iter().any(|existing| existing == name) {
            continue;
        }
        // Insert before whichever later section is already present, so the
        // default relative order is preserved.
        let position = known[index + 1..]
            .iter()
            .find_map(|later| order.iter().position(|existing| existing == later))
            .unwrap_or(order.len());
        order.insert(position, (*name).to_owned());
    }

    order
}

// ---------------------------------------------------------------- persistence

/// Reads and writes [`AppSettings`] as one JSON file.
#[derive(Debug, Clone)]
pub struct SettingsFile {
    path: PathBuf,
}

/// What loading found.
#[derive(Debug)]
pub struct LoadedSettings {
    pub settings: AppSettings,
    /// Where an unreadable file was moved to, if there was one.
    ///
    /// Refusing to start because a config file is corrupt is the wrong trade:
    /// the user loses access to their library over a file they can be handed
    /// back.
    pub recovered_from: Option<PathBuf>,
}

impl SettingsFile {
    #[must_use]
    pub fn new(config_dir: impl AsRef<Path>) -> Self {
        Self {
            path: config_dir.as_ref().join("settings.json"),
        }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<LoadedSettings> {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(raw) => raw,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(LoadedSettings {
                    settings: AppSettings::default(),
                    recovered_from: None,
                });
            }
            Err(err) => return Err(CoreError::io(&self.path, err)),
        };

        match serde_json::from_str::<AppSettings>(&raw) {
            Ok(mut settings) => {
                settings.section_order = reconcile_section_order(&settings.section_order);
                settings.schema_version = SCHEMA_VERSION;
                Ok(LoadedSettings {
                    settings,
                    recovered_from: None,
                })
            }
            Err(err) => {
                tracing::warn!(path = %self.path.display(), %err, "settings file is unreadable");
                let quarantined = self.quarantine()?;
                Ok(LoadedSettings {
                    settings: AppSettings::default(),
                    recovered_from: Some(quarantined),
                })
            }
        }
    }

    pub fn save(&self, settings: &AppSettings) -> Result<()> {
        use std::io::Write as _;

        let dir = self.path.parent().ok_or_else(|| {
            CoreError::io(&self.path, std::io::Error::other("no parent directory"))
        })?;
        std::fs::create_dir_all(dir).map_err(|err| CoreError::io(dir, err))?;

        // A backup of the last good file, so a bad write is recoverable.
        if self.path.exists() {
            let backup = self.path.with_file_name("settings.backup.json");
            std::fs::copy(&self.path, &backup).map_err(|err| CoreError::io(&backup, err))?;
        }

        let json = serde_json::to_string_pretty(settings)
            .map_err(|err| CoreError::io(&self.path, std::io::Error::other(err)))?;

        let mut temp =
            tempfile::NamedTempFile::new_in(dir).map_err(|err| CoreError::io(dir, err))?;
        temp.write_all(json.as_bytes())
            .and_then(|()| temp.write_all(b"\n"))
            .and_then(|()| temp.as_file().sync_all())
            .map_err(|err| CoreError::io(&self.path, err))?;
        temp.persist(&self.path)
            .map_err(|err| CoreError::io(&self.path, err.error))?;
        Ok(())
    }

    /// Moves an unreadable file aside, named so it is obvious what happened.
    fn quarantine(&self) -> Result<PathBuf> {
        let stamp = jiff::Timestamp::now().as_second();
        let target = self
            .path
            .with_file_name(format!("settings.corrupt-{stamp}.json"));
        std::fs::rename(&self.path, &target).map_err(|err| CoreError::io(&self.path, err))?;
        Ok(target)
    }
}
