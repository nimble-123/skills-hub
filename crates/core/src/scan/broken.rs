//! Finding symlinks that no longer resolve.
//!
//! A separate walk from the item scan, and necessarily so: the item scan calls
//! `metadata`, which follows links and therefore cannot see a dangling one. This
//! walk calls `symlink_metadata`, which does not follow, and then asks whether
//! the target exists.
//!
//! These are worth surfacing rather than silently skipping. A dangling link is
//! usually a tool that was uninstalled or a shared skills folder that moved, and
//! the item's metadata must be kept until the user decides what to do about it.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::model::{BrokenSymlink, ItemType, ProjectWorkspace, ToolConfig};
use crate::paths;

/// How deep to look. One level more than the item scan, because a manifest
/// inside a skill folder is itself a plausible link.
const MAX_DEPTH: usize = 5;

/// Every dangling symlink under the configured roots, global and per project.
#[must_use]
pub fn scan_broken_symlinks(
    tools: &[ToolConfig],
    projects: &[ProjectWorkspace],
    home: &Path,
) -> Vec<BrokenSymlink> {
    let mut found = Vec::new();
    let mut seen = HashSet::new();

    for tool in tools {
        for item_type in ItemType::ALL {
            for project in std::iter::once(None).chain(projects.iter().map(Some)) {
                let Some(root) = paths::resolve_tool_dir(tool, item_type, project, home) else {
                    continue;
                };
                let scope = Scope {
                    tool: &tool.id,
                    item_type,
                    project_id: project.map(|p| p.id.as_str()),
                };
                collect(&root, scope, 0, &mut seen, &mut found);
            }
        }
    }

    found.sort_by(|a, b| a.path.cmp(&b.path));
    found
}

#[derive(Clone, Copy)]
struct Scope<'a> {
    tool: &'a str,
    item_type: ItemType,
    project_id: Option<&'a str>,
}

fn collect(
    path: &Path,
    scope: Scope<'_>,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    found: &mut Vec<BrokenSymlink>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let Ok(meta) = std::fs::symlink_metadata(path) else {
        return;
    };

    if meta.file_type().is_symlink() {
        if path.exists() {
            // Resolves fine. Deliberately not descended into: a working link is
            // the item scan's business, and following it here risks a loop.
            return;
        }
        if seen.insert(path.to_path_buf()) {
            found.push(describe(path, scope));
        }
        return;
    }

    if !meta.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        // The disabled folder holds items the user parked on purpose; a link in
        // there pointing nowhere is the same problem, so it is not skipped —
        // only `.git` and `node_modules`, which are never ours.
        if name == "node_modules" || name == ".git" {
            continue;
        }
        collect(&entry.path(), scope, depth + 1, seen, found);
    }
}

fn describe(path: &Path, scope: Scope<'_>) -> BrokenSymlink {
    let raw = std::fs::read_link(path).unwrap_or_default();
    let resolved = crate::platform::read_link_absolute(path).unwrap_or_else(|_| raw.clone());

    BrokenSymlink {
        path: path.to_path_buf(),
        target: raw.to_string_lossy().into_owned(),
        target_path: resolved,
        tool: scope.tool.to_owned(),
        item_type: scope.item_type,
        project_id: scope.project_id.map(ToOwned::to_owned),
    }
}
