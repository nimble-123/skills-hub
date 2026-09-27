//! Enable, disable and delete, against real files.
//!
//! Every failure mode in this module is data loss, so the cases are exhaustive
//! by design. They mirror the Obsidian plugin's own suite, which is the closest
//! thing to a specification for how these moves have to behave, and add the
//! ones that matter on a machine like this one: a shared skills folder with
//! thirty relative symlinks pointing into it.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};

use skills_core::model::{DiscoveredItem, InstallSource, ItemMetadata, ItemType};
use skills_core::toggle;
use skills_core::tools;

struct Fixture {
    dir: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("tempdir"),
        }
    }

    fn home(&self) -> &Path {
        self.dir.path()
    }

    fn write(&self, relative: &str, content: &str) -> PathBuf {
        let path = self.home().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(&path, content).expect("write");
        path
    }

    fn mkdir(&self, relative: &str) -> PathBuf {
        let path = self.home().join(relative);
        std::fs::create_dir_all(&path).expect("mkdir");
        path
    }

    /// A folder skill with a companion file beside its manifest.
    fn skill(&self, relative: &str, name: &str) -> PathBuf {
        let manifest = self.write(
            &format!("{relative}/SKILL.md"),
            &format!("---\nname: {name}\n---\n"),
        );
        self.write(&format!("{relative}/helper.py"), "print('hi')\n");
        manifest
    }

    /// A relative symlink, exactly the shape these tools write.
    fn relative_link(&self, link_relative: &str, target_relative: &str) -> PathBuf {
        let link = self.home().join(link_relative);
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        let target = self.home().join(target_relative);
        let from_link_dir = pathdiff(&target, link.parent().expect("parent"));
        skills_core::platform::symlink(&from_link_dir, &link, target.is_dir()).expect("symlink");
        link
    }
}

/// A relative path from `base` to `target`, for building the kind of link the
/// tools actually produce.
fn pathdiff(target: &Path, base: &Path) -> PathBuf {
    let target: Vec<_> = target.components().collect();
    let base: Vec<_> = base.components().collect();
    let shared = target
        .iter()
        .zip(base.iter())
        .take_while(|(a, b)| a == b)
        .count();

    let mut out = PathBuf::new();
    for _ in shared..base.len() {
        out.push("..");
    }
    for component in &target[shared..] {
        out.push(component);
    }
    out
}

fn item(source_path: &Path) -> ItemMetadata {
    ItemMetadata {
        discovered: DiscoveredItem {
            entry_id: "test-item".into(),
            source_path: source_path.to_path_buf(),
            real_path: source_path.to_path_buf(),
            tool: "claude-code".into(),
            item_type: ItemType::Skill,
            project_id: None,
            plugin_id: None,
            name: "test".into(),
            description: String::new(),
            enabled: true,
            modified: None,
        },
        tags: Vec::new(),
        favorite: false,
        collections: Vec::new(),
        source: InstallSource::default(),
    }
}

fn plugin_item(source_path: &Path) -> ItemMetadata {
    let mut item = item(source_path);
    item.discovered.plugin_id = Some("toolkit@acme".into());
    item
}

fn disable(item: &ItemMetadata) -> skills_core::Result<PathBuf> {
    toggle::set_item_enabled(item, false)
}

fn enable(item: &ItemMetadata) -> skills_core::Result<PathBuf> {
    toggle::set_item_enabled(item, true)
}

// ----------------------------------------------------------- the simple cases

#[test]
fn disabling_a_flat_file_moves_it_into_the_disabled_folder() {
    let fx = Fixture::new();
    let file = fx.write(".claude/commands/review.md", "---\nname: review\n---\n");

    let moved = disable(&item(&file)).expect("disable");

    assert_eq!(
        moved,
        fx.home()
            .join(".claude/commands/.skillmanager-disabled/review.md")
    );
    assert!(moved.exists());
    assert!(!file.exists());
}

#[test]
fn enabling_it_again_puts_it_back_exactly_where_it_was() {
    let fx = Fixture::new();
    let file = fx.write(".claude/commands/review.md", "body");

    let disabled = disable(&item(&file)).expect("disable");
    let restored = enable(&item(&disabled)).expect("enable");

    assert_eq!(restored, file);
    assert_eq!(std::fs::read_to_string(&file).expect("read"), "body");
}

#[test]
fn a_skill_folder_travels_whole() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/writing", "writing");

    let moved = disable(&item(&manifest)).expect("disable");

    let folder = fx
        .home()
        .join(".claude/skills/.skillmanager-disabled/writing");
    assert_eq!(moved, folder.join("SKILL.md"));
    assert!(folder.join("SKILL.md").exists());
    assert!(folder.join("helper.py").exists(), "companions come along");
    assert!(!fx.home().join(".claude/skills/writing").exists());
}

/// An item inside a category folder is disabled into *that* folder, not the
/// configured root — which is why the scanner has to pair at every level.
#[test]
fn an_item_in_a_category_folder_is_disabled_beside_its_own_neighbours() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/engineering/tdd", "tdd");

    let moved = disable(&item(&manifest)).expect("disable");

    assert_eq!(
        moved,
        fx.home()
            .join(".claude/skills/engineering/.skillmanager-disabled/tdd/SKILL.md")
    );
}

// ------------------------------------------------------------------ idempotence

#[test]
fn asking_for_the_state_it_is_already_in_does_nothing() {
    let fx = Fixture::new();
    let file = fx.write(".claude/commands/review.md", "body");

    let unchanged = enable(&item(&file)).expect("already enabled");

    assert_eq!(unchanged, file);
    assert!(file.exists());
    assert!(
        !fx.home()
            .join(".claude/commands/.skillmanager-disabled")
            .exists()
    );
}

#[test]
fn disabling_twice_is_not_an_error_and_moves_nothing_the_second_time() {
    let fx = Fixture::new();
    let file = fx.write(".claude/commands/review.md", "body");

    let first = disable(&item(&file)).expect("first");
    let second = disable(&item(&first)).expect("second");

    assert_eq!(first, second);
    assert!(first.exists());
}

// -------------------------------------------------------------------- refusals

#[test]
fn a_name_already_taken_is_an_error_and_nothing_is_overwritten() {
    let fx = Fixture::new();
    let file = fx.write(".claude/commands/review.md", "the live one");
    fx.write(
        ".claude/commands/.skillmanager-disabled/review.md",
        "an older copy",
    );

    let err = disable(&item(&file)).expect_err("should refuse");

    assert_eq!(err.code(), "destination-exists");
    assert_eq!(
        std::fs::read_to_string(&file).expect("read"),
        "the live one"
    );
    assert_eq!(
        std::fs::read_to_string(
            fx.home()
                .join(".claude/commands/.skillmanager-disabled/review.md")
        )
        .expect("read"),
        "an older copy"
    );
}

#[test]
fn an_item_from_a_plugin_can_neither_be_toggled_nor_deleted() {
    let fx = Fixture::new();
    let manifest = fx.skill(
        ".claude/plugins/cache/acme/kit/1.0/skills/linting",
        "linting",
    );

    let toggle_err = disable(&plugin_item(&manifest)).expect_err("should refuse");
    assert_eq!(toggle_err.code(), "item-belongs-to-plugin");

    let delete_err = toggle::delete_item(&plugin_item(&manifest)).expect_err("should refuse");
    assert_eq!(delete_err.code(), "item-belongs-to-plugin");

    assert!(manifest.exists(), "the file is untouched");
}

// -------------------------------------------------------------------- symlinks

/// The case this machine is full of: a link written relative to its own
/// directory. Carried across unchanged it would point one level off, so it is
/// recomputed — and stays relative, because that is why it was written that
/// way. Absolutising it would work today and break the moment the home
/// directory has a different name.
#[test]
fn a_relative_link_is_recomputed_for_its_new_depth_and_stays_relative() {
    let fx = Fixture::new();
    fx.write(".agents/commands/review.md", "shared body");
    let link = fx.relative_link(".claude/commands/review.md", ".agents/commands/review.md");
    let before = std::fs::read_link(&link).expect("read_link");
    assert!(
        before.is_relative(),
        "the fixture really does make a relative link"
    );

    let moved = disable(&item(&link)).expect("disable");

    let after = std::fs::read_link(&moved).expect("read_link");
    assert!(after.is_relative(), "still portable");
    assert_ne!(after, before, "but recomputed for one level deeper");
    assert_eq!(
        std::fs::read_to_string(&moved).expect("read through"),
        "shared body"
    );
    assert!(!link.exists());
}

#[test]
fn an_absolute_link_stays_absolute() {
    let fx = Fixture::new();
    let target = fx.write(".agents/commands/review.md", "shared body");
    let link = fx.home().join(".claude/commands/review.md");
    std::fs::create_dir_all(link.parent().expect("parent")).expect("mkdir");
    skills_core::platform::symlink(&target, &link, false).expect("symlink");

    let moved = disable(&item(&link)).expect("disable");

    assert_eq!(std::fs::read_link(&moved).expect("read_link"), target);
}

#[test]
fn a_relative_link_to_a_skill_folder_still_resolves_after_the_move() {
    let fx = Fixture::new();
    fx.skill(".agents/skills/shared", "shared");
    let link = fx.relative_link(".claude/skills/shared", ".agents/skills/shared");

    let moved = disable(&item(&link.join("SKILL.md"))).expect("disable");

    assert!(moved.ends_with(".skillmanager-disabled/shared/SKILL.md"));
    assert!(
        moved.exists(),
        "the manifest still resolves through the link"
    );
    assert!(
        std::fs::read_link(moved.parent().expect("parent"))
            .expect("read_link")
            .is_relative(),
        "a relative link stays relative"
    );
}

#[test]
fn the_skill_a_link_points_at_is_never_touched() {
    let fx = Fixture::new();
    let manifest = fx.skill(".agents/skills/shared", "shared");
    let link = fx.relative_link(".claude/skills/shared", ".agents/skills/shared");
    let before = std::fs::read_to_string(&manifest).expect("read");

    disable(&item(&link.join("SKILL.md"))).expect("disable");

    assert!(manifest.exists(), "the original is still there");
    assert_eq!(std::fs::read_to_string(&manifest).expect("read"), before);
    assert!(fx.home().join(".agents/skills/shared/helper.py").exists());
}

#[test]
fn moving_one_of_several_links_to_the_same_target_leaves_the_others_alone() {
    let fx = Fixture::new();
    fx.skill(".agents/skills/shared", "shared");
    let claude = fx.relative_link(".claude/skills/shared", ".agents/skills/shared");
    let cursor = fx.relative_link(".cursor/skills/shared", ".agents/skills/shared");

    disable(&item(&claude.join("SKILL.md"))).expect("disable");

    assert!(
        cursor.join("SKILL.md").exists(),
        "the other link still reads through"
    );
    assert!(fx.home().join(".agents/skills/shared/SKILL.md").exists());
}

#[test]
fn a_link_survives_a_full_round_trip() {
    let fx = Fixture::new();
    let target = fx.write(".agents/commands/review.md", "shared");
    let link = fx.relative_link(".claude/commands/review.md", ".agents/commands/review.md");
    let before = std::fs::read_link(&link).expect("read_link");

    let disabled = disable(&item(&link)).expect("disable");
    let restored = enable(&item(&disabled)).expect("enable");

    assert_eq!(restored, link);
    assert_eq!(
        std::fs::read_link(&restored).expect("read_link"),
        before,
        "back at its original depth the link reads exactly as it did before"
    );
    assert_eq!(std::fs::read_to_string(&restored).expect("read"), "shared");
    assert_eq!(std::fs::read_to_string(&target).expect("read"), "shared");
}

// -------------------------------------------------------------------- deleting

#[test]
fn deleting_a_flat_file_removes_it() {
    let fx = Fixture::new();
    let file = fx.write(".claude/commands/review.md", "body");
    toggle::delete_item(&item(&file)).expect("delete");
    assert!(!file.exists());
}

#[test]
fn deleting_a_skill_removes_the_whole_folder() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/writing", "writing");
    toggle::delete_item(&item(&manifest)).expect("delete");
    assert!(!fx.home().join(".claude/skills/writing").exists());
}

/// The one that would destroy the user's shared skills folder if
/// `remove_dir_all` were used on a directory symlink.
#[test]
fn deleting_a_project_link_removes_the_link_and_not_the_skill() {
    let fx = Fixture::new();
    let manifest = fx.skill(".agents/skills/shared", "shared");
    let link = fx.relative_link("work/demo/.claude/skills/shared", ".agents/skills/shared");

    toggle::delete_item(&item(&link.join("SKILL.md"))).expect("delete");

    assert!(!link.exists(), "the link is gone");
    assert!(std::fs::symlink_metadata(&link).is_err());
    assert!(manifest.exists(), "the skill it pointed at survives");
    assert!(fx.home().join(".agents/skills/shared/helper.py").exists());
}

// ------------------------------------------------------------ plugin bundles

#[test]
fn switching_a_plugin_off_records_it_without_disturbing_other_settings() {
    let fx = Fixture::new();
    fx.write(
        ".claude/settings.json",
        r#"{"theme":"dark","enabledPlugins":{"other@market":true}}"#,
    );
    let claude = tools::find(tools::default_tools(), "claude-code").expect("tool");

    toggle::set_plugin_enabled(claude, "toolkit@acme", false, fx.home()).expect("toggle");

    let raw = std::fs::read_to_string(fx.home().join(".claude/settings.json")).expect("read");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("json");
    assert_eq!(
        parsed["theme"], "dark",
        "the tool's own settings are preserved"
    );
    assert_eq!(parsed["enabledPlugins"]["other@market"], true);
    assert_eq!(parsed["enabledPlugins"]["toolkit@acme"], false);
}

#[test]
fn a_plugin_with_no_recorded_decision_can_still_be_switched_off() {
    let fx = Fixture::new();
    fx.mkdir(".claude");
    let claude = tools::find(tools::default_tools(), "claude-code").expect("tool");

    toggle::set_plugin_enabled(claude, "toolkit@acme", false, fx.home()).expect("toggle");

    let raw = std::fs::read_to_string(fx.home().join(".claude/settings.json")).expect("read");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("json");
    assert_eq!(parsed["enabledPlugins"]["toolkit@acme"], false);
}

#[test]
fn a_tool_with_no_settings_file_says_so_rather_than_inventing_one() {
    let fx = Fixture::new();
    let cursor = tools::find(tools::default_tools(), "cursor").expect("tool");

    let err = toggle::set_plugin_enabled(cursor, "anything", false, fx.home())
        .expect_err("should refuse");

    assert_eq!(err.code(), "plugin-toggle-unsupported");
}
