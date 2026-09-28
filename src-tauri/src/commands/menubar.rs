//! What the menubar popover asks the host for.
//!
//! The popover is a second webview, so everything it does goes through the
//! same command surface the window uses. Only these three have no meaning in
//! the window: closing the popover, leaving it for the real window, and
//! quitting an application whose last window may well be shut.
//!
//! They are compiled everywhere, because `collect_commands!` and the generated
//! bindings are one list for every platform. Off macOS there is no menubar, so
//! there is nothing for them to do.

// Tauri injects `AppHandle` by value. That is the framework's calling
// convention, not a choice this module gets to make.
#![allow(clippy::needless_pass_by_value)]

use crate::error::{CommandError, CommandResult};

/// Closes the popover.
///
/// Clicking elsewhere already closes it; this is for the paths inside it that
/// end the interaction — Escape, and leaving for the window.
#[tauri::command]
#[specta::specta]
pub fn close_popover(app: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    crate::menubar::hide(&app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Brings the main window up, closing the popover behind it.
#[tauri::command]
#[specta::specta]
pub fn show_main_window(app: tauri::AppHandle) -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    crate::menubar::show_main(&app)
        .map_err(|err| CommandError::new("window", format!("Could not open the window: {err}")))?;

    #[cfg(not(target_os = "macos"))]
    {
        use tauri::Manager as _;
        let Some(window) = app.get_webview_window("main") else {
            return Err(CommandError::new("window", "There is no window to open."));
        };
        window
            .set_focus()
            .map_err(|err| CommandError::new("window", format!("Could not focus it: {err}")))?;
    }

    Ok(())
}

/// Quits.
///
/// The menubar keeps the application running with every window closed, so this
/// is the only way out that does not go through the Dock.
#[tauri::command]
#[specta::specta]
pub fn quit(app: tauri::AppHandle) {
    app.exit(0);
}
