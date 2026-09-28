//! Settings, and in particular the one thing they must never do: let a file
//! written by an older version of the application shadow the current one.

#![allow(clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;

use skills_core::model::{ItemType, RulePathEntry};
use skills_core::settings::{
    AppSettings, SettingsFile, ThemePref, ToolOverride, effective_tools, reconcile_section_order,
};
use skills_core::tools;

fn config_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("tempdir")
}

fn find(tools: &[skills_core::model::ToolConfig], id: &str) -> skills_core::model::ToolConfig {
    tools
        .iter()
        .find(|t| t.id == id)
        .unwrap_or_else(|| panic!("no tool {id}"))
        .clone()
}

// ------------------------------------------------------------------ overrides

#[test]
fn with_no_overrides_the_registry_comes_through_unchanged() {
    let effective = effective_tools(tools::default_tools(), &AppSettings::default());
    assert_eq!(effective, tools::default_tools());
}

#[test]
fn an_override_replaces_only_what_it_names() {
    let mut settings = AppSettings::default();
    settings.tool_overrides.insert(
        "claude-code".to_owned(),
        ToolOverride {
            paths: BTreeMap::from([(ItemType::Skill, "~/elsewhere/skills".to_owned())]),
            ..ToolOverride::default()
        },
    );

    let effective = effective_tools(tools::default_tools(), &settings);
    let claude = find(&effective, "claude-code");
    let original = find(tools::default_tools(), "claude-code");

    assert_eq!(claude.paths[&ItemType::Skill], "~/elsewhere/skills");
    // Everything else still comes from the registry.
    assert_eq!(claude.project_paths, original.project_paths);
    assert_eq!(claude.built_in_dirnames, original.built_in_dirnames);
    assert_eq!(claude.single_file_rule, original.single_file_rule);
    assert_eq!(claude.plugins_registry, original.plugins_registry);
}

/// The regression the Obsidian plugin shipped: it stored whole tool objects and
/// carried a hand-maintained list of fields across on load, so a field the list
/// forgot was silently taken from the stale copy. There is nowhere in this
/// file for such a field to live.
#[test]
fn a_settings_file_written_by_an_older_version_cannot_shadow_the_registry() {
    let dir = config_dir();
    let file = SettingsFile::new(dir.path());

    // An old file: it knows about overriding a path, and nothing else.
    std::fs::write(
        file.path(),
        r#"{
          "schemaVersion": 1,
          "toolOverrides": { "claude-code": { "paths": { "skill": "~/old/skills" } } }
        }"#,
    )
    .expect("write");

    let loaded = file.load().expect("load");
    let effective = effective_tools(tools::default_tools(), &loaded.settings);
    let claude = find(&effective, "claude-code");
    let original = find(tools::default_tools(), "claude-code");

    assert_eq!(
        claude.paths[&ItemType::Skill],
        "~/old/skills",
        "the override applies"
    );
    assert_eq!(
        claude.built_in_dirnames, original.built_in_dirnames,
        "a field the old file never heard of still comes from code"
    );
    assert_eq!(claude.mcp_config_format, original.mcp_config_format);
    assert_eq!(claude.unconfirmed_paths, original.unconfirmed_paths);
}

/// Changing where one type lives leaves the others alone, so they stay free
/// to be corrected by an update.
#[test]
fn an_override_of_one_path_does_not_disturb_the_others() {
    let mut settings = AppSettings::default();
    settings.tool_overrides.insert(
        "claude-code".to_owned(),
        ToolOverride {
            paths: BTreeMap::from([(ItemType::Command, "~/elsewhere/commands".to_owned())]),
            ..ToolOverride::default()
        },
    );

    let claude = find(
        &effective_tools(tools::default_tools(), &settings),
        "claude-code",
    );
    let original = find(tools::default_tools(), "claude-code");

    assert_eq!(claude.paths[&ItemType::Command], "~/elsewhere/commands");
    assert_eq!(
        claude.paths[&ItemType::Skill],
        original.paths[&ItemType::Skill]
    );
    assert_eq!(
        claude.paths[&ItemType::Agent],
        original.paths[&ItemType::Agent]
    );
}

/// Turning a type off is different from saying nothing and getting the
/// default, so it needs a way to be said.
#[test]
fn an_empty_path_turns_that_type_off_entirely() {
    let mut settings = AppSettings::default();
    settings.tool_overrides.insert(
        "claude-code".to_owned(),
        ToolOverride {
            paths: BTreeMap::from([(ItemType::Agent, String::new())]),
            ..ToolOverride::default()
        },
    );

    let claude = find(
        &effective_tools(tools::default_tools(), &settings),
        "claude-code",
    );

    assert!(!claude.paths.contains_key(&ItemType::Agent));
    assert!(
        claude.paths.contains_key(&ItemType::Skill),
        "the rest is untouched"
    );
}

#[test]
fn a_disabled_tool_is_still_in_the_list_so_it_can_still_be_scanned() {
    let mut settings = AppSettings::default();
    settings.tool_overrides.insert(
        "cursor".to_owned(),
        ToolOverride {
            disabled: Some(true),
            ..ToolOverride::default()
        },
    );

    let effective = effective_tools(tools::default_tools(), &settings);
    let cursor = find(&effective, "cursor");

    assert!(cursor.disabled);
    assert_eq!(effective.len(), tools::default_tools().len());
}

#[test]
fn extra_rule_paths_can_be_added_per_tool() {
    let mut settings = AppSettings::default();
    settings.tool_overrides.insert(
        "cursor".to_owned(),
        ToolOverride {
            rule_additional_paths: Some(vec![RulePathEntry {
                path: "~/house-rules".to_owned(),
                single_file: false,
            }]),
            ..ToolOverride::default()
        },
    );

    let cursor = find(
        &effective_tools(tools::default_tools(), &settings),
        "cursor",
    );
    assert_eq!(cursor.rule_additional_paths.len(), 1);
}

#[test]
fn a_custom_tool_is_appended_and_marked_as_the_users() {
    let mut settings = AppSettings::default();
    let mut mine = find(tools::default_tools(), "cursor");
    mine.id = "my-tool".to_owned();
    mine.custom = false; // the flag is set by the merge, not trusted from the file
    settings.custom_tools.push(mine);

    let effective = effective_tools(tools::default_tools(), &settings);
    assert_eq!(effective.len(), tools::default_tools().len() + 1);
    assert!(find(&effective, "my-tool").custom);
}

#[test]
fn a_custom_tool_the_registry_has_since_adopted_does_not_appear_twice() {
    let mut settings = AppSettings::default();
    settings
        .custom_tools
        .push(find(tools::default_tools(), "goose"));

    let effective = effective_tools(tools::default_tools(), &settings);
    assert_eq!(effective.len(), tools::default_tools().len());
    assert!(
        !find(&effective, "goose").custom,
        "the registry's version wins"
    );
}

// -------------------------------------------------------------- section order

#[test]
fn a_reordered_sidebar_is_kept_as_the_user_left_it() {
    let stored = vec![
        "tools".to_owned(),
        "types".to_owned(),
        "projects".to_owned(),
    ];
    let order = reconcile_section_order(&stored);
    let position = |name: &str| order.iter().position(|s| s == name).expect("present");
    assert!(position("tools") < position("types"));
}

#[test]
fn a_section_added_by_an_update_appears_at_its_default_position() {
    // A file from before "extensions" existed.
    let stored = vec![
        "types".to_owned(),
        "tools".to_owned(),
        "projects".to_owned(),
        "collections".to_owned(),
    ];
    let order = reconcile_section_order(&stored);

    assert_eq!(order.len(), 5);
    let position = |name: &str| order.iter().position(|s| s == name).expect("present");
    assert!(position("types") < position("extensions"));
    assert!(position("extensions") < position("tools"));
}

#[test]
fn a_section_that_no_longer_exists_is_dropped() {
    let stored = vec!["types".to_owned(), "something-removed".to_owned()];
    assert!(!reconcile_section_order(&stored).contains(&"something-removed".to_owned()));
}

// --------------------------------------------------------------- persistence

#[test]
fn settings_round_trip_through_the_file() {
    let dir = config_dir();
    let file = SettingsFile::new(dir.path());

    let mut settings = AppSettings {
        metadata_folder: Some("/Users/someone/Vault/AI Skills Manager".into()),
        show_empty_sidebar_rows: true,
        ..AppSettings::default()
    };
    settings.tool_overrides.insert(
        "codex".to_owned(),
        ToolOverride {
            disabled: Some(true),
            ..ToolOverride::default()
        },
    );

    file.save(&settings).expect("save");
    assert_eq!(file.load().expect("load").settings, settings);
}

#[test]
fn a_theme_written_before_the_palettes_grew_still_loads() {
    // The list went from three variants to fourteen, and with it the naming
    // from `lowercase` to `kebab-case`. The three that already existed spell
    // the same either way, and a settings file already on disk says so.
    let dir = config_dir();
    let file = SettingsFile::new(dir.path());
    std::fs::write(file.path(), r#"{"schemaVersion": 1, "theme": "dark"}"#).expect("write");

    assert_eq!(file.load().expect("load").settings.theme, ThemePref::Dark);
}

#[test]
fn a_multi_word_theme_round_trips_through_the_file() {
    let dir = config_dir();
    let file = SettingsFile::new(dir.path());
    let settings = AppSettings {
        theme: ThemePref::HorizonEvening,
        ..AppSettings::default()
    };

    file.save(&settings).expect("save");

    let raw = std::fs::read_to_string(file.path()).expect("read");
    assert!(
        raw.contains("\"theme\": \"horizon-evening\""),
        "readable: {raw}"
    );
    assert_eq!(file.load().expect("load").settings, settings);
}

#[test]
fn a_missing_file_means_defaults_rather_than_an_error() {
    let dir = config_dir();
    let loaded = SettingsFile::new(dir.path()).load().expect("load");
    assert_eq!(loaded.settings, AppSettings::default());
    assert!(loaded.recovered_from.is_none());
}

#[test]
fn a_corrupt_file_is_set_aside_and_the_application_still_starts() {
    let dir = config_dir();
    let file = SettingsFile::new(dir.path());
    std::fs::write(file.path(), "{ this is not json").expect("write");

    let loaded = file.load().expect("load");

    assert_eq!(loaded.settings, AppSettings::default());
    let quarantined = loaded.recovered_from.expect("the bad file was kept");
    assert!(
        quarantined.exists(),
        "the user can still get at what they had"
    );
    assert!(
        quarantined
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("settings.corrupt-")),
        "and the name says what happened"
    );
    assert!(!file.path().exists());
}

#[test]
fn saving_keeps_a_copy_of_the_last_good_file() {
    let dir = config_dir();
    let file = SettingsFile::new(dir.path());

    let first = AppSettings {
        show_empty_sidebar_rows: true,
        ..AppSettings::default()
    };
    file.save(&first).expect("first save");
    file.save(&AppSettings::default()).expect("second save");

    let backup = dir.path().join("settings.backup.json");
    assert!(backup.exists());
    let restored: AppSettings =
        serde_json::from_str(&std::fs::read_to_string(&backup).expect("read")).expect("parse");
    assert!(restored.show_empty_sidebar_rows);
}

#[test]
fn the_written_file_is_readable_and_hand_editable() {
    let dir = config_dir();
    let file = SettingsFile::new(dir.path());
    file.save(&AppSettings::default()).expect("save");

    let raw = std::fs::read_to_string(file.path()).expect("read");
    assert!(raw.contains("\n  \"schemaVersion\""), "pretty-printed");
    assert!(raw.ends_with('\n'), "ends with a newline");
    // The registry itself is not in the file: only the handful of things a
    // user may override about a tool can be. ("tools" does appear — it is one
    // of the sidebar section names.)
    assert!(
        !raw.contains("builtInDirnames"),
        "no registry fields in the file"
    );
    assert!(
        !raw.contains("unconfirmedPaths"),
        "no registry fields in the file"
    );
    assert!(
        !raw.contains("singleFileRule"),
        "no registry fields in the file"
    );
}
