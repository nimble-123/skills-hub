//! Handing a path to the operating system.

// Tauri deserialises command arguments into owned values and injects `State`
// and `AppHandle` by value. That is the framework's calling convention, not a
// choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use std::path::PathBuf;

use tauri_plugin_opener::OpenerExt as _;

use crate::error::{CommandError, CommandResult};

/// Shows a file in Finder, Explorer or the desktop's file manager.
///
/// `resolve_symlink` follows a link to where it really points, which is what
/// someone wants when they mean to edit the skill rather than inspect the link.
#[tauri::command]
#[specta::specta]
pub fn reveal_in_file_manager(
    app: tauri::AppHandle,
    path: PathBuf,
    resolve_symlink: bool,
) -> CommandResult<()> {
    let target = if resolve_symlink {
        skills_core::scan::real_path(&path)
    } else {
        path
    };
    app.opener()
        .reveal_item_in_dir(&target)
        .map_err(|err| CommandError::new("reveal", err.to_string()))
}

/// Opens a path with whatever the operating system uses for it.
#[tauri::command]
#[specta::specta]
pub fn open_path(app: tauri::AppHandle, path: String) -> CommandResult<()> {
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|err| CommandError::new("open", err.to_string()))
}
