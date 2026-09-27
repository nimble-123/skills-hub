//! Tauri command surface. One module per area; each command is a thin adapter.
//!
//! Modules are public because `collect_commands!` needs to reach the items the
//! `#[tauri::command]` macro generates alongside each function.

pub mod capabilities;
