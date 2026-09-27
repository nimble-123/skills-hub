//! What each tool is configured to read, and whether it is there.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use std::path::PathBuf;

use skills_core::model::{ItemType, ToolConfig};
use skills_core::paths;
use skills_core::settings::effective_tools;
use tauri::State;

use crate::commands::lock;
use crate::error::CommandResult;
use crate::state::AppState;

/// One tool, with every path it would read resolved against this machine.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    pub tool: ToolConfig,
    pub paths: Vec<ResolvedPath>,
    /// Whether any of its folders is actually on this machine.
    pub detected: bool,
}

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPath {
    #[serde(rename = "type")]
    pub item_type: ItemType,
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
                if let Some(path) = paths::resolve_tool_dir(&tool, item_type, None, &state.home) {
                    resolved.push(ResolvedPath {
                        item_type,
                        exists: path.exists(),
                        path,
                        project_id: None,
                    });
                }
                for project in &settings.project_workspaces {
                    if let Some(path) =
                        paths::resolve_tool_dir(&tool, item_type, Some(project), &state.home)
                    {
                        resolved.push(ResolvedPath {
                            item_type,
                            exists: path.exists(),
                            path,
                            project_id: Some(project.id.clone()),
                        });
                    }
                }
            }

            ToolReport {
                detected: resolved.iter().any(|path| path.exists),
                paths: resolved,
                tool,
            }
        })
        .collect())
}
