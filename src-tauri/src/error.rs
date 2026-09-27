//! The error shape that crosses the IPC boundary.
//!
//! The frontend switches on `code`; `message` is for humans and free to change.

use serde::Serialize;
use skills_core::CoreError;

#[derive(Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
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
        Self {
            code: "io".to_owned(),
            message: err.to_string(),
        }
    }
}
