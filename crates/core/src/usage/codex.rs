//! Reading Codex's own session history.
//!
//! `~/.codex/sessions/<year>/<month>/<day>/<session>.jsonl`. Codex has no
//! equivalent of a skill tool, so there is no invocation to count. What there
//! is, is the shell it ran — and a skill being used shows up as its path
//! appearing in a command.
//!
//! That is inference, not a record, and it is treated as such: only the input
//! of a tool call is searched, never the whole line. A session file also
//! contains the system prompt and the catalogue of every available skill, so
//! searching whole lines would report everything installed as used.

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde::Deserialize;

use super::{RawUsage, UsageStats};
use crate::model::{ItemMetadata, ItemType};

const SESSIONS_DIR: &str = ".codex/sessions";

/// Cheap check before parsing. Sessions here run to hundreds of megabytes.
const MARKER: &str = "_call";

/// `Cow` rather than `&str` throughout.
///
/// serde can only lend a `&str` out of JSON when the string has no escape
/// sequences, and a recorded shell command is nothing but escaped quotes —
/// so borrowing outright makes every line that matters fail to parse and be
/// skipped, silently. `Cow` borrows where it can and allocates where it must.
#[derive(Deserialize)]
struct Entry<'a> {
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>,
    #[serde(borrow)]
    timestamp: Option<Cow<'a, str>>,
    #[serde(borrow)]
    payload: Option<Payload<'a>>,
}

#[derive(Deserialize)]
struct Payload<'a> {
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>,
    /// A custom tool call carries its command here.
    #[serde(borrow)]
    input: Option<Cow<'a, str>>,
    /// A function call carries it here instead.
    #[serde(borrow)]
    arguments: Option<Cow<'a, str>>,
}

/// What to look for: one item, and the folder name it lives under.
#[derive(Debug, Clone)]
pub struct Needle {
    pub key: String,
    /// The item's name, as it appears in a path.
    name: String,
}

/// What to search for, built once from the items Codex knows about.
///
/// Built once because the search runs over every command in every session:
/// rebuilding this per line, as the Obsidian plugin did, makes it the cost of
/// the scan rather than a detail of it.
#[must_use]
pub fn needles(items: &[ItemMetadata]) -> Vec<Needle> {
    items
        .iter()
        .filter(|item| item.discovered.tool == "codex")
        .filter(|item| matches!(item.discovered.item_type, ItemType::Skill | ItemType::Agent))
        .map(|item| Needle {
            key: super::invocation_key(item),
            name: item.discovered.name.clone(),
        })
        .collect()
}

#[must_use]
pub fn session_files(home: &Path) -> Vec<PathBuf> {
    let root = home.join(SESSIONS_DIR);
    if !root.is_dir() {
        return Vec::new();
    }

    let mut files: Vec<PathBuf> = walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .map(walkdir::DirEntry::into_path)
        .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl"))
        .collect();
    files.sort();
    files
}

/// Counts how often each item's path turns up in a command Codex ran.
#[must_use]
pub fn scan(home: &Path, needles: &[Needle], on_file: &(dyn Fn(u32, u32) + Sync)) -> RawUsage {
    if needles.is_empty() {
        return HashMap::new();
    }

    let files = session_files(home);
    let total = u32::try_from(files.len()).unwrap_or(u32::MAX);
    let done = std::sync::atomic::AtomicU32::new(0);

    files
        .par_iter()
        .map(|path| {
            let usage = scan_file(path, needles);
            let completed = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            on_file(completed, total);
            usage
        })
        .reduce(HashMap::new, merge)
}

fn scan_file(path: &Path, needles: &[Needle]) -> RawUsage {
    let Ok(file) = std::fs::File::open(path) else {
        return HashMap::new();
    };

    let mut usage = RawUsage::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if !line.contains(MARKER) {
            continue;
        }
        let Ok(entry) = serde_json::from_str::<Entry<'_>>(&line) else {
            continue;
        };
        if entry.kind.as_deref() != Some("response_item") {
            continue;
        }
        let Some(payload) = entry.payload else {
            continue;
        };
        if !matches!(
            payload.kind.as_deref(),
            Some("custom_tool_call" | "function_call")
        ) {
            continue;
        }
        let Some(command) = payload.input.as_deref().or(payload.arguments.as_deref()) else {
            continue;
        };

        for needle in needles {
            if mentions(command, &needle.name) {
                usage
                    .entry(needle.key.clone())
                    .or_default()
                    .record(entry.timestamp.as_deref());
            }
        }
    }
    usage
}

/// Whether a command refers to this item by path.
///
/// Matched as a whole path segment following a skills or agents folder, so a
/// skill called `pdf` is not counted every time the word appears in a
/// filename.
fn mentions(command: &str, name: &str) -> bool {
    for folder in [".codex/skills/", ".codex/agents/"] {
        let mut rest = command;
        while let Some(at) = rest.find(folder) {
            let after = &rest[at + folder.len()..];
            if segment_is(after, name) {
                return true;
            }
            rest = &rest[at + folder.len()..];
        }
    }
    false
}

/// Whether the text begins with this name as a complete path segment.
fn segment_is(after: &str, name: &str) -> bool {
    // Walk any intermediate category folders.
    let mut candidate = after;
    loop {
        let Some(stripped) = candidate.strip_prefix(name) else {
            // Skip one segment and try again: skills may sit in categories.
            let Some(slash) = candidate.find('/') else {
                return false;
            };
            candidate = &candidate[slash + 1..];
            continue;
        };
        return stripped.is_empty()
            || stripped.starts_with('/')
            || stripped.starts_with(".md")
            || stripped.starts_with(char::is_whitespace)
            || stripped.starts_with(['"', '\'', '\\']);
    }
}

fn merge(mut into: RawUsage, other: RawUsage) -> RawUsage {
    for (key, stats) in other {
        let target: &mut UsageStats = into.entry(key).or_default();
        target.count += stats.count;
        if target.last_used < stats.last_used {
            target.last_used = stats.last_used;
        }
    }
    into
}
