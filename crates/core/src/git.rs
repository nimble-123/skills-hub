//! Talking to git.
//!
//! By running the `git` binary, not by linking a library. Three reasons, in
//! order of weight: fetching one exact commit from a shallow clone is the
//! operation the library bindings support least well and it is the one restore
//! depends on; the binary inherits the user's credential helpers, SSH agent,
//! proxy settings and `insteadOf` rewrites for nothing; and linking libgit2
//! would drag OpenSSL into a bundle that otherwise has no native dependencies.
//!
//! Every operation clones into a temporary directory, takes what it needs and
//! throws the clone away. Nothing here keeps a working copy: an installed item
//! is plain files, and the commit it came from is recorded in its note.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use crate::error::{CoreError, Result};

/// How long any one git command may take before it is killed.
pub const TIMEOUT: Duration = Duration::from_secs(45);

/// Running git.
///
/// A trait so the flows above it can be tested against a fake, and so that a
/// different implementation stays a swap rather than a rewrite.
pub trait GitRunner: Send + Sync {
    /// Runs git with these arguments and returns its standard output.
    fn run(&self, args: &[&str], cwd: Option<&Path>) -> Result<String>;
}

/// The `git` on this machine.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemGit;

impl GitRunner for SystemGit {
    fn run(&self, args: &[&str], cwd: Option<&Path>) -> Result<String> {
        use wait_timeout::ChildExt as _;

        let mut command = Command::new("git");
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // Nothing here can answer a prompt, so a repository that wants
            // credentials must fail rather than hang forever waiting for them.
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_ASKPASS", "")
            .env("SSH_ASKPASS", "")
            .env("GCM_INTERACTIVE", "never");
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }

        let mut child = command.spawn().map_err(|err| {
            if err.kind() == std::io::ErrorKind::NotFound {
                CoreError::GitMissing
            } else {
                CoreError::io("git", err)
            }
        })?;

        // `Command` has no timeout of its own, and an unreachable host will
        // otherwise leave the process — and whatever is waiting on it — stuck.
        let status = match child.wait_timeout(TIMEOUT) {
            Ok(Some(status)) => status,
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(CoreError::GitTimedOut {
                    args: args.join(" "),
                });
            }
            Err(err) => return Err(CoreError::io("git", err)),
        };

        let stdout = read_pipe(child.stdout.take());
        if status.success() {
            return Ok(stdout);
        }
        Err(CoreError::GitFailed {
            args: args.join(" "),
            message: first_useful_line(&read_pipe(child.stderr.take())),
        })
    }
}

/// A clone that deletes itself.
///
/// The temporary directory is owned here, so an early return cannot leak it —
/// which the manual cleanup this replaces could, and did.
#[derive(Debug)]
pub struct ClonedRepo {
    dir: tempfile::TempDir,
    pub commit: String,
}

impl ClonedRepo {
    #[must_use]
    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    /// A path inside the clone, or `None` if the subpath escapes it.
    ///
    /// The subpath comes from a catalogue entry or from the user, and a
    /// `../` in it would otherwise reach out of the clone.
    #[must_use]
    pub fn resolve(&self, subpath: &str) -> Option<PathBuf> {
        let trimmed = subpath.trim_matches('/');
        if trimmed.is_empty() {
            return Some(self.path().to_path_buf());
        }
        let joined = self.path().join(trimmed);
        let inside = joined
            .components()
            .all(|c| !matches!(c, std::path::Component::ParentDir));
        inside.then_some(joined)
    }

    /// Removes the `.git` directory.
    ///
    /// An installed item is plain files. Leaving a repository inside someone's
    /// skills folder would make it a nested checkout their own tooling then
    /// has to reason about.
    pub fn strip_git_dir(&self) -> Result<()> {
        let git_dir = self.path().join(".git");
        if git_dir.exists() {
            std::fs::remove_dir_all(&git_dir).map_err(|err| CoreError::io(&git_dir, err))?;
        }
        Ok(())
    }
}

/// The commit a remote's branch currently points at, without cloning anything.
///
/// An empty ref means the repository's default branch, which is how a source
/// can be tracked without knowing what that branch is called.
pub fn remote_head_commit(
    git: &dyn GitRunner,
    url: &str,
    reference: Option<&str>,
) -> Result<String> {
    let reference = reference.filter(|r| !r.is_empty()).unwrap_or("HEAD");
    let output = git.run(&["ls-remote", url, reference], None)?;

    output
        .split_whitespace()
        .next()
        .filter(|sha| is_sha(sha))
        .map(ToOwned::to_owned)
        .ok_or_else(|| CoreError::GitFailed {
            args: format!("ls-remote {url} {reference}"),
            message: format!("the remote has no {reference}"),
        })
}

/// Clones the tip of a branch, one commit deep.
pub fn shallow_clone(
    git: &dyn GitRunner,
    url: &str,
    reference: Option<&str>,
) -> Result<ClonedRepo> {
    let dir = temp_dir()?;
    let target = path_arg(dir.path())?;

    let mut args = vec!["clone", "--depth", "1", "--single-branch", "--no-tags"];
    if let Some(reference) = reference.filter(|r| !r.is_empty()) {
        args.push("--branch");
        args.push(reference);
    }
    args.push(url);
    args.push(&target);

    git.run(&args, None)?;
    let commit = git.run(&["rev-parse", "HEAD"], Some(dir.path()))?;

    Ok(ClonedRepo {
        dir,
        commit: commit.trim().to_owned(),
    })
}

/// Fetches one exact commit.
///
/// `--branch` cannot take a sha, so this builds the repository by hand and
/// fetches the commit directly. That needs the host to allow asking for a sha
/// that is not a branch tip; GitHub does, and hosts that do not get an error
/// saying to update instead of restoring.
pub fn clone_at_commit(git: &dyn GitRunner, url: &str, sha: &str) -> Result<ClonedRepo> {
    if !is_sha(sha) {
        return Err(CoreError::GitFailed {
            args: format!("fetch {sha}"),
            message: format!("{sha} is not a commit id"),
        });
    }

    let dir = temp_dir()?;
    let target = path_arg(dir.path())?;
    let cwd = Some(dir.path());

    git.run(&["init", "--quiet", &target], None)?;
    git.run(&["remote", "add", "origin", url], cwd)?;
    git.run(&["fetch", "--depth", "1", "--no-tags", "origin", sha], cwd)
        .map_err(|_| CoreError::CommitUnavailable {
            sha: sha.to_owned(),
        })?;
    git.run(&["checkout", "--quiet", "FETCH_HEAD"], cwd)?;

    Ok(ClonedRepo {
        dir,
        commit: sha.to_owned(),
    })
}

fn temp_dir() -> Result<tempfile::TempDir> {
    tempfile::Builder::new()
        .prefix("skills-hub-clone-")
        .tempdir()
        .map_err(|err| CoreError::io(std::env::temp_dir(), err))
}

/// A path as a git argument.
fn path_arg(path: &Path) -> Result<String> {
    path.to_str()
        .map(ToOwned::to_owned)
        .ok_or_else(|| CoreError::io(path, std::io::Error::other("path is not valid UTF-8")))
}

fn read_pipe<R: Read>(pipe: Option<R>) -> String {
    let Some(mut pipe) = pipe else {
        return String::new();
    };
    let mut buffer = String::new();
    let _ = pipe.read_to_string(&mut buffer);
    buffer
}

/// git's first line of complaint, which is the one worth showing.
fn first_useful_line(stderr: &str) -> String {
    stderr
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("git failed without saying why")
        .to_owned()
}

fn is_sha(candidate: &str) -> bool {
    let len = candidate.len();
    (7..=64).contains(&len) && candidate.chars().all(|c| c.is_ascii_hexdigit())
}
