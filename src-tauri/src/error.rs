//! The error shape that crosses the IPC boundary.
//!
//! The frontend switches on `code`; `message` is for people and free to be
//! reworded without breaking anything.

use serde::Serialize;
use skills_core::CoreError;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
}

impl CommandError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_owned(),
            message: message.into(),
        }
    }

    /// No metadata folder has been chosen yet, so there is nowhere to record
    /// anything. The frontend turns this into the first-run prompt.
    #[must_use]
    pub fn no_metadata_folder() -> Self {
        Self::new(
            "no-metadata-folder",
            "Choose a folder for skills-hub to keep its notes in before scanning.",
        )
    }

    /// A lock was poisoned, which means another command panicked while holding
    /// it. Reported rather than propagated as a second panic.
    #[must_use]
    pub fn poisoned() -> Self {
        Self::new(
            "internal",
            "Something went wrong earlier and left the application inconsistent. Restart it.",
        )
    }
}

impl From<CoreError> for CommandError {
    fn from(err: CoreError) -> Self {
        Self {
            code: err.code().to_owned(),
            message: err.to_string(),
        }
    }
}

impl From<std::io::Error> for CommandError {
    fn from(err: std::io::Error) -> Self {
        Self::new("io", err.to_string())
    }
}

pub type CommandResult<T> = std::result::Result<T, CommandError>;
