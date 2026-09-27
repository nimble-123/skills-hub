//! Typed errors.
//!
//! Every variant carries a stable `code()` so the frontend can branch on the
//! code rather than on a message string that is free to be reworded.

use std::path::PathBuf;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("{path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("no item with id {entry_id}")]
    UnknownItem { entry_id: String },

    #[error("{path} is not a metadata note this application can read: {reason}")]
    UnreadableNote { path: PathBuf, reason: String },

    #[error("could not move {path} to the trash: {reason}")]
    Trash { path: PathBuf, reason: String },

    #[error(
        "{name} is part of the installed plugin {plugin_id}; enable or disable the whole plugin instead"
    )]
    ItemBelongsToPlugin { name: String, plugin_id: String },

    #[error("something called {name} is already at {path}")]
    DestinationExists { path: PathBuf, name: String },

    #[error("{path} has no parent directory")]
    NoParentDirectory { path: PathBuf },

    #[error("{tool} has no settings file this application can use to enable or disable a plugin")]
    PluginToggleUnsupported { tool: String },

    #[error("{tool} has nowhere in a project to put a {item_type}")]
    NoProjectPath { tool: String, item_type: String },

    #[error("{path} is not a link, so removing it would delete the item itself")]
    NotALink { path: PathBuf },

    #[error("git is not installed, or is not on this application's PATH")]
    GitMissing,

    #[error("git took longer than 45 seconds: git {args}")]
    GitTimedOut { args: String },

    #[error("git {args} failed: {message}")]
    GitFailed { args: String, message: String },

    #[error("the host would not hand over commit {sha}; check for updates instead")]
    CommitUnavailable { sha: String },

    #[error("the repository has nothing at {subpath}")]
    SubpathMissing { subpath: String },

    #[error("this item was not installed through skills-hub, so there is nothing to update")]
    NotTracked,
}

impl CoreError {
    /// Stable identifier for this error, safe to match on from the frontend.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            Self::Io { .. } => "io",
            Self::UnknownItem { .. } => "unknown-item",
            Self::UnreadableNote { .. } => "unreadable-note",
            Self::Trash { .. } => "trash",
            Self::ItemBelongsToPlugin { .. } => "item-belongs-to-plugin",
            Self::DestinationExists { .. } => "destination-exists",
            Self::NoParentDirectory { .. } => "no-parent-directory",
            Self::PluginToggleUnsupported { .. } => "plugin-toggle-unsupported",
            Self::NoProjectPath { .. } => "no-project-path",
            Self::NotALink { .. } => "not-a-link",
            Self::GitMissing => "git-missing",
            Self::GitTimedOut { .. } => "git-timed-out",
            Self::GitFailed { .. } => "git-failed",
            Self::CommitUnavailable { .. } => "commit-unavailable",
            Self::SubpathMissing { .. } => "subpath-missing",
            Self::NotTracked => "not-tracked",
        }
    }

    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}
