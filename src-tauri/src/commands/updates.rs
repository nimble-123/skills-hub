//! Checking whether a tracked item has moved on, and acting on it.
//!
//! Nothing overwrites anything without the diff having been offered first,
//! which is why this is three steps rather than one: check, review, apply.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use std::time::Instant;

use rayon::prelude::*;
use skills_core::diff::{CompanionChange, DiffLine, DiffStats};
use skills_core::git::SystemGit;
use skills_core::install::{self, ReviewMode, UpdateStatus};
use skills_core::model::ItemMetadata;
use skills_core::store::MetaPatch;
use tauri::State;
use tauri::ipc::Channel;

use crate::commands::lock;
use crate::error::{CommandError, CommandResult};
use crate::state::{AppState, PendingReview};

/// What a check found out about one item.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub entry_id: String,
    pub status: UpdateStatus,
    /// What the remote has now, when it could be read.
    pub remote_commit: Option<String>,
    /// Why the check failed, when it did.
    pub error: Option<String>,
}

/// Progress through a bulk check.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CheckProgress {
    pub done: u32,
    pub total: u32,
}

/// Asks every named item's remote whether it has moved on.
///
/// In parallel: each is a separate `ls-remote` and they wait on the network,
/// not on each other. A check that fails is reported as a failure for that
/// item rather than sinking the rest.
#[tauri::command]
#[specta::specta]
pub async fn check_for_updates(
    entry_ids: Vec<String>,
    on_progress: Channel<CheckProgress>,
    state: State<'_, AppState>,
) -> CommandResult<Vec<UpdateCheck>> {
    let items = {
        let guard = lock(&state.snapshot)?;
        let snapshot = guard
            .as_ref()
            .ok_or_else(|| CommandError::new("no-snapshot", "Nothing has been scanned yet."))?;
        snapshot
            .items
            .iter()
            .filter(|item| entry_ids.contains(&item.discovered.entry_id))
            .filter(|item| item.source.source_repo.is_some())
            .cloned()
            .collect::<Vec<_>>()
    };

    let total = u32::try_from(items.len()).unwrap_or(u32::MAX);
    let done = std::sync::atomic::AtomicU32::new(0);

    let checks = items
        .par_iter()
        .map(|item| {
            let check = match install::check_for_update(&SystemGit, &item.source) {
                Ok((status, remote_commit)) => UpdateCheck {
                    entry_id: item.discovered.entry_id.clone(),
                    status,
                    remote_commit,
                    error: None,
                },
                Err(err) => UpdateCheck {
                    entry_id: item.discovered.entry_id.clone(),
                    status: UpdateStatus::Untracked,
                    remote_commit: None,
                    error: Some(err.to_string()),
                },
            };
            let completed = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            let _ = on_progress.send(CheckProgress {
                done: completed,
                total,
            });
            check
        })
        .collect();

    Ok(checks)
}

/// What an update or restore would do.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ReviewHandle {
    /// Pass this back to apply or cancel.
    pub review_id: String,
    pub entry_id: String,
    pub lines: Vec<DiffLine>,
    pub stats: DiffStats,
    pub companions: Vec<CompanionChange>,
    /// The commit that would be recorded.
    pub commit: String,
    /// The repository moved on, but nothing about this item did.
    pub unchanged: bool,
}

/// Fetches the other version and works out what differs, without touching the
/// local copy.
#[tauri::command]
#[specta::specta]
pub async fn prepare_review(
    entry_id: String,
    mode: ReviewMode,
    state: State<'_, AppState>,
) -> CommandResult<ReviewHandle> {
    state.sweep_reviews();
    let item = find(&state, &entry_id)?;

    let review =
        install::prepare_review(&SystemGit, &item.source, &item.discovered.source_path, mode)?;

    let handle = ReviewHandle {
        review_id: format!("rev-{}", jiff::Timestamp::now().as_nanosecond()),
        entry_id: entry_id.clone(),
        lines: review.lines.clone(),
        stats: review.stats,
        companions: review.companions.clone(),
        commit: review.commit.clone(),
        unchanged: review.unchanged,
    };

    lock(&state.reviews)?.insert(
        handle.review_id.clone(),
        PendingReview {
            review,
            entry_id,
            prepared_at: Instant::now(),
        },
    );

    Ok(handle)
}

/// Replaces the local copy with the version the review showed.
///
/// A review whose diff showed nothing still advances the recorded commit, so
/// the item stops being reported as stale for a change that was not about it.
#[tauri::command]
#[specta::specta]
pub async fn apply_review(
    review_id: String,
    state: State<'_, AppState>,
) -> CommandResult<ItemMetadata> {
    let pending = lock(&state.reviews)?.remove(&review_id).ok_or_else(|| {
        CommandError::new(
            "unknown-review",
            "That review has expired. Check for updates again.",
        )
    })?;

    if !pending.review.unchanged {
        install::apply_review(&pending.review)?;
    }

    let item = find(&state, &pending.entry_id)?;
    let mut source = item.source.clone();
    source.source_commit = Some(pending.review.commit.clone());

    let updated = {
        let guard = lock(&state.store)?;
        let store = guard
            .as_ref()
            .ok_or_else(CommandError::no_metadata_folder)?;
        store.update(
            &pending.entry_id,
            &MetaPatch {
                source: Some(source),
                ..MetaPatch::default()
            },
        )?
    };

    replace_in_snapshot(&state, &updated)?;
    Ok(updated)
}

/// Throws a review away, and the clone it was holding with it.
#[tauri::command]
#[specta::specta]
pub fn cancel_review(review_id: String, state: State<'_, AppState>) -> CommandResult<()> {
    lock(&state.reviews)?.remove(&review_id);
    Ok(())
}

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
