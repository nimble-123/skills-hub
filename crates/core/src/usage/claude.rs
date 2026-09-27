//! Reading Claude Code's own session history.
//!
//! `~/.claude/projects/<project>/<session>.jsonl`, one JSON object per line.
//! What counts is an assistant message containing a `tool_use` block for the
//! `Skill` or `Agent` tool; everything else in these files — and it is almost
//! everything — is skipped before it is parsed.

use std::borrow::Cow;
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde::Deserialize;

use super::{RawUsage, UsageStats};

/// Where Claude Code keeps its transcripts, relative to the home directory.
const PROJECTS_DIR: &str = ".claude/projects";

/// A line without this cannot contain an invocation, and checking is around
/// fifty times cheaper than parsing. Transcripts are hundreds of megabytes,
/// and the overwhelming majority of lines are not this.
const MARKER: &str = "\"tool_use\"";

/// `Cow` rather than `&str` throughout.
///
/// serde can only lend a `&str` out of JSON when the string has no escape
/// sequences. Nothing read here usually has one, but a line that did would
/// fail to parse and be skipped without a word, which is the worst way for a
/// count to be wrong.
#[derive(Deserialize)]
struct Entry<'a> {
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>,
    #[serde(borrow)]
    timestamp: Option<Cow<'a, str>>,
    #[serde(borrow)]
    message: Option<Message<'a>>,
}

#[derive(Deserialize)]
struct Message<'a> {
    #[serde(borrow)]
    content: Option<Vec<Block<'a>>>,
}

#[derive(Deserialize)]
struct Block<'a> {
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>,
    #[serde(borrow)]
    name: Option<Cow<'a, str>>,
    #[serde(borrow)]
    input: Option<Input<'a>>,
}

#[derive(Deserialize)]
struct Input<'a> {
    /// What the `Skill` tool is given.
    #[serde(borrow)]
    skill: Option<Cow<'a, str>>,
    /// What the `Agent` tool is given.
    #[serde(borrow)]
    subagent_type: Option<Cow<'a, str>>,
}

/// Every transcript, newest projects and all.
#[must_use]
pub fn transcript_files(home: &Path) -> Vec<PathBuf> {
    let root = home.join(PROJECTS_DIR);
    let Ok(projects) = std::fs::read_dir(&root) else {
        return Vec::new();
    };

    let mut files = Vec::new();
    for project in projects.flatten() {
        let Ok(sessions) = std::fs::read_dir(project.path()) else {
            continue;
        };
        files.extend(
            sessions
                .flatten()
                .map(|session| session.path())
                .filter(|path| path.extension().is_some_and(|ext| ext == "jsonl")),
        );
    }
    files.sort();
    files
}

/// Counts every skill and agent invocation in Claude Code's history.
///
/// Files are read in parallel and streamed a line at a time: this history
/// runs to hundreds of megabytes, and reading it whole would cost more memory
/// than the rest of the application put together.
#[must_use]
pub fn scan(home: &Path, on_file: &(dyn Fn(u32, u32) + Sync)) -> RawUsage {
    let files = transcript_files(home);
    let total = u32::try_from(files.len()).unwrap_or(u32::MAX);
    let done = std::sync::atomic::AtomicU32::new(0);

    files
        .par_iter()
        .map(|path| {
            let usage = scan_file(path);
            let completed = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            on_file(completed, total);
            usage
        })
        .reduce(HashMap::new, merge)
}

fn scan_file(path: &Path) -> RawUsage {
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
        if entry.kind.as_deref() != Some("assistant") {
            continue;
        }
        let Some(blocks) = entry.message.and_then(|message| message.content) else {
            continue;
        };

        for block in blocks {
            if block.kind.as_deref() != Some("tool_use") {
                continue;
            }
            if let Some(key) = key_for(block.name.as_deref(), block.input.as_ref()) {
                usage
                    .entry(key)
                    .or_default()
                    .record(entry.timestamp.as_deref());
            }
        }
    }
    usage
}

/// The invocation this block records, if it records one.
fn key_for(name: Option<&str>, input: Option<&Input<'_>>) -> Option<String> {
    let input = input?;
    match name? {
        "Skill" => input.skill.as_deref().map(|skill| format!("skill:{skill}")),
        "Agent" | "Task" => input
            .subagent_type
            .as_deref()
            .map(|agent| format!("agent:{agent}")),
        _ => None,
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
