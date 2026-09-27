//! Putting an item from a repository onto disk, and keeping it up to date.
//!
//! A function, not something buried in a dialog. The Obsidian plugin had this
//! whole pipeline inside its install modal, which made it impossible to test
//! and impossible to reuse for the update path that does almost the same
//! thing.
//!
//! What lands on disk is plain files with no repository inside them. Which
//! commit they came from is recorded in the item's note, and that record is
//! the whole basis for checking updates and for restoring.

use std::path::{Path, PathBuf};

use crate::diff::{self, CompanionChange, DiffLine, DiffStats};
use crate::error::{CoreError, Result};
use crate::fsunit::{SKILL_MANIFEST, linkable_unit};
use crate::git::{self, ClonedRepo, GitRunner};
use crate::model::{InstallSource, ItemType, ProjectWorkspace, ToolConfig};
use crate::{frontmatter, paths};

/// Where an item should come from and where it should go.
#[derive(Debug, Clone)]
pub struct InstallRequest<'a> {
    pub repo_url: &'a str,
    /// Empty means the default branch.
    pub ref_name: &'a str,
    /// Empty means the repository root is the item.
    pub subpath: &'a str,
    pub tool: &'a ToolConfig,
    pub item_type: ItemType,
    /// `None` installs into the home directory.
    pub project: Option<&'a ProjectWorkspace>,
}

/// What an install put where.
#[derive(Debug, Clone)]
pub struct Installed {
    /// The manifest for a folder skill, the file itself otherwise.
    pub source_path: PathBuf,
    pub name: String,
    pub description: String,
    pub source: InstallSource,
}

/// Clones, copies the item out, and reports what landed.
///
/// Refuses to overwrite: a name already taken is the user's, and choosing
/// which copy wins is not this function's decision to make.
pub fn install(
    git: &dyn GitRunner,
    request: &InstallRequest<'_>,
    home: &Path,
) -> Result<Installed> {
    let destination_dir =
        paths::resolve_tool_dir(request.tool, request.item_type, request.project, home)
            .ok_or_else(|| CoreError::NoProjectPath {
                tool: request.tool.id.clone(),
                item_type: request.item_type.to_string(),
            })?;

    let clone = git::shallow_clone(git, request.repo_url, Some(request.ref_name))?;
    clone.strip_git_dir()?;

    let source_root = resolve_in_clone(&clone, request.subpath)?;
    let unit_name = install_name(request, &source_root)?;
    let destination = destination_dir.join(&unit_name);

    if std::fs::symlink_metadata(&destination).is_ok() {
        return Err(CoreError::DestinationExists {
            path: destination,
            name: unit_name,
        });
    }

    std::fs::create_dir_all(&destination_dir)
        .map_err(|err| CoreError::io(&destination_dir, err))?;
    copy(&source_root, &destination)?;

    let manifest_path = if destination.is_dir() {
        destination.join(SKILL_MANIFEST)
    } else {
        destination.clone()
    };
    let meta = frontmatter::read_source_meta(&manifest_path);

    Ok(Installed {
        name: if meta.name.is_empty() {
            unit_name.trim_end_matches(".md").to_owned()
        } else {
            meta.name
        },
        description: meta.description,
        source: InstallSource {
            source_repo: Some(request.repo_url.to_owned()),
            source_ref: Some(request.ref_name.to_owned()),
            source_subpath: Some(request.subpath.to_owned()),
            source_commit: Some(clone.commit.clone()),
        },
        source_path: manifest_path,
    })
}

/// Whether a tracked item's source has moved on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, specta::Type)]
#[serde(rename_all = "kebab-case")]
pub enum UpdateStatus {
    /// The recorded commit is still the remote's tip.
    Current,
    /// The remote has moved on.
    Stale,
    /// Not installed through this application, so there is nothing to check.
    Untracked,
}

/// Asks the remote whether a tracked item has moved on.
pub fn check_for_update(
    git: &dyn GitRunner,
    source: &InstallSource,
) -> Result<(UpdateStatus, Option<String>)> {
    let (Some(repo_url), Some(commit)) = (&source.source_repo, &source.source_commit) else {
        return Ok((UpdateStatus::Untracked, None));
    };

    let remote = git::remote_head_commit(git, repo_url, source.source_ref.as_deref())?;
    let status = if &remote == commit {
        UpdateStatus::Current
    } else {
        UpdateStatus::Stale
    };
    Ok((status, Some(remote)))
}

/// Which version of a tracked item to fetch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, specta::Type)]
#[serde(rename_all = "lowercase")]
pub enum ReviewMode {
    /// Whatever the remote has now.
    Update,
    /// The commit it was installed at.
    Restore,
}

/// What an update or a restore would do, before it does it.
#[derive(Debug)]
pub struct Review {
    /// Kept alive so applying can copy from it.
    pub clone: ClonedRepo,
    /// The item's root inside the clone.
    pub incoming_root: PathBuf,
    /// The item's root on disk.
    pub local_root: PathBuf,
    pub is_directory: bool,
    pub lines: Vec<DiffLine>,
    pub stats: DiffStats,
    pub companions: Vec<CompanionChange>,
    pub commit: String,
    /// Nothing about this item differs, even though the commit moved.
    pub unchanged: bool,
}

/// Fetches the other version and works out what differs.
///
/// The clone is kept: applying copies from it, and cloning twice would risk
/// applying something other than what was shown.
pub fn prepare_review(
    git: &dyn GitRunner,
    source: &InstallSource,
    local_source_path: &Path,
    mode: ReviewMode,
) -> Result<Review> {
    let repo_url = source.source_repo.as_deref().ok_or(CoreError::NotTracked)?;

    let clone = match mode {
        ReviewMode::Update => git::shallow_clone(git, repo_url, source.source_ref.as_deref())?,
        ReviewMode::Restore => {
            let commit = source
                .source_commit
                .as_deref()
                .ok_or(CoreError::NotTracked)?;
            git::clone_at_commit(git, repo_url, commit)?
        }
    };
    clone.strip_git_dir()?;

    let incoming_root = resolve_in_clone(&clone, source.source_subpath.as_deref().unwrap_or(""))?;
    let unit = linkable_unit(local_source_path);

    let (local_manifest, incoming_manifest) = if unit.is_dir {
        (
            unit.path.join(SKILL_MANIFEST),
            incoming_root.join(SKILL_MANIFEST),
        )
    } else {
        (unit.path.clone(), incoming_root.clone())
    };

    let local_text = std::fs::read_to_string(&local_manifest).unwrap_or_default();
    let incoming_text = std::fs::read_to_string(&incoming_manifest).unwrap_or_default();

    let companions = if unit.is_dir {
        diff::companion_changes(&unit.path, &incoming_root, SKILL_MANIFEST)
    } else {
        Vec::new()
    };
    let lines = diff::build_diff_lines(&local_text, &incoming_text);

    Ok(Review {
        stats: diff::diff_stats(&lines),
        // The commit moved but this item did not: common in a repository
        // holding many skills, and worth saying rather than showing an empty
        // diff and letting the user wonder.
        unchanged: diff::is_unchanged(&local_text, &incoming_text) && companions.is_empty(),
        lines,
        companions,
        commit: clone.commit.clone(),
        incoming_root,
        local_root: unit.path,
        is_directory: unit.is_dir,
        clone,
    })
}

/// Replaces the local copy with what the review showed.
///
/// This destroys local edits, which is why nothing gets here without the diff
/// having been offered first.
pub fn apply_review(review: &Review) -> Result<()> {
    if review.is_directory {
        if review.local_root.exists() {
            std::fs::remove_dir_all(&review.local_root)
                .map_err(|err| CoreError::io(&review.local_root, err))?;
        }
    } else if review.local_root.exists() {
        std::fs::remove_file(&review.local_root)
            .map_err(|err| CoreError::io(&review.local_root, err))?;
    }

    copy(&review.incoming_root, &review.local_root)
}

// ------------------------------------------------------------------ plumbing

fn resolve_in_clone(clone: &ClonedRepo, subpath: &str) -> Result<PathBuf> {
    let root = clone
        .resolve(subpath)
        .ok_or_else(|| CoreError::SubpathMissing {
            subpath: subpath.to_owned(),
        })?;
    if !root.exists() {
        return Err(CoreError::SubpathMissing {
            subpath: subpath.to_owned(),
        });
    }
    Ok(root)
}

/// What the installed folder or file should be called.
///
/// The last segment of the subpath, or the repository's own name when the
/// whole repository is the item.
fn install_name(request: &InstallRequest<'_>, source_root: &Path) -> Result<String> {
    let from_subpath = request
        .subpath
        .trim_matches('/')
        .rsplit('/')
        .next()
        .filter(|segment| !segment.is_empty());

    if let Some(name) = from_subpath {
        return Ok(name.to_owned());
    }

    // The whole repository: name it after the repository.
    let name = request
        .repo_url
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .rsplit(['/', '\\'])
        .next()
        .filter(|segment| !segment.is_empty())
        .map(ToOwned::to_owned);

    name.ok_or_else(|| {
        CoreError::io(
            source_root,
            std::io::Error::other("could not work out a name for this item"),
        )
    })
}

fn copy(from: &Path, to: &Path) -> Result<()> {
    if from.is_dir() {
        copy_dir(from, to)
    } else {
        std::fs::copy(from, to)
            .map(|_| ())
            .map_err(|err| CoreError::io(from, err))
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to).map_err(|err| CoreError::io(to, err))?;
    let entries = std::fs::read_dir(from).map_err(|err| CoreError::io(from, err))?;

    for entry in entries {
        let entry = entry.map_err(|err| CoreError::io(from, err))?;
        let source = entry.path();
        let target = to.join(entry.file_name());

        if source.is_dir() {
            copy_dir(&source, &target)?;
        } else {
            std::fs::copy(&source, &target).map_err(|err| CoreError::io(&source, err))?;
        }
    }
    Ok(())
}
