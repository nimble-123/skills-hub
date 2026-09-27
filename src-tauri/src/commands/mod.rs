//! Tauri command surface. One module per area; each command is a thin adapter
//! over `skills-core`, which makes no decision about windows, channels or
//! platform paths.
//!
//! Modules are public because `collect_commands!` needs to reach the items the
//! `#[tauri::command]` macro generates alongside each function.

pub mod capabilities;
pub mod items;
pub mod library;
pub mod settings;
pub mod shell;
pub mod tools;

use std::sync::{Mutex, MutexGuard};

use crate::error::{CommandError, CommandResult};

/// Locks a piece of state, turning a poisoned lock into a reported error
/// rather than a second panic.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> CommandResult<MutexGuard<'_, T>> {
    mutex.lock().map_err(|_| CommandError::poisoned())
}
