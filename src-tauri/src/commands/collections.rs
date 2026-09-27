//! Grouping items across tools and projects.
//!
//! The definitions live in the settings; which items belong lives in each
//! item's own note. One answer to the question rather than two that can
//! disagree — and it means `contains(collections, "work")` in Dataview is
//! the real answer, not a shadow of one.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use skills_core::model::{CollectionDef, ItemMetadata};
use skills_core::settings::AppSettings;
use skills_core::store::MetaPatch;
use tauri::State;

use crate::commands::lock;
use crate::error::{CommandError, CommandResult};
use crate::state::AppState;

/// Creates a collection, or renames one.
#[tauri::command]
#[specta::specta]
pub fn save_collection(
    collection: CollectionDef,
    state: State<'_, AppState>,
) -> CommandResult<Vec<CollectionDef>> {
    change(&state, |settings| {
        match settings
            .collections
            .iter_mut()
            .find(|existing| existing.id == collection.id)
        {
            Some(existing) => *existing = collection,
            None => settings.collections.push(collection),
        }
    })
}

/// Removes a collection, and takes it out of every item that was in it.
///
/// Scrubbing the notes afterwards is idempotent and re-runnable, so a failure
/// halfway through leaves nothing inconsistent — the next attempt finishes
/// the job.
#[tauri::command]
#[specta::specta]
pub fn delete_collection(
    collection_id: String,
    state: State<'_, AppState>,
) -> CommandResult<Vec<CollectionDef>> {
    let members: Vec<String> = {
        let guard = lock(&state.snapshot)?;
        guard
            .as_ref()
            .map(|snapshot| {
                snapshot
                    .items
                    .iter()
                    .filter(|item| item.collections.contains(&collection_id))
                    .map(|item| item.discovered.entry_id.clone())
                    .collect()
            })
            .unwrap_or_default()
    };

    for entry_id in members {
        let _ = set_membership(&state, &entry_id, &collection_id, false);
    }

    change(&state, |settings| {
        settings
            .collections
            .retain(|existing| existing.id != collection_id);
    })
}

/// Puts an item into a collection, or takes it out again.
#[tauri::command]
#[specta::specta]
pub fn set_item_in_collection(
    entry_id: String,
    collection_id: String,
    member: bool,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    let updated = set_membership(&state, &entry_id, &collection_id, member)?;

    let mut guard = lock(&state.snapshot)?;
    if let Some(snapshot) = guard.as_mut()
        && let Some(existing) = snapshot
            .items
            .iter_mut()
            .find(|item| item.discovered.entry_id == entry_id)
    {
        existing.clone_from(&updated);
    }
    Ok(updated)
}

fn set_membership(
    state: &State<'_, AppState>,
    entry_id: &str,
    collection_id: &str,
    member: bool,
) -> CommandResult<ItemMetadata> {
    let current: Vec<String> = lock(&state.snapshot)?
        .as_ref()
        .and_then(|snapshot| {
            snapshot
                .items
                .iter()
                .find(|item| item.discovered.entry_id == entry_id)
                .map(|item| item.collections.clone())
        })
        .unwrap_or_default();

    let mut next = current;
    if member {
        if !next.iter().any(|id| id == collection_id) {
            next.push(collection_id.to_owned());
        }
    } else {
        next.retain(|id| id != collection_id);
    }

    let guard = lock(&state.store)?;
    let store = guard
        .as_ref()
        .ok_or_else(CommandError::no_metadata_folder)?;
    Ok(store.update(
        entry_id,
        &MetaPatch {
            collections: Some(next),
            ..MetaPatch::default()
        },
    )?)
}

fn change(
    state: &State<'_, AppState>,
    edit: impl FnOnce(&mut AppSettings),
) -> CommandResult<Vec<CollectionDef>> {
    let settings = {
        let mut guard = lock(&state.settings)?;
        edit(&mut guard);
        guard.clone()
    };
    state.settings_file.save(&settings)?;
    Ok(settings.collections)
}
