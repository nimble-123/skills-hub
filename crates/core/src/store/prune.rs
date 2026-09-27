//! Removing notes for items that are gone.
//!
//! This is the most dangerous code in the application: it deletes things the
//! user wrote, on the strength of a scan having not found something. A scan can
//! fail to find something for reasons that have nothing to do with the item —
//! a volume that is not mounted, a folder macOS has not been given consent to
//! read, a tool mid-reinstall. So the question is never "was it found?" but
//! "am I entitled to conclude it is gone?".
//!
//! Four things stand between a missing item and a deleted note:
//!
//! 1. A scan that produced warnings, or found nothing at all, prunes nothing.
//! 2. A scan of one tool or one project prunes nothing — only a full scan can.
//! 3. A note is marked `orphanedAt` first and only deleted after a grace
//!    period, so a transient absence costs nothing.
//! 4. A note carrying anything the user put there is never deleted at all; it
//!    is listed instead, for them to decide.
//!
//! And what is deleted goes to the trash, not to nothing.

use std::collections::HashSet;
use std::path::PathBuf;

use crate::error::{CoreError, Result};
use crate::store::MetaStore;

/// How long a note stays after its item stopped being found.
pub const ORPHAN_GRACE: jiff::SignedDuration = jiff::SignedDuration::from_hours(24 * 14);

/// What the caller is asking the store to prune, and what it may rely on.
#[derive(Debug, Clone)]
pub struct PruneRequest {
    /// Entry ids the scan found.
    pub found: HashSet<String>,
    /// Ids whose item is currently a broken symlink.
    ///
    /// Not found, but not gone either — the file is right there and the user
    /// can see it is broken. Keeping the note is what lets them fix it.
    pub broken: HashSet<String>,
    /// Whether the scan covered every configured root.
    pub full_scan: bool,
    /// Whether any root failed to be read.
    pub had_warnings: bool,
}

/// What pruning did, or declined to do.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PruneOutcome {
    /// Notes newly marked as orphaned.
    pub marked: Vec<String>,
    /// Notes moved to the trash.
    pub trashed: Vec<String>,
    /// Notes kept past the grace period because the user put something in them.
    pub retained_with_user_data: Vec<String>,
    /// Why nothing was pruned, when nothing was.
    pub skipped: Option<SkipReason>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// A partial scan cannot tell a missing item from an unvisited one.
    PartialScan,
    /// Something could not be read, so the scan is not evidence of absence.
    ScanHadWarnings,
    /// Nothing at all was found, which is far more likely to be a broken scan
    /// than an emptied machine.
    ScanFoundNothing,
}

impl std::fmt::Display for SkipReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::PartialScan => "the scan covered only part of the library",
            Self::ScanHadWarnings => "some folders could not be read",
            Self::ScanFoundNothing => "the scan found no items at all",
        })
    }
}

impl MetaStore {
    /// Marks or removes notes whose items are gone.
    pub fn prune(&self, request: &PruneRequest) -> Result<PruneOutcome> {
        if let Some(reason) = refuse(request) {
            return Ok(PruneOutcome {
                skipped: Some(reason),
                ..PruneOutcome::default()
            });
        }

        let loaded = self.load_all()?;
        let now = jiff::Timestamp::now();
        let mut outcome = PruneOutcome::default();

        for (entry_id, note) in loaded.notes {
            if request.found.contains(&entry_id) || request.broken.contains(&entry_id) {
                continue;
            }

            let Some(orphaned_at) = note.front.orphaned_at.as_ref() else {
                // First scan that missed it: mark, do not delete.
                let mut marked = note;
                marked.front.orphaned_at = Some(now.to_string());
                self.write(&self.note_path(&entry_id), &marked)?;
                outcome.marked.push(entry_id);
                continue;
            };

            if !past_grace(orphaned_at, now) {
                continue;
            }
            if note.front.has_user_data() {
                outcome.retained_with_user_data.push(entry_id);
                continue;
            }

            Self::trash(&self.note_path(&entry_id))?;
            outcome.trashed.push(entry_id);
        }

        Ok(outcome)
    }

    /// Notes whose items are gone and which are being kept because of what is
    /// in them. Shown to the user so the decision is theirs.
    pub fn orphans(&self) -> Result<Vec<Orphan>> {
        Ok(self
            .load_all()?
            .notes
            .into_iter()
            .filter_map(|(entry_id, note)| {
                let orphaned_at = note.front.orphaned_at.clone()?;
                Some(Orphan {
                    entry_id,
                    name: note.front.name.clone(),
                    tool: note.front.tool.clone(),
                    orphaned_at,
                    has_user_data: note.front.has_user_data(),
                    path: note.front.source_path.clone().into(),
                })
            })
            .collect())
    }

    /// Removes notes the user has decided to let go of.
    pub fn forget(&self, entry_ids: &[String]) -> Result<usize> {
        let mut removed = 0;
        for entry_id in entry_ids {
            let path = self.note_path(entry_id);
            if path.exists() {
                Self::trash(&path)?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    /// To the operating system's trash, never to nothing.
    ///
    /// A failure here leaves the note where it is and is reported. A stale file
    /// is a far smaller harm than one destroyed irrecoverably.
    fn trash(path: &std::path::Path) -> Result<()> {
        crate::platform::move_to_trash(path).map_err(|err| CoreError::Trash {
            path: path.to_path_buf(),
            reason: err.to_string(),
        })
    }
}

/// A note whose item is no longer on disk.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Orphan {
    pub entry_id: String,
    pub name: String,
    pub tool: String,
    pub orphaned_at: String,
    pub has_user_data: bool,
    pub path: PathBuf,
}

fn refuse(request: &PruneRequest) -> Option<SkipReason> {
    if !request.full_scan {
        return Some(SkipReason::PartialScan);
    }
    if request.had_warnings {
        return Some(SkipReason::ScanHadWarnings);
    }
    if request.found.is_empty() {
        return Some(SkipReason::ScanFoundNothing);
    }
    None
}

/// Whether a recorded orphan timestamp is old enough to act on.
///
/// A timestamp that cannot be parsed counts as *not* past the grace period: a
/// note nobody can date is not a note to delete.
fn past_grace(orphaned_at: &str, now: jiff::Timestamp) -> bool {
    orphaned_at
        .parse::<jiff::Timestamp>()
        .is_ok_and(|then| now.duration_since(then) >= ORPHAN_GRACE)
}
