//! What each tool is configured to read, and whether it is there.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use std::path::PathBuf;

use skills_core::model::{ItemType, ToolConfig};
use skills_core::paths;
use skills_core::settings::{ToolOverride, effective_tools};
use tauri::State;

use crate::commands::lock;
use crate::error::CommandResult;
use crate::state::AppState;

/// One tool, with every path it would read resolved against this machine.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    pub tool: ToolConfig,
    /// What the application ships, before the user's changes.
    ///
    /// Sent alongside so a field can say what it would go back to, and
    /// offer to.
    pub shipped: Option<ToolConfig>,
    pub overrides: ToolOverride,
    pub paths: Vec<ResolvedPath>,
    /// Whether any of its folders is actually on this machine.
    pub detected: bool,
}

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPath {
    #[serde(rename = "type")]
    pub item_type: ItemType,
    /// As configured, with a leading `~` still in it.
    pub configured: String,
    /// The same path, expanded against this machine.
    pub path: PathBuf,
    pub exists: bool,
    /// The scope this path belongs to: the home directory, or a project.
    pub project_id: Option<String>,
}

/// Every tool and where it looks, so the tools page can show what was found.
#[tauri::command]
#[specta::specta]
pub fn describe_tools(state: State<'_, AppState>) -> CommandResult<Vec<ToolReport>> {
    let settings = lock(&state.settings)?.clone();
    let all_tools = effective_tools(skills_core::tools::default_tools(), &settings);

    Ok(all_tools
        .into_iter()
        .map(|tool| {
            let mut resolved = Vec::new();

            for item_type in ItemType::ALL {
                if let Some(configured) = tool.paths.get(&item_type)
                    && let Some(path) = paths::resolve_tool_dir(&tool, item_type, None, &state.home)
                {
                    resolved.push(ResolvedPath {
                        item_type,
                        configured: configured.clone(),
                        exists: path.exists(),
                        path,
                        project_id: None,
                    });
                }
                for project in &settings.project_workspaces {
                    let Some(path) =
                        paths::resolve_tool_dir(&tool, item_type, Some(project), &state.home)
                    else {
                        continue;
                    };
                    let configured = tool
                        .project_paths
                        .get(&item_type)
                        .cloned()
                        .or_else(|| {
                            tool.paths
                                .get(&item_type)
                                .map(|raw| paths::to_project_relative(raw))
                        })
                        .unwrap_or_default();
                    resolved.push(ResolvedPath {
                        item_type,
                        configured,
                        exists: path.exists(),
                        path,
                        project_id: Some(project.id.clone()),
                    });
                }
            }

            ToolReport {
                detected: resolved.iter().any(|path| path.exists),
                paths: resolved,
                shipped: skills_core::tools::find(skills_core::tools::default_tools(), &tool.id)
                    .cloned(),
                overrides: settings
                    .tool_overrides
                    .get(&tool.id)
                    .cloned()
                    .unwrap_or_default(),
                tool,
            }
        })
        .collect())
}

/// Whether a path a user is typing actually exists.
///
/// Checked as they type rather than on save, because a path that is nearly
/// right looks exactly like one that is right.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct PathStatus {
    pub expanded: PathBuf,
    pub exists: bool,
    pub is_directory: bool,
}

#[tauri::command]
#[specta::specta]
pub fn check_path(path: String, state: State<'_, AppState>) -> PathStatus {
    let expanded = paths::expand_home(path.trim(), &state.home);
    let metadata = std::fs::metadata(&expanded).ok();

    PathStatus {
        exists: metadata.is_some(),
        is_directory: metadata.is_some_and(|meta| meta.is_dir()),
        expanded,
    }
}

/// Adds a tool the application does not ship.
///
/// For something new, or something whose layout is different enough that
/// changing paths on an existing entry would be a lie about which tool it is.
#[tauri::command]
#[specta::specta]
pub fn add_custom_tool(
    id: String,
    paths: std::collections::BTreeMap<ItemType, String>,
    state: State<'_, AppState>,
) -> CommandResult<()> {
    let id = skills_core::ids::slug(&id);
    if id == "item" {
        return Err(crate::error::CommandError::new(
            "bad-tool-id",
            "Give the tool a name.",
        ));
    }

    let mut settings = lock(&state.settings)?;
    let taken = skills_core::tools::find(skills_core::tools::default_tools(), &id).is_some()
        || settings.custom_tools.iter().any(|tool| tool.id == id);
    if taken {
        return Err(crate::error::CommandError::new(
            "tool-exists",
            format!("There is already a tool called {id}."),
        ));
    }

    settings.custom_tools.push(ToolConfig {
        id,
        paths: paths
            .into_iter()
            .filter(|(_, p)| !p.trim().is_empty())
            .collect(),
        project_paths: skills_core::model::TypePaths::new(),
        unconfirmed_paths: skills_core::model::TypePaths::new(),
        disabled: false,
        custom: true,
        single_file_rule: false,
        rule_additional_paths: Vec::new(),
        rule_additional_project_paths: Vec::new(),
        built_in_dirnames: Vec::new(),
        plugins_registry: None,
        plugins_paths: Vec::new(),
        plugins_settings_path: None,
        plugin_paths: skills_core::model::TypePaths::new(),
        mcp_config_path: None,
        project_mcp_config_path: None,
        mcp_config_key: None,
        mcp_config_format: skills_core::model::McpConfigFormat::Json,
    });

    let saved = settings.clone();
    drop(settings);
    state.settings_file.save(&saved)?;
    Ok(())
}

/// Removes a tool the user added. Nothing on disk is touched.
#[tauri::command]
#[specta::specta]
pub fn remove_custom_tool(tool_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let saved = {
        let mut settings = lock(&state.settings)?;
        settings.custom_tools.retain(|tool| tool.id != tool_id);
        settings.tool_overrides.remove(&tool_id);
        settings.clone()
    };
    state.settings_file.save(&saved)?;
    Ok(())
}
