//! Showing what an update would change.
//!
//! A skill is usually a folder, so this is two things. The manifest gets a
//! real line-by-line diff with the changed words picked out. Everything else
//! in the folder — a `references/`, a `scripts/` — gets a byte comparison and
//! a verdict, because a side-by-side of a PNG helps nobody.
//!
//! Without this, applying an update is a leap of faith: the local copy is
//! overwritten and whatever was in it is gone.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use similar::{ChangeTag, TextDiff};

/// One rendered line of a diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    /// `+` added, `-` removed, ` ` unchanged.
    pub marker: char,
    /// Line number in whichever side this line belongs to.
    pub number: Option<u32>,
    pub segments: Vec<Segment>,
}

/// A run of text within a line.
///
/// `emphasis` marks the part that actually differs, so an added line that
/// changed one word does not read as though all of it is new.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub text: String,
    pub emphasis: bool,
}

/// How much changed, for a summary before anyone reads the detail.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct DiffStats {
    pub added: u32,
    pub removed: u32,
}

/// What happened to one of a skill's other files.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CompanionChange {
    /// Path relative to the skill's folder.
    pub path: String,
    pub status: CompanionStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum CompanionStatus {
    Added,
    Removed,
    Modified,
}

/// Lines of difference between two texts, with the changed words marked.
///
/// `similar`'s inline changes give the line structure and the word-level
/// detail in one pass, so there is no second diff and no guessing at which
/// removed line pairs with which added one.
#[must_use]
pub fn build_diff_lines(old: &str, new: &str) -> Vec<DiffLine> {
    let diff = TextDiff::from_lines(old, new);
    let mut lines = Vec::new();

    for group in diff.grouped_ops(3) {
        for op in group {
            for change in diff.iter_inline_changes(&op) {
                let marker = match change.tag() {
                    ChangeTag::Delete => '-',
                    ChangeTag::Insert => '+',
                    ChangeTag::Equal => ' ',
                };
                let number = match change.tag() {
                    ChangeTag::Delete => change.old_index(),
                    _ => change.new_index(),
                }
                .and_then(|index| u32::try_from(index + 1).ok());

                let segments = change
                    .iter_strings_lossy()
                    .map(|(emphasis, text)| Segment {
                        text: text.trim_end_matches('\n').to_owned(),
                        emphasis,
                    })
                    .collect();

                lines.push(DiffLine {
                    marker,
                    number,
                    segments,
                });
            }
        }
    }

    lines
}

/// How many lines were added and removed.
///
/// Counted from the same lines that get rendered, so the summary cannot
/// disagree with what is underneath it.
#[must_use]
pub fn diff_stats(lines: &[DiffLine]) -> DiffStats {
    let mut stats = DiffStats::default();
    for line in lines {
        match line.marker {
            '+' => stats.added += 1,
            '-' => stats.removed += 1,
            _ => {}
        }
    }
    stats
}

/// Whether two texts are the same.
#[must_use]
pub fn is_unchanged(old: &str, new: &str) -> bool {
    old == new
}

/// What changed among a skill's other files.
///
/// Compared byte for byte. Hashing would be faster on large files and these
/// are not large; reading both is simpler and cannot collide.
#[must_use]
pub fn companion_changes(old_dir: &Path, new_dir: &Path, manifest: &str) -> Vec<CompanionChange> {
    let old_files = list_files(old_dir, manifest);
    let new_files = list_files(new_dir, manifest);

    let all: BTreeSet<&String> = old_files.union(&new_files).collect();
    let mut changes = Vec::new();

    for path in all {
        let in_old = old_files.contains(path);
        let in_new = new_files.contains(path);

        let status = match (in_old, in_new) {
            (true, false) => CompanionStatus::Removed,
            (false, true) => CompanionStatus::Added,
            (true, true) => {
                if same_bytes(&old_dir.join(path), &new_dir.join(path)) {
                    continue;
                }
                CompanionStatus::Modified
            }
            (false, false) => continue,
        };
        changes.push(CompanionChange {
            path: path.clone(),
            status,
        });
    }

    changes
}

/// Every file under a directory except the manifest, relative and posix-style.
fn list_files(dir: &Path, manifest: &str) -> BTreeSet<String> {
    if !dir.is_dir() {
        return BTreeSet::new();
    }

    walkdir::WalkDir::new(dir)
        .follow_links(false)
        .into_iter()
        .filter_map(std::result::Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| !entry.path().components().any(|c| c.as_os_str() == ".git"))
        .filter_map(|entry| {
            let relative = entry.path().strip_prefix(dir).ok()?;
            let joined: Vec<String> = relative
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect();
            let path = joined.join("/");
            (path != manifest).then_some(path)
        })
        .collect()
}

fn same_bytes(a: &Path, b: &Path) -> bool {
    match (std::fs::read(a), std::fs::read(b)) {
        (Ok(left), Ok(right)) => left == right,
        // Unreadable on either side counts as different: better to show it as
        // a change than to claim nothing happened.
        _ => false,
    }
}

/// The path a companion change refers to, under a given folder.
#[must_use]
pub fn companion_path(folder: &Path, relative: &str) -> PathBuf {
    relative
        .split('/')
        .fold(folder.to_path_buf(), |path, part| path.join(part))
}
