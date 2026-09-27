//! Putting a scan together: look at the disk, record what is there, and report
//! what could not be done.
//!
//! The order matters. Items are recorded before anything is pruned, and pruning
//! is handed the evidence it needs to decide whether it is entitled to act at
//! all — which roots were covered, and whether any of them failed to be read.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rayon::prelude::*;

use crate::error::Result;
use crate::model::{
    BrokenSymlink, DiscoveredItem, ItemMetadata, PluginSource, ProjectWorkspace, ScanWarning,
    ToolConfig,
};
use crate::scan;
use crate::store::MetaStore;
use crate::store::prune::{PruneOutcome, PruneRequest};

/// What to scan.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RescanOptions {
    /// Skip the plugin bundle walk. Only for a targeted refresh; a full scan
    /// that left bundles out would look to the store like every bundled item
    /// had been deleted.
    #[serde(default)]
    pub skip_plugins: bool,
}

/// How far along a scan is.
///
/// Reported as it happens so a long scan shows a count rather than a spinner.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase", tag = "stage")]
pub enum Progress {
    Scanning {
        /// The tool or project currently being walked.
        source: String,
        done: u32,
        total: u32,
    },
    Recording {
        done: u32,
        total: u32,
    },
    Finished,
}

/// Everything the user interface needs after a scan.
#[derive(Debug, Clone, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySnapshot {
    pub items: Vec<ItemMetadata>,
    pub plugins: Vec<PluginSource>,
    pub broken_symlinks: Vec<BrokenSymlink>,
    pub warnings: Vec<ScanWarning>,
    /// When the scan ran, as RFC 3339 — the same form the notes use.
    pub scanned_at: String,
    /// Increments with every scan.
    ///
    /// The frontend keys its derived state on this, so "a scan happened"
    /// invalidates everything at once rather than through a dozen
    /// hand-maintained call sites.
    pub version: u32,
    /// Notes kept for items that are no longer on disk.
    pub orphan_count: u32,
}

/// What a scan needs to know.
#[derive(Debug, Clone, Copy)]
pub struct RescanInput<'a> {
    pub tools: &'a [ToolConfig],
    pub projects: &'a [ProjectWorkspace],
    pub home: &'a Path,
    pub store: &'a MetaStore,
}

/// Scans everything, records it, and prunes what is entitled to be pruned.
pub fn perform_rescan(
    input: RescanInput<'_>,
    options: RescanOptions,
    version: u32,
    progress: &(dyn Fn(Progress) + Sync),
) -> Result<LibrarySnapshot> {
    let mut outcome = walk(input, options, progress);
    let plugin_scan = if options.skip_plugins {
        scan::PluginScan::default()
    } else {
        scan::scan_all_plugins(input.tools, input.home)
    };
    outcome.items.extend(plugin_scan.items);

    let broken = scan::scan_broken_symlinks(input.tools, input.projects, input.home);
    let items = record(input.store, &outcome.items, progress)?;

    prune(input.store, &items, &broken, &outcome.warnings)?;
    progress(Progress::Finished);

    Ok(LibrarySnapshot {
        items,
        plugins: plugin_scan.plugins,
        broken_symlinks: broken,
        warnings: outcome.warnings,
        scanned_at: crate::store::now_rfc3339(),
        version,
        orphan_count: u32::try_from(input.store.orphans()?.len()).unwrap_or(u32::MAX),
    })
}

/// Walks every root, one task per tool and per project.
///
/// Each root is independent and the work is dominated by reading small files,
/// so this is worth parallelising: it is the difference between a scan the user
/// waits for and one they do not notice.
fn walk(
    input: RescanInput<'_>,
    _options: RescanOptions,
    progress: &(dyn Fn(Progress) + Sync),
) -> scan::ScanOutcome {
    enum Root<'a> {
        Global(&'a ToolConfig),
        Project(&'a ProjectWorkspace),
    }

    let roots: Vec<Root<'_>> = input
        .tools
        .iter()
        .map(Root::Global)
        .chain(input.projects.iter().map(Root::Project))
        .collect();
    let total = roots.len();
    let done = std::sync::atomic::AtomicUsize::new(0);

    roots
        .par_iter()
        .map(|root| {
            let (name, outcome) = match root {
                Root::Global(tool) => (tool.id.clone(), scan::scan_tool(tool, input.home)),
                Root::Project(project) => (
                    project.name.clone(),
                    scan::scan_project(input.tools, project, input.home),
                ),
            };
            let completed = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            progress(Progress::Scanning {
                source: name,
                done: narrow(completed),
                total: narrow(total),
            });
            outcome
        })
        .reduce(scan::ScanOutcome::default, |mut acc, next| {
            acc.items.extend(next.items);
            acc.warnings.extend(next.warnings);
            acc
        })
}

/// Records every item, in parallel — each writes its own file.
fn record(
    store: &MetaStore,
    items: &[DiscoveredItem],
    progress: &(dyn Fn(Progress) + Sync),
) -> Result<Vec<ItemMetadata>> {
    let total = items.len();
    let done = std::sync::atomic::AtomicUsize::new(0);

    items
        .par_iter()
        .map(|item| {
            let ensured = store.ensure(item)?;
            let completed = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            // Every hundredth, so the channel is not the bottleneck.
            if completed.is_multiple_of(100) || completed == total {
                progress(Progress::Recording {
                    done: narrow(completed),
                    total: narrow(total),
                });
            }
            Ok(ensured.metadata)
        })
        .collect()
}

fn prune(
    store: &MetaStore,
    items: &[ItemMetadata],
    broken: &[BrokenSymlink],
    warnings: &[ScanWarning],
) -> Result<PruneOutcome> {
    let found: HashSet<String> = items
        .iter()
        .map(|item| item.discovered.entry_id.clone())
        .collect();

    // A broken link's item is not "found", but it is not gone either: the file
    // is right there and the user can see that it is broken. Matching on the
    // recorded source path is how a note is tied back to one.
    let broken_paths: HashSet<&Path> = broken.iter().map(|link| link.path.as_path()).collect();
    let broken_ids = store
        .load_all()?
        .notes
        .into_iter()
        .filter(|(_, note)| is_behind_broken_link(&note.front.source_path, &broken_paths))
        .map(|(entry_id, _)| entry_id)
        .collect();

    store.prune(&PruneRequest {
        found,
        broken: broken_ids,
        full_scan: true,
        had_warnings: !warnings.is_empty(),
    })
}

/// Whether a recorded path is, or sits inside, a link that no longer resolves.
fn is_behind_broken_link(source_path: &str, broken: &HashSet<&Path>) -> bool {
    let path = PathBuf::from(source_path);
    broken.contains(path.as_path()) || path.parent().is_some_and(|parent| broken.contains(parent))
}

/// Counts cross the IPC boundary, where 64-bit integers cannot be held
/// exactly. Saturating is right: a count this large is already meaningless.
fn narrow(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}
