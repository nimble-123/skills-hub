//! Adapter layer: turns `skills-core` into Tauri commands.
//!
//! Nothing in here makes a domain decision. It resolves the paths the platform
//! owns, holds shared state, maps core errors onto a serialisable shape, and
//! adapts the core's progress callback onto a Tauri channel.

mod commands;
mod error;
mod state;

pub use error::CommandError;

use tauri::Manager as _;
use tauri_specta::{Builder, collect_commands};

/// The command surface, in one place. `main` mounts it; the bindings test
/// exports it. Both go through here so they cannot drift apart.
fn specta_builder() -> Builder<tauri::Wry> {
    Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::capabilities::probe_capabilities,
        commands::settings::get_settings,
        commands::settings::update_settings,
        commands::settings::set_tool_override,
        commands::settings::set_metadata_folder,
        commands::settings::add_project_workspace,
        commands::settings::remove_project_workspace,
        commands::library::get_snapshot,
        commands::library::rescan,
        commands::library::list_orphaned_metadata,
        commands::library::forget_orphaned_metadata,
        commands::items::read_item_content,
        commands::items::write_item_content,
        commands::items::set_item_enabled,
        commands::items::set_item_favorite,
        commands::items::set_item_tags,
        commands::items::set_item_collections,
        commands::items::link_into_project,
        commands::items::unlink_from_project,
        commands::items::delete_item,
        commands::tools::describe_tools,
        commands::tools::check_path,
        commands::tools::add_custom_tool,
        commands::tools::remove_custom_tool,
        commands::discover::get_discover_catalog,
        commands::discover::search_registry,
        commands::discover::discover_add_source,
        commands::discover::discover_refresh_source,
        commands::discover::discover_remove_source,
        commands::discover::install_from_github,
        commands::updates::check_for_updates,
        commands::updates::prepare_review,
        commands::updates::apply_review,
        commands::updates::cancel_review,
        commands::insights::load_usage,
        commands::insights::compute_dashboard,
        commands::insights::disregard,
        commands::insights::undisregard,
        commands::insights::list_disregarded,
        commands::insights::list_mcp_servers,
        commands::items::set_plugin_enabled,
        commands::collections::save_collection,
        commands::collections::delete_collection,
        commands::collections::set_item_in_collection,
        commands::shell::reveal_in_file_manager,
        commands::shell::open_path,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("skills_hub_lib=info")),
        )
        .init();

    let builder = specta_builder();

    let run = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            app.manage(load_state(app.handle())?);
            Ok(())
        })
        .run(tauri::generate_context!());

    if let Err(err) = run {
        tracing::error!(%err, "fatal: could not start the application");
        std::process::exit(1);
    }
}

/// Reads the settings and opens the store, before any window needs them.
///
/// An unreadable settings file is set aside and the application starts on
/// defaults: refusing to open over a config file would cost the user access to
/// their whole library.
fn load_state(app: &tauri::AppHandle) -> Result<state::AppState, Box<dyn std::error::Error>> {
    use skills_core::dashboard::DismissalsFile;
    use skills_core::discover::CatalogFile;
    use skills_core::settings::SettingsFile;

    let home = dirs::home_dir().ok_or("could not determine the home directory")?;
    let config_dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&config_dir)?;

    let settings_file = SettingsFile::new(&config_dir);
    let loaded = settings_file.load()?;
    if let Some(quarantined) = &loaded.recovered_from {
        tracing::warn!(path = %quarantined.display(), "started on defaults; the old settings were kept");
    }

    Ok(state::AppState::new(
        home,
        settings_file,
        loaded.settings,
        CatalogFile::new(&config_dir),
        DismissalsFile::new(&config_dir),
    ))
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::specta_builder;

    /// Regenerates `src/bindings.ts`. The file is committed; CI runs this and
    /// fails if the working tree is dirty afterwards, which is what stops the
    /// frontend's types from drifting off the command signatures.
    #[test]
    fn export_typescript_bindings() {
        let config = specta_typescript::Typescript::new().header(
            "// @generated by tauri-specta. Do not edit by hand.\n\
             // Run `cargo test -p skills-hub` to regenerate.\n",
        );

        specta_builder()
            .export(config, "../src/bindings.ts")
            .expect("exporting TypeScript bindings should succeed");
    }
}
