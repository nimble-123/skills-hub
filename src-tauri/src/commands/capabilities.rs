//! What this machine lets the app do.
//!
//! Probed once at startup so the UI can explain an unavailable feature up front,
//! rather than letting the user discover it by hitting an error.

use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager as _;

use crate::error::CommandError;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// Home directory, as the scanner will expand `~`.
    pub home: PathBuf,
    /// Whether this process may create symlinks. False on Windows without
    /// Developer Mode, which disables linking a global skill into a project.
    pub symlinks_supported: bool,
    pub app_version: String,
    pub platform: &'static str,
}

#[tauri::command]
#[specta::specta]
// Tauri injects `AppHandle` by value; it is the framework's contract, not a choice.
#[allow(clippy::needless_pass_by_value)]
pub fn probe_capabilities(app: tauri::AppHandle) -> Result<Capabilities, CommandError> {
    let home = dirs::home_dir().ok_or_else(|| CommandError {
        code: "no-home".to_owned(),
        message: "Could not determine your home directory.".to_owned(),
    })?;

    // Probing in the app's own data directory, not in the system temp dir:
    // those can sit on different filesystems with different capabilities.
    let scratch = app.path().app_data_dir().unwrap_or_else(|_| home.clone());
    std::fs::create_dir_all(&scratch)?;

    Ok(Capabilities {
        home,
        symlinks_supported: skills_core::platform::probe_symlink_support(&scratch),
        app_version: app.package_info().version.to_string(),
        platform: std::env::consts::OS,
    })
}
