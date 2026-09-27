//! Scanner behaviour, against real directory trees.
//!
//! The cases mirror the Obsidian plugin's own suite, which is the closest thing
//! to a specification for the layouts these tools actually produce. Everything
//! runs under `$TMPDIR`, and `home` is injected, so nothing here depends on the
//! machine it runs on.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};

use skills_core::model::{DiscoveredItem, ItemType, ProjectWorkspace, RulePathEntry, ToolConfig};
use skills_core::scan;
use skills_core::tools;

// ---------------------------------------------------------------- fixtures

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

    /// Writes a file, creating parent directories. Content may be empty.
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

    /// A skill: a folder with a `SKILL.md` in it.
    fn skill(&self, relative: &str, name: &str, description: &str) -> PathBuf {
        self.write(
            &format!("{relative}/SKILL.md"),
            &format!("---\nname: {name}\ndescription: {description}\n---\n\nBody.\n"),
        )
    }

    fn symlink(&self, target: &Path, link_relative: &str) {
        let link = self.home().join(link_relative);
        if let Some(parent) = link.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        let is_dir = target.is_dir();
        skills_core::platform::symlink(target, &link, is_dir).expect("symlink");
    }
}

fn tool(id: &str) -> &'static ToolConfig {
    tools::find(tools::default_tools(), id).expect("tool exists")
}

fn names(items: &[DiscoveredItem]) -> Vec<&str> {
    let mut out: Vec<&str> = items.iter().map(|i| i.name.as_str()).collect();
    out.sort_unstable();
    out
}

fn of_type(items: &[DiscoveredItem], item_type: ItemType) -> Vec<&DiscoveredItem> {
    items.iter().filter(|i| i.item_type == item_type).collect()
}

fn find<'a>(items: &'a [DiscoveredItem], name: &str) -> &'a DiscoveredItem {
    items
        .iter()
        .find(|i| i.name == name)
        .unwrap_or_else(|| panic!("no item named {name}; found {:?}", names(items)))
}

// ------------------------------------------------------------------- shapes

#[test]
fn finds_a_folder_skill_and_reads_its_frontmatter() {
    let fx = Fixture::new();
    fx.skill(".claude/skills/writing", "writing-well", "Helps you write");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    let skills = of_type(&out.items, ItemType::Skill);

    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "writing-well");
    assert_eq!(skills[0].description, "Helps you write");
    assert!(skills[0].enabled);
    assert!(skills[0].source_path.ends_with("SKILL.md"));
}

#[test]
fn falls_back_to_the_folder_name_when_frontmatter_declares_none() {
    let fx = Fixture::new();
    fx.write(
        ".claude/skills/untitled/SKILL.md",
        "Just a body, no frontmatter.\n",
    );

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(names(&out.items), vec!["untitled"]);
}

#[test]
fn finds_flat_markdown_files() {
    let fx = Fixture::new();
    fx.write(".claude/commands/review.md", "---\nname: review\n---\n");
    fx.write(".claude/commands/deploy.md", "no frontmatter");
    fx.write(".claude/commands/notes.txt", "ignored");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(
        names(
            &of_type(&out.items, ItemType::Command)
                .into_iter()
                .cloned()
                .collect::<Vec<_>>()
        ),
        vec!["deploy", "review"]
    );
}

#[test]
fn strips_a_compound_suffix_whole_rather_than_only_the_extension() {
    let fx = Fixture::new();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Demo".into(),
        path: fx.mkdir("work/demo"),
    };
    fx.write(
        "work/demo/.github/instructions/style.instructions.md",
        "rules",
    );
    fx.write("work/demo/.github/prompts/refactor.prompt.md", "prompt");

    let out = scan::scan_project(&[tool("copilot").clone()], &project, fx.home());
    assert_eq!(names(&out.items), vec!["refactor", "style"]);
}

// ----------------------------------------------------------- category folders

#[test]
fn descends_into_a_folder_that_is_not_itself_a_skill() {
    let fx = Fixture::new();
    fx.skill(
        ".claude/skills/engineering/tdd",
        "tdd",
        "Test-driven development",
    );
    fx.skill(
        ".claude/skills/engineering/review",
        "code-review",
        "Reviews code",
    );

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(names(&out.items), vec!["code-review", "tdd"]);
}

#[test]
fn stops_descending_past_the_depth_limit() {
    let fx = Fixture::new();
    let deep = "a/b/c/d/e/f";
    fx.skill(
        &format!(".claude/skills/{deep}/buried"),
        "buried",
        "too deep",
    );
    fx.skill(".claude/skills/shallow", "shallow", "right here");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(names(&out.items), vec!["shallow"]);
}

#[test]
fn never_descends_into_node_modules_or_git() {
    let fx = Fixture::new();
    fx.skill(".claude/skills/node_modules/pkg", "from-node-modules", "no");
    fx.skill(".claude/skills/.git/hooks", "from-git", "no");
    fx.skill(".claude/skills/real", "real", "yes");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(names(&out.items), vec!["real"]);
}

// ------------------------------------------------------------ enabled/disabled

#[test]
fn pairs_the_disabled_folder_with_its_enabled_sibling() {
    let fx = Fixture::new();
    fx.skill(".claude/skills/on", "on", "enabled");
    fx.skill(
        ".claude/skills/.skillmanager-disabled/off",
        "off",
        "disabled",
    );

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(names(&out.items), vec!["off", "on"]);
    assert!(find(&out.items, "on").enabled);
    assert!(!find(&out.items, "off").enabled);
}

/// The subtle one. A disabled item inside a category folder sits in a disabled
/// folder *inside that category*, so pairing only at the configured root would
/// miss it entirely — invisible to the enabled walk, which skips the folder by
/// name, and to a root-only disabled pass.
#[test]
fn finds_an_item_disabled_inside_a_category_folder() {
    let fx = Fixture::new();
    fx.skill(".claude/skills/engineering/tdd", "tdd", "enabled");
    fx.skill(
        ".claude/skills/engineering/.skillmanager-disabled/legacy",
        "legacy",
        "disabled",
    );

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(names(&out.items), vec!["legacy", "tdd"]);
    assert!(!find(&out.items, "legacy").enabled);
}

#[test]
fn nothing_is_disabled_within_a_disabled_folder() {
    let fx = Fixture::new();
    fx.skill(
        ".claude/skills/.skillmanager-disabled/.skillmanager-disabled/nested",
        "nested",
        "should not appear",
    );

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert!(out.items.is_empty(), "found {:?}", names(&out.items));
}

// ------------------------------------------------------------- single-file rules

#[test]
fn reads_a_single_instructions_file_as_one_item() {
    let fx = Fixture::new();
    fx.write(".claude/CLAUDE.md", "# My memory\n");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    let rules = of_type(&out.items, ItemType::Rule);
    assert_eq!(rules.len(), 1);
    assert_eq!(rules[0].name, "CLAUDE");
    assert!(rules[0].enabled);
}

#[test]
fn finds_a_disabled_instructions_file_beside_its_enabled_position() {
    let fx = Fixture::new();
    fx.write(".claude/.skillmanager-disabled/CLAUDE.md", "# Parked\n");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    let rules = of_type(&out.items, ItemType::Rule);
    assert_eq!(rules.len(), 1);
    assert!(!rules[0].enabled);
}

#[test]
fn a_missing_instructions_file_yields_nothing_rather_than_an_error() {
    let fx = Fixture::new();
    fx.mkdir(".claude");
    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert!(of_type(&out.items, ItemType::Rule).is_empty());
    assert!(out.warnings.is_empty());
}

// ----------------------------------------------------------------- symlinks

#[test]
fn follows_a_symlinked_skill_and_records_where_it_really_lives() {
    let fx = Fixture::new();
    let real = fx.skill(".agents/skills/shared", "shared-skill", "the original");
    let real_dir = real.parent().expect("parent").to_path_buf();
    fx.mkdir(".claude/skills");
    fx.symlink(&real_dir, ".claude/skills/shared");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    let item = find(&out.items, "shared-skill");

    assert!(
        item.source_path
            .starts_with(fx.home().join(".claude/skills"))
    );
    assert!(
        item.real_path
            .starts_with(scan::real_path(&fx.home().join(".agents/skills"))),
        "real_path should point at the original: {:?}",
        item.real_path
    );
}

/// Two links to one file stay two items. They are separately toggleable, and
/// collapsing them would make disabling one look like disabling both.
#[test]
fn two_paths_to_one_real_file_remain_two_items() {
    let fx = Fixture::new();
    let real = fx.skill(".agents/skills/shared", "shared", "one original");
    let real_dir = real.parent().expect("parent").to_path_buf();
    fx.mkdir(".claude/skills");
    fx.mkdir(".cursor/skills");
    fx.symlink(&real_dir, ".claude/skills/shared");
    fx.symlink(&real_dir, ".cursor/skills/shared");

    let out = scan::scan_all_tools(
        &[tool("claude-code").clone(), tool("cursor").clone()],
        fx.home(),
    );
    let found: Vec<_> = out.items.iter().filter(|i| i.name == "shared").collect();

    assert_eq!(found.len(), 2);
    assert_ne!(found[0].entry_id, found[1].entry_id);
    assert_eq!(found[0].real_path, found[1].real_path);
}

#[test]
fn a_dangling_symlink_is_skipped_rather_than_failing_the_scan() {
    let fx = Fixture::new();
    fx.skill(".claude/skills/good", "good", "fine");
    fx.mkdir(".claude/skills");
    skills_core::platform::symlink(
        &fx.home().join("gone"),
        &fx.home().join(".claude/skills/dangling"),
        true,
    )
    .expect("symlink");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    assert_eq!(names(&out.items), vec!["good"]);
}

#[test]
fn a_symlink_loop_does_not_repeat_items() {
    let fx = Fixture::new();
    let skills = fx.mkdir(".claude/skills");
    fx.skill(".claude/skills/category/real", "real", "once");
    // A link from inside the tree back to its own root.
    fx.symlink(&skills, ".claude/skills/category/loop");

    let out = scan::scan_tool(tool("claude-code"), fx.home());
    let count = out.items.iter().filter(|i| i.name == "real").count();
    assert_eq!(count, 1, "found {:?}", names(&out.items));
}

// -------------------------------------------------------------- odd configs

#[test]
fn a_configured_path_that_is_a_file_is_not_an_error() {
    let fx = Fixture::new();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Legacy".into(),
        path: fx.mkdir("work/legacy"),
    };
    // Cline's `.clinerules` used to be a single file rather than a directory.
    fx.write("work/legacy/.clinerules", "be nice\n");

    let out = scan::scan_project(&[tool("cline").clone()], &project, fx.home());
    assert!(out.warnings.is_empty(), "warnings: {:?}", out.warnings);
}

#[test]
fn a_missing_root_produces_neither_items_nor_warnings() {
    let fx = Fixture::new();
    let out = scan::scan_all_tools(tools::default_tools(), fx.home());
    assert!(out.items.is_empty());
    assert!(out.warnings.is_empty());
}

#[test]
fn scans_an_extra_rule_path_the_user_added() {
    let fx = Fixture::new();
    let mut custom = tool("cursor").clone();
    custom.rule_additional_paths = vec![RulePathEntry {
        path: "~/extra-rules".into(),
        single_file: false,
    }];
    fx.write(
        "extra-rules/house-style.md",
        "---\nname: house-style\n---\n",
    );

    let out = scan::scan_tool(&custom, fx.home());
    assert_eq!(names(&out.items), vec!["house-style"]);
}

// --------------------------------------------------------------- project scope

#[test]
fn a_project_scan_tags_items_with_the_project_id() {
    let fx = Fixture::new();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Demo".into(),
        path: fx.mkdir("work/demo"),
    };
    fx.skill(
        "work/demo/.claude/skills/local",
        "local-skill",
        "project scoped",
    );

    let out = scan::scan_project(&[tool("claude-code").clone()], &project, fx.home());
    let item = find(&out.items, "local-skill");
    assert_eq!(item.project_id.as_deref(), Some("p1"));
}

#[test]
fn the_same_skill_globally_and_in_a_project_gets_different_ids() {
    let fx = Fixture::new();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Demo".into(),
        path: fx.mkdir("work/demo"),
    };
    fx.skill(".claude/skills/dup", "dup", "global");
    fx.skill("work/demo/.claude/skills/dup", "dup", "project");

    let claude = [tool("claude-code").clone()];
    let mut out = scan::scan_all_tools(&claude, fx.home());
    let project_out = scan::scan_project(&claude, &project, fx.home());
    out.items.extend(project_out.items);

    let found: Vec<_> = out.items.iter().filter(|i| i.name == "dup").collect();
    assert_eq!(found.len(), 2);
    assert_ne!(found[0].entry_id, found[1].entry_id);
}
