//! Scanning, and handing the result to the window.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use skills_core::rescan::{LibrarySnapshot, Progress, RescanInput, RescanOptions, perform_rescan};
use skills_core::settings::effective_tools;
use skills_core::store::prune::Orphan;
use skills_core::tools;
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::lock;
use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

/// The last scan's result, without touching the disk.
///
/// What the window asks for when it opens or reloads.
#[tauri::command]
#[specta::specta]
pub fn get_snapshot(state: State<'_, AppState>) -> CommandResult<Option<LibrarySnapshot>> {
    Ok(lock(&state.snapshot)?.clone())
}

/// Walks every configured folder and records what is there.
///
/// Runs on a blocking thread: the work is filesystem-bound, and the core is
/// deliberately synchronous so that it stays testable.
#[tauri::command]
#[specta::specta]
pub async fn rescan(
    options: RescanOptions,
    on_progress: Channel<Progress>,
    state: State<'_, AppState>,
) -> CommandResult<LibrarySnapshot> {
    scan(&state, options, &|progress| {
        // A dropped channel means the window has gone; the scan finishing is
        // still worth doing, so the send is not checked.
        let _ = on_progress.send(progress);
    })
}

/// The last scan, scanning first if this session has not scanned yet.
///
/// What the menubar popover asks for. The window drives its own scan because
/// it shows the progress; the popover has nowhere to put it and would rather
/// wait than open onto nothing. `None` means no notes folder has been chosen,
/// which only the window can put right.
///
/// Opened while the window's first scan is still running, it waits for that
/// scan and answers with its result, rather than being refused the lock and
/// opening onto an error.
#[tauri::command]
#[specta::specta]
pub async fn ensure_snapshot(state: State<'_, AppState>) -> CommandResult<Option<LibrarySnapshot>> {
    // At debug level, like the popover's opening and closing: what it asked
    // for and what it got cannot be read off the screen.
    if let Some(snapshot) = lock(&state.snapshot)?.clone() {
        tracing::debug!(items = snapshot.items.len(), "ensure_snapshot: cached");
        return Ok(Some(snapshot));
    }
    if lock(&state.store)?.is_none() {
        tracing::debug!("ensure_snapshot: no notes folder");
        return Ok(None);
    }

    tracing::debug!("ensure_snapshot: nothing cached, waiting for the scan lock");
    let _scanning = lock(&state.scanning)?;
    // Whoever held the lock may have been scanning: their result is this one.
    if let Some(snapshot) = lock(&state.snapshot)?.clone() {
        tracing::debug!(
            items = snapshot.items.len(),
            "ensure_snapshot: another scan's result"
        );
        return Ok(Some(snapshot));
    }
    tracing::debug!("ensure_snapshot: scanning");
    scan_locked(
        &state,
        RescanOptions {
            skip_plugins: false,
        },
        &|_| {},
    )
    .map(Some)
}

/// The scan itself, with whatever wants to hear about its progress.
fn scan(
    state: &AppState,
    options: RescanOptions,
    on_progress: &(dyn Fn(Progress) + Sync),
) -> CommandResult<LibrarySnapshot> {
    // Refused rather than queued: whoever asked second would be waiting twice
    // over for a result they are going to throw away.
    let _scanning = state
        .scanning
        .try_lock()
        .map_err(|_| CommandError::new("busy", "A scan is already running."))?;
    scan_locked(state, options, on_progress)
}

/// A scan, for a caller already holding `state.scanning`.
fn scan_locked(
    state: &AppState,
    options: RescanOptions,
    on_progress: &(dyn Fn(Progress) + Sync),
) -> CommandResult<LibrarySnapshot> {
    let settings = lock(&state.settings)?.clone();
    let store_guard = lock(&state.store)?;
    let Some(store) = store_guard.as_ref() else {
        return Err(CommandError::no_metadata_folder());
    };

    let version = {
        let mut guard = lock(&state.version)?;
        *guard += 1;
        *guard
    };

    let all_tools = effective_tools(tools::default_tools(), &settings);
    let snapshot = perform_rescan(
        RescanInput {
            tools: &all_tools,
            projects: &settings.project_workspaces,
            home: &state.home,
            store,
        },
        options,
        version,
        on_progress,
    )?;

    *lock(&state.snapshot)? = Some(snapshot.clone());
    Ok(snapshot)
}

/// Notes kept for items that are no longer on disk.
#[tauri::command]
#[specta::specta]
pub fn list_orphaned_metadata(state: State<'_, AppState>) -> CommandResult<Vec<Orphan>> {
    let guard = lock(&state.store)?;
    let Some(store) = guard.as_ref() else {
        return Ok(Vec::new());
    };
    Ok(store.orphans()?)
}

/// Removes orphaned notes the user has decided to let go of.
#[tauri::command]
#[specta::specta]
pub fn forget_orphaned_metadata(
    entry_ids: Vec<String>,
    state: State<'_, AppState>,
) -> CommandResult<u32> {
    let guard = lock(&state.store)?;
    let Some(store) = guard.as_ref() else {
        return Err(CommandError::no_metadata_folder());
    };
    let removed = store.forget(&entry_ids)?;
    Ok(u32::try_from(removed).unwrap_or(u32::MAX))
}
