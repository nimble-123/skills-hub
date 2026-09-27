//! Talking to git, against real repositories.
//!
//! Made locally and cloned over a file path, so the whole flow — clone, fetch
//! one exact commit, check out — is exercised without a network. Faking the
//! runner would test the argument strings and nothing about whether git
//! agrees with them.

#![allow(clippy::expect_used, clippy::panic)]

use std::path::{Path, PathBuf};

use skills_core::git::{self, GitRunner, SystemGit};

/// A repository on disk, to clone from.
struct Origin {
    dir: tempfile::TempDir,
}

impl Origin {
    /// Creates a repository with one commit holding a single skill.
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let origin = Self { dir };
        origin.git(&["init", "--quiet", "--initial-branch", "main"]);
        origin.git(&["config", "user.email", "test@example.invalid"]);
        origin.git(&["config", "user.name", "Test"]);
        origin.write(
            "skills/writing/SKILL.md",
            "---\nname: writing\n---\n\nFirst.\n",
        );
        origin.write("skills/writing/helper.py", "print(1)\n");
        origin.commit("first");
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

    fn write(&self, relative: &str, content: &str) {
        let path = self.path().join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, content).expect("write");
    }

    fn commit(&self, message: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "--quiet", "-m", message]);
        self.git(&["rev-parse", "HEAD"]).trim().to_owned()
    }
}

fn git() -> SystemGit {
    SystemGit
}

// ------------------------------------------------------------------ ls-remote

#[test]
fn reads_the_head_commit_without_cloning() {
    let origin = Origin::new();
    let expected = origin.git(&["rev-parse", "HEAD"]).trim().to_owned();

    let sha = git::remote_head_commit(&git(), &origin.url(), None).expect("ls-remote");

    assert_eq!(sha, expected);
}

#[test]
fn reads_the_head_of_a_named_branch() {
    let origin = Origin::new();
    origin.git(&["checkout", "--quiet", "-b", "next"]);
    origin.write(
        "skills/writing/SKILL.md",
        "---\nname: writing\n---\n\nOn next.\n",
    );
    let on_next = origin.commit("second");
    origin.git(&["checkout", "--quiet", "main"]);

    let sha = git::remote_head_commit(&git(), &origin.url(), Some("next")).expect("ls-remote");

    assert_eq!(sha, on_next);
    assert_ne!(sha, origin.git(&["rev-parse", "HEAD"]).trim());
}

#[test]
fn an_empty_ref_means_the_default_branch() {
    let origin = Origin::new();
    let head = git::remote_head_commit(&git(), &origin.url(), None).expect("none");
    let empty = git::remote_head_commit(&git(), &origin.url(), Some("")).expect("empty");
    assert_eq!(head, empty);
}

#[test]
fn a_branch_that_is_not_there_is_an_error_rather_than_an_empty_answer() {
    let origin = Origin::new();
    let err =
        git::remote_head_commit(&git(), &origin.url(), Some("nope")).expect_err("should fail");
    assert_eq!(err.code(), "git-failed");
}

#[test]
fn a_repository_that_is_not_there_fails_with_what_git_said() {
    let err = git::remote_head_commit(&git(), "/definitely/not/a/repo", None).expect_err("fail");
    assert_eq!(err.code(), "git-failed");
    assert!(!err.to_string().is_empty());
}

// ---------------------------------------------------------------------- clone

#[test]
fn clones_the_tip_and_reports_which_commit_it_got() {
    let origin = Origin::new();
    let expected = origin.git(&["rev-parse", "HEAD"]).trim().to_owned();

    let clone = git::shallow_clone(&git(), &origin.url(), None).expect("clone");

    assert_eq!(clone.commit, expected);
    assert!(clone.path().join("skills/writing/SKILL.md").exists());
    assert!(clone.path().join("skills/writing/helper.py").exists());
}

#[test]
fn clones_a_named_branch() {
    let origin = Origin::new();
    origin.git(&["checkout", "--quiet", "-b", "next"]);
    origin.write(
        "skills/writing/SKILL.md",
        "---\nname: writing\n---\n\nOn next.\n",
    );
    origin.commit("second");
    origin.git(&["checkout", "--quiet", "main"]);

    let clone = git::shallow_clone(&git(), &origin.url(), Some("next")).expect("clone");

    let content =
        std::fs::read_to_string(clone.path().join("skills/writing/SKILL.md")).expect("read");
    assert!(content.contains("On next."));
}

#[test]
fn the_clone_is_deleted_when_it_goes_out_of_scope() {
    let origin = Origin::new();
    let path: PathBuf = {
        let clone = git::shallow_clone(&git(), &origin.url(), None).expect("clone");
        clone.path().to_path_buf()
    };
    assert!(!path.exists(), "the temporary directory is gone");
}

#[test]
fn the_git_directory_can_be_stripped_so_nothing_nested_is_installed() {
    let origin = Origin::new();
    let clone = git::shallow_clone(&git(), &origin.url(), None).expect("clone");
    assert!(clone.path().join(".git").exists());

    clone.strip_git_dir().expect("strip");

    assert!(!clone.path().join(".git").exists());
    assert!(clone.path().join("skills/writing/SKILL.md").exists());
}

// ---------------------------------------------------------------- subpaths

#[test]
fn resolves_a_subpath_inside_the_clone() {
    let origin = Origin::new();
    let clone = git::shallow_clone(&git(), &origin.url(), None).expect("clone");

    assert_eq!(
        clone.resolve("skills/writing"),
        Some(clone.path().join("skills/writing"))
    );
    assert_eq!(clone.resolve(""), Some(clone.path().to_path_buf()));
    assert_eq!(clone.resolve("/skills/"), Some(clone.path().join("skills")));
}

/// A subpath comes from a catalogue entry or from whatever the user pasted.
#[test]
fn refuses_a_subpath_that_climbs_out_of_the_clone() {
    let origin = Origin::new();
    let clone = git::shallow_clone(&git(), &origin.url(), None).expect("clone");

    assert_eq!(clone.resolve("../../etc"), None);
    assert_eq!(clone.resolve("skills/../../../etc"), None);
}

// ------------------------------------------------------------ exact commits

#[test]
fn fetches_one_exact_commit_for_a_restore() {
    let origin = Origin::new();
    let first = origin.git(&["rev-parse", "HEAD"]).trim().to_owned();
    origin.write(
        "skills/writing/SKILL.md",
        "---\nname: writing\n---\n\nSecond.\n",
    );
    let second = origin.commit("second");
    assert_ne!(first, second);

    // A shallow clone can only see the tip, which is the whole point of this
    // being a different operation.
    let restored = git::clone_at_commit(&git(), &origin.url(), &first).expect("fetch");

    assert_eq!(restored.commit, first);
    let content =
        std::fs::read_to_string(restored.path().join("skills/writing/SKILL.md")).expect("read");
    assert!(content.contains("First."), "got: {content}");
}

#[test]
fn a_commit_the_host_will_not_hand_over_says_so() {
    let origin = Origin::new();
    let absent = "0123456789abcdef0123456789abcdef01234567";

    let err = git::clone_at_commit(&git(), &origin.url(), absent).expect_err("should fail");

    assert_eq!(err.code(), "commit-unavailable");
    assert!(err.to_string().contains("check for updates"));
}

#[test]
fn something_that_is_not_a_commit_id_is_refused_before_anything_runs() {
    let origin = Origin::new();
    let err = git::clone_at_commit(&git(), &origin.url(), "main").expect_err("should fail");
    assert_eq!(err.code(), "git-failed");
}

// --------------------------------------------------------------- the runner

/// Nothing here can answer a credential prompt, so a repository that wants one
/// has to fail rather than wait for an answer that is never coming.
#[test]
fn a_repository_needing_credentials_fails_rather_than_hanging() {
    let started = std::time::Instant::now();
    let result = git::remote_head_commit(
        &git(),
        "https://github.invalid/private/repository.git",
        None,
    );
    assert!(result.is_err());
    assert!(
        started.elapsed() < git::TIMEOUT,
        "it gave up on its own rather than waiting out the timeout"
    );
}
