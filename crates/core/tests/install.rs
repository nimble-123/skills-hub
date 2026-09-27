//! Installing from a repository, and keeping what was installed up to date.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};

use skills_core::diff::CompanionStatus;
use skills_core::git::{GitRunner as _, SystemGit};
use skills_core::install::{self, InstallRequest, ReviewMode, UpdateStatus};
use skills_core::model::{ItemType, ProjectWorkspace, ToolConfig};
use skills_core::tools;

struct Origin {
    dir: tempfile::TempDir,
}

impl Origin {
    fn new() -> Self {
        let origin = Self {
            dir: tempfile::tempdir().expect("tempdir"),
        };
        origin.git(&["init", "--quiet", "--initial-branch", "main"]);
        origin.git(&["config", "user.email", "test@example.invalid"]);
        origin.git(&["config", "user.name", "Test"]);
        origin
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    fn url(&self) -> String {
        self.path().to_string_lossy().into_owned()
    }

    fn git(&self, args: &[&str]) -> String {
        SystemGit
            .run(args, Some(self.path()))
            .unwrap_or_else(|err| panic!("git {args:?}: {err}"))
    }

    fn write(&self, relative: &str, content: &str) -> &Self {
        let path = self.path().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, content).expect("write");
        self
    }

    fn remove(&self, relative: &str) -> &Self {
        let path = self.path().join(relative);
        if path.is_dir() {
            std::fs::remove_dir_all(path).expect("rmdir");
        } else {
            std::fs::remove_file(path).expect("rm");
        }
        self
    }

    fn commit(&self) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "--quiet", "--allow-empty", "-m", "change"]);
        self.git(&["rev-parse", "HEAD"]).trim().to_owned()
    }
}

struct Home {
    dir: tempfile::TempDir,
}

impl Home {
    fn new() -> Self {
        Self {
            dir: tempfile::tempdir().expect("tempdir"),
        }
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }
}

fn tool(id: &str) -> &'static ToolConfig {
    tools::find(tools::default_tools(), id).expect("tool")
}

fn request<'a>(origin: &'a Origin, subpath: &'a str, url: &'a str) -> InstallRequest<'a> {
    let _ = origin;
    InstallRequest {
        repo_url: url,
        ref_name: "",
        subpath,
        tool: tool("claude-code"),
        item_type: ItemType::Skill,
        project: None,
    }
}

/// A repository holding one folder skill with a companion file.
fn a_skill_repo() -> Origin {
    let origin = Origin::new();
    origin
        .write(
            "skills/writing/SKILL.md",
            "---\nname: writing\ndescription: Helps you write\n---\n\nFirst version.\n",
        )
        .write("skills/writing/references/style.md", "Be brief.\n");
    origin.commit();
    origin
}

// ------------------------------------------------------------------ install

#[test]
fn installs_a_folder_skill_where_the_tool_reads_it() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();

    let installed = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    let folder = home.path().join(".claude/skills/writing");
    assert!(folder.join("SKILL.md").exists());
    assert!(
        folder.join("references/style.md").exists(),
        "companions come too"
    );
    assert_eq!(installed.source_path, folder.join("SKILL.md"));
    assert_eq!(installed.name, "writing");
    assert_eq!(installed.description, "Helps you write");
}

#[test]
fn records_where_it_came_from_so_it_can_be_updated_later() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let commit = origin.git(&["rev-parse", "HEAD"]).trim().to_owned();

    let installed = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    assert_eq!(installed.source.source_repo.as_deref(), Some(url.as_str()));
    assert_eq!(
        installed.source.source_subpath.as_deref(),
        Some("skills/writing")
    );
    assert_eq!(
        installed.source.source_commit.as_deref(),
        Some(commit.as_str())
    );
}

/// An installed item is plain files. A repository inside someone's skills
/// folder is a nested checkout their own tooling then has to reason about.
#[test]
fn what_lands_on_disk_has_no_repository_in_it() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();

    install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    assert!(!home.path().join(".claude/skills/writing/.git").exists());
}

#[test]
fn installs_a_flat_file() {
    let origin = Origin::new();
    origin.write("commands/deploy.md", "---\nname: deploy\n---\n\nRun it.\n");
    origin.commit();
    let home = Home::new();
    let url = origin.url();

    let mut spec = request(&origin, "commands/deploy.md", &url);
    spec.item_type = ItemType::Command;
    let installed = install::install(&SystemGit, &spec, home.path()).expect("install");

    assert_eq!(
        installed.source_path,
        home.path().join(".claude/commands/deploy.md")
    );
    assert!(installed.source_path.exists());
}

#[test]
fn installs_into_a_project_when_asked() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let project = ProjectWorkspace {
        id: "p1".into(),
        name: "Demo".into(),
        path: home.path().join("work/demo"),
    };
    std::fs::create_dir_all(&project.path).expect("mkdir");

    let mut spec = request(&origin, "skills/writing", &url);
    spec.project = Some(&project);
    install::install(&SystemGit, &spec, home.path()).expect("install");

    assert!(
        project
            .path
            .join(".claude/skills/writing/SKILL.md")
            .exists()
    );
    assert!(!home.path().join(".claude/skills/writing").exists());
}

#[test]
fn names_a_whole_repository_after_the_repository() {
    let origin = Origin::new();
    origin.write("SKILL.md", "---\nname: standalone\n---\n");
    origin.commit();
    let home = Home::new();
    let url = origin.url();
    let expected = Path::new(&url)
        .file_name()
        .expect("name")
        .to_string_lossy()
        .into_owned();

    install::install(&SystemGit, &request(&origin, "", &url), home.path()).expect("install");

    assert!(
        home.path()
            .join(".claude/skills")
            .join(&expected)
            .join("SKILL.md")
            .exists()
    );
}

#[test]
fn refuses_to_overwrite_something_already_there() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let existing = home.path().join(".claude/skills/writing");
    std::fs::create_dir_all(&existing).expect("mkdir");
    std::fs::write(existing.join("SKILL.md"), "mine").expect("write");

    let err = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect_err("should refuse");

    assert_eq!(err.code(), "destination-exists");
    assert_eq!(
        std::fs::read_to_string(existing.join("SKILL.md")).expect("read"),
        "mine"
    );
}

#[test]
fn a_subpath_that_is_not_there_says_so_and_installs_nothing() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();

    let err = install::install(
        &SystemGit,
        &request(&origin, "skills/nope", &url),
        home.path(),
    )
    .expect_err("should fail");

    assert_eq!(err.code(), "subpath-missing");
    assert!(!home.path().join(".claude/skills").exists());
}

// ------------------------------------------------------------ update checks

#[test]
fn says_an_item_is_current_until_the_remote_moves_on() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let installed = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    let (status, _) = install::check_for_update(&SystemGit, &installed.source).expect("check");
    assert_eq!(status, UpdateStatus::Current);

    origin.write(
        "skills/writing/SKILL.md",
        "---\nname: writing\n---\n\nSecond.\n",
    );
    let newer = origin.commit();

    let (status, remote) = install::check_for_update(&SystemGit, &installed.source).expect("check");
    assert_eq!(status, UpdateStatus::Stale);
    assert_eq!(remote.as_deref(), Some(newer.as_str()));
}

#[test]
fn an_item_nobody_installed_is_not_checked_at_all() {
    let (status, remote) =
        install::check_for_update(&SystemGit, &skills_core::model::InstallSource::default())
            .expect("check");
    assert_eq!(status, UpdateStatus::Untracked);
    assert_eq!(remote, None);
}

// ------------------------------------------------------------------ reviews

#[test]
fn a_review_shows_what_would_change_before_anything_does() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let installed = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    origin
        .write(
            "skills/writing/SKILL.md",
            "---\nname: writing\ndescription: Helps you write\n---\n\nSecond version.\n",
        )
        .write(
            "skills/writing/references/style.md",
            "Be brief. And clear.\n",
        )
        .write("skills/writing/scripts/check.py", "print(1)\n")
        .remove("skills/writing/references");
    origin.commit();

    let review = install::prepare_review(
        &SystemGit,
        &installed.source,
        &installed.source_path,
        ReviewMode::Update,
    )
    .expect("review");

    assert!(!review.unchanged);
    assert!(review.stats.added > 0 && review.stats.removed > 0);
    assert!(
        review.lines.iter().any(|line| line
            .segments
            .iter()
            .any(|segment| segment.text.contains("Second"))),
        "the new text is in the diff"
    );

    let by_path = |path: &str| {
        review
            .companions
            .iter()
            .find(|change| change.path == path)
            .map(|change| change.status)
    };
    assert_eq!(by_path("scripts/check.py"), Some(CompanionStatus::Added));
    assert_eq!(
        by_path("references/style.md"),
        Some(CompanionStatus::Removed)
    );

    // Nothing has happened to the local copy yet.
    let local = std::fs::read_to_string(&installed.source_path).expect("read");
    assert!(local.contains("First version."));
}

/// A repository holding many skills moves on for reasons that have nothing to
/// do with this one. Saying so beats showing an empty diff.
#[test]
fn says_when_the_commit_moved_but_this_item_did_not() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let installed = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    origin.write("skills/other/SKILL.md", "---\nname: other\n---\n");
    origin.commit();

    let review = install::prepare_review(
        &SystemGit,
        &installed.source,
        &installed.source_path,
        ReviewMode::Update,
    )
    .expect("review");

    assert!(review.unchanged);
    assert!(review.companions.is_empty());
}

#[test]
fn applying_a_review_replaces_the_local_copy() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let installed = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    origin
        .write(
            "skills/writing/SKILL.md",
            "---\nname: writing\n---\n\nSecond version.\n",
        )
        .remove("skills/writing/references");
    origin.commit();

    let review = install::prepare_review(
        &SystemGit,
        &installed.source,
        &installed.source_path,
        ReviewMode::Update,
    )
    .expect("review");
    install::apply_review(&review).expect("apply");

    let local = std::fs::read_to_string(&installed.source_path).expect("read");
    assert!(local.contains("Second version."));
    assert!(
        !home
            .path()
            .join(".claude/skills/writing/references")
            .exists(),
        "a file the update removed is gone rather than left behind"
    );
}

#[test]
fn restoring_brings_back_the_commit_it_was_installed_at() {
    let origin = a_skill_repo();
    let home = Home::new();
    let url = origin.url();
    let installed = install::install(
        &SystemGit,
        &request(&origin, "skills/writing", &url),
        home.path(),
    )
    .expect("install");

    // Move on, and update to it.
    origin.write(
        "skills/writing/SKILL.md",
        "---\nname: writing\n---\n\nSecond version.\n",
    );
    origin.commit();
    let update = install::prepare_review(
        &SystemGit,
        &installed.source,
        &installed.source_path,
        ReviewMode::Update,
    )
    .expect("review");
    install::apply_review(&update).expect("apply");
    assert!(
        std::fs::read_to_string(&installed.source_path)
            .expect("read")
            .contains("Second version.")
    );

    // Now change our mind.
    let restore = install::prepare_review(
        &SystemGit,
        &installed.source,
        &installed.source_path,
        ReviewMode::Restore,
    )
    .expect("restore review");
    install::apply_review(&restore).expect("apply restore");

    let local = std::fs::read_to_string(&installed.source_path).expect("read");
    assert!(local.contains("First version."), "got: {local}");
    assert!(
        home.path()
            .join(".claude/skills/writing/references/style.md")
            .exists(),
        "and the companion it had at the time"
    );
}

#[test]
fn reviewing_something_that_was_never_installed_from_anywhere_is_refused() {
    let home = Home::new();
    let path: PathBuf = home.path().join("SKILL.md");
    std::fs::write(&path, "---\nname: mine\n---\n").expect("write");

    let err = install::prepare_review(
        &SystemGit,
        &skills_core::model::InstallSource::default(),
        &path,
        ReviewMode::Update,
    )
    .expect_err("should refuse");

    assert_eq!(err.code(), "not-tracked");
}
