//! The `NSPanel` subclass, and nothing else.
//!
//! It lives alone because `panel_event!` requires a return type on every
//! delegate method, so a callback that returns nothing must spell out `-> ()`
//! — which clippy then objects to. The allow below is the whole reason this is
//! a separate file rather than a few lines of its parent: the lint stays on
//! for every line of real logic.
#![allow(clippy::unused_unit)]

use tauri::{WebviewWindow, Wry};
use tauri_nspanel::{PanelHandle, WebviewWindowExt as _, tauri_panel};

tauri_panel! {
    panel!(Popover {
        config: {
            // It must take key status, or the search field could not be typed
            // into. `NonactivatingPanel`, added to the style mask by the
            // caller, is what keeps that from activating the application too.
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true
        }
    })

    panel_event!(PopoverEvents {
        window_did_resign_key(notification: &NSNotification) -> ()
    })
}

/// Turns the popover window into a panel that closes when it loses focus.
///
/// The panel retains the delegate, so the caller keeps no handle to it.
pub fn adopt(
    window: &WebviewWindow,
    on_resign_key: impl Fn() + 'static,
) -> tauri::Result<PanelHandle<Wry>> {
    let panel = window.to_panel::<Popover<Wry>>()?;

    let handler = PopoverEvents::new();
    handler.window_did_resign_key(move |_| on_resign_key());
    panel.set_event_handler(Some(handler.as_ref()));

    Ok(panel)
}
