//! Plugin bundles and dangling symlinks.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};

use skills_core::model::{ProjectWorkspace, ToolConfig};
use skills_core::scan;
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

    fn skill(&self, relative: &str, name: &str) -> PathBuf {
        self.write(
            &format!("{relative}/SKILL.md"),
            &format!("---\nname: {name}\ndescription: {name} does things\n---\n"),
        )
    }
}

fn tool(id: &str) -> &'static ToolConfig {
    tools::find(tools::default_tools(), id).expect("tool exists")
}

/// A registry entry for Claude Code, with one install path.
fn write_claude_registry(fx: &Fixture, key: &str, install_path: &Path) {
    fx.write(
        ".claude/plugins/installed_plugins.json",
        &format!(
            r#"{{"version":2,"plugins":{{"{key}":[{{"scope":"user","installPath":{}}}]}}}}"#,
            serde_json::to_string(install_path).expect("json")
        ),
    );
}

// ------------------------------------------------------------------- plugins

#[test]
fn finds_a_registry_plugin_and_the_skills_inside_it() {
    let fx = Fixture::new();
    let install = fx.mkdir(".claude/plugins/cache/acme/toolkit/1.0.0");
    fx.skill(
        ".claude/plugins/cache/acme/toolkit/1.0.0/skills/linting",
        "linting",
    );
    write_claude_registry(&fx, "toolkit@acme", &install);

    let scan = scan::scan_all_plugins(&[tool("claude-code").clone()], fx.home());

    assert_eq!(scan.plugins.len(), 1);
    let plugin = &scan.plugins[0];
    assert_eq!(plugin.id, "toolkit@acme");
    assert_eq!(plugin.name, "toolkit");
    assert_eq!(plugin.group.as_deref(), Some("acme"));
    assert!(plugin.enabled, "absent from enabledPlugins means enabled");

    assert_eq!(scan.items.len(), 1);
    assert_eq!(scan.items[0].name, "linting");
    assert_eq!(scan.items[0].plugin_id.as_deref(), Some("toolkit@acme"));
    assert_eq!(scan.items[0].project_id, None);
}

#[test]
fn a_plugin_switched_off_in_settings_reports_as_disabled() {
    let fx = Fixture::new();
    let install = fx.mkdir(".claude/plugins/cache/acme/toolkit/1.0.0");
    fx.skill(
        ".claude/plugins/cache/acme/toolkit/1.0.0/skills/linting",
        "linting",
    );
    write_claude_registry(&fx, "toolkit@acme", &install);
    fx.write(
        ".claude/settings.json",
        r#"{"enabledPlugins":{"toolkit@acme":false}}"#,
    );

    let scan = scan::scan_all_plugins(&[tool("claude-code").clone()], fx.home());

    assert!(!scan.plugins[0].enabled);
    // The item's own folder says enabled; the bundle overrules it.
    assert!(!scan.items[0].enabled);
}

#[test]
fn reads_a_github_repository_from_the_manifest_and_rejects_anything_else() {
    let fx = Fixture::new();
    let install = fx.mkdir(".claude/plugins/cache/acme/toolkit/1.0.0");
    write_claude_registry(&fx, "toolkit@acme", &install);

    fx.write(
        ".claude/plugins/cache/acme/toolkit/1.0.0/.claude-plugin/plugin.json",
        r#"{"name":"toolkit","repository":"https://github.com/acme/toolkit"}"#,
    );
    let scan = scan::scan_all_plugins(&[tool("claude-code").clone()], fx.home());
    assert_eq!(
        scan.plugins[0].repo_url.as_deref(),
        Some("https://github.com/acme/toolkit")
    );

    fx.write(
        ".claude/plugins/cache/acme/toolkit/1.0.0/.claude-plugin/plugin.json",
        r#"{"name":"toolkit","repository":"https://gitlab.com/acme/toolkit"}"#,
    );
    let scan = scan::scan_all_plugins(&[tool("claude-code").clone()], fx.home());
    assert_eq!(scan.plugins[0].repo_url, None);
}

#[test]
fn a_missing_or_malformed_registry_yields_no_plugins_rather_than_an_error() {
    let fx = Fixture::new();
    let scan = scan::scan_all_plugins(&[tool("claude-code").clone()], fx.home());
    assert!(scan.plugins.is_empty());

    fx.write(".claude/plugins/installed_plugins.json", "{ not json");
    let scan = scan::scan_all_plugins(&[tool("claude-code").clone()], fx.home());
    assert!(scan.plugins.is_empty());
}

#[test]
fn finds_a_cached_bundle_only_where_the_marker_file_is() {
    let fx = Fixture::new();
    // A real installed bundle.
    fx.write(
        ".codex/plugins/cache/store/helper/2.1.0/.codex-plugin/plugin.json",
        r#"{"name":"Helper"}"#,
    );
    fx.skill(
        ".codex/plugins/cache/store/helper/2.1.0/skills/fix",
        "fix-things",
    );
    // A marketplace source tree that only looks like one.
    fx.skill(
        ".codex/plugins/cache/store/not-installed/0.1.0/skills/nope",
        "nope",
    );

    let scan = scan::scan_all_plugins(&[tool("codex").clone()], fx.home());

    assert_eq!(scan.plugins.len(), 1);
    assert_eq!(scan.plugins[0].id, "codex:store:helper");
    assert_eq!(scan.plugins[0].name, "Helper", "manifest name wins");
    assert_eq!(scan.plugins[0].group.as_deref(), Some("store"));
    assert_eq!(scan.items.len(), 1);
    assert_eq!(scan.items[0].name, "fix-things");
}

#[test]
fn a_bundle_lays_commands_out_where_the_tool_says_it_does() {
    let fx = Fixture::new();
    // Codex's global commands live in `prompts`, but inside a bundle in `commands`.
    fx.write(
        ".codex/plugins/cache/store/helper/1.0.0/.codex-plugin/plugin.json",
        "{}",
    );
    fx.write(
        ".codex/plugins/cache/store/helper/1.0.0/commands/deploy.md",
        "---\nname: deploy\n---\n",
    );
    fx.write(
        ".codex/plugins/cache/store/helper/1.0.0/prompts/ignored.md",
        "---\nname: ignored\n---\n",
    );

    let scan = scan::scan_all_plugins(&[tool("codex").clone()], fx.home());
    let names: Vec<&str> = scan.items.iter().map(|i| i.name.as_str()).collect();
    assert_eq!(names, vec!["deploy"]);
}

// ------------------------------------------------------------ broken symlinks

#[test]
fn reports_a_dangling_link_that_the_item_scan_passes_over() {
    let fx = Fixture::new();
    fx.skill(".claude/skills/good", "good");
    fx.mkdir(".claude/skills");
    skills_core::platform::symlink(
        &fx.home().join("moved-away"),
        &fx.home().join(".claude/skills/orphan"),
        true,
    )
    .expect("symlink");

    let items = scan::scan_tool(tool("claude-code"), fx.home()).items;
    assert_eq!(items.len(), 1, "the item scan skips it");

    let broken = scan::scan_broken_symlinks(&[tool("claude-code").clone()], &[], fx.home());
    assert_eq!(broken.len(), 1);
    assert!(broken[0].path.ends_with("orphan"));
    assert!(broken[0].target_path.ends_with("moved-away"));
    assert_eq!(broken[0].tool, "claude-code");
}

/// Exactly the shape found on this machine: the folder is real, the manifest
/// inside it is a link to something that is gone.
#[test]
fn reports_a_dangling_manifest_inside_a_real_folder() {
    let fx = Fixture::new();
    let dir = fx.mkdir(".claude/skills/half-installed");
    skills_core::platform::symlink(
        &fx.home().join("opt/tool/SKILL.md"),
        &dir.join("SKILL.md"),
        false,
    )
    .expect("symlink");

    let broken = scan::scan_broken_symlinks(&[tool("claude-code").clone()], &[], fx.home());
    assert_eq!(broken.len(), 1);
    assert!(broken[0].path.ends_with("half-installed/SKILL.md"));
}

#[test]
fn a_link_that_resolves_is_not_reported() {
    let fx = Fixture::new();
    let real = fx.skill(".agents/skills/shared", "shared");
    let real_dir = real.parent().expect("parent").to_path_buf();
    fx.mkdir(".claude/skills");
    skills_core::platform::symlink(&real_dir, &fx.home().join(".claude/skills/shared"), true)
        .expect("symlink");

    let broken = scan::scan_broken_symlinks(&[tool("claude-code").clone()], &[], fx.home());
    assert!(broken.is_empty(), "found {broken:?}");
}

#[test]
fn a_dangling_link_inside_the_disabled_folder_is_still_reported() {
    let fx = Fixture::new();
    fx.mkdir(".claude/skills/.skillmanager-disabled");
    skills_core::platform::symlink(
        &fx.home().join("gone"),
        &fx.home()
            .join(".claude/skills/.skillmanager-disabled/parked"),
        true,
    )
    .expect("symlink");

    let broken = scan::scan_broken_symlinks(&[tool("claude-code").clone()], &[], fx.home());
    assert_eq!(broken.len(), 1);
}

#[test]
fn reports_a_dangling_link_in_a_project_and_names_the_project() {
    let fx = Fixture::new();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Demo".into(),
        path: fx.mkdir("work/demo"),
    };
    fx.mkdir("work/demo/.claude/skills");
    skills_core::platform::symlink(
        &fx.home().join("gone"),
        &fx.home().join("work/demo/.claude/skills/link"),
        true,
    )
    .expect("symlink");

    let broken = scan::scan_broken_symlinks(
        &[tool("claude-code").clone()],
        std::slice::from_ref(&project),
        fx.home(),
    );
    assert_eq!(broken.len(), 1);
    assert_eq!(broken[0].project_id.as_deref(), Some("p1"));
}
