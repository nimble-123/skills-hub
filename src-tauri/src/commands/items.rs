//! Acting on one item.
//!
//! Each of these returns the item as it now stands, so the window updates one
//! card instead of asking for the whole library again.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use std::path::PathBuf;

use skills_core::frontmatter::{self, Field};
use skills_core::model::ItemMetadata;
use skills_core::store::{MetaPatch, MetaStore};
use skills_core::{fsunit, toggle};
use tauri::State;

use crate::commands::lock;
use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

/// One item's file, as the detail view needs it.
#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ItemContent {
    pub raw: String,
    /// Every declared frontmatter key, in the order the author wrote them.
    pub frontmatter: Vec<Field>,
    /// Everything after the frontmatter.
    pub body: String,
    pub bytes: f64,
    /// When the file was last written, as RFC 3339.
    pub modified: Option<String>,
    pub is_symlink: bool,
    pub real_path: PathBuf,
    /// The other files in a skill's folder, if it has any.
    pub sibling_files: Vec<SiblingFile>,
}

#[derive(Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SiblingFile {
    /// Path relative to the skill's folder.
    pub path: String,
    pub bytes: f64,
}

#[tauri::command]
#[specta::specta]
pub fn read_item_content(
    entry_id: String,
    state: State<'_, AppState>,
) -> CommandResult<ItemContent> {
    let item = find(&state, &entry_id)?;
    let path = &item.discovered.source_path;

    let raw = std::fs::read_to_string(path)?;
    let metadata = std::fs::metadata(path)?;
    let unit = fsunit::linkable_unit(path);

    Ok(ItemContent {
        frontmatter: frontmatter::parse(&raw),
        body: frontmatter::strip(&raw).to_owned(),
        bytes: bytes_as_f64(metadata.len()),
        modified: modified_rfc3339(&metadata),
        is_symlink: std::fs::symlink_metadata(&unit.path)
            .is_ok_and(|meta| meta.file_type().is_symlink()),
        real_path: item.discovered.real_path.clone(),
        sibling_files: if unit.is_dir {
            siblings(&unit.path, path)
        } else {
            Vec::new()
        },
        raw,
    })
}

/// Saves an edit to an item's own file.
///
/// The scanner reads name and description out of the file, so the note is
/// refreshed from it straight away rather than waiting for the next scan.
#[tauri::command]
#[specta::specta]
pub fn write_item_content(
    entry_id: String,
    content: String,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    let mut item = find(&state, &entry_id)?;
    std::fs::write(&item.discovered.source_path, &content)?;

    let meta = frontmatter::parse_source_meta(&content);
    if !meta.name.is_empty() {
        item.discovered.name = meta.name;
    }
    item.discovered.description = meta.description;

    with_store(&state, |store| Ok(store.ensure(&item.discovered)?.metadata))
}

#[tauri::command]
#[specta::specta]
pub fn set_item_enabled(
    entry_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    let mut item = find(&state, &entry_id)?;
    let moved_to = toggle::set_item_enabled(&item, enabled)?;

    item.discovered.source_path = moved_to;
    item.discovered.enabled = enabled;

    let updated = with_store(&state, |store| Ok(store.ensure(&item.discovered)?.metadata))?;
    replace_in_snapshot(&state, &updated)?;
    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn set_item_favorite(
    entry_id: String,
    favorite: bool,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    patch(
        &state,
        &entry_id,
        MetaPatch {
            favorite: Some(favorite),
            ..MetaPatch::default()
        },
    )
}

#[tauri::command]
#[specta::specta]
pub fn set_item_tags(
    entry_id: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    patch(
        &state,
        &entry_id,
        MetaPatch {
            tags: Some(tags),
            ..MetaPatch::default()
        },
    )
}

#[tauri::command]
#[specta::specta]
pub fn set_item_collections(
    entry_id: String,
    collections: Vec<String>,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    patch(
        &state,
        &entry_id,
        MetaPatch {
            collections: Some(collections),
            ..MetaPatch::default()
        },
    )
}

/// Makes a global item visible inside a project, by symlink.
#[tauri::command]
#[specta::specta]
pub fn link_into_project(
    entry_id: String,
    project_id: String,
    state: State<'_, AppState>,
) -> CommandResult<std::path::PathBuf> {
    use skills_core::settings::effective_tools;

    let item = find(&state, &entry_id)?;
    let settings = lock(&state.settings)?.clone();

    let project = settings
        .project_workspaces
        .iter()
        .find(|workspace| workspace.id == project_id)
        .ok_or_else(|| CommandError::new("unknown-project", "No workspace with that id."))?;

    let all_tools = effective_tools(skills_core::tools::default_tools(), &settings);
    let tool = all_tools
        .iter()
        .find(|tool| tool.id == item.discovered.tool)
        .ok_or_else(|| CommandError::new("unknown-tool", "No tool with that id."))?;

    Ok(skills_core::projectlink::add_to_project(
        &item,
        tool,
        project,
        &state.home,
    )?)
}

/// Removes a link from a project, leaving what it pointed at alone.
#[tauri::command]
#[specta::specta]
pub fn unlink_from_project(entry_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let item = find(&state, &entry_id)?;
    skills_core::projectlink::remove_from_project(&item.discovered.source_path)?;

    with_store(&state, |store| {
        store.forget(std::slice::from_ref(&entry_id))?;
        Ok(())
    })?;

    let mut guard = lock(&state.snapshot)?;
    if let Some(snapshot) = guard.as_mut() {
        snapshot
            .items
            .retain(|existing| existing.discovered.entry_id != entry_id);
    }
    Ok(())
}

/// Deletes an item from disk, and its note with it.
#[tauri::command]
#[specta::specta]
pub fn delete_item(entry_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    let item = find(&state, &entry_id)?;
    toggle::delete_item(&item)?;

    with_store(&state, |store| {
        store.forget(std::slice::from_ref(&entry_id))?;
        Ok(())
    })?;

    let mut guard = lock(&state.snapshot)?;
    if let Some(snapshot) = guard.as_mut() {
        snapshot
            .items
            .retain(|existing| existing.discovered.entry_id != entry_id);
    }
    Ok(())
}

// ------------------------------------------------------------------- plumbing

fn find(state: &State<'_, AppState>, entry_id: &str) -> CommandResult<ItemMetadata> {
    lock(&state.snapshot)?
        .as_ref()
        .and_then(|snapshot| {
            snapshot
                .items
                .iter()
                .find(|item| item.discovered.entry_id == entry_id)
                .cloned()
        })
        .ok_or_else(|| {
            CommandError::new(
                "unknown-item",
                format!("No item with id {entry_id} in the last scan."),
            )
        })
}

fn with_store<T>(
    state: &State<'_, AppState>,
    action: impl FnOnce(&MetaStore) -> CommandResult<T>,
) -> CommandResult<T> {
    let guard = lock(&state.store)?;
    let store = guard
        .as_ref()
        .ok_or_else(CommandError::no_metadata_folder)?;
    action(store)
}

fn patch(
    state: &State<'_, AppState>,
    entry_id: &str,
    patch: MetaPatch,
) -> CommandResult<ItemMetadata> {
    let updated = with_store(state, |store| Ok(store.update(entry_id, &patch)?))?;
    replace_in_snapshot(state, &updated)?;
    Ok(updated)
}

/// Keeps the cached snapshot in step with a change to one item.
fn replace_in_snapshot(state: &State<'_, AppState>, updated: &ItemMetadata) -> CommandResult<()> {
    let mut guard = lock(&state.snapshot)?;
    if let Some(snapshot) = guard.as_mut()
        && let Some(existing) = snapshot
            .items
            .iter_mut()
            .find(|item| item.discovered.entry_id == updated.discovered.entry_id)
    {
        existing.clone_from(updated);
    }
    Ok(())
}

fn modified_rfc3339(metadata: &std::fs::Metadata) -> Option<String> {
    let modified = metadata.modified().ok()?;
    let since_epoch = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    let seconds = i64::try_from(since_epoch.as_secs()).ok()?;
    jiff::Timestamp::from_second(seconds)
        .ok()
        .map(|ts| ts.to_string())
}

/// File sizes cross into JavaScript, which has no 64-bit integer. An f64 holds
/// every size up to 8 petabytes exactly, which is enough for a markdown file.
#[allow(clippy::cast_precision_loss)]
fn bytes_as_f64(bytes: u64) -> f64 {
    bytes as f64
}

/// The other files in a skill's folder, so the detail view can show what a
/// multi-file skill actually contains.
fn siblings(folder: &std::path::Path, manifest: &std::path::Path) -> Vec<SiblingFile> {
    let mut found: Vec<SiblingFile> = walkdir::WalkDir::new(folder)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|entry| entry.file_type().is_file() && entry.path() != manifest)
        .filter_map(|entry| {
            let relative = entry.path().strip_prefix(folder).ok()?;
            Some(SiblingFile {
                path: relative.to_string_lossy().into_owned(),
                bytes: bytes_as_f64(entry.metadata().map(|m| m.len()).unwrap_or(0)),
            })
        })
        .collect();
    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}
