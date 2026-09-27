//! Reading and changing what the user has configured.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use skills_core::model::{ProjectWorkspace, ToolConfig};
use skills_core::settings::{AppSettings, ToolOverride, effective_tools};
use skills_core::store::MetaStore;
use skills_core::tools;
use tauri::State;

use crate::commands::lock;
use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

/// Settings plus the tool registry they resolve to.
///
/// Sent together because the frontend always needs both and they must agree:
/// an override is meaningless without the tool it applies to.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub settings: AppSettings,
    pub tools: Vec<ToolConfig>,
}

#[tauri::command]
#[specta::specta]
pub fn get_settings(state: State<'_, AppState>) -> CommandResult<SettingsView> {
    let settings = lock(&state.settings)?.clone();
    Ok(view(settings))
}

/// Replaces the settings wholesale.
///
/// The frontend sends the whole document because it holds the authoritative
/// copy between edits; a patch API would need a merge on both sides.
#[tauri::command]
#[specta::specta]
pub fn update_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> CommandResult<SettingsView> {
    apply(&state, |current| *current = settings)
}

#[tauri::command]
#[specta::specta]
pub fn set_tool_override(
    tool_id: String,
    overrides: ToolOverride,
    state: State<'_, AppState>,
) -> CommandResult<SettingsView> {
    apply(&state, |settings| {
        if overrides.is_empty() {
            settings.tool_overrides.remove(&tool_id);
        } else {
            settings.tool_overrides.insert(tool_id, overrides);
        }
    })
}

/// Points the store at a folder, creating it if need be.
#[tauri::command]
#[specta::specta]
pub fn set_metadata_folder(
    folder: std::path::PathBuf,
    state: State<'_, AppState>,
) -> CommandResult<SettingsView> {
    let store = MetaStore::open(&folder)?;
    *lock(&state.store)? = Some(store);
    apply(&state, |settings| {
        settings.metadata_folder = Some(folder);
    })
}

#[tauri::command]
#[specta::specta]
pub fn add_project_workspace(
    path: std::path::PathBuf,
    name: Option<String>,
    state: State<'_, AppState>,
) -> CommandResult<SettingsView> {
    if !path.is_dir() {
        return Err(CommandError::new(
            "not-a-directory",
            format!("{} is not a folder.", path.display()),
        ));
    }

    let name = name.unwrap_or_else(|| {
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Workspace")
            .to_owned()
    });

    apply(&state, |settings| {
        // Adding the same folder twice would scan it twice and list every item
        // in it under two workspaces.
        if settings
            .project_workspaces
            .iter()
            .any(|existing| existing.path == path)
        {
            return;
        }
        settings.project_workspaces.push(ProjectWorkspace {
            id: format!("proj-{}", jiff::Timestamp::now().as_millisecond()),
            name,
            path,
        });
    })
}

#[tauri::command]
#[specta::specta]
pub fn remove_project_workspace(
    id: String,
    state: State<'_, AppState>,
) -> CommandResult<SettingsView> {
    apply(&state, |settings| {
        settings.project_workspaces.retain(|p| p.id != id);
    })
}

/// Changes the settings, saves them, and returns the new view.
///
/// One place, so nothing can change settings without persisting them.
fn apply(
    state: &State<'_, AppState>,
    change: impl FnOnce(&mut AppSettings),
) -> CommandResult<SettingsView> {
    let settings = {
        let mut guard = lock(&state.settings)?;
        change(&mut guard);
        guard.clone()
    };
    state.settings_file.save(&settings)?;
    Ok(view(settings))
}

fn view(settings: AppSettings) -> SettingsView {
    let tools = effective_tools(tools::default_tools(), &settings);
    SettingsView { settings, tools }
}
