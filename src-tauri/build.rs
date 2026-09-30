//! Tauri's own build step, and the commit this build came from.

use std::path::PathBuf;
use std::process::Command;

#[path = "src/commit.rs"]
mod commit;

fn main() {
    println!("cargo:rustc-env=SKILLS_HUB_COMMIT={}", commit_label());
    tauri_build::build();
}

/// The short SHA of HEAD, with `-dirty` if tracked files have changed.
///
/// Rebuilt when HEAD moves or the index changes. An edit that is neither
/// committed nor staged does not rerun this, so `-dirty` on a local build is a
/// best effort; a release is built from a clean checkout, where it is exact.
fn commit_label() -> String {
    if let Some(git_dir) = git(&["rev-parse", "--absolute-git-dir"]) {
        let git_dir = PathBuf::from(git_dir.trim());
        for watched in ["HEAD", "index", "refs/heads"] {
            println!("cargo:rerun-if-changed={}", git_dir.join(watched).display());
        }
    }
    let sha = git(&["rev-parse", "--short=7", "HEAD"]);
    let dirty = git(&["status", "--porcelain", "--untracked-files=no"])
        .is_some_and(|out| !out.trim().is_empty());
    commit::describe(sha.as_deref(), dirty)
}

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
}
