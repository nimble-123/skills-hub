//! Making a global item visible inside a project.
//!
//! By symlink, never by copy. A copy is a second thing to keep in step with
//! the first, and the moment one is edited they have quietly diverged. A link
//! cannot diverge, and removing it takes nothing away from the original.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::fsunit::linkable_unit;
use crate::model::{ItemMetadata, ProjectWorkspace, ToolConfig};
use crate::{paths, platform};

/// Links an item into a project's folder for its tool and type.
///
/// Idempotent: a link that is already there is left alone.
///
/// Uses the same path resolution the scanner does, so the link lands where the
/// tool will actually look. The Obsidian plugin stripped `~/` off the global
/// path instead, which put a Copilot rule in `.copilot/instructions` when the
/// project convention is `.github/instructions` — somewhere nothing reads.
pub fn add_to_project(
    item: &ItemMetadata,
    tool: &ToolConfig,
    project: &ProjectWorkspace,
    home: &Path,
) -> Result<PathBuf> {
    let Some(target_dir) =
        paths::resolve_tool_dir(tool, item.discovered.item_type, Some(project), home)
    else {
        return Err(CoreError::NoProjectPath {
            tool: tool.id.clone(),
            item_type: item.discovered.item_type.to_string(),
        });
    };

    let unit = linkable_unit(&item.discovered.source_path);
    let link_path = target_dir.join(&unit.name);

    if std::fs::symlink_metadata(&link_path).is_ok() {
        return Ok(link_path);
    }

    std::fs::create_dir_all(&target_dir).map_err(|err| CoreError::io(&target_dir, err))?;

    // The link points at where the item really lives, not at another link:
    // a chain would break as soon as any hop in it moved.
    let target = if unit.path == item.discovered.real_path {
        unit.path.clone()
    } else {
        real_unit_path(&unit.path)
    };

    platform::symlink(&target, &link_path, unit.is_dir)
        .map_err(|err| CoreError::io(&link_path, err))?;
    Ok(link_path)
}

/// Removes a link from a project.
///
/// Refuses anything that is not a link, so this cannot be turned into a way of
/// deleting a real item by accident.
pub fn remove_from_project(link_path: &Path) -> Result<()> {
    let unit = linkable_unit(link_path);
    let metadata =
        std::fs::symlink_metadata(&unit.path).map_err(|err| CoreError::io(&unit.path, err))?;

    if !metadata.file_type().is_symlink() {
        return Err(CoreError::NotALink {
            path: unit.path.clone(),
        });
    }
    platform::remove_symlink(&unit.path).map_err(|err| CoreError::io(&unit.path, err))
}

/// Resolves a unit path through any links, falling back to the path itself.
fn real_unit_path(unit_path: &Path) -> PathBuf {
    dunce::canonicalize(unit_path).unwrap_or_else(|_| unit_path.to_path_buf())
}
