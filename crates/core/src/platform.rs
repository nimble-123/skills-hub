//! The only module with `cfg` branches.
//!
//! Symlink creation is the one operation that genuinely differs per platform:
//! Unix has a single call, Windows needs to know up front whether the target is
//! a directory and requires a privilege the user may not hold.

use std::io;
use std::path::{Path, PathBuf};

/// Creates a symbolic link at `link` pointing at `target`.
///
/// `target_is_dir` is ignored on Unix and load-bearing on Windows, which has
/// separate calls for file and directory links.
pub fn symlink(target: &Path, link: &Path, target_is_dir: bool) -> io::Result<()> {
    #[cfg(unix)]
    {
        let _ = target_is_dir;
        std::os::unix::fs::symlink(target, link)
    }
    #[cfg(windows)]
    {
        if target_is_dir {
            std::os::windows::fs::symlink_dir(target, link)
        } else {
            std::os::windows::fs::symlink_file(target, link)
        }
    }
}

/// Reads a symlink and resolves its target to an absolute path.
///
/// A relative target is resolved against the link's own directory. Callers that
/// move a link to a different depth must write the absolute form back, or the
/// relative one silently points somewhere else.
pub fn read_link_absolute(link: &Path) -> io::Result<PathBuf> {
    let raw = std::fs::read_link(link)?;
    if raw.is_absolute() {
        return Ok(raw);
    }
    let base = link.parent().unwrap_or_else(|| Path::new(""));
    Ok(normalize(&base.join(raw)))
}

/// Removes a symlink without touching what it points at.
///
/// `remove_dir_all` on a directory symlink deletes the *target tree*; this is the
/// call that must be used instead.
pub fn remove_symlink(link: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::remove_file(link)
    }
    #[cfg(windows)]
    {
        let meta = std::fs::symlink_metadata(link)?;
        if meta.file_type().is_dir() {
            std::fs::remove_dir(link)
        } else {
            std::fs::remove_file(link)
        }
    }
}

/// Whether this process can create symlinks here.
///
/// Windows requires Developer Mode or `SeCreateSymbolicLinkPrivilege`. Probing
/// once at startup lets the UI explain why project linking is unavailable,
/// instead of failing at the moment the user tries it.
#[must_use]
pub fn probe_symlink_support(scratch_dir: &Path) -> bool {
    let Ok(dir) = tempfile::tempdir_in(scratch_dir) else {
        return false;
    };
    let target = dir.path().join("target");
    let link = dir.path().join("link");
    if std::fs::write(&target, b"probe").is_err() {
        return false;
    }
    symlink(&target, &link, false).is_ok()
}

/// Lexical path cleanup: resolves `.` and `..` without touching the filesystem.
///
/// Deliberately not `fs::canonicalize` — that resolves symlinks, which is the
/// opposite of what a caller inspecting a link wants, and on Windows it returns
/// `\\?\` UNC paths that break display and string comparison.
fn normalize(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push(Component::ParentDir);
                }
            }
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_relative_link_target_against_the_links_own_directory() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        std::fs::create_dir_all(root.join("share/skills")).expect("mkdir");
        std::fs::create_dir_all(root.join("tool/skills")).expect("mkdir");
        std::fs::write(root.join("share/skills/one.md"), b"x").expect("write");

        let link = root.join("tool/skills/one.md");
        symlink(Path::new("../../share/skills/one.md"), &link, false).expect("symlink");

        assert_eq!(
            read_link_absolute(&link).expect("read_link_absolute"),
            root.join("share/skills/one.md")
        );
    }

    #[test]
    fn leaves_an_absolute_link_target_alone() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("target.md");
        let link = dir.path().join("link.md");
        std::fs::write(&target, b"x").expect("write");
        symlink(&target, &link, false).expect("symlink");

        assert_eq!(read_link_absolute(&link).expect("read"), target);
    }

    #[test]
    fn removing_a_directory_symlink_leaves_the_target_tree_intact() {
        let dir = tempfile::tempdir().expect("tempdir");
        let target = dir.path().join("real");
        std::fs::create_dir(&target).expect("mkdir");
        std::fs::write(target.join("SKILL.md"), b"body").expect("write");

        let link = dir.path().join("link");
        symlink(&target, &link, true).expect("symlink");
        remove_symlink(&link).expect("remove_symlink");

        assert!(!link.exists(), "the link is gone");
        assert!(target.join("SKILL.md").exists(), "the target tree survives");
    }

    #[test]
    fn detects_symlink_support_on_this_platform() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(probe_symlink_support(dir.path()));
    }
}
