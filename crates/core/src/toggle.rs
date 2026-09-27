//! Turning an item on and off, and deleting it.
//!
//! The only module in the project that destroys anything on disk, kept
//! deliberately small so that all of it can be held in mind at once.
//!
//! Disabling moves an item's unit — a skill's folder, or a lone file — into a
//! `.skillmanager-disabled` folder beside where it was. The tool then genuinely
//! stops seeing it, which is the point: a checkbox that only lives in this
//! application's memory would not have disabled anything.
//!
//! Three rules govern every move here, and each of them is a way of losing the
//! user's files if broken:
//!
//! - **Create before destroying.** The new entry is made and checked before the
//!   old one goes. There is no instant at which neither exists.
//! - **A symlink is re-pointed, never followed.** Moving a link one directory
//!   deeper invalidates a relative target, so it is rewritten absolute. And a
//!   link is removed with `remove_file`, never `remove_dir_all`, which would
//!   delete the tree it points at rather than the link.
//! - **Nothing is overwritten.** A name already taken is an error, not a
//!   decision this code gets to make.

use std::path::{Path, PathBuf};

use crate::error::{CoreError, Result};
use crate::fsunit::{DISABLED_DIRNAME, LinkableUnit, SKILL_MANIFEST, linkable_unit};
use crate::model::{ItemMetadata, ToolConfig};
use crate::platform;

/// Moves an item so that its tool does, or does not, see it.
///
/// Idempotent: asking for the state it is already in does nothing and succeeds,
/// so a double click or a retry cannot leave it flipped the wrong way. Returns
/// the item's new source path, which the caller can use to update one row
/// rather than rescanning everything.
pub fn set_item_enabled(item: &ItemMetadata, enabled: bool) -> Result<PathBuf> {
    refuse_plugin_item(item)?;

    let unit = linkable_unit(&item.discovered.source_path);
    if is_disabled(&unit.path) != enabled {
        return Ok(item.discovered.source_path.clone());
    }

    let destination = if enabled {
        enabled_location(&unit)?
    } else {
        disabled_location(&unit)?
    };

    if destination.exists() || is_symlink(&destination) {
        return Err(CoreError::DestinationExists {
            path: destination,
            name: unit.name.clone(),
        });
    }
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|err| CoreError::io(parent, err))?;
    }

    move_unit(&unit, &destination)?;
    Ok(source_path_within(&destination, unit.is_dir))
}

/// Removes an item.
///
/// For a project link this removes the link and nothing else — the skill it
/// points at is untouched, which is the whole reason projects are linked rather
/// than copied.
pub fn delete_item(item: &ItemMetadata) -> Result<()> {
    refuse_plugin_item(item)?;

    let unit = linkable_unit(&item.discovered.source_path);
    if is_symlink(&unit.path) {
        return platform::remove_symlink(&unit.path).map_err(|err| CoreError::io(&unit.path, err));
    }
    if unit.is_dir {
        std::fs::remove_dir_all(&unit.path).map_err(|err| CoreError::io(&unit.path, err))
    } else {
        std::fs::remove_file(&unit.path).map_err(|err| CoreError::io(&unit.path, err))
    }
}

/// Enables or disables a whole plugin bundle, through its tool's own settings.
///
/// Every other key in that file is preserved: it is the tool's file, not ours.
pub fn set_plugin_enabled(
    tool: &ToolConfig,
    plugin_id: &str,
    enabled: bool,
    home: &Path,
) -> Result<()> {
    let Some(raw_path) = &tool.plugins_settings_path else {
        return Err(CoreError::PluginToggleUnsupported {
            tool: tool.id.clone(),
        });
    };
    let path = crate::paths::expand_home(raw_path, home);

    let mut document: serde_json::Value = match std::fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|err| CoreError::io(&path, std::io::Error::other(err)))?,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => serde_json::json!({}),
        Err(err) => return Err(CoreError::io(&path, err)),
    };

    let Some(object) = document.as_object_mut() else {
        return Err(CoreError::io(
            &path,
            std::io::Error::other("the settings file is not a JSON object"),
        ));
    };
    object
        .entry("enabledPlugins")
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or_else(|| {
            CoreError::io(
                &path,
                std::io::Error::other("enabledPlugins is not a JSON object"),
            )
        })?
        .insert(plugin_id.to_owned(), serde_json::Value::Bool(enabled));

    let json = serde_json::to_string_pretty(&document)
        .map_err(|err| CoreError::io(&path, std::io::Error::other(err)))?;
    std::fs::write(&path, json + "\n").map_err(|err| CoreError::io(&path, err))
}

// ------------------------------------------------------------------ locations

/// Whether a unit currently sits inside a disabled folder.
fn is_disabled(unit_path: &Path) -> bool {
    unit_path
        .parent()
        .and_then(Path::file_name)
        .and_then(|name| name.to_str())
        == Some(DISABLED_DIRNAME)
}

/// Where this unit goes when enabled: out of the disabled folder, into its
/// grandparent.
fn enabled_location(unit: &LinkableUnit) -> Result<PathBuf> {
    unit.path
        .parent()
        .and_then(Path::parent)
        .map(|dir| dir.join(&unit.name))
        .ok_or_else(|| CoreError::NoParentDirectory {
            path: unit.path.clone(),
        })
}

/// Where this unit goes when disabled: a sibling folder of its own parent, so
/// an item inside a category folder stays with that category.
fn disabled_location(unit: &LinkableUnit) -> Result<PathBuf> {
    unit.path
        .parent()
        .map(|dir| dir.join(DISABLED_DIRNAME).join(&unit.name))
        .ok_or_else(|| CoreError::NoParentDirectory {
            path: unit.path.clone(),
        })
}

/// The scanner-visible path for a unit at a given location.
fn source_path_within(unit_path: &Path, is_dir: bool) -> PathBuf {
    if is_dir {
        unit_path.join(SKILL_MANIFEST)
    } else {
        unit_path.to_path_buf()
    }
}

// ---------------------------------------------------------------------- moves

fn move_unit(unit: &LinkableUnit, destination: &Path) -> Result<()> {
    if is_symlink(&unit.path) {
        return relocate_symlink(&unit.path, destination, unit.is_dir);
    }

    match std::fs::rename(&unit.path, destination) {
        Ok(()) => Ok(()),
        // Across a filesystem boundary a rename is not possible, so the
        // content has to be copied and only then removed.
        Err(err) if is_cross_device(&err) => copy_then_remove(&unit.path, destination, unit.is_dir),
        Err(err) => Err(CoreError::io(&unit.path, err)),
    }
}

/// Re-creates a symlink at a new location, pointing at the same place.
///
/// A relative target — `../../.agents/skills/x`, which is what these tools
/// write — means something different one directory deeper, so it cannot be
/// carried across as-is. It is recomputed for the new location rather than
/// replaced with an absolute path: a link was written relative so that it
/// survives the home directory being somewhere else, and quietly absolutising
/// it would take that away.
fn relocate_symlink(link: &Path, destination: &Path, is_dir: bool) -> Result<()> {
    let absolute_target =
        platform::read_link_absolute(link).map_err(|err| CoreError::io(link, err))?;
    let was_relative = std::fs::read_link(link).is_ok_and(|raw| raw.is_relative());

    let new_target = match (was_relative, destination.parent()) {
        (true, Some(parent)) => platform::relative_to(&absolute_target, parent),
        _ => absolute_target.clone(),
    };

    platform::symlink(&new_target, destination, is_dir)
        .map_err(|err| CoreError::io(destination, err))?;

    // Check the new link before removing the old one. A target that has since
    // gone is not this code's fault and the link is still correct, so only the
    // link itself is checked — but if it does not point where the old one did,
    // stop rather than carry on and delete the original.
    if platform::read_link_absolute(destination).ok().as_deref() != Some(absolute_target.as_path())
    {
        let _ = platform::remove_symlink(destination);
        return Err(CoreError::io(
            destination,
            std::io::Error::other("the new link does not point where the old one did"),
        ));
    }

    platform::remove_symlink(link).map_err(|err| CoreError::io(link, err))
}

/// Copies across a filesystem boundary, then removes the original.
///
/// Only after the copy is in place, so an interruption leaves two copies rather
/// than none.
fn copy_then_remove(from: &Path, to: &Path, is_dir: bool) -> Result<()> {
    if is_dir {
        copy_dir_recursive(from, to)?;
        std::fs::remove_dir_all(from).map_err(|err| CoreError::io(from, err))
    } else {
        std::fs::copy(from, to).map_err(|err| CoreError::io(from, err))?;
        std::fs::remove_file(from).map_err(|err| CoreError::io(from, err))
    }
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to).map_err(|err| CoreError::io(to, err))?;
    let entries = std::fs::read_dir(from).map_err(|err| CoreError::io(from, err))?;

    for entry in entries {
        let entry = entry.map_err(|err| CoreError::io(from, err))?;
        let source = entry.path();
        let target = to.join(entry.file_name());

        if is_symlink(&source) {
            let link_target =
                platform::read_link_absolute(&source).map_err(|err| CoreError::io(&source, err))?;
            let target_is_dir = link_target.is_dir();
            platform::symlink(&link_target, &target, target_is_dir)
                .map_err(|err| CoreError::io(&target, err))?;
        } else if source.is_dir() {
            copy_dir_recursive(&source, &target)?;
        } else {
            std::fs::copy(&source, &target).map_err(|err| CoreError::io(&source, err))?;
        }
    }
    Ok(())
}

// --------------------------------------------------------------------- guards

fn refuse_plugin_item(item: &ItemMetadata) -> Result<()> {
    match &item.discovered.plugin_id {
        Some(plugin_id) => Err(CoreError::ItemBelongsToPlugin {
            name: item.discovered.name.clone(),
            plugin_id: plugin_id.clone(),
        }),
        None => Ok(()),
    }
}

/// `symlink_metadata` does not follow links, which is the entire distinction
/// this module depends on.
fn is_symlink(path: &Path) -> bool {
    std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink())
}

fn is_cross_device(err: &std::io::Error) -> bool {
    // EXDEV is 18 on Linux and macOS, ERROR_NOT_SAME_DEVICE is 17 on Windows.
    #[cfg(unix)]
    {
        err.raw_os_error() == Some(18)
    }
    #[cfg(windows)]
    {
        err.raw_os_error() == Some(17)
    }
}
