//! Walking a tool's folders and turning what is there into items.
//!
//! Two shapes exist on disk and no others: a folder containing a `SKILL.md`,
//! where the folder is the item, and a flat `.md` file, where the file is. A
//! folder that is neither is treated as a category and descended into, which is
//! what makes `skills/engineering/tdd/SKILL.md` work.
//!
//! Disabled items sit in a `.skillmanager-disabled` folder beside their former
//! neighbours — beside, note, at whatever depth they were. So the enabled and
//! disabled halves have to be paired at *every* level of the walk, not only at
//! the configured root.

pub mod broken;
pub mod plugins;

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::fsunit::{DISABLED_DIRNAME, SKILL_MANIFEST};
use crate::model::{
    DiscoveredItem, ItemType, ProjectWorkspace, ScanWarning, ScanWarningKind, ToolConfig,
};
use crate::{frontmatter, ids, paths};

/// How far below a configured root the walk descends.
///
/// Four levels covers every category layout seen in practice while keeping a
/// mis-configured path — someone's home directory, a monorepo — from turning
/// into a full-disk crawl.
pub const MAX_SCAN_DEPTH: usize = 4;

pub use broken::scan_broken_symlinks;
pub use plugins::{PluginScan, scan_all_plugins};

/// Directory names never descended into.
const SKIP_DIRNAMES: [&str; 3] = [DISABLED_DIRNAME, "node_modules", ".git"];

/// What one scan found, and what it could not do.
#[derive(Debug, Default)]
pub struct ScanOutcome {
    pub items: Vec<DiscoveredItem>,
    pub warnings: Vec<ScanWarning>,
}

impl ScanOutcome {
    fn absorb(&mut self, other: Self) {
        self.items.extend(other.items);
        self.warnings.extend(other.warnings);
    }
}

impl Extend<ScanOutcome> for ScanOutcome {
    fn extend<T: IntoIterator<Item = ScanOutcome>>(&mut self, iter: T) {
        for outcome in iter {
            self.absorb(outcome);
        }
    }
}

/// Scans every tool at the global scope.
#[must_use]
pub fn scan_all_tools(tools: &[ToolConfig], home: &Path) -> ScanOutcome {
    let mut outcome = ScanOutcome::default();
    for tool in tools {
        outcome.absorb(scan_tool(tool, home));
    }
    outcome
}

/// Scans one tool's global folders.
///
/// A tool marked `disabled` is still scanned. Skipping it would make every one
/// of its items look deleted, and the metadata store would then be entitled to
/// throw away the user's tags for all of them. Hiding is the user interface's
/// job, not the scanner's.
#[must_use]
pub fn scan_tool(tool: &ToolConfig, home: &Path) -> ScanOutcome {
    scan_scope(tool, None, home)
}

/// Scans every tool inside one project folder.
#[must_use]
pub fn scan_project(tools: &[ToolConfig], project: &ProjectWorkspace, home: &Path) -> ScanOutcome {
    let mut outcome = ScanOutcome::default();
    for tool in tools {
        outcome.absorb(scan_scope(tool, Some(project), home));
    }
    outcome
}

/// Scans every tool in every project folder.
#[must_use]
pub fn scan_all_projects(
    tools: &[ToolConfig],
    projects: &[ProjectWorkspace],
    home: &Path,
) -> ScanOutcome {
    let mut outcome = ScanOutcome::default();
    for project in projects {
        outcome.absorb(scan_project(tools, project, home));
    }
    outcome
}

fn scan_scope(tool: &ToolConfig, project: Option<&ProjectWorkspace>, home: &Path) -> ScanOutcome {
    let mut outcome = ScanOutcome::default();

    for item_type in ItemType::ALL {
        let Some(root) = paths::resolve_tool_dir(tool, item_type, project, home) else {
            continue;
        };

        let scope = Scope {
            tool_id: &tool.id,
            item_type,
            project_id: project.map(|p| p.id.as_str()),
            plugin_id: None,
        };
        let mut walk = Walk::new(scope);

        if item_type == ItemType::Rule && tool.single_file_rule {
            walk.single_file(&root);
        } else {
            walk.directory(&root);
        }

        outcome.absorb(walk.finish());
    }

    outcome.absorb(scan_additional_rule_paths(tool, project, home));
    outcome
}

/// Extra rule locations the user added beyond the tool's configured one.
fn scan_additional_rule_paths(
    tool: &ToolConfig,
    project: Option<&ProjectWorkspace>,
    home: &Path,
) -> ScanOutcome {
    let entries = match project {
        None => &tool.rule_additional_paths,
        Some(_) => &tool.rule_additional_project_paths,
    };

    let mut outcome = ScanOutcome::default();
    for entry in entries {
        let root = match project {
            None => paths::expand_home(&entry.path, home),
            Some(project) => project.path.join(&entry.path),
        };

        let mut walk = Walk::new(Scope {
            tool_id: &tool.id,
            item_type: ItemType::Rule,
            project_id: project.map(|p| p.id.as_str()),
            plugin_id: None,
        });

        if entry.single_file {
            walk.single_file(&root);
        } else {
            walk.directory(&root);
        }
        outcome.absorb(walk.finish());
    }
    outcome
}

/// Which tool, type and scope the items being found belong to.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Scope<'a> {
    pub tool_id: &'a str,
    pub item_type: ItemType,
    pub project_id: Option<&'a str>,
    pub plugin_id: Option<&'a str>,
}

/// One walk over one root, collecting items and whatever went wrong.
pub(crate) struct Walk<'a> {
    scope: Scope<'a>,
    items: Vec<DiscoveredItem>,
    warnings: Vec<ScanWarning>,
    /// Real paths of directories already entered.
    ///
    /// A symlink pointing at one of its own ancestors is otherwise an infinite
    /// descent that only the depth limit saves us from — and it would still
    /// report the same items several times over.
    visited_dirs: HashSet<PathBuf>,
}

impl<'a> Walk<'a> {
    pub(crate) fn new(scope: Scope<'a>) -> Self {
        Self {
            scope,
            items: Vec::new(),
            warnings: Vec::new(),
            visited_dirs: HashSet::new(),
        }
    }

    pub(crate) fn finish(self) -> ScanOutcome {
        ScanOutcome {
            items: self.items,
            warnings: self.warnings,
        }
    }

    /// Walks a configured root, pairing enabled and disabled halves.
    pub(crate) fn directory(&mut self, dir: &Path) {
        self.category(dir, true, 0);
    }

    /// Reads one instructions file that is itself a whole item.
    ///
    /// Used for `CLAUDE.md` and `AGENTS.md`, where the configured path names a
    /// file rather than a directory. Its disabled twin sits exactly where the
    /// generic move puts any lone file.
    pub(crate) fn single_file(&mut self, file: &Path) {
        let Some(file_name) = file.file_name().and_then(|n| n.to_str()) else {
            return;
        };
        let disabled = file
            .parent()
            .map(|parent| parent.join(DISABLED_DIRNAME).join(file_name));

        for (path, enabled) in [(Some(file.to_path_buf()), true), (disabled, false)] {
            let Some(path) = path else { continue };
            if !is_file(&path) {
                continue;
            }
            let fallback = file_name.trim_end_matches(".md");
            self.push_item(&path, file_name, fallback, enabled);
        }
    }

    /// A directory holding items, plus — when this half is the enabled one —
    /// its disabled sibling.
    fn category(&mut self, dir: &Path, enabled: bool, depth: usize) {
        self.entries(dir, enabled, depth);
        // Nothing is disabled within a disabled folder.
        if enabled {
            self.entries(&dir.join(DISABLED_DIRNAME), false, depth);
        }
    }

    fn entries(&mut self, dir: &Path, enabled: bool, depth: usize) {
        if depth > MAX_SCAN_DEPTH || !dir.exists() {
            return;
        }
        if !self.enter(dir) {
            return;
        }

        let read = match std::fs::read_dir(dir) {
            Ok(read) => read,
            // A configured "directory" may be a file — Cline's legacy
            // `.clinerules` was one. That is not worth a warning.
            Err(err) if err.kind() == std::io::ErrorKind::NotADirectory => return,
            Err(err) => {
                self.warn(dir, &err);
                return;
            }
        };

        for entry in read {
            let entry = match entry {
                Ok(entry) => entry,
                Err(err) => {
                    self.warn(dir, &err);
                    continue;
                }
            };
            self.entry(&entry.path(), enabled, depth);
        }
    }

    fn entry(&mut self, path: &Path, enabled: bool, depth: usize) {
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            return;
        };
        if SKIP_DIRNAMES.contains(&name) {
            return;
        }

        // `metadata` follows symlinks on purpose: a linked-in skill is a skill.
        // A dangling link throws here and is simply skipped — `scan::broken`
        // reports those separately.
        let Ok(meta) = std::fs::metadata(path) else {
            return;
        };

        if meta.is_dir() {
            let manifest = path.join(SKILL_MANIFEST);
            if manifest.is_file() {
                self.push_item(&manifest, name, name, enabled);
            } else {
                self.category(path, enabled, depth + 1);
            }
            return;
        }

        // Case-insensitive: the tools themselves are, and so is macOS's filesystem.
        if path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            self.push_item(path, name, &flat_file_name(name), enabled);
        }
    }

    fn push_item(&mut self, source_path: &Path, id_name: &str, fallback: &str, enabled: bool) {
        let meta = frontmatter::read_source_meta(source_path);
        let name = if meta.name.is_empty() {
            fallback.to_owned()
        } else {
            meta.name
        };

        self.items.push(DiscoveredItem {
            entry_id: ids::entry_id(
                self.scope.tool_id,
                self.scope.item_type,
                self.scope.project_id,
                self.scope.plugin_id,
                id_name,
                source_path,
            ),
            source_path: source_path.to_path_buf(),
            real_path: real_path(source_path),
            tool: self.scope.tool_id.to_owned(),
            item_type: self.scope.item_type,
            project_id: self.scope.project_id.map(ToOwned::to_owned),
            plugin_id: self.scope.plugin_id.map(ToOwned::to_owned),
            name,
            description: meta.description,
            enabled,
            modified: modified_rfc3339(source_path),
        });
    }

    /// Records a directory as entered. Returns false if it has been seen before.
    fn enter(&mut self, dir: &Path) -> bool {
        self.visited_dirs.insert(real_path(dir))
    }

    fn warn(&mut self, path: &Path, err: &std::io::Error) {
        let kind = if err.kind() == std::io::ErrorKind::PermissionDenied {
            ScanWarningKind::PermissionDenied
        } else {
            ScanWarningKind::Unreadable
        };
        self.warnings.push(ScanWarning {
            path: path.to_path_buf(),
            tool: Some(self.scope.tool_id.to_owned()),
            message: err.to_string(),
            kind,
        });
    }
}

/// The display name of a flat file, with a known compound suffix removed whole.
///
/// Copilot writes `foo.instructions.md` and `foo.prompt.md`; trimming only the
/// `.md` would leave the classifier dangling in the title.
fn flat_file_name(file_name: &str) -> String {
    for suffix in [".instructions.md", ".prompt.md", ".md"] {
        if let Some(stem) = file_name.strip_suffix(suffix) {
            return stem.to_owned();
        }
    }
    file_name.to_owned()
}

/// The path with symlinks resolved, falling back to the path itself.
#[must_use]
pub fn real_path(path: &Path) -> PathBuf {
    dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

fn is_file(path: &Path) -> bool {
    std::fs::metadata(path).is_ok_and(|meta| meta.is_file())
}

/// When a file was last written, in the same form the metadata notes use.
fn modified_rfc3339(path: &Path) -> Option<String> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    let seconds = modified
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .and_then(|since| i64::try_from(since.as_secs()).ok())?;
    jiff::Timestamp::from_second(seconds)
        .ok()
        .map(|ts| ts.to_string())
}
