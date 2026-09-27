//! What the library costs, how much of it is used, and what is configured.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use skills_core::dashboard::{self, DashboardReport, Dismissals};
use skills_core::mcp::{self, McpServer};
use skills_core::model::ScanWarning;
use skills_core::settings::effective_tools;
use skills_core::store::now_rfc3339;
use skills_core::usage::{self, UsageByEntry};
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::lock;
use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

/// How far along reading a tool's history is.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UsageProgress {
    pub done: u32,
    pub total: u32,
}

/// Reads a tool's own session history and reports what has actually been used.
///
/// Only Claude Code and Codex keep anything to read. For everything else this
/// returns nothing, and the dashboard falls back to what a file looks like.
///
/// This can be hundreds of megabytes, so it is asked for rather than done on
/// every scan.
#[tauri::command]
#[specta::specta]
pub async fn load_usage(
    tool_id: String,
    on_progress: Channel<UsageProgress>,
    state: State<'_, AppState>,
) -> CommandResult<UsageByEntry> {
    let items = {
        let guard = lock(&state.snapshot)?;
        guard
            .as_ref()
            .map(|snapshot| snapshot.items.clone())
            .unwrap_or_default()
    };

    let report = |done: u32, total: u32| {
        let _ = on_progress.send(UsageProgress { done, total });
    };

    let raw = match tool_id.as_str() {
        "claude-code" => usage::claude::scan(&state.home, &report),
        "codex" => {
            let needles = usage::codex::needles(&items);
            usage::codex::scan(&state.home, &needles, &report)
        }
        _ => return Ok(UsageByEntry::new()),
    };

    Ok(usage::join(&items, &raw, &tool_id))
}

/// Costs, prune suggestions and overlaps, over whatever was last scanned.
#[tauri::command]
#[specta::specta]
pub async fn compute_dashboard(
    usage_by_entry: UsageByEntry,
    state: State<'_, AppState>,
) -> CommandResult<DashboardReport> {
    let items = {
        let guard = lock(&state.snapshot)?;
        guard
            .as_ref()
            .map(|snapshot| snapshot.items.clone())
            .ok_or_else(|| CommandError::new("no-snapshot", "Nothing has been scanned yet."))?
    };

    let dismissals = lock(&state.dismissals)?.clone();
    Ok(dashboard::report(
        &items,
        &usage_by_entry,
        &dismissals.ids(),
    ))
}

/// Waves a suggestion away without touching the item behind it.
#[tauri::command]
#[specta::specta]
pub fn disregard(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    {
        let mut guard = lock(&state.dismissals)?;
        guard.disregarded.insert(id, now_rfc3339());
    }
    save_dismissals(&state)
}

/// Takes a suggestion off the dismissed list.
#[tauri::command]
#[specta::specta]
pub fn undisregard(id: String, state: State<'_, AppState>) -> CommandResult<()> {
    {
        let mut guard = lock(&state.dismissals)?;
        guard.disregarded.remove(&id);
    }
    save_dismissals(&state)
}

#[tauri::command]
#[specta::specta]
pub fn list_disregarded(state: State<'_, AppState>) -> CommandResult<Vec<String>> {
    Ok(lock(&state.dismissals)?.ids())
}

/// Every MCP server every tool is configured with.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct McpReport {
    pub servers: Vec<McpServer>,
    pub warnings: Vec<ScanWarning>,
}

#[tauri::command]
#[specta::specta]
pub fn list_mcp_servers(state: State<'_, AppState>) -> CommandResult<McpReport> {
    let settings = lock(&state.settings)?.clone();
    let all_tools = effective_tools(skills_core::tools::default_tools(), &settings);

    let scan = mcp::scan(&all_tools, &settings.project_workspaces, &state.home);
    Ok(McpReport {
        servers: scan.servers,
        warnings: scan.warnings,
    })
}

fn save_dismissals(state: &State<'_, AppState>) -> CommandResult<()> {
    let dismissals: Dismissals = lock(&state.dismissals)?.clone();
    Ok(state.dismissals_file.save(&dismissals)?)
}
