//! Linking a global item into a project.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};

use skills_core::model::{
    DiscoveredItem, InstallSource, ItemMetadata, ItemType, ProjectWorkspace, ToolConfig,
};
use skills_core::{projectlink, scan, tools};

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

    fn skill(&self, relative: &str, name: &str) -> PathBuf {
        let manifest = self.write(
            &format!("{relative}/SKILL.md"),
            &format!("---\nname: {name}\n---\n"),
        );
        self.write(&format!("{relative}/helper.py"), "print('hi')\n");
        manifest
    }

    fn project(&self, relative: &str) -> ProjectWorkspace {
        ProjectWorkspace {
            id: "p1".to_owned(),
            name: "Demo".to_owned(),
            path: self.mkdir(relative),
        }
    }
}

fn tool(id: &str) -> &'static ToolConfig {
    tools::find(tools::default_tools(), id).expect("tool exists")
}

fn item(source_path: &Path, item_type: ItemType) -> ItemMetadata {
    ItemMetadata {
        discovered: DiscoveredItem {
            entry_id: "test".into(),
            source_path: source_path.to_path_buf(),
            real_path: source_path.to_path_buf(),
            tool: "claude-code".into(),
            item_type,
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

#[test]
fn links_a_skill_into_a_project_where_the_tool_will_look() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/writing", "writing");
    let project = fx.project("work/demo");

    let link = projectlink::add_to_project(
        &item(&manifest, ItemType::Skill),
        tool("claude-code"),
        &project,
        fx.home(),
    )
    .expect("link");

    assert_eq!(link, project.path.join(".claude/skills/writing"));
    assert!(link.join("SKILL.md").exists(), "it resolves through");
    assert!(link.join("helper.py").exists(), "and so do its companions");
    assert!(
        std::fs::symlink_metadata(&link)
            .expect("lstat")
            .file_type()
            .is_symlink(),
        "linked, never copied"
    );
}

/// The correction. Copilot's project rules live under `.github/`, so deriving
/// the path from the global one would put the link somewhere nothing reads.
#[test]
fn honours_a_tools_project_path_rather_than_deriving_it() {
    let fx = Fixture::new();
    let rule = fx.write(".copilot/instructions/style.md", "---\nname: style\n---\n");
    let project = fx.project("work/demo");

    let link = projectlink::add_to_project(
        &item(&rule, ItemType::Rule),
        tool("copilot"),
        &project,
        fx.home(),
    )
    .expect("link");

    assert_eq!(link, project.path.join(".github/instructions/style.md"));
    assert!(
        !project.path.join(".copilot").exists(),
        "not the derived path"
    );
}

#[test]
fn the_project_scan_then_finds_the_linked_item() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/writing", "writing");
    let project = fx.project("work/demo");

    projectlink::add_to_project(
        &item(&manifest, ItemType::Skill),
        tool("claude-code"),
        &project,
        fx.home(),
    )
    .expect("link");

    let found = scan::scan_project(&[tool("claude-code").clone()], &project, fx.home()).items;
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].name, "writing");
    assert_eq!(found[0].project_id.as_deref(), Some("p1"));
    assert_eq!(found[0].real_path, scan::real_path(&manifest));
}

#[test]
fn linking_twice_changes_nothing() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/writing", "writing");
    let project = fx.project("work/demo");
    let metadata = item(&manifest, ItemType::Skill);

    let first = projectlink::add_to_project(&metadata, tool("claude-code"), &project, fx.home())
        .expect("a");
    let second = projectlink::add_to_project(&metadata, tool("claude-code"), &project, fx.home())
        .expect("b");

    assert_eq!(first, second);
}

#[test]
fn unlinking_removes_the_link_and_leaves_the_skill() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/writing", "writing");
    let project = fx.project("work/demo");
    let link = projectlink::add_to_project(
        &item(&manifest, ItemType::Skill),
        tool("claude-code"),
        &project,
        fx.home(),
    )
    .expect("link");

    projectlink::remove_from_project(&link.join("SKILL.md")).expect("unlink");

    assert!(
        std::fs::symlink_metadata(&link).is_err(),
        "the link is gone"
    );
    assert!(manifest.exists(), "the skill survives");
    assert!(fx.home().join(".claude/skills/writing/helper.py").exists());
}

/// Unlinking must never become a way of deleting a real item.
#[test]
fn unlinking_something_that_is_not_a_link_is_refused() {
    let fx = Fixture::new();
    let manifest = fx.skill(".claude/skills/writing", "writing");

    let err = projectlink::remove_from_project(&manifest).expect_err("should refuse");

    assert_eq!(err.code(), "not-a-link");
    assert!(manifest.exists());
}

#[test]
fn a_tool_with_nowhere_to_put_it_says_so() {
    let fx = Fixture::new();
    let skill = fx.skill(".goose/skills/thing", "thing");
    let project = fx.project("work/demo");

    // Goose has no project path for commands.
    let err = projectlink::add_to_project(
        &item(&skill, ItemType::Command),
        tool("goose"),
        &project,
        fx.home(),
    )
    .expect_err("should refuse");

    assert_eq!(err.code(), "no-project-path");
}

/// A link to a link breaks as soon as any hop in the chain moves.
#[test]
fn links_through_to_where_the_item_really_lives() {
    let fx = Fixture::new();
    let real = fx.skill(".agents/skills/shared", "shared");
    let real_dir = real.parent().expect("parent").to_path_buf();
    fx.mkdir(".claude/skills");
    let intermediate = fx.home().join(".claude/skills/shared");
    skills_core::platform::symlink(&real_dir, &intermediate, true).expect("symlink");

    let project = fx.project("work/demo");
    let link = projectlink::add_to_project(
        &item(&intermediate.join("SKILL.md"), ItemType::Skill),
        tool("claude-code"),
        &project,
        fx.home(),
    )
    .expect("link");

    assert_eq!(
        std::fs::read_link(&link).expect("read_link"),
        scan::real_path(&real_dir),
        "points at the original, not at the other link"
    );
}
