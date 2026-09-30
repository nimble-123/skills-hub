//! The menubar companion: a status-bar icon and the popover behind it.
//!
//! macOS only. What makes a webview behave like a menu bar item rather than a
//! floating window is `NSPanel` — it can take keyboard focus without
//! activating the application, so typing in the popover's search field does
//! not pull the user out of whatever they were doing. There is no equivalent
//! to port to Windows or Linux, so there is no menubar there either.

use tauri::image::Image;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter as _, Manager as _, PhysicalPosition, Rect, WebviewUrl, WebviewWindow,
};
use tauri_nspanel::{CollectionBehavior, ManagerExt as _, PanelLevel, StyleMask};

mod panel;

/// The popover window's label. The frontend never needs it; the panel store
/// and the tray handler look each other up by it.
pub const POPOVER: &str = "popover";
/// The main window's label, as `tauri.conf.json` declares it.
pub const MAIN: &str = "main";
/// Told to the popover each time it is shown, matching `OPENED` in
/// `src/components/popover/Popover.tsx`.
///
/// The webview cannot find out for itself: the panel's delegate replaces the
/// one Tauri installs, so the window's focus events never reach it.
pub const OPENED: &str = "popover:opened";

const WIDTH: f64 = 360.0;
const HEIGHT: f64 = 480.0;
/// Between the menu bar and the top of the popover.
const GAP: f64 = 6.0;
/// How close to the edge of the screen the popover may sit.
const MARGIN: f64 = 8.0;

/// Builds the popover and the status item. Called once, from `setup`.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let window =
        tauri::WebviewWindowBuilder::new(app, POPOVER, WebviewUrl::App("popover.html".into()))
            .title("skills-hub")
            .inner_size(WIDTH, HEIGHT)
            .resizable(false)
            .decorations(false)
            .visible(false)
            .skip_taskbar(true)
            .build()?;

    // Clicking anywhere else closes it, the way a menu does.
    let on_resign = app.clone();
    let panel = panel::adopt(&window, move || hide(&on_resign))?;

    // Above everything, including other applications' full-screen windows.
    panel.set_level(PanelLevel::Status.value());

    // `add_style_mask`, never `set_style_mask`. Replacing the mask drops the
    // structural flags Tauri put there and AppKit rejects the result, which is
    // what the upstream macOS 27 focus report turned out to be.
    if let Err(err) = panel.add_style_mask(StyleMask::empty().nonactivating_panel().into()) {
        tracing::warn!(?err, "the popover will activate the app when clicked");
    }

    // Follows the user to whichever space they are on, and does not sit in the
    // window cycle — a menu bar item is not a window you tab to.
    panel.set_collection_behavior(
        CollectionBehavior::new()
            .can_join_all_spaces()
            .stationary()
            .ignores_cycle()
            .full_screen_auxiliary()
            .value(),
    );

    TrayIconBuilder::with_id("menubar")
        .icon(Image::from_bytes(include_bytes!("../../icons/tray-template.png"))?)
        // Template images are a mask: macOS inverts them for a dark menu bar
        // and when the item is selected. A colour icon would do neither.
        .icon_as_template(true)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle(tray.app_handle(), &rect);
            }
        })
        .build(app)?;

    Ok(())
}

/// Opens the popover under the status item, or closes it if it is open.
fn toggle(app: &AppHandle, rect: &Rect) {
    let Ok(panel) = app.get_webview_panel(POPOVER) else {
        tracing::error!("the popover panel is missing");
        return;
    };

    if panel.is_visible() {
        tracing::debug!("status item clicked while open: hiding");
        panel.hide();
        return;
    }
    tracing::debug!("status item clicked while closed: showing");

    if let Some(window) = app.get_webview_window(POPOVER)
        && let Err(err) = place(&window, rect)
    {
        // Worth opening in the wrong place rather than not at all.
        tracing::warn!(%err, "could not place the popover under the status item");
    }

    panel.show_and_make_key();

    match app.emit_to(POPOVER, OPENED, ()) {
        Ok(()) => tracing::debug!("told the popover it opened"),
        Err(err) => tracing::warn!(%err, "the popover opened without being told, and may be stale"),
    }
}

/// Hides the popover, from wherever noticed it should close.
pub fn hide(app: &AppHandle) {
    if let Ok(panel) = app.get_webview_panel(POPOVER) {
        // At debug level because the popover is a native surface: whether it
        // closed, and on whose account, cannot be read off the screen from a
        // terminal and is otherwise guesswork.
        tracing::debug!(was_visible = panel.is_visible(), "hiding the popover");
        panel.hide();
    }
}

/// Centres the popover under the status item, kept on screen.
fn place(window: &WebviewWindow, rect: &Rect) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let icon = rect.position.to_physical::<f64>(scale);
    let icon_size = rect.size.to_physical::<f64>(scale);

    let width = WIDTH * scale;
    let mut x = icon.x + icon_size.width / 2.0 - width / 2.0;
    let y = icon.y + icon_size.height + GAP * scale;

    // A status item near the right-hand edge would otherwise push half the
    // popover off the screen.
    if let Some(monitor) = window.monitor_from_point(icon.x, icon.y)? {
        let left = f64::from(monitor.position().x);
        let right = left + f64::from(monitor.size().width);
        // Not `clamp`, which panics when the bounds cross. They would on a
        // screen narrower than the popover, and a panic is a worse answer
        // than a popover hanging over the edge of a tiny display.
        x = x
            .min(right - width - MARGIN * scale)
            .max(left + MARGIN * scale);
    }

    window.set_position(PhysicalPosition::new(x, y))
}

/// Shows the main window, bringing the application forward with it.
pub fn show_main(app: &AppHandle) -> tauri::Result<()> {
    hide(app);
    let Some(window) = app.get_webview_window(MAIN) else {
        return Ok(());
    };
    // Back to a normal application: Dock icon, menu bar, the lot. Without
    // this the window would come up behind whatever the user was in.
    app.set_activation_policy(tauri::ActivationPolicy::Regular)?;
    window.show()?;
    window.unminimize()?;
    window.set_focus()
}

/// Closing the main window leaves the menubar behind rather than quitting.
///
/// Without this the tray would die with the first window close, because the
/// application has no windows left and macOS has nothing to keep it alive.
pub fn on_main_close(window: &tauri::Window) {
    if let Err(err) = window.hide() {
        tracing::warn!(%err, "could not hide the main window");
        return;
    }
    // No window open, so no Dock icon and no menu bar — only the status item
    // is left. A fixed `LSUIElement` in Info.plist would hide the Dock icon
    // even while the window is open, which is not the same thing.
    if let Err(err) = window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory)
    {
        tracing::warn!(%err, "the Dock icon will stay after the window closed");
    }
}
