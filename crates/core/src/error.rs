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
        }
    }

    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Self::Io {
            path: path.into(),
            source,
        }
    }
}
